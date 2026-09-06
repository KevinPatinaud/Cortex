import assert from "node:assert/strict";
import test from "node:test";
import { ClaudeAgentProvider } from "./ClaudeAgentProvider.ts";
import type { AgentExecutionOptions } from "../AgentProvider.ts";

class StreamingClaude extends ClaudeAgentProvider {
  input?: string;
  args: string[] = [];
  fail = false;
  protected override async runCommand(_command: string, args: string[], _timeout?: number,
    _directory?: string, input?: string, options: AgentExecutionOptions = {}) {
    this.input = input;
    this.args = args;
    options.onProgress?.(JSON.stringify({ type: "stream_event", event: { delta: { type: "text_delta", text: "Preview" } } }) + "\n");
    return JSON.stringify({ type: "result", result: this.fail ? "Engine failed" : "Final answer", session_id: "session-1", is_error: this.fail });
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
});

test("Claude refuses an error result instead of reporting success", async () => {
  const provider = new StreamingClaude(process.cwd());
  provider.fail = true;
  await assert.rejects(provider.ask("Run"), /Engine failed/);
});
