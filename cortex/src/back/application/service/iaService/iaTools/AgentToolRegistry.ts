import type { SessionConfig } from "@github/copilot-sdk";
import {
  createGitHubPullRequestFilesTool,
  createGitHubPullRequestsTool
} from "./GitHubPullRequestsTool.ts";

export const GITHUB_PULL_REQUESTS_CAPABILITY = "github.pull-requests";

type AgentTool = NonNullable<SessionConfig["tools"]>[number];
type AgentToolFactory = () => AgentTool;

export class AgentToolRegistry {
  private readonly factoriesByCapability = new Map<string, AgentToolFactory[]>();

  register(capability: string, ...factories: AgentToolFactory[]): this {
    const registeredFactories = this.factoriesByCapability.get(capability) ?? [];
    registeredFactories.push(...factories);
    this.factoriesByCapability.set(capability, registeredFactories);
    return this;
  }

  resolve(capabilities: readonly string[]): AgentTool[] {
    const tools: AgentTool[] = [];
    const toolNames = new Set<string>();

    for (const capability of new Set(capabilities)) {
      for (const factory of this.factoriesByCapability.get(capability) ?? []) {
        const tool = factory();

        if (toolNames.has(tool.name)) {
          throw new Error(`L'outil d'agent ${tool.name} est enregistré plusieurs fois.`);
        }

        toolNames.add(tool.name);
        tools.push(tool);
      }
    }

    return tools;
  }
}

export function createDefaultAgentToolRegistry(): AgentToolRegistry {
  return new AgentToolRegistry().register(
    GITHUB_PULL_REQUESTS_CAPABILITY,
    createGitHubPullRequestsTool,
    createGitHubPullRequestFilesTool
  );
}