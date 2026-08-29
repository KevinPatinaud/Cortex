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

export interface WorkflowAuditRepository {
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
    sessionId?: string
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
    sessionId?: string
  ): void {
    this.repository.failExecution(executionId, error, response, sessionId);
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
