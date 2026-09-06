
import { randomUUID } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  rename,
  stat,
  writeFile
} from "node:fs/promises";
import path from "node:path";
import type { WorkflowParameterDefinition } from "../../../../shared/WorkflowParameter.ts";
import { NotFoundError } from "../../error/NotFoundError.ts";
import { prepareImportedProject } from "./ProjectImportConverter.ts";
import { JsonConfigurationRepository } from "../configuration/JsonConfigurationRepository.ts";
import { removeOwnedDirectory, withProjectFileTransaction, type ProjectFileChange } from "./ProjectFileTransaction.ts";
import { assertPortableProjectName, assertProjectFileManifest } from "../../../../shared/ProjectArchivePolicy.ts";

interface ProjectConfiguration {
  projects?: unknown;
  directoryPath?: unknown;
  projectsDirectory?: unknown;
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
  parameters: WorkflowParameterDefinition[];
}

export interface WorkflowScheduleConfiguration {
  cron: string;
  enabled: boolean;
  parameterValues: Record<string, string>;
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
  agents?: EditableProjectAgent[];
}

export interface CreateProjectResult {
  project: Project;
  projects: Project[];
  conversion?: ProjectImportConversion;
}

export interface ProjectImportConversion {
  sourceEngine: ProjectAgentEngine;
  targetEngine: ProjectAgentEngine;
}

export interface UploadedProjectFile {
  relativePath: string;
  content: Buffer;
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
  private readonly repository: JsonConfigurationRepository;

  constructor(
    configurationFile: string,
    private readonly defaultManagedProjectsDirectory = path.join(
      path.dirname(configurationFile),
      "projects"
    )
  ) {
    this.repository = new JsonConfigurationRepository(configurationFile);
  }


  saveManagedProjectsDirectory(directoryPath: string): Promise<string> {
    return this.repository.runExclusive(() => this.saveManagedProjectsDirectoryUnlocked(directoryPath));
  }

  createProject(options: CreateProjectOptions): Promise<CreateProjectResult> {
    return this.repository.runExclusive(() => this.createProjectUnlocked(options));
  }

  importProject(name: string, files: UploadedProjectFile[], targetEngine?: ProjectAgentEngine | null): Promise<CreateProjectResult> {
    return this.repository.runExclusive(() => this.importProjectUnlocked(name, files, targetEngine));
  }

  saveAgentProject(projectId: string, draft: EditableAgentProject): Promise<Project> {
    return this.repository.runExclusive(() => this.saveAgentProjectUnlocked(projectId, draft));
  }

  saveProject(directoryPath: string): Promise<Project[]> {
    return this.repository.runExclusive(() => this.saveProjectUnlocked(directoryPath));
  }

  reorderProjects(projectIds: string[]): Promise<Project[]> {
    return this.repository.runExclusive(() => this.reorderProjectsUnlocked(projectIds));
  }

  getProjects(): Promise<Project[]> {
    return this.repository.runExclusive(() => this.getProjectsUnlocked());
  }

  saveAgentWorkflowConfiguration(projectId: string, workflow: AgentWorkflowConfiguration): Promise<void> {
    return this.repository.runExclusive(() => this.saveAgentWorkflowConfigurationUnlocked(projectId, workflow));
  }

  saveWorkflowScheduleConfiguration(projectId: string, schedule: WorkflowScheduleConfiguration): Promise<void> {
    return this.repository.runExclusive(() => this.saveWorkflowScheduleConfigurationUnlocked(projectId, schedule));
  }

  deleteProject(directoryPath: string): Promise<DeleteProjectResult> {
    return this.repository.runExclusive(() => this.deleteProjectUnlocked(directoryPath));
  }
  async getManagedProjectsDirectory(): Promise<string> {
    const configuration = await this.readConfiguration();
    const configuredDirectory = configuration.projectsDirectory;

    return path.resolve(
      typeof configuredDirectory === "string" && configuredDirectory.trim()
        ? configuredDirectory.trim()
        : this.defaultManagedProjectsDirectory
    );
  }

  async ensureManagedProjectsDirectory(): Promise<string> {
    const directory = await this.getManagedProjectsDirectory();
    await mkdir(directory, { recursive: true });
    return directory;
  }

  private async saveManagedProjectsDirectoryUnlocked(directoryPath: string): Promise<string> {
    if (!path.isAbsolute(directoryPath)) {
      throw new TypeError("The projects directory must be an absolute path.");
    }

    const directory = path.resolve(directoryPath);
    await mkdir(directory, { recursive: true });

    const directoryStats = await stat(directory);
    if (!directoryStats.isDirectory()) {
      throw new TypeError("The projects location must be a directory.");
    }

    const configuration = await this.readConfiguration();
    await this.writeConfiguration({
      ...configuration,
      projectsDirectory: directory
    });
    return directory;
  }

  async assertProjectCanBeCreated(
    parentDirectory: string,
    name: string
  ): Promise<void> {
    const resolvedParentDirectory = path.resolve(parentDirectory);
    const parentStats = await stat(resolvedParentDirectory).catch(() => null);

    if (!parentStats?.isDirectory()) {
      throw new TypeError("The parent directory could not be found.");
    }

    if (await this.pathExists(path.join(resolvedParentDirectory, name))) {
      throw new TypeError(
        "A file or directory with this name already exists at this location."
      );
    }
  }

  private async createProjectUnlocked(options: CreateProjectOptions): Promise<CreateProjectResult> {
    assertPortableProjectName(options.name);
    const configuration = agentFileConfigurations[options.engine];
    const files: UploadedProjectFile[] = [{
      relativePath: configuration.instructionsFileName,
      content: Buffer.from(options.instructions, "utf8")
    }];
    const usedNames = new Set<string>();
    for (const agent of options.agents ?? []) {
      const name = this.createAgentFileName(agent.name, configuration.extension, usedNames);
      usedNames.add(name);
      files.push({
        relativePath: `${configuration.rootDirectory}/agents/${name}`,
        content: Buffer.from(this.serializeAgent(options.engine, agent), "utf8")
      });
    }
    if (!options.agents?.length) {
      files.push({
        relativePath: `${configuration.rootDirectory}/agents/.gitkeep`,
        content: Buffer.alloc(0)
      });
    }
    return this.publishProject(options.parentDirectory, options.name, files);
  }

  private async importProjectUnlocked(
    name: string,
    files: UploadedProjectFile[],
    targetEngine?: ProjectAgentEngine | null
  ): Promise<CreateProjectResult> {
    this.validateImportedProject(name, files);
    const prepared = prepareImportedProject(files, targetEngine);
    this.validateImportedProject(name, prepared.files);
    const directory = await this.ensureManagedProjectsDirectory();
    const result = await this.publishProject(directory, name, prepared.files);
    return {
      ...result,
      ...(prepared.converted && prepared.sourceEngine && prepared.targetEngine ? {
        conversion: { sourceEngine: prepared.sourceEngine, targetEngine: prepared.targetEngine }
      } : {})
    };
  }

  private async publishProject(
    parentDirectory: string,
    name: string,
    files: UploadedProjectFile[]
  ): Promise<CreateProjectResult> {
    assertPortableProjectName(name);
    this.validateImportedProject(name, files);
    await this.assertProjectCanBeCreated(parentDirectory, name);
    const parent = path.resolve(parentDirectory);
    const directory = path.join(parent, name);
    const staging = await mkdtemp(path.join(parent, ".cortex-upload-"));
    let published = false;
    try {
      for (const file of files) {
        const destination = path.join(staging, ...file.relativePath.split("/"));
        await mkdir(path.dirname(destination), { recursive: true });
        await writeFile(destination, file.content);
      }
      await rename(staging, directory);
      published = true;
      const projects = await this.saveProject(directory);
      const project = projects.find((candidate) =>
        this.pathsAreEqual(candidate.directoryPath, directory)
      );
      if (!project) throw new Error("The new project could not be saved.");
      return { project, projects };
    } catch (error) {
      await removeOwnedDirectory(published ? directory : staging, parent);
      throw error;
    }
  }

  private async saveAgentProjectUnlocked(
    projectId: string,
    draft: EditableAgentProject
  ): Promise<Project> {
    assertPortableProjectName(draft.name);
    const projects = await this.getProjects();
    const project = projects.find((candidate) => candidate.id === projectId);
    if (!project) throw new NotFoundError("The project could not be found.");
    const nextDirectory = path.join(path.dirname(project.directoryPath), draft.name);
    const renamed = project.directoryPath !== nextDirectory;
    if (renamed && !this.pathsAreEqual(project.directoryPath, nextDirectory) &&
      await this.pathExists(nextDirectory)) {
      throw new TypeError("A file or directory with this name already exists at this location.");
    }
    const configuration = agentFileConfigurations[draft.engine];
    const configurationDirectory = path.join(project.directoryPath, configuration.rootDirectory);
    if (!await this.pathExists(configurationDirectory)) {
      throw new TypeError("The draft engine does not match the project configuration.");
    }
    const agentsDirectory = path.join(configurationDirectory, "agents");
    const entries = await readdir(agentsDirectory, { withFileTypes: true }).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return [];
        throw error;
      }
    );
    const currentNames = entries.filter((entry) => entry.isFile() &&
      this.isAgentFileName(entry.name, configuration.extension)).map((entry) => entry.name);
    const retained = new Set<string>();
    const changes: ProjectFileChange[] = [];
    const agentPrefix = `${configuration.rootDirectory}/agents/`;
    for (const agent of draft.agents) {
      const name = agent.id
        ? this.getExistingAgentFileName(agent.id, configuration, currentNames)
        : this.createAgentFileName(agent.name, configuration.extension,
          new Set([...currentNames, ...retained]));
      if (retained.has(name)) throw new TypeError("Two agents cannot use the same file.");
      retained.add(name);
      changes.push({ relativePath: agentPrefix + name, content: this.serializeAgent(draft.engine, agent) });
    }
    for (const name of currentNames) {
      if (!retained.has(name)) changes.push({ relativePath: agentPrefix + name, content: null });
    }
    changes.push({ relativePath: agentPrefix + ".gitkeep", content: draft.agents.length ? null : "" });
    changes.push({ relativePath: configuration.instructionsFileName, content: draft.instructions });
    return withProjectFileTransaction(project.directoryPath, changes, async (renameProject) => {
      if (renamed) {
        await renameProject(nextDirectory);
        project.directoryPath = nextDirectory;
        await this.persistProjects(projects);
      }
      return { ...project };
    });
  }

  private async saveProjectUnlocked(directoryPath: string): Promise<Project[]> {
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

  private async reorderProjectsUnlocked(projectIds: string[]): Promise<Project[]> {
    const projects = await this.getProjects();
    const uniqueProjectIds = new Set(projectIds);
    const projectsById = new Map(projects.map((project) => [project.id, project]));

    if (
      projectIds.length !== projects.length ||
      uniqueProjectIds.size !== projects.length ||
      projectIds.some((projectId) => !projectsById.has(projectId))
    ) {
      throw new TypeError("The project order must contain every project exactly once.");
    }

    const reorderedProjects = projectIds.map(
      (projectId) => projectsById.get(projectId) as Project
    );
    await this.persistProjects(reorderedProjects);
    return this.cloneProjects(reorderedProjects);
  }

  private async getProjectsUnlocked(): Promise<Project[]> {
    return this.loadProjects();
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

  private async saveAgentWorkflowConfigurationUnlocked(
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
      ? { ...schedule, parameterValues: { ...schedule.parameterValues } }
      : null;
  }

  private async saveWorkflowScheduleConfigurationUnlocked(
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
        [projectId]: {
          ...schedule,
          parameterValues: { ...schedule.parameterValues }
        }
      }
    });
  }

  private async deleteProjectUnlocked(directoryPath: string): Promise<DeleteProjectResult> {
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
  }

  private readConfiguration(): Promise<ProjectConfiguration> {
    return this.repository.read<ProjectConfiguration>();
  }

  private writeConfiguration(configuration: ProjectConfiguration): Promise<void> {
    return this.repository.replace(configuration);
  }

  private cloneAgentWorkflowConfiguration(
    workflow: AgentWorkflowConfiguration
  ): AgentWorkflowConfiguration {
    return {
      hash: workflow.hash,
      agents: workflow.agents.map((agent) => ({
        ...agent,
        nextAgentIds: [...agent.nextAgentIds]
      })),
      parameters: workflow.parameters.map((parameter) => ({
        ...parameter,
        options: [...parameter.options]
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

  private validateImportedProject(name: string, files: UploadedProjectFile[]): void {
    assertPortableProjectName(name);
    assertProjectFileManifest(files.map((file) => ({
      relativePath: file.relativePath,
      size: file.content.byteLength
    })));
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
      ) &&
      Array.isArray(value.parameters) &&
      value.parameters.every((parameter) =>
        this.isRecord(parameter) &&
        typeof parameter.id === "string" &&
        typeof parameter.label === "string" &&
        typeof parameter.description === "string" &&
        typeof parameter.required === "boolean" &&
        (
          parameter.inputType === "text" ||
          parameter.inputType === "textarea" ||
          parameter.inputType === "select"
        ) &&
        typeof parameter.placeholder === "string" &&
        Array.isArray(parameter.options) &&
        parameter.options.every((option) => typeof option === "string")
      );
  }

  private isWorkflowScheduleConfiguration(
    value: unknown
  ): value is WorkflowScheduleConfiguration {
    return this.isRecord(value) &&
      typeof value.cron === "string" &&
      typeof value.enabled === "boolean" &&
      (
        value.parameterValues === undefined ||
        (
          this.isRecord(value.parameterValues) &&
          Object.values(value.parameterValues).every(
            (parameterValue) => typeof parameterValue === "string"
          )
        )
      );
  }

  private isStoredProject(value: unknown): value is StoredProject {
    return typeof value === "object" &&
      value !== null &&
      "directoryPath" in value &&
      typeof value.directoryPath === "string";
  }
}
