import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { SqliteWorkflowAuditRepository } from "./SqliteWorkflowAuditRepository.ts";

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
