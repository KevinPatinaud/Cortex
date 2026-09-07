import type { AgentDefinition } from "../../../services/agentApi.ts";
import { getWorkflowEdgeKey } from "../../../../shared/AgentWorkflowGraph.ts";
import { getAgentConversationThreads, getAgentProgressState, getApplicableUpstreamAgents,
  getPlannedThreadCount, getTriggerUpstreamAgents, getUpstreamAgentResult, type AgentResultStates } from "./workflowState.ts";

export type WorkflowRoutingKind = "conditional" | "selected-one" | "parallel" | "per-instance" | "none" | "single" | "end" | "legacy";
export interface WorkflowRoutingPresentation {
  kind: WorkflowRoutingKind;
  selectedCount: number;
  totalCount: number;
}
export interface WorkflowInstancePresentation {
  mode: "root" | "separate" | "aggregate";
  count: number | null;
  phase: "unknown" | "planned" | "retained";
  hasJoin: boolean;
}

function authoritativeResponses(agent: AgentDefinition, states: AgentResultStates) {
  const state = states[agent.id];
  // A rerun or a partial failure may still expose earlier conversations. Those
  // responses cannot decide which of the upcoming branches will be omitted.
  return state && !state.isInvalidated && agent.executionStatus === "idle" ? state.responses : [];
}

export function getWorkflowRoutingPresentation(agent: AgentDefinition, states: AgentResultStates): WorkflowRoutingPresentation {
  const destinations = new Set(agent.nextAgentIds);
  const totalCount = destinations.size;
  const responses = authoritativeResponses(agent, states);
  if (!totalCount) return { kind: "end", totalCount, selectedCount: 0 };
  if (!responses.length) return { kind: totalCount > 1 ? "conditional" : "single", totalCount, selectedCount: 0 };
  const selections = responses.map((response) => (response.nextAgentIds ?? []).filter((id) => destinations.has(id)).sort());
  const selectedCount = new Set(selections.flat()).size;
  if (responses.some((response) => response.nextAgentIds === null)) return { kind: "legacy", totalCount, selectedCount };
  const differingRoutes = new Set(selections.map((ids) => JSON.stringify(ids))).size > 1;
  return { kind: differingRoutes ? "per-instance" : selectedCount === 0 ? "none" :
    selectedCount > 1 ? "parallel" : totalCount > 1 ? "selected-one" : "single", totalCount, selectedCount };
}

export function getWorkflowConnectionStatus(source: AgentDefinition, target: AgentDefinition, states: AgentResultStates): "pending" | "selected" | "inactive" | "running" {
  const responses = authoritativeResponses(source, states);
  if (responses.some((response) => response.nextAgentIds?.includes(target.id))) {
    return target.executionStatus === "running" ? "running" : "selected";
  }
  return responses.length && responses.every((response) => response.nextAgentIds !== null) ? "inactive" : "pending";
}

export function getWorkflowInstancePresentation(
  agent: AgentDefinition, workflowAgents: AgentDefinition[], states: AgentResultStates, feedbackKeys: ReadonlySet<string>
): WorkflowInstancePresentation {
  const upstream = workflowAgents.filter((candidate) => candidate.nextAgentIds.includes(agent.id));
  const forwardUpstream = upstream.filter((candidate) => !feedbackKeys.has(getWorkflowEdgeKey(candidate.id, agent.id)));
  const mode: WorkflowInstancePresentation["mode"] = agent.inputMode === "aggregate" ? "aggregate" : forwardUpstream.length ? "separate" : "root";
  const base = { mode, hasJoin: forwardUpstream.length > 1 };
  const retainedCount = states[agent.id]?.isInvalidated ? 0 : Math.max(
    getAgentConversationThreads(agent).length, states[agent.id]?.responses.length ?? 0
  );
  // A running agent may be rerunning just one of its existing sessions. The
  // project snapshot exposes retained sessions, not the selected rerun count.
  if (retainedCount > 0) {
    return { ...base, count: retainedCount, phase: "retained" };
  }
  const triggers = getTriggerUpstreamAgents(upstream, agent.id, states, feedbackKeys);
  const applicable = getApplicableUpstreamAgents(upstream, agent.id, states);
  const ready = !triggers.length || (
    triggers.every((source) => !states[source.id]?.isInvalidated &&
      getAgentProgressState(source, workflowAgents, states, feedbackKeys) !== "pending") &&
    applicable.length > 0 && applicable.every((source) => !states[source.id]?.isInvalidated &&
      getUpstreamAgentResult(source, agent.id, states) !== null)
  );
  if (ready) return { ...base, count: Math.max(retainedCount, getPlannedThreadCount(agent, applicable, states)), phase: "planned" };
  // Aggregation is a declared single-session strategy; it does not imply that
  // the session is ready. A separate-input agent has no known count yet.
  return { ...base, count: mode === "aggregate" ? 1 : null, phase: "unknown" };
}
