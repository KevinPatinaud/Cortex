import type {
  AgentProject,
  AgentRunOutput,
  AgentStatusOutput
} from "../../../application/usecase/AgentUseCase.ts";
import type { ErrorMappingOptions } from "./HttpErrorMapper.ts";

export const agentErrorMappings = {
  status: {
    fallbackStatus: 500,
    fallbackMessage: "Impossible de détecter le moteur IA.",
    logMessage: "Impossible de détecter le moteur IA :",
    toFallbackBody: (message: string) => ({
      engine: null,
      label: null,
      error: message
    })
  },
  getConfiguration: {
    fallbackStatus: 500,
    fallbackMessage: "Impossible de charger la configuration des agents.",
    logMessage: "Impossible de charger la configuration des agents :"
  },
  saveConfiguration: {
    fallbackStatus: 500,
    fallbackMessage: "Impossible d'enregistrer la configuration des agents.",
    logMessage: "Impossible d'enregistrer la configuration des agents :"
  },
  loadProject: {
    fallbackStatus: 500,
    fallbackMessage: "Impossible de charger le projet.",
    logMessage: "Impossible de charger le projet :"
  },
  saveProject: {
    fallbackStatus: 500,
    fallbackMessage: "Impossible d'enregistrer le projet.",
    logMessage: "Impossible d'enregistrer le projet :"
  },
  runAgent: {
    fallbackStatus: 503,
    fallbackMessage: "Impossible d'exécuter l'agent.",
    logMessage: "Impossible d'exécuter l'agent :",
    exposeUnexpectedError: true
  },
  resetWorkflow: {
    fallbackStatus: 500,
    fallbackMessage: "Impossible de réinitialiser le workflow.",
    logMessage: "Impossible de réinitialiser le workflow :"
  }
} satisfies Record<string, ErrorMappingOptions>;

export interface AgentStatusResponse {
  engine: AgentStatusOutput["engine"];
  label: string | null;
  error: string | null;
}

export interface AgentProjectResponse {
  projectId: string;
  directoryPath: string;
  engine: AgentProject["engine"];
  agents: AgentProject["agents"];
  instructions: AgentProject["instructions"];
}

export interface AgentRunResponse {
  answer: string;
  hasSession: boolean;
  conversation: AgentRunOutput["conversation"];
  threads: AgentRunOutput["threads"];
}

export function toAgentStatusResponse(
  status: AgentStatusOutput
): AgentStatusResponse {
  return {
    engine: status.engine,
    label: status.label,
    error: status.error
  };
}

export function toAgentProjectResponse(
  project: AgentProject
): AgentProjectResponse {
  return {
    projectId: project.projectId,
    directoryPath: project.directoryPath,
    engine: project.engine,
    agents: project.agents,
    instructions: project.instructions
  };
}

export function toAgentRunResponse(result: AgentRunOutput): AgentRunResponse {
  return {
    answer: result.answer,
    hasSession: result.hasSession,
    conversation: result.conversation,
    threads: result.threads
  };
}
