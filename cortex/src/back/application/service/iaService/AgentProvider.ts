
import type { ExecutionProfile } from "../../../../shared/ExecutionQuality.ts";
export type AgentEngine = "codex" | "claude" | "copilot";

export interface AgentConfiguration {
  autopilot: boolean;
  allowAll: boolean;
}

export const DEFAULT_AGENT_CONFIGURATION: AgentConfiguration = {
  autopilot: true,
  allowAll: false
};

export interface AgentExecutionOptions {
  /** Revalidated only when the global execution slot is actually acquired. */
  beforeStart?: () => Promise<void>;
  executionSource?: import("../../../../shared/ExecutionConcurrency.ts").CortexExecutionSource;
  executionLabel?: string;
  executionKey?: string;
  purpose?: "mission" | "interpretation";
  delegation?: "none" | "bounded";
  onProfile?: (profile: ExecutionProfile) => void;
  profile?: ExecutionProfile;
  signal?: AbortSignal;
  onProgress?: (progress: string) => void;
  onTrace?: (entry: import("../../../../shared/ExecutionTrace.ts").ExecutionTraceInput) => void;
  onSessionId?: (sessionId: string) => void;
  skipGitRepoCheck?: boolean;
  configuration?: AgentConfiguration;
  model?: string;
  /** Local image inputs supplied by the user for this turn. */
  imagePaths?: string[];
  /** Constrain the final response when the provider supports structured output. */
  outputSchema?: Record<string, unknown>;
  persistSession?: boolean;
  /** Restrict internal generation to the provider's read-only or planning mode. */
  readOnly?: boolean;
  reasoningEffort?: string;
  sessionId?: string;
  workingDirectory?: string;
}

export interface AgentExecutionResult {
  profile?: ExecutionProfile;
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
