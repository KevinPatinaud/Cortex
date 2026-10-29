
import {
  approveAll,
  CopilotClient,
  type SessionConfig
} from "@github/copilot-sdk";
import type {
  AgentExecutionOptions,
  AgentExecutionResult,
  AgentProvider
} from "../AgentProvider.ts";
import { DEFAULT_AGENT_CONFIGURATION } from "../AgentProvider.ts";
import {
  AgentToolRegistry,
  GITHUB_PULL_REQUESTS_CAPABILITY
} from "../iaTools/AgentToolRegistry.ts";
import { McpConfigurationService } from "../McpConfigurationService.ts";
import { createTextProgress } from "../ExecutionProgress.ts";
import { boundedExecutionTrace } from "../../../../../shared/ExecutionTrace.ts";

type CopilotSession = Awaited<ReturnType<CopilotClient["createSession"]>>;

export class CopilotAgentProvider implements AgentProvider {
  readonly engine = "copilot" as const;
  readonly label = "GitHub Copilot";
  protected cleanupTimeoutMs = 2_000;

  protected createClient(): CopilotClient {
    return new CopilotClient({ useLoggedInUser: true });
  }

  constructor(
    private readonly toolRegistry: AgentToolRegistry,
    private readonly mcpConfigurationService = new McpConfigurationService()
  ) {}

  async isAvailable(): Promise<boolean> {
    const client = this.createClient();

    try {
      await this.withinTimeout(client.start(), 10_000);
      await this.withinTimeout(client.listModels(), 10_000);
      return true;
    } catch {
      return false;
    } finally {
      await this.cleanup(client);
    }
  }

  async ask(
    prompt: string,
    options: AgentExecutionOptions = {}
  ): Promise<AgentExecutionResult> {
    options.signal?.throwIfAborted();
    const configuration = options.configuration ?? DEFAULT_AGENT_CONFIGURATION;
    const client = this.createClient();
    let session: CopilotSession | undefined;
    let unsubscribe: (() => void) | undefined;
    const abort = (): void => { void session?.abort().catch(() => undefined); };
    options.signal?.addEventListener("abort", abort, { once: true });

    try {
      await this.withinTimeout(client.start(), 30_000, options.signal);
      const sessionConfiguration: SessionConfig = {
        streaming: true,
        onPermissionRequest: configuration.allowAll && configuration.autopilot
          ? approveAll
          : () => ({
              kind: "reject",
              feedback: "The global configuration does not allow this action."
            }),
        tools: this.toolRegistry.resolve([GITHUB_PULL_REQUESTS_CAPABILITY]),
        mcpServers: await this.withinTimeout(this.mcpConfigurationService.getCopilotMcpServers(
          options.workingDirectory
        ), 30_000, options.signal),
        mcpOAuthTokenStorage: "persistent",
        enableConfigDiscovery: true
      };

      if (options.workingDirectory) {
        sessionConfiguration.workingDirectory = options.workingDirectory;
      }

      if (options.model) {
        sessionConfiguration.model = options.model;
      }

      if (isCopilotReasoningEffort(options.reasoningEffort)) {
        sessionConfiguration.reasoningEffort = options.reasoningEffort;
      }

      session = await this.withinTimeout(options.sessionId
        ? client.resumeSession(options.sessionId, sessionConfiguration)
        : client.createSession(sessionConfiguration), 30_000, options.signal);
      options.signal?.throwIfAborted();
      const reportText = createTextProgress(options.onProgress);
      unsubscribe = session.on((event) => {
        if (event.type === "assistant.message_delta") {
          reportText(event.data.deltaContent);
        } else if (event.type === "assistant.message") {
          options.onProgress?.(event.data.content.slice(-4_000));
          options.onTrace?.(boundedExecutionTrace({ kind: "message", content: event.data.content }));
        } else if (event.type === "tool.execution_start" || event.type === "tool.execution_complete") {
          options.onTrace?.(boundedExecutionTrace({ kind: "tool", content: `${event.type}\n${JSON.stringify(event.data, null, 2)}` }));
          options.onProgress?.("");
        } else {
          options.onProgress?.("");
        }
      });
      const answer = await this.waitForAnswer(session, prompt,
        configuration.autopilot ? "autopilot" : "plan", options.signal);

      if (!answer) {
        throw new Error("Copilot did not return a response.");
      }

      return {
        answer,
        sessionId: session.sessionId
      };
    } finally {
      options.signal?.removeEventListener("abort", abort);
      unsubscribe?.();
      await this.cleanup(client, session);
    }
  }

  private async waitForAnswer(
    session: CopilotSession,
    prompt: string,
    agentMode: "autopilot" | "plan",
    signal?: AbortSignal
  ): Promise<string | undefined> {
    let answer: string | undefined;
    let finish!: (error?: Error) => void;
    // The SDK's sendAndWait always installs a timer, even for zero/Infinity.
    // Subscribe before sending so a fast completion cannot be missed.
    const completed = new Promise<Error | undefined>((resolve) => { finish = resolve; });
    const unsubscribe = session.on((event) => {
      if (event.type === "assistant.message") answer = event.data.content;
      else if (event.type === "session.idle") finish();
      else if (event.type === "session.error") finish(new Error(event.data.message));
    });
    try {
      return await this.withinTimeout((async () => {
        await session.send({ prompt, agentMode });
        const error = await completed;
        if (error) throw error;
        return answer;
      })(), undefined, signal);
    } finally {
      unsubscribe();
    }
  }

  private async cleanup(client: CopilotClient, session?: CopilotSession): Promise<void> {
    try {
      await this.withinTimeout((async () => {
        await session?.abort();
        await session?.disconnect();
        const errors = await client.stop();
        if (errors.length) throw errors[0];
      })(), this.cleanupTimeoutMs);
    } catch {
      await this.withinTimeout(client.forceStop(), this.cleanupTimeoutMs).catch(() => undefined);
    }
  }

  private async withinTimeout<T>(promise: Promise<T>, timeout: number | undefined, signal?: AbortSignal): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    let onAbort: (() => void) | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_resolve, reject) => {
          onAbort = () => reject(new DOMException("The execution was cancelled.", "AbortError"));
          if (timeout !== undefined) {
            timer = setTimeout(() => reject(new Error("The Copilot engine timed out.")), timeout);
          }
          signal?.addEventListener("abort", onAbort, { once: true });
          if (signal?.aborted) onAbort();
        })
      ]);
    } finally {
      clearTimeout(timer);
      if (onAbort) signal?.removeEventListener("abort", onAbort);
    }
  }
}

function isCopilotReasoningEffort(
  value: string | undefined
): value is "low" | "medium" | "high" | "xhigh" | "max" {
  return value === "low" ||
    value === "medium" ||
    value === "high" ||
    value === "xhigh" ||
    value === "max";
}
