import { requestJson } from "./apiClient.ts";

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
  executionStatus: "idle" | "running" | "failed";
  executionError?: string;
  conversation: AgentConversationMessage[];
  threads: AgentConversationThread[];
  model?: string;
  reasoningEffort?: string;
  prompt: string;
}

export interface AgentConversationMessage {
  role: "user" | "agent";
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
  projectId: string;
  directoryPath: string;
  engine: AgentEngine;
  agents: AgentDefinition[];
  instructions: ProjectInstructions;
}

export interface AgentRunResult {
  answer: string;
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
  lastRunStatus: "succeeded" | "failed" | "skipped" | null;
  lastRunError: string | null;
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

export function getAgentStatus(): Promise<AgentStatus> {
  return requestJson("/api/agents/status");
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

export async function runAgent(
  projectId: string,
  agentId: string,
  additionalInstructions: string,
  upstreamAgentResults?: UpstreamAgentResult[],
  threadId?: string
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
        ...(upstreamAgentResults && upstreamAgentResults.length > 0
          ? { upstreamAgentResults }
          : {})
      })
    }
  );

  return {
    answer: data.answer,
    hasSession: data.hasSession,
    conversation: data.conversation,
    threads: data.threads
  };
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
  schedule: Pick<WorkflowSchedule, "cron" | "enabled">
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
