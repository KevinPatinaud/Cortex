/** Engine-reported counts for this invocation, never session lifetime totals. */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** Included in inputTokens; never add these a second time. */
  cachedInputTokens?: number;
  cacheWriteInputTokens?: number;
  /** Included in outputTokens. */
  reasoningOutputTokens?: number;
}

export type ExecutionUsagePhase = "mission" | "interpretation";
export interface ExecutionTokenUsage {
  mission?: TokenUsage;
  interpretation?: TokenUsage;
  total: TokenUsage;
}

function count(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

export function tokenUsage(input: unknown, output: unknown, cached?: unknown, written?: unknown, reasoning?: unknown): TokenUsage | undefined {
  const inputTokens = count(input), outputTokens = count(output);
  if (inputTokens === undefined || outputTokens === undefined || !Number.isSafeInteger(inputTokens + outputTokens)) return undefined;
  return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens,
    ...(count(cached) !== undefined ? { cachedInputTokens: count(cached) } : {}),
    ...(count(written) !== undefined ? { cacheWriteInputTokens: count(written) } : {}),
    ...(count(reasoning) !== undefined ? { reasoningOutputTokens: count(reasoning) } : {}) };
}

export function addTokenUsage(previous: TokenUsage | undefined, next: TokenUsage): TokenUsage {
  if (!previous) return { ...next };
  const sumDetail = (key: "cachedInputTokens" | "cacheWriteInputTokens" | "reasoningOutputTokens") =>
    previous[key] !== undefined && next[key] !== undefined ? previous[key]! + next[key]! : undefined;
  return tokenUsage(previous.inputTokens + next.inputTokens, previous.outputTokens + next.outputTokens,
    sumDetail("cachedInputTokens"), sumDetail("cacheWriteInputTokens"), sumDetail("reasoningOutputTokens"))!;
}

export function codexTokenUsage(raw: any): TokenUsage | undefined {
  return tokenUsage(raw?.input_tokens, raw?.output_tokens, raw?.cached_input_tokens, undefined, raw?.reasoning_output_tokens);
}

export function claudeTokenUsage(raw: any): TokenUsage | undefined {
  if (count(raw?.input_tokens) === undefined || count(raw?.output_tokens) === undefined) return undefined;
  // Claude reports uncached input separately from cache reads and cache writes.
  return tokenUsage(raw.input_tokens + (count(raw.cache_read_input_tokens) ?? 0) + (count(raw.cache_creation_input_tokens) ?? 0),
    raw.output_tokens, raw.cache_read_input_tokens, raw.cache_creation_input_tokens, raw.output_tokens_details?.thinking_tokens);
}
