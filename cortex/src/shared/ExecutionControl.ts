export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens?: number;
}

export interface ProjectExecutionPolicy {
  paused: boolean;
  maxCallsPerDay: number | null;
  maxTokensPerDay: number | null;
  maxCallsPerRun: number | null;
}

export const DEFAULT_EXECUTION_POLICY: ProjectExecutionPolicy = {
  paused: false, maxCallsPerDay: null, maxTokensPerDay: null, maxCallsPerRun: null
};

export interface ProjectExecutionUsage {
  day: string;
  calls: number;
  measuredCalls: number;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  activeCalls: number;
}

export interface ProjectExecutionControl {
  policy: ProjectExecutionPolicy;
  usage: ProjectExecutionUsage;
  server: { activeCalls: number; queuedCalls: number; maxConcurrentCalls: number };
}

/** Unknown usage remains unknown; never manufacture zero-token measurements. */
export function readTokenUsage(input: unknown, output: unknown, cached?: unknown): TokenUsage | undefined {
  if (!Number.isSafeInteger(input) || Number(input) < 0 || !Number.isSafeInteger(output) || Number(output) < 0) return;
  return { inputTokens: Number(input), outputTokens: Number(output),
    ...(Number.isSafeInteger(cached) && Number(cached) >= 0 ? { cachedInputTokens: Number(cached) } : {}) };
}
