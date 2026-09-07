import { requestBlob, requestJson } from "./apiClient.ts";
import type { WorkflowInstanceState, WorkflowWaitingThread } from "../../shared/WorkflowWait.ts";
import type { ProjectReviewProposal } from "../../shared/ProjectReviewProposal.ts";
import type {
  McpConnectionEngine,
  McpConnectionSummary,
  McpDiscoveryResult,
  McpMachineConnectionDetail,
  McpMachineConnectionInput
} from "../../shared/McpConnection.ts";
import type {
  CodexPluginCatalog,
  CodexPluginSummary
} from "../../shared/CodexPlugin.ts";
import type {
  WorkflowParameterDefinition,
  WorkflowParameterValues
} from "../../shared/WorkflowParameter.ts";

export type {
  WorkflowParameterDefinition,
  WorkflowParameterValues
} from "../../shared/WorkflowParameter.ts";

export type {
  McpConnectionEngine,
  McpConnectionSummary,
  McpDiscoveryIssue,
  McpDiscoveryResult,
  McpMachineConnectionDetail,
  McpMachineConnectionInput
} from "../../shared/McpConnection.ts";

export type {
  CodexPluginAuthPolicy,
  CodexPluginCatalog,
  CodexPluginSummary
} from "../../shared/CodexPlugin.ts";

export type {
  WorkflowAuditAgentExecution,
  WorkflowAuditRunDetail,
  WorkflowAuditRunPage,
  WorkflowAuditRunScope,
  WorkflowAuditRunStatus,
  WorkflowAuditRunSummary,
  WorkflowAuditTrigger
} from "../../shared/WorkflowAudit.ts";

export type AgentEngine = "codex" | "claude" | "copilot";

export interface AgentStatus {
  engine: AgentEngine | null;
  label: string | null;
  error: string | null;
}

export interface AgentDefinition {
  id: string;
  name: string;
  description: string;
  nextAgentIds: string[];
  inputMode: "separate" | "aggregate";
  hasSession: boolean;
  executionStatus: "idle" | "running" | "failed" | "cancelled" | "waiting";
  executionError?: string;
  executionStartedAt?: string;
  executionLastActivityAt?: string;
  executionProgress?: string;
  conversation: AgentConversationMessage[];
  threads: AgentConversationThread[];
  model?: string;
  reasoningEffort?: string;
  prompt: string;
}

export interface AgentConversationMessage {
  role: "user" | "agent" | "event";
  content: string;
}

export interface AgentConversationThread {
  id: string;
  conversation: AgentConversationMessage[];
}

export interface ProjectInstructions {
  fileName: string;
  content: string | null;
}

export interface AgentProject {
  workflowInstance?: WorkflowInstanceState;
  workflowWaits?: WorkflowWaitingThread[];
  projectId: string;
  workflowResumable: boolean;
  workflowParameterValues: WorkflowParameterValues;
  directoryPath: string;
  engine: AgentEngine;
  agents: AgentDefinition[];
  instructions: ProjectInstructions;
  parameters: WorkflowParameterDefinition[];
}

export interface AgentRunResult {
  answer: string;
  auditRunId?: string;
  hasSession: boolean;
  conversation: AgentConversationMessage[];
  threads: AgentConversationThread[];
}

export interface UpstreamAgentResult {
  agentId: string;
  selectedItemIndexes: number[];
}

export interface AgentConfiguration {
  autopilot: boolean;
  allowAll: boolean;
}

export interface WorkflowSchedule {
  cron: string;
  enabled: boolean;
  timezone: string;
  nextRunAt: string | null;
  running: boolean;
  lastRunAt: string | null;
  lastRunStatus: "waiting" | "succeeded" | "failed" | "skipped" | "cancelled" | "interrupted" | null;
  lastRunError: string | null;
  parameterValues: WorkflowParameterValues;
}

export interface EditableAgentDefinition {
  id?: string;
  name: string;
  description: string;
  prompt: string;
  model?: string;
  reasoningEffort?: string;
}

export interface EditableAgentProject {
  name: string;
  engine: AgentEngine;
  instructions: string;
  agents: EditableAgentDefinition[];
}

export interface ImproveProjectAgent {
  key: string;
  name: string;
  description: string;
  prompt: string;
}

export interface ImproveAgentInput {
  targetAgentKey: string;
  instructions: string;
  agents: ImproveProjectAgent[];
}

export interface ImproveInstructionsInput {
  instructions: string;
  agents: ImproveProjectAgent[];
}

export interface ImproveInstructionsResult {
  instructions: string;
}

export type ProjectReviewAssessment = "healthy" | "needs_attention" | "critical";
export type ProjectReviewSeverity = "critical" | "warning" | "suggestion";
export type ProjectReviewScope = "project" | "instructions" | "agent";

export interface ReviewProjectAgent extends ImproveProjectAgent {
  model: string;
  reasoningEffort: string;
}

export interface ReviewProjectInput {
  projectName: string;
  instructions: string;
  agents: ReviewProjectAgent[];
  message?: string;
  conversation?: ProjectReviewMessage[];
  currentProposal?: ProjectReviewProposal;
}

export interface ProjectReviewMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ProjectReviewFinding {
  severity: ProjectReviewSeverity;
  scope: ProjectReviewScope;
  agentKey: string | null;
  title: string;
  description: string;
  recommendation: string;
}

export interface ProjectReview {
  assessment: ProjectReviewAssessment;
  summary: string;
  findings: ProjectReviewFinding[];
  proposal?: ProjectReviewProposal | null;
}

export function getAgentStatus(): Promise<AgentStatus> {
  return requestJson("/api/agents/status");
}

export function getMcpConnections(
  projectId?: string
): Promise<McpDiscoveryResult> {
  const query = projectId
    ? `?projectId=${encodeURIComponent(projectId)}`
    : "";

  return requestJson(`/api/agents/mcp-connections${query}`);
}

export function getCodexPlugins(): Promise<CodexPluginCatalog> {
  return requestJson("/api/agents/codex-plugins");
}

export function installCodexPlugin(
  pluginId: CodexPluginSummary["id"]
): Promise<CodexPluginCatalog> {
  return requestJson(
    `/api/agents/codex-plugins/${encodeURIComponent(pluginId)}/install`,
    { method: "POST" }
  );
}

export function removeCodexPlugin(
  pluginId: CodexPluginSummary["id"]
): Promise<CodexPluginCatalog> {
  return requestJson(
    `/api/agents/codex-plugins/${encodeURIComponent(pluginId)}`,
    { method: "DELETE" }
  );
}

export function getMachineMcpConnection(
  engine: McpConnectionEngine,
  name: string
): Promise<McpMachineConnectionDetail> {
  return requestJson(
    `/api/agents/mcp-connections/${encodeURIComponent(engine)}/${encodeURIComponent(name)}`
  );
}

export function createMachineMcpConnection(
  input: McpMachineConnectionInput
): Promise<McpConnectionSummary> {
  return requestJson("/api/agents/mcp-connections", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });
}

export function updateMachineMcpConnection(
  engine: McpConnectionEngine,
  name: string,
  input: McpMachineConnectionInput
): Promise<McpConnectionSummary> {
  return requestJson(
    `/api/agents/mcp-connections/${encodeURIComponent(engine)}/${encodeURIComponent(name)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input)
    }
  );
}

export async function deleteMachineMcpConnection(
  engine: McpConnectionEngine,
  name: string
): Promise<void> {
  await requestJson<{ message: string }>(
    `/api/agents/mcp-connections/${encodeURIComponent(engine)}/${encodeURIComponent(name)}`,
    { method: "DELETE" }
  );
}

export async function getAgentConfiguration(): Promise<AgentConfiguration> {
  const data = await requestJson<AgentConfiguration>(
    "/api/agents/configuration"
  );
  return { autopilot: data.autopilot, allowAll: data.allowAll };
}

export async function saveAgentConfiguration(
  configuration: AgentConfiguration
): Promise<AgentConfiguration> {
  const data = await requestJson<AgentConfiguration>(
    "/api/agents/configuration",
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(configuration)
    }
  );
  return { autopilot: data.autopilot, allowAll: data.allowAll };
}

export function loadAgentProject(projectId: string): Promise<AgentProject> {
  return requestJson(
    `/api/agents/projects/${encodeURIComponent(projectId)}`
  );
}

export function saveAgentProject(
  projectId: string,
  draft: EditableAgentProject
): Promise<AgentProject> {
  return requestJson(
    `/api/agents/projects/${encodeURIComponent(projectId)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft)
    }
  );
}

export function getActualLoadedAgentProject(): Promise<AgentProject | null> {
  return requestJson("/api/agents/projects/actual");
}

export async function improveAgent(
  projectId: string,
  input: ImproveAgentInput
): Promise<ImproveProjectAgent> {
  return requestJson<ImproveProjectAgent>(
    `/api/agents/projects/${encodeURIComponent(projectId)}/agents/improve`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input)
    }
  );
}

export async function improveInstructions(
  projectId: string,
  input: ImproveInstructionsInput
): Promise<ImproveInstructionsResult> {
  return requestJson<ImproveInstructionsResult>(
    `/api/agents/projects/${encodeURIComponent(projectId)}/instructions/improve`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input)
    }
  );
}

export async function reviewProject(
  projectId: string,
  input: ReviewProjectInput
): Promise<ProjectReview> {
  return requestJson<ProjectReview>(
    `/api/agents/projects/${encodeURIComponent(projectId)}/review`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input)
    }
  );
}

export async function runAgent(
  projectId: string,
  agentId: string,
  additionalInstructions: string,
  upstreamAgentResults?: UpstreamAgentResult[],
  threadId?: string,
  workflowParameterValues?: WorkflowParameterValues
): Promise<AgentRunResult> {
  const data = await requestJson<AgentRunResult>(
    `/api/agents/projects/${encodeURIComponent(projectId)}/agents/run`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        agentId,
        ...(threadId ? { threadId } : {}),
        ...(additionalInstructions.trim()
          ? { additionalInstructions: additionalInstructions.trim() }
          : {}),
        ...(workflowParameterValues
          ? { workflowParameterValues }
          : {}),
        ...(upstreamAgentResults && upstreamAgentResults.length > 0
          ? { upstreamAgentResults }
          : {})
      })
    }
  );

  return {
    answer: data.answer,
    ...(data.auditRunId ? { auditRunId: data.auditRunId } : {}),
    hasSession: data.hasSession,
    conversation: data.conversation,
    threads: data.threads
  };
}

export async function cancelProjectExecution(projectId: string): Promise<void> {
  await requestJson<{ cancelled: boolean }>(
    `/api/agents/projects/${encodeURIComponent(projectId)}/workflow/cancel`,
    { method: "POST" }
  );
}

export async function resumeWorkflow(projectId: string): Promise<void> {
  await requestJson(
    `/api/agents/projects/${encodeURIComponent(projectId)}/workflow/resume`,
    { method: "POST" }
  );
}

export async function resetAgentProjectWorkflow(
  projectId: string
): Promise<void> {
  await requestJson<{ message: string }>(
    `/api/agents/projects/${encodeURIComponent(projectId)}/workflow/reset`,
    { method: "POST" }
  );
}

export function getWorkflowSchedule(
  projectId: string
): Promise<WorkflowSchedule> {
  return requestJson(
    `/api/agents/projects/${encodeURIComponent(projectId)}/workflow/schedule`
  );
}

export function saveWorkflowSchedule(
  projectId: string,
  schedule: Pick<WorkflowSchedule, "cron" | "enabled" | "parameterValues">
): Promise<WorkflowSchedule> {
  return requestJson(
    `/api/agents/projects/${encodeURIComponent(projectId)}/workflow/schedule`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(schedule)
    }
  );
}

export function getWorkflowAuditRuns(
  projectId: string,
  scope: import("../../shared/WorkflowAudit.ts").WorkflowAuditRunScope,
  limit = 20,
  offset = 0
) {
  const query = new URLSearchParams({
    scope,
    limit: String(limit),
    offset: String(offset)
  });
  return requestJson<import("../../shared/WorkflowAudit.ts").WorkflowAuditRunPage>(
    `/api/agents/projects/${encodeURIComponent(projectId)}/audit/runs?${query}`
  );
}

export function getWorkflowAuditRun(projectId: string, runId: string) {
  return requestJson<import("../../shared/WorkflowAudit.ts").WorkflowAuditRunDetail>(
    `/api/agents/projects/${encodeURIComponent(projectId)}/audit/runs/${encodeURIComponent(runId)}`
  );
}

export function exportWorkflowAuditRun(
  projectId: string,
  runId: string
): Promise<Blob> {
  return requestBlob(
    `/api/agents/projects/${encodeURIComponent(projectId)}/audit/runs/${encodeURIComponent(runId)}/export`
  );
}
