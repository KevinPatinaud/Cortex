import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { GeminiAgentProvider } from "./GeminiAgentProvider.ts";
import { createAgentResponseSchema } from "../../../../../shared/AgentResponseSchema.ts";
import { parseAgentResponse } from "../../../../../shared/AgentResponse.ts";
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

test("Gemini adapts nullable object fields like wait in JSON schema and restores null on omitted or inert placeholder wait", async () => {
  const schema = createAgentResponseSchema([".gemini/agents/redacteur-journalistique.md"], false, true);
  const provider = new StreamingGemini(process.cwd());

  // 1. Omitted wait on success is restored to wait: null and accepted by parseAgentResponse.
  provider.structuredOutput = {
    continuity: { summary: "Done", decisions: [], evidence: [], remainingWork: [] },
    acceptance: [],
    status: "success",
    items: [{ content: "Sujet 1" }],
    isMultiSelectionAllowed: true,
    isMultiSelectionThreaded: true,
    nextAgentIds: [".gemini/agents/redacteur-journalistique.md"],
    notes: null
  };
  const omittedResult = await provider.ask("Run", { outputSchema: schema });
  const sentSchema = JSON.parse(provider.schemaContent!);
  assert.equal(sentSchema.required.includes("wait"), false);
  assert.equal(sentSchema.required.includes("status"), true);
  assert.deepEqual(sentSchema.properties.wait.type, ["object", "null"]);
  assert.equal(JSON.parse(omittedResult.answer).wait, null);
  assert.equal(parseAgentResponse(omittedResult.answer)?.status, "success");

  // 2. Inert placeholder wait (no eventKey, no wakeAfterSeconds, empty state) on non-waiting status is normalized to null.
  provider.structuredOutput = {
    ...provider.structuredOutput,
    wait: { reason: "unused", eventKey: null, wakeAfterSeconds: null, deadlineAt: "2026-11-23T04:00:00+01:00", state: "" }
  };
  const placeholderResult = await provider.ask("Run", { outputSchema: schema });
  assert.equal(JSON.parse(placeholderResult.answer).wait, null);
  assert.equal(parseAgentResponse(placeholderResult.answer)?.status, "success");

  // 2b. Placeholder wait with schema-minimum wakeAfterSeconds=1 or non-applicable reason on non-waiting status is normalized to null.
  provider.structuredOutput = {
    ...provider.structuredOutput,
    wait: { reason: "Non applicable (statut success)", eventKey: null, wakeAfterSeconds: 1, deadlineAt: "2026-11-25T04:06:40+01:00", state: "" }
  };
  const minWakePlaceholderResult = await provider.ask("Run", { outputSchema: schema });
  assert.equal(JSON.parse(minWakePlaceholderResult.answer).wait, null);
  assert.equal(parseAgentResponse(minWakePlaceholderResult.answer)?.status, "success");

  provider.structuredOutput = {
    ...provider.structuredOutput,
    wait: { reason: "Aucune attente requise", eventKey: null, wakeAfterSeconds: 60, deadlineAt: "2026-11-25T04:06:40+01:00", state: "" }
  };
  const nonApplicableReasonResult = await provider.ask("Run", { outputSchema: schema });
  assert.equal(JSON.parse(nonApplicableReasonResult.answer).wait, null);
  assert.equal(parseAgentResponse(nonApplicableReasonResult.answer)?.status, "success");

  // 3. A real wait payload on status=success is preserved so parseAgentResponse still fails closed.
  provider.structuredOutput = {
    ...provider.structuredOutput,
    wait: { reason: "Waiting for reply", eventKey: "mail:1", wakeAfterSeconds: 60, deadlineAt: "2026-11-23T05:00:00+01:00", state: "sent" }
  };
  const realWaitOnSuccess = await provider.ask("Run", { outputSchema: schema });
  assert.equal(parseAgentResponse(realWaitOnSuccess.answer), null);

  // 3b. A real timer-only wait payload on status=success is still rejected even with empty state.
  provider.structuredOutput = {
    ...provider.structuredOutput,
    wait: { reason: "Recheck deployment", eventKey: null, wakeAfterSeconds: 180, deadlineAt: "2026-11-25T09:00:00+01:00", state: "" }
  };
  const realTimerWaitOnSuccess = await provider.ask("Run", { outputSchema: schema });
  assert.equal(parseAgentResponse(realTimerWaitOnSuccess.answer), null);

  // 4. A valid waiting response preserves its wait object unchanged.
  provider.structuredOutput = {
    ...provider.structuredOutput,
    status: "waiting",
    nextAgentIds: [],
    wait: { reason: "Waiting for deploy", eventKey: null, wakeAfterSeconds: 180, deadlineAt: "2026-11-23T09:00:00+01:00", state: "step=1" }
  };
  const waitingResult = await provider.ask("Run", { outputSchema: schema });
  assert.equal(parseAgentResponse(waitingResult.answer)?.status, "waiting");
  assert.equal(parseAgentResponse(waitingResult.answer)?.wait?.wakeAfterSeconds, 180);
});
