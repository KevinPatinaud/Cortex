import type { AgentEngine } from "../service/iaService/AgentProvider.ts";
import type {
  AgentService,
  AgentStatus
} from "../service/iaService/AgentService.ts";
import { ValidationError } from "../error/ValidationError.ts";
import { toClaudeAgentDefinitions } from "../mapper/agent/ClaudeAgentMapper.ts";
import { toCodexAgentDefinitions } from "../mapper/agent/CodexAgentMapper.ts";
import { toCopilotAgentDefinitions } from "../mapper/agent/CopilotAgentMapper.ts";
import type {
  ProjectContentOutput,
  ProjectUseCase
} from "./ProjectUseCase.ts";

export type AgentStatusOutput = AgentStatus;

export interface AskAgentInput {
  prompt?: unknown;
  model?: unknown;
}

export interface AgentDefinition {
  name: string;
  description: string;
  model?: string;
  reasoningEffort?: string;
  prompt: string;
}

export interface AgentProject {
  projectId: string;
  engine: AgentEngine;
  agents: AgentDefinition[];
}

type ProjectDirectory = ProjectContentOutput["root"];

interface AgentProjectConfiguration {
  engine: AgentEngine;
  rootDirectory: ".codex" | ".claude" | ".github";
}

const agentProjectConfigurations: AgentProjectConfiguration[] = [
  { engine: "codex", rootDirectory: ".codex" },
  { engine: "claude", rootDirectory: ".claude" },
  { engine: "copilot", rootDirectory: ".github" }
];

export class AgentUseCase {
  private actualLoadedProject: AgentProject | null = null;

  constructor(
    private readonly agentService: AgentService,
    private readonly projectUseCase: ProjectUseCase
  ) {}

  getStatus(): Promise<AgentStatus> {
    return this.agentService.getStatus();
  }

  getActualLoadedProject(): AgentProject | null {
    return this.actualLoadedProject;
  }

  ask(input: AskAgentInput): Promise<string> {
    const prompt = typeof input.prompt === "string"
      ? input.prompt.trim()
      : "";
    const model = typeof input.model === "string" && input.model.trim()
      ? input.model.trim()
      : undefined;

    if (!prompt) {
      throw new ValidationError("Le prompt est obligatoire.");
    }

    return this.agentService.ask(prompt, model);
  }

  async loadProject(projectId: string): Promise<AgentProject> {
    const projectContent = await this.projectUseCase.getProjectContent(projectId);
    const detectedConfigurations = agentProjectConfigurations.filter(
      (configuration) => Boolean(
        this.findChildDirectory(
          projectContent.root,
          configuration.rootDirectory
        )
      )
    );

    if (detectedConfigurations.length === 0) {
      throw new ValidationError(
        "Le projet ne contient aucune configuration Codex, Claude ou Copilot."
      );
    }

    if (detectedConfigurations.length > 1) {
      const engines = detectedConfigurations
        .map((configuration) => configuration.engine)
        .join(", ");

      throw new ValidationError(
        `Le projet contient plusieurs configurations d'agents (${engines}). ` +
        "Une seule configuration est autorisee par projet."
      );
    }

    const configuration = detectedConfigurations[0];
    const configurationDirectory = this.findChildDirectory(
      projectContent.root,
      configuration.rootDirectory
    );
    const agents = configurationDirectory
      ? this.loadAgents(configurationDirectory, configuration.engine)
      : [];

    this.actualLoadedProject = {
      projectId: projectContent.id,
      engine: configuration.engine,
      agents
    };

    return this.actualLoadedProject;
  }

  private loadAgents(
    configurationDirectory: ProjectDirectory,
    engine: AgentEngine
  ): AgentDefinition[] {
    switch (engine) {
      case "codex":
        return toCodexAgentDefinitions(configurationDirectory);
      case "claude":
        return toClaudeAgentDefinitions(configurationDirectory);
      case "copilot":
        return toCopilotAgentDefinitions(configurationDirectory);
    }
  }

  private findChildDirectory(
    directory: ProjectDirectory,
    name: string
  ): ProjectDirectory | null {
    const matchingEntry = directory.children.find(
      (entry) => entry.type === "directory" && entry.name === name
    );

    return matchingEntry?.type === "directory" ? matchingEntry : null;
  }
}
