import { useEffect, useId, useRef, useState } from "react";
import { ArrowDown, Bot, ChevronDown, GitBranch, RotateCcw } from "lucide-react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  loadAgentProject,
  runAgent,
  type AgentConversationMessage,
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
  onContentRefresh: (content: AgentProject) => void;
  onRunStateChange: (
    projectId: string,
    status: "idle" | "running" | "completed"
  ) => void;
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
  selectedItemIndexes = [],
  onSelectedItemIndexesChange,
  disabled = false
}: {
  message: AgentConversationMessage;
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

  function handleItemSelection(itemIndex: number): void {
    if (disabled || !onSelectedItemIndexesChange) {
      return;
    }

    const isAlreadySelected = selectedItemIndexes.includes(itemIndex);
    const nextIndexes = allowsMultipleSelection
      ? isAlreadySelected
        ? selectedItemIndexes.filter((index) => index !== itemIndex)
        : [...selectedItemIndexes, itemIndex]
      : isAlreadySelected ? [] : [itemIndex];

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
            const isSelected = selectedItemIndexes.includes(itemIndex);

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
  response: AgentResponsePayload | null;
  selectedItemIndexes: number[];
  isInvalidated: boolean;
}

type AgentResultStates = Record<string, AgentResultState>;

function findLastAgentResponse(
  conversation: AgentConversationMessage[]
): AgentResponsePayload | null {
  for (let index = conversation.length - 1; index >= 0; index -= 1) {
    if (conversation[index].role === "agent") {
      return parseAgentResponse(conversation[index].content);
    }
  }

  return null;
}

function getPrerequisiteMessage(
  upstreamAgents: AgentDefinition[],
  states: AgentResultStates
): string | null {
  const agentsWithoutResponse = upstreamAgents.filter(
    (agent) => !states[agent.id]?.response
  );

  if (agentsWithoutResponse.length > 0) {
    return `Exécutez d'abord ${agentsWithoutResponse
      .map((agent) => `« ${agent.name} »`)
      .join(", ")}.`;
  }

  const agentWithoutItems = upstreamAgents.find(
    (agent) => states[agent.id]?.response?.items.length === 0
  );

  if (agentWithoutItems) {
    return `« ${agentWithoutItems.name} » n'a produit aucun résultat transmissible.`;
  }

  for (const upstreamAgent of upstreamAgents) {
    const state = states[upstreamAgent.id];

    if (!state?.response || state.response.items.length <= 1) {
      continue;
    }

    if (state.selectedItemIndexes.length === 0) {
      return state.response.isMultiSelectionAllowed === true
        ? `Sélectionnez un ou plusieurs résultats de « ${upstreamAgent.name} ».`
        : `Sélectionnez un résultat de « ${upstreamAgent.name} ».`;
    }

    if (
      state.response.isMultiSelectionAllowed !== true &&
      state.selectedItemIndexes.length !== 1
    ) {
      return `Sélectionnez un seul résultat de « ${upstreamAgent.name} ».`;
    }
  }

  return null;
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
  upstreamAgentResults?: UpstreamAgentResult[];
  isInvalidated: boolean;
  isFrozen: boolean;
  prerequisiteMessage: string | null;
  projectId: string;
  selectedItemIndexes: number[];
  onResponseChange: (
    agentId: string,
    response: AgentResponsePayload | null
  ) => void;
  onSelectedItemIndexesChange: (
    agentId: string,
    selectedItemIndexes: number[]
  ) => void;
  onRunStart: (agentId: string) => void;
  onRunEnd: (succeeded: boolean) => void;
}

function AgentCard({
  agent,
  upstreamAgentResults,
  isInvalidated,
  isFrozen,
  prerequisiteMessage,
  projectId,
  selectedItemIndexes,
  onResponseChange,
  onSelectedItemIndexesChange,
  onRunStart,
  onRunEnd
}: AgentCardProps) {
  const additionalInstructionsId = useId();
  const conversationRef = useRef<HTMLDivElement>(null);
  const [isAwaitingResponse, setIsAwaitingResponse] = useState(false);
  const [hasSession, setHasSession] = useState(agent.hasSession);
  const [conversation, setConversation] = useState<AgentConversationMessage[]>(
    agent.conversation
  );
  const [error, setError] = useState(agent.executionError ?? "");
  const [additionalInstructions, setAdditionalInstructions] = useState("");
  const isRunning = isAwaitingResponse || agent.executionStatus === "running";
  const canRun = Boolean(agent.prompt.trim()) && !prerequisiteMessage;
  const isUnavailable = !canRun;
  const isDisabled = isUnavailable || isFrozen;

  useEffect(() => {
    setHasSession(agent.hasSession);
    setConversation(agent.conversation);
    setError(agent.executionError ?? "");
  }, [agent.conversation, agent.executionError, agent.hasSession]);

  useEffect(() => {
    setAdditionalInstructions("");
  }, [agent.id]);

  useEffect(() => {
    if (isInvalidated) {
      setHasSession(false);
      setConversation([]);
      setAdditionalInstructions("");
      setError("");
    }
  }, [isInvalidated]);

  useEffect(() => {
    const conversationElement = conversationRef.current;

    if (!conversationElement) {
      return;
    }

    conversationElement.scrollTo({
      top: conversationElement.scrollHeight,
      behavior: "smooth"
    });
  }, [conversation]);

  async function handleRun(): Promise<void> {
    if (isRunning || !canRun || isFrozen) {
      return;
    }

    const submittedInstructions = additionalInstructions.trim();
    setIsAwaitingResponse(true);
    onRunStart(agent.id);
    setError("");

    try {
      const result = await runAgent(
        projectId,
        agent.id,
        submittedInstructions,
        upstreamAgentResults
      );
      setConversation(result.conversation);
      setHasSession(result.hasSession);
      setAdditionalInstructions("");
      onResponseChange(agent.id, parseAgentResponse(result.answer));
      onRunEnd(true);
    } catch (requestError) {
      setError(getErrorMessage(requestError));
      onRunEnd(false);
    } finally {
      setIsAwaitingResponse(false);
    }
  }

  let lastAgentMessageIndex = -1;

  for (let index = conversation.length - 1; index >= 0; index -= 1) {
    if (conversation[index].role === "agent") {
      lastAgentMessageIndex = index;
      break;
    }
  }

  return (
    <article
      className={`agent-card${isDisabled ? " agent-card--disabled" : ""}`}
      aria-disabled={isDisabled || undefined}
    >
      <header className="agent-card__header">
        <Bot aria-hidden="true" size={22} strokeWidth={1.7} />
        <div>
          <h2>{agent.name}</h2>
        </div>
        {agent.model && (
          <dl className="agent-card__model">
            <dt>Modèle</dt>
            <dd>{agent.model}</dd>
          </dl>
        )}
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
      {agent.reasoningEffort && (
        <dl className="agent-card__configuration">
          <div>
            <dt>Effort de raisonnement</dt>
            <dd>{agent.reasoningEffort}</dd>
          </div>
        </dl>
      )}
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
      {conversation.length > 0 && (
        <section
          className="agent-card__conversation"
          aria-label={`Conversation avec ${agent.name}`}
        >
          <span className="agent-card__conversation-title">Conversation</span>
          <div
            className="agent-card__conversation-messages"
            ref={conversationRef}
            role="log"
            aria-live="polite"
            aria-relevant="additions"
          >
            {conversation.map((message, messageIndex) => (
              <article
                className={`agent-card__conversation-message agent-card__conversation-message--${message.role}`}
                key={messageIndex}
              >
                <span>{message.role === "user" ? "Vous" : "Agent"}</span>
                <ConversationMessageContent
                  message={message}
                  disabled={isDisabled}
                  selectedItemIndexes={messageIndex === lastAgentMessageIndex
                    ? selectedItemIndexes
                    : []
                  }
                  onSelectedItemIndexesChange={
                    messageIndex === lastAgentMessageIndex
                      ? (indexes) => onSelectedItemIndexesChange(
                          agent.id,
                          indexes
                        )
                      : undefined
                  }
                />
              </article>
            ))}
          </div>
        </section>
      )}
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
      <div className="agent-card__actions">
        <button
          className="agent-card__run-button"
          type="button"
          onClick={() => void handleRun()}
          disabled={isRunning || !canRun || isFrozen}
          title={isFrozen
            ? "Cet agent est figé car un agent en aval a déjà été lancé."
            : prerequisiteMessage || (canRun
              ? `${hasSession ? "Relancer" : "Lancer"} ${agent.name}`
              : "Cet agent ne contient aucune instruction."
            )
          }
        >
          <RotateCcw
            aria-hidden="true"
            className={isRunning ? "agent-card__run-icon--running" : undefined}
            size={15}
            strokeWidth={1.8}
          />
          {isRunning
            ? "Exécution..."
            : hasSession ? "Relancer" : "Lancer"
          }
        </button>
      </div>
    </article>
  );
}

export function AgentProjectWorkspace({
  project,
  content,
  onContentRefresh,
  onRunStateChange
}: AgentProjectWorkspaceProps) {
  const tabsId = useId();
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

  useEffect(() => {
    setActiveTab("agents");
  }, [content?.projectId]);

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
      const response = findLastAgentResponse(agent.conversation);

      restoredStates[agent.id] = {
        response,
        selectedItemIndexes: response
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
        response: null,
        selectedItemIndexes: [],
        isInvalidated: true
      };
    }

    return nextStates;
  }

  function handleResponseChange(
    agentId: string,
    response: AgentResponsePayload | null
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
        response,
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

  return (
    <section className="workspace-content workspace-content--project">
      <header className="agent-project__header">
        <p className="eyebrow">Projet {content.engine}</p>
        <h1>{projectName}</h1>
        <div className="agent-project__tabs" role="tablist" aria-label="Contenu du projet">
          <button
            className={`agent-project__tab${
              activeTab === "instructions" ? " agent-project__tab--active" : ""
            }`}
            id={instructionsTabId}
            type="button"
            role="tab"
            aria-controls={instructionsPanelId}
            aria-selected={activeTab === "instructions"}
            onClick={() => setActiveTab("instructions")}
          >
            Instructions projet
          </button>
          <button
            className={`agent-project__tab${
              activeTab === "agents" ? " agent-project__tab--active" : ""
            }`}
            id={agentsTabId}
            type="button"
            role="tab"
            aria-controls={agentsPanelId}
            aria-selected={activeTab === "agents"}
            onClick={() => setActiveTab("agents")}
          >
            {agentsTabLabel}
          </button>
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
              {workflowLevels.map((levelAgents, levelIndex) => (
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
                        agentResultStates
                      );
                      const upstreamAgentResults = prerequisiteMessage
                        ? undefined
                        : upstreamAgents.map((upstreamAgent) => ({
                          agentId: upstreamAgent.id,
                          selectedItemIndexes: agentResultStates[
                            upstreamAgent.id
                          ]?.selectedItemIndexes ?? []
                        }));

                      return (
                        <li
                          className="agent-project__workflow-step"
                          key={`${content.projectId}:${agent.id}`}
                        >
                          <AgentCard
                            agent={agent}
                            upstreamAgentResults={upstreamAgentResults}
                            isInvalidated={
                              agentResultStates[agent.id]?.isInvalidated ?? false
                            }
                            isFrozen={agent.nextAgentIds.some(
                              (nextAgentId) => launchedAgentIds.has(nextAgentId)
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
                          />
                        </li>
                      );
                    })}
                  </ol>
                  {levelIndex < workflowLevels.length - 1 && (
                    <div
                      className="agent-project__workflow-connector"
                      aria-hidden="true"
                    >
                      {levelAgents.some((agent) => agent.nextAgentIds.length > 1)
                        ? <GitBranch size={19} strokeWidth={1.5} />
                        : <ArrowDown size={18} strokeWidth={1.5} />
                      }
                    </div>
                  )}
                </section>
              ))}
            </div>
          )}
        </section>
      )}
    </section>
  );
}
