export type AgentEngine = "codex" | "claude" | "copilot";

export interface AgentStatus {
  engine: AgentEngine | null;
  label: string | null;
  error: string | null;
}

export interface AgentDefinition {
  name: string;
  description: string;
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
