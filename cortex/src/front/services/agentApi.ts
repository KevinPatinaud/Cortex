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
  hasSession: boolean;
  model?: string;
  reasoningEffort?: string;
  prompt: string;
}

export interface AgentProject {
  projectId: string;
  engine: AgentEngine;
  agents: AgentDefinition[];
}

interface ApiErrorResponse {
  error?: string;
}

export interface AgentRunResult {
  answer: string;
  hasSession: boolean;
}

export async function getAgentStatus(): Promise<AgentStatus> {
  const response = await fetch("/api/agents/status");
  const data = await response.json() as AgentStatus;

  if (!response.ok) {
    throw new Error(data.error || "Impossible de detecter le moteur IA.");
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
  additionalInstructions: string
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
          : {})
      })
    }
  );
  const data = await response.json() as AgentRunResult & ApiErrorResponse;

  if (!response.ok) {
    throw new Error(data.error || "Impossible d'executer l'agent.");
  }

  return {
    answer: data.answer,
    hasSession: data.hasSession
  };
}
