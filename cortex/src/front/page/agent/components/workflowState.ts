import type { AgentConversationThread, AgentDefinition, UpstreamAgentResult, WorkflowParameterDefinition, WorkflowParameterValues } from "../../../services/agentApi.ts";
import { parseAgentResponse, type AgentResponsePayload } from "../../../../shared/AgentResponse.ts";
import { getWorkflowEdgeKey } from "../../../../shared/AgentWorkflowGraph.ts";
import type { Translate } from "../../../i18n.tsx";

export interface AgentResultState {
  responses: AgentResponsePayload[];
  selectedItemIndexes: number[];
  isInvalidated: boolean;
}

export function getMissingWorkflowParameters(
  parameters: WorkflowParameterDefinition[],
  values: WorkflowParameterValues
): WorkflowParameterDefinition[] {
  return parameters.filter(
    (parameter) => parameter.required && !values[parameter.id]?.trim()
  );
}

export type AgentResultStates = Record<string, AgentResultState>;

export function getDefaultHandoffSelections(
  state: AgentResultState
): number[] {
  const selectedItemIndexes: number[] = [];
  let itemIndexOffset = 0;

  for (const response of state.responses) {
    if (response.items.length > 1) {
      const existingSelections = state.selectedItemIndexes.filter(
        (itemIndex) =>
          itemIndex >= itemIndexOffset &&
          itemIndex < itemIndexOffset + response.items.length
      );

      if (existingSelections.length > 0) {
        selectedItemIndexes.push(...(
          response.isMultiSelectionAllowed === true
            ? existingSelections
            : existingSelections.slice(0, 1)
        ));
      } else if (response.isMultiSelectionAllowed === true) {
        selectedItemIndexes.push(...response.items.map(
          (_item, itemIndex) => itemIndexOffset + itemIndex
        ));
      } else {
        selectedItemIndexes.push(itemIndexOffset);
      }
    }

    itemIndexOffset += response.items.length;
  }

  return selectedItemIndexes;
}

export function haveSameIndexes(first: number[], second: number[]): boolean {
  return first.length === second.length &&
    first.every((itemIndex, index) => itemIndex === second[index]);
}

export function findLastAgentResponses(
  threads: AgentConversationThread[]
): AgentResponsePayload[] {
  const responses: AgentResponsePayload[] = [];

  for (const thread of threads) {
    for (let index = thread.conversation.length - 1; index >= 0; index -= 1) {
      if (thread.conversation[index].role === "agent") {
        const response = parseAgentResponse(thread.conversation[index].content);

        if (response) {
          responses.push(response);
        }
        break;
      }
    }
  }

  return responses;
}

export function getAgentConversationThreads(
  agent: AgentDefinition
): AgentConversationThread[] {
  if (agent.threads?.length > 0) {
    return agent.threads;
  }

  return agent.conversation.length > 0
    ? [{ id: "thread-1", conversation: agent.conversation }]
    : [];
}

export function getPrerequisiteMessage(
  upstreamAgents: AgentDefinition[],
  targetAgentId: string,
  states: AgentResultStates,
  workflowAgents: AgentDefinition[],
  feedbackEdgeKeys: ReadonlySet<string>,
  t: Translate
): string | null {
  if (upstreamAgents.length === 0) {
    return null;
  }

  const triggerUpstreamAgents = getTriggerUpstreamAgents(
    upstreamAgents,
    targetAgentId,
    states,
    feedbackEdgeKeys
  );

  if (triggerUpstreamAgents.length === 0) {
    return null;
  }

  const pendingAgents = triggerUpstreamAgents.filter((agent) =>
    getAgentProgressState(
      agent,
      workflowAgents,
      states,
      feedbackEdgeKeys
    ) === "pending"
  );

  if (pendingAgents.length > 0) {
    return triggerUpstreamAgents.length === 1
      ? t("prerequisite.runFirst", { name: pendingAgents[0].name })
      : t("prerequisite.waitAll", {
        names: pendingAgents.map((agent) => `“${agent.name}”`).join(", ")
      });
  }

  const applicableTriggerAgents = getApplicableUpstreamAgents(
    triggerUpstreamAgents,
    targetAgentId,
    states
  );

  if (applicableTriggerAgents.length === 0) {
    return t("prerequisite.notSelected");
  }

  const applicableUpstreamAgents = getApplicableUpstreamAgents(
    upstreamAgents,
    targetAgentId,
    states
  );

  if (applicableUpstreamAgents.every((agent) =>
    getUpstreamAgentResult(agent, targetAgentId, states)
  )) {
    return null;
  }

  const agentAwaitingSelection = applicableUpstreamAgents.find((agent) => {
    const state = states[agent.id];
    return Boolean(state?.responses.some((response) =>
      responseRoutesToAgent(response, targetAgentId) &&
      response.items.length > 1
    ));
  });

  if (agentAwaitingSelection) {
    const response = states[agentAwaitingSelection.id].responses.find(
      (candidate) => responseRoutesToAgent(candidate, targetAgentId) &&
        candidate.items.length > 1
    )!;
    return response.isMultiSelectionAllowed === true
      ? t("prerequisite.selectMany", { name: agentAwaitingSelection.name })
      : t("prerequisite.selectOne", { name: agentAwaitingSelection.name });
  }

  if (applicableUpstreamAgents.some(
    (agent) => states[agent.id]?.responses.some(
      (response) => responseRoutesToAgent(response, targetAgentId) &&
        response.items.length === 0
    )
  )) {
    return t("prerequisite.noResult");
  }

  return t("prerequisite.notReady");
}

export function getAgentProgressState(
  agent: AgentDefinition,
  workflowAgents: AgentDefinition[],
  states: AgentResultStates,
  feedbackEdgeKeys: ReadonlySet<string>,
  visitingAgentIds = new Set<string>()
): "completed" | "pending" | "skipped" {
  if (agent.executionStatus === "running" || agent.executionStatus === "failed" ||
    agent.executionStatus === "cancelled") {
    return "pending";
  }

  if ((states[agent.id]?.responses.length ?? 0) > 0) {
    return "completed";
  }

  const upstreamAgents = workflowAgents.filter((candidate) =>
    candidate.nextAgentIds.includes(agent.id)
  );

  if (upstreamAgents.length === 0 || visitingAgentIds.has(agent.id)) {
    return "pending";
  }

  const triggerUpstreamAgents = getTriggerUpstreamAgents(
    upstreamAgents,
    agent.id,
    states,
    feedbackEdgeKeys
  );

  if (triggerUpstreamAgents.length === 0) {
    return "pending";
  }

  const nextVisitingAgentIds = new Set(visitingAgentIds);
  nextVisitingAgentIds.add(agent.id);
  const upstreamStates = triggerUpstreamAgents.map((upstreamAgent) => ({
    agent: upstreamAgent,
    progress: getAgentProgressState(
      upstreamAgent,
      workflowAgents,
      states,
      feedbackEdgeKeys,
      nextVisitingAgentIds
    )
  }));

  if (upstreamStates.some(({ progress }) => progress === "pending")) {
    return "pending";
  }

  return upstreamStates.some(({ agent: upstreamAgent, progress }) =>
    progress === "completed" &&
    (states[upstreamAgent.id]?.responses ?? []).some((response) =>
      responseRoutesToAgent(response, agent.id)
    )
  )
    ? "pending"
    : "skipped";
}

export function getTriggerUpstreamAgents(
  upstreamAgents: AgentDefinition[],
  targetAgentId: string,
  states: AgentResultStates,
  feedbackEdgeKeys: ReadonlySet<string>
): AgentDefinition[] {
  const feedbackUpstreamAgents = upstreamAgents.filter((agent) =>
    feedbackEdgeKeys.has(getWorkflowEdgeKey(agent.id, targetAgentId))
  );
  const hasCompletedFeedback = feedbackUpstreamAgents.some((agent) =>
    (states[agent.id]?.responses.length ?? 0) > 0
  );

  return hasCompletedFeedback
    ? feedbackUpstreamAgents
    : upstreamAgents.filter((agent) =>
      !feedbackEdgeKeys.has(getWorkflowEdgeKey(agent.id, targetAgentId))
    );
}

export function getApplicableUpstreamAgents(
  upstreamAgents: AgentDefinition[],
  targetAgentId: string,
  states: AgentResultStates
): AgentDefinition[] {
  return upstreamAgents.filter((agent) =>
    (states[agent.id]?.responses ?? []).some((response) =>
      responseRoutesToAgent(response, targetAgentId)
    )
  );
}

export function getUpstreamAgentResult(
  agent: AgentDefinition,
  targetAgentId: string,
  states: AgentResultStates
): UpstreamAgentResult | null {
  const state = states[agent.id];
  const responses = state?.responses ?? [];
  const routedResponses = responses.filter((response) =>
    responseRoutesToAgent(response, targetAgentId)
  );

  if (
    routedResponses.length === 0 ||
    routedResponses.some((response) => response.items.length === 0)
  ) {
    return null;
  }

  let itemOffset = 0;

  for (const response of responses) {
    if (
      responseRoutesToAgent(response, targetAgentId) &&
      response.items.length > 1
    ) {
      const selectedIndexes = state.selectedItemIndexes.filter(
        (itemIndex) =>
          itemIndex >= itemOffset &&
          itemIndex < itemOffset + response.items.length
      );

      if (
        selectedIndexes.length === 0 ||
        (
          response.isMultiSelectionAllowed !== true &&
          selectedIndexes.length !== 1
        )
      ) {
        return null;
      }
    }

    itemOffset += response.items.length;
  }

  if (routedResponses.every((response) => response.items.length === 1)) {
    return { agentId: agent.id, selectedItemIndexes: [] };
  }

  return {
    agentId: agent.id,
    selectedItemIndexes: [...state.selectedItemIndexes]
  };
}

export function responseRoutesToAgent(
  response: AgentResponsePayload,
  targetAgentId: string
): boolean {
  return response.nextAgentIds === null ||
    response.nextAgentIds.includes(targetAgentId);
}

export function getPlannedThreadCount(
  agent: AgentDefinition,
  upstreamAgents: AgentDefinition[],
  states: AgentResultStates
): number {
  if (upstreamAgents.length === 0 || agent.inputMode === "aggregate") {
    return 1;
  }

  let plannedThreadCount = 1;

  for (const upstreamAgent of upstreamAgents) {
    const state = states[upstreamAgent.id];

    if (
      !state ||
      !getUpstreamAgentResult(upstreamAgent, agent.id, states)
    ) {
      return 1;
    }

    let itemIndexOffset = 0;
    let upstreamThreadCount = 0;

    for (const response of state.responses) {
      if (!responseRoutesToAgent(response, agent.id)) {
        itemIndexOffset += response.items.length;
        continue;
      }

      const selectedItemCount = response.items.length === 1
        ? 1
        : state.selectedItemIndexes.filter((itemIndex) =>
          itemIndex >= itemIndexOffset &&
          itemIndex < itemIndexOffset + response.items.length
        ).length;

      upstreamThreadCount +=
        response.isMultiSelectionThreaded === true && selectedItemCount > 1
          ? selectedItemCount
          : 1;
      itemIndexOffset += response.items.length;
    }

    plannedThreadCount *= Math.max(1, upstreamThreadCount);
  }

  return plannedThreadCount;
}

export function getWorkflowLevels(
  agents: AgentDefinition[],
  feedbackEdgeKeys: ReadonlySet<string>
): AgentDefinition[][] {
  const workflowAgents = [...agents];
  const agentsById = new Map(workflowAgents.map((agent) => [agent.id, agent]));
  const levelsByAgentId = new Map(
    workflowAgents.map((agent) => [agent.id, 0])
  );

  for (const agent of workflowAgents) {
    const sourceLevel = levelsByAgentId.get(agent.id) ?? 0;

    for (const nextAgentId of agent.nextAgentIds) {
      if (
        !agentsById.has(nextAgentId) ||
        feedbackEdgeKeys.has(getWorkflowEdgeKey(agent.id, nextAgentId))
      ) {
        continue;
      }

      levelsByAgentId.set(
        nextAgentId,
        Math.max(levelsByAgentId.get(nextAgentId) ?? 0, sourceLevel + 1)
      );
    }
  }

  const levels: AgentDefinition[][] = [];

  for (const agent of workflowAgents) {
    const level = levelsByAgentId.get(agent.id) ?? 0;
    levels[level] ??= [];
    levels[level].push(agent);
  }

  return levels;
}

