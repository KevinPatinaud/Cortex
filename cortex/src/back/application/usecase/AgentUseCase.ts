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

export interface RunAgentInput {
  agentId?: unknown;
  additionalInstructions?: unknown;
}

export interface AgentDefinition {
  id: string;
  name: string;
  description: string;
  hasSession: boolean;
  model?: string;
  reasoningEffort?: string;
  prompt: string;
}

export interface ProjectInstructions {
  fileName: string;
  content: string | null;
}

export interface AgentProject {
  projectId: string;
  engine: AgentEngine;
  agents: AgentDefinition[];
  instructions: ProjectInstructions;
}

export interface AgentRunOutput {
  answer: string;
  hasSession: boolean;
}

type ProjectDirectory = ProjectContentOutput["root"];

interface AgentProjectConfiguration {
  engine: AgentEngine;
  rootDirectory: ".codex" | ".claude" | ".github";
  instructionsFileName: "AGENTS.md" | "CLAUDE.md";
}

const agentProjectConfigurations: AgentProjectConfiguration[] = [
  {
    engine: "codex",
    rootDirectory: ".codex",
    instructionsFileName: "AGENTS.md"
  },
  {
    engine: "claude",
    rootDirectory: ".claude",
    instructionsFileName: "CLAUDE.md"
  },
  {
    engine: "copilot",
    rootDirectory: ".github",
    instructionsFileName: "AGENTS.md"
  }
];

export class AgentUseCase {
  private actualLoadedProject: AgentProject | null = null;
  private actualLoadedProjectDirectoryPath: string | null = null;
  private readonly agentSessionIds = new Map<string, string>();

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

  async runAgent(
    projectId: string,
    input: RunAgentInput
  ): Promise<AgentRunOutput> {
    const normalizedProjectId = projectId.trim();
    const agentId = typeof input.agentId === "string"
      ? input.agentId.trim()
      : "";
    const additionalInstructions = typeof input.additionalInstructions === "string"
      ? input.additionalInstructions.trim()
      : "";

    if (!normalizedProjectId || !agentId) {
      throw new ValidationError(
        "Le projet et l'agent a executer sont obligatoires."
      );
    }

    if (
      this.actualLoadedProject?.projectId !== normalizedProjectId ||
      !this.actualLoadedProjectDirectoryPath
    ) {
      throw new ValidationError(
        "Le projet doit etre charge avant d'executer un agent."
      );
    }

    const agent = this.actualLoadedProject.agents.find(
      (candidate) => candidate.id === agentId
    );

    if (!agent) {
      throw new ValidationError(
        "L'agent a executer n'existe pas dans le projet actuel."
      );
    }

    if (!agent.prompt.trim()) {
      throw new ValidationError(
        "L'agent ne contient aucune instruction a executer."
      );
    }

    const sessionKey = this.getAgentSessionKey(normalizedProjectId, agent.id);
    const sessionId = this.agentSessionIds.get(sessionKey);
    const executionPrompt = sessionId
      ? additionalInstructions || agent.prompt
      : this.withAdditionalInstructions(agent.prompt, additionalInstructions);
    const result = await this.agentService.execute(
      this.actualLoadedProject.engine,
      executionPrompt,
      {
        ...(agent.model ? { model: agent.model } : {}),
        ...(agent.reasoningEffort
          ? { reasoningEffort: agent.reasoningEffort }
          : {}),
        persistSession: true,
        ...(sessionId ? { sessionId } : {}),
        workingDirectory: this.actualLoadedProjectDirectoryPath
      }
    );
    const effectiveSessionId = result.sessionId || sessionId;

    if (!effectiveSessionId) {
      throw new Error(
        "Le moteur IA n'a renvoye aucun identifiant de session."
      );
    }

    this.agentSessionIds.set(sessionKey, effectiveSessionId);
    agent.hasSession = true;

    return {
      answer: result.answer,
      hasSession: true
    };
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

    for (const agent of agents) {
      agent.hasSession = this.agentSessionIds.has(
        this.getAgentSessionKey(projectContent.id, agent.id)
      );
    }

    this.actualLoadedProject = {
      projectId: projectContent.id,
      engine: configuration.engine,
      agents,
      instructions: this.loadProjectInstructions(
        projectContent.root,
        configuration.instructionsFileName
      )
    };
    this.actualLoadedProjectDirectoryPath = projectContent.directoryPath;

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

  private loadProjectInstructions(
    rootDirectory: ProjectDirectory,
    fileName: ProjectInstructions["fileName"]
  ): ProjectInstructions {
    const instructionsFile = rootDirectory.children.find(
      (entry) => entry.type === "file" &&
        entry.name.toLowerCase() === fileName.toLowerCase()
    );

    if (!instructionsFile || instructionsFile.type !== "file") {
      return { fileName, content: null };
    }

    return {
      fileName: instructionsFile.name,
      content: instructionsFile.encoding === "base64"
        ? Buffer.from(instructionsFile.content, "base64").toString("utf8")
        : instructionsFile.content
    };
  }

  private getAgentSessionKey(projectId: string, agentId: string): string {
    return JSON.stringify([projectId, agentId]);
  }

  private withAdditionalInstructions(
    prompt: string,
    additionalInstructions: string
  ): string {
    if (!additionalInstructions) {
      return prompt;
    }

    return `${prompt}\n\nPrecisions de l'utilisateur :\n${additionalInstructions}`;
  }
}
