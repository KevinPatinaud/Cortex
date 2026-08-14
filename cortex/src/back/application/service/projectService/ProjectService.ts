
import { randomUUID } from "node:crypto";
import {
  mkdir,
  readdir,
  readFile,
  readlink,
  rename,
  stat,
  unlink,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import { NotFoundError } from "../../error/NotFoundError.ts";

interface ProjectConfiguration {
  projects?: unknown;
  directoryPath?: unknown;
  agentWorkflows?: unknown;
  workflowSchedules?: unknown;
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
    inputMode: "separate" | "aggregate";
  }>;
}

export interface WorkflowScheduleConfiguration {
  cron: string;
  enabled: boolean;
}

export interface Project {
  id: string;
  directoryPath: string;
}

export interface DeleteProjectResult {
  projects: Project[];
  deleted: boolean;
}

export type ProjectAgentEngine = "codex" | "claude" | "copilot";

export interface EditableProjectAgent {
  id?: string;
  name: string;
  description: string;
  prompt: string;
  model?: string;
  reasoningEffort?: string;
}

export interface EditableAgentProject {
  name: string;
  engine: ProjectAgentEngine;
  instructions: string;
  agents: EditableProjectAgent[];
}

export interface CreateProjectOptions {
  parentDirectory: string;
  name: string;
  engine: ProjectAgentEngine;
  instructions: string;
}

export interface CreateProjectResult {
  project: Project;
  projects: Project[];
}

interface AgentFileConfiguration {
  rootDirectory: ".codex" | ".claude" | ".github";
  instructionsFileName: "AGENTS.md" | "CLAUDE.md";
  extension: ".toml" | ".md" | ".agent.md";
}

const agentFileConfigurations: Record<
  ProjectAgentEngine,
  AgentFileConfiguration
> = {
  codex: {
    rootDirectory: ".codex",
    instructionsFileName: "AGENTS.md",
    extension: ".toml"
  },
  claude: {
    rootDirectory: ".claude",
    instructionsFileName: "CLAUDE.md",
    extension: ".md"
  },
  copilot: {
    rootDirectory: ".github",
    instructionsFileName: "AGENTS.md",
    extension: ".agent.md"
  }
};

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

  async createProject(
    options: CreateProjectOptions
  ): Promise<CreateProjectResult> {
    const parentDirectory = path.resolve(options.parentDirectory);
    const parentStats = await stat(parentDirectory).catch(() => null);

    if (!parentStats?.isDirectory()) {
      throw new TypeError("The parent directory could not be found.");
    }

    const projectDirectory = path.join(parentDirectory, options.name);

    if (await this.pathExists(projectDirectory)) {
      throw new TypeError(
        "A file or directory with this name already exists at this location."
      );
    }

    const fileConfiguration = agentFileConfigurations[options.engine];
    await mkdir(projectDirectory);
    await mkdir(
      path.join(
        projectDirectory,
        fileConfiguration.rootDirectory,
        "agents"
      ),
      { recursive: true }
    );
    await writeFile(
      path.join(projectDirectory, fileConfiguration.instructionsFileName),
      options.instructions,
      "utf8"
    );

    const projects = await this.saveProject(projectDirectory);
    const project = projects.find((candidate) =>
      this.pathsAreEqual(candidate.directoryPath, projectDirectory)
    );

    if (!project) {
      throw new Error("The new project could not be saved.");
    }

    return { project, projects };
  }

  async saveAgentProject(
    projectId: string,
    draft: EditableAgentProject
  ): Promise<Project> {
    const projects = await this.getProjects();
    const project = projects.find(
      (candidate) => candidate.id === projectId
    );

    if (!project) {
      throw new NotFoundError("The project could not be found.");
    }

    const nextDirectoryPath = path.join(
      path.dirname(project.directoryPath),
      draft.name
    );
    const isRenamed = project.directoryPath !== nextDirectoryPath;

    if (
      isRenamed &&
      !this.pathsAreEqual(project.directoryPath, nextDirectoryPath) &&
      await this.pathExists(nextDirectoryPath)
    ) {
      throw new TypeError(
        "A file or directory with this name already exists at this location."
      );
    }

    const configuration = agentFileConfigurations[draft.engine];
    const configurationDirectory = path.join(
      project.directoryPath,
      configuration.rootDirectory
    );

    if (!await this.pathExists(configurationDirectory)) {
      throw new TypeError(
        "The draft engine does not match the project configuration."
      );
    }

    const agentsDirectory = path.join(configurationDirectory, "agents");
    await mkdir(agentsDirectory, { recursive: true });

    const currentAgentFileNames = (await readdir(agentsDirectory, {
      withFileTypes: true
    }))
      .filter((entry) => entry.isFile() &&
        this.isAgentFileName(entry.name, configuration.extension))
      .map((entry) => entry.name);
    const retainedFileNames = new Set<string>();

    for (const agent of draft.agents) {
      const existingFileName = agent.id
        ? this.getExistingAgentFileName(
          agent.id,
          configuration,
          currentAgentFileNames
        )
        : null;
      const fileName = existingFileName ?? this.createAgentFileName(
        agent.name,
        configuration.extension,
        new Set([...currentAgentFileNames, ...retainedFileNames])
      );

      if (retainedFileNames.has(fileName)) {
        throw new TypeError("Two agents cannot use the same file.");
      }

      retainedFileNames.add(fileName);
      await writeFile(
        path.join(agentsDirectory, fileName),
        this.serializeAgent(draft.engine, agent),
        "utf8"
      );
    }

    for (const fileName of currentAgentFileNames) {
      if (!retainedFileNames.has(fileName)) {
        await unlink(path.join(agentsDirectory, fileName));
      }
    }

    await writeFile(
      path.join(project.directoryPath, configuration.instructionsFileName),
      draft.instructions,
      "utf8"
    );

    if (isRenamed) {
      await rename(project.directoryPath, nextDirectoryPath);
      project.directoryPath = nextDirectoryPath;
      await this.persistProjects(projects);
    }

    return { ...project };
  }

  async saveProject(directoryPath: string): Promise<Project[]> {
    if (!directoryPath.trim()) {
      throw new TypeError("The directory path is required.");
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
      throw new TypeError("The project ID is required.");
    }

    const project = (await this.getProjects()).find(
      (savedProject) => savedProject.id === projectId
    );

    if (!project) {
      throw new NotFoundError("The project could not be found.");
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

  async getWorkflowScheduleConfiguration(
    projectId: string
  ): Promise<WorkflowScheduleConfiguration | null> {
    const configuration = await this.readConfiguration();
    const storedSchedules = this.isRecord(configuration.workflowSchedules)
      ? configuration.workflowSchedules
      : null;
    const schedule = storedSchedules?.[projectId];

    return this.isWorkflowScheduleConfiguration(schedule)
      ? { ...schedule }
      : null;
  }

  async saveWorkflowScheduleConfiguration(
    projectId: string,
    schedule: WorkflowScheduleConfiguration
  ): Promise<void> {
    const projectExists = (await this.getProjects()).some(
      (project) => project.id === projectId
    );

    if (!projectExists) {
      throw new NotFoundError("The project could not be found.");
    }

    const configuration = await this.readConfiguration();
    const storedSchedules = this.isRecord(configuration.workflowSchedules)
      ? configuration.workflowSchedules
      : {};

    await this.writeConfiguration({
      ...configuration,
      workflowSchedules: {
        ...storedSchedules,
        [projectId]: { ...schedule }
      }
    });
  }

  async deleteProject(directoryPath: string): Promise<DeleteProjectResult> {
    if (!directoryPath.trim()) {
      throw new TypeError("The directory path is required.");
    }

    const normalizedPath = path.normalize(directoryPath.trim());
    const projects = await this.getProjects();
    const remainingProjects = projects.filter(
      (project) => !this.pathsAreEqual(project.directoryPath, normalizedPath)
    );
    const deletedProjectIds = projects
      .filter((project) =>
        this.pathsAreEqual(project.directoryPath, normalizedPath)
      )
      .map((project) => project.id);
    const deleted = remainingProjects.length !== projects.length;

    if (deleted) {
      await this.persistProjects(remainingProjects, deletedProjectIds);
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

  private async persistProjects(
    projects: Project[],
    deletedProjectIds: string[] = []
  ): Promise<void> {
    const configuration = await this.readConfiguration();
    const nextConfiguration: ProjectConfiguration = {
      ...configuration,
      projects
    };

    for (const property of ["agentWorkflows", "workflowSchedules"] as const) {
      if (!this.isRecord(configuration[property])) {
        continue;
      }

      const retainedEntries = { ...configuration[property] };

      for (const projectId of deletedProjectIds) {
        delete retainedEntries[projectId];
      }

      nextConfiguration[property] = retainedEntries;
    }

    await this.writeConfiguration(nextConfiguration);
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

  private pathExists(filePath: string): Promise<boolean> {
    return stat(filePath).then(() => true, (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        return false;
      }

      throw error;
    });
  }

  private isAgentFileName(
    fileName: string,
    extension: AgentFileConfiguration["extension"]
  ): boolean {
    return fileName.toLowerCase().endsWith(extension);
  }

  private getExistingAgentFileName(
    agentId: string,
    configuration: AgentFileConfiguration,
    currentAgentFileNames: string[]
  ): string {
    const portableId = agentId.replace(/\\/g, "/");
    const expectedPrefix = `${configuration.rootDirectory}/agents/`;

    if (!portableId.startsWith(expectedPrefix)) {
      throw new TypeError("The ID of an existing agent is invalid.");
    }

    const fileName = portableId.slice(expectedPrefix.length);

    if (
      !fileName ||
      fileName.includes("/") ||
      !this.isAgentFileName(fileName, configuration.extension) ||
      !currentAgentFileNames.includes(fileName)
    ) {
      throw new TypeError("The file for an existing agent could not be found.");
    }

    return fileName;
  }

  private createAgentFileName(
    name: string,
    extension: AgentFileConfiguration["extension"],
    unavailableFileNames: Set<string>
  ): string {
    const baseName = name
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "agent";
    let suffix = 1;
    let fileName = `${baseName}${extension}`;

    while (unavailableFileNames.has(fileName)) {
      suffix += 1;
      fileName = `${baseName}-${suffix}${extension}`;
    }

    return fileName;
  }

  private serializeAgent(
    engine: ProjectAgentEngine,
    agent: EditableProjectAgent
  ): string {
    if (engine === "codex") {
      return [
        `name = ${JSON.stringify(agent.name)}`,
        `description = ${JSON.stringify(agent.description)}`,
        ...(agent.model ? [`model = ${JSON.stringify(agent.model)}`] : []),
        ...(agent.reasoningEffort
          ? [`model_reasoning_effort = ${JSON.stringify(agent.reasoningEffort)}`]
          : []),
        `developer_instructions = ${JSON.stringify(agent.prompt)}`,
        ""
      ].join("\n");
    }

    return [
      "---",
      `name: ${JSON.stringify(agent.name)}`,
      `description: ${JSON.stringify(agent.description)}`,
      ...(agent.model ? [`model: ${JSON.stringify(agent.model)}`] : []),
      ...(agent.reasoningEffort
        ? [`${engine === "claude" ? "effort" : "reasoning-effort"}: ${JSON.stringify(agent.reasoningEffort)}`]
        : []),
      "---",
      agent.prompt.trim(),
      ""
    ].join("\n");
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
        agent.nextAgentIds.every((agentId) => typeof agentId === "string") &&
        (agent.inputMode === "separate" || agent.inputMode === "aggregate")
      );
  }

  private isWorkflowScheduleConfiguration(
    value: unknown
  ): value is WorkflowScheduleConfiguration {
    return this.isRecord(value) &&
      typeof value.cron === "string" &&
      typeof value.enabled === "boolean";
  }

  private isStoredProject(value: unknown): value is StoredProject {
    return typeof value === "object" &&
      value !== null &&
      "directoryPath" in value &&
      typeof value.directoryPath === "string";
  }
}
