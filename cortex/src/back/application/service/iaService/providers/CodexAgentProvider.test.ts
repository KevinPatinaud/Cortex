import assert from "node:assert/strict";
import test from "node:test";
import { CodexAgentProvider } from "./CodexAgentProvider.ts";

class CapturingCodexAgentProvider extends CodexAgentProvider {
  capturedArgs: string[] = [];
  capturedTimeout: number | undefined;
  capturedInput: string | undefined;
  usageEvents: unknown[] = [];

  protected override async runCommand(
    _command: string,
    args: string[],
    timeout?: number,
    _workingDirectory?: string,
    input?: string
  ): Promise<string> {
    this.capturedArgs = [...args];
    this.capturedTimeout = timeout;
    this.capturedInput = input;

    return [
      JSON.stringify({ type: "thread.started", thread_id: "session-id" }),
      JSON.stringify({
        type: "item.completed",
        item: { type: "agent_message", text: "reponse" }
      }),
      ...this.usageEvents.map(usage => JSON.stringify({ type: "turn.completed", usage }))
    ].join("\n");
  }
}

test("Codex sums reported turn usage without treating absent measurements as zero", async () => {
  const provider = new CapturingCodexAgentProvider(process.cwd());
  assert.equal((await provider.ask("Run")).usage, undefined);
  provider.usageEvents = [{ input_tokens: 12, output_tokens: 4, cached_input_tokens: 3 }, { input_tokens: 8, output_tokens: 2 }];
  assert.deepEqual((await provider.ask("Run")).usage, { inputTokens: 20, outputTokens: 6, cachedInputTokens: 3 });
});

test("désactive le multi-agent interne quand Cortex lance Codex", async () => {
  const provider = new CapturingCodexAgentProvider(process.cwd());

  await provider.ask("Execute la tache", { persistSession: true });

  const disableIndex = provider.capturedArgs.indexOf("--disable");

  assert.notEqual(disableIndex, -1);
  assert.equal(provider.capturedArgs[disableIndex + 1], "multi_agent");
});

test("laisse quinze minutes aux agents qui manipulent des fichiers ou un navigateur", async () => {
  const provider = new CapturingCodexAgentProvider(process.cwd());

  await provider.ask("Publie le journal", { persistSession: true });

  assert.equal(provider.capturedTimeout, 15 * 60 * 1000);
});

test("transmet les prompts volumineux par stdin au lieu d'un argument", async () => {
  const provider = new CapturingCodexAgentProvider(process.cwd());
  const prompt = "Article de presse.\n".repeat(20_000);

  await provider.ask(prompt, { persistSession: true });

  assert.equal(provider.capturedArgs.at(-1), "-");
  assert.equal(provider.capturedArgs.includes(prompt), false);
  assert.equal(provider.capturedInput, prompt);
});

test("transmet aussi par stdin le prompt d'une session reprise", async () => {
  const provider = new CapturingCodexAgentProvider(process.cwd());

  await provider.ask("Compile la suite du journal", {
    sessionId: "session-id"
  });

  assert.deepEqual(provider.capturedArgs.slice(-2), ["session-id", "-"]);
  assert.equal(provider.capturedInput, "Compile la suite du journal");
});
