import { useEffect, useId, useRef, useState } from "react";
import { ArrowDown, Bot, ChevronDown, RotateCcw } from "lucide-react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  runAgent,
  type AgentConversationMessage,
  type AgentDefinition,
  type AgentProject,
  type PreviousAgentResult
} from "../../../services/agentApi.ts";
import type { Project } from "../../../services/projectApi.ts";
import {
  parseAgentResponse,
  type AgentResponsePayload
} from "../../../../shared/AgentResponse.ts";

interface AgentProjectWorkspaceProps {
  project: Project | null;
  content: AgentProject | null;
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
      <Markdown remarkPlugins={[remarkGfm]}>{content}</Markdown>
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
                  disabled={disabled || !onSelectedItemIndexesChange}
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
  state: AgentResultState | undefined
): string | null {
  if (!state?.response) {
    return "Exécutez d'abord l'agent précédent.";
  }

  if (state.response.items.length === 0) {
    return "L'agent précédent n'a produit aucun résultat transmissible.";
  }

  if (state.response.items.length === 1) {
    return null;
  }

  if (state.selectedItemIndexes.length === 0) {
    return state.response.isMultiSelectionAllowed === true
      ? "Sélectionnez un ou plusieurs résultats de l'agent précédent."
      : "Sélectionnez un résultat de l'agent précédent.";
  }

  if (
    state.response.isMultiSelectionAllowed !== true &&
    state.selectedItemIndexes.length !== 1
  ) {
    return "Sélectionnez un seul résultat de l'agent précédent.";
  }

  return null;
}

interface AgentCardProps {
  agent: AgentDefinition;
  previousAgentResult?: PreviousAgentResult;
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
}

function AgentCard({
  agent,
  previousAgentResult,
  isInvalidated,
  isFrozen,
  prerequisiteMessage,
  projectId,
  selectedItemIndexes,
  onResponseChange,
  onSelectedItemIndexesChange,
  onRunStart
}: AgentCardProps) {
  const additionalInstructionsId = useId();
  const conversationRef = useRef<HTMLDivElement>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [hasSession, setHasSession] = useState(agent.hasSession);
  const [conversation, setConversation] = useState<AgentConversationMessage[]>(
    agent.conversation
  );
  const [error, setError] = useState("");
  const [additionalInstructions, setAdditionalInstructions] = useState("");
  const canRun = Boolean(agent.prompt.trim()) && !prerequisiteMessage;
  const isUnavailable = !canRun;
  const isDisabled = isUnavailable || isFrozen;

  useEffect(() => {
    setHasSession(agent.hasSession);
    setConversation(agent.conversation);
    setAdditionalInstructions("");
    setError("");
  }, [agent]);

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
    setIsRunning(true);
    onRunStart(agent.id);
    setError("");

    try {
      const result = await runAgent(
        projectId,
        agent.id,
        submittedInstructions,
        previousAgentResult
      );
      setConversation(result.conversation);
      setHasSession(result.hasSession);
      setAdditionalInstructions("");
      onResponseChange(agent.id, parseAgentResponse(result.answer));
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setIsRunning(false);
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
      inert={isDisabled || undefined}
    >
      <header className="agent-card__header">
        <Bot aria-hidden="true" size={22} strokeWidth={1.7} />
        <div>
          <span>Agent {agent.order}</span>
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
            ? "Cet agent est figé pendant l'exécution de l'agent suivant."
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
  content
}: AgentProjectWorkspaceProps) {
  const tabsId = useId();
  const [activeTab, setActiveTab] = useState<"instructions" | "agents">(
    "agents"
  );
  const [agentResultStates, setAgentResultStates] = useState<AgentResultStates>(
    {}
  );
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

    for (const agent of content.agents) {
      restoredStates[agent.id] = {
        response: findLastAgentResponse(agent.conversation),
        selectedItemIndexes: [],
        isInvalidated: false
      };
    }

    setAgentResultStates(restoredStates);
    setLaunchedAgentIds(new Set());
  }, [content]);

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

  const projectName = getProjectName(project.directoryPath);
  const agentsTabLabel = `Workflow (${content.agents.length} agent${
    content.agents.length > 1 ? "s" : ""
  })`;
  const instructionsTabId = `${tabsId}-instructions-tab`;
  const instructionsPanelId = `${tabsId}-instructions-panel`;
  const agentsTabId = `${tabsId}-agents-tab`;
  const agentsPanelId = `${tabsId}-agents-panel`;
  const orderedAgents = [...content.agents].sort(
    (firstAgent, secondAgent) => firstAgent.order - secondAgent.order
  );

  function clearFollowingAgentResults(
    states: AgentResultStates,
    sourceAgentId: string
  ): AgentResultStates {
    const sourceAgent = orderedAgents.find(
      (agent) => agent.id === sourceAgentId
    );
    const nextStates = { ...states };

    if (!sourceAgent) {
      return nextStates;
    }

    for (const agent of orderedAgents) {
      if (agent.order > sourceAgent.order) {
        nextStates[agent.id] = {
          response: null,
          selectedItemIndexes: [],
          isInvalidated: true
        };
      }
    }

    return nextStates;
  }

  function handleResponseChange(
    agentId: string,
    response: AgentResponsePayload | null
  ): void {
    setAgentResultStates((currentStates) => ({
      ...clearFollowingAgentResults(currentStates, agentId),
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
    setAgentResultStates((currentStates) => {
      const currentState = currentStates[agentId];

      if (!currentState) {
        return currentStates;
      }

      return {
        ...clearFollowingAgentResults(currentStates, agentId),
        [agentId]: {
          ...currentState,
          selectedItemIndexes
        }
      };
    });
  }

  function handleRunStart(agentId: string): void {
    setLaunchedAgentIds((currentAgentIds) => {
      const nextAgentIds = new Set(currentAgentIds);
      nextAgentIds.add(agentId);
      return nextAgentIds;
    });
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
            <ol className="agent-project__workflow">
              {orderedAgents.map((agent, index) => {
                const previousAgent = orderedAgents[index - 1];
                const previousAgentState = previousAgent
                  ? agentResultStates[previousAgent.id]
                  : undefined;
                const prerequisiteMessage = previousAgent
                  ? getPrerequisiteMessage(previousAgentState)
                  : null;
                const previousAgentResult = previousAgent &&
                    !prerequisiteMessage
                  ? {
                      agentId: previousAgent.id,
                      selectedItemIndexes:
                        previousAgentState?.selectedItemIndexes ?? []
                    }
                  : undefined;
                const nextAgent = orderedAgents[index + 1];

                return (
                  <li
                    className="agent-project__workflow-step"
                    key={`${content.projectId}:${agent.id}`}
                  >
                    <AgentCard
                      agent={agent}
                      previousAgentResult={previousAgentResult}
                      isInvalidated={
                        agentResultStates[agent.id]?.isInvalidated ?? false
                      }
                      isFrozen={Boolean(
                        nextAgent && launchedAgentIds.has(nextAgent.id)
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
                    />
                    {index < orderedAgents.length - 1 && (
                      <div
                        className="agent-project__workflow-connector"
                        aria-hidden="true"
                      >
                        <ArrowDown size={18} strokeWidth={1.5} />
                      </div>
                    )}
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      )}
    </section>
  );
}
