
import { randomUUID } from "node:crypto";
import type {
  AgentExecutionOptions,
  AgentExecutionResult,
  AgentProvider
} from "../AgentProvider.ts";
import { CliAgentProvider } from "../CliAgentProvider.ts";

export class ClaudeAgentProvider extends CliAgentProvider implements AgentProvider {
  readonly engine = "claude" as const;
  readonly label = "Claude";

  async isAvailable(): Promise<boolean> {
    return this.commandSucceeds("claude", ["--version"]);
  }

  async ask(
    prompt: string,
    options: AgentExecutionOptions = {}
  ): Promise<AgentExecutionResult> {
    const sessionId = options.sessionId ||
      (options.persistSession ? randomUUID() : undefined);
    const args = [
      "--print",
      "--output-format",
      "text",
      "--permission-mode",
      "plan"
    ];

    if (sessionId) {
      args.push(
        options.sessionId ? "--resume" : "--session-id",
        sessionId
      );
    }

    if (options.model) {
      args.push("--model", options.model);
    }

    if (options.reasoningEffort) {
      args.push("--effort", options.reasoningEffort);
    }

    args.push(prompt);

    const answer = await this.runCommand(
      "claude",
      args,
      120_000,
      options.workingDirectory
    );

    if (!answer) {
      throw new Error("Claude n'a renvoye aucune reponse.");
    }

    return {
      answer,
      ...(sessionId ? { sessionId } : {})
    };
  }
}
