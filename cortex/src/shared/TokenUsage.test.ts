import assert from "node:assert/strict";
import test from "node:test";
import { addTokenUsage, claudeTokenUsage, codexTokenUsage, tokenUsage } from "./TokenUsage.ts";

test("native cache and reasoning breakdowns do not get counted twice", () => {
  assert.deepEqual(codexTokenUsage({ input_tokens: 100, cached_input_tokens: 80, output_tokens: 20, reasoning_output_tokens: 5 }),
    { inputTokens: 100, outputTokens: 20, totalTokens: 120, cachedInputTokens: 80, reasoningOutputTokens: 5 });
  assert.deepEqual(claudeTokenUsage({ input_tokens: 10, cache_read_input_tokens: 80, cache_creation_input_tokens: 10, output_tokens: 20 }),
    { inputTokens: 100, outputTokens: 20, totalTokens: 120, cachedInputTokens: 80, cacheWriteInputTokens: 10 });
});

test("missing counters stay unavailable while measured zero is retained", () => {
  for (const raw of [undefined, {}, { input_tokens: 1 }, { input_tokens: -1, output_tokens: 1 }, { input_tokens: "20", output_tokens: 1 }]) {
    assert.equal(codexTokenUsage(raw), undefined);
  }
  assert.equal(tokenUsage(NaN, 1), undefined);
  assert.deepEqual(tokenUsage(0, 0), { inputTokens: 0, outputTokens: 0, totalTokens: 0 });
  assert.equal(tokenUsage(1, 2)?.cachedInputTokens, undefined);
});

test("aggregation sums reported calls and leaves incomplete details unknown", () => {
  const a = tokenUsage(100, 20, 80, 0, 5)!;
  const b = tokenUsage(30, 10, 20, 0, 2)!;
  assert.deepEqual(addTokenUsage(a, b), { inputTokens: 130, outputTokens: 30, totalTokens: 160,
    cachedInputTokens: 100, cacheWriteInputTokens: 0, reasoningOutputTokens: 7 });
  assert.equal(addTokenUsage(a, tokenUsage(5, 1)!).cachedInputTokens, undefined);
});
