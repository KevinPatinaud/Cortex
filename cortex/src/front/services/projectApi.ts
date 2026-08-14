interface ApiErrorResponse {
  error?: string;
}

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
  const response = await fetch("/api/projects");
  const data = await response.json() as ProjectsResponse & ApiErrorResponse;

  if (!response.ok) {
    throw new Error(data.error || "Impossible de charger les projets.");
  }

  return data.projects;
}

export async function createProject(
  input: CreateProjectInput
): Promise<CreateProjectResponse> {
  const response = await fetch("/api/projects/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
  const data = await response.json() as CreateProjectResponse & ApiErrorResponse;

  if (!response.ok) {
    throw new Error(data.error || "Impossible de créer le projet.");
  }

  return data;
}

export async function saveProjectDirectory(
  directoryPath: string
): Promise<SaveProjectResponse> {
  const response = await fetch("/api/projects/save", {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ directoryPath })
  });
  const data = await response.json() as SaveProjectResponse & ApiErrorResponse;

  if (!response.ok) {
    throw new Error(data.error || "Impossible d'enregistrer le répertoire.");
  }

  return data;
}

export async function deleteProjectDirectory(
  directoryPath: string
): Promise<DeleteProjectResponse> {
  const response = await fetch("/api/projects", {
    method: "DELETE",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ directoryPath })
  });
  const data = await response.json() as DeleteProjectResponse & ApiErrorResponse;

  if (!response.ok) {
    throw new Error(data.error || "Impossible de supprimer le projet.");
  }

  return data;
}

export async function selectProjectInstructionsFile(): Promise<string | null> {
  const response = await fetch("/api/projects/select-instructions-file", {
    method: "POST"
  });
  const data = await response.json() as DirectorySelectionResponse & ApiErrorResponse;

  if (!response.ok) {
    throw new Error(data.error || "Impossible d'ouvrir le sélecteur de fichier.");
  }

  return data.directoryPath;
}
