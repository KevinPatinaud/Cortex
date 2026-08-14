import type { ProjectOutput } from "../../../application/usecase/ProjectUseCase.ts";
import type { ErrorMappingOptions } from "./HttpErrorMapper.ts";

export const projectErrorMappings = {
  create: {
    fallbackStatus: 500,
    fallbackMessage: "Unable to create the project.",
    logMessage: "Unable to create the project:"
  },
  save: {
    fallbackStatus: 500,
    fallbackMessage: "Unable to save the directory.",
    logMessage: "Unable to save the directory:"
  },
  list: {
    fallbackStatus: 500,
    fallbackMessage: "Unable to read the saved directories.",
    logMessage: "Unable to read the saved directories:"
  },
  delete: {
    fallbackStatus: 500,
    fallbackMessage: "Unable to delete the project.",
    logMessage: "Unable to delete the project:"
  },
  selectDirectory: {
    fallbackStatus: 500,
    fallbackMessage: "Unable to open the directory picker.",
    logMessage: "Unable to open the directory picker:"
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
    message: "Directory saved.",
    projects
  };
}

export function toProjectDeletedResponse(
  projects: ProjectOutput[]
): ProjectMutationResponse {
  return {
    message: "Project deleted.",
    projects
  };
}

export function toSelectedDirectoryResponse(
  directoryPath: string | null
): SelectedDirectoryResponse {
  return { directoryPath };
}
