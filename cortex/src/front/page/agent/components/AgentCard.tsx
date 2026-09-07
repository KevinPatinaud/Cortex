import { useEffect, useId, useRef, useState } from "react";
import { Bot, ChevronDown, Clock3, GitBranch, LoaderCircle, Play, RotateCcw, Send } from "lucide-react";
import { runAgent, type AgentConversationMessage, type AgentConversationThread, type AgentDefinition, type UpstreamAgentResult, type WorkflowParameterValues } from "../../../services/agentApi.ts";
import { parseAgentResponse, type AgentResponsePayload } from "../../../../shared/AgentResponse.ts";
import { useTranslation } from "../../../i18n.tsx";
import { findLastAgentResponses, getAgentConversationThreads } from "./workflowState.ts";
import { HandoffToggle } from "./HandoffToggle.tsx";
import { MarkdownContent } from "./MarkdownContent.tsx";
import { ExecutionActivity } from "./ExecutionActivity.tsx";
import { AgentResultContent } from "./AgentResultContent.tsx";

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function ConversationMessageContent({
  message,
  dispatchEnabled,
  nextAgentNamesById,
  itemIndexOffset = 0,
  selectedItemIndexes = [],
  onSelectedItemIndexesChange,
  disabled = false
}: {
  message: AgentConversationMessage;
  dispatchEnabled?: boolean;
  nextAgentNamesById: ReadonlyMap<string, string>;
  itemIndexOffset?: number;
  selectedItemIndexes?: number[];
  onSelectedItemIndexesChange?: (indexes: number[]) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const selectionHelpId = useId();
  if (message.role === "event") {
    try {
      const wake = JSON.parse(message.content) as { type: string; at: string; payload?: string };
      return <div><p>{t(wake.type === "event" ? "wait.received" : wake.type === "deadline" ? "wait.expired" : "wait.timer")}</p>
        <time dateTime={wake.at}>{new Date(wake.at).toLocaleString()}</time>
        {wake.payload && <pre>{wake.payload}</pre>}</div>;
    } catch { return <pre>{message.content}</pre>; }
  }
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
          <AgentResultContent content={response.items[0].content} />
        </div>
      ) : response.items.length > 1 ? (
        <>
          {!disabled && onSelectedItemIndexesChange && (
            <p className="agent-card__conversation-selection-help" id={selectionHelpId}>
              {t(allowsMultipleSelection
                ? "agent.selectionHelpMany"
                : "agent.selectionHelpOne")}
            </p>
          )}
          <ul
            className="agent-card__conversation-response-list"
            aria-label={t("agent.responsesAria")}
            aria-describedby={!disabled && onSelectedItemIndexesChange
              ? selectionHelpId
              : undefined}
          >
            {response.items.map((item, itemIndex) => {
              const isSelected = dispatchEnabled === undefined && selectedItemIndexes.includes(
                itemIndexOffset + itemIndex
              );

              return (
                <li key={itemIndex}>
                  <div
                    className={`agent-card__conversation-response-option${
                      isSelected
                        ? " agent-card__conversation-response-option--selected"
                        : ""
                    }`}
                  >
                    {onSelectedItemIndexesChange && (
                      <label className="agent-card__conversation-response-select">
                        <input
                          className="agent-card__conversation-response-choice"
                          type={allowsMultipleSelection ? "checkbox" : "radio"}
                          name={selectionHelpId}
                          checked={isSelected}
                          disabled={disabled}
                          aria-describedby={`${selectionHelpId}-result-${itemIndex}`}
                          onChange={() => handleItemSelection(itemIndex)}
                        />
                        <span>{t("agent.selectResponse", { number: itemIndex + 1 })}</span>
                      </label>
                    )}
                    <div id={`${selectionHelpId}-result-${itemIndex}`}>
                      <AgentResultContent content={item.content} />
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
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
      {dispatchEnabled !== undefined && response.status === "success" && <p className="agent-card__conversation-routing">
        {t(dispatchEnabled ? "agent.dispatchActive" : "agent.dispatchPaused")}
      </p>}
      {(response.status === "success" || response.status === "partial") && response.nextAgentIds !== null && (dispatchEnabled === undefined || response.nextAgentIds.length > 0) && (
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

interface AgentCardProps {
  agent: AgentDefinition;
  nextAgentNamesById: ReadonlyMap<string, string>;
  handoffEnabled: boolean;
  shouldAutoRun: boolean;
  launchFromPredecessor: boolean;
  plannedThreadCount: number;
  upstreamAgentResults?: UpstreamAgentResult[];
  isInvalidated: boolean;
  isFrozen: boolean;
  executionLockMessage: string | null;
  showContinueButton: boolean;
  canContinue: boolean;
  prerequisiteMessage: string | null;
  missingWorkflowParameterLabels: string[];
  workflowParameterValues?: WorkflowParameterValues;
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
  onContinue: () => void;
  onHandoffEnabledChange: (agentId: string, enabled: boolean) => void;
  compactCompleted?: boolean;
  dossierTemplate?: boolean;
  dispatchEnabled?: boolean;
}

interface AgentThreadPresentation {
  thread: AgentConversationThread;
  lastAgentMessageIndex: number;
  itemIndexOffset: number;
}

interface AgentThreadConversationProps {
  dispatchEnabled?: boolean;
  agentName: string;
  disabled: boolean;
  nextAgentNamesById: ReadonlyMap<string, string>;
  presentation: AgentThreadPresentation;
  selectedItemIndexes: number[];
  onSelectedItemIndexesChange: (indexes: number[]) => void;
}

function AgentThreadConversation({
  dispatchEnabled,
  agentName,
  disabled,
  nextAgentNamesById,
  presentation,
  selectedItemIndexes,
  onSelectedItemIndexesChange
}: AgentThreadConversationProps) {
  const { t } = useTranslation();
  const conversationRef = useRef<HTMLDivElement>(null);
  const followLatestRef = useRef(true);
  const { thread, lastAgentMessageIndex, itemIndexOffset } = presentation;

  useEffect(() => {
    const conversationElement = conversationRef.current;

    if (conversationElement && followLatestRef.current) {
      conversationElement.scrollTo({
        top: conversationElement.scrollHeight,
        behavior: "instant"
      });
    }
  }, [thread.id, thread.conversation.length, thread.conversation.at(-1)?.content]);

  return (
    <section
      className="agent-card__conversation"
      aria-label={t("agent.conversationAria", { name: agentName })}
    >
      <span className="agent-card__conversation-title">{t("agent.conversation")}</span>
      <div
        className="agent-card__conversation-messages"
        ref={conversationRef}
        onScroll={(event) => {
          const element = event.currentTarget;
          followLatestRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < 40;
        }}
        role="log"
        aria-live="polite"
        aria-relevant="additions"
      >
        {thread.conversation.map((message, messageIndex) => (
          <article
            className={`agent-card__conversation-message agent-card__conversation-message--${message.role}`}
            key={messageIndex}
          >
            <span>{message.role === "user" ? t("agent.you") : message.role === "event" ? "Cortex" : "Agent"}</span>
            <ConversationMessageContent
              dispatchEnabled={dispatchEnabled}
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
                messageIndex === lastAgentMessageIndex && dispatchEnabled === undefined
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

export function AgentCard({
  agent,
  nextAgentNamesById,
  handoffEnabled,
  shouldAutoRun,
  launchFromPredecessor,
  plannedThreadCount,
  upstreamAgentResults,
  isInvalidated,
  isFrozen,
  executionLockMessage,
  showContinueButton,
  canContinue,
  prerequisiteMessage,
  missingWorkflowParameterLabels,
  workflowParameterValues,
  projectId,
  selectedItemIndexes,
  onResponseChange,
  onSelectedItemIndexesChange,
  onRunStart,
  onRunEnd,
  onContinue,
  onHandoffEnabledChange,
  compactCompleted = false,
  dossierTemplate = false,
  dispatchEnabled
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
  const [localStartedAt, setLocalStartedAt] = useState<string>();
  const [isExpanded, setIsExpanded] = useState(!compactCompleted);
  const isRunning = runningThreadId !== null || agent.executionStatus === "running";
  const isWaiting = agent.executionStatus === "waiting";
  const isAsynchronous = dossierTemplate || isWaiting || threads.some((thread) =>
    thread.conversation.some((message) => message.role === "event" ||
      (message.role === "agent" && parseAgentResponse(message.content)?.status === "waiting"))
  );
  const AgentIcon = isAsynchronous ? Clock3 : Bot;
  const needsRetry = !isRunning && (agent.executionStatus === "failed" || agent.executionStatus === "cancelled");
  const isCompleted = agent.executionStatus === "idle" && hasSession && !isRunning;
  const hideBody = compactCompleted && isCompleted && !isExpanded && !showContinueButton && !error && !executionLockMessage;
  useEffect(() => setIsExpanded(!compactCompleted), [compactCompleted]);
  const parameterPrerequisiteMessage = missingWorkflowParameterLabels.length > 0
    ? t("parameters.missingForAgent", {
      names: missingWorkflowParameterLabels.join(", ")
    })
    : null;
  const canRun = Boolean(agent.prompt.trim()) &&
    !prerequisiteMessage &&
    !parameterPrerequisiteMessage;
  const isUnavailable = !canRun;
  const isDisabled = agent.executionStatus === "waiting" || isUnavailable || isFrozen || Boolean(executionLockMessage);
  const isBlockedByPrerequisite = Boolean(
    prerequisiteMessage || parameterPrerequisiteMessage
  );
  const shouldShowRunButton =
    (!launchFromPredecessor || hasSession || needsRetry || isRunning) &&
    (!handoffEnabled || isRunning || (canRun && !isFrozen));

  useEffect(() => {
    setHasSession(agent.hasSession);
    setThreads(getAgentConversationThreads(agent));
    setError(agent.executionError ?? "");
  }, [agent.conversation, agent.executionError, agent.hasSession, agent.threads]);

  useEffect(() => {
    setAdditionalInstructions("");
  }, [agent.id]);

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
    if (isRunning || isDisabled) {
      return false;
    }

    setRunningThreadId(threadId ?? "all");
    setLocalStartedAt(new Date().toISOString());
    onRunStart(agent.id);
    setError("");

    try {
      const result = await runAgent(
        projectId,
        agent.id,
        submittedInstructions,
        upstreamAgentResults,
        threadId,
        workflowParameterValues
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
      needsRetry ||
      !canRun ||
      isDisabled
    ) {
      return;
    }

    autoRunAttemptedRef.current = true;
    void handleRun(handoffEnabled ? "" : additionalInstructions.trim());
  }, [shouldAutoRun, isRunning, needsRetry, canRun, isDisabled, handoffEnabled, additionalInstructions]);

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
  const hasMissingResponseSelection = threadPresentation.some(({ thread, lastAgentMessageIndex, itemIndexOffset }) => {
    if (lastAgentMessageIndex < 0) return false;
    const response = parseAgentResponse(thread.conversation[lastAgentMessageIndex].content);
    return response !== null && response.items.length > 1 && !selectedItemIndexes.some(
      (index) => index >= itemIndexOffset && index < itemIndexOffset + response.items.length
    );
  });
  const continueUnavailableMessage = hasMissingResponseSelection
    ? t("agent.continueSelectionRequired")
    : t("agent.continueUnavailable");

  return (
    <article
      tabIndex={-1}
      className={`agent-card${
        isMultithreaded ? " agent-card--multithreaded" : ""
      }${isParallelRunPrepared ? " agent-card--parallel-ready" : ""
      }${isDisabled ? " agent-card--disabled" : ""
      }${isBlockedByPrerequisite ? " agent-card--prerequisite" : ""
      }${handoffEnabled ? " agent-card--handoff" : ""
      }${isAsynchronous ? " agent-card--async" : ""
      }${isWaiting ? " agent-card--waiting" : ""}`}
      aria-label={isParallelRunPrepared
        ? t("agent.parallelAria", { name: agent.name, count: plannedThreadCount })
        : agent.name
      }
    >
      <header className="agent-card__header">
        <AgentIcon aria-hidden="true" size={22} strokeWidth={1.7} />
        <div className="agent-card__identity">
          <h2>{agent.name}</h2>
          {isAsynchronous && (
            <span className="agent-card__async-badge" title={t("agent.asyncHelp")}>
              {t(isWaiting ? "agent.asyncWaiting" : "agent.async")}
            </span>
          )}
        </div>
        <div className="agent-card__header-actions">
          {!dossierTemplate && <HandoffToggle
            checked={handoffEnabled}
            label={t("agent.handoffLabel", { name: agent.name })}
            disabled={Boolean(executionLockMessage)}
            description={handoffEnabled
              ? t("agent.manual", { name: agent.name })
              : t("agent.auto", { name: agent.name })
            }
            onChange={(enabled) => onHandoffEnabledChange(agent.id, enabled)}
          />}
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
          {compactCompleted && isCompleted && !showContinueButton && <button className="agent-card__expand" type="button"
            aria-expanded={!hideBody}
            aria-label={t(hideBody ? "agent.showCompleted" : "agent.hideCompleted", { name: agent.name })}
            onClick={() => setIsExpanded((expanded) => !expanded)}>
            <ChevronDown aria-hidden="true" size={16} />
          </button>}
        </div>
      </header>
      {isRunning && <ExecutionActivity
        startedAt={runningThreadId ? localStartedAt : agent.executionStartedAt}
        lastActivityAt={agent.executionLastActivityAt || localStartedAt || agent.executionStartedAt}
        progress={agent.executionProgress}
      />}
      {agent.executionStatus === "waiting" && <p className="agent-card__run-prerequisite" role="status">{t("execution.status.waiting")}</p>}
      {!hideBody && <>
      <details className="agent-card__prompt">
        <summary>
          <span className="agent-card__prompt-description">
            {agent.description || t("agent.noDescription")}
          </span>
          <ChevronDown aria-hidden="true" size={15} strokeWidth={1.7} />
        </summary>
        <div className="agent-card__prompt-content">
          <MarkdownContent content={agent.prompt || t("agent.noInstruction")} />
        </div>
      </details>
      <div className="agent-card__run-feedback" aria-live="polite">
        {executionLockMessage && <p className="agent-card__run-prerequisite">{executionLockMessage}</p>}
        {isFrozen && <p className="agent-card__run-prerequisite">{t("agent.frozen")}</p>}
        {!agent.prompt.trim() && <p className="agent-card__run-prerequisite">{t("agent.emptyInstruction")}</p>}
        {prerequisiteMessage && (
          <p className="agent-card__run-prerequisite">
            {prerequisiteMessage}
          </p>
        )}
        {parameterPrerequisiteMessage && (
          <p className="agent-card__run-prerequisite">
            {parameterPrerequisiteMessage}
          </p>
        )}
        {showContinueButton && !canContinue && !isRunning && !executionLockMessage && (
          <p className="agent-card__run-prerequisite">{continueUnavailableMessage}</p>
        )}
        {agent.executionStatus === "cancelled" && !isRunning ? (
          <p className="agent-card__run-prerequisite" role="status">{t("execution.cancelled")}</p>
        ) : error && (
          <p className="agent-card__run-error" role="alert">{error}</p>
        )}
      </div>
      {isMultithreaded ? (
        <>
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
                  dispatchEnabled={dispatchEnabled}
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
          {needsRetry && <div className="agent-card__retry">
            <p>{t("execution.retryHelp")}</p>
            <button className="agent-card__run-button" type="button" disabled={isDisabled}
              onClick={() => void handleRun("")}>
              <RotateCcw aria-hidden="true" size={15} />{t("execution.retryFailed")}
            </button>
          </div>}
          {showContinueButton && (
            <div className="agent-card__actions">
              <button
                className="agent-card__continue-button"
                type="button"
                onClick={onContinue}
                disabled={!canContinue || isRunning}
                title={canContinue
                  ? t("agent.continueTitle")
                  : continueUnavailableMessage}
              >
                <Play aria-hidden="true" size={15} strokeWidth={2} />
                {t("agent.continue")}
              </button>
            </div>
          )}
        </>
      ) : (
        <>
          {threadPresentation[0] && (
            <AgentThreadConversation
              dispatchEnabled={dispatchEnabled}
              agentName={agent.name}
              disabled={isDisabled || isRunning}
              nextAgentNamesById={nextAgentNamesById}
              presentation={threadPresentation[0]}
              selectedItemIndexes={selectedItemIndexes}
              onSelectedItemIndexesChange={(indexes) =>
                onSelectedItemIndexesChange(agent.id, indexes)
              }
            />
          )}
          {!handoffEnabled && !isBlockedByPrerequisite && (
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
          {((!isBlockedByPrerequisite && shouldShowRunButton) || showContinueButton) && (
            <div className="agent-card__actions">
              {!isBlockedByPrerequisite && shouldShowRunButton && (
                <button
                  className="agent-card__run-button"
                  type="button"
                  aria-busy={isRunning}
                  onClick={() => void handleRun(
                    handoffEnabled ? "" : additionalInstructions.trim()
                  )}
                  disabled={isRunning || isDisabled}
                  title={isFrozen
                    ? t("agent.frozen")
                    : prerequisiteMessage || parameterPrerequisiteMessage || (canRun
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
                    : needsRetry
                      ? t("execution.retry")
                    : hasSession
                      ? t(additionalInstructions.trim()
                        ? "agent.rerunWithDetails"
                        : "agent.rerun")
                      : t("agent.run")
                  }
                </button>
              )}
              {showContinueButton && (
                <button
                  className="agent-card__continue-button"
                  type="button"
                  onClick={onContinue}
                  disabled={!canContinue || isRunning}
                  title={canContinue
                    ? t("agent.continueTitle")
                    : continueUnavailableMessage}
                >
                  <Play aria-hidden="true" size={15} strokeWidth={2} />
                  {t("agent.continue")}
                </button>
              )}
            </div>
          )}
        </>
      )}
      </>}
    </article>
  );
}

