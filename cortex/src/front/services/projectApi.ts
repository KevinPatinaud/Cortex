interface ApiErrorResponse {
  error?: string;
}

export interface SaveProjectResponse {
  message: string;
  projects: string[];
}

interface DirectorySelectionResponse {
  directoryPath: string | null;
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
    throw new Error(data.error || "Impossible d'enregistrer le repertoire.");
  }

  return data;
}

export async function selectProjectDirectory(): Promise<string | null> {
  const response = await fetch("/api/projects/select-directory", {
    method: "POST"
  });
  const data = await response.json() as DirectorySelectionResponse & ApiErrorResponse;

  if (!response.ok) {
    throw new Error(data.error || "Impossible d'ouvrir le selecteur de repertoire.");
  }

  return data.directoryPath;
}
