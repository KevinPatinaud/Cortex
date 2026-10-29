import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import Database from "better-sqlite3";
import { SqliteWorkflowAuditRepository } from "./SqliteWorkflowAuditRepository.ts";
import { WorkflowAuditService } from "../../application/service/workflowAudit/WorkflowAuditService.ts";

test("trace pages survive interruption and restart, stay scoped, and follow insertion order even at equal timestamps", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cortex-trace-"));
  const file = path.join(directory, "audit.sqlite");
  let repository = new SqliteWorkflowAuditRepository(file, () => new Date("2026-10-29T10:00:00Z"));
  try {
    const audit = new WorkflowAuditService(repository);
    const runId = audit.createRun({ projectId: "p", trigger: "manual", scope: "workflow", parameterValues: {}, workflowSnapshot: null });
    const executionId = audit.startExecution({ runId, agentId: "a", agentName: "A", threadId: "t", engine: "codex",
      input: { workflowParameterValues: {}, additionalInstructions: "", upstreamItems: [] }, prompt: "task" });
    for (let index = 0; index < 205; index++) audit.recordExecutionTrace(runId, executionId, { kind: "message", content: `Message ${index}` });
    audit.recordExecutionTrace(runId, executionId, { kind: "message", content: " " });
    audit.recordExecutionUsage(executionId, "mission", { inputTokens: 100, outputTokens: 20, totalTokens: 120 });
    audit.recordExecutionUsage(executionId, "mission", { inputTokens: 30, outputTokens: 10, totalTokens: 40 });
    audit.recordExecutionUsage(executionId, "interpretation", { inputTokens: 5, outputTokens: 2, totalTokens: 7 });
    const first = repository.getExecutionTrace("p", runId, executionId, 0, 100)!;
    assert.equal(first.items.length, 100);
    assert.equal(first.items[0].content, "Message 0");
    assert.notEqual(first.nextAfterId, null);
    assert.equal(repository.getExecutionTrace("other-project", runId, executionId, 0, 100), null);
    assert.equal(repository.getExecutionTrace("p", "other-run", executionId, 0, 100), null);
    repository.close();
    repository = new SqliteWorkflowAuditRepository(file);
    assert.equal(repository.getRun("p", runId)?.executions[0].status, "interrupted");
    const usage = repository.getRun("p", runId)?.executions[0].usage;
    assert.equal(usage?.mission?.totalTokens, 160);
    assert.equal(usage?.interpretation?.totalTokens, 7);
    assert.equal(usage?.total.totalTokens, 167);
    const second = repository.getExecutionTrace("p", runId, executionId, first.nextAfterId!, 100)!;
    const last = repository.getExecutionTrace("p", runId, executionId, second.nextAfterId!, 100)!;
    assert.equal(last.nextAfterId, null);
    assert.equal(last.items.length, 5);
    assert.equal(last.items.at(-1)!.content, "Message 204");
    assert.equal(new Set([...first.items, ...second.items, ...last.items].map(item => item.id)).size, 205);
  } finally { repository.close(); await rm(directory, { recursive: true, force: true }); }
});

test("partial attempts affect run outcome until that same thread is actually completed", () => {
  const repository = new SqliteWorkflowAuditRepository(":memory:");
  try {
    const runId = repository.createRun({ projectId: "p", trigger: "manual", scope: "workflow", parameterValues: {}, workflowSnapshot: null });
    const attempt = () => repository.startExecution({ runId, agentId: "a", agentName: "a", threadId: "same-thread", engine: "codex",
      input: { workflowParameterValues: {}, additionalInstructions: "", upstreamItems: [] }, prompt: "task" });
    repository.completeExecution(attempt(), { response: JSON.stringify({ status: "partial" }), nextAgentIds: [] });
    repository.completeRun(runId, "succeeded");
    assert.equal(repository.getRun("p", runId)?.status, "partial");
    repository.completeExecution(attempt(), { response: JSON.stringify({ status: "success" }), nextAgentIds: [] });
    repository.completeRun(runId, "succeeded");
    assert.equal(repository.getRun("p", runId)?.status, "succeeded");
  } finally { repository.close(); }
});

test("persists a complete workflow audit with its exact prompt", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cortex-audit-"));
  let now = new Date("2026-08-29T10:00:00.000Z");
  const repository = new SqliteWorkflowAuditRepository(
    path.join(directory, "audit.sqlite"),
    () => now
  );

  try {
    const runId = repository.createRun({
      projectId: "project-1",
      trigger: "manual",
      scope: "workflow",
      parameterValues: { subject: "Saturne" },
      workflowSnapshot: {
        engine: "codex",
        instructions: "Project instructions",
        agents: [{
          id: "writer",
          name: "Writer",
          description: "Writes",
          nextAgentIds: [],
          inputMode: "aggregate",
          prompt: "Write"
        }]
      }
    });
    const executionId = repository.startExecution({
      runId,
      agentId: "writer",
      agentName: "Writer",
      threadId: "thread-1",
      engine: "codex",
      model: "gpt-test",
      reasoningEffort: "high",
      input: {
        workflowParameterValues: { subject: "Saturne" },
        additionalInstructions: "Be concise",
        upstreamItems: []
      },
      prompt: "The exact effective prompt"
    });

    now = new Date("2026-08-29T10:00:02.000Z");
    repository.completeExecution(executionId, {
      response: "The raw response",
      nextAgentIds: [],
      sessionId: "session-1"
    });
    repository.completeRun(runId, "succeeded");

    const page = repository.listRuns("project-1", 20, 0);
    const detail = repository.getRun("project-1", runId);

    assert.equal(page.total, 1);
    assert.equal(page.items[0].status, "succeeded");
    assert.equal(page.items[0].scope, "workflow");
    assert.equal(page.items[0].durationMs, 2000);
    assert.equal(page.items[0].agentExecutionCount, 1);
    assert.equal(detail?.parameterValues.subject, "Saturne");
    assert.equal(detail?.executions[0].prompt, "The exact effective prompt");
    assert.equal(detail?.executions[0].response, "The raw response");
    assert.equal(detail?.executions[0].sessionId, "session-1");
  } finally {
    repository.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("marks unfinished runs and executions as interrupted on restart", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cortex-audit-"));
  const databaseFile = path.join(directory, "audit.sqlite");
  const startedAt = new Date("2026-08-29T10:00:00.000Z");
  const firstRepository = new SqliteWorkflowAuditRepository(
    databaseFile,
    () => startedAt
  );
  const runId = firstRepository.createRun({
    projectId: "project-1",
    trigger: "scheduled",
    scope: "workflow",
    parameterValues: {},
    workflowSnapshot: null
  });
  firstRepository.startExecution({
    runId,
    agentId: "agent-1",
    agentName: "Agent",
    threadId: "thread-1",
    engine: "claude",
    input: {
      workflowParameterValues: {},
      additionalInstructions: "",
      upstreamItems: []
    },
    prompt: "Prompt"
  });
  firstRepository.close();

  const secondRepository = new SqliteWorkflowAuditRepository(
    databaseFile,
    () => new Date("2026-08-29T10:01:00.000Z")
  );

  try {
    const detail = secondRepository.getRun("project-1", runId);
    assert.equal(detail?.status, "interrupted");
    assert.equal(detail?.executions[0].status, "interrupted");
    assert.equal(detail?.durationMs, 60_000);
  } finally {
    secondRepository.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("filters complete workflows and individual agent executions", () => {
  const repository = new SqliteWorkflowAuditRepository(":memory:");

  try {
    const workflowRunId = repository.createRun({
      projectId: "project-1",
      trigger: "scheduled",
      scope: "workflow",
      parameterValues: {},
      workflowSnapshot: null
    });
    repository.completeRun(workflowRunId, "succeeded");

    const agentRunId = repository.createRun({
      projectId: "project-1",
      trigger: "manual",
      scope: "agent",
      parameterValues: {},
      workflowSnapshot: null
    });
    repository.completeRun(agentRunId, "succeeded");

    const workflows = repository.listRuns("project-1", 20, 0, "workflow");
    const agents = repository.listRuns("project-1", 20, 0, "agent");

    assert.equal(workflows.total, 1);
    assert.equal(workflows.items[0].id, workflowRunId);
    assert.equal(workflows.items[0].scope, "workflow");
    assert.equal(agents.total, 1);
    assert.equal(agents.items[0].id, agentRunId);
    assert.equal(agents.items[0].scope, "agent");
  } finally {
    repository.close();
  }
});

test("audit order follows insertion sequence even when timestamps tie or the clock moves backwards", () => {
  let now = new Date("2026-09-06T10:00:00Z");
  const repository = new SqliteWorkflowAuditRepository(":memory:", () => now);
  const input = { projectId: "project", trigger: "manual" as const, scope: "workflow" as const, parameterValues: {}, workflowSnapshot: null };
  try {
    const firstRun = repository.createRun(input);
    const ids: string[] = [];
    for (let index = 0; index < 30; index++) {
      ids.push(repository.startExecution({ runId: firstRun, agentId: `agent-${index}`, agentName: "Agent",
        threadId: "thread", engine: "codex", input: { workflowParameterValues: {}, additionalInstructions: "", upstreamItems: [] }, prompt: `Prompt ${index}` }));
      if (index === 15) now = new Date("2026-09-06T09:59:00Z");
    }
    const secondRun = repository.createRun(input);
    assert.deepEqual(repository.getRun("project", firstRun)?.executions.map((execution) => execution.id), ids);
    assert.deepEqual(repository.listRuns("project", 20, 0).items.map((run) => run.id), [secondRun, firstRun]);
  } finally { repository.close(); }
});

test("scheduled occurrence claims are unique and retain interrupted state after restart", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cortex-occurrence-"));
  const databaseFile = path.join(directory, "audit.sqlite");
  const occurrence = "2026-09-06T10:00:00Z";
  const first = new SqliteWorkflowAuditRepository(databaseFile);
  assert.equal(first.claimScheduledOccurrence("project", occurrence), true);
  assert.equal(first.claimScheduledOccurrence("project", occurrence), false);
  assert.equal(first.claimScheduledOccurrence("queued-project", occurrence), true);
  first.completeScheduledOccurrence("queued-project", occurrence, "queued");
  first.close();
  const second = new SqliteWorkflowAuditRepository(databaseFile);
  try {
    assert.equal(second.claimScheduledOccurrence("project", occurrence), false);
    assert.equal(second.getLatestScheduledOccurrence("project")?.status, "interrupted");
    assert.equal(second.getLatestScheduledOccurrence("queued-project")?.status, "interrupted");
    assert.equal(second.claimScheduledOccurrence("queued-project", occurrence), false);
    assert.equal(second.claimScheduledOccurrence("other-project", occurrence), true);
  } finally {
    second.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("legacy audit databases migrate their insertion order without losing history", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cortex-audit-migration-"));
  const databaseFile = path.join(directory, "audit.sqlite");
  const input = { projectId: "project", trigger: "manual" as const, scope: "workflow" as const, parameterValues: {}, workflowSnapshot: null };
  const original = new SqliteWorkflowAuditRepository(databaseFile);
  const firstId = original.createRun(input);
  original.completeRun(firstId, "succeeded");
  original.close();
  const legacy = new Database(databaseFile);
  legacy.exec(`
    DROP INDEX workflow_runs_sequence_idx;
    DROP INDEX agent_executions_sequence_idx;
    ALTER TABLE workflow_runs DROP COLUMN sequence;
    ALTER TABLE agent_executions DROP COLUMN sequence;
  `);
  legacy.close();
  const migrated = new SqliteWorkflowAuditRepository(databaseFile);
  try {
    const nextId = migrated.createRun(input);
    assert.deepEqual(migrated.listRuns("project", 20, 0).items.map((run) => run.id), [nextId, firstId]);
    assert.equal(migrated.getRun("project", firstId)?.status, "succeeded");
  } finally {
    migrated.close();
    await rm(directory, { recursive: true, force: true });
  }
});
