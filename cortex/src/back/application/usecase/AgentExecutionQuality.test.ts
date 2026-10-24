import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AgentUseCase } from "./AgentUseCase.ts";
import { ProjectUseCase } from "./ProjectUseCase.ts";
import { ProjectService } from "../service/projectService/ProjectService.ts";
import { DirectoryPickerService } from "../service/projectService/DirectoryPickerService.ts";
import { AgentService } from "../service/iaService/AgentService.ts";
import { AgentConfigurationService } from "../service/iaService/AgentConfigurationService.ts";
import { CodexModelService } from "../service/iaService/CodexModelService.ts";
import type { AgentExecutionOptions, AgentExecutionResult } from "../service/iaService/AgentProvider.ts";
import { ExecutionQualityService } from "../service/executionQuality/ExecutionQualityService.ts";
import { WorkflowAuditService } from "../service/workflowAudit/WorkflowAuditService.ts";
import { SqliteWorkflowAuditRepository } from "../../infrastructure/audit/SqliteWorkflowAuditRepository.ts";
import { DEFAULT_EXECUTION_POLICY } from "../../../shared/ExecutionQuality.ts";
import { parseAgentResponse } from "../../../shared/AgentResponse.ts";

function result(options: AgentExecutionOptions, remainingWork: string[] = []): AgentExecutionResult {
  const next = ((options.outputSchema?.properties as Record<string, any>)?.nextAgentIds?.items?.enum ?? []) as string[];
  return { sessionId: options.sessionId || "native-session", answer: JSON.stringify({ status: "success", items: [{ content: "Useful delivery" }],
    nextAgentIds: next, isMultiSelectionAllowed: false, isMultiSelectionThreaded: false, wait: null, notes: null,
    continuity: { summary: "Decision retained", decisions: ["Preserve the original"], evidence: ["EVIDENCE_MARKER report.md:4"], remainingWork }, acceptance: [] }) };
}
async function fixture(t: test.TestContext, ask: (prompt: string, options: AgentExecutionOptions) => Promise<AgentExecutionResult>, count = 1) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cortex-execution-quality-"));
  const configurationFile = path.join(directory, "config.json");
  const catalog = new CodexModelService(directory, async () => ({ available: true, cliVersion: "0.163-test",
    defaultModel: "server-model", configuredReasoningEffort: "xhigh", checkedAt: new Date().toISOString(), error: null,
    models: [{ model: "server-model", displayName: "Model", isDefault: true, reasoningEfforts: ["medium", "high", "xhigh"], defaultReasoningEffort: "medium" }] }));
  const service = new AgentService([{ engine: "codex", label: "Codex", isAvailable: async () => true,
    ask: async (prompt, options = {}) => {
      if (!options.persistSession) {
        const context = JSON.parse(prompt.split("Context to analyze:\n")[1]);
        return { answer: JSON.stringify({ agents: context.agents.map((agent: { id: string }, i: number) => ({
          id: agent.id, nextAgentIds: context.agents[i + 1] ? [context.agents[i + 1].id] : [], inputMode: "separate" })), parameters: [] }) };
      }
      return ask(prompt, options);
    } }], new AgentConfigurationService(configurationFile), undefined, undefined, catalog);
  const projects = new ProjectService(configurationFile, path.join(directory, "projects"));
  const { project } = await projects.createProject({ parentDirectory: directory, name: "Quality", engine: "codex", instructions: "UNIQUE_SHARED_RULE",
    agents: Array.from({ length: count }, (_, i) => ({ name: `Worker ${i}`, description: `Role ${i}`, prompt: `TASK_${i}` })) });
  const storage = new SqliteWorkflowAuditRepository(path.join(directory, "audit.sqlite"));
  t.after(async () => { storage.close(); await rm(directory, { recursive: true, force: true }); });
  const quality = new ExecutionQualityService(configurationFile, path.join(directory, "quality"));
  const useCase = new AgentUseCase(service, new ProjectUseCase(projects, new DirectoryPickerService(), service),
    new WorkflowAuditService(storage), {}, undefined, undefined, undefined, quality);
  return { directory, project, quality, storage, useCase, service };
}

test("pins inherited runtime settings, persists the actual profile and deduplicates native AGENTS instructions", async t => {
  const f = await fixture(t, async (prompt, options) => {
    assert.equal(options.model, "server-model"); assert.equal(options.reasoningEffort, "xhigh");
    assert.equal(options.workingDirectory, f.project.directoryPath);
    assert.ok(!prompt.includes("UNIQUE_SHARED_RULE")); assert.match(prompt, /already loaded from AGENTS.md/);
    return result(options);
  });
  await f.useCase.runWorkflow(f.project.id);
  const run = f.storage.listRuns(f.project.id, 10, 0).items[0];
  const execution = f.storage.getRun(f.project.id, run.id)!.executions[0];
  assert.equal(execution.model, "server-model"); assert.equal(execution.reasoningEffort, "xhigh");
  assert.equal(execution.profile?.cliVersion, "0.163-test");
  assert.equal(parseAgentResponse(execution.response!)?.assessment?.outcome, "reported");
});

test("unfinished work resumes the same native session; reset and isolated dossiers do not resurrect or mix prior work", async t => {
  let calls = 0; const sessions: Array<string | undefined> = [];
  const f = await fixture(t, async (_prompt, options) => { sessions.push(options.sessionId); calls++; return result(options, calls === 1 ? ["Check mobile"] : []); });
  await f.useCase.runWorkflow(f.project.id);
  assert.equal(f.storage.listRuns(f.project.id, 10, 0).items[0].status, "partial");
  await f.useCase.runWorkflow(f.project.id);
  assert.deepEqual(sessions, [undefined, "native-session"]);
  const snapshot = await f.useCase.loadProject(f.project.id);
  const agent = snapshot.agents[0];
  const before = await f.quality.readMemory(f.project.id, agent.id);
  await f.useCase.createIsolatedWorkflow(snapshot, "isolated", "different dossier").runWorkflow(f.project.id);
  assert.deepEqual(await f.quality.readMemory(f.project.id, agent.id), before);
  f.useCase.resetWorkflow(f.project.id);
  assert.equal(await f.quality.readMemory(f.project.id, agent.id), null);
  await f.useCase.runWorkflow(f.project.id);
  assert.equal(sessions.at(-1), undefined);
});

test("acceptance and independent delivery checks override unsupported success claims", async t => {
  const f = await fixture(t, async (_prompt, options) => result(options));
  await f.quality.savePolicy(f.project.id, { ...DEFAULT_EXECUTION_POLICY,
    acceptanceCriteria: ["Mobile inspected"], checks: [{ label: "Regression", command: process.execPath, args: ["-e", "process.exit(2)"] }] });
  const response = await f.useCase.runAgent(f.project.id, { agentId: (await f.useCase.loadProject(f.project.id)).agents[0].id });
  assert.equal(parseAgentResponse(response.answer)?.status, "partial");
  assert.equal(parseAgentResponse(response.answer)?.assessment?.checks[0].passed, false);
  assert.equal(f.storage.listRuns(f.project.id, 10, 0).items[0].status, "partial");
});

test("a missing prerequisite prevents inference and the failed attempt remains in the audit", async t => {
  let calls = 0;
  const f = await fixture(t, async (_prompt, options) => { calls++; return result(options); });
  await f.quality.savePolicy(f.project.id, { ...DEFAULT_EXECUTION_POLICY,
    preflightChecks: [{ label: "Browser", command: process.execPath, args: ["-e", "process.exit(9)"] }] });
  await assert.rejects(f.useCase.runWorkflow(f.project.id), /Browser/);
  assert.equal(calls, 0); assert.equal(f.storage.listRuns(f.project.id, 10, 0).items[0].status, "failed");
});

test("switching the working repository starts a fresh native session and carries forward the unfinished task", async t => {
  let calls = 0;
  const f = await fixture(t, async (prompt, options) => {
    if (calls++) {
      assert.equal(options.sessionId, undefined);
      assert.equal(options.workingDirectory, f.directory);
      assert.match(prompt, /different working directory/);
      assert.match(prompt, /Decision retained/);
      assert.equal(prompt.split("UNIQUE_SHARED_RULE").length - 1, 1);
    }
    return result(options, ["Finish current task"]);
  });
  const project = await f.useCase.loadProject(f.project.id);
  await f.useCase.runAgent(f.project.id, { agentId: project.agents[0].id });
  await f.quality.savePolicy(f.project.id, { ...DEFAULT_EXECUTION_POLICY, workspaceDirectory: f.directory });
  await f.useCase.runAgent(f.project.id, { agentId: project.agents[0].id });
  assert.equal(calls, 2);
});

test("hands evidence and decisions to successors while preserving source verification", async t => {
  const prompts: string[] = [];
  const f = await fixture(t, async (prompt, options) => { prompts.push(prompt); return result(options); }, 2);
  await f.useCase.runWorkflow(f.project.id);
  assert.equal(prompts.length, 2);
  assert.match(prompts[1], /EVIDENCE_MARKER/); assert.match(prompts[1], /Preserve the original/);
  assert.match(prompts[1], /Verify their evidence against the relevant sources/);
});
