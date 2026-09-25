import type { WorkflowInstanceState, WorkflowWaitingThread } from "./WorkflowWait.ts";

export interface WorkflowRuntime {
  projectId: string;
  executionPaused: boolean;
  workflowDefinitionError?: string;
  workflowInstance?: WorkflowInstanceState;
  workflowWaits?: WorkflowWaitingThread[];
  workflowResumable: boolean;
  workflowParameterValues: Record<string, string>;
  agents: Array<{
    id: string;
    hasSession: boolean;
    executionStatus: "idle" | "running" | "failed" | "cancelled" | "waiting";
    executionError?: string;
    executionStartedAt?: string;
    executionLastActivityAt?: string;
    executionProgress?: string;
    conversation: Array<{ role: "user" | "agent" | "event"; content: string }>;
    threads: Array<{ id: string; conversation: Array<{ role: "user" | "agent" | "event"; content: string }> }>;
  }>;
}
