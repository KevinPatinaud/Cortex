
export type AgentEngine = "codex" | "claude" | "copilot";

export interface AgentConfiguration {
  autopilot: boolean;
  allowAll: boolean;
}

export const DEFAULT_AGENT_CONFIGURATION: AgentConfiguration = {
  autopilot: true,
  allowAll: true
};

export interface AgentExecutionOptions {
  configuration?: AgentConfiguration;
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
