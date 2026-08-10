
import { existsSync } from "node:fs";
import path from "node:path";
import type { AgentProvider } from "../AgentProvider.ts";
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

  async ask(prompt: string, model?: string): Promise<string> {
    const args = [
      "exec",
      "--ephemeral",
      "--sandbox",
      "read-only",
      "--color",
      "never"
    ];

    if (model) {
      args.push("--model", model);
    }

    args.push(prompt);
    const answer = await this.runCommand(this.command, [
      ...this.argumentPrefix,
      ...args
    ]);

    if (!answer) {
      throw new Error("Codex n'a renvoye aucune reponse.");
    }

    return answer;
  }
}
