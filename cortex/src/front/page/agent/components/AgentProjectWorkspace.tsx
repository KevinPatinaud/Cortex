import { useEffect, useId, useRef, useState } from "react";
import { Bot, ChevronDown, RotateCcw } from "lucide-react";
import {
  runAgent,
  type AgentDefinition,
  type AgentProject
} from "../../../services/agentApi.ts";
import type { Project } from "../../../services/projectApi.ts";

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

interface AgentCardProps {
  agent: AgentDefinition;
  index: number;
  projectId: string;
}

interface AgentConversationMessage {
  role: "user" | "agent";
  content: string;
}

function AgentCard({ agent, index, projectId }: AgentCardProps) {
  const additionalInstructionsId = useId();
  const conversationRef = useRef<HTMLDivElement>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [hasSession, setHasSession] = useState(agent.hasSession);
  const [conversation, setConversation] = useState<AgentConversationMessage[]>(
    []
  );
  const [error, setError] = useState("");
  const [additionalInstructions, setAdditionalInstructions] = useState("");
  const canRun = Boolean(agent.prompt.trim());

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
    const submittedInstructions = additionalInstructions.trim();
    setIsRunning(true);
    setError("");

    try {
      const result = await runAgent(
        projectId,
        agent.id,
        submittedInstructions
      );
      const newMessages: AgentConversationMessage[] = [
        ...(submittedInstructions
          ? [{ role: "user" as const, content: submittedInstructions }]
          : []),
        { role: "agent", content: result.answer }
      ];

      setConversation((currentConversation) => [
        ...currentConversation,
        ...newMessages
      ]);
      setHasSession(result.hasSession);
      setAdditionalInstructions("");
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <article className="agent-card">
      <header className="agent-card__header">
        <Bot aria-hidden="true" size={22} strokeWidth={1.7} />
        <div>
          <span>Agent {index + 1}</span>
          <h2>{agent.name}</h2>
        </div>
        {agent.model && (
          <dl className="agent-card__model">
            <dt>Modele</dt>
            <dd>{agent.model}</dd>
          </dl>
        )}
      </header>
      <p className="agent-card__description">
        {agent.description || "Aucune description."}
      </p>
      {agent.reasoningEffort && (
        <dl className="agent-card__configuration">
          <div>
            <dt>Effort de raisonnement</dt>
            <dd>{agent.reasoningEffort}</dd>
          </div>
        </dl>
      )}
      <details className="agent-card__prompt">
        <summary>
          <span>Instructions</span>
          <ChevronDown aria-hidden="true" size={15} strokeWidth={1.7} />
        </summary>
        <pre>{agent.prompt || "Aucune instruction."}</pre>
      </details>
      <div className="agent-card__run-feedback" aria-live="polite">
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
                <pre>{message.content}</pre>
              </article>
            ))}
          </div>
        </section>
      )}
      <div className="agent-card__additional-instructions">
        <label htmlFor={additionalInstructionsId}>Precisions</label>
        <textarea
          id={additionalInstructionsId}
          value={additionalInstructions}
          onChange={(event) => setAdditionalInstructions(event.target.value)}
          placeholder={hasSession
            ? "Ajoutez une precision pour la prochaine relance..."
            : "Ajoutez une precision avant de lancer l'agent..."
          }
          rows={4}
          disabled={isRunning}
        />
      </div>
      <div className="agent-card__actions">
        <button
          className="agent-card__run-button"
          type="button"
          onClick={() => void handleRun()}
          disabled={isRunning || !canRun}
          title={canRun
            ? `${hasSession ? "Relancer" : "Lancer"} ${agent.name}`
            : "Cet agent ne contient aucune instruction."
          }
        >
          <RotateCcw
            aria-hidden="true"
            className={isRunning ? "agent-card__run-icon--running" : undefined}
            size={15}
            strokeWidth={1.8}
          />
          {isRunning
            ? "Execution..."
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
  if (!project || !content) {
    return (
      <section className="workspace-content">
        <p className="eyebrow">Cortex workspace</p>
        <h1>Cortex.</h1>
        <p className="intro">
          Selectionnez un projet dans le bandeau lateral pour afficher ses agents.
        </p>
      </section>
    );
  }

  const projectName = getProjectName(project.directoryPath);

  return (
    <section className="workspace-content workspace-content--project">
      <header className="agent-project__header">
        <p className="eyebrow">Projet {content.engine}</p>
        <h1>{projectName}</h1>
        <p className="intro">
          {content.agents.length} agent{content.agents.length > 1 ? "s" : ""}
          {" "}configure{content.agents.length > 1 ? "s" : ""}.
        </p>
      </header>

      {content.agents.length === 0 ? (
        <p className="agent-project__empty">
          Aucun agent n'est configure dans ce projet.
        </p>
      ) : (
        <div className="agent-project__grid">
          {content.agents.map((agent, index) => (
            <AgentCard
              agent={agent}
              index={index}
              key={`${content.projectId}:${agent.id}`}
              projectId={content.projectId}
            />
          ))}
        </div>
      )}
    </section>
  );
}
