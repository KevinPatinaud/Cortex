import type {
  WorkflowAuditAgentExecution,
  WorkflowAuditExecutionInput,
  WorkflowAuditRunDetail,
  WorkflowAuditRunPage,
  WorkflowAuditRunScope,
  WorkflowAuditRunStatus,
  WorkflowAuditTrigger
} from "../../../../shared/WorkflowAudit.ts";
import type { AgentEngine } from "../iaService/AgentProvider.ts";
import type { WorkflowEvent } from "../../../../shared/WorkflowWait.ts";

export interface WorkflowAuditSnapshot {
  engine: AgentEngine;
  instructions: string | null;
  agents: Array<{
    id: string;
    name: string;
    description: string;
    nextAgentIds: string[];
    inputMode: "separate" | "aggregate";
    model?: string;
    reasoningEffort?: string;
    prompt: string;
  }>;
}

export interface CreateWorkflowAuditRunInput {
  projectId: string;
  trigger: WorkflowAuditTrigger;
  scope: WorkflowAuditRunScope;
  parameterValues: Record<string, string>;
  workflowSnapshot: WorkflowAuditSnapshot | null;
}

export interface StartWorkflowAuditExecutionInput {
  runId: string;
  agentId: string;
  agentName: string;
  threadId: string;
  engine: AgentEngine;
  model?: string;
  reasoningEffort?: string;
  input: WorkflowAuditExecutionInput;
  prompt: string;
}

export interface CompleteWorkflowAuditExecutionInput {
  response: string;
  nextAgentIds: string[] | null;
  sessionId?: string;
}

export interface ScheduledOccurrence {
  scheduledAt: string;
  status: "running" | "waiting" | "succeeded" | "failed" | "skipped" | "cancelled" | "interrupted";
  error: string | null;
}

export interface WorkflowCheckpointRecord {
  fingerprint: string;
  state: unknown;
}

export interface WorkflowAuditRepository {
  listCheckpointProjectIds(): string[];
  receiveWorkflowEvent(instanceId: string, event: WorkflowEvent): boolean;
  listWorkflowEvents(instanceId: string): WorkflowEvent[];
  setRunActiveStatus(runId: string, status: "running" | "waiting"): void;
  saveCheckpoint(projectId: string, fingerprint: string, state: unknown): void;
  getCheckpoint(projectId: string): WorkflowCheckpointRecord | null;
  deleteCheckpoint(projectId: string): void;
  claimScheduledOccurrence(projectId: string, scheduledAt: string): boolean;
  completeScheduledOccurrence(projectId: string, scheduledAt: string, status: ScheduledOccurrence["status"], error?: string): void;
  getLatestScheduledOccurrence(projectId: string): ScheduledOccurrence | null;
  createRun(input: CreateWorkflowAuditRunInput): string;
  completeRun(runId: string, status: WorkflowAuditRunStatus, error?: string): void;
  addEvent(
    runId: string,
    executionId: string | null,
    type: string,
    payload?: unknown
  ): void;
  startExecution(input: StartWorkflowAuditExecutionInput): string;
  completeExecution(
    executionId: string,
    input: CompleteWorkflowAuditExecutionInput
  ): void;
  failExecution(
    executionId: string,
    error: string,
    response?: string,
    sessionId?: string,
    status?: "failed" | "cancelled"
  ): void;
  listRuns(
    projectId: string,
    limit: number,
    offset: number,
    scope?: WorkflowAuditRunScope
  ): WorkflowAuditRunPage;
  getRun(projectId: string, runId: string): WorkflowAuditRunDetail | null;
}

export class WorkflowAuditService {
  constructor(private readonly repository: WorkflowAuditRepository) {}

  listCheckpointProjectIds(): string[] { return this.repository.listCheckpointProjectIds(); }
  receiveWorkflowEvent(instanceId: string, event: WorkflowEvent): boolean { return this.repository.receiveWorkflowEvent(instanceId, event); }
  listWorkflowEvents(instanceId: string): WorkflowEvent[] { return this.repository.listWorkflowEvents(instanceId); }
  setRunActiveStatus(runId: string, status: "running" | "waiting"): void { this.repository.setRunActiveStatus(runId, status); }

  saveCheckpoint(projectId: string, fingerprint: string, state: unknown): void {
    this.repository.saveCheckpoint(projectId, fingerprint, state);
  }

  getCheckpoint(projectId: string): WorkflowCheckpointRecord | null {
    return this.repository.getCheckpoint(projectId);
  }

  deleteCheckpoint(projectId: string): void {
    this.repository.deleteCheckpoint(projectId);
  }

  claimScheduledOccurrence(projectId: string, scheduledAt: string): boolean {
    return this.repository.claimScheduledOccurrence(projectId, scheduledAt);
  }

  completeScheduledOccurrence(projectId: string, scheduledAt: string, status: ScheduledOccurrence["status"], error?: string): void {
    this.repository.completeScheduledOccurrence(projectId, scheduledAt, status, error);
  }

  getLatestScheduledOccurrence(projectId: string): ScheduledOccurrence | null {
    return this.repository.getLatestScheduledOccurrence(projectId);
  }

  createRun(input: CreateWorkflowAuditRunInput): string {
    return this.repository.createRun(input);
  }

  completeRun(
    runId: string,
    status: WorkflowAuditRunStatus,
    error?: string
  ): void {
    this.repository.completeRun(runId, status, error);
  }

  recordSkippedRun(input: CreateWorkflowAuditRunInput, reason: string): string {
    const runId = this.repository.createRun(input);
    this.repository.addEvent(runId, null, "run.skipped", { reason });
    this.repository.completeRun(runId, "skipped", reason);
    return runId;
  }

  addEvent(
    runId: string,
    executionId: string | null,
    type: string,
    payload?: unknown
  ): void {
    this.repository.addEvent(runId, executionId, type, payload);
  }

  startExecution(input: StartWorkflowAuditExecutionInput): string {
    return this.repository.startExecution(input);
  }

  completeExecution(
    executionId: string,
    input: CompleteWorkflowAuditExecutionInput
  ): void {
    this.repository.completeExecution(executionId, input);
  }

  failExecution(
    executionId: string,
    error: string,
    response?: string,
    sessionId?: string,
    status?: "failed" | "cancelled"
  ): void {
    this.repository.failExecution(executionId, error, response, sessionId, status);
  }

  listRuns(
    projectId: string,
    limit: number,
    offset: number,
    scope?: WorkflowAuditRunScope
  ): WorkflowAuditRunPage {
    return this.repository.listRuns(projectId, limit, offset, scope);
  }

  getRun(projectId: string, runId: string): WorkflowAuditRunDetail | null {
    return this.repository.getRun(projectId, runId);
  }
}
