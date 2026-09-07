import { isExecutionCancelled } from "../workflowExecution/WorkflowExecution.ts";
import type { AgentUseCase } from "../../usecase/AgentUseCase.ts";
import type { ProjectUseCase } from "../../usecase/ProjectUseCase.ts";
import { NotFoundError } from "../../error/NotFoundError.ts";
import { ValidationError } from "../../error/ValidationError.ts";
import type { WorkflowAuditService } from "../workflowAudit/WorkflowAuditService.ts";
import {
  cronMatchesDate,
  getNextCronOccurrence,
  normalizeCronExpression
} from "./CronExpression.ts";

export type WorkflowScheduleLastRunStatus =
  | "waiting"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "interrupted"
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
  parameterValues: Record<string, string>;
}

export interface WorkflowScheduleInput {
  cron?: unknown;
  enabled?: unknown;
  parameterValues?: unknown;
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
    { cron: string; enabled: boolean; parameterValues: Record<string, string> }
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
    private readonly now: () => Date = () => new Date(),
    private readonly workflowAuditService?: WorkflowAuditService
  ) {}

  async start(): Promise<void> {
    if (this.started) {
      return;
    }

    this.started = true;
    try {
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
        try {
          this.checkDueSchedules(this.now());
        } catch (error) {
          console.error("Unable to check scheduled workflow occurrences:", error);
        }
      }, 15_000);
      this.timer.unref();
    } catch (error) {
      this.started = false;
      throw error;
    }
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
      ) ?? {
        cron: DEFAULT_CRON_EXPRESSION,
        enabled: false,
        parameterValues: {}
      };
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

    const parameterValues = await this.agentUseCase
      .validateWorkflowParameterValues(
        normalizedProjectId,
        input.parameterValues,
        input.enabled
      );
    const schedule = {
      cron: normalizeCronExpression(input.cron),
      enabled: input.enabled,
      parameterValues
    };
    await this.projectUseCase.saveWorkflowScheduleConfiguration(
      normalizedProjectId,
      schedule
    );
    this.schedules.set(normalizedProjectId, schedule);

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

      if (this.workflowAuditService && !this.workflowAuditService.claimScheduledOccurrence(projectId, minuteKey)) {
        this.handledMinuteKeys.set(projectId, minuteKey);
        continue;
      }
      this.handledMinuteKeys.set(projectId, minuteKey);
      const runtime = this.getRuntimeState(projectId);

      if (runtime.running || this.agentUseCase.isProjectRunning(projectId) || this.agentUseCase.hasWorkflowWaits?.(projectId)) {
        const reason = "The previous workflow execution is still running.";
        runtime.lastRunAt = new Date(date);
        runtime.lastRunStatus = "skipped";
        runtime.lastRunError = reason;
        this.workflowAuditService?.completeScheduledOccurrence(projectId, minuteKey, "skipped", reason);
        this.workflowAuditService?.recordSkippedRun({
          projectId,
          trigger: "scheduled",
          scope: "workflow",
          parameterValues: { ...schedule.parameterValues },
          workflowSnapshot: null
        }, reason);
        continue;
      }

      runtime.running = true;
      runtime.lastRunAt = new Date(date);
      runtime.lastRunStatus = null;
      runtime.lastRunError = null;

      void this.executeScheduledWorkflow(projectId, runtime, minuteKey, { ...schedule.parameterValues });
    }
  }

  private async executeScheduledWorkflow(
    projectId: string,
    runtime: WorkflowScheduleRuntimeState,
    scheduledAt: string,
    parameterValues: Record<string, string>
  ): Promise<void> {
    try {
      const projectExists = (await this.projectUseCase.getProjects()).some(
        (project) => project.id === projectId
      );

      if (!projectExists) {
        this.workflowAuditService?.completeScheduledOccurrence(projectId, scheduledAt, "skipped", "The project no longer exists.");
        this.schedules.delete(projectId);
        this.runtimeStates.delete(projectId);
        this.handledMinuteKeys.delete(projectId);
        return;
      }

      const result = await this.agentUseCase.runWorkflow(projectId, parameterValues, "scheduled", { scheduledAt });
      const status = result?.status === "waiting" ? "waiting" : "succeeded";
      this.workflowAuditService?.completeScheduledOccurrence(projectId, scheduledAt, status);
      if (this.getMinuteKey(runtime.lastRunAt!) === scheduledAt) runtime.lastRunStatus = status;
    } catch (error) {
      const status = isExecutionCancelled(error) ? "cancelled" : "failed";
      const message = error instanceof Error ? error.message : "The scheduled workflow execution failed.";
      this.workflowAuditService?.completeScheduledOccurrence(projectId, scheduledAt, status, message);
      if (this.getMinuteKey(runtime.lastRunAt!) === scheduledAt) {
        runtime.lastRunStatus = status;
        runtime.lastRunError = message;
      }
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
    schedule: {
      cron: string;
      enabled: boolean;
      parameterValues: Record<string, string>;
    }
  ): WorkflowScheduleOutput {
    const runtime = this.getRuntimeState(projectId);

    return {
      ...schedule,
      parameterValues: { ...schedule.parameterValues },
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
      const latest = this.workflowAuditService?.getLatestScheduledOccurrence(projectId);
      state = {
        running: false,
        lastRunAt: latest ? new Date(latest.scheduledAt) : null,
        lastRunStatus: latest && latest.status !== "running" ? latest.status : null,
        lastRunError: latest?.error ?? null
      };
      this.runtimeStates.set(projectId, state);
    }

    if (!state.running && state.lastRunStatus === "waiting") {
      const latest = this.workflowAuditService?.getLatestScheduledOccurrence(projectId);
      if (latest && latest.status !== "running") {
        state.lastRunStatus = latest.status;
        state.lastRunError = latest.error;
      }
    }
    return state;
  }

  private getMinuteKey(date: Date): string {
    // Use the absolute occurrence, including the UTC offset during DST changes.
    // Missed occurrences are not replayed automatically after downtime.
    return new Date(Math.floor(date.getTime() / 60_000) * 60_000).toISOString();
  }
}
