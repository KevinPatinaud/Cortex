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
  getMcpConnections: {
    fallbackStatus: 500,
    fallbackMessage: "Unable to discover MCP connections.",
    logMessage: "Unable to discover MCP connections:"
  },
  getCodexPlugins: {
    fallbackStatus: 500,
    fallbackMessage: "Unable to load Codex plugins.",
    logMessage: "Unable to load Codex plugins:"
  },
  installCodexPlugin: {
    fallbackStatus: 503,
    fallbackMessage: "Unable to install the Codex plugin.",
    logMessage: "Unable to install the Codex plugin:",
    exposeUnexpectedError: true
  },
  removeCodexPlugin: {
    fallbackStatus: 503,
    fallbackMessage: "Unable to remove the Codex plugin.",
    logMessage: "Unable to remove the Codex plugin:",
    exposeUnexpectedError: true
  },
  getMachineMcpConnection: {
    fallbackStatus: 500,
    fallbackMessage: "Unable to load the machine MCP connection.",
    logMessage: "Unable to load the machine MCP connection:"
  },
  createMachineMcpConnection: {
    fallbackStatus: 500,
    fallbackMessage: "Unable to create the machine MCP connection.",
    logMessage: "Unable to create the machine MCP connection:"
  },
  updateMachineMcpConnection: {
    fallbackStatus: 500,
    fallbackMessage: "Unable to update the machine MCP connection.",
    logMessage: "Unable to update the machine MCP connection:"
  },
  deleteMachineMcpConnection: {
    fallbackStatus: 500,
    fallbackMessage: "Unable to delete the machine MCP connection.",
    logMessage: "Unable to delete the machine MCP connection:"
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
  improveInstructions: {
    fallbackStatus: 503,
    fallbackMessage: "Unable to improve the project instructions.",
    logMessage: "Unable to improve the project instructions:",
    exposeUnexpectedError: true
  },
  reviewProject: {
    fallbackStatus: 503,
    fallbackMessage: "Unable to review the project.",
    logMessage: "Unable to review the project:",
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
  },
  getWorkflowSchedule: {
    fallbackStatus: 500,
    fallbackMessage: "Unable to load the workflow schedule.",
    logMessage: "Unable to load the workflow schedule:"
  },
  saveWorkflowSchedule: {
    fallbackStatus: 500,
    fallbackMessage: "Unable to save the workflow schedule.",
    logMessage: "Unable to save the workflow schedule:"
  },
  listWorkflowAuditRuns: {
    fallbackStatus: 500,
    fallbackMessage: "Unable to load the workflow audit history.",
    logMessage: "Unable to load the workflow audit history:"
  },
  getWorkflowAuditRun: {
    fallbackStatus: 500,
    fallbackMessage: "Unable to load the workflow audit run.",
    logMessage: "Unable to load the workflow audit run:"
  }
} satisfies Record<string, ErrorMappingOptions>;

export interface AgentStatusResponse {
  engine: AgentStatusOutput["engine"];
  label: string | null;
  error: string | null;
}

export interface AgentProjectResponse {
  dispatchRules?: AgentProject["dispatchRules"];
  workflowInstance?: AgentProject["workflowInstance"];
  workflowWaits?: AgentProject["workflowWaits"];
  projectId: string;
  workflowResumable: boolean;
  workflowParameterValues: Record<string, string>;
  directoryPath: string;
  engine: AgentProject["engine"];
  agents: AgentProject["agents"];
  instructions: AgentProject["instructions"];
  parameters: AgentProject["parameters"];
}

export interface AgentRunResponse {
  answer: string;
  auditRunId?: string;
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
    dispatchRules: project.dispatchRules,
    workflowResumable: project.workflowResumable,
    workflowInstance: project.workflowInstance,
    workflowWaits: project.workflowWaits,
    workflowParameterValues: project.workflowParameterValues,
    directoryPath: project.directoryPath,
    engine: project.engine,
    agents: project.agents,
    instructions: project.instructions,
    parameters: project.parameters
  };
}

export function toAgentRunResponse(result: AgentRunOutput): AgentRunResponse {
  return {
    answer: result.answer,
    ...(result.auditRunId ? { auditRunId: result.auditRunId } : {}),
    hasSession: result.hasSession,
    conversation: result.conversation,
    threads: result.threads
  };
}
