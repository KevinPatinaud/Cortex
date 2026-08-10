
export type AgentEngine = "codex" | "claude" | "copilot";

export interface AgentExecutionOptions {
  model?: string;
  persistSession?: boolean;
  reasoningEffort?: string;
  sessionId?: string;
  workingDirectory?: string;
}

export interface AgentExecutionResult {
  answer: string;
  sessionId?: string;
}

export interface AgentProvider {
  readonly engine: AgentEngine;
  readonly label: string;

  isAvailable(): Promise<boolean>;
  ask(
    prompt: string,
    options?: AgentExecutionOptions
  ): Promise<AgentExecutionResult>;
}
