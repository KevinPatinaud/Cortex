
import { randomUUID } from "node:crypto";
import { readdir, readFile, readlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { NotFoundError } from "../../error/NotFoundError.ts";

interface ProjectConfiguration {
  projects?: unknown;
  directoryPath?: unknown;
  agentWorkflows?: unknown;
}

interface StoredProject {
  id?: unknown;
  directoryPath: string;
}

export interface AgentWorkflowConfiguration {
  hash: string;
  agents: Array<{
    id: string;
    nextAgentIds: string[];
  }>;
}

export interface Project {
  id: string;
  directoryPath: string;
}

export interface DeleteProjectResult {
  projects: Project[];
  deleted: boolean;
}

export interface ProjectContent {
  id: string;
  directoryPath: string;
  root: ProjectDirectoryContent;
}

export type ProjectContentEntry =
  | ProjectDirectoryContent
  | ProjectFileContent
  | ProjectSymbolicLinkContent
  | ProjectOtherContent;

export interface ProjectDirectoryContent {
  type: "directory";
  name: string;
  relativePath: string;
  children: ProjectContentEntry[];
}

export interface ProjectFileContent {
  type: "file";
  name: string;
  relativePath: string;
  size: number;
  encoding: "utf8" | "base64";
  content: string;
}

export interface ProjectSymbolicLinkContent {
  type: "symbolicLink";
  name: string;
  relativePath: string;
  target: string;
}

export interface ProjectOtherContent {
  type: "other";
  name: string;
  relativePath: string;
}

export class ProjectService {
  private projectsCache: Project[] | null = null;
  private projectsLoading: Promise<Project[]> | null = null;

  constructor(private readonly configurationFile: string) {}

  async saveProject(directoryPath: string): Promise<Project[]> {
    if (!directoryPath.trim()) {
      throw new TypeError("Le chemin du répertoire est obligatoire.");
    }

    const normalizedPath = path.normalize(directoryPath.trim());
    const projects = await this.getProjects();
    const projectAlreadySaved = projects.some(
      (project) => this.pathsAreEqual(project.directoryPath, normalizedPath)
    );

    if (!projectAlreadySaved) {
      projects.push({
        id: this.createUniqueId(new Set(projects.map((project) => project.id))),
        directoryPath: normalizedPath
      });
    }

    await this.persistProjects(projects);
    return this.cloneProjects(projects);
  }

  async getProjects(): Promise<Project[]> {
    if (this.projectsCache) {
      return this.cloneProjects(this.projectsCache);
    }

    this.projectsLoading ??= this.loadProjects();

    try {
      const projects = await this.projectsLoading;
      this.projectsCache = projects;
      return this.cloneProjects(projects);
    } finally {
      this.projectsLoading = null;
    }
  }

  async getProjectContent(id: string): Promise<ProjectContent> {
    const projectId = id.trim();

    if (!projectId) {
      throw new TypeError("L'identifiant du projet est obligatoire.");
    }

    const project = (await this.getProjects()).find(
      (savedProject) => savedProject.id === projectId
    );

    if (!project) {
      throw new NotFoundError("Le projet est introuvable.");
    }

    return {
      id: project.id,
      directoryPath: project.directoryPath,
      root: await this.readProjectDirectory(
        project.directoryPath,
        project.directoryPath
      )
    };
  }

  async getAgentWorkflowConfiguration(
    projectId: string
  ): Promise<AgentWorkflowConfiguration | null> {
    const configuration = await this.readConfiguration();
    const storedWorkflows = this.isRecord(configuration.agentWorkflows)
      ? configuration.agentWorkflows
      : null;
    const workflow = storedWorkflows?.[projectId];

    if (this.isAgentWorkflowConfiguration(workflow)) {
      return this.cloneAgentWorkflowConfiguration(workflow);
    }

    return null;
  }

  async saveAgentWorkflowConfiguration(
    projectId: string,
    workflow: AgentWorkflowConfiguration
  ): Promise<void> {
    const configuration = await this.readConfiguration();
    const storedWorkflows = this.isRecord(configuration.agentWorkflows)
      ? configuration.agentWorkflows
      : {};

    await this.writeConfiguration({
      ...configuration,
      agentWorkflows: {
        ...storedWorkflows,
        [projectId]: this.cloneAgentWorkflowConfiguration(workflow)
      }
    });
  }

  async deleteProject(directoryPath: string): Promise<DeleteProjectResult> {
    if (!directoryPath.trim()) {
      throw new TypeError("Le chemin du répertoire est obligatoire.");
    }

    const normalizedPath = path.normalize(directoryPath.trim());
    const projects = await this.getProjects();
    const remainingProjects = projects.filter(
      (project) => !this.pathsAreEqual(project.directoryPath, normalizedPath)
    );
    const deleted = remainingProjects.length !== projects.length;

    if (deleted) {
      await this.persistProjects(remainingProjects);
    }

    return {
      projects: this.cloneProjects(remainingProjects),
      deleted
    };
  }

  private async loadProjects(): Promise<Project[]> {
    try {
      const configuration = await this.readConfiguration();

      const usedIds = new Set<string>();
      let migrationRequired = false;
      const projects: Project[] = [];

      if (Array.isArray(configuration.projects)) {
        for (const storedProject of configuration.projects) {
          const migratedProject = this.toProject(storedProject, usedIds);

          if (migratedProject) {
            projects.push(migratedProject.project);
            migrationRequired ||= migratedProject.migrated;
          }
        }
      } else if (
        typeof configuration.directoryPath === "string" &&
        configuration.directoryPath.trim()
      ) {
        projects.push({
          id: this.createUniqueId(usedIds),
          directoryPath: path.normalize(configuration.directoryPath.trim())
        });
        migrationRequired = true;
      }

      if (migrationRequired) {
        await this.persistProjects(projects);
      }

      return projects;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }

      throw error;
    }
  }

  private async readProjectDirectory(
    rootDirectory: string,
    directoryPath: string
  ): Promise<ProjectDirectoryContent> {
    const directoryEntries = await readdir(directoryPath, {
      withFileTypes: true
    });
    const sortedEntries = directoryEntries.sort((firstEntry, secondEntry) =>
      firstEntry.name.localeCompare(secondEntry.name)
    );
    const children: ProjectContentEntry[] = [];

    for (const entry of sortedEntries) {
      const entryPath = path.join(directoryPath, entry.name);
      const relativePath = this.toPortableRelativePath(
        rootDirectory,
        entryPath
      );

      if (entry.isDirectory()) {
        children.push(await this.readProjectDirectory(rootDirectory, entryPath));
        continue;
      }

      if (entry.isFile()) {
        children.push(await this.readProjectFile(entryPath, relativePath));
        continue;
      }

      if (entry.isSymbolicLink()) {
        children.push({
          type: "symbolicLink",
          name: entry.name,
          relativePath,
          target: await readlink(entryPath)
        });
        continue;
      }

      children.push({
        type: "other",
        name: entry.name,
        relativePath
      });
    }

    return {
      type: "directory",
      name: path.basename(directoryPath) || directoryPath,
      relativePath: this.toPortableRelativePath(rootDirectory, directoryPath),
      children
    };
  }

  private async readProjectFile(
    filePath: string,
    relativePath: string
  ): Promise<ProjectFileContent> {
    const fileContent = await readFile(filePath);
    const isBinary = this.isBinaryContent(fileContent);

    return {
      type: "file",
      name: path.basename(filePath),
      relativePath,
      size: fileContent.byteLength,
      encoding: isBinary ? "base64" : "utf8",
      content: fileContent.toString(isBinary ? "base64" : "utf8")
    };
  }

  private isBinaryContent(content: Buffer): boolean {
    const sampleLength = Math.min(content.byteLength, 8_000);

    if (sampleLength === 0) {
      return false;
    }

    let controlCharacterCount = 0;

    for (let index = 0; index < sampleLength; index += 1) {
      const byte = content[index];

      if (byte === 0) {
        return true;
      }

      if (byte < 7 || (byte > 13 && byte < 32)) {
        controlCharacterCount += 1;
      }
    }

    return controlCharacterCount / sampleLength > 0.1;
  }

  private toPortableRelativePath(
    rootDirectory: string,
    entryPath: string
  ): string {
    return path.relative(rootDirectory, entryPath).split(path.sep).join("/");
  }

  private toProject(
    storedProject: unknown,
    usedIds: Set<string>
  ): { project: Project; migrated: boolean } | null {
    if (typeof storedProject === "string" && storedProject.trim()) {
      return {
        project: {
          id: this.createUniqueId(usedIds),
          directoryPath: path.normalize(storedProject.trim())
        },
        migrated: true
      };
    }

    if (!this.isStoredProject(storedProject) || !storedProject.directoryPath.trim()) {
      return null;
    }

    const hasValidUniqueId = typeof storedProject.id === "string" &&
      Boolean(storedProject.id.trim()) &&
      !usedIds.has(storedProject.id);
    const id = hasValidUniqueId
      ? storedProject.id as string
      : this.createUniqueId(usedIds);

    usedIds.add(id);

    return {
      project: {
        id,
        directoryPath: path.normalize(storedProject.directoryPath.trim())
      },
      migrated: !hasValidUniqueId
    };
  }

  private async persistProjects(projects: Project[]): Promise<void> {
    const configuration = await this.readConfiguration();

    await this.writeConfiguration({ ...configuration, projects });
    this.projectsCache = this.cloneProjects(projects);
  }

  private async readConfiguration(): Promise<ProjectConfiguration> {
    try {
      const configuration: unknown = JSON.parse(
        await readFile(this.configurationFile, "utf8")
      );

      return this.isProjectConfiguration(configuration) ? configuration : {};
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return {};
      }

      throw error;
    }
  }

  private writeConfiguration(
    configuration: ProjectConfiguration
  ): Promise<void> {
    return writeFile(
      this.configurationFile,
      JSON.stringify(configuration, null, 2),
      "utf8"
    );
  }

  private cloneAgentWorkflowConfiguration(
    workflow: AgentWorkflowConfiguration
  ): AgentWorkflowConfiguration {
    return {
      hash: workflow.hash,
      agents: workflow.agents.map((agent) => ({
        ...agent,
        nextAgentIds: [...agent.nextAgentIds]
      }))
    };
  }

  private createUniqueId(usedIds: Set<string>): string {
    let id = randomUUID();

    while (usedIds.has(id)) {
      id = randomUUID();
    }

    usedIds.add(id);
    return id;
  }

  private cloneProjects(projects: Project[]): Project[] {
    return projects.map((project) => ({ ...project }));
  }

  private pathsAreEqual(firstPath: string, secondPath: string): boolean {
    if (process.platform === "win32") {
      return firstPath.toLowerCase() === secondPath.toLowerCase();
    }

    return firstPath === secondPath;
  }

  private isProjectConfiguration(value: unknown): value is ProjectConfiguration {
    return typeof value === "object" && value !== null;
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  private isAgentWorkflowConfiguration(
    value: unknown
  ): value is AgentWorkflowConfiguration {
    return this.isRecord(value) &&
      typeof value.hash === "string" &&
      Array.isArray(value.agents) &&
      value.agents.every((agent) =>
        this.isRecord(agent) &&
        typeof agent.id === "string" &&
        Array.isArray(agent.nextAgentIds) &&
        agent.nextAgentIds.every((agentId) => typeof agentId === "string")
      );
  }

  private isStoredProject(value: unknown): value is StoredProject {
    return typeof value === "object" &&
      value !== null &&
      "directoryPath" in value &&
      typeof value.directoryPath === "string";
  }
}
