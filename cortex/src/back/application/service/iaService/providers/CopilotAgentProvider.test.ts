import assert from "node:assert/strict";
import test from "node:test";
import type { CopilotClient } from "@github/copilot-sdk";
import { CopilotAgentProvider } from "./CopilotAgentProvider.ts";
import { AgentToolRegistry } from "../iaTools/AgentToolRegistry.ts";
import type { McpConfigurationService } from "../McpConfigurationService.ts";

class TestProvider extends CopilotAgentProvider {
  protected override cleanupTimeoutMs = 20;
  constructor(private readonly client: CopilotClient) {
    super(new AgentToolRegistry(), {
      async getCopilotMcpServers() { return {}; }
    } as unknown as McpConfigurationService);
  }
  protected override createClient() { return this.client; }
}

test("cancels a stuck Copilot session creation and force-stops stuck cleanup", async () => {
  const controller = new AbortController();
  let forced = false;
  const provider = new TestProvider({
    async start() {},
    createSession() {
      controller.abort();
      return new Promise(() => {});
    },
    stop() { return new Promise(() => {}); },
    async forceStop() { forced = true; }
  } as unknown as CopilotClient);
  await assert.rejects(provider.ask("run", { signal: controller.signal }), { name: "AbortError" });
  assert.equal(forced, true);
});

test("a successful Copilot answer survives stuck cleanup and reports streamed text", async () => {
  let forced = false;
  let unsubscribed = false;
  const previews: string[] = [];
  const provider = new TestProvider({
    async start() {},
    async createSession() {
      return {
        sessionId: "test-session",
        on(handler: (event: unknown) => void) {
          handler({ type: "assistant.message_delta", data: { deltaContent: "Preview" } });
          return () => { unsubscribed = true; };
        },
        async sendAndWait() { return { data: { content: "Final" } }; },
        abort() { return new Promise(() => {}); }
      };
    },
    async forceStop() { forced = true; }
  } as unknown as CopilotClient);
  assert.deepEqual(await provider.ask("run", { onProgress: (text) => previews.push(text) }), {
    answer: "Final", sessionId: "test-session"
  });
  assert.deepEqual(previews, ["Preview"]);
  assert.equal(unsubscribed, true);
  assert.equal(forced, true);
});
