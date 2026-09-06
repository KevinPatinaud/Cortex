export interface WorkflowCheckpointState {
  parameterValues: Record<string, string>;
  agents: Array<{
    id: string;
    execution: {
      status: "idle" | "running" | "failed" | "cancelled";
      error?: string;
      startedAt?: string;
      lastActivityAt?: string;
      progress?: string;
    };
    failedThreadIds: string[];
    threads: Array<{
      id: string;
      sessionId: string;
      conversation: Array<{ role: "user" | "agent"; content: string }>;
      upstreamItems: Array<{ agentId: string; agentName: string; content: string }>;
    }>;
  }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A malformed checkpoint must never partially restore a workflow. */
export function readWorkflowCheckpoint(value: unknown): WorkflowCheckpointState | null {
  if (!isRecord(value) || !isRecord(value.parameterValues) ||
      !Object.values(value.parameterValues).every((parameter) => typeof parameter === "string") ||
      !Array.isArray(value.agents)) return null;

  const agentIds = new Set<string>();
  for (const agent of value.agents) {
    if (!isRecord(agent) || typeof agent.id !== "string" || agentIds.has(agent.id) ||
        !isRecord(agent.execution) ||
        !["idle", "running", "failed", "cancelled"].includes(String(agent.execution.status)) ||
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
          !Array.isArray(thread.conversation) || !thread.conversation.every((message) =>
            isRecord(message) && (message.role === "user" || message.role === "agent") && typeof message.content === "string") ||
          !Array.isArray(thread.upstreamItems) || !thread.upstreamItems.every((item) =>
            isRecord(item) && typeof item.agentId === "string" && typeof item.agentName === "string" && typeof item.content === "string")) return null;
      threadIds.add(thread.id);
    }
  }
  return value as unknown as WorkflowCheckpointState;
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
