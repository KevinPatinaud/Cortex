export type WorkflowAuditTrigger = "manual" | "scheduled";
export type WorkflowAuditRunScope = "workflow" | "agent";

export type WorkflowAuditRunStatus =
  | "waiting"
  | "running"
  | "succeeded"
  | "failed"
  | "partial"
  | "skipped"
  | "cancelled"
  | "interrupted";

export type WorkflowAuditExecutionStatus =
  | "cancelled"
  | "running"
  | "succeeded"
  | "failed"
  | "interrupted";

export interface WorkflowAuditRunSummary {
  id: string;
  projectId: string;
  trigger: WorkflowAuditTrigger;
  scope: WorkflowAuditRunScope;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  status: WorkflowAuditRunStatus;
  error: string | null;
  agentExecutionCount: number;
}

export interface WorkflowAuditExecutionInput {
  workflowParameterValues: Record<string, string>;
  additionalInstructions: string;
  upstreamItems: Array<{
    agentId: string;
    agentName: string;
    content: string;
  }>;
}

export interface WorkflowAuditAgentExecution {
  id: string;
  runId: string;
  agentId: string;
  agentName: string;
  threadId: string;
  attempt: number;
  engine: "codex" | "claude" | "copilot";
  model: string | null;
  reasoningEffort: string | null;
  startedAt: string;
  finishedAt: string | null;
  durationMs: number | null;
  status: WorkflowAuditExecutionStatus;
  input: WorkflowAuditExecutionInput;
  prompt: string;
  response: string | null;
  nextAgentIds: string[] | null;
  sessionId: string | null;
  error: string | null;
}

export interface WorkflowAuditRunDetail extends WorkflowAuditRunSummary {
  parameterValues: Record<string, string>;
  workflowSnapshot: {
    engine: "codex" | "claude" | "copilot";
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
  } | null;
  executions: WorkflowAuditAgentExecution[];
}

export interface WorkflowAuditRunPage {
  items: WorkflowAuditRunSummary[];
  total: number;
  limit: number;
  offset: number;
}
