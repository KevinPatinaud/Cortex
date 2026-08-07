export type AgentEngine = "codex" | "claude" | "copilot";

export interface AgentStatus {
  engine: AgentEngine | null;
  label: string | null;
  error: string | null;
}

export async function getAgentStatus(): Promise<AgentStatus> {
  const response = await fetch("/api/agents/status");
  const data = await response.json() as AgentStatus;

  if (!response.ok) {
    throw new Error(data.error || "Impossible de detecter le moteur IA.");
  }

  return data;
}
