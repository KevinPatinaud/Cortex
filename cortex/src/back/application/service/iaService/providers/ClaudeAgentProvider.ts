
import { randomUUID } from "node:crypto";
import type {
  AgentExecutionOptions,
  AgentExecutionResult,
  AgentProvider
} from "../AgentProvider.ts";
import { DEFAULT_AGENT_CONFIGURATION } from "../AgentProvider.ts";
import { CliAgentProvider } from "../CliAgentProvider.ts";
import { createClaudeProgress } from "../ExecutionProgress.ts";

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
    const configuration = options.configuration ?? DEFAULT_AGENT_CONFIGURATION;
    const sessionId = options.sessionId ||
      (options.persistSession ? randomUUID() : undefined);
    const permissionMode = !configuration.autopilot
      ? "plan"
      : configuration.allowAll
        ? "bypassPermissions"
        : "auto";
    const args = [
      "--print",
      "--output-format",
      "stream-json",
      "--verbose",
      "--include-partial-messages",
      "--permission-mode",
      permissionMode
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

    const output = await this.runCommand(
      "claude",
      args,
      options.timeoutMs ?? 15 * 60 * 1000,
      options.workingDirectory,
      prompt,
      { signal: options.signal, onProgress: createClaudeProgress(options.onProgress) }
    );

    const result = output.split(/\r?\n/).flatMap((line) => {
      try {
        const value = JSON.parse(line);
        return value?.type === "result" ? [value] : [];
      } catch { return []; }
    }).at(-1);
    if (result?.is_error) {
      throw new Error(typeof result.result === "string" ? result.result : "Claude execution failed.");
    }
    const answer: string = typeof result?.result === "string" ? result.result : "";
    const effectiveSessionId = typeof result?.session_id === "string" ? result.session_id : sessionId;

    if (!answer) {
      throw new Error("Claude did not return a response.");
    }

    return {
      answer,
      ...(effectiveSessionId ? { sessionId: effectiveSessionId } : {})
    };
  }
}
