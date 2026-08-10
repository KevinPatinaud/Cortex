import type { AgentStatusOutput } from "../../../application/usecase/AgentUseCase.ts";
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
  ask: {
    fallbackStatus: 503,
    fallbackMessage: "Le moteur IA est indisponible.",
    logMessage: "Impossible d'obtenir une reponse du moteur IA :",
    exposeUnexpectedError: true
  }
} satisfies Record<string, ErrorMappingOptions>;

export interface AgentAnswerResponse {
  answer: string;
}

export interface AgentStatusResponse {
  engine: AgentStatusOutput["engine"];
  label: string | null;
  error: string | null;
}

export function toAgentAnswerResponse(answer: string): AgentAnswerResponse {
  return { answer };
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
