import assert from "node:assert/strict";
import test from "node:test";
import { CodexAgentProvider } from "./CodexAgentProvider.ts";

class CapturingCodexAgentProvider extends CodexAgentProvider {
  capturedArgs: string[] = [];

  protected override async runCommand(
    _command: string,
    args: string[]
  ): Promise<string> {
    this.capturedArgs = [...args];

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
