import { requestJson } from "./apiClient.ts";

export interface Project {
  id: string;
  directoryPath: string;
}

export interface SaveProjectResponse {
  message: string;
  projects: Project[];
}

export interface DeleteProjectResponse {
  message: string;
  projects: Project[];
}

export interface CreateProjectInput {
  parentDirectory: string;
  name: string;
  engine: "codex" | "claude" | "copilot";
  description: string;
}

export interface CreateProjectResponse extends SaveProjectResponse {
  project: Project;
}

export interface BrowserProjectFile {
  relativePath: string;
  file: File;
}

export interface BrowserProjectUpload {
  projectName: string;
  files: BrowserProjectFile[];
}

const excludedDirectoryNames = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next"
]);

interface DirectorySelectionResponse {
  directoryPath: string | null;
}

interface ProjectsResponse {
  projects: Project[];
}

export async function getSavedProjects(): Promise<Project[]> {
  const data = await requestJson<ProjectsResponse>("/api/projects");
  return data.projects;
}

export function createProject(
  input: CreateProjectInput
): Promise<CreateProjectResponse> {
  return requestJson("/api/projects/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
}

export function importProjectDirectory(
  upload: BrowserProjectUpload
): Promise<CreateProjectResponse> {
  const body = new FormData();
  body.append("projectName", upload.projectName);
  body.append(
    "relativePaths",
    JSON.stringify(upload.files.map((entry) => entry.relativePath))
  );

  for (const entry of upload.files) {
    body.append("files", entry.file, entry.file.name);
  }

  return requestJson("/api/projects/import", {
    method: "POST",
    body
  });
}

export function prepareProjectDirectoryUpload(
  selectedFiles: File[]
): BrowserProjectUpload {
  if (selectedFiles.length === 0) {
    throw new Error("The selected folder is empty.");
  }

  const firstPath = getBrowserRelativePath(selectedFiles[0] as File);
  const projectName = firstPath.split("/")[0]?.trim() ?? "";

  if (!projectName || !firstPath.includes("/")) {
    throw new Error("Unable to determine the selected project folder.");
  }

  const files = selectedFiles.flatMap((file): BrowserProjectFile[] => {
    const browserPath = getBrowserRelativePath(file);
    const [rootName, ...segments] = browserPath.split("/");

    if (rootName !== projectName || segments.length === 0) {
      throw new Error("The selected files do not belong to the same folder.");
    }

    const normalizedSegments = segments.map((segment) => segment.toLowerCase());
    const fileName = normalizedSegments.at(-1) ?? "";
    const isExcludedDirectory = normalizedSegments
      .slice(0, -1)
      .some((segment) => excludedDirectoryNames.has(segment));
    const isSensitiveEnvironmentFile =
      (fileName === ".env" || fileName.startsWith(".env.")) &&
      fileName !== ".env.example";

    if (isExcludedDirectory || isSensitiveEnvironmentFile) {
      return [];
    }

    return [{ relativePath: segments.join("/"), file }];
  });

  if (files.length === 0) {
    throw new Error("The selected folder contains no importable files.");
  }

  return { projectName, files };
}

function getBrowserRelativePath(file: File): string {
  return file.webkitRelativePath.replace(/\\/g, "/").replace(/^\/+/, "");
}

export function saveProjectDirectory(
  directoryPath: string
): Promise<SaveProjectResponse> {
  return requestJson("/api/projects/save", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ directoryPath })
  });
}

export function deleteProjectDirectory(
  directoryPath: string
): Promise<DeleteProjectResponse> {
  return requestJson("/api/projects", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ directoryPath })
  });
}

export async function selectProjectInstructionsFile(): Promise<string | null> {
  const data = await requestJson<DirectorySelectionResponse>(
    "/api/projects/select-instructions-file",
    { method: "POST" }
  );
  return data.directoryPath;
}
