import type {
  AgentProject,
  AgentRunOutput,
  AgentStatusOutput
} from "../../../application/usecase/AgentUseCase.ts";
import type { ErrorMappingOptions } from "./HttpErrorMapper.ts";

export const agentErrorMappings = {
  status: {
    fallbackStatus: 500,
    fallbackMessage: "Impossible de detecter le moteur IA.",
    logMessage: "Impossible de detecter le moteur IA :",
    toFallbackBody: (message: string) => ({
      engine: null,
      label: null,
      error: message
    })
  },
  loadProject: {
    fallbackStatus: 500,
    fallbackMessage: "Impossible de charger le projet.",
    logMessage: "Impossible de charger le projet :"
  },
  runAgent: {
    fallbackStatus: 503,
    fallbackMessage: "Impossible d'executer l'agent.",
    logMessage: "Impossible d'executer l'agent :",
    exposeUnexpectedError: true
  }
} satisfies Record<string, ErrorMappingOptions>;

export interface AgentStatusResponse {
  engine: AgentStatusOutput["engine"];
  label: string | null;
  error: string | null;
}

export interface AgentProjectResponse {
  projectId: string;
  engine: AgentProject["engine"];
  agents: AgentProject["agents"];
  instructions: AgentProject["instructions"];
}

export interface AgentRunResponse {
  answer: string;
  hasSession: boolean;
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
    engine: project.engine,
    agents: project.agents,
    instructions: project.instructions
  };
}

export function toAgentRunResponse(result: AgentRunOutput): AgentRunResponse {
  return {
    answer: result.answer,
    hasSession: result.hasSession
  };
}
