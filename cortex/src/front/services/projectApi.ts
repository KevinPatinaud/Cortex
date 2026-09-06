import { assertPortableProjectName, isExcludedProjectPath, isPortableProjectPath, maximumProjectFiles, maximumProjectBytes, maximumFileBytes } from "../../shared/ProjectArchivePolicy.ts";
import { requestBlob, requestJson } from "./apiClient.ts";

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

export type CreateProjectInput = {
  name: string;
  engine: "codex" | "claude" | "copilot";
} & (
  | { generationMode?: "ai"; description: string }
  | { generationMode: "empty"; instructions?: string }
);

export interface CreateProjectResponse extends SaveProjectResponse {
  project: Project;
  conversion?: {
    sourceEngine: CreateProjectInput["engine"];
    targetEngine: CreateProjectInput["engine"];
  } | null;
}

export interface ProjectSettings {
  projectsDirectory: string;
}

export interface BrowserProjectFile {
  relativePath: string;
  file: File;
}

export interface BrowserProjectUpload {
  projectName: string;
  files: BrowserProjectFile[];
}


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

export async function reorderProjects(projectIds: string[]): Promise<Project[]> {
  const data = await requestJson<ProjectsResponse>("/api/projects/order", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectIds })
  });
  return data.projects;
}

export function exportProjectArchive(projectId: string): Promise<Blob> {
  return requestBlob(
    `/api/projects/${encodeURIComponent(projectId)}/export`
  );
}

export function getProjectSettings(): Promise<ProjectSettings> {
  return requestJson("/api/projects/settings");
}

export function saveProjectSettings(
  projectsDirectory: string
): Promise<ProjectSettings> {
  return requestJson("/api/projects/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ projectsDirectory })
  });
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

export function importProjectArchive(
  archive: File
): Promise<CreateProjectResponse> {
  const body = new FormData();
  body.append("archive", archive, archive.name);

  return requestJson("/api/projects/import-archive", {
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

    const relativePath = segments.join("/");
    if (isExcludedProjectPath(relativePath)) return [];
    if (!isPortableProjectPath(relativePath)) {
      throw new Error(`The uploaded path "${relativePath}" is invalid.`);
    }
    if (file.size > maximumFileBytes) throw new Error("An uploaded file exceeds the 20 MB limit.");

    return [{ relativePath: segments.join("/"), file }];
  });

  if (files.length === 0) {
    throw new Error("The selected folder contains no importable files.");
  }

  assertPortableProjectName(projectName);
  if (files.length > maximumProjectFiles) throw new Error("The project exceeds the 2,000-file limit.");
  if (files.reduce((total, entry) => total + entry.file.size, 0) > maximumProjectBytes) {
    throw new Error("The project exceeds the 100 MB limit.");
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
