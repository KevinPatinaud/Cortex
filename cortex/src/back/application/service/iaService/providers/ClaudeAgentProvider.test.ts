import assert from "node:assert/strict";
import test from "node:test";
import { ClaudeAgentProvider } from "./ClaudeAgentProvider.ts";
import type { AgentExecutionOptions } from "../AgentProvider.ts";

class StreamingClaude extends ClaudeAgentProvider {
  input?: string;
  args: string[] = [];
  timeout: number | undefined;
  fail = false;
  usage?: Record<string, number>;
  protected override async runCommand(_command: string, args: string[], _timeout?: number,
    _directory?: string, input?: string, options: AgentExecutionOptions = {}) {
    this.input = input;
    this.timeout = _timeout;
    this.args = args;
    options.onProgress?.(JSON.stringify({ type: "stream_event", event: { delta: { type: "text_delta", text: "Preview" } } }) + "\n");
    return JSON.stringify({ type: "result", result: this.fail ? "Engine failed" : "Final answer", session_id: "session-1", is_error: this.fail, usage: this.usage });
  }
}

test("Claude streams a preview and returns only the final answer with its session", async () => {
  const provider = new StreamingClaude(process.cwd());
  const previews: string[] = [];
  const result = await provider.ask("Large prompt", { onProgress: (text) => previews.push(text) });
  assert.deepEqual(result, { answer: "Final answer", sessionId: "session-1" });
  assert.deepEqual(previews, ["Preview"]);
  assert.equal(provider.input, "Large prompt");
  assert.equal(provider.args.includes("Large prompt"), false);
  assert.equal(provider.args.includes("--include-partial-messages"), true);
  assert.equal(provider.timeout, undefined);
});

test("Claude reports current CLI result usage including errors, with cache included in input", async () => {
  const provider = new StreamingClaude(process.cwd());
  provider.usage = { input_tokens: 5, cache_read_input_tokens: 80, cache_creation_input_tokens: 15, output_tokens: 20 };
  const totals: number[] = [];
  const options = { onUsage: (usage: { totalTokens: number }) => totals.push(usage.totalTokens) };
  assert.equal((await provider.ask("Run", options)).usage?.totalTokens, 120);
  assert.deepEqual(totals, [120]);
  provider.fail = true;
  await assert.rejects(provider.ask("Run", options), /Engine failed/);
  assert.deepEqual(totals, [120, 120]);
});

test("Claude refuses an error result instead of reporting success", async () => {
  const provider = new StreamingClaude(process.cwd());
  provider.fail = true;
  await assert.rejects(provider.ask("Run"), /Engine failed/);
});
