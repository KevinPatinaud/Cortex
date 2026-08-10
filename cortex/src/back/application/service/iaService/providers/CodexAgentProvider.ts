
import { existsSync } from "node:fs";
import path from "node:path";
import type {
  AgentExecutionOptions,
  AgentExecutionResult,
  AgentProvider
} from "../AgentProvider.ts";
import { CliAgentProvider } from "../CliAgentProvider.ts";

export class CodexAgentProvider extends CliAgentProvider implements AgentProvider {
  readonly engine = "codex" as const;
  readonly label = "Codex";
  private readonly command: string;
  private readonly argumentPrefix: string[];

  constructor(workingDirectory: string) {
    super(workingDirectory);

    const npmCodexScript = process.env.APPDATA
      ? path.join(
          process.env.APPDATA,
          "npm",
          "node_modules",
          "@openai",
          "codex",
          "bin",
          "codex.js"
        )
      : "";

    if (process.platform === "win32" && npmCodexScript && existsSync(npmCodexScript)) {
      this.command = process.execPath;
      this.argumentPrefix = [npmCodexScript];
    } else {
      this.command = "codex";
      this.argumentPrefix = [];
    }
  }

  async isAvailable(): Promise<boolean> {
    return this.commandSucceeds(this.command, [
      ...this.argumentPrefix,
      "login",
      "status"
    ]);
  }

  async ask(
    prompt: string,
    options: AgentExecutionOptions = {}
  ): Promise<AgentExecutionResult> {
    const args = options.sessionId
      ? [
          "exec",
          "resume",
          "--json",
          "--config",
          "sandbox_mode=\"read-only\""
        ]
      : [
          "exec",
          "--json",
          "--sandbox",
          "read-only",
          "--color",
          "never"
        ];

    if (!options.sessionId && !options.persistSession) {
      args.push("--ephemeral");
    }

    if (!options.sessionId && options.workingDirectory) {
      args.push("--cd", options.workingDirectory);
    }

    if (options.model) {
      args.push("--model", options.model);
    }

    if (options.reasoningEffort) {
      args.push(
        "--config",
        `model_reasoning_effort=${JSON.stringify(options.reasoningEffort)}`
      );
    }

    if (options.sessionId) {
      args.push(options.sessionId);
    }

    args.push(prompt);
    const output = await this.runCommand(this.command, [
      ...this.argumentPrefix,
      ...args
    ], 120_000, options.workingDirectory);
    const result = parseCodexJsonOutput(output, options.sessionId);

    if (!result.answer) {
      throw new Error("Codex n'a renvoyé aucune réponse.");
    }

    if (!result.sessionId) {
      throw new Error("Codex n'a renvoyé aucun identifiant de session.");
    }

    return result;
  }
}

function parseCodexJsonOutput(
  output: string,
  existingSessionId?: string
): AgentExecutionResult {
  let sessionId = existingSessionId;
  const messages: string[] = [];

  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }

    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      const eventSessionId = readString(event.thread_id) ||
        readString(event.session_id);

      if (eventSessionId) {
        sessionId = eventSessionId;
      }

      const item = readRecord(event.item);

      if (
        event.type === "item.completed" &&
        item.type === "agent_message"
      ) {
        const message = readString(item.text) || readString(item.content);

        if (message) {
          messages.push(message);
        }
      }
    } catch {
      // Ignore les éventuelles lignes non JSON de la sortie CLI.
    }
  }

  return {
    answer: messages.at(-1) || "",
    ...(sessionId ? { sessionId } : {})
  };
}

function readRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : null;
}
