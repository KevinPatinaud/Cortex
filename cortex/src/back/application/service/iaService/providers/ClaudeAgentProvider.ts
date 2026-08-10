
import type { AgentProvider } from "../AgentProvider.ts";
import { CliAgentProvider } from "../CliAgentProvider.ts";

export class ClaudeAgentProvider extends CliAgentProvider implements AgentProvider {
  readonly engine = "claude" as const;
  readonly label = "Claude";

  async isAvailable(): Promise<boolean> {
    return this.commandSucceeds("claude", ["--version"]);
  }

  async ask(prompt: string, model?: string): Promise<string> {
    const args = [
      "--print",
      prompt,
      "--output-format",
      "text",
      "--permission-mode",
      "plan"
    ];

    if (model) {
      args.push("--model", model);
    }

    const answer = await this.runCommand("claude", args);

    if (!answer) {
      throw new Error("Claude n'a renvoye aucune reponse.");
    }

    return answer;
  }
}
