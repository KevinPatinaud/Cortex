
export type AgentEngine = "codex" | "claude" | "copilot";

export interface AgentProvider {
  readonly engine: AgentEngine;
  readonly label: string;

  isAvailable(): Promise<boolean>;
  ask(prompt: string, model?: string): Promise<string>;
}
