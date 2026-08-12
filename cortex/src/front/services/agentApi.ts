export type AgentEngine = "codex" | "claude" | "copilot";

export interface AgentStatus {
  engine: AgentEngine | null;
  label: string | null;
  error: string | null;
}

export interface AgentDefinition {
  id: string;
  name: string;
  description: string;
  nextAgentIds: string[];
  hasSession: boolean;
  executionStatus: "idle" | "running" | "failed";
  executionError?: string;
  conversation: AgentConversationMessage[];
  model?: string;
  reasoningEffort?: string;
  prompt: string;
}

export interface AgentConversationMessage {
  role: "user" | "agent";
  content: string;
}

export interface ProjectInstructions {
  fileName: string;
  content: string | null;
}

export interface AgentProject {
  projectId: string;
  engine: AgentEngine;
  agents: AgentDefinition[];
  instructions: ProjectInstructions;
}

interface ApiErrorResponse {
  error?: string;
}

export interface AgentRunResult {
  answer: string;
  hasSession: boolean;
  conversation: AgentConversationMessage[];
}

export interface UpstreamAgentResult {
  agentId: string;
  selectedItemIndexes: number[];
}

export async function getAgentStatus(): Promise<AgentStatus> {
  const response = await fetch("/api/agents/status");
  const data = await response.json() as AgentStatus;

  if (!response.ok) {
    throw new Error(data.error || "Impossible de détecter le moteur IA.");
  }

  return data;
}

export async function loadAgentProject(
  projectId: string
): Promise<AgentProject> {
  const response = await fetch(
    `/api/agents/projects/${encodeURIComponent(projectId)}`
  );
  const data = await response.json() as AgentProject & ApiErrorResponse;

  if (!response.ok) {
    throw new Error(data.error || "Impossible de charger le projet.");
  }

  return data;
}

export async function getActualLoadedAgentProject(): Promise<AgentProject | null> {
  const response = await fetch("/api/agents/projects/actual");
  const data = await response.json() as
    (AgentProject & ApiErrorResponse) | null;

  if (!response.ok) {
    throw new Error(
      data?.error || "Impossible de restaurer le projet actuel."
    );
  }

  return data;
}

export async function runAgent(
  projectId: string,
  agentId: string,
  additionalInstructions: string,
  upstreamAgentResults?: UpstreamAgentResult[]
): Promise<AgentRunResult> {
  const response = await fetch(
    `/api/agents/projects/${encodeURIComponent(projectId)}/agents/run`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        agentId,
        ...(additionalInstructions.trim()
          ? { additionalInstructions: additionalInstructions.trim() }
          : {}),
        ...(upstreamAgentResults && upstreamAgentResults.length > 0
          ? { upstreamAgentResults }
          : {})
      })
    }
  );
  const data = await response.json() as AgentRunResult & ApiErrorResponse;

  if (!response.ok) {
    throw new Error(data.error || "Impossible d'exécuter l'agent.");
  }

  return {
    answer: data.answer,
    hasSession: data.hasSession,
    conversation: data.conversation
  };
}

export async function resetAgentProjectWorkflow(
  projectId: string
): Promise<void> {
  const response = await fetch(
    `/api/agents/projects/${encodeURIComponent(projectId)}/workflow/reset`,
    { method: "POST" }
  );
  const data = await response.json() as ApiErrorResponse;

  if (!response.ok) {
    throw new Error(data.error || "Impossible de réinitialiser le workflow.");
  }
}
