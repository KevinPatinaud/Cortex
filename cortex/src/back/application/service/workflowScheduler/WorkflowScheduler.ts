import type { AgentUseCase } from "../../usecase/AgentUseCase.ts";
import type { ProjectUseCase } from "../../usecase/ProjectUseCase.ts";
import { NotFoundError } from "../../error/NotFoundError.ts";
import { ValidationError } from "../../error/ValidationError.ts";
import {
  cronMatchesDate,
  getNextCronOccurrence,
  normalizeCronExpression
} from "./CronExpression.ts";

export type WorkflowScheduleLastRunStatus =
  | "succeeded"
  | "failed"
  | "skipped";

export interface WorkflowScheduleOutput {
  cron: string;
  enabled: boolean;
  timezone: string;
  nextRunAt: string | null;
  running: boolean;
  lastRunAt: string | null;
  lastRunStatus: WorkflowScheduleLastRunStatus | null;
  lastRunError: string | null;
}

export interface WorkflowScheduleInput {
  cron?: unknown;
  enabled?: unknown;
}

interface WorkflowScheduleRuntimeState {
  running: boolean;
  lastRunAt: Date | null;
  lastRunStatus: WorkflowScheduleLastRunStatus | null;
  lastRunError: string | null;
}

const DEFAULT_CRON_EXPRESSION = "0 9 * * 1-5";

export class WorkflowScheduler {
  private readonly schedules = new Map<
    string,
    { cron: string; enabled: boolean }
  >();
  private readonly runtimeStates = new Map<
    string,
    WorkflowScheduleRuntimeState
  >();
  private readonly handledMinuteKeys = new Map<string, string>();
  private timer: NodeJS.Timeout | null = null;
  private started = false;

  constructor(
    private readonly projectUseCase: ProjectUseCase,
    private readonly agentUseCase: AgentUseCase,
    private readonly now: () => Date = () => new Date()
  ) {}

  async start(): Promise<void> {
    if (this.started) {
      return;
    }

    this.started = true;
    const projects = await this.projectUseCase.getProjects();

    await Promise.all(projects.map(async (project) => {
      const schedule = await this.projectUseCase
        .getWorkflowScheduleConfiguration(project.id);

      if (schedule) {
        this.schedules.set(project.id, schedule);
      }
    }));

    this.checkDueSchedules(this.now());
    this.timer = setInterval(() => {
      this.checkDueSchedules(this.now());
    }, 15_000);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }

    this.started = false;
  }

  async getSchedule(projectId: string): Promise<WorkflowScheduleOutput> {
    const normalizedProjectId = await this.requireProject(projectId);
    let schedule = this.schedules.get(normalizedProjectId);

    if (!schedule) {
      schedule = await this.projectUseCase.getWorkflowScheduleConfiguration(
        normalizedProjectId
      ) ?? { cron: DEFAULT_CRON_EXPRESSION, enabled: false };
      this.schedules.set(normalizedProjectId, schedule);
    }

    return this.toOutput(normalizedProjectId, schedule);
  }

  async saveSchedule(
    projectId: string,
    input: WorkflowScheduleInput | null | undefined
  ): Promise<WorkflowScheduleOutput> {
    const normalizedProjectId = await this.requireProject(projectId);

    if (typeof input?.enabled !== "boolean") {
      throw new ValidationError("The schedule enabled option must be a boolean.");
    }

    const schedule = {
      cron: normalizeCronExpression(input.cron),
      enabled: input.enabled
    };
    await this.projectUseCase.saveWorkflowScheduleConfiguration(
      normalizedProjectId,
      schedule
    );
    this.schedules.set(normalizedProjectId, schedule);
    this.handledMinuteKeys.delete(normalizedProjectId);

    return this.toOutput(normalizedProjectId, schedule);
  }

  checkDueSchedules(date: Date): void {
    const minuteKey = this.getMinuteKey(date);

    for (const [projectId, schedule] of this.schedules) {
      if (
        !schedule.enabled ||
        this.handledMinuteKeys.get(projectId) === minuteKey ||
        !cronMatchesDate(schedule.cron, date)
      ) {
        continue;
      }

      this.handledMinuteKeys.set(projectId, minuteKey);
      const runtime = this.getRuntimeState(projectId);

      if (runtime.running || this.agentUseCase.isProjectRunning(projectId)) {
        runtime.lastRunAt = new Date(date);
        runtime.lastRunStatus = "skipped";
        runtime.lastRunError = "The previous workflow execution is still running.";
        continue;
      }

      runtime.running = true;
      runtime.lastRunAt = new Date(date);
      runtime.lastRunStatus = null;
      runtime.lastRunError = null;

      void this.executeScheduledWorkflow(projectId, runtime);
    }
  }

  private async executeScheduledWorkflow(
    projectId: string,
    runtime: WorkflowScheduleRuntimeState
  ): Promise<void> {
    try {
      const projectExists = (await this.projectUseCase.getProjects()).some(
        (project) => project.id === projectId
      );

      if (!projectExists) {
        this.schedules.delete(projectId);
        this.runtimeStates.delete(projectId);
        this.handledMinuteKeys.delete(projectId);
        return;
      }

      await this.agentUseCase.runWorkflow(projectId);
      runtime.lastRunStatus = "succeeded";
    } catch (error) {
      runtime.lastRunStatus = "failed";
      runtime.lastRunError = error instanceof Error
        ? error.message
        : "The scheduled workflow execution failed.";
      console.error(
        `Scheduled workflow execution failed for project ${projectId}:`,
        error
      );
    } finally {
      runtime.running = false;
    }
  }

  private async requireProject(projectId: string): Promise<string> {
    const normalizedProjectId = projectId.trim();

    if (
      !normalizedProjectId ||
      !(await this.projectUseCase.getProjects()).some(
        (project) => project.id === normalizedProjectId
      )
    ) {
      throw new NotFoundError("The project could not be found.");
    }

    return normalizedProjectId;
  }

  private toOutput(
    projectId: string,
    schedule: { cron: string; enabled: boolean }
  ): WorkflowScheduleOutput {
    const runtime = this.getRuntimeState(projectId);

    return {
      ...schedule,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "local",
      nextRunAt: schedule.enabled
        ? getNextCronOccurrence(schedule.cron, this.now()).toISOString()
        : null,
      running: runtime.running,
      lastRunAt: runtime.lastRunAt?.toISOString() ?? null,
      lastRunStatus: runtime.lastRunStatus,
      lastRunError: runtime.lastRunError
    };
  }

  private getRuntimeState(projectId: string): WorkflowScheduleRuntimeState {
    let state = this.runtimeStates.get(projectId);

    if (!state) {
      state = {
        running: false,
        lastRunAt: null,
        lastRunStatus: null,
        lastRunError: null
      };
      this.runtimeStates.set(projectId, state);
    }

    return state;
  }

  private getMinuteKey(date: Date): string {
    return [
      date.getFullYear(),
      date.getMonth(),
      date.getDate(),
      date.getHours(),
      date.getMinutes()
    ].join(":");
  }
}
