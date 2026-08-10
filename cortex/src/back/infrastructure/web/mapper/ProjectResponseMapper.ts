import type { ProjectOutput } from "../../../application/usecase/ProjectUseCase.ts";
import type { ErrorMappingOptions } from "./HttpErrorMapper.ts";

export const projectErrorMappings = {
  save: {
    fallbackStatus: 500,
    fallbackMessage: "Impossible d'enregistrer le repertoire.",
    logMessage: "Impossible d'enregistrer le repertoire :"
  },
  list: {
    fallbackStatus: 500,
    fallbackMessage: "Impossible de lire les repertoires enregistres.",
    logMessage: "Impossible de lire les repertoires enregistres :"
  },
  delete: {
    fallbackStatus: 500,
    fallbackMessage: "Impossible de supprimer le projet.",
    logMessage: "Impossible de supprimer le projet :"
  },
  selectDirectory: {
    fallbackStatus: 500,
    fallbackMessage: "Impossible d'ouvrir le selecteur de repertoire.",
    logMessage: "Impossible d'ouvrir le selecteur de repertoire :"
  }
} satisfies Record<string, ErrorMappingOptions>;

export interface ProjectsResponse {
  projects: ProjectOutput[];
}

export interface ProjectMutationResponse extends ProjectsResponse {
  message: string;
}

export interface SelectedDirectoryResponse {
  directoryPath: string | null;
}

export function toProjectsResponse(projects: ProjectOutput[]): ProjectsResponse {
  return { projects };
}

export function toProjectSavedResponse(
  projects: ProjectOutput[]
): ProjectMutationResponse {
  return {
    message: "Repertoire enregistre.",
    projects
  };
}

export function toProjectDeletedResponse(
  projects: ProjectOutput[]
): ProjectMutationResponse {
  return {
    message: "Projet supprime.",
    projects
  };
}

export function toSelectedDirectoryResponse(
  directoryPath: string | null
): SelectedDirectoryResponse {
  return { directoryPath };
}
