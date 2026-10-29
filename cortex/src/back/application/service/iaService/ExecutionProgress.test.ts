import assert from "node:assert/strict";
import { test } from "node:test";
import { createCodexProgress, createClaudeProgress } from "./ExecutionProgress.ts";
import type { ExecutionTraceInput } from "../../../../shared/ExecutionTrace.ts";
import type { TokenUsage } from "../../../../shared/TokenUsage.ts";

test("usage tracks turn events, never lifetime token-count or context snapshots", () => {
  const usages: TokenUsage[] = [];
  const report = createCodexProgress(undefined, undefined, undefined, usage => usages.push(usage));
  const events = [
    { type: "token_count", usage: { input_tokens: 999999, output_tokens: 999999 } },
    { type: "turn.completed", usage: { input_tokens: 100, cached_input_tokens: 70, output_tokens: 20, reasoning_output_tokens: 5 } },
    { type: "turn.completed" },
    { type: "turn.failed", usage: { input_tokens: 10, output_tokens: 0 } }
  ].map(event => JSON.stringify(event)).join("\n") + "\n";
  report(events.slice(0, 155)); report(events.slice(155));
  assert.deepEqual(usages.map(usage => usage.totalTokens), [120, 10]);
  assert.equal(usages[0].cachedInputTokens, 70);
});

test("Claude uses the result aggregate once, including on error, instead of summing message snapshots", () => {
  const usages: TokenUsage[] = [];
  const report = createClaudeProgress(undefined, undefined, usage => usages.push(usage));
  const usage = { input_tokens: 10, cache_read_input_tokens: 70, cache_creation_input_tokens: 20, output_tokens: 15 };
  report(JSON.stringify({ type: "assistant", message: { content: [], usage } }) + "\n");
  report(JSON.stringify({ type: "result", is_error: true, result: "Stopped", usage }) + "\n");
  assert.equal(usages.length, 1);
  assert.equal(usages[0].totalTokens, 115);
});

test("Codex session is reported from streamed events before a turn finishes, including split chunks", () => {
  const sessions: string[] = [], progress: string[] = [];
  const report = createCodexProgress(text => progress.push(text), id => sessions.push(id));
  report('{"type":"thread.started","thread_');
  report('id":"session-one"}\n');
  report('{"type":"item.completed","item":{"type":"agent_message","text":"Answer"}}\n');
  assert.deepEqual(sessions, ["session-one"]);
  assert.equal(progress.at(-1), "Answer");
});

test("Codex journals full public messages and tool activity once, with bounded outputs and no reasoning", () => {
  const traces: ExecutionTraceInput[] = [], previews: string[] = [];
  const report = createCodexProgress(text => previews.push(text), undefined, entry => traces.push(entry));
  const text = "Reading files. ".repeat(500);
  const events = [
    { type: "item.started", item: { type: "agent_message", text } },
    { type: "item.completed", item: { type: "agent_message", text } },
    { type: "item.completed", item: { type: "reasoning", text: "PRIVATE_REASONING" } },
    { type: "item.started", item: { type: "command_execution", command: "npm test", status: "in_progress" } },
    { type: "item.completed", item: { type: "command_execution", command: "npm test", status: "completed", exit_code: 0, aggregated_output: "x".repeat(1_100_000) } },
    { type: "turn.failed", error: { message: "Engine disconnected" } }
  ].map(event => JSON.stringify(event)).join("\n") + "\n";
  for (let offset = 0; offset < events.length; offset += 100_000) report(events.slice(offset, offset + 100_000));
  assert.equal(traces.length, 4);
  assert.equal(traces[0].content, text);
  assert.ok(previews.every(preview => preview.length <= 4000));
  assert.equal(traces[1].kind, "tool");
  assert.match(traces[2].content, /npm test\ncompleted \(exit 0\)/);
  assert.equal(traces[2].content.length, 64_000);
  assert.equal(traces[2].truncated, true);
  assert.equal(traces[3].content, "Engine disconnected");
  assert.ok(!JSON.stringify(traces).includes("PRIVATE_REASONING"));
});

test("Claude journals assistant text and tool results without storing deltas or thinking blocks twice", () => {
  const traces: ExecutionTraceInput[] = [];
  const report = createClaudeProgress(undefined, entry => traces.push(entry));
  for (const event of [
    { type: "stream_event", event: { delta: { type: "text_delta", text: "Checking" } } },
    { type: "assistant", message: { content: [ { type: "thinking", thinking: "PRIVATE" }, { type: "text", text: "Checking files" }, { type: "tool_use", name: "Read", input: { file: "README.md" } } ] } },
    { type: "user", message: { content: [{ type: "tool_result", tool_use_id: "read-1", content: [{ type: "text", text: "File contents" }] }] } },
    { type: "result", result: "Checking files" }
  ]) report(JSON.stringify(event) + "\n");
  assert.deepEqual(traces.map(trace => trace.kind), ["message", "tool", "tool"]);
  assert.match(traces[2].content, /File contents/);
  assert.ok(!JSON.stringify(traces).includes("PRIVATE"));
});
