import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

interface ProjectConfiguration {
  projects?: unknown;
  directoryPath?: unknown;
}

export interface DeleteProjectResult {
  projects: string[];
  deleted: boolean;
}

export class ProjectService {
  constructor(private readonly configurationFile: string) {}

  async saveProject(directoryPath: string): Promise<string[]> {
    if (!directoryPath.trim()) {
      throw new TypeError("Le chemin du repertoire est obligatoire.");
    }

    const normalizedPath = path.normalize(directoryPath.trim());
    const projects = await this.getProjects();
    const projectAlreadySaved = projects.some(
      (projectPath) => this.pathsAreEqual(projectPath, normalizedPath)
    );

    if (!projectAlreadySaved) {
      projects.push(normalizedPath);
    }

    await writeFile(
      this.configurationFile,
      JSON.stringify({ projects }, null, 2),
      "utf8"
    );

    return projects;
  }

  async getProjects(): Promise<string[]> {
    try {
      const configuration: unknown = JSON.parse(
        await readFile(this.configurationFile, "utf8")
      );

      if (!this.isProjectConfiguration(configuration)) {
        return [];
      }

      if (Array.isArray(configuration.projects)) {
        return configuration.projects.filter(
          (projectPath): projectPath is string =>
            typeof projectPath === "string" && Boolean(projectPath.trim())
        );
      }

      // Compatibilite avec l'ancien format : { "directoryPath": "..." }.
      if (
        typeof configuration.directoryPath === "string" &&
        configuration.directoryPath.trim()
      ) {
        return [path.normalize(configuration.directoryPath.trim())];
      }

      return [];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }

      throw error;
    }
  }

  async deleteProject(directoryPath: string): Promise<DeleteProjectResult> {
    if (!directoryPath.trim()) {
      throw new TypeError("Le chemin du repertoire est obligatoire.");
    }

    const normalizedPath = path.normalize(directoryPath.trim());
    const projects = await this.getProjects();
    const remainingProjects = projects.filter(
      (projectPath) => !this.pathsAreEqual(projectPath, normalizedPath)
    );
    const deleted = remainingProjects.length !== projects.length;

    if (deleted) {
      await writeFile(
        this.configurationFile,
        JSON.stringify({ projects: remainingProjects }, null, 2),
        "utf8"
      );
    }

    return { projects: remainingProjects, deleted };
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
}
