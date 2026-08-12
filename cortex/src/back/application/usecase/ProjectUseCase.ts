import type { DirectoryPickerService } from "../service/projectService/DirectoryPickerService.ts";
import type {
  AgentOrderConfiguration,
  Project,
  ProjectContent,
  ProjectService
} from "../service/projectService/ProjectService.ts";
import { NotFoundError } from "../error/NotFoundError.ts";
import { ValidationError } from "../error/ValidationError.ts";

export type ProjectOutput = Project;
export type ProjectContentOutput = ProjectContent;

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

  getAgentOrder(projectId: string): Promise<AgentOrderConfiguration | null> {
    return this.projectService.getAgentOrder(projectId);
  }

  saveAgentOrder(
    projectId: string,
    agentOrder: AgentOrderConfiguration
  ): Promise<void> {
    return this.projectService.saveAgentOrder(projectId, agentOrder);
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

  selectProjectDirectory(): Promise<string | null> {
    return this.directoryPickerService.selectDirectory();
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


}
