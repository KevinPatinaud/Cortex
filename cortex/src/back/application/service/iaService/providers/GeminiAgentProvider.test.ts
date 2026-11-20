import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { GeminiAgentProvider } from "./GeminiAgentProvider.ts";
import type { AgentExecutionOptions } from "../AgentProvider.ts";
import { CliAgentProcessError } from "../CliAgentProvider.ts";

class StreamingGemini extends GeminiAgentProvider {
  command?: string;
  input?: string;
  args: string[] = [];
  timeout: number | undefined;
  schemaContent?: string;
  fail = false;
  exitError = false;
  structuredOutput?: Record<string, unknown>;
  usage?: Record<string, number>;

  protected override async runCommand(
    command: string,
    args: string[],
    timeout?: number,
    _directory?: string,
    input?: string,
    options: Pick<AgentExecutionOptions, "signal" | "onProgress"> = {}
  ) {
    this.command = command;
    this.args = args;
    this.timeout = timeout;
    this.input = input;
    const schemaArg = args.find((arg) => arg.startsWith("--json-schema="));
    if (schemaArg) {
      this.schemaContent = await readFile(schemaArg.slice("--json-schema=".length), "utf8");
    }

    const lines = [
      JSON.stringify({ event: "init", conversation_id: "conv-gemini-1" }),
      JSON.stringify({
        event: "step_update",
        step_update: {
          conversation_id: "conv-gemini-1",
          step_index: 1,
          state: "ACTIVE",
          step_type: "agent_response",
          text_delta: "Preview"
        }
      }),
      JSON.stringify({
        event: "result",
        result: {
          conversation_id: "conv-gemini-1",
          status: this.fail ? "ERROR" : "SUCCESS",
          response: this.fail ? "" : "Final Gemini answer\n",
          ...(this.fail ? { error: "Gemini engine failed" } : {}),
          ...(this.structuredOutput ? { structured_output: this.structuredOutput } : {}),
          ...(this.usage ? { usage: this.usage } : {})
        }
      })
    ];

    const payload = `${lines.join("\n")}\n`;
    options.onProgress?.(payload);
    if (this.exitError) {
      throw new CliAgentProcessError(payload, "cli failed", 1);
    }
    return payload.trim();
  }
}

test("Gemini streams previews, sends prompt via stream-json stdin, and returns session and answer", async () => {
  const provider = new StreamingGemini(process.cwd());
  const previews: string[] = [];
  const sessions: string[] = [];
  const result = await provider.ask("Large prompt", {
    model: "gemini-4-argon-medium",
    reasoningEffort: "medium",
    configuration: { autopilot: true, allowAll: true },
    onProgress: (text) => previews.push(text),
    onSessionId: (id) => sessions.push(id)
  });

  assert.deepEqual(result, { answer: "Final Gemini answer", sessionId: "conv-gemini-1" });
  assert.deepEqual(sessions, ["conv-gemini-1"]);
  assert.equal(previews.includes("Preview"), true);
  assert.equal(provider.args.includes("--input-format=stream-json"), true);
  assert.equal(provider.args.includes("--output-format=stream-json"), true);
  assert.equal(provider.args.includes("--model=gemini-4-argon-medium"), true);
  assert.equal(provider.args.includes("--effort=medium"), true);
  assert.equal(provider.args.includes("--dangerously-skip-permissions"), true);
  assert.equal(provider.args.includes("Large prompt"), false);
  assert.deepEqual(JSON.parse(provider.input!.trim()), {
    event: "user",
    message: { content: "Large prompt" }
  });
  assert.equal(provider.timeout, undefined);
});

test("Gemini passes JSON schema via temp file, supports session resume, and reports token usage", async () => {
  const provider = new StreamingGemini(process.cwd());
  provider.structuredOutput = { status: "completed", items: [] };
  provider.usage = { input_tokens: 1000, output_tokens: 50, cache_read_tokens: 200, thinking_tokens: 10, total_tokens: 1050 };
  const totals: number[] = [];

  const result = await provider.ask("Structured turn", {
    sessionId: "existing-conv",
    outputSchema: { type: "object", properties: { status: { type: "string" } } },
    onUsage: (usage) => totals.push(usage.totalTokens)
  });

  assert.equal(result.answer, JSON.stringify({ status: "completed", items: [] }));
  assert.equal(result.usage?.totalTokens, 1050);
  assert.equal(result.usage?.cachedInputTokens, 200);
  assert.equal(result.usage?.reasoningOutputTokens, 10);
  assert.deepEqual(totals, [1050]);
  assert.equal(provider.args.includes("--conversation=existing-conv"), true);
  assert.deepEqual(JSON.parse(provider.schemaContent!), { type: "object", properties: { status: { type: "string" } } });
});

test("Gemini rejects error results and CLI failures while still reporting usage", async () => {
  const provider = new StreamingGemini(process.cwd());
  provider.fail = true;
  provider.usage = { input_tokens: 100, output_tokens: 10 };
  const totals: number[] = [];

  await assert.rejects(
    provider.ask("Run", { onUsage: (usage) => totals.push(usage.totalTokens) }),
    /Gemini engine failed/
  );
  assert.deepEqual(totals, [110]);

  provider.exitError = true;
  await assert.rejects(provider.ask("Run"), /Gemini engine failed/);
});
