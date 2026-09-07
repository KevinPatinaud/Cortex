import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { AgentUseCase } from "./AgentUseCase.ts";
import type { ProjectUseCase, ProjectContentOutput } from "./ProjectUseCase.ts";
import type { AgentService } from "../service/iaService/AgentService.ts";
import type { AgentExecutionOptions, AgentExecutionResult } from "../service/iaService/AgentProvider.ts";
import type { AgentWorkflowConfiguration } from "../service/projectService/ProjectService.ts";
import type { WorkflowExecutionLimits } from "../service/workflowExecution/WorkflowExecution.ts";
import type { WorkflowParameterDefinition } from "../../../shared/WorkflowParameter.ts";
import { WorkflowAuditService } from "../service/workflowAudit/WorkflowAuditService.ts";
import { SqliteWorkflowAuditRepository } from "../../infrastructure/audit/SqliteWorkflowAuditRepository.ts";

const agentId = (name: string): string => `.claude/agents/${name}.md`;
function response(items: string[], next: string[], threaded = false): AgentExecutionResult {
  return {
    answer: JSON.stringify({ status: "success", items: items.map((content) => ({ content })),
      isMultiSelectionAllowed: threaded, isMultiSelectionThreaded: threaded,
      nextAgentIds: next.map(agentId), notes: null }),
    sessionId: `session-${items.join("-")}`
  };
}

function fixture(
  graph: Record<string, string[]>,
  execute: (name: string, prompt: string, options: AgentExecutionOptions) => Promise<AgentExecutionResult>,
  limits: WorkflowExecutionLimits = {},
  repository = new SqliteWorkflowAuditRepository(":memory:"),
  parameters: WorkflowParameterDefinition[] = [],
  inputModes: Record<string, "separate" | "aggregate"> = {}
) {
  let configuration: AgentWorkflowConfiguration | null = null;
  const file = (name: string, relativePath: string, content: string) => ({
    type: "file" as const, name, relativePath, content, size: content.length, encoding: "utf8" as const
  });
  const content: ProjectContentOutput = {
    id: "project", directoryPath: process.cwd(), root: {
      type: "directory", name: "project", relativePath: "", children: [
        file("CLAUDE.md", "CLAUDE.md", "Execute the configured workflow."),
        { type: "directory", name: ".claude", relativePath: ".claude", children: [
          { type: "directory", name: "agents", relativePath: ".claude/agents", children:
            Object.keys(graph).map((name) => file(`${name}.md`, agentId(name),
              `---\nname: ${name}\ndescription: ${name}\n---\nTASK_${name}`)) }
        ] }
      ]
    }
  };
  const project = {
    getProjectContent: async () => content,
    getAgentWorkflowConfiguration: async () => configuration,
    saveAgentWorkflowConfiguration: async (_id: string, value: AgentWorkflowConfiguration) => { configuration = value; }
  } as unknown as ProjectUseCase;
  const service = {
    execute: async (_engine: string, prompt: string, options: AgentExecutionOptions) => {
      if (!options.persistSession) return { answer: JSON.stringify({ agents:
        Object.entries(graph).map(([name, next]) => ({ id: agentId(name), nextAgentIds: next.map(agentId), inputMode: inputModes[name] ?? "separate" })), parameters }) };
      const name = Object.keys(graph).find((candidate) => prompt.includes(`TASK_${candidate}`));
      assert.ok(name, "The task identifies its agent");
      return execute(name, prompt, options);
    }
  } as unknown as AgentService;
  return { repository, content, createUseCase: (storage = repository) =>
    new AgentUseCase(service, project, new WorkflowAuditService(storage), limits) };
}

test("independent entry points run together and their threaded flows join once", async () => {
  const graph = { agenda: ["analysis"], news: ["writer"], analysis: ["summary"], writer: ["summary"], summary: ["publisher"], publisher: [] };
  const startedRoots = new Set<string>();
  const completedWorkers: string[] = [];
  let rootPeak = 0;
  let activeRoots = 0;
  let summaryCount = 0;
  const f = fixture(graph, async (name, prompt) => {
    if (name === "agenda" || name === "news") {
      startedRoots.add(name);
      activeRoots++;
      rootPeak = Math.max(rootPeak, activeRoots);
      await new Promise(setImmediate);
      activeRoots--;
      return response([`${name}-one`, `${name}-two`], graph[name], true);
    }
    if (name === "analysis" || name === "writer") {
      assert.equal(startedRoots.size, 2);
      await new Promise(setImmediate);
      const item = /(?:agenda|news)-(?:one|two)/.exec(prompt)![0];
      completedWorkers.push(item);
      return response([`Enriched ${item}`], ["summary"]);
    }
    if (name === "summary") {
      summaryCount++;
      assert.equal(completedWorkers.length, 4);
      for (const item of completedWorkers) assert.ok(prompt.includes(`Enriched ${item}`));
    }
    return response([name], graph[name as keyof typeof graph]);
  }, {}, undefined, [], { summary: "aggregate" });
  try {
    const output = await f.createUseCase().runWorkflow("project");
    assert.equal(rootPeak, 2);
    assert.equal(summaryCount, 1);
    assert.deepEqual(output.executedAgentIds, ["agenda", "news", "analysis", "writer", "summary", "publisher"].map(agentId));
  } finally { f.repository.close(); }
});

test("parallel branches share the provider concurrency budget", async () => {
  const graph = { first: ["left"], second: ["right"], left: [], right: [] };
  let active = 0;
  let peak = 0;
  const f = fixture(graph, async (name) => {
    active++;
    peak = Math.max(peak, active);
    await new Promise(setImmediate);
    active--;
    return name === "first" || name === "second"
      ? response(["one", "two", "three"], graph[name], true)
      : response([name], []);
  }, { maxConcurrentInstances: 2 });
  try {
    await f.createUseCase().runWorkflow("project");
    assert.equal(peak, 2);
  } finally { f.repository.close(); }
});

test("a fast flow advances while the independent root is still running", async () => {
  let releaseSlowRoot!: () => void;
  let slowRootFinished = false;
  let analysisStarted = false;
  const slowRootGate = new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("The fast flow did not advance independently")), 2000);
    releaseSlowRoot = () => { clearTimeout(timeout); resolve(); };
  });
  const graph = { agenda: ["analysis"], news: ["writer"], analysis: ["summary"], writer: ["summary"], summary: [] };
  const f = fixture(graph, async (name) => {
    if (name === "news") {
      await slowRootGate;
      slowRootFinished = true;
    }
    if (name === "analysis") {
      analysisStarted = true;
      assert.equal(slowRootFinished, false);
      releaseSlowRoot();
    }
    if (name === "summary") {
      assert.equal(slowRootFinished, true);
      assert.equal(analysisStarted, true);
    }
    return response([name], graph[name as keyof typeof graph]);
  }, {}, undefined, [], { summary: "aggregate" });
  try {
    await f.createUseCase().runWorkflow("project");
    assert.equal(analysisStarted, true);
  } finally {
    releaseSlowRoot();
    f.repository.close();
  }
});

test("a failed root waits for its independent peer and resume preserves the peer result", async () => {
  let firstCalls = 0;
  let secondCalls = 0;
  const f = fixture({ first: ["join"], second: ["join"], join: [] }, async (name) => {
    if (name === "first" && ++firstCalls === 1) throw new Error("Root unavailable");
    if (name === "second") {
      secondCalls++;
      await new Promise(setImmediate);
    }
    return response([name], name === "join" ? [] : ["join"]);
  });
  try {
    const useCase = f.createUseCase();
    await assert.rejects(useCase.runWorkflow("project"), /Root unavailable/);
    assert.equal(useCase.hasActiveExecutions(), false);
    const project = await useCase.loadProject("project");
    assert.equal(project.agents.find((agent) => agent.id === agentId("second"))?.hasSession, true);
    await useCase.resumeWorkflow("project");
    assert.equal(firstCalls, 2);
    assert.equal(secondCalls, 1);
  } finally { f.repository.close(); }
});

test("cancellation stops both active roots and does not launch a queued root", async () => {
  let started = 0;
  let bothStarted!: () => void;
  const ready = new Promise<void>((resolve) => { bothStarted = resolve; });
  const f = fixture({ first: [], second: [], third: [] }, async (_name, _prompt, options) => {
    if (++started === 2) bothStarted();
    return new Promise((_resolve, reject) => {
      options.signal!.addEventListener("abort", () => reject(options.signal!.reason), { once: true });
    });
  }, { maxConcurrentInstances: 2 });
  try {
    const useCase = f.createUseCase();
    const run = useCase.runWorkflow("project");
    await ready;
    useCase.cancelProjectExecution("project");
    await assert.rejects(run, { name: "AbortError" });
    assert.equal(started, 2);
    assert.equal(useCase.hasActiveExecutions(), false);
    assert.equal(f.repository.listRuns("project", 20, 0).items[0].status, "cancelled");
  } finally { f.repository.close(); }
});

test("parallel roots cannot exceed the workflow execution budget", async () => {
  const calls: string[] = [];
  const f = fixture({ first: [], second: [], third: [] }, async (name) => {
    calls.push(name);
    return response([name], []);
  }, { maxWorkflowExecutions: 2 });
  try {
    await assert.rejects(f.createUseCase().runWorkflow("project"), /execution limit/);
    assert.deepEqual(calls, ["first", "second"]);
    assert.equal(f.repository.listRuns("project", 20, 0).items[0].agentExecutionCount, 2);
  } finally { f.repository.close(); }
});

test("automatic workflows follow feedback edges until the selected exit", async () => {
  let reviewCount = 0;
  const f = fixture({ entry: ["analysis"], analysis: ["review"], review: ["analysis"] }, async (name) =>
    response([`${name}-${reviewCount}`], name === "entry" ? ["analysis"] : name === "analysis" ? ["review"] : ++reviewCount === 1 ? ["analysis"] : []));
  try {
    const result = await f.createUseCase().runWorkflow("project");
    assert.deepEqual(result.executedAgentIds, ["entry", "analysis", "review", "analysis", "review"].map(agentId));
    assert.equal(f.repository.getRun("project", result.auditRunId!)?.status, "succeeded");
  } finally { f.repository.close(); }
});

test("an endless cycle fails at its execution budget", async () => {
  const f = fixture({ entry: ["loop"], loop: ["entry"] }, async (name) =>
    response([name], [name === "entry" ? "loop" : "entry"]), { maxWorkflowExecutions: 3 });
  try {
    await assert.rejects(f.createUseCase().runWorkflow("project"), /execution limit/);
    const run = f.repository.listRuns("project", 20, 0).items[0];
    assert.equal(run.status, "failed");
    assert.equal(run.agentExecutionCount, 3);
  } finally { f.repository.close(); }
});

test("a retry keeps completed instances and executes only the failed instance", async () => {
  let aCalls = 0, bCalls = 0;
  const f = fixture({ entry: ["worker"], worker: [] }, async (name, prompt) => {
    if (name === "entry") return response(["INPUT_A", "INPUT_B"], ["worker"], true);
    if (prompt.includes("INPUT_A")) { aCalls++; return response(["SUCCESS_A"], []); }
    if (++bCalls === 1) throw new Error("B unavailable");
    return response(["SUCCESS_B"], []);
  });
  try {
    const useCase = f.createUseCase();
    await useCase.loadProject("project");
    await useCase.runAgent("project", { agentId: agentId("entry") });
    const input = { agentId: agentId("worker"), upstreamAgentResults: [{ agentId: agentId("entry"), selectedItemIndexes: [0, 1] }] };
    await assert.rejects(useCase.runAgent("project", input), /B unavailable/);
    const partial = await useCase.loadProject("project");
    assert.equal(partial.agents[1].threads.length, 1);
    assert.match(partial.agents[1].conversation[0].content, /SUCCESS_A/);
    const result = await useCase.runAgent("project", input);
    assert.equal(result.threads.length, 2);
    assert.equal(aCalls, 1);
    assert.equal(bCalls, 2);
  } finally { f.repository.close(); }
});

test("cancellation aborts active providers, skips queued instances and audits cancellation", async () => {
  let providerStarted!: () => void;
  const started = new Promise<void>((resolve) => { providerStarted = resolve; });
  let workerCalls = 0;
  const f = fixture({ entry: ["worker"], worker: [] }, async (name, _prompt, options) => {
    if (name === "entry") return response(["A", "B", "C"], ["worker"], true);
    workerCalls++;
    options.onProgress?.("Reading project files");
    options.onProgress?.("");
    providerStarted();
    return new Promise((_resolve, reject) => options.signal!.addEventListener("abort", () => reject(options.signal!.reason), { once: true }));
  }, { maxConcurrentInstances: 1 });
  try {
    const useCase = f.createUseCase();
    const run = useCase.runWorkflow("project");
    await started;
    const active = await useCase.loadProject("project");
    assert.ok(active.agents[1].executionStartedAt);
    assert.ok(active.agents[1].executionLastActivityAt);
    assert.equal(active.agents[1].executionProgress, "Reading project files");
    assert.equal(useCase.hasActiveExecutions(), true);
    await assert.rejects(useCase.runAgent("project", { agentId: agentId("entry") }), /complete workflow is already running/);
    assert.equal(useCase.cancelProjectExecution("project"), true);
    await assert.rejects(run, { name: "AbortError" });
    assert.equal(workerCalls, 1);
    assert.equal(useCase.isProjectRunning("project"), false);
    assert.equal(useCase.cancelProjectExecution("project"), false);
    assert.equal(useCase.hasActiveExecutions(), false);
    assert.equal(f.repository.listRuns("project", 20, 0).items[0].status, "cancelled");
    const latest = await useCase.loadProject("project");
    assert.equal(latest.agents[1].executionStatus, "cancelled");
  } finally { f.repository.close(); }
});

test("fan-out respects its concurrency limit", async () => {
  let active = 0, peak = 0;
  const f = fixture({ entry: ["worker"], worker: [] }, async (name) => {
    if (name === "entry") return response(["A", "B", "C", "D", "E"], ["worker"], true);
    active++;
    peak = Math.max(peak, active);
    await new Promise(setImmediate);
    active--;
    return response(["done"], []);
  }, { maxConcurrentInstances: 2 });
  try {
    await f.createUseCase().runWorkflow("project");
    assert.equal(peak, 2);
  } finally { f.repository.close(); }
});

test("restart restores successful instances and resumes only unfinished work on explicit request", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cortex-resume-"));
  const databaseFile = path.join(directory, "audit.sqlite");
  const firstRepository = new SqliteWorkflowAuditRepository(databaseFile);
  let entryCalls = 0, aCalls = 0, bCalls = 0;
  const f = fixture({ entry: ["worker"], worker: [] }, async (name, prompt) => {
    if (name === "entry") { entryCalls++; return response(["INPUT_A", "INPUT_B"], ["worker"], true); }
    if (prompt.includes("INPUT_A")) { aCalls++; return response(["SUCCESS_A"], []); }
    if (++bCalls === 1) throw new Error("B unavailable");
    return response(["SUCCESS_B"], []);
  }, {}, firstRepository);
  let secondRepository: SqliteWorkflowAuditRepository | undefined;
  try {
    await assert.rejects(f.createUseCase().runWorkflow("project"), /B unavailable/);
    firstRepository.close();
    secondRepository = new SqliteWorkflowAuditRepository(databaseFile);
    const restarted = f.createUseCase(secondRepository);
    const restored = await restarted.loadProject("project");
    assert.equal(restored.workflowResumable, true);
    assert.equal(restored.agents[1].threads.length, 1);
    assert.deepEqual([entryCalls, aCalls, bCalls], [1, 1, 1], "Loading never replays work");
    const resumed = await restarted.resumeWorkflow("project");
    assert.deepEqual(resumed.executedAgentIds, [agentId("worker")]);
    assert.deepEqual([entryCalls, aCalls, bCalls], [1, 1, 2]);
    assert.equal((await restarted.loadProject("project")).workflowResumable, false);
  } finally {
    if (secondRepository) secondRepository.close();
    else firstRepository.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("changed workflow instructions invalidate checkpoints", async () => {
  const f = fixture({ entry: ["worker"], worker: [] }, async () => {
    throw new Error("Paused");
  });
  try {
    await assert.rejects(f.createUseCase().runWorkflow("project"), /Paused/);
    assert.ok(f.repository.getCheckpoint("project"));
    const instructions = f.content.root.children[0];
    assert.equal(instructions.type, "file");
    if (instructions.type === "file") instructions.content += " Changed instructions.";
    const reloaded = await f.createUseCase().loadProject("project");
    assert.equal(reloaded.workflowResumable, false);
    assert.equal(reloaded.agents[0].executionStatus, "idle");
    assert.equal(f.repository.getCheckpoint("project"), null);
  } finally { f.repository.close(); }
});

test("retrying a failed rerun still executes its existing session", async () => {
  let workerCalls = 0;
  const f = fixture({ entry: ["worker"], worker: [] }, async (name) => {
    if (name === "entry") return response(["INPUT"], ["worker"]);
    if (++workerCalls === 2) throw new Error("Rerun failed");
    return response(["DONE"], []);
  });
  try {
    const useCase = f.createUseCase();
    await useCase.runWorkflow("project");
    const input = { agentId: agentId("worker"), upstreamAgentResults: [{ agentId: agentId("entry"), selectedItemIndexes: [] }] };
    await assert.rejects(useCase.runAgent("project", input), /Rerun failed/);
    await useCase.runAgent("project", input);
    assert.equal(workerCalls, 3);
  } finally { f.repository.close(); }
});

test("restored workflow parameters are visible and cannot change during resume", async () => {
  const repository = new SqliteWorkflowAuditRepository(":memory:");
  let workerCalls = 0;
  const f = fixture({ entry: ["worker"], worker: [] }, async (name, prompt) => {
    assert.match(prompt, /Saturn/);
    if (name === "entry") return response(["input"], ["worker"]);
    if (++workerCalls === 1) throw new Error("Temporary failure");
    return response(["done"], []);
  }, {}, repository, [{ id: "subject", label: "Subject", description: "", required: true,
    inputType: "text", placeholder: "", options: [] }]);
  try {
    await assert.rejects(f.createUseCase().runWorkflow("project", { subject: "Saturn" }), /Temporary failure/);
    const restarted = f.createUseCase();
    assert.deepEqual((await restarted.loadProject("project")).workflowParameterValues, { subject: "Saturn" });
    await assert.rejects(restarted.resumeWorkflow("project", { subject: "Mars" }), /parameters cannot change/);
    await restarted.resumeWorkflow("project");
    assert.equal(workerCalls, 2);
  } finally { repository.close(); }
});

test("checkpoint write failures release execution controllers and project locks", async (t) => {
  let providerCalls = 0;
  const f = fixture({ entry: [] }, async () => { providerCalls++; return response(["done"], []); });
  t.mock.method(f.repository, "saveCheckpoint", () => { throw new Error("Disk full"); });
  try {
    const useCase = f.createUseCase();
    await assert.rejects(useCase.runWorkflow("project"), /Disk full/);
    assert.equal(providerCalls, 0);
    assert.equal(useCase.hasActiveExecutions(), false);
    assert.equal(useCase.isProjectRunning("project"), false);
  } finally { f.repository.close(); }
});
