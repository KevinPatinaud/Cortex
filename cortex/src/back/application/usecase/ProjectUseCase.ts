import type { DirectoryPickerService } from "../service/projectService/DirectoryPickerService.ts";
import type {
  AgentWorkflowConfiguration,
  CreateProjectResult,
  EditableAgentProject,
  ProjectAgentEngine,
  Project,
  ProjectContent,
  ProjectService
} from "../service/projectService/ProjectService.ts";
import { NotFoundError } from "../error/NotFoundError.ts";
import { ValidationError } from "../error/ValidationError.ts";

export type ProjectOutput = Project;
export type ProjectContentOutput = ProjectContent;

export interface CreateProjectInput {
  parentDirectory?: unknown;
  name?: unknown;
  engine?: unknown;
  instructions?: unknown;
}

export interface EditableProjectAgentInput {
  id?: unknown;
  name?: unknown;
  description?: unknown;
  prompt?: unknown;
  model?: unknown;
  reasoningEffort?: unknown;
}

export interface EditAgentProjectInput {
  name?: unknown;
  engine?: unknown;
  instructions?: unknown;
  agents?: unknown;
}

export class ProjectUseCase {
  constructor(
    private readonly projectService: ProjectService,
    private readonly directoryPickerService: DirectoryPickerService
  ) {}

  getProjects(): Promise<Project[]> {
    return this.projectService.getProjects();
  }

  saveProject(directoryPath: unknown): Promise<Project[]> {
    return this.projectService.saveProject(
      this.getRequiredDirectoryPath(directoryPath)
    );
  }

  getProjectContent(id: string): Promise<ProjectContent> {
    const projectId = id.trim();

    if (!projectId) {
      throw new ValidationError("L'identifiant du projet est obligatoire.");
    }

    return this.projectService.getProjectContent(projectId);
  }

  getAgentWorkflowConfiguration(
    projectId: string
  ): Promise<AgentWorkflowConfiguration | null> {
    return this.projectService.getAgentWorkflowConfiguration(projectId);
  }

  createProject(input: CreateProjectInput | null | undefined): Promise<CreateProjectResult> {
    const parentDirectory = this.getRequiredString(
      input?.parentDirectory,
      "Le dossier parent est obligatoire."
    );
    const name = this.getRequiredString(
      input?.name,
      "Le nom du projet est obligatoire."
    );
    const engine = this.getAgentEngine(input?.engine);
    const instructions = typeof input?.instructions === "string"
      ? input.instructions.trim()
      : "";

    if (
      name === "." ||
      name === ".." ||
      /[<>:"/\\|?*\u0000-\u001F]/.test(name)
    ) {
      throw new ValidationError(
        "Le nom du projet contient des caractères non autorisés."
      );
    }

    return this.projectService.createProject({
      parentDirectory,
      name,
      engine,
      instructions
    }).catch((error: unknown) => {
      if (error instanceof TypeError) {
        throw new ValidationError(error.message);
      }

      throw error;
    });
  }

  saveAgentProject(
    projectId: string,
    input: EditAgentProjectInput | null | undefined
  ): Promise<Project> {
    const normalizedProjectId = this.getRequiredString(
      projectId,
      "L'identifiant du projet est obligatoire."
    );
    const engine = this.getAgentEngine(input?.engine);
    const name = this.getProjectName(input?.name);

    if (typeof input?.instructions !== "string") {
      throw new ValidationError("Les instructions du projet sont invalides.");
    }

    if (!Array.isArray(input.agents) || input.agents.length > 50) {
      throw new ValidationError(
        "La liste des agents est invalide ou dépasse la limite de 50 agents."
      );
    }

    const agents = input.agents.map((agent, index) =>
      this.getEditableAgent(agent, index)
    );
    const existingIds = agents
      .map((agent) => agent.id)
      .filter((id): id is string => Boolean(id));

    if (new Set(existingIds).size !== existingIds.length) {
      throw new ValidationError("Un même agent est présent plusieurs fois.");
    }

    const draft: EditableAgentProject = {
      name,
      engine,
      instructions: input.instructions,
      agents
    };

    return this.projectService.saveAgentProject(
      normalizedProjectId,
      draft
    ).catch((error: unknown) => {
      if (error instanceof TypeError) {
        throw new ValidationError(error.message);
      }

      throw error;
    });
  }

  saveAgentWorkflowConfiguration(
    projectId: string,
    workflow: AgentWorkflowConfiguration
  ): Promise<void> {
    return this.projectService.saveAgentWorkflowConfiguration(
      projectId,
      workflow
    );
  }

  async deleteProject(directoryPath: unknown): Promise<Project[]> {
    const result = await this.projectService.deleteProject(
      this.getRequiredDirectoryPath(directoryPath)
    );

    if (!result.deleted) {
      throw new NotFoundError("Le projet est introuvable.");
    }

    return result.projects;
  }

  selectProjectDirectoryFromInstructionsFile(): Promise<string | null> {
    return this.directoryPickerService.selectProjectDirectoryFromInstructionsFile();
  }

  private getRequiredDirectoryPath(directoryPath: unknown): string {
    const normalizedInput = typeof directoryPath === "string"
      ? directoryPath.trim()
      : "";

    if (!normalizedInput) {
      throw new ValidationError(
        "Le chemin du répertoire est obligatoire."
      );
    }

    return normalizedInput;
  }

  private getRequiredString(value: unknown, message: string): string {
    const normalizedValue = typeof value === "string" ? value.trim() : "";

    if (!normalizedValue) {
      throw new ValidationError(message);
    }

    return normalizedValue;
  }

  private getProjectName(value: unknown): string {
    const name = this.getRequiredString(
      value,
      "Le nom du projet est obligatoire."
    );

    if (
      name === "." ||
      name === ".." ||
      /[<>:"/\\|?*\u0000-\u001F]/.test(name)
    ) {
      throw new ValidationError(
        "Le nom du projet contient des caractÃ¨res non autorisÃ©s."
      );
    }

    return name;
  }

  private getAgentEngine(value: unknown): ProjectAgentEngine {
    if (value !== "codex" && value !== "claude" && value !== "copilot") {
      throw new ValidationError("Le moteur d'agents sélectionné est invalide.");
    }

    return value;
  }

  private getEditableAgent(
    input: unknown,
    index: number
  ): EditableAgentProject["agents"][number] {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
      throw new ValidationError(`L'agent ${index + 1} est invalide.`);
    }

    const agent = input as EditableProjectAgentInput;
    const name = this.getRequiredString(
      agent.name,
      `Le nom de l'agent ${index + 1} est obligatoire.`
    );
    const prompt = this.getRequiredString(
      agent.prompt,
      `Les instructions de l'agent « ${name} » sont obligatoires.`
    );
    const readOptionalString = (value: unknown): string | undefined => {
      if (value === undefined || value === null || value === "") {
        return undefined;
      }

      if (typeof value !== "string") {
        throw new ValidationError(`La configuration de l'agent « ${name} » est invalide.`);
      }

      return value.trim() || undefined;
    };

    return {
      ...(readOptionalString(agent.id) ? { id: readOptionalString(agent.id) } : {}),
      name,
      description: readOptionalString(agent.description) ?? "",
      prompt,
      ...(readOptionalString(agent.model)
        ? { model: readOptionalString(agent.model) }
        : {}),
      ...(readOptionalString(agent.reasoningEffort)
        ? { reasoningEffort: readOptionalString(agent.reasoningEffort) }
        : {})
    };
  }


}
