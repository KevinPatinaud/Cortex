import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
import { CodexQuotaService } from "../service/iaService/CodexQuotaService.ts";
import type { WorkflowCheckpointState } from "../service/workflowExecution/WorkflowCheckpoint.ts";
import { ExecutionWorkspaceGuard } from "../service/executionWorkspace/ExecutionWorkspaceGuard.ts";

function result(options: AgentExecutionOptions, remainingWork: string[] = []): AgentExecutionResult {
  const next = ((options.outputSchema?.properties as Record<string, any>)?.nextAgentIds?.items?.enum ?? []) as string[];
  return { sessionId: options.sessionId || "native-session", answer: JSON.stringify({ status: "success", items: [{ content: "Useful delivery" }],
    nextAgentIds: next, isMultiSelectionAllowed: false, isMultiSelectionThreaded: false, wait: null, notes: null,
    continuity: { summary: "Decision retained", decisions: ["Preserve the original"], evidence: ["EVIDENCE_MARKER report.md:4"], remainingWork }, acceptance: [] }) };
}
async function fixture(t: test.TestContext, ask: (prompt: string, options: AgentExecutionOptions) => Promise<AgentExecutionResult>, count = 1, authoredPrompt?: string) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cortex-execution-quality-"));
  const configurationFile = path.join(directory, "config.json");
  const catalog = new CodexModelService(directory, async () => ({ available: true, cliVersion: "0.163-test",
    defaultModel: "server-model", configuredReasoningEffort: "xhigh", checkedAt: new Date().toISOString(), error: null,
    declaredMcpServers: [], declaredApps: [],
    models: [{ model: "server-model", displayName: "Model", isDefault: true, reasoningEfforts: ["low", "medium", "high", "xhigh"], defaultReasoningEffort: "medium" }] }));
  const service = new AgentService([{ engine: "codex", label: "Codex", isAvailable: async () => true,
    ask: async (prompt, options = {}) => {
      if (!options.persistSession && options.purpose !== "interpretation") {
        const context = JSON.parse(prompt.split("Context to analyze:\n")[1]);
        return { answer: JSON.stringify({ agents: context.agents.map((agent: { id: string }, i: number) => ({
          id: agent.id, nextAgentIds: context.agents[i + 1] ? [context.agents[i + 1].id] : [], inputMode: "separate" })), parameters: [] }) };
      }
      return ask(prompt, options);
    } }], new AgentConfigurationService(configurationFile), undefined, undefined, catalog);
  const projects = new ProjectService(configurationFile, path.join(directory, "projects"));
  const { project } = await projects.createProject({ parentDirectory: directory, name: "Quality", engine: "codex", instructions: "UNIQUE_SHARED_RULE",
    agents: Array.from({ length: count }, (_, i) => ({ name: `Worker ${i}`, description: `Role ${i}`, prompt: authoredPrompt ?? `TASK_${i}` })) });
  const storage = new SqliteWorkflowAuditRepository(path.join(directory, "audit.sqlite"));
  t.after(async () => { storage.close(); await rm(directory, { recursive: true, force: true }); });
  const quality = new ExecutionQualityService(configurationFile, path.join(directory, ".quality-state"));
  const restart = (quota?: CodexQuotaService, guard?: ExecutionWorkspaceGuard) => new AgentUseCase(service, new ProjectUseCase(projects, new DirectoryPickerService(), service),
    new WorkflowAuditService(storage), {}, undefined, quota, guard, quality);
  return { directory, project, quality, storage, useCase: restart(), service, restart, configurationFile };
}

async function sharedWorkspace(f: Awaited<ReturnType<typeof fixture>>, verify: ConstructorParameters<typeof ExecutionWorkspaceGuard>[2] = async () => {}) {
  const configuration = JSON.parse(await readFile(f.configurationFile, "utf8"));
  configuration.executionWorkspaces = [{ id: "shared", directory: f.project.directoryPath, projectIds: [f.project.id, "other"], git: { branch: "main", remote: "origin" } }];
  await writeFile(f.configurationFile, JSON.stringify(configuration));
  return () => new ExecutionWorkspaceGuard(f.configurationFile, path.join(f.directory, "journals"), verify,
    id => f.storage.getCheckpoint(id)?.state);
}

for (const scope of ["agent", "workflow"] as const) test(`${scope}: workspace recovery resumes interpretation without adding a new mission or repeating delivery`, async t => {
  let missionCalls = 0, formatterCalls = 0;
  let published = false;
  const f = await fixture(t, async (_prompt, options) => {
    if (options.purpose === "mission") { missionCalls++; return { sessionId: "business", answer: "Delivery already performed" }; }
    if (++formatterCalls === 1) throw new Error("Interpreter temporarily unavailable");
    published = true;
    return result(options);
  });
  const guard = await sharedWorkspace(f, async (_workspace, phase) => {
    if (phase === "finish" && !published) throw new Error("Publication still requires verification");
  });
  await assert.rejects(f.restart(undefined, guard()).runWorkflow(f.project.id), /temporarily unavailable/);
  assert.equal(await guard().recoveryProjectId("other"), f.project.id);
  const restarted = f.restart(undefined, guard());
  if (scope === "agent") {
    const project = await restarted.loadProject(f.project.id);
    await assert.rejects(restarted.runAgent(f.project.id, { agentId: project.agents[0].id, additionalInstructions: "Start an unrelated new mission" }), /Terminez l’interprétation/);
    await restarted.runAgent(f.project.id, { agentId: project.agents[0].id });
  } else await restarted.runWorkflow(f.project.id);
  assert.equal(missionCalls, 1);
  assert.equal(formatterCalls, 2);
  assert.equal(await guard().recoveryProjectId("other"), undefined);
});

test("published work awaiting interpretation releases the shared checkout and recovers in the background after quota reset", async t => {
  let missionCalls = 0, formatterCalls = 0, denied = false;
  const f = await fixture(t, async (_prompt, options) => {
    if (options.purpose === "mission") { missionCalls++; denied = true; return { sessionId: "business", answer: "Published once" }; }
    formatterCalls++; return result(options);
  });
  const quota = new CodexQuotaService(f.configurationFile, async () => ({ rateLimitsByLimitId: { codex: {
    primary: { usedPercent: denied ? 90 : 0, windowDurationMins: 300 }, secondary: { usedPercent: 0, windowDurationMins: 10080 }
  } } }));
  await quota.saveConfiguration({ enabled: true, minimumFiveHourRemainingPercent: 50, minimumWeeklyRemainingPercent: 0 });
  const guard = await sharedWorkspace(f);
  await assert.rejects(f.restart(quota, guard()).runWorkflow(f.project.id), /minimum 50/);
  assert.equal(await guard().recoveryProjectId("other"), undefined);
  await guard().run("other", async () => {});
  const now = new Date();
  await f.restart(quota, guard()).wakeWaitingWorkflows(now);
  const first = f.storage.getCheckpoint(f.project.id)!.state as WorkflowCheckpointState;
  assert.equal(first.interpretationRecovery?.attempts, 1);
  const restarted = f.restart(quota, guard());
  await restarted.wakeWaitingWorkflows(new Date(now.getTime() + 240_000));
  assert.equal((f.storage.getCheckpoint(f.project.id)!.state as WorkflowCheckpointState).interpretationRecovery?.attempts, 1);
  await restarted.wakeWaitingWorkflows(new Date(now.getTime() + 301_000));
  assert.equal((f.storage.getCheckpoint(f.project.id)!.state as WorkflowCheckpointState).interpretationRecovery?.attempts, 2);
  await f.restart(quota, guard()).wakeWaitingWorkflows(new Date(now.getTime() + 601_000));
  assert.equal((f.storage.getCheckpoint(f.project.id)!.state as WorkflowCheckpointState).interpretationRecovery?.attempts, 2);
  denied = false; await quota.getStatus();
  await Promise.all([restarted.wakeWaitingWorkflows(new Date(now.getTime() + 902_000)), restarted.wakeWaitingWorkflows(new Date(now.getTime() + 902_000))]);
  assert.equal(missionCalls, 1); assert.equal(formatterCalls, 1);
  const completed = f.storage.getCheckpoint(f.project.id)!.state as WorkflowCheckpointState;
  assert.equal(completed.instance?.status, "completed");
  assert.equal(completed.interpretationRecovery, undefined);
});

test("a pending result never releases an active interpreter's lease", async t => {
  let release!: () => void, entered!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  const interpreting = new Promise<void>(resolve => { entered = resolve; });
  const f = await fixture(t, async (_prompt, options) => {
    if (options.purpose === "mission") return { sessionId: "business", answer: "Published once" };
    entered(); await blocked; return result(options);
  });
  const factory = await sharedWorkspace(f);
  const guard = factory();
  const running = f.restart(undefined, guard).runWorkflow(f.project.id);
  try {
    await interpreting;
    await assert.rejects(guard.run("other", async () => assert.fail("Concurrent writer acquired the checkout")), /utilisé/);
  } finally { release(); await running; }
  assert.equal(await guard.recoveryProjectId("other"), undefined);
});

test("a legacy failed reservation with a saved delivery is reconciled without stealing another project's slot", async t => {
  const f = await fixture(t, async (_prompt, options) => {
    if (options.purpose === "mission") return { sessionId: "business", answer: "Published once" };
    throw new Error("Interpreter unavailable");
  });
  let published = false;
  const guard = await sharedWorkspace(f, async (_workspace, phase) => {
    if (phase === "finish" && !published) throw new Error("Unpublished effects");
  });
  await assert.rejects(f.restart(undefined, guard()).runWorkflow(f.project.id), /Interpreter unavailable/);
  assert.equal(await guard().recoveryProjectId("other"), f.project.id);
  published = true;
  assert.equal(await guard().recoveryProjectId("other"), undefined);
});

test("cancelling a saved interpretation before loading its project survives restart and prevents automatic recovery", async t => {
  let missionCalls = 0, formatterCalls = 0;
  const f = await fixture(t, async (_prompt, options) => {
    if (options.purpose === "mission") { missionCalls++; return { sessionId: "business", answer: "Published once" }; }
    formatterCalls++; throw new Error("Interpreter unavailable");
  });
  await assert.rejects(f.useCase.runWorkflow(f.project.id), /Interpreter unavailable/);
  assert.equal(f.restart().cancelProjectExecution(f.project.id), true);
  await f.restart().wakeWaitingWorkflows(new Date(Date.now() + 3_600_000));
  assert.equal(missionCalls, 1); assert.equal(formatterCalls, 1);
  assert.equal((f.storage.getCheckpoint(f.project.id)!.state as WorkflowCheckpointState).instance?.status, "cancelled");
});

test("pins inherited runtime settings, persists the actual profile and deduplicates native AGENTS instructions", async t => {
  const f = await fixture(t, async (prompt, options) => {
    assert.equal(options.model, "server-model"); assert.equal(options.reasoningEffort, "xhigh");
    assert.equal(options.workingDirectory, f.project.directoryPath);
    assert.equal(prompt, "TASK_0");
    assert.ok(!prompt.includes("JSON Schema:")); assert.equal(options.outputSchema, undefined);
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
      assert.match(prompt, /Résultat précédent/);
      assert.match(prompt, /Useful delivery/);
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

test("hands evidence and decisions to successors as data without adding Cortex directives", async t => {
  const prompts: string[] = [];
  const f = await fixture(t, async (prompt, options) => {
    if (options.purpose === "interpretation") return result(options);
    prompts.push(prompt);
    // Natural mission output is deliberately independent of Cortex routing.
    return { sessionId: "native-session", answer: "EVIDENCE_MARKER report.md:4. Preserve the original." };
  }, 2);
  await f.useCase.runWorkflow(f.project.id);
  assert.equal(prompts.length, 2);
  assert.match(prompts[1], /EVIDENCE_MARKER/); assert.match(prompts[1], /Preserve the original/);
  assert.ok(!prompts[1].includes("Verify their evidence against the relevant sources"));
  assert.ok(!prompts[1].includes("Cortex time context"));
});

test("a natural mission runs without the Cortex contract; an isolated low-effort pass adds metadata without rewriting the deliverable", async t => {
  const calls: AgentExecutionOptions[] = [];
  const original = "Article intégral.\n\nDeuxième paragraphe avec sa source https://example.com/source.";
  const f = await fixture(t, async (prompt, options) => {
    calls.push(options);
    if (options.purpose === "mission") {
      assert.equal(prompt, "TASK_0");
      assert.equal(options.outputSchema, undefined);
      return { sessionId: "business-session", answer: original };
    }
    assert.equal(options.purpose, "interpretation"); assert.equal(options.reasoningEffort, "low");
    assert.equal(options.readOnly, true); assert.equal(options.persistSession, false);
    assert.equal(options.delegation, "none"); assert.equal(options.sessionId, undefined);
    assert.notEqual(options.workingDirectory, f.project.directoryPath); assert.match(prompt, /Article intégral/);
    return { ...result(options), sessionId: "formatter-session" };
  });
  await f.useCase.runWorkflow(f.project.id);
  assert.equal(calls.length, 2);
  const run = f.storage.listRuns(f.project.id, 10, 0).items[0];
  const execution = f.storage.getRun(f.project.id, run.id)!.executions[0];
  assert.equal(execution.sessionId, "business-session");
  assert.equal(execution.processing?.mission.response, original);
  assert.equal(execution.processing?.interpretation.sessionId, "formatter-session");
  assert.equal(execution.processing?.interpretation.profile?.reasoningEffort, "low");
  assert.equal(parseAgentResponse(execution.response!)?.items[0].content, original);
});

test("the mission prompt is byte-for-byte authored text despite Cortex criteria, delegation and random-choice settings", async t => {
  const authored = "Choisis au hasard un sujet puis réalise la mission.\nRespecte ma formulation.";
  const f = await fixture(t, async (prompt, options) => {
    assert.equal(prompt, authored);
    assert.equal(options.purpose, "mission"); assert.equal(options.delegation, "bounded");
    assert.equal(options.outputSchema, undefined);
    return result(options);
  }, 1, authored);
  await f.quality.savePolicy(f.project.id, { ...DEFAULT_EXECUTION_POLICY, delegation: "bounded", acceptanceCriteria: ["CORTEX_CRITERION_ONLY"] });
  await f.useCase.runWorkflow(f.project.id);
  const run = f.storage.listRuns(f.project.id, 10, 0).items[0];
  const execution = f.storage.getRun(f.project.id, run.id)!.executions[0];
  assert.equal(execution.prompt, authored); assert.equal(execution.processing?.mission.prompt, authored);
});

for (const scope of ["agent", "workflow"] as const) test(`${scope}: old native sessions are replaced without losing their result data`, async t => {
  let calls = 0;
  const f = await fixture(t, async (prompt, options) => {
    if (++calls === 2) {
      assert.equal(options.sessionId, undefined);
      assert.match(prompt, /Useful delivery|Decision retained/);
      assert.ok(!prompt.includes("Cortex time context")); assert.ok(!prompt.includes("Execution boundary"));
    }
    return result(options, ["Finish current task"]);
  });
  const agent = (await f.useCase.loadProject(f.project.id)).agents[0];
  await f.useCase.runAgent(f.project.id, { agentId: agent.id });
  const checkpoint = f.storage.getCheckpoint(f.project.id)!;
  const state = checkpoint.state as WorkflowCheckpointState;
  for (const saved of state.agents) for (const thread of saved.threads) delete thread.missionPromptVersion;
  f.storage.saveCheckpoint(f.project.id, checkpoint.fingerprint, state);
  const memory = (await f.quality.readMemory(f.project.id, agent.id))!;
  delete memory.missionPromptVersion;
  await f.quality.saveMemory(f.project.id, agent.id, memory);
  const restarted = f.restart();
  await restarted.loadProject(f.project.id);
  if (scope === "agent") await restarted.runAgent(f.project.id, { agentId: agent.id });
  else await restarted.runWorkflow(f.project.id);
  assert.equal(calls, 2);
});

test("a failed formatter survives restart and a normal run retries only interpretation", async t => {
  let missionCalls = 0, formatterCalls = 0;
  const f = await fixture(t, async (_prompt, options) => {
    if (options.purpose === "mission") { missionCalls++; return { sessionId: "business", answer: "Publication déjà effectuée." }; }
    if (++formatterCalls === 1) throw new Error("Formatting failed");
    return result(options);
  });
  await assert.rejects(f.useCase.runWorkflow(f.project.id), /Formatting failed/);
  const failedRun = f.storage.listRuns(f.project.id, 10, 0).items[0];
  assert.equal(f.storage.getRun(f.project.id, failedRun.id)!.executions[0].processing?.interpretation.status, "failed");
  const restarted = f.restart();
  await restarted.runWorkflow(f.project.id);
  assert.equal(missionCalls, 1); assert.equal(formatterCalls, 2);
});

test("quota exhaustion between passes checkpoints the delivery and never repeats its actions", async t => {
  let missionCalls = 0, formatterCalls = 0, denied = false;
  const f = await fixture(t, async (_prompt, options) => {
    if (options.purpose === "mission") { missionCalls++; denied = true; return { sessionId: "business", answer: "Mail déjà envoyé." }; }
    formatterCalls++; return result(options);
  });
  const quota = new CodexQuotaService(f.configurationFile, async () => ({ rateLimitsByLimitId: { codex: {
    primary: { usedPercent: denied ? 90 : 0, windowDurationMins: 300 }, secondary: { usedPercent: 0, windowDurationMins: 10080 }
  } } }));
  await quota.saveConfiguration({ enabled: true, minimumFiveHourRemainingPercent: 50, minimumWeeklyRemainingPercent: 0 });
  await assert.rejects(f.restart(quota).runWorkflow(f.project.id), /minimum 50/);
  assert.equal(missionCalls, 1); assert.equal(formatterCalls, 0);
  denied = false; await quota.getStatus();
  await f.restart(quota).runWorkflow(f.project.id);
  assert.equal(missionCalls, 1); assert.equal(formatterCalls, 1);
});

test("the integrated opt-out retains the existing native output schema in one pass", async t => {
  let calls = 0;
  const f = await fixture(t, async (prompt, options) => {
    calls++; assert.equal(options.purpose, undefined); assert.ok(options.outputSchema); assert.match(prompt, /native JSON schema/);
    return result(options);
  });
  await f.quality.savePolicy(f.project.id, { ...DEFAULT_EXECUTION_POLICY, resultMode: "integrated" });
  await f.useCase.runWorkflow(f.project.id); assert.equal(calls, 1);
});

test("manual stop interrupts interpretation and a later resume keeps the completed mission", async t => {
  let missionCalls = 0, formatterCalls = 0;
  let entered!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const f = await fixture(t, async (_prompt, options) => {
    if (options.purpose === "mission") { missionCalls++; return { sessionId: "business", answer: "Delivery already made" }; }
    if (++formatterCalls === 1) {
      entered();
      await new Promise<void>((_resolve, reject) => options.signal!.addEventListener("abort", () => reject(options.signal!.reason), { once: true }));
    }
    return result(options);
  });
  const running = f.useCase.runWorkflow(f.project.id);
  await started; assert.equal(f.useCase.cancelProjectExecution(f.project.id), true);
  await assert.rejects(running);
  await f.restart().runWorkflow(f.project.id);
  assert.equal(missionCalls, 1); assert.equal(formatterCalls, 2);
});

test("a pending interpretation cannot silently switch repositories or rerun its business task", async t => {
  let calls = 0;
  const f = await fixture(t, async (_prompt, options) => {
    if (options.purpose === "mission") { calls++; return { sessionId: "business", answer: "Published in original repository" }; }
    throw new Error("Formatter unavailable");
  });
  await assert.rejects(f.useCase.runWorkflow(f.project.id), /Formatter unavailable/);
  await f.quality.savePolicy(f.project.id, { ...DEFAULT_EXECUTION_POLICY, workspaceDirectory: f.directory });
  await assert.rejects(f.restart().runWorkflow(f.project.id), /dépôt initial/);
  assert.equal(calls, 1);
});
