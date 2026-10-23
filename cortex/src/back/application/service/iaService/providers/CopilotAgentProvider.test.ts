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
  const handlers = new Set<(event: unknown) => void>();
  const provider = new TestProvider({
    async start() {},
    async createSession() {
      return {
        sessionId: "test-session",
        on(handler: (event: unknown) => void) {
          handlers.add(handler);
          return () => { handlers.delete(handler); unsubscribed = true; };
        },
        async send() {
          for (const event of [
            { type: "assistant.message_delta", data: { deltaContent: "Preview" } },
            { type: "assistant.message", data: { content: "Final" } },
            { type: "session.idle", data: {} }
          ]) for (const handler of handlers) handler(event);
          return "message-id";
        },
        abort() { return new Promise(() => {}); }
      };
    },
    async forceStop() { forced = true; }
  } as unknown as CopilotClient);
  assert.deepEqual(await provider.ask("run", { onProgress: (text) => previews.push(text) }), {
    answer: "Final", sessionId: "test-session"
  });
  assert.deepEqual(previews, ["Preview", "Final", ""]);
  assert.equal(unsubscribed, true);
  assert.equal(handlers.size, 0);
  assert.equal(forced, true);
});

function runningSession(send: (emit: (event: unknown) => void) => Promise<string>) {
  const handlers = new Set<(event: unknown) => void>();
  let aborted = false;
  const session = {
    sessionId: "unlimited-session",
    on(handler: (event: unknown) => void) {
      handlers.add(handler);
      return () => { handlers.delete(handler); };
    },
    send() { return send((event) => { for (const handler of handlers) handler(event); }); },
    async abort() { aborted = true; },
    async disconnect() {}
  };
  const provider = new TestProvider({
    async start() {}, async createSession() { return session; }, async stop() { return []; }
  } as unknown as CopilotClient);
  return { provider, handlers, wasAborted: () => aborted };
}

test("Copilot waits for completion beyond the old deadline without the SDK's timed wait", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  const { provider, handlers } = runningSession(async (emit) => {
    await Promise.resolve();
    context.mock.timers.tick(24 * 60 * 60 * 1000);
    emit({ type: "assistant.message", data: { content: "Intermediate" } });
    emit({ type: "assistant.message", data: { content: "Final" } });
    emit({ type: "session.idle", data: {} });
    return "message-id";
  });
  assert.deepEqual(await provider.ask("Run"), { answer: "Final", sessionId: "unlimited-session" });
  assert.equal(handlers.size, 0);
});

test("Copilot remains manually cancellable while waiting indefinitely", async () => {
  const controller = new AbortController();
  const { provider, handlers, wasAborted } = runningSession(async () => {
    controller.abort();
    return new Promise(() => {});
  });
  await assert.rejects(provider.ask("Run", { signal: controller.signal }), { name: "AbortError" });
  assert.equal(wasAborted(), true);
  assert.equal(handlers.size, 0);
});

test("Copilot surfaces session errors and cleans up its event subscriptions", async () => {
  const { provider, handlers } = runningSession(async (emit) => {
    emit({ type: "session.error", data: { message: "Engine failed" } });
    return "message-id";
  });
  await assert.rejects(provider.ask("Run"), /Engine failed/);
  assert.equal(handlers.size, 0);
});

test("Copilot refuses an idle session without an answer", async () => {
  const { provider } = runningSession(async (emit) => {
    emit({ type: "session.idle", data: {} });
    return "message-id";
  });
  await assert.rejects(provider.ask("Run"), /did not return a response/);
});
