import assert from "node:assert/strict";
import test from "node:test";
import { CodexAgentProvider } from "./CodexAgentProvider.ts";

class CapturingCodexAgentProvider extends CodexAgentProvider {
  capturedArgs: string[] = [];
  capturedTimeout: number | undefined;

  protected override async runCommand(
    _command: string,
    args: string[],
    timeout?: number
  ): Promise<string> {
    this.capturedArgs = [...args];
    this.capturedTimeout = timeout;

    return [
      JSON.stringify({ type: "thread.started", thread_id: "session-id" }),
      JSON.stringify({
        type: "item.completed",
        item: { type: "agent_message", text: "reponse" }
      })
    ].join("\n");
  }
}

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
