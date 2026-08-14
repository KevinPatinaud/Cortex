import type {
  AgentProject,
  AgentRunOutput,
  AgentStatusOutput
} from "../../../application/usecase/AgentUseCase.ts";
import type { ErrorMappingOptions } from "./HttpErrorMapper.ts";

export const agentErrorMappings = {
  status: {
    fallbackStatus: 500,
    fallbackMessage: "Unable to detect the AI engine.",
    logMessage: "Unable to detect the AI engine:",
    toFallbackBody: (message: string) => ({
      engine: null,
      label: null,
      error: message
    })
  },
  getConfiguration: {
    fallbackStatus: 500,
    fallbackMessage: "Unable to load the agent configuration.",
    logMessage: "Unable to load the agent configuration:"
  },
  saveConfiguration: {
    fallbackStatus: 500,
    fallbackMessage: "Unable to save the agent configuration.",
    logMessage: "Unable to save the agent configuration:"
  },
  loadProject: {
    fallbackStatus: 500,
    fallbackMessage: "Unable to load the project.",
    logMessage: "Unable to load the project:"
  },
  saveProject: {
    fallbackStatus: 500,
    fallbackMessage: "Unable to save the project.",
    logMessage: "Unable to save the project:"
  },
  improveAgent: {
    fallbackStatus: 503,
    fallbackMessage: "Unable to improve the agent.",
    logMessage: "Unable to improve the agent:",
    exposeUnexpectedError: true
  },
  runAgent: {
    fallbackStatus: 503,
    fallbackMessage: "Unable to run the agent.",
    logMessage: "Unable to run the agent:",
    exposeUnexpectedError: true
  },
  resetWorkflow: {
    fallbackStatus: 500,
    fallbackMessage: "Unable to reset the workflow.",
    logMessage: "Unable to reset the workflow:"
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
