import assert from "node:assert/strict";
import test from "node:test";
import type { AgentUseCase } from "../../usecase/AgentUseCase.ts";
import type { ProjectUseCase } from "../../usecase/ProjectUseCase.ts";
import { WorkflowScheduler } from "./WorkflowScheduler.ts";

test("déclenche une seule exécution par minute correspondante", async () => {
  const schedules = new Map<string, { cron: string; enabled: boolean }>();
  let runCount = 0;
  const projectUseCase = {
    async getProjects() {
      return [{ id: "project-id", directoryPath: "C:\\project" }];
    },
    async getWorkflowScheduleConfiguration(projectId: string) {
      return schedules.get(projectId) ?? null;
    },
    async saveWorkflowScheduleConfiguration(
      projectId: string,
      schedule: { cron: string; enabled: boolean }
    ) {
      schedules.set(projectId, schedule);
    }
  } as unknown as ProjectUseCase;
  const agentUseCase = {
    isProjectRunning: () => false,
    async runWorkflow() {
      runCount += 1;
      return { executedAgentIds: ["agent"], skippedAgentIds: [] };
    }
  } as unknown as AgentUseCase;
  const now = new Date(2026, 7, 14, 10, 0, 5);
  const scheduler = new WorkflowScheduler(projectUseCase, agentUseCase, () => now);

  await scheduler.saveSchedule("project-id", {
    cron: "* * * * *",
    enabled: true
  });
  scheduler.checkDueSchedules(now);
  scheduler.checkDueSchedules(new Date(2026, 7, 14, 10, 0, 50));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(runCount, 1);
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
