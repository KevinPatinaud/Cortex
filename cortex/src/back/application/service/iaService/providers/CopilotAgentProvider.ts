
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
import {
  AgentToolRegistry,
  GITHUB_PULL_REQUESTS_CAPABILITY
} from "../iaTools/AgentToolRegistry.ts";

type CopilotSession = Awaited<ReturnType<CopilotClient["createSession"]>>;

export class CopilotAgentProvider implements AgentProvider {
  readonly engine = "copilot" as const;
  readonly label = "GitHub Copilot";

  constructor(private readonly toolRegistry: AgentToolRegistry) {}

  async isAvailable(): Promise<boolean> {
    const client = new CopilotClient({ useLoggedInUser: true });

    try {
      await this.withinTimeout(client.start(), 10_000);
      await this.withinTimeout(client.listModels(), 10_000);
      return true;
    } catch {
      return false;
    } finally {
      await client.stop().catch(() => undefined);
    }
  }

  async ask(
    prompt: string,
    options: AgentExecutionOptions = {}
  ): Promise<AgentExecutionResult> {
    const client = new CopilotClient({ useLoggedInUser: true });
    let session: CopilotSession | undefined;

    try {
      await this.withinTimeout(client.start(), 30_000);
      const sessionConfiguration: SessionConfig = {
        onPermissionRequest: approveAll,
        tools: this.toolRegistry.resolve([GITHUB_PULL_REQUESTS_CAPABILITY])
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

      session = options.sessionId
        ? await client.resumeSession(options.sessionId, sessionConfiguration)
        : await client.createSession(sessionConfiguration);
      const result = await session.sendAndWait({ prompt }, 300_000);
      const answer = result?.data.content;

      if (!answer) {
        throw new Error("Copilot n'a renvoyé aucune réponse.");
      }

      return {
        answer,
        sessionId: session.sessionId
      };
    } finally {
      await session?.disconnect();
      await client.stop();
    }
  }

  private withinTimeout<T>(promise: Promise<T>, timeout: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<never>((_resolve, reject) => {
        setTimeout(() => reject(new Error("Le moteur Copilot n'a pas répondu à temps.")), timeout);
      })
    ]);
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
