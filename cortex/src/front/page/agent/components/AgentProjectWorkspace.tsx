import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
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
    // Le workflow reste utilisable lorsque le stockage navigateur est indisponible.
  }
}

function getProjectName(directoryPath: string): string {
  const pathParts = directoryPath.split(/[\\/]/).filter(Boolean);
  return pathParts.at(-1) || directoryPath;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Une erreur inattendue est survenue.";
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
  itemIndexOffset = 0,
  selectedItemIndexes = [],
  onSelectedItemIndexesChange,
  disabled = false
}: {
  message: AgentConversationMessage;
  itemIndexOffset?: number;
  selectedItemIndexes?: number[];
  onSelectedItemIndexesChange?: (indexes: number[]) => void;
  disabled?: boolean;
}) {
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
          aria-label="Réponses proposées"
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
          Aucune réponse proposée.
        </p>
      )}
      {response.notes && (
        <div className="agent-card__conversation-response-notes">
          <MarkdownContent content={response.notes} />
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
  workflowAgents: AgentDefinition[]
): string | null {
  if (upstreamAgents.length === 0) {
    return null;
  }

  const pendingAgents = upstreamAgents.filter((agent) =>
    getAgentProgressState(agent, workflowAgents, states) === "pending"
  );

  if (pendingAgents.length > 0) {
    return upstreamAgents.length === 1
      ? `Exécutez d'abord « ${pendingAgents[0].name} ».`
      : `Attendez la fin de tous les agents précédents : ${pendingAgents
        .map((agent) => `« ${agent.name} »`)
        .join(" et ")}.`;
  }

  const applicableUpstreamAgents = getApplicableUpstreamAgents(
    upstreamAgents,
    targetAgentId,
    states
  );

  if (applicableUpstreamAgents.length === 0) {
    return "Cette branche n'a pas été sélectionnée par les agents précédents.";
  }

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
      ? `Sélectionnez un ou plusieurs résultats de « ${agentAwaitingSelection.name} ».`
      : `Sélectionnez un résultat de « ${agentAwaitingSelection.name} ».`;
  }

  if (applicableUpstreamAgents.some(
    (agent) => states[agent.id]?.responses.some(
      (response) => responseRoutesToAgent(response, targetAgentId) &&
        response.items.length === 0
    )
  )) {
    return "Aucun agent précédent exécuté n'a produit de résultat transmissible.";
  }

  return "Les résultats de tous les agents précédents ne sont pas encore prêts.";
}

function getAgentProgressState(
  agent: AgentDefinition,
  workflowAgents: AgentDefinition[],
  states: AgentResultStates,
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

  const nextVisitingAgentIds = new Set(visitingAgentIds);
  nextVisitingAgentIds.add(agent.id);
  const upstreamStates = upstreamAgents.map((upstreamAgent) => ({
    agent: upstreamAgent,
    progress: getAgentProgressState(
      upstreamAgent,
      workflowAgents,
      states,
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

function getWorkflowLevels(agents: AgentDefinition[]): AgentDefinition[][] {
  const workflowAgents = [...agents];
  const agentsById = new Map(workflowAgents.map((agent) => [agent.id, agent]));
  const levelsByAgentId = new Map(
    workflowAgents.map((agent) => [agent.id, 0])
  );

  for (const agent of workflowAgents) {
    const sourceLevel = levelsByAgentId.get(agent.id) ?? 0;

    for (const nextAgentId of agent.nextAgentIds) {
      if (!agentsById.has(nextAgentId)) {
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

interface AgentCardProps {
  agent: AgentDefinition;
  stepLabel: string;
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
  const stateLabel = checked ? "Automatique" : "Manuel";

  return (
    <button
      className={`handoff-toggle handoff-toggle--${variant}${
        checked ? " handoff-toggle--active" : ""
      }`}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={`${stateLabel}. ${description}`}
      title={`Mode actuel : ${stateLabel}. ${description}`}
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
  presentation: AgentThreadPresentation;
  selectedItemIndexes: number[];
  onSelectedItemIndexesChange: (indexes: number[]) => void;
}

function AgentThreadConversation({
  agentName,
  disabled,
  presentation,
  selectedItemIndexes,
  onSelectedItemIndexesChange
}: AgentThreadConversationProps) {
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
      aria-label={`Conversation avec ${agentName}`}
    >
      <span className="agent-card__conversation-title">Conversation</span>
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
            <span>{message.role === "user" ? "Vous" : "Agent"}</span>
            <ConversationMessageContent
              message={message}
              disabled={disabled}
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
          Instance {String(index + 1).padStart(2, "0")}
        </span>
        <span className="agent-instance-card__status">
          <span aria-hidden="true" /> Session active
        </span>
      </header>
      <AgentThreadConversation
        agentName={`${agentName}, instance ${index + 1}`}
        disabled={disabled}
        {...conversationProps}
      />
      {!hideAdditionalInstructions && (
        <div className="agent-card__additional-instructions">
          <label htmlFor={additionalInstructionsId}>Précisions</label>
          <textarea
            id={additionalInstructionsId}
            value={additionalInstructions}
            onChange={(event) => setAdditionalInstructions(event.target.value)}
            placeholder="Ajoutez une précision pour cette instance..."
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
            ? "Cette instance est figée car un agent en aval a déjà été lancé."
            : `Relancer l'instance ${index + 1}`
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
          {isRunning ? "Exécution..." : "Relancer cette instance"}
        </button>
      </div>
    </article>
  );
}

function AgentCard({
  agent,
  stepLabel,
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
      setError(getErrorMessage(requestError));
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
        ? `${agent.name}, lancement préparé sur ${plannedThreadCount} instances parallèles`
        : undefined
      }
    >
      <span className="agent-card__step">{stepLabel}</span>
      <header className="agent-card__header">
        <Bot aria-hidden="true" size={22} strokeWidth={1.7} />
        <div className="agent-card__identity">
          <h2>{agent.name}</h2>
        </div>
        <div className="agent-card__header-actions">
          <HandoffToggle
            checked={handoffEnabled}
            description={handoffEnabled
              ? `Repasser ${agent.name} en exécution manuelle`
              : `Lancer automatiquement ${agent.name} dès que les résultats requis sont prêts`
            }
            onChange={(enabled) => onHandoffEnabledChange(agent.id, enabled)}
          />
          {(agent.model || agent.reasoningEffort) && (
            <dl className="agent-card__model">
              {agent.model && (
                <div>
                  <dt>Modèle</dt>
                  <dd>{agent.model}</dd>
                </div>
              )}
              {agent.reasoningEffort && (
                <div>
                  <dt>Raisonnement</dt>
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
            {agent.description || "Aucune description."}
          </span>
          <ChevronDown aria-hidden="true" size={15} strokeWidth={1.7} />
        </summary>
        <pre>{agent.prompt || "Aucune instruction."}</pre>
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
          aria-label={`Instances de ${agent.name}`}
        >
          <header className="agent-instances-zone__header">
            <div>
              <GitBranch aria-hidden="true" size={18} strokeWidth={1.7} />
              <span>
                Zone d'évolution · {threadPresentation.length} instances
              </span>
            </div>
            <p>Chaque branche possède sa propre session et peut être relancée séparément.</p>
          </header>
          <div className="agent-instances-zone__track">
            {threadPresentation.map((presentation, index) => (
              <AgentInstanceCard
                agentName={agent.name}
                disabled={isDisabled || isRunning}
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
              presentation={threadPresentation[0]}
              selectedItemIndexes={selectedItemIndexes}
              onSelectedItemIndexesChange={(indexes) =>
                onSelectedItemIndexesChange(agent.id, indexes)
              }
            />
          )}
          {!handoffEnabled && (
            <div className="agent-card__additional-instructions">
              <label htmlFor={additionalInstructionsId}>Précisions</label>
              <textarea
                id={additionalInstructionsId}
                value={additionalInstructions}
                onChange={(event) => setAdditionalInstructions(event.target.value)}
                placeholder={hasSession
                  ? "Ajoutez une précision pour la prochaine relance..."
                  : "Ajoutez une précision avant de lancer l'agent..."
                }
                rows={4}
                disabled={isRunning || isDisabled}
              />
            </div>
          )}
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
                ? "Cet agent est figé car un agent en aval a déjà été lancé."
                : prerequisiteMessage || (canRun
                  ? `${hasSession ? "Relancer" : "Lancer"} ${agent.name}`
                  : "Cet agent ne contient aucune instruction."
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
                ? "Exécution..."
                : hasSession ? "Relancer" : "Lancer"
              }
            </button>
          </div>
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
        // La requête de lancement affiche déjà les erreurs d'exécution.
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
          Sélectionnez un projet dans le bandeau latéral pour afficher ses agents.
        </p>
      </section>
    );
  }

  const projectId = content.projectId;
  const projectName = getProjectName(project.directoryPath);
  const agentsTabLabel = `Workflow (${content.agents.length} agent${
    content.agents.length > 1 ? "s" : ""
  })`;
  const instructionsTabId = `${tabsId}-instructions-tab`;
  const instructionsPanelId = `${tabsId}-instructions-panel`;
  const agentsTabId = `${tabsId}-agents-tab`;
  const agentsPanelId = `${tabsId}-agents-panel`;
  const workflowAgents = [...content.agents];
  const agentsById = new Map(workflowAgents.map((agent) => [agent.id, agent]));
  const workflowLevels = getWorkflowLevels(workflowAgents);
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

  function getDescendantAgentIds(sourceAgentId: string): Set<string> {
    const descendantIds = new Set<string>();
    const pendingIds = [
      ...(agentsById.get(sourceAgentId)?.nextAgentIds ?? [])
    ];

    while (pendingIds.length > 0) {
      const agentId = pendingIds.shift()!;

      if (descendantIds.has(agentId)) {
        continue;
      }

      descendantIds.add(agentId);
      pendingIds.push(...(agentsById.get(agentId)?.nextAgentIds ?? []));
    }

    return descendantIds;
  }

  function clearDescendantAgentResults(
    states: AgentResultStates,
    sourceAgentId: string
  ): AgentResultStates {
    const nextStates = { ...states };

    for (const descendantId of getDescendantAgentIds(sourceAgentId)) {
      nextStates[descendantId] = {
        responses: [],
        selectedItemIndexes: [],
        isInvalidated: true
      };
    }

    return nextStates;
  }

  function handleResponseChange(
    agentId: string,
    responses: AgentResponsePayload[]
  ): void {
    const storedSelections = {
      ...(selectedItemIndexesByProject.current[projectId] ?? {})
    };

    storedSelections[agentId] = [];

    for (const descendantId of getDescendantAgentIds(agentId)) {
      storedSelections[descendantId] = [];
    }

    selectedItemIndexesByProject.current[projectId] = storedSelections;
    setAgentResultStates((currentStates) => ({
      ...clearDescendantAgentResults(currentStates, agentId),
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
    const storedSelections = {
      ...(selectedItemIndexesByProject.current[projectId] ?? {}),
      [agentId]: [...selectedItemIndexes]
    };

    for (const descendantId of getDescendantAgentIds(agentId)) {
      storedSelections[descendantId] = [];
    }

    selectedItemIndexesByProject.current[projectId] = storedSelections;
    setAgentResultStates((currentStates) => {
      const currentState = currentStates[agentId];

      if (!currentState) {
        return currentStates;
      }

      return {
        ...clearDescendantAgentResults(currentStates, agentId),
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
      workflowAgents
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
            <p className="eyebrow">Projet {content.engine}</p>
            <h1>{projectName}</h1>
          </div>
        </div>
        <div className="agent-project__tabs-row">
          <div className="agent-project__tabs" role="tablist" aria-label="Contenu du projet">
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
              Instructions projet
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
                  ? "Repasser tous les agents en exécution manuelle"
                  : "Enchaîner automatiquement les agents dès que leurs prérequis sont remplis"
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
                ? "L’édition sera disponible à la fin de l’exécution"
                : "Modifier le projet et ses agents"}
            >
              <Pencil aria-hidden="true" size={15} />
              Modifier le projet
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
            <span>Fichier d'instructions</span>
            <h2>{content.instructions.fileName}</h2>
          </header>
          {content.instructions.content !== null ? (
            <pre>{content.instructions.content || "Le fichier est vide."}</pre>
          ) : (
            <p className="project-instructions__empty">
              Le fichier {content.instructions.fileName} est introuvable à la
              racine du projet.
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
              Aucun agent n'est configuré dans ce projet.
            </p>
          ) : (
            <div className="agent-project__workflow">
              {workflowLevels.map((levelAgents, levelIndex) => {
                const nextLevelPreparesParallelRun =
                  workflowLevels[levelIndex + 1]?.some(
                    (agent) => getAgentLaunchThreadCount(agent) > 1
                  ) ?? false;

                return (
                  <section
                    className="agent-project__workflow-level"
                    aria-label={`Étape ${levelIndex + 1}`}
                    key={levelIndex}
                  >
                    <ol className="agent-project__workflow-cards">
                      {levelAgents.map((agent) => {
                        const upstreamAgents = workflowAgents.filter(
                          (candidate) => candidate.nextAgentIds.includes(agent.id)
                        );
                        const prerequisiteMessage = getPrerequisiteMessage(
                          upstreamAgents,
                          agent.id,
                          agentResultStates,
                          workflowAgents
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
                            className="agent-project__workflow-step"
                            key={`${content.projectId}:${agent.id}`}
                          >
                            <AgentCard
                              agent={agent}
                              stepLabel={`Étape ${levelIndex + 1} sur ${workflowLevels.length}`}
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
                                ...getDescendantAgentIds(agent.id)
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
                      <div
                        className={`agent-project__workflow-connector${
                          nextLevelPreparesParallelRun
                            ? " agent-project__workflow-connector--parallel"
                            : ""
                        }`}
                        aria-hidden="true"
                      >
                        {nextLevelPreparesParallelRun ? (
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
