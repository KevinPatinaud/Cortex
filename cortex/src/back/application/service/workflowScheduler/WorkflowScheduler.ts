import { ExecutionWorkspaceBusyError } from "../executionWorkspace/ExecutionWorkspaceGuard.ts";
import { WORK_FORCE_NORMAL_SUSPENDED_REASON } from "../../../../shared/WorkForce.ts";
import { isExecutionCancelled } from "../workflowExecution/WorkflowExecution.ts";
import { CodexQuotaBlockedError } from "../../error/CodexQuotaBlockedError.ts";
import path from "node:path";
import type { GlobalExecutionQueue } from "../executionQueue/GlobalExecutionQueue.ts";
import type { AgentUseCase } from "../../usecase/AgentUseCase.ts";
import type { ProjectUseCase } from "../../usecase/ProjectUseCase.ts";
import { NotFoundError } from "../../error/NotFoundError.ts";
import { ValidationError } from "../../error/ValidationError.ts";
import type { WorkflowAuditService } from "../workflowAudit/WorkflowAuditService.ts";
import type { WorkflowScheduleConfiguration } from "../projectService/ProjectService.ts";
import {
  cronMatchesDate,
  getNextCronOccurrence,
  normalizeCronExpression,
  normalizeScheduleTimezone,
  serverTimezone
} from "./CronExpression.ts";

export type WorkflowScheduleLastRunStatus =
  | "queued"
  | "waiting"
  | "succeeded"
  | "failed"
  | "cancelled"
  | "interrupted"
  | "skipped";

export interface WorkflowScheduleOutput {
  cron: string;
  crons: string[];
  enabled: boolean;
  timezone: string;
  serverTimezone: string;
  configured: boolean;
  nextRunAt: string | null;
  running: boolean;
  lastRunAt: string | null;
  lastRunStatus: WorkflowScheduleLastRunStatus | null;
  lastRunError: string | null;
  parameterValues: Record<string, string>;
}

export interface WorkflowScheduleInput {
  cron?: unknown;
  crons?: unknown;
  timezone?: unknown;
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
  private readonly schedules = new Map<string, WorkflowScheduleConfiguration>();
  private readonly configuredProjects = new Set<string>();
  private readonly runtimeStates = new Map<
    string,
    WorkflowScheduleRuntimeState
  >();
  private readonly handledMinuteKeys = new Map<string, string>();
  private timer: NodeJS.Timeout | null = null;
  private started = false;
  private readonly pendingRuns = new Map<string, Set<AbortController>>();

  constructor(
    private readonly projectUseCase: ProjectUseCase,
    private readonly agentUseCase: AgentUseCase,
    private readonly now: () => Date = () => new Date(),
    private readonly workflowAuditService?: WorkflowAuditService,
    private readonly isSuspended: () => boolean = () => false,
    private readonly suspensionReason: () => string = () => WORK_FORCE_NORMAL_SUSPENDED_REASON,
    private readonly executionQueue?: GlobalExecutionQueue
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
          this.configuredProjects.add(project.id);
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
    for (const controllers of this.pendingRuns.values()) for (const controller of controllers)
      controller.abort(new DOMException("Le planificateur s’arrête.", "AbortError"));
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
      const stored = await this.projectUseCase.getWorkflowScheduleConfiguration(
        normalizedProjectId
      );
      if (stored) this.configuredProjects.add(normalizedProjectId);
      schedule = stored ?? {
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

    const previous = await this.getSchedule(normalizedProjectId);
    const timezone = normalizeScheduleTimezone(input.timezone === undefined ? previous.timezone : input.timezone);
    const expressions = input.crons === undefined
      ? [input.cron, ...previous.crons.slice(1)]
      : input.crons;
    if (!Array.isArray(expressions) || expressions.length === 0) {
      throw new ValidationError("At least one cron expression is required.");
    }
    const crons = [...new Set(expressions.map(normalizeCronExpression))];
    // Validate an occurrence before persisting, so an invalid schedule cannot be saved.
    for (const cron of crons) getNextCronOccurrence(cron, this.now(), timezone);
    const parameterValues = await this.agentUseCase
      .validateWorkflowParameterValues(
        normalizedProjectId,
        input.parameterValues,
        input.enabled
      );
    const schedule = {
      cron: crons[0],
      crons,
      timezone,
      enabled: input.enabled,
      parameterValues
    };
    await this.projectUseCase.saveWorkflowScheduleConfiguration(
      normalizedProjectId,
      schedule
    );
    this.schedules.set(normalizedProjectId, schedule);
    this.configuredProjects.add(normalizedProjectId);
    if (!schedule.enabled) for (const controller of this.pendingRuns.get(normalizedProjectId) ?? [])
      controller.abort(new DOMException("Planification désactivée.", "AbortError"));

    return this.toOutput(normalizedProjectId, schedule);
  }

  async previewSchedule(projectId: string, input: WorkflowScheduleInput | null | undefined) {
    await this.requireProject(projectId);
    const cron = normalizeCronExpression(input?.cron);
    const timezone = normalizeScheduleTimezone(input?.timezone);
    const now = this.now();
    let after = now;
    const nextRuns: string[] = [];
    for (let index = 0; index < 3; index++) {
      after = getNextCronOccurrence(cron, after, timezone);
      nextRuns.push(after.toISOString());
    }
    return { cron, timezone, serverTimezone: serverTimezone(), now: now.toISOString(), nextRuns };
  }

  checkDueSchedules(date: Date): void {
    const minuteKey = this.getMinuteKey(date);

    for (const [projectId, schedule] of this.schedules) {
      if (
        !schedule.enabled ||
        this.handledMinuteKeys.get(projectId) === minuteKey ||
        !this.getCrons(schedule).some((cron) => cronMatchesDate(cron, date, schedule.timezone ?? serverTimezone()))
      ) {
        continue;
      }

      if (this.workflowAuditService && !this.workflowAuditService.claimScheduledOccurrence(projectId, minuteKey)) {
        this.handledMinuteKeys.set(projectId, minuteKey);
        continue;
      }
      this.handledMinuteKeys.set(projectId, minuteKey);
      const runtime = this.getRuntimeState(projectId);

      if (this.isSuspended()) {
        runtime.lastRunAt = new Date(date);
        runtime.lastRunStatus = "skipped";
        runtime.lastRunError = this.suspensionReason();
        this.workflowAuditService?.completeScheduledOccurrence(projectId, minuteKey, "skipped", this.suspensionReason());
        this.workflowAuditService?.recordSkippedRun({ projectId, trigger: "scheduled", scope: "workflow",
          parameterValues: { ...schedule.parameterValues }, workflowSnapshot: null }, this.suspensionReason());
        continue;
      }

      if ((!this.executionQueue && (runtime.running || (this.agentUseCase.isNormalProjectRunning?.(projectId) ?? this.agentUseCase.isProjectRunning(projectId)))) || this.agentUseCase.hasWorkflowWaits?.(projectId)) {
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
    const controller = new AbortController();
    const pending = this.pendingRuns.get(projectId) ?? new Set<AbortController>();
    this.pendingRuns.set(projectId, pending);
    pending.add(controller);
    try {
      await this.agentUseCase.assertScheduledQuota?.();
      controller.signal.throwIfAborted();
      if (this.isSuspended()) throw new ExecutionWorkspaceBusyError(this.suspensionReason());
      const project = (await this.projectUseCase.getProjects()).find(
        (project) => project.id === projectId
      );

      if (!project) {
        this.workflowAuditService?.completeScheduledOccurrence(projectId, scheduledAt, "skipped", "The project no longer exists.");
        this.schedules.delete(projectId);
        this.configuredProjects.delete(projectId);
        this.runtimeStates.delete(projectId);
        this.handledMinuteKeys.delete(projectId);
        return;
      }

      const recoveryProjectId = await this.agentUseCase.getRecoveryProjectId?.(projectId);
      if (this.isSuspended()) throw new ExecutionWorkspaceBusyError(this.suspensionReason());
      if (recoveryProjectId && recoveryProjectId !== projectId) {
        const reason = `Créneau utilisé pour reprendre l'intervention interrompue de ${recoveryProjectId}.`;
        this.workflowAuditService?.completeScheduledOccurrence(projectId, scheduledAt, "skipped", reason);
        const skippedRunId = this.workflowAuditService?.recordSkippedRun({ projectId, trigger: "scheduled", scope: "workflow",
          parameterValues, workflowSnapshot: null }, reason);
        runtime.lastRunStatus = "skipped";
        runtime.lastRunError = reason;
        // Only already-started work is recovered. Never queue or replay this slot.
        try {
          const schedule = await this.projectUseCase.getWorkflowScheduleConfiguration(recoveryProjectId);
          await this.agentUseCase.runWorkflow(recoveryProjectId, schedule?.parameterValues ?? {}, "scheduled");
        } catch (error) {
          runtime.lastRunError = `${reason} ${error instanceof Error ? error.message : String(error)}`;
          this.workflowAuditService?.completeScheduledOccurrence(projectId, scheduledAt, "skipped", runtime.lastRunError);
          if (skippedRunId) this.workflowAuditService?.completeRun(skippedRunId, "skipped", runtime.lastRunError);
          if (!(error instanceof CodexQuotaBlockedError || error instanceof ExecutionWorkspaceBusyError)) console.error("Workspace recovery failed:", error);
        }
        return;
      }
      const execute = async () => {
        controller.signal.throwIfAborted();
        if (this.agentUseCase.hasWorkflowWaits?.(projectId)) throw new ExecutionWorkspaceBusyError("Ce workflow attend un événement externe.");
        this.workflowAuditService?.completeScheduledOccurrence(projectId, scheduledAt, "running");
        if (this.getMinuteKey(runtime.lastRunAt!) === scheduledAt) runtime.lastRunStatus = null;
        return this.agentUseCase.runWorkflow(projectId, parameterValues, "scheduled", { scheduledAt });
      };
      const result = this.executionQueue ? await this.executionQueue.run({
        source: "normal", projectId, key: `scheduled:${projectId}`, label: `Planification ${path.basename(project.directoryPath ?? projectId)} · ${scheduledAt}`,
        signal: controller.signal, handoffToAgent: true,
        ready: () => !(this.agentUseCase.isNormalProjectRunning?.(projectId) ?? this.agentUseCase.isProjectRunning(projectId)),
        onQueued: () => {
          this.workflowAuditService?.completeScheduledOccurrence(projectId, scheduledAt, "queued");
          if (this.getMinuteKey(runtime.lastRunAt!) === scheduledAt) runtime.lastRunStatus = "queued";
        }
      }, execute) : await execute();
      const status = result?.status === "waiting" ? "waiting" : "succeeded";
      this.workflowAuditService?.completeScheduledOccurrence(projectId, scheduledAt, status);
      if (this.getMinuteKey(runtime.lastRunAt!) === scheduledAt) runtime.lastRunStatus = status;
    } catch (error) {
      const status = (error instanceof CodexQuotaBlockedError || error instanceof ExecutionWorkspaceBusyError) ? "skipped" : isExecutionCancelled(error) ? "cancelled" : "failed";
      const message = error instanceof Error ? error.message : "The scheduled workflow execution failed.";
      this.workflowAuditService?.completeScheduledOccurrence(projectId, scheduledAt, status, message);
      if (this.getMinuteKey(runtime.lastRunAt!) === scheduledAt) {
        runtime.lastRunStatus = status;
        runtime.lastRunError = message;
      }
      if (error instanceof ExecutionWorkspaceBusyError) this.workflowAuditService?.recordSkippedRun({ projectId,
        trigger: "scheduled", scope: "workflow", parameterValues, workflowSnapshot: null }, message);
      if (!(error instanceof CodexQuotaBlockedError || error instanceof ExecutionWorkspaceBusyError || isExecutionCancelled(error))) console.error(
        `Scheduled workflow execution failed for project ${projectId}:`,
        error
      );
    } finally {
      pending.delete(controller);
      if (!pending.size) this.pendingRuns.delete(projectId);
      runtime.running = pending.size > 0;
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
    schedule: WorkflowScheduleConfiguration
  ): WorkflowScheduleOutput {
    const runtime = this.getRuntimeState(projectId);

    return {
      ...schedule,
      crons: [...this.getCrons(schedule)],
      parameterValues: { ...schedule.parameterValues },
      timezone: schedule.timezone ?? serverTimezone(),
      serverTimezone: serverTimezone(),
      configured: this.configuredProjects.has(projectId),
      nextRunAt: schedule.enabled
        ? this.getCrons(schedule).map((cron) => getNextCronOccurrence(cron, this.now(), schedule.timezone ?? serverTimezone()).toISOString()).sort()[0]
        : null,
      running: runtime.running,
      lastRunAt: runtime.lastRunAt?.toISOString() ?? null,
      lastRunStatus: runtime.lastRunStatus,
      lastRunError: runtime.lastRunError
    };
  }

  private getCrons(schedule: WorkflowScheduleConfiguration): string[] {
    return schedule.crons ?? [schedule.cron];
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
