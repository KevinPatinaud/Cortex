import assert from "node:assert/strict";
import test from "node:test";
import type { AgentUseCase } from "../../usecase/AgentUseCase.ts";
import type { ProjectUseCase } from "../../usecase/ProjectUseCase.ts";
import { WorkflowScheduler } from "./WorkflowScheduler.ts";
import { WorkflowAuditService } from "../workflowAudit/WorkflowAuditService.ts";
import { SqliteWorkflowAuditRepository } from "../../../infrastructure/audit/SqliteWorkflowAuditRepository.ts";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { serverTimezone } from "./CronExpression.ts";
import type { WorkflowScheduleConfiguration } from "../projectService/ProjectService.ts";
import { CodexQuotaBlockedError } from "../../error/CodexQuotaBlockedError.ts";
import { ExecutionWorkspaceBusyError } from "../executionWorkspace/ExecutionWorkspaceGuard.ts";

test("Work Force skips normal occurrences without probing quotas or changing schedules, then resumes without catch-up", async () => {
  let suspended = true, calls = 0;
  const now = new Date("2026-10-28T10:00:05Z"), repository = new SqliteWorkflowAuditRepository(":memory:");
  const configuration = { cron: "* * * * *", timezone: "UTC", enabled: true, parameterValues: { retained: "yes" } };
  const projects = { getProjects: async () => [{ id: "normal" }], getWorkflowScheduleConfiguration: async () => configuration,
    saveWorkflowScheduleConfiguration: async () => assert.fail("Schedule was changed") } as unknown as ProjectUseCase;
  const agents = { isProjectRunning: () => false, runWorkflow: async () => { calls++; } } as unknown as AgentUseCase;
  const scheduler = new WorkflowScheduler(projects, agents, () => now, new WorkflowAuditService(repository), () => suspended);
  try {
    await scheduler.start(); await new Promise(setImmediate);
    assert.equal(calls, 0);
    const skipped = await scheduler.getSchedule("normal");
    assert.equal(skipped.lastRunStatus, "skipped"); assert.match(skipped.lastRunError!, /Work Force/);
    assert.equal(skipped.enabled, true); assert.deepEqual(skipped.parameterValues, { retained: "yes" });
    suspended = false;
    scheduler.checkDueSchedules(now); await new Promise(setImmediate);
    assert.equal(calls, 0);
    scheduler.checkDueSchedules(new Date(now.getTime()+60000)); await new Promise(setImmediate);
    assert.equal(calls, 1); assert.equal((await scheduler.getSchedule("normal")).lastRunStatus, "succeeded");
  } finally { scheduler.stop(); repository.close(); }
});

test("a slot recovers only previously started work, never launches its own new task afterwards", async () => {
  const now = new Date("2026-10-23T20:50:00Z");
  const calls: string[] = [];
  const repository = new SqliteWorkflowAuditRepository(":memory:");
  const projects = {
    getProjects: async () => [{ id: "new" }, { id: "old" }],
    getWorkflowScheduleConfiguration: async (id: string) => ({ cron: "50 20 * * *", timezone: "UTC", enabled: id === "new", parameterValues: {} })
  } as unknown as ProjectUseCase;
  const agents = {
    isProjectRunning: () => false,
    getRecoveryProjectId: async () => "old",
    runWorkflow: async (id: string) => { calls.push(id); throw new CodexQuotaBlockedError("quota unchanged"); }
  } as unknown as AgentUseCase;
  const scheduler = new WorkflowScheduler(projects, agents, () => now, new WorkflowAuditService(repository));
  try {
    await scheduler.start();
    await new Promise(setImmediate);
    assert.deepEqual(calls, ["old"]);
    assert.equal((await scheduler.getSchedule("new")).lastRunStatus, "skipped");
    assert.match((await scheduler.getSchedule("new")).lastRunError!, /quota unchanged/);
    assert.match(repository.listRuns("new", 10, 0).items[0].error!, /quota unchanged/);
    scheduler.checkDueSchedules(now);
    scheduler.checkDueSchedules(new Date(now.getTime() + 60_000));
    await new Promise(setImmediate);
    assert.deepEqual(calls, ["old"]);
  } finally { scheduler.stop(); repository.close(); }
});

test("a busy shared checkout skips the scheduled task and records the reason without retrying", async () => {
  const now = new Date("2026-10-23T20:50:00Z");
  const repository = new SqliteWorkflowAuditRepository(":memory:");
  let calls = 0;
  const projects = {
    getProjects: async () => [{ id: "site" }],
    getWorkflowScheduleConfiguration: async () => ({ cron: "50 20 * * *", timezone: "UTC", enabled: true, parameterValues: {} })
  } as unknown as ProjectUseCase;
  const agents = { isProjectRunning: () => false, runWorkflow: async () => { calls++; throw new ExecutionWorkspaceBusyError("busy site"); } } as unknown as AgentUseCase;
  const scheduler = new WorkflowScheduler(projects, agents, () => now, new WorkflowAuditService(repository));
  try {
    await scheduler.start();
    await new Promise(setImmediate);
    assert.equal((await scheduler.getSchedule("site")).lastRunStatus, "skipped");
    assert.equal(repository.listRuns("site", 10, 0).items[0].status, "skipped");
    scheduler.checkDueSchedules(new Date(now.getTime() + 60_000));
    assert.equal(calls, 1);
  } finally { scheduler.stop(); repository.close(); }
});

test("quota-denied cron occurrences are skipped with an explanation and the next occurrence can run", async () => {
  let blocked = true;
  const now = new Date("2026-10-19T10:00:05Z");
  const repository = new SqliteWorkflowAuditRepository(":memory:");
  const projects = {
    getProjects: async () => [{ id: "project" }],
    getWorkflowScheduleConfiguration: async () => ({ cron: "* * * * *", enabled: true, parameterValues: {} })
  } as unknown as ProjectUseCase;
  const agents = {
    isProjectRunning: () => false,
    runWorkflow: async () => { if (blocked) throw new CodexQuotaBlockedError("5 h : 49 % restants, minimum 50 %"); }
  } as unknown as AgentUseCase;
  const scheduler = new WorkflowScheduler(projects, agents, () => now, new WorkflowAuditService(repository));
  try {
    await scheduler.start();
    await new Promise(setImmediate);
    const skipped = await scheduler.getSchedule("project");
    assert.equal(skipped.lastRunStatus, "skipped");
    assert.match(skipped.lastRunError!, /49 %/);
    blocked = false;
    scheduler.checkDueSchedules(new Date(now.getTime() + 60_000));
    await new Promise(setImmediate);
    assert.equal((await scheduler.getSchedule("project")).lastRunStatus, "succeeded");
  } finally { scheduler.stop(); repository.close(); }
});

test("persists the timezone, previews without mutation, and executes in that timezone after restart", async () => {
  let stored: WorkflowScheduleConfiguration | null = null;
  let runs = 0;
  let now = new Date("2026-09-07T06:59:00Z");
  const projects = {
    getProjects: async () => [{ id: "project" }],
    getWorkflowScheduleConfiguration: async () => stored,
    saveWorkflowScheduleConfiguration: async (_id: string, value: WorkflowScheduleConfiguration) => { stored = value; }
  } as unknown as ProjectUseCase;
  const agents = {
    validateWorkflowParameterValues: async () => ({}),
    isProjectRunning: () => false,
    runWorkflow: async () => { runs++; }
  } as unknown as AgentUseCase;
  let scheduler = new WorkflowScheduler(projects, agents, () => now);
  assert.equal((await scheduler.getSchedule("project")).configured, false);
  const preview = await scheduler.previewSchedule("project", { cron: "0 9 * * *", timezone: "Europe/Paris" });
  assert.equal(preview.nextRuns[0], "2026-09-07T07:00:00.000Z");
  assert.equal(stored, null);
  await scheduler.saveSchedule("project", { cron: "0 9 * * *", timezone: "Europe/Paris", enabled: true });
  assert.equal((stored as unknown as WorkflowScheduleConfiguration).timezone, "Europe/Paris");
  await assert.rejects(scheduler.saveSchedule("project", { cron: "0 10 * * *", timezone: "Invalid/Zone", enabled: true }));
  assert.equal((stored as unknown as WorkflowScheduleConfiguration).cron, "0 9 * * *");
  scheduler = new WorkflowScheduler(projects, agents, () => now);
  try {
    await scheduler.start();
    assert.equal((await scheduler.getSchedule("project")).configured, true);
    now = new Date(preview.nextRuns[0]);
    scheduler.checkDueSchedules(now);
    await new Promise(setImmediate);
    assert.equal(runs, 1);
    // An older client omitting the timezone must preserve the configured zone.
    assert.equal((await scheduler.saveSchedule("project", { cron: "0 10 * * *", enabled: false })).timezone, "Europe/Paris");
  } finally { scheduler.stop(); }
  stored = { cron: "0 9 * * *", enabled: false, parameterValues: {} };
  const legacy = await new WorkflowScheduler(projects, agents, () => now).getSchedule("project");
  assert.equal(legacy.timezone, serverTimezone());
  assert.equal(legacy.configured, true);
});

test("déclenche une seule exécution par minute correspondante", async () => {
  const schedules = new Map<string, {
    cron: string;
    enabled: boolean;
    parameterValues: Record<string, string>;
  }>();
  let runCount = 0;
  let lastParameterValues: unknown;
  const projectUseCase = {
    async getProjects() {
      return [{ id: "project-id", directoryPath: "C:\\project" }];
    },
    async getWorkflowScheduleConfiguration(projectId: string) {
      return schedules.get(projectId) ?? null;
    },
    async saveWorkflowScheduleConfiguration(
      projectId: string,
      schedule: {
        cron: string;
        enabled: boolean;
        parameterValues: Record<string, string>;
      }
    ) {
      schedules.set(projectId, schedule);
    }
  } as unknown as ProjectUseCase;
  const agentUseCase = {
    isProjectRunning: () => false,
    async validateWorkflowParameterValues(_projectId: string, value: unknown) {
      return value as Record<string, string>;
    },
    async runWorkflow(_projectId: string, parameterValues: unknown) {
      runCount += 1;
      lastParameterValues = parameterValues;
      return { executedAgentIds: ["agent"], skippedAgentIds: [] };
    }
  } as unknown as AgentUseCase;
  const now = new Date(2026, 7, 14, 10, 0, 5);
  const scheduler = new WorkflowScheduler(projectUseCase, agentUseCase, () => now);

  await scheduler.saveSchedule("project-id", {
    cron: "* * * * *",
    enabled: true,
    parameterValues: { target: "20" }
  });
  scheduler.checkDueSchedules(now);
  scheduler.checkDueSchedules(new Date(2026, 7, 14, 10, 0, 50));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(runCount, 1);
  assert.deepEqual(lastParameterValues, { target: "20" });
  assert.equal(
    (await scheduler.getSchedule("project-id")).lastRunStatus,
    "succeeded"
  );

  scheduler.checkDueSchedules(new Date(2026, 7, 14, 10, 1, 0));
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(runCount, 2);
});

test("saute une occurrence lorsqu'une exécution est déjà active", async () => {
  const projectUseCase = {
    async getProjects() {
      return [{ id: "project-id", directoryPath: "C:\\project" }];
    },
    async getWorkflowScheduleConfiguration() {
      return null;
    },
    async saveWorkflowScheduleConfiguration() {}
  } as unknown as ProjectUseCase;
  const agentUseCase = {
    isProjectRunning: () => true,
    async validateWorkflowParameterValues() {
      return {};
    },
    async runWorkflow() {
      throw new Error("ne doit pas être appelé");
    }
  } as unknown as AgentUseCase;
  const now = new Date(2026, 7, 14, 10, 0, 0);
  const scheduler = new WorkflowScheduler(projectUseCase, agentUseCase, () => now);

  await scheduler.saveSchedule("project-id", {
    cron: "* * * * *",
    enabled: true
  });
  scheduler.checkDueSchedules(now);
  const state = await scheduler.getSchedule("project-id");

  assert.equal(state.lastRunStatus, "skipped");
  assert.match(state.lastRunError ?? "", /still running/);
});

test("saving an unchanged schedule and restarting do not replay the same occurrence", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cortex-schedule-"));
  const databaseFile = path.join(directory, "audit.sqlite");
  const now = new Date("2026-09-06T10:00:05Z");
  let schedule = { cron: "* * * * *", crons: ["* * * * *", "* * * * 0-6"], enabled: true, parameterValues: {} };
  let runCount = 0;
  const projectUseCase = {
    getProjects: async () => [{ id: "project", directoryPath: directory }],
    getWorkflowScheduleConfiguration: async () => schedule,
    saveWorkflowScheduleConfiguration: async (_id: string, value: typeof schedule) => { schedule = value; }
  } as unknown as ProjectUseCase;
  const agentUseCase = {
    isProjectRunning: () => false,
    validateWorkflowParameterValues: async () => ({}),
    runWorkflow: async () => { runCount++; }
  } as unknown as AgentUseCase;
  let repository = new SqliteWorkflowAuditRepository(databaseFile);
  let scheduler = new WorkflowScheduler(projectUseCase, agentUseCase, () => now, new WorkflowAuditService(repository));
  try {
    await scheduler.start();
    await new Promise(setImmediate);
    await scheduler.saveSchedule("project", schedule);
    scheduler.checkDueSchedules(now);
    await new Promise(setImmediate);
    assert.equal(runCount, 1);
    scheduler.stop();
    repository.close();
    repository = new SqliteWorkflowAuditRepository(databaseFile);
    scheduler = new WorkflowScheduler(projectUseCase, agentUseCase, () => now, new WorkflowAuditService(repository));
    await scheduler.start();
    await new Promise(setImmediate);
    assert.equal(runCount, 1);
    assert.equal((await scheduler.getSchedule("project")).lastRunStatus, "succeeded");
    scheduler.checkDueSchedules(new Date("2026-09-06T10:01:05Z"));
    await new Promise(setImmediate);
    assert.equal(runCount, 2);
  } finally {
    scheduler.stop();
    repository.close();
    await rm(directory, { recursive: true, force: true });
  }
});

test("a failed initialization can be started again", async () => {
  let attempts = 0;
  const projectUseCase = { getProjects: async () => {
    if (++attempts === 1) throw new Error("Temporary read failure");
    return [];
  } } as unknown as ProjectUseCase;
  const scheduler = new WorkflowScheduler(projectUseCase, {} as AgentUseCase);
  try {
    await assert.rejects(scheduler.start(), /Temporary read failure/);
    await scheduler.start();
    assert.equal(attempts, 2);
  } finally { scheduler.stop(); }
});

test("multiple crons survive restart, run at either time and coalesce overlapping occurrences", async () => {
  let stored: WorkflowScheduleConfiguration | null = null;
  let running = false;
  let runs = 0;
  const projects = {
    getProjects: async () => [{ id: "project" }],
    getWorkflowScheduleConfiguration: async () => stored,
    saveWorkflowScheduleConfiguration: async (_id: string, value: WorkflowScheduleConfiguration) => { stored = value; }
  } as unknown as ProjectUseCase;
  const agents = {
    validateWorkflowParameterValues: async () => ({ period: "today" }),
    isProjectRunning: () => running,
    runWorkflow: async (_id: string, values: unknown) => { assert.deepEqual(values, { period: "today" }); runs++; }
  } as unknown as AgentUseCase;
  const now = () => new Date("2026-10-19T08:59:00Z");
  let scheduler = new WorkflowScheduler(projects, agents, now);
  const saved = await scheduler.saveSchedule("project", {
    crons: ["0 18 * * 1-5", " 0  9 * * * ", "0 9 * * 1-5", "0 9 * * *"],
    timezone: "UTC", enabled: true
  });
  assert.deepEqual(saved.crons, ["0 18 * * 1-5", "0 9 * * *", "0 9 * * 1-5"]);
  assert.equal(saved.cron, "0 18 * * 1-5");
  assert.equal(saved.nextRunAt, "2026-10-19T09:00:00.000Z");
  // The output must not expose the scheduler's mutable list.
  saved.crons.push("* * * * *");
  assert.equal((await scheduler.getSchedule("project")).crons.length, 3);
  scheduler = new WorkflowScheduler(projects, agents, now);
  try {
    await scheduler.start();
    assert.equal((await scheduler.getSchedule("project")).crons.length, 3);
    scheduler.checkDueSchedules(new Date("2026-10-19T09:00:00Z"));
    await new Promise(setImmediate);
    scheduler.checkDueSchedules(new Date("2026-10-19T09:00:45Z"));
    scheduler.checkDueSchedules(new Date("2026-10-19T10:00:00Z"));
    await new Promise(setImmediate);
    assert.equal(runs, 1);
    scheduler.checkDueSchedules(new Date("2026-10-19T18:00:00Z"));
    await new Promise(setImmediate);
    assert.equal(runs, 2);
    running = true;
    scheduler.checkDueSchedules(new Date("2026-10-20T18:00:00Z"));
    await new Promise(setImmediate);
    assert.equal(runs, 2);
    assert.equal((await scheduler.getSchedule("project")).lastRunStatus, "skipped");
    running = false;
    // Legacy saves change the first expression and retain all additional ones.
    const disabled = await scheduler.saveSchedule("project", { cron: "0 19 * * *", enabled: false });
    assert.deepEqual(disabled.crons, ["0 19 * * *", "0 9 * * *", "0 9 * * 1-5"]);
    assert.equal(disabled.nextRunAt, null);
    scheduler.checkDueSchedules(new Date("2026-10-21T09:00:00Z"));
    await new Promise(setImmediate);
    assert.equal(runs, 2);
  } finally { scheduler.stop(); }
});

test("invalid cron lists never partially replace a project's existing schedule", async () => {
  let stored: WorkflowScheduleConfiguration | null = null;
  const projects = {
    getProjects: async () => [{ id: "project" }],
    getWorkflowScheduleConfiguration: async () => stored,
    saveWorkflowScheduleConfiguration: async (_id: string, value: WorkflowScheduleConfiguration) => { stored = value; }
  } as unknown as ProjectUseCase;
  const agents = { validateWorkflowParameterValues: async () => ({}) } as unknown as AgentUseCase;
  const scheduler = new WorkflowScheduler(projects, agents, () => new Date("2026-10-19T00:00:00Z"));
  const valid = await scheduler.saveSchedule("project", { crons: ["0 9 * * *", "0 18 * * *"], timezone: "UTC", enabled: false });
  for (const crons of [[], null, "0 9 * * *", [42], ["0 10 * * *", "invalid"], ["0 10 * * *", "0 9 31 2 *"]]) {
    await assert.rejects(scheduler.saveSchedule("project", { crons, enabled: false }));
    assert.deepEqual((await scheduler.getSchedule("project")).crons, valid.crons);
    assert.deepEqual((await projects.getWorkflowScheduleConfiguration("project"))?.crons, valid.crons);
  }
});
