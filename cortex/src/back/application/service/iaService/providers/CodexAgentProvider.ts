
import { existsSync } from "node:fs";
import path from "node:path";
import type {
  AgentExecutionOptions,
  AgentExecutionResult,
  AgentProvider
} from "../AgentProvider.ts";
import { DEFAULT_AGENT_CONFIGURATION } from "../AgentProvider.ts";
import { CliAgentProvider } from "../CliAgentProvider.ts";

const AGENT_EXECUTION_TIMEOUT_MS = 15 * 60 * 1000;

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
    const configuration = options.configuration ?? DEFAULT_AGENT_CONFIGURATION;
    // Cortex orchestre lui-même les instances du workflow. Désactiver le
    // multi-agent interne de Codex évite qu'une instruction métier demandant
    // de lancer l'étape suivante consomme les threads de collaboration Codex.
    const args = ["exec", "--disable", "multi_agent"];

    if (!configuration.autopilot) {
      args.push("--config", "sandbox_mode=\"read-only\"");
    } else if (configuration.allowAll) {
      args.push("--dangerously-bypass-approvals-and-sandbox");
    } else {
      args.push("--approve-for-me");
    }

    if (options.sessionId) {
      args.push("resume", "--json");
    } else {
      args.push("--json", "--color", "never");
    }

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
    ], AGENT_EXECUTION_TIMEOUT_MS, options.workingDirectory);
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
