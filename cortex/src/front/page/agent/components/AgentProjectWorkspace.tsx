import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent
} from "react";
import { ArrowDown, Bot, ChevronDown, FastForward, GitBranch, LoaderCircle, Pause, Pencil, RotateCcw, Send } from "lucide-react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  loadAgentProject,
  runAgent,
  type AgentConversationMessage,
  type AgentConversationThread,
  type AgentDefinition,
  type AgentProject,
  type UpstreamAgentResult
} from "../../../services/agentApi.ts";
import type { Project } from "../../../services/projectApi.ts";
import {
  parseAgentResponse,
  type AgentResponsePayload
} from "../../../../shared/AgentResponse.ts";
import {
  getCyclicAgentIds,
  getWorkflowEdgeKey,
  getWorkflowFeedbackEdgeKeys
} from "../../../../shared/AgentWorkflowGraph.ts";
import { useTranslation, type Translate } from "../../../i18n.tsx";

interface AgentProjectWorkspaceProps {
  project: Project | null;
  content: AgentProject | null;
  onEdit: () => void;
  onContentRefresh: (content: AgentProject) => void;
  onRunStateChange: (
    projectId: string,
    status: "idle" | "running" | "completed"
  ) => void;
}

type HandoffEnabledAgentIdsByProject = Record<string, Set<string>>;
type AgentFlowKind = "standard" | "cycle" | "parallel";

const HANDOFF_PREFERENCES_STORAGE_KEY =
  "cortex.agent-workflow.handoff-preferences.v1";
const EMPTY_AGENT_ID_SET = new Set<string>();

function loadHandoffPreferences(): HandoffEnabledAgentIdsByProject {
  try {
    const storedPreferences = window.localStorage.getItem(
      HANDOFF_PREFERENCES_STORAGE_KEY
    );

    if (!storedPreferences) {
      return {};
    }

    const parsedPreferences = JSON.parse(storedPreferences) as unknown;

    if (
      typeof parsedPreferences !== "object" ||
      parsedPreferences === null ||
      Array.isArray(parsedPreferences)
    ) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsedPreferences)
        .filter(([, agentIds]) =>
          Array.isArray(agentIds) &&
          agentIds.every((agentId) => typeof agentId === "string")
        )
        .map(([projectId, agentIds]) => [
          projectId,
          new Set(agentIds as string[])
        ])
    );
  } catch {
    return {};
  }
}

function saveHandoffPreferences(
  preferences: HandoffEnabledAgentIdsByProject
): void {
  try {
    window.localStorage.setItem(
      HANDOFF_PREFERENCES_STORAGE_KEY,
      JSON.stringify(Object.fromEntries(
        Object.entries(preferences).map(([projectId, agentIds]) => [
          projectId,
          [...agentIds]
        ])
      ))
    );
  } catch {
    // The workflow remains usable when browser storage is unavailable.
  }
}

function getProjectName(directoryPath: string): string {
  const pathParts = directoryPath.split(/[\\/]/).filter(Boolean);
  return pathParts.at(-1) || directoryPath;
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error
    ? error.message
    : fallback;
}

function MarkdownContent({ content }: { content: string }) {
  return (
    <div className="agent-card__markdown">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ node: _node, ...properties }) => (
            <a
              {...properties}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(event) => event.stopPropagation()}
            />
          )
        }}
      >
        {content}
      </Markdown>
    </div>
  );
}

function ConversationMessageContent({
  message,
  nextAgentNamesById,
  itemIndexOffset = 0,
  selectedItemIndexes = [],
  onSelectedItemIndexesChange,
  disabled = false
}: {
  message: AgentConversationMessage;
  nextAgentNamesById: ReadonlyMap<string, string>;
  itemIndexOffset?: number;
  selectedItemIndexes?: number[];
  onSelectedItemIndexesChange?: (indexes: number[]) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  if (message.role === "user") {
    return <pre>{message.content}</pre>;
  }

  const response = parseAgentResponse(message.content);

  if (!response) {
    return <MarkdownContent content={message.content} />;
  }

  const allowsMultipleSelection = response.isMultiSelectionAllowed === true;
  const responseItemCount = response.items.length;

  function handleItemSelection(localItemIndex: number): void {
    if (disabled || !onSelectedItemIndexesChange) {
      return;
    }

    const itemIndex = itemIndexOffset + localItemIndex;
    const isAlreadySelected = selectedItemIndexes.includes(itemIndex);
    const nextIndexes = allowsMultipleSelection
      ? isAlreadySelected
        ? selectedItemIndexes.filter((index) => index !== itemIndex)
        : [...selectedItemIndexes, itemIndex]
      : isAlreadySelected
        ? selectedItemIndexes.filter((index) => index !== itemIndex)
        : [
          ...selectedItemIndexes.filter((index) =>
            index < itemIndexOffset ||
            index >= itemIndexOffset + responseItemCount
          ),
          itemIndex
        ];

    onSelectedItemIndexesChange(nextIndexes);
  }

  return (
    <div className="agent-card__conversation-response-content">
      {response.items.length === 1 ? (
        <div className="agent-card__conversation-response">
          <MarkdownContent content={response.items[0].content} />
        </div>
      ) : response.items.length > 1 ? (
        <ul
          className="agent-card__conversation-response-list"
          aria-label={t("agent.responsesAria")}
        >
          {response.items.map((item, itemIndex) => {
            const isSelected = selectedItemIndexes.includes(
              itemIndexOffset + itemIndex
            );

            return (
              <li key={itemIndex}>
                <button
                  className={`agent-card__conversation-response-button${
                    isSelected
                      ? " agent-card__conversation-response-button--selected"
                      : ""
                  }`}
                  type="button"
                  aria-pressed={isSelected}
                  aria-disabled={disabled || !onSelectedItemIndexesChange}
                  onClick={() => handleItemSelection(itemIndex)}
                >
                  <MarkdownContent content={item.content} />
                </button>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="agent-card__conversation-response">
          {t("agent.noResponse")}
        </p>
      )}
      {response.notes && (
        <div className="agent-card__conversation-response-notes">
          <MarkdownContent content={response.notes} />
        </div>
      )}
      {response.nextAgentIds !== null && (
        <div className="agent-card__conversation-routing">
          <span>{t("agent.selectedBranch")}</span>
          {response.nextAgentIds.length > 0 ? (
            <ul>
              {response.nextAgentIds.map((agentId) => (
                <li key={agentId}>
                  {nextAgentNamesById.get(agentId) ?? agentId}
                </li>
              ))}
            </ul>
          ) : (
            <strong>{t("agent.workflowEnd")}</strong>
          )}
        </div>
      )}
    </div>
  );
}

interface AgentResultState {
  responses: AgentResponsePayload[];
  selectedItemIndexes: number[];
  isInvalidated: boolean;
}

type AgentResultStates = Record<string, AgentResultState>;

function getAutomaticHandoffSelections(
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

function haveSameIndexes(first: number[], second: number[]): boolean {
  return first.length === second.length &&
    first.every((itemIndex, index) => itemIndex === second[index]);
}

function findLastAgentResponses(
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

function getAgentConversationThreads(
  agent: AgentDefinition
): AgentConversationThread[] {
  if (agent.threads?.length > 0) {
    return agent.threads;
  }

  return agent.conversation.length > 0
    ? [{ id: "thread-1", conversation: agent.conversation }]
    : [];
}

function getPrerequisiteMessage(
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

function getAgentProgressState(
  agent: AgentDefinition,
  workflowAgents: AgentDefinition[],
  states: AgentResultStates,
  feedbackEdgeKeys: ReadonlySet<string>,
  visitingAgentIds = new Set<string>()
): "completed" | "pending" | "skipped" {
  if (agent.executionStatus === "running") {
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

function getTriggerUpstreamAgents(
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

function getApplicableUpstreamAgents(
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

function getUpstreamAgentResult(
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

function responseRoutesToAgent(
  response: AgentResponsePayload,
  targetAgentId: string
): boolean {
  return response.nextAgentIds === null ||
    response.nextAgentIds.includes(targetAgentId);
}

function getPlannedThreadCount(
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

function getWorkflowLevels(
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

interface WorkflowFeedbackLoopEdge {
  sourceAgentId: string;
  targetAgentId: string;
}

interface WorkflowFeedbackLoopPlacement {
  key: string;
  sourceLevelIndex: number;
  targetLevelIndex: number;
}

interface AgentCardProps {
  agent: AgentDefinition;
  nextAgentNamesById: ReadonlyMap<string, string>;
  handoffEnabled: boolean;
  shouldAutoRun: boolean;
  plannedThreadCount: number;
  upstreamAgentResults?: UpstreamAgentResult[];
  isInvalidated: boolean;
  isFrozen: boolean;
  prerequisiteMessage: string | null;
  projectId: string;
  selectedItemIndexes: number[];
  onResponseChange: (
    agentId: string,
    responses: AgentResponsePayload[]
  ) => void;
  onSelectedItemIndexesChange: (
    agentId: string,
    selectedItemIndexes: number[]
  ) => void;
  onRunStart: (agentId: string) => void;
  onRunEnd: (succeeded: boolean) => void;
  onHandoffEnabledChange: (agentId: string, enabled: boolean) => void;
}

interface HandoffToggleProps {
  checked: boolean;
  description: string;
  variant?: "agent" | "global";
  onChange: (checked: boolean) => void;
}

function HandoffToggle({
  checked,
  description,
  variant = "agent",
  onChange
}: HandoffToggleProps) {
  const { t } = useTranslation();
  const stateLabel = checked ? t("handoff.automatic") : t("handoff.manual");

  return (
    <button
      className={`handoff-toggle handoff-toggle--${variant}${
        checked ? " handoff-toggle--active" : ""
      }`}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={`${stateLabel}. ${description}`}
      title={t("handoff.current", { state: stateLabel, description })}
      onClick={() => onChange(!checked)}
    >
      <span className="handoff-toggle__label">
        {checked ? (
          <FastForward
            aria-hidden="true"
            size={variant === "global" ? 16 : 14}
            strokeWidth={2}
          />
        ) : (
          <Pause
            aria-hidden="true"
            size={variant === "global" ? 16 : 14}
            strokeWidth={2}
          />
        )}
        {stateLabel}
      </span>
    </button>
  );
}

interface AgentThreadPresentation {
  thread: AgentConversationThread;
  lastAgentMessageIndex: number;
  itemIndexOffset: number;
}

interface AgentThreadConversationProps {
  agentName: string;
  disabled: boolean;
  nextAgentNamesById: ReadonlyMap<string, string>;
  presentation: AgentThreadPresentation;
  selectedItemIndexes: number[];
  onSelectedItemIndexesChange: (indexes: number[]) => void;
}

function AgentThreadConversation({
  agentName,
  disabled,
  nextAgentNamesById,
  presentation,
  selectedItemIndexes,
  onSelectedItemIndexesChange
}: AgentThreadConversationProps) {
  const { t } = useTranslation();
  const conversationRef = useRef<HTMLDivElement>(null);
  const { thread, lastAgentMessageIndex, itemIndexOffset } = presentation;

  useEffect(() => {
    const conversationElement = conversationRef.current;

    if (conversationElement) {
      conversationElement.scrollTo({
        top: conversationElement.scrollHeight,
        behavior: "smooth"
      });
    }
  }, [thread.conversation]);

  return (
    <section
      className="agent-card__conversation"
      aria-label={t("agent.conversationAria", { name: agentName })}
    >
      <span className="agent-card__conversation-title">{t("agent.conversation")}</span>
      <div
        className="agent-card__conversation-messages"
        ref={conversationRef}
        role="log"
        aria-live="polite"
        aria-relevant="additions"
      >
        {thread.conversation.map((message, messageIndex) => (
          <article
            className={`agent-card__conversation-message agent-card__conversation-message--${message.role}`}
            key={messageIndex}
          >
            <span>{message.role === "user" ? t("agent.you") : "Agent"}</span>
            <ConversationMessageContent
              message={message}
              disabled={disabled}
              nextAgentNamesById={nextAgentNamesById}
              itemIndexOffset={itemIndexOffset}
              selectedItemIndexes={
                messageIndex === lastAgentMessageIndex
                  ? selectedItemIndexes
                  : []
              }
              onSelectedItemIndexesChange={
                messageIndex === lastAgentMessageIndex
                  ? onSelectedItemIndexesChange
                  : undefined
              }
            />
          </article>
        ))}
      </div>
    </section>
  );
}

interface AgentInstanceCardProps extends AgentThreadConversationProps {
  hideAdditionalInstructions: boolean;
  index: number;
  isFrozen: boolean;
  isRunning: boolean;
  onRun: (additionalInstructions: string, threadId: string) => Promise<boolean>;
}

function AgentInstanceCard({
  agentName,
  disabled,
  hideAdditionalInstructions,
  index,
  isFrozen,
  isRunning,
  onRun,
  ...conversationProps
}: AgentInstanceCardProps) {
  const { t } = useTranslation();
  const additionalInstructionsId = useId();
  const threadId = conversationProps.presentation.thread.id;
  const [additionalInstructions, setAdditionalInstructions] = useState("");

  useEffect(() => {
    if (hideAdditionalInstructions) {
      setAdditionalInstructions("");
    }
  }, [hideAdditionalInstructions]);

  async function handleRun(): Promise<void> {
    const succeeded = await onRun(
      hideAdditionalInstructions ? "" : additionalInstructions.trim(),
      threadId
    );

    if (succeeded) {
      setAdditionalInstructions("");
    }
  }

  return (
    <article className="agent-instance-card">
      <header className="agent-instance-card__header">
        <span className="agent-instance-card__index">
          {t("agent.instance", { number: String(index + 1).padStart(2, "0") })}
        </span>
        <span className="agent-instance-card__status">
          <span aria-hidden="true" /> {t("agent.activeSession")}
        </span>
      </header>
      <AgentThreadConversation
        agentName={t("agent.instanceName", { name: agentName, number: index + 1 })}
        disabled={disabled}
        {...conversationProps}
      />
      {!hideAdditionalInstructions && (
        <div className="agent-card__additional-instructions">
          <label htmlFor={additionalInstructionsId}>{t("agent.details")}</label>
          <textarea
            id={additionalInstructionsId}
            value={additionalInstructions}
            onChange={(event) => setAdditionalInstructions(event.target.value)}
            placeholder={t("agent.instancePlaceholder")}
            rows={4}
            disabled={isRunning || disabled}
          />
        </div>
      )}
      <div className="agent-card__actions">
        <button
          className="agent-card__run-button"
          type="button"
          aria-busy={isRunning}
          onClick={() => void handleRun()}
          disabled={isRunning || disabled}
          title={isFrozen
            ? t("agent.frozenInstance")
            : t("agent.rerunInstanceTitle", { number: index + 1 })
          }
        >
          {isRunning ? (
            <LoaderCircle
              aria-hidden="true"
              className="agent-card__run-icon--running"
              size={15}
              strokeWidth={1.8}
            />
          ) : (
            <RotateCcw aria-hidden="true" size={15} strokeWidth={1.8} />
          )}
          {isRunning ? t("agent.running") : t("agent.rerunInstance")}
        </button>
      </div>
    </article>
  );
}

function AgentCard({
  agent,
  nextAgentNamesById,
  handoffEnabled,
  shouldAutoRun,
  plannedThreadCount,
  upstreamAgentResults,
  isInvalidated,
  isFrozen,
  prerequisiteMessage,
  projectId,
  selectedItemIndexes,
  onResponseChange,
  onSelectedItemIndexesChange,
  onRunStart,
  onRunEnd,
  onHandoffEnabledChange
}: AgentCardProps) {
  const { t } = useTranslation();
  const additionalInstructionsId = useId();
  const autoRunAttemptedRef = useRef(false);
  const [runningThreadId, setRunningThreadId] = useState<string | null>(null);
  const [hasSession, setHasSession] = useState(agent.hasSession);
  const [threads, setThreads] = useState<AgentConversationThread[]>(
    getAgentConversationThreads(agent)
  );
  const [error, setError] = useState(agent.executionError ?? "");
  const [additionalInstructions, setAdditionalInstructions] = useState("");
  const isRunning = runningThreadId !== null || agent.executionStatus === "running";
  const canRun = Boolean(agent.prompt.trim()) && !prerequisiteMessage;
  const isUnavailable = !canRun;
  const isDisabled = isUnavailable || isFrozen;
  const shouldShowRunButton =
    !handoffEnabled || isRunning || (canRun && !isFrozen);

  useEffect(() => {
    setHasSession(agent.hasSession);
    setThreads(getAgentConversationThreads(agent));
    setError(agent.executionError ?? "");
  }, [agent.conversation, agent.executionError, agent.hasSession, agent.threads]);

  useEffect(() => {
    setAdditionalInstructions("");
  }, [agent.id]);

  useEffect(() => {
    if (handoffEnabled) {
      setAdditionalInstructions("");
    }
  }, [handoffEnabled]);

  useEffect(() => {
    if (isInvalidated) {
      setHasSession(false);
      setThreads([]);
      setAdditionalInstructions("");
      setError("");
    }
  }, [isInvalidated]);

  async function handleRun(
    submittedInstructions: string,
    threadId?: string
  ): Promise<boolean> {
    if (isRunning || !canRun || isFrozen) {
      return false;
    }

    setRunningThreadId(threadId ?? "all");
    onRunStart(agent.id);
    setError("");

    try {
      const result = await runAgent(
        projectId,
        agent.id,
        submittedInstructions,
        upstreamAgentResults,
        threadId
      );
      setThreads(result.threads);
      setHasSession(result.hasSession);
      if (!threadId) {
        setAdditionalInstructions("");
      }
      onResponseChange(
        agent.id,
        findLastAgentResponses(result.threads)
      );
      onRunEnd(true);
      return true;
    } catch (requestError) {
      setError(getErrorMessage(requestError, t("common.unexpectedError")));
      onRunEnd(false);
      return false;
    } finally {
      setRunningThreadId(null);
    }
  }

  useEffect(() => {
    if (!shouldAutoRun) {
      autoRunAttemptedRef.current = false;
      return;
    }

    if (
      autoRunAttemptedRef.current ||
      isRunning ||
      !canRun ||
      isFrozen
    ) {
      return;
    }

    autoRunAttemptedRef.current = true;
    void handleRun("");
  }, [shouldAutoRun, isRunning, canRun, isFrozen]);

  let itemIndexOffset = 0;
  const threadPresentation = threads.map((thread) => {
    let lastAgentMessageIndex = -1;

    for (let index = thread.conversation.length - 1; index >= 0; index -= 1) {
      if (thread.conversation[index].role === "agent") {
        lastAgentMessageIndex = index;
        break;
      }
    }

    const response = lastAgentMessageIndex < 0
      ? null
      : parseAgentResponse(
        thread.conversation[lastAgentMessageIndex].content
      );
    const presentation = {
      thread,
      lastAgentMessageIndex,
      itemIndexOffset
    };
    itemIndexOffset += response?.items.length ?? 0;
    return presentation;
  });
  const isMultithreaded = threadPresentation.length > 1;
  const isParallelRunPrepared =
    !hasSession && !isMultithreaded && canRun && plannedThreadCount > 1;

  return (
    <article
      className={`agent-card${
        isMultithreaded ? " agent-card--multithreaded" : ""
      }${isParallelRunPrepared ? " agent-card--parallel-ready" : ""
      }${isDisabled ? " agent-card--disabled" : ""
      }${handoffEnabled ? " agent-card--handoff" : ""}`}
      aria-disabled={isDisabled || undefined}
      aria-label={isParallelRunPrepared
        ? t("agent.parallelAria", { name: agent.name, count: plannedThreadCount })
        : undefined
      }
    >
      <header className="agent-card__header">
        <Bot aria-hidden="true" size={22} strokeWidth={1.7} />
        <div className="agent-card__identity">
          <h2>{agent.name}</h2>
        </div>
        <div className="agent-card__header-actions">
          <HandoffToggle
            checked={handoffEnabled}
            description={handoffEnabled
              ? t("agent.manual", { name: agent.name })
              : t("agent.auto", { name: agent.name })
            }
            onChange={(enabled) => onHandoffEnabledChange(agent.id, enabled)}
          />
          {(agent.model || agent.reasoningEffort) && (
            <dl className="agent-card__model">
              {agent.model && (
                <div>
                  <dt>{t("agent.model")}</dt>
                  <dd>{agent.model}</dd>
                </div>
              )}
              {agent.reasoningEffort && (
                <div>
                  <dt>{t("agent.reasoning")}</dt>
                  <dd>{agent.reasoningEffort}</dd>
                </div>
              )}
            </dl>
          )}
        </div>
      </header>
      <details className="agent-card__prompt">
        <summary>
          <span className="agent-card__prompt-description">
            {agent.description || t("agent.noDescription")}
          </span>
          <ChevronDown aria-hidden="true" size={15} strokeWidth={1.7} />
        </summary>
        <pre>{agent.prompt || t("agent.noInstruction")}</pre>
      </details>
      <div className="agent-card__run-feedback" aria-live="polite">
        {prerequisiteMessage && (
          <p className="agent-card__run-prerequisite">
            {prerequisiteMessage}
          </p>
        )}
        {error && (
          <p className="agent-card__run-error" role="alert">{error}</p>
        )}
      </div>
      {isMultithreaded ? (
        <section
          className="agent-instances-zone"
          aria-label={t("agent.instancesAria", { name: agent.name })}
        >
          <header className="agent-instances-zone__header">
            <div>
              <GitBranch aria-hidden="true" size={18} strokeWidth={1.7} />
              <span>
                {t("agent.evolutionZone", { count: threadPresentation.length })}
              </span>
            </div>
            <p>{t("agent.branchesHelp")}</p>
          </header>
          <div className="agent-instances-zone__track">
            {threadPresentation.map((presentation, index) => (
              <AgentInstanceCard
                agentName={agent.name}
                disabled={isDisabled || isRunning}
                nextAgentNamesById={nextAgentNamesById}
                hideAdditionalInstructions={handoffEnabled}
                index={index}
                isFrozen={isFrozen}
                isRunning={isRunning && (
                  runningThreadId === null ||
                  runningThreadId === presentation.thread.id
                )}
                key={presentation.thread.id}
                onRun={handleRun}
                onSelectedItemIndexesChange={(indexes) =>
                  onSelectedItemIndexesChange(agent.id, indexes)
                }
                presentation={presentation}
                selectedItemIndexes={selectedItemIndexes}
              />
            ))}
          </div>
        </section>
      ) : (
        <>
          {threadPresentation[0] && (
            <AgentThreadConversation
              agentName={agent.name}
              disabled={isDisabled}
              nextAgentNamesById={nextAgentNamesById}
              presentation={threadPresentation[0]}
              selectedItemIndexes={selectedItemIndexes}
              onSelectedItemIndexesChange={(indexes) =>
                onSelectedItemIndexesChange(agent.id, indexes)
              }
            />
          )}
          {!handoffEnabled && (
            <div className="agent-card__additional-instructions">
              <label htmlFor={additionalInstructionsId}>{t("agent.details")}</label>
              <textarea
                id={additionalInstructionsId}
                value={additionalInstructions}
                onChange={(event) => setAdditionalInstructions(event.target.value)}
                placeholder={hasSession
                  ? t("agent.rerunPlaceholder")
                  : t("agent.runPlaceholder")
                }
                rows={4}
                disabled={isRunning || isDisabled}
              />
            </div>
          )}
          {shouldShowRunButton && (
            <div className="agent-card__actions">
              <button
                className="agent-card__run-button"
                type="button"
                aria-busy={isRunning}
                onClick={() => void handleRun(
                  handoffEnabled ? "" : additionalInstructions.trim()
                )}
                disabled={isRunning || !canRun || isFrozen}
                title={isFrozen
                  ? t("agent.frozen")
                  : prerequisiteMessage || (canRun
                    ? t(hasSession ? "agent.rerunTitle" : "agent.runTitle", { name: agent.name })
                    : t("agent.emptyInstruction")
                  )
                }
              >
                {isRunning ? (
                  <LoaderCircle
                    aria-hidden="true"
                    className="agent-card__run-icon--running"
                    size={15}
                    strokeWidth={1.8}
                  />
                ) : isParallelRunPrepared ? (
                  <GitBranch aria-hidden="true" size={16} strokeWidth={1.8} />
                ) : hasSession ? (
                  <RotateCcw aria-hidden="true" size={15} strokeWidth={1.8} />
                ) : (
                  <Send aria-hidden="true" size={15} strokeWidth={1.8} />
                )}
                {isRunning
                  ? t("agent.running")
                  : hasSession ? t("agent.rerun") : t("agent.run")
                }
              </button>
            </div>
          )}
        </>
      )}
    </article>
  );
}

export function AgentProjectWorkspace({
  project,
  content,
  onEdit,
  onContentRefresh,
  onRunStateChange
}: AgentProjectWorkspaceProps) {
  const { t } = useTranslation();
  const tabsId = useId();
  const instructionsTabRef = useRef<HTMLButtonElement>(null);
  const agentsTabRef = useRef<HTMLButtonElement>(null);
  const [activeTab, setActiveTab] = useState<"instructions" | "agents">(
    "agents"
  );
  const [agentResultStates, setAgentResultStates] = useState<AgentResultStates>(
    {}
  );
  const selectedItemIndexesByProject = useRef<
    Record<string, Record<string, number[]>>
  >({});
  const runningAgentIdsByProject = useRef<Record<string, Set<string>>>({});
  const [launchedAgentIds, setLaunchedAgentIds] = useState<Set<string>>(
    () => new Set()
  );
  const [handoffEnabledAgentIdsByProject, setHandoffEnabledAgentIdsByProject] =
    useState<HandoffEnabledAgentIdsByProject>(loadHandoffPreferences);
  const handoffEnabledAgentIds = content
    ? handoffEnabledAgentIdsByProject[content.projectId] ?? EMPTY_AGENT_ID_SET
    : EMPTY_AGENT_ID_SET;

  useEffect(() => {
    saveHandoffPreferences(handoffEnabledAgentIdsByProject);
  }, [handoffEnabledAgentIdsByProject]);

  useEffect(() => {
    setActiveTab("agents");
  }, [content?.projectId]);

  useEffect(() => {
    if (!content) {
      return;
    }

    const availableAgentIds = new Set(content.agents.map((agent) => agent.id));

    setHandoffEnabledAgentIdsByProject((currentPreferences) => {
      const storedAgentIds = currentPreferences[content.projectId];

      if (!storedAgentIds) {
        return currentPreferences;
      }

      const validAgentIds = new Set(
        [...storedAgentIds].filter((agentId) => availableAgentIds.has(agentId))
      );

      if (
        validAgentIds.size === storedAgentIds.size &&
        [...validAgentIds].every((agentId) => storedAgentIds.has(agentId))
      ) {
        return currentPreferences;
      }

      return {
        ...currentPreferences,
        [content.projectId]: validAgentIds
      };
    });
  }, [content?.agents, content?.projectId]);

  useEffect(() => {
    if (!content) {
      setAgentResultStates({});
      setLaunchedAgentIds(new Set());
      return;
    }

    const restoredStates: AgentResultStates = {};
    const storedSelections = selectedItemIndexesByProject.current[
      content.projectId
    ] ?? {};

    for (const agent of content.agents) {
      const responses = findLastAgentResponses(
        getAgentConversationThreads(agent)
      );

      restoredStates[agent.id] = {
        responses,
        selectedItemIndexes: responses.length > 0
          ? [...(storedSelections[agent.id] ?? [])]
          : [],
        isInvalidated: false
      };
    }

    setAgentResultStates(restoredStates);
    runningAgentIdsByProject.current[content.projectId] = new Set(
      content.agents
        .filter((agent) => agent.executionStatus === "running")
        .map((agent) => agent.id)
    );
    setLaunchedAgentIds(new Set(
      content.agents
        .filter((agent) =>
          agent.hasSession || agent.executionStatus === "running"
        )
        .map((agent) => agent.id)
    ));
  }, [content]);

  useEffect(() => {
    if (!content?.agents.some(
      (agent) => agent.executionStatus === "running"
    )) {
      return;
    }

    let isActive = true;
    let isRefreshing = false;

    const refreshProject = async (): Promise<void> => {
      if (isRefreshing) {
        return;
      }

      isRefreshing = true;

      try {
        const refreshedContent = await loadAgentProject(content.projectId);

        if (isActive) {
          onContentRefresh(refreshedContent);
        }
      } catch {
        // The run request already displays execution errors.
      } finally {
        isRefreshing = false;
      }
    };
    const refreshTimer = window.setInterval(() => {
      void refreshProject();
    }, 1_000);

    return () => {
      isActive = false;
      window.clearInterval(refreshTimer);
    };
  }, [content, onContentRefresh]);

  useEffect(() => {
    if (!content) {
      return;
    }

    const upstreamAgentIds = new Set<string>();

    for (const agent of content.agents) {
      if (!handoffEnabledAgentIds.has(agent.id)) {
        continue;
      }

      for (const upstreamAgent of content.agents) {
        if (upstreamAgent.nextAgentIds.includes(agent.id)) {
          upstreamAgentIds.add(upstreamAgent.id);
        }
      }
    }

    let nextStates = agentResultStates;
    const storedSelections = {
      ...(selectedItemIndexesByProject.current[content.projectId] ?? {})
    };

    for (const upstreamAgentId of upstreamAgentIds) {
      const state = agentResultStates[upstreamAgentId];

      if (!state || state.responses.length === 0) {
        continue;
      }

      const automaticSelections = getAutomaticHandoffSelections(state);

      if (haveSameIndexes(state.selectedItemIndexes, automaticSelections)) {
        continue;
      }

      if (nextStates === agentResultStates) {
        nextStates = { ...agentResultStates };
      }

      nextStates[upstreamAgentId] = {
        ...state,
        selectedItemIndexes: automaticSelections
      };
      storedSelections[upstreamAgentId] = automaticSelections;
    }

    if (nextStates !== agentResultStates) {
      selectedItemIndexesByProject.current[content.projectId] = storedSelections;
      setAgentResultStates(nextStates);
    }
  }, [content, handoffEnabledAgentIds, agentResultStates]);

  if (!project || !content) {
    return (
      <section className="workspace-content">
        <p className="eyebrow">Cortex workspace</p>
        <h1>Cortex.</h1>
        <p className="intro">
          {t("workspace.welcome")}
        </p>
      </section>
    );
  }

  const projectId = content.projectId;
  const projectName = getProjectName(project.directoryPath);
  const agentsTabLabel = t("workspace.workflowTab", {
    count: content.agents.length,
    agents: t(content.agents.length === 1
      ? "workspace.agentSingular"
      : "workspace.agentPlural")
  });
  const instructionsTabId = `${tabsId}-instructions-tab`;
  const instructionsPanelId = `${tabsId}-instructions-panel`;
  const agentsTabId = `${tabsId}-agents-tab`;
  const agentsPanelId = `${tabsId}-agents-panel`;
  const workflowAgents = [...content.agents];
  const agentsById = new Map(workflowAgents.map((agent) => [agent.id, agent]));
  const workflowFeedbackEdgeKeys = getWorkflowFeedbackEdgeKeys(workflowAgents);
  const workflowFeedbackEdges = workflowAgents.flatMap((agent) =>
    agent.nextAgentIds
      .filter((nextAgentId) => workflowFeedbackEdgeKeys.has(
        getWorkflowEdgeKey(agent.id, nextAgentId)
      ))
      .map((nextAgentId) => ({
        sourceAgentId: agent.id,
        targetAgentId: nextAgentId
      }))
  );
  const cyclicAgentIds = getCyclicAgentIds(workflowAgents);
  const workflowLevels = getWorkflowLevels(
    workflowAgents,
    workflowFeedbackEdgeKeys
  );
  const workflowLevelIndexesByAgentId = new Map(
    workflowLevels.flatMap((levelAgents, levelIndex) =>
      levelAgents.map((agent) => [agent.id, levelIndex] as const)
    )
  );
  const workflowFeedbackLoopPlacements = workflowFeedbackEdges.flatMap(
    ({ sourceAgentId, targetAgentId }) => {
      const sourceLevelIndex = workflowLevelIndexesByAgentId.get(sourceAgentId);
      const targetLevelIndex = workflowLevelIndexesByAgentId.get(targetAgentId);

      if (
        sourceLevelIndex === undefined ||
        targetLevelIndex === undefined ||
        sourceLevelIndex <= targetLevelIndex
      ) {
        return [];
      }

      return [{
        key: getWorkflowEdgeKey(sourceAgentId, targetAgentId),
        sourceLevelIndex,
        targetLevelIndex
      } satisfies WorkflowFeedbackLoopPlacement];
    }
  );
  const firstCycleSplitLevelIndex = workflowLevels.findIndex((levelAgents) =>
    levelAgents.some((agent) => cyclicAgentIds.has(agent.id)) &&
    levelAgents.some((agent) => !cyclicAgentIds.has(agent.id))
  );
  const isGlobalHandoffEnabled = workflowAgents.some(
    (agent) => handoffEnabledAgentIds.has(agent.id)
  );

  function handleTabKeyDown(
    event: KeyboardEvent<HTMLButtonElement>
  ): void {
    let nextTab: "instructions" | "agents" | null = null;

    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      nextTab = activeTab === "instructions" ? "agents" : "instructions";
    } else if (event.key === "Home") {
      nextTab = "instructions";
    } else if (event.key === "End") {
      nextTab = "agents";
    }

    if (!nextTab) {
      return;
    }

    event.preventDefault();
    setActiveTab(nextTab);
    (nextTab === "instructions"
      ? instructionsTabRef
      : agentsTabRef
    ).current?.focus();
  }

  function handleGlobalHandoffChange(enabled: boolean): void {
    const nextAgentIds = enabled
      ? new Set(workflowAgents.map((agent) => agent.id))
      : new Set<string>();

    setHandoffEnabledAgentIdsByProject((currentPreferences) => ({
      ...currentPreferences,
      [projectId]: nextAgentIds
    }));
  }

  function handleAgentHandoffChange(agentId: string, enabled: boolean): void {
    setHandoffEnabledAgentIdsByProject((currentPreferences) => {
      const nextAgentIds = new Set(
        currentPreferences[projectId] ?? EMPTY_AGENT_ID_SET
      );

      if (enabled) {
        nextAgentIds.add(agentId);
      } else {
        nextAgentIds.delete(agentId);
      }

      return {
        ...currentPreferences,
        [projectId]: nextAgentIds
      };
    });
  }

  function getForwardDescendantAgentIds(sourceAgentId: string): Set<string> {
    const descendantIds = new Set<string>();
    const pendingIds = (agentsById.get(sourceAgentId)?.nextAgentIds ?? [])
      .filter((nextAgentId) =>
        !workflowFeedbackEdgeKeys.has(
          getWorkflowEdgeKey(sourceAgentId, nextAgentId)
        )
      );

    while (pendingIds.length > 0) {
      const agentId = pendingIds.shift()!;

      if (descendantIds.has(agentId)) {
        continue;
      }

      descendantIds.add(agentId);
      pendingIds.push(
        ...(agentsById.get(agentId)?.nextAgentIds ?? []).filter(
          (nextAgentId) =>
            !workflowFeedbackEdgeKeys.has(
              getWorkflowEdgeKey(agentId, nextAgentId)
            )
        )
      );
    }

    return descendantIds;
  }

  function getInvalidatedAgentIds(sourceAgentId: string): Set<string> {
    const invalidatedAgentIds = new Set<string>();
    const visitedAgentIds = new Set([sourceAgentId]);
    const pendingIds = [
      ...(agentsById.get(sourceAgentId)?.nextAgentIds ?? [])
    ];

    while (pendingIds.length > 0) {
      const agentId = pendingIds.shift()!;

      if (visitedAgentIds.has(agentId)) {
        continue;
      }

      visitedAgentIds.add(agentId);
      invalidatedAgentIds.add(agentId);
      pendingIds.push(
        ...(agentsById.get(agentId)?.nextAgentIds ?? []).filter(
          (nextAgentId) =>
            !workflowFeedbackEdgeKeys.has(
              getWorkflowEdgeKey(agentId, nextAgentId)
            )
        )
      );
    }

    return invalidatedAgentIds;
  }

  function clearInvalidatedAgentResults(
    states: AgentResultStates,
    invalidatedAgentIds: ReadonlySet<string>
  ): AgentResultStates {
    const nextStates = { ...states };

    for (const invalidatedAgentId of invalidatedAgentIds) {
      nextStates[invalidatedAgentId] = {
        responses: [],
        selectedItemIndexes: [],
        isInvalidated: true
      };
    }

    return nextStates;
  }

  function rearmInvalidatedAgents(
    sourceAgentId: string,
    invalidatedAgentIds: ReadonlySet<string>
  ): void {
    const hasFeedbackSuccessor = (agentsById.get(sourceAgentId)?.nextAgentIds ?? [])
      .some((nextAgentId) => workflowFeedbackEdgeKeys.has(
        getWorkflowEdgeKey(sourceAgentId, nextAgentId)
      ));

    setLaunchedAgentIds((currentAgentIds) => {
      const nextAgentIds = new Set(currentAgentIds);

      for (const invalidatedAgentId of invalidatedAgentIds) {
        nextAgentIds.delete(invalidatedAgentId);
      }

      if (hasFeedbackSuccessor) {
        nextAgentIds.delete(sourceAgentId);
      }

      return nextAgentIds;
    });
  }

  function handleResponseChange(
    agentId: string,
    responses: AgentResponsePayload[]
  ): void {
    const invalidatedAgentIds = getInvalidatedAgentIds(agentId);
    const storedSelections = {
      ...(selectedItemIndexesByProject.current[projectId] ?? {})
    };

    storedSelections[agentId] = [];

    for (const invalidatedAgentId of invalidatedAgentIds) {
      storedSelections[invalidatedAgentId] = [];
    }

    selectedItemIndexesByProject.current[projectId] = storedSelections;
    rearmInvalidatedAgents(agentId, invalidatedAgentIds);
    setAgentResultStates((currentStates) => ({
      ...clearInvalidatedAgentResults(currentStates, invalidatedAgentIds),
      [agentId]: {
        responses,
        selectedItemIndexes: [],
        isInvalidated: false
      }
    }));
  }

  function handleSelectedItemIndexesChange(
    agentId: string,
    selectedItemIndexes: number[]
  ): void {
    const invalidatedAgentIds = getInvalidatedAgentIds(agentId);
    const storedSelections = {
      ...(selectedItemIndexesByProject.current[projectId] ?? {}),
      [agentId]: [...selectedItemIndexes]
    };

    for (const invalidatedAgentId of invalidatedAgentIds) {
      storedSelections[invalidatedAgentId] = [];
    }

    selectedItemIndexesByProject.current[projectId] = storedSelections;
    rearmInvalidatedAgents(agentId, invalidatedAgentIds);
    setAgentResultStates((currentStates) => {
      const currentState = currentStates[agentId];

      if (!currentState) {
        return currentStates;
      }

      return {
        ...clearInvalidatedAgentResults(currentStates, invalidatedAgentIds),
        [agentId]: {
          ...currentState,
          selectedItemIndexes
        }
      };
    });
  }

  function handleRunStart(agentId: string): void {
    const runningAgentIds = runningAgentIdsByProject.current[projectId] ??
      new Set<string>();
    runningAgentIds.add(agentId);
    runningAgentIdsByProject.current[projectId] = runningAgentIds;
    setLaunchedAgentIds((currentAgentIds) => {
      const nextAgentIds = new Set(currentAgentIds);
      nextAgentIds.add(agentId);
      return nextAgentIds;
    });
    onRunStateChange(projectId, "running");
  }

  function handleRunEnd(agentId: string, succeeded: boolean): void {
    const runningAgentIds = runningAgentIdsByProject.current[projectId] ??
      new Set<string>();
    runningAgentIds.delete(agentId);
    runningAgentIdsByProject.current[projectId] = runningAgentIds;
    onRunStateChange(
      projectId,
      runningAgentIds.size > 0
        ? "running"
        : succeeded ? "completed" : "idle"
    );
  }

  function getAgentLaunchThreadCount(agent: AgentDefinition): number {
    const upstreamAgents = workflowAgents.filter(
      (candidate) => candidate.nextAgentIds.includes(agent.id)
    );

    if (getPrerequisiteMessage(
      upstreamAgents,
      agent.id,
      agentResultStates,
      workflowAgents,
      workflowFeedbackEdgeKeys,
      t
    )) {
      return 1;
    }

    return getPlannedThreadCount(
      agent,
      getApplicableUpstreamAgents(
        upstreamAgents,
        agent.id,
        agentResultStates
      ),
      agentResultStates
    );
  }

  return (
    <section className="workspace-content workspace-content--project">
      <header className="agent-project__header">
        <div className="agent-project__title-row">
          <div>
            <p className="eyebrow">{t("workspace.project", { engine: content.engine })}</p>
            <h1>{projectName}</h1>
          </div>
        </div>
        <div className="agent-project__tabs-row">
          <div className="agent-project__tabs" role="tablist" aria-label={t("workspace.contentAria")}>
            <button
              className={`agent-project__tab${
                activeTab === "instructions" ? " agent-project__tab--active" : ""
              }`}
              id={instructionsTabId}
              ref={instructionsTabRef}
              type="button"
              role="tab"
              aria-controls={instructionsPanelId}
              aria-selected={activeTab === "instructions"}
              tabIndex={activeTab === "instructions" ? 0 : -1}
              onClick={() => setActiveTab("instructions")}
              onKeyDown={handleTabKeyDown}
            >
              {t("workspace.instructionsTab")}
            </button>
            <button
              className={`agent-project__tab${
                activeTab === "agents" ? " agent-project__tab--active" : ""
              }`}
              id={agentsTabId}
              ref={agentsTabRef}
              type="button"
              role="tab"
              aria-controls={agentsPanelId}
              aria-selected={activeTab === "agents"}
              tabIndex={activeTab === "agents" ? 0 : -1}
              onClick={() => setActiveTab("agents")}
              onKeyDown={handleTabKeyDown}
            >
              {agentsTabLabel}
            </button>
          </div>
          <div className="agent-project__tab-actions">
            {activeTab === "agents" && content.agents.length > 0 && (
              <HandoffToggle
                checked={isGlobalHandoffEnabled}
                description={isGlobalHandoffEnabled
                  ? t("workspace.manualAll")
                  : t("workspace.autoAll")
                }
                variant="global"
                onChange={handleGlobalHandoffChange}
              />
            )}
            <button
              className="agent-project__edit-button"
              type="button"
              onClick={onEdit}
              disabled={content.agents.some((agent) => agent.executionStatus === "running")}
              title={content.agents.some((agent) => agent.executionStatus === "running")
                ? t("workspace.editUnavailable")
                : t("workspace.editTitle")}
            >
              <Pencil aria-hidden="true" size={15} />
              {t("workspace.edit")}
            </button>
          </div>
        </div>
      </header>

      {activeTab === "instructions" ? (
        <section
          className="project-instructions"
          id={instructionsPanelId}
          role="tabpanel"
          aria-labelledby={instructionsTabId}
          tabIndex={0}
        >
          <header className="project-instructions__header">
            <span>{t("workspace.instructionsFile")}</span>
            <h2>{content.instructions.fileName}</h2>
          </header>
          {content.instructions.content !== null ? (
            <pre>{content.instructions.content || t("workspace.emptyFile")}</pre>
          ) : (
            <p className="project-instructions__empty">
              {t("workspace.missingFile", { name: content.instructions.fileName })}
            </p>
          )}
        </section>
      ) : (
        <section
          className="agent-project__agents-panel"
          id={agentsPanelId}
          role="tabpanel"
          aria-labelledby={agentsTabId}
          tabIndex={0}
        >
          {content.agents.length === 0 ? (
            <p className="agent-project__empty">
              {t("workspace.noAgents")}
            </p>
          ) : (
            <div
              className={`agent-project__workflow${
                workflowFeedbackLoopPlacements.length > 0
                  ? " agent-project__workflow--has-feedback"
                  : ""
              }`}
            >
              {workflowFeedbackLoopPlacements.map((placement) => (
                <span
                  aria-hidden="true"
                  className="agent-project__feedback-grid-loop"
                  key={placement.key}
                  style={{
                    gridRow: `${placement.targetLevelIndex + 1} / ${placement.sourceLevelIndex + 2}`
                  }}
                >
                  <svg
                    className="agent-project__feedback-grid-loop-canvas"
                    focusable="false"
                    preserveAspectRatio="none"
                    viewBox="0 0 100 100"
                  >
                    <path
                      className="agent-project__feedback-grid-loop-path agent-project__feedback-grid-loop-path--desktop"
                      d="M 27 100 L 27 102.3 Q 27 104.8, 25.5 104.8 L 2.75 104.8 Q 1.25 104.8, 1.25 102.3 L 1.25 10.5 Q 1.25 8, 2.75 8 L 24 8"
                    />
                    <path
                      className="agent-project__feedback-grid-loop-arrow agent-project__feedback-grid-loop-arrow--desktop"
                      d="M 23.15 7.2 L 24 8 L 23.15 8.8"
                    />
                    <path
                      className="agent-project__feedback-grid-loop-path agent-project__feedback-grid-loop-path--compact"
                      d="M 52.5 100 L 52.5 102.3 Q 52.5 104.8, 49 104.8 L 5 104.8 Q 1.5 104.8, 1.5 102.3 L 1.5 10.5 Q 1.5 8, 5 8"
                    />
                    <path
                      className="agent-project__feedback-grid-loop-arrow agent-project__feedback-grid-loop-arrow--compact"
                      d="M 4.15 7.2 L 5 8 L 4.15 8.8"
                    />
                  </svg>
                </span>
              ))}
              {workflowLevels.map((levelAgents, levelIndex) => {
                const nextLevelAgents = workflowLevels[levelIndex + 1] ?? [];
                const nextLevelPreparesParallelRun =
                  nextLevelAgents.some(
                    (agent) => getAgentLaunchThreadCount(agent) > 1
                  );
                const usesFlowLanes =
                  firstCycleSplitLevelIndex >= 0 &&
                  levelIndex >= firstCycleSplitLevelIndex;
                const nextLevelIntroducesFlowLanes =
                  levelIndex + 1 === firstCycleSplitLevelIndex;
                const cycleContinues = levelAgents.some((agent) =>
                  cyclicAgentIds.has(agent.id) &&
                  agent.nextAgentIds.some((nextAgentId) =>
                    nextLevelAgents.some((nextAgent) =>
                      nextAgent.id === nextAgentId &&
                      cyclicAgentIds.has(nextAgent.id)
                    ) &&
                    !workflowFeedbackEdgeKeys.has(
                      getWorkflowEdgeKey(agent.id, nextAgentId)
                    )
                  )
                );
                const parallelBranchContinues = levelAgents.some((agent) =>
                  !cyclicAgentIds.has(agent.id) &&
                  agent.nextAgentIds.some((nextAgentId) =>
                    nextLevelAgents.some((nextAgent) =>
                      nextAgent.id === nextAgentId &&
                      !cyclicAgentIds.has(nextAgent.id)
                    )
                  )
                );
                const hasTerminalParallelBranch = levelAgents.some((agent) =>
                  !cyclicAgentIds.has(agent.id) &&
                  !agent.nextAgentIds.some((nextAgentId) =>
                    agentsById.has(nextAgentId) &&
                    !workflowFeedbackEdgeKeys.has(
                      getWorkflowEdgeKey(agent.id, nextAgentId)
                    )
                  )
                );
                return (
                  <section
                    className={`agent-project__workflow-level${
                      usesFlowLanes
                        ? " agent-project__workflow-level--lanes"
                        : ""
                    }`}
                    aria-label={t("workspace.step", { number: levelIndex + 1 })}
                    key={levelIndex}
                    style={{ gridRow: levelIndex + 1 }}
                  >
                    <ol className={`agent-project__workflow-cards${
                      usesFlowLanes
                        ? " agent-project__workflow-cards--lanes"
                        : ""
                    }`}>
                      {levelAgents.map((agent) => {
                        const flowKind: AgentFlowKind = cyclicAgentIds.has(
                          agent.id
                        )
                          ? "cycle"
                          : usesFlowLanes
                            ? "parallel"
                            : "standard";
                        const upstreamAgents = workflowAgents.filter(
                          (candidate) => candidate.nextAgentIds.includes(agent.id)
                        );
                        const prerequisiteMessage = getPrerequisiteMessage(
                          upstreamAgents,
                          agent.id,
                          agentResultStates,
                          workflowAgents,
                          workflowFeedbackEdgeKeys,
                          t
                        );
                        const applicableUpstreamAgents =
                          getApplicableUpstreamAgents(
                            upstreamAgents,
                            agent.id,
                            agentResultStates
                          );
                        const upstreamAgentResults = prerequisiteMessage
                          ? undefined
                          : applicableUpstreamAgents
                            .map((upstreamAgent) => getUpstreamAgentResult(
                              upstreamAgent,
                              agent.id,
                              agentResultStates
                            ))
                            .filter((result): result is UpstreamAgentResult =>
                              result !== null
                            );

                        return (
                          <li
                            className={`agent-project__workflow-step agent-project__workflow-step--${flowKind}`}
                            data-workflow-agent-id={agent.id}
                            key={`${content.projectId}:${agent.id}`}
                          >
                            <AgentCard
                              agent={agent}
                              nextAgentNamesById={new Map(
                                agent.nextAgentIds.map((nextAgentId) => [
                                  nextAgentId,
                                  agentsById.get(nextAgentId)?.name ?? nextAgentId
                                ])
                              )}
                              handoffEnabled={handoffEnabledAgentIds.has(agent.id)}
                              shouldAutoRun={
                                handoffEnabledAgentIds.has(agent.id) &&
                                upstreamAgents.length > 0 &&
                                !launchedAgentIds.has(agent.id) &&
                                prerequisiteMessage === null
                              }
                              plannedThreadCount={getPlannedThreadCount(
                                agent,
                                applicableUpstreamAgents,
                                agentResultStates
                              )}
                              upstreamAgentResults={upstreamAgentResults}
                              isInvalidated={
                                agentResultStates[agent.id]?.isInvalidated ?? false
                              }
                              isFrozen={[
                                ...getForwardDescendantAgentIds(agent.id)
                              ].some((descendantId) =>
                                launchedAgentIds.has(descendantId)
                              )}
                              prerequisiteMessage={prerequisiteMessage}
                              projectId={content.projectId}
                              selectedItemIndexes={
                                agentResultStates[agent.id]?.selectedItemIndexes ?? []
                              }
                              onResponseChange={handleResponseChange}
                              onSelectedItemIndexesChange={
                                handleSelectedItemIndexesChange
                              }
                              onRunStart={handleRunStart}
                              onRunEnd={(succeeded) => handleRunEnd(
                                agent.id,
                                succeeded
                              )}
                              onHandoffEnabledChange={handleAgentHandoffChange}
                            />
                          </li>
                        );
                      })}
                    </ol>
                    {levelIndex < workflowLevels.length - 1 && (
                      usesFlowLanes ? (
                        <div
                          className="agent-project__lane-transition"
                          aria-hidden="true"
                        >
                          <span
                            className="agent-project__lane-transition-item agent-project__lane-transition-item--cycle"
                          >
                            {cycleContinues && (
                              <ArrowDown size={17} strokeWidth={1.7} />
                            )}
                          </span>
                          <span
                            className="agent-project__lane-transition-item agent-project__lane-transition-item--parallel"
                          >
                            {parallelBranchContinues && (
                              <ArrowDown size={17} strokeWidth={1.7} />
                            )}
                            {!parallelBranchContinues &&
                              hasTerminalParallelBranch && (
                                <>
                                  <i />
                                  <small>{t("workspace.branchEnd")}</small>
                                </>
                              )}
                          </span>
                        </div>
                      ) : (
                        <div
                          className={`agent-project__workflow-connector${
                            nextLevelIntroducesFlowLanes
                              ? " agent-project__workflow-connector--split"
                              : nextLevelPreparesParallelRun
                                ? " agent-project__workflow-connector--parallel"
                                : ""
                          }`}
                          aria-hidden="true"
                        >
                          {nextLevelIntroducesFlowLanes ? (
                            <span className="agent-project__split-connector">
                              <ArrowDown size={19} strokeWidth={1.7} />
                              <ArrowDown size={19} strokeWidth={1.7} />
                            </span>
                          ) : nextLevelPreparesParallelRun ? (
                            <span className="agent-project__parallel-connector">
                              <i />
                              <i />
                              <i />
                            </span>
                          ) : levelAgents.some(
                            (agent) => agent.nextAgentIds.length > 1
                          ) ? (
                            <GitBranch size={19} strokeWidth={1.5} />
                          ) : (
                            <ArrowDown size={18} strokeWidth={1.5} />
                          )}
                        </div>
                      )
                    )}
                  </section>
                );
              })}
            </div>
          )}
        </section>
      )}
    </section>
  );
}
