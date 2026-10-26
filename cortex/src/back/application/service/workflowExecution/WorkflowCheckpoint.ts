import { isWorkflowInstanceState, isWorkflowWaitState, type WorkflowInstanceState, type WorkflowWaitState } from "../../../../shared/WorkflowWait.ts";
import { isAgentContinuity, type AgentContinuity } from "../../../../shared/ExecutionQuality.ts";
import { isExecutionProcessing, type ExecutionProcessing } from "../../../../shared/ResultProcessing.ts";
export interface WorkflowCheckpointState {
  instance?: WorkflowInstanceState;
  interpretationRecovery?: { attempts: number; nextAttemptAt: string };
  parameterValues: Record<string, string>;
  agents: Array<{
    id: string;
    execution: {
      status: "idle" | "running" | "failed" | "cancelled" | "waiting";
      error?: string;
      startedAt?: string;
      lastActivityAt?: string;
      progress?: string;
    };
    failedThreadIds: string[];
    threads: Array<{
      id: string;
      sessionId: string;
      workingDirectory?: string;
      responseMode?: "separate" | "integrated";
      missionPromptVersion?: 2;
      pendingInterpretation?: ExecutionProcessing;
      wait?: WorkflowWaitState;
      conversation: Array<{ role: "user" | "agent" | "event"; content: string }>;
      upstreamItems: Array<{ agentId: string; agentName: string; content: string; continuity?: AgentContinuity }>;
    }>;
  }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A malformed checkpoint must never partially restore a workflow. */
export function readWorkflowCheckpoint(value: unknown): WorkflowCheckpointState | null {
  if (!isRecord(value) || (value.instance !== undefined && !isWorkflowInstanceState(value.instance)) || !isRecord(value.parameterValues) ||
      (value.interpretationRecovery !== undefined && (!isRecord(value.interpretationRecovery) ||
        !Number.isSafeInteger(value.interpretationRecovery.attempts) || Number(value.interpretationRecovery.attempts) < 1 ||
        typeof value.interpretationRecovery.nextAttemptAt !== "string" || !Number.isFinite(Date.parse(value.interpretationRecovery.nextAttemptAt)))) ||
      !Object.values(value.parameterValues).every((parameter) => typeof parameter === "string") ||
      !Array.isArray(value.agents)) return null;

  const agentIds = new Set<string>();
  for (const agent of value.agents) {
    if (!isRecord(agent) || typeof agent.id !== "string" || agentIds.has(agent.id) ||
        !isRecord(agent.execution) ||
        !["idle", "running", "failed", "cancelled", "waiting"].includes(String(agent.execution.status)) ||
        !["error", "startedAt", "lastActivityAt", "progress"].every((key) =>
          agent.execution && isRecord(agent.execution) &&
          (agent.execution[key] === undefined || typeof agent.execution[key] === "string")) ||
        !Array.isArray(agent.failedThreadIds) || !agent.failedThreadIds.every((id) => typeof id === "string") ||
        !Array.isArray(agent.threads)) return null;
    agentIds.add(agent.id);
    const threadIds = new Set<string>();
    for (const thread of agent.threads) {
      if (!isRecord(thread) || typeof thread.id !== "string" || threadIds.has(thread.id) ||
          typeof thread.sessionId !== "string" || !thread.sessionId ||
          (thread.workingDirectory !== undefined && typeof thread.workingDirectory !== "string") ||
          (thread.responseMode !== undefined && !["separate", "integrated"].includes(String(thread.responseMode))) ||
          (thread.missionPromptVersion !== undefined && thread.missionPromptVersion !== 2) ||
          (thread.pendingInterpretation !== undefined && !isExecutionProcessing(thread.pendingInterpretation)) ||
          (thread.wait !== undefined && !isWorkflowWaitState(thread.wait)) ||
          !Array.isArray(thread.conversation) || !thread.conversation.every((message) =>
            isRecord(message) && (message.role === "user" || message.role === "agent" || message.role === "event") && typeof message.content === "string") ||
          !Array.isArray(thread.upstreamItems) || !thread.upstreamItems.every((item) =>
            isRecord(item) && typeof item.agentId === "string" && typeof item.agentName === "string" && typeof item.content === "string" &&
            (item.continuity === undefined || isAgentContinuity(item.continuity)))) return null;
      threadIds.add(thread.id);
    }
  }
  return value as unknown as WorkflowCheckpointState;
}

/** Only completed mission results may be retried automatically. An ambiguous
 * failed branch must keep its explicit recovery requirement. */
export function hasRecoverableInterpretation(state: WorkflowCheckpointState | null): boolean {
  if (!state?.agents.some(agent => agent.threads.some(thread => thread.pendingInterpretation))) return false;
  return state.agents.every(agent => {
    const failed = ["running", "failed", "cancelled"].includes(agent.execution.status);
    const ids = agent.failedThreadIds.length ? agent.failedThreadIds : failed ? agent.threads.map(thread => thread.id) : [];
    return (!failed || ids.length > 0) && ids.every(id =>
      agent.threads.some(thread => thread.id === id && thread.pendingInterpretation));
  });
}
import { createHash } from "node:crypto";

interface CheckpointWorkflowDefinition {
  directoryPath: string;
  engine: string;
  instructions: { content: string | null };
  parameters: unknown;
  agents: Array<{
    id: string;
    name: string;
    description: string;
    nextAgentIds: string[];
    inputMode: string;
    prompt: string;
    model?: string;
    reasoningEffort?: string;
  }>;
}

export function createWorkflowCheckpointFingerprint(project: CheckpointWorkflowDefinition): string {
  return createHash("sha256").update(JSON.stringify({
    version: 1,
    directoryPath: project.directoryPath,
    engine: project.engine,
    instructions: project.instructions.content,
    parameters: project.parameters,
    agents: project.agents.map(({ id, name, description, nextAgentIds, inputMode, prompt, model, reasoningEffort }) =>
      ({ id, name, description, nextAgentIds, inputMode, prompt, model, reasoningEffort }))
  })).digest("hex");
}
