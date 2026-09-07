import type { ProjectOrganization } from "../../shared/ProjectOrganization.ts";
import { requestJson } from "./apiClient.ts";

export function getProjectFolders(): Promise<ProjectOrganization> {
  return requestJson("/api/projects/folders");
}

export function createProjectFolder(name: string): Promise<ProjectOrganization> {
  return requestJson("/api/projects/folders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name })
  });
}

export function renameProjectFolder(folderId: string, name: string): Promise<ProjectOrganization> {
  return requestJson(`/api/projects/folders/${encodeURIComponent(folderId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name })
  });
}

export function deleteProjectFolder(folderId: string): Promise<ProjectOrganization> {
  return requestJson(`/api/projects/folders/${encodeURIComponent(folderId)}`, { method: "DELETE" });
}

export function moveProjectToFolder(projectId: string, folderId: string | null): Promise<ProjectOrganization> {
  return requestJson(`/api/projects/${encodeURIComponent(projectId)}/folder`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ folderId })
  });
}
