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
  instructions: string;
}

export interface CreateProjectResponse extends SaveProjectResponse {
  project: Project;
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

export function createProject(
  input: CreateProjectInput
): Promise<CreateProjectResponse> {
  return requestJson("/api/projects/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
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
