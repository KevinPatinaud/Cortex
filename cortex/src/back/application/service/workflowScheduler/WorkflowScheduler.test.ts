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
  let schedule = { cron: "* * * * *", enabled: true, parameterValues: {} };
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
