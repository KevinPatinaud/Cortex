import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Bot,
  Check,
  ChevronRight,
  FileText,
  LoaderCircle,
  Plus,
  RotateCcw,
  Save,
  Settings2,
  Trash2,
  Undo2,
  X
} from "lucide-react";
import {
  saveAgentProject,
  type AgentProject,
  type EditableAgentDefinition
} from "../../../services/agentApi.ts";
import type { Project } from "../../../services/projectApi.ts";

interface AgentProjectEditorProps {
  project: Project;
  content: AgentProject;
  onClose: () => void;
  onSaved: (content: AgentProject) => void;
}

interface DraftAgent extends EditableAgentDefinition {
  clientId: string;
}

interface DeletedAgent {
  agent: DraftAgent;
  index: number;
}

type EditorSection = "agents" | "instructions";

const modelSuggestions = {
  codex: ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"],
  claude: ["sonnet", "opus", "haiku"],
  copilot: []
} as const;

const agentPromptPlaceholder =
  "Décrivez précisément la mission et le résultat attendu de cet agent.";

function createClientId(): string {
  return typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `draft-${Date.now()}-${Math.random()}`;
}

function toDraftAgents(content: AgentProject): DraftAgent[] {
  return content.agents.map((agent) => ({
    clientId: agent.id,
    id: agent.id,
    name: agent.name,
    description: agent.description,
    prompt: agent.prompt,
    ...(agent.model ? { model: agent.model } : {}),
    ...(agent.reasoningEffort
      ? { reasoningEffort: agent.reasoningEffort }
      : {})
  }));
}

function serializeDraft(
  projectName: string,
  instructions: string,
  agents: DraftAgent[]
): string {
  return JSON.stringify({
    projectName,
    instructions,
    agents: agents.map(({ clientId: _clientId, ...agent }) => agent)
  });
}

function getProjectName(project: Project): string {
  return project.directoryPath.split(/[\\/]/).filter(Boolean).at(-1) ||
    project.directoryPath;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Une erreur inattendue est survenue.";
}

export function AgentProjectEditor({
  project,
  content,
  onClose,
  onSaved
}: AgentProjectEditorProps) {
  const [section, setSection] = useState<EditorSection>("agents");
  const [projectName, setProjectName] = useState(() => getProjectName(project));
  const [instructions, setInstructions] = useState(
    content.instructions.content ?? ""
  );
  const [agents, setAgents] = useState<DraftAgent[]>(() =>
    toDraftAgents(content)
  );
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(
    agents[0]?.clientId ?? null
  );
  const [deletedAgent, setDeletedAgent] = useState<DeletedAgent | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [saveMessage, setSaveMessage] = useState("");
  const initialDraft = useRef(serializeDraft(projectName, instructions, agents));

  useEffect(() => {
    const nextInstructions = content.instructions.content ?? "";
    const nextAgents = toDraftAgents(content);
    const nextProjectName = getProjectName(project);
    setProjectName(nextProjectName);
    setInstructions(nextInstructions);
    setAgents(nextAgents);
    setSelectedAgentId((currentId) =>
      nextAgents.some((agent) => agent.clientId === currentId)
        ? currentId
        : nextAgents[0]?.clientId ?? null
    );
    initialDraft.current = serializeDraft(
      nextProjectName,
      nextInstructions,
      nextAgents
    );
  }, [content, project]);

  const selectedAgent = agents.find(
    (agent) => agent.clientId === selectedAgentId
  ) ?? null;
  const currentDraft = useMemo(
    () => serializeDraft(projectName, instructions, agents),
    [agents, instructions, projectName]
  );
  const isDirty = currentDraft !== initialDraft.current;

  function updateSelectedAgent(changes: Partial<DraftAgent>): void {
    if (!selectedAgentId) {
      return;
    }

    setSaveMessage("");
    setAgents((currentAgents) => currentAgents.map((agent) =>
      agent.clientId === selectedAgentId ? { ...agent, ...changes } : agent
    ));
  }

  function addAgent(): void {
    const clientId = createClientId();
    const newAgent: DraftAgent = {
      clientId,
      name: `Nouvel agent ${agents.length + 1}`,
      description: "",
      prompt: ""
    };

    setAgents((currentAgents) => [...currentAgents, newAgent]);
    setSelectedAgentId(clientId);
    setSection("agents");
    setDeletedAgent(null);
    setError("");
    setSaveMessage("");
  }

  function removeSelectedAgent(): void {
    if (!selectedAgent) {
      return;
    }

    const deletedIndex = agents.findIndex(
      (agent) => agent.clientId === selectedAgent.clientId
    );
    const remainingAgents = agents.filter(
      (agent) => agent.clientId !== selectedAgent.clientId
    );
    setDeletedAgent({ agent: selectedAgent, index: deletedIndex });
    setAgents(remainingAgents);
    setSelectedAgentId(
      remainingAgents[Math.min(deletedIndex, remainingAgents.length - 1)]
        ?.clientId ?? null
    );
    setSaveMessage("");
  }

  function restoreDeletedAgent(): void {
    if (!deletedAgent) {
      return;
    }

    setAgents((currentAgents) => {
      const nextAgents = [...currentAgents];
      nextAgents.splice(deletedAgent.index, 0, deletedAgent.agent);
      return nextAgents;
    });
    setSelectedAgentId(deletedAgent.agent.clientId);
    setDeletedAgent(null);
  }

  function requestClose(): void {
    if (
      isDirty &&
      !window.confirm("Quitter le mode édition et abandonner les modifications ?")
    ) {
      return;
    }

    onClose();
  }

  async function handleSave(): Promise<void> {
    if (!projectName.trim()) {
      setError("Le nom du projet est obligatoire.");
      return;
    }

    const invalidAgent = agents.find(
      (agent) => !agent.name.trim() || !agent.prompt.trim()
    );

    if (invalidAgent) {
      setSection("agents");
      setSelectedAgentId(invalidAgent.clientId);
      setError("Chaque agent doit avoir un nom et des instructions.");
      return;
    }

    setIsSaving(true);
    setError("");
    setSaveMessage("");

    try {
      const savedContent = await saveAgentProject(content.projectId, {
        name: projectName.trim(),
        engine: content.engine,
        instructions,
        agents: agents.map(({ clientId: _clientId, ...agent }) => ({
          ...agent,
          name: agent.name.trim(),
          description: agent.description.trim(),
          prompt: agent.prompt.trim(),
          ...(agent.model?.trim() ? { model: agent.model.trim() } : { model: undefined }),
          ...(agent.reasoningEffort?.trim()
            ? { reasoningEffort: agent.reasoningEffort.trim() }
            : { reasoningEffort: undefined })
        }))
      });
      setDeletedAgent(null);
      setSaveMessage("Projet enregistré — le workflow est à jour.");
      onSaved(savedContent);
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setIsSaving(false);
    }
  }

  const suggestions = modelSuggestions[content.engine];

  return (
    <section className="workspace-content workspace-content--editor">
      <header className="project-editor__topbar">
        <div className="project-editor__heading">
          <span className="project-editor__mode-pill">
            <Settings2 aria-hidden="true" size={13} />
            Mode édition
          </span>
          <div>
            <p className="eyebrow">Atelier {content.engine}</p>
            <label className="project-editor__name-field">
              <span>Nom du projet</span>
              <input
                value={projectName}
                onChange={(event) => {
                  setProjectName(event.target.value);
                  setSaveMessage("");
                }}
                disabled={isSaving}
                aria-label="Nom du projet"
              />
            </label>
          </div>
        </div>
        <div className="project-editor__topbar-actions">
          <span className={`project-editor__draft-status${isDirty ? " project-editor__draft-status--dirty" : ""}`}>
            <i aria-hidden="true" />
            {isDirty ? "Brouillon modifié" : "À jour"}
          </span>
          <button
            className="project-editor__exit"
            type="button"
            onClick={requestClose}
            disabled={isSaving}
          >
            <X aria-hidden="true" size={16} />
            Quitter l’édition
          </button>
          <button
            className="project-editor__save"
            type="button"
            onClick={() => void handleSave()}
            disabled={isSaving || !isDirty}
          >
            {isSaving ? (
              <LoaderCircle aria-hidden="true" className="spin" size={16} />
            ) : (
              <Save aria-hidden="true" size={16} />
            )}
            {isSaving ? "Enregistrement..." : "Enregistrer"}
          </button>
        </div>
      </header>

      <div className="project-editor__summary">
        <div>
          <span>Composition</span>
          <strong>{agents.length} agent{agents.length > 1 ? "s" : ""}</strong>
        </div>
        <div>
          <span>Moteur</span>
          <strong>{content.engine}</strong>
        </div>
        <div>
          <span>Instructions</span>
          <strong>{instructions.trim() ? "Configurées" : "À compléter"}</strong>
        </div>
        <div className="project-editor__flow-preview" aria-label="Aperçu du workflow">
          {agents.slice(0, 5).map((agent, index) => (
            <span key={agent.clientId}>
              <i>{index + 1}</i>
              {agent.name || "Sans nom"}
              {index < Math.min(agents.length, 5) - 1 && (
                <ArrowRight aria-hidden="true" size={13} />
              )}
            </span>
          ))}
          {agents.length > 5 && <em>+{agents.length - 5}</em>}
        </div>
      </div>

      <nav className="project-editor__sections" aria-label="Sections du projet">
        <button
          className={section === "agents" ? "is-active" : undefined}
          type="button"
          onClick={() => setSection("agents")}
        >
          <Bot aria-hidden="true" size={16} />
          Agents
          <span>{agents.length}</span>
        </button>
        <button
          className={section === "instructions" ? "is-active" : undefined}
          type="button"
          onClick={() => setSection("instructions")}
        >
          <FileText aria-hidden="true" size={16} />
          Instructions projet
        </button>
      </nav>

      {section === "agents" ? (
        <div className="project-editor__canvas">
          <aside className="agent-library">
            <header>
              <div>
                <span>Bibliothèque</span>
                <strong>Agents du projet</strong>
              </div>
              <button type="button" onClick={addAgent} disabled={isSaving}>
                <Plus aria-hidden="true" size={16} />
                Ajouter
              </button>
            </header>

            {agents.length > 0 ? (
              <ol className="agent-library__list">
                {agents.map((agent, index) => (
                  <li key={agent.clientId}>
                    <button
                      className={selectedAgentId === agent.clientId ? "is-selected" : undefined}
                      type="button"
                      onClick={() => setSelectedAgentId(agent.clientId)}
                    >
                      <span className="agent-library__index">{String(index + 1).padStart(2, "0")}</span>
                      <span className="agent-library__identity">
                        <strong>{agent.name || "Agent sans nom"}</strong>
                        <small>{agent.description || "Mission à préciser"}</small>
                      </span>
                      {!agent.id && <span className="agent-library__new">Nouveau</span>}
                      <ChevronRight aria-hidden="true" size={15} />
                    </button>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="agent-library__empty">
                <Bot aria-hidden="true" size={25} />
                <strong>Le workflow est vide</strong>
                <p>Créez un premier agent pour donner vie à ce projet.</p>
                <button type="button" onClick={addAgent}>
                  <Plus aria-hidden="true" size={15} /> Premier agent
                </button>
              </div>
            )}
          </aside>

          <section className="agent-inspector">
            {selectedAgent ? (
              <>
                <header className="agent-inspector__header">
                  <span className="agent-inspector__avatar" aria-hidden="true">
                    <Bot size={23} />
                  </span>
                  <div>
                    <span>Configuration de l’agent</span>
                    <h2>{selectedAgent.name || "Agent sans nom"}</h2>
                  </div>
                  <button
                    className="agent-inspector__delete"
                    type="button"
                    onClick={removeSelectedAgent}
                    disabled={isSaving}
                  >
                    <Trash2 aria-hidden="true" size={16} />
                    Supprimer
                  </button>
                </header>

                <div className="agent-inspector__form">
                  <div className="agent-inspector__row">
                    <label className="editor-field">
                      <span>Nom</span>
                      <input
                        value={selectedAgent.name}
                        onChange={(event) => updateSelectedAgent({ name: event.target.value })}
                        placeholder="Architecte logiciel"
                        disabled={isSaving}
                      />
                    </label>
                    <label className="editor-field">
                      <span>Description courte</span>
                      <input
                        value={selectedAgent.description}
                        onChange={(event) => updateSelectedAgent({ description: event.target.value })}
                        placeholder="Analyse et structure la solution"
                        disabled={isSaving}
                      />
                    </label>
                  </div>

                  <div className="agent-inspector__row agent-inspector__row--compact">
                    <label className="editor-field">
                      <span>Modèle <em>optionnel</em></span>
                      <input
                        value={selectedAgent.model ?? ""}
                        onChange={(event) => updateSelectedAgent({ model: event.target.value })}
                        placeholder="Modèle par défaut"
                        list="cortex-model-suggestions"
                        disabled={isSaving}
                      />
                      {suggestions.length > 0 && (
                        <datalist id="cortex-model-suggestions">
                          {suggestions.map((model) => <option value={model} key={model} />)}
                        </datalist>
                      )}
                    </label>
                    <label className="editor-field">
                      <span>Effort de raisonnement <em>optionnel</em></span>
                      <select
                        value={selectedAgent.reasoningEffort ?? ""}
                        onChange={(event) => updateSelectedAgent({ reasoningEffort: event.target.value })}
                        disabled={isSaving}
                      >
                        <option value="">Par défaut</option>
                        <option value="low">Faible</option>
                        <option value="medium">Moyen</option>
                        <option value="high">Élevé</option>
                        <option value="xhigh">Très élevé</option>
                      </select>
                    </label>
                  </div>

                  <label className="editor-field editor-field--prompt">
                    <span>Mission et instructions</span>
                    <textarea
                      value={selectedAgent.prompt}
                      onChange={(event) => updateSelectedAgent({ prompt: event.target.value })}
                      placeholder={agentPromptPlaceholder}
                      rows={12}
                      disabled={isSaving}
                    />
                    <small>
                      Soyez explicite sur le périmètre de l’agent et le livrable attendu.
                    </small>
                  </label>
                </div>
              </>
            ) : (
              <div className="agent-inspector__placeholder">
                <Bot aria-hidden="true" size={30} />
                <h2>Sélectionnez un agent</h2>
                <p>Ses paramètres apparaîtront ici.</p>
              </div>
            )}
          </section>
        </div>
      ) : (
        <section className="instructions-editor">
          <header>
            <span className="instructions-editor__icon" aria-hidden="true">
              <FileText size={22} />
            </span>
            <div>
              <span>Contexte partagé</span>
              <h2>{content.instructions.fileName}</h2>
              <p>Ces instructions sont transmises à l’ensemble du projet.</p>
            </div>
          </header>
          <label className="editor-field editor-field--prompt">
            <span>Contenu Markdown</span>
            <textarea
              value={instructions}
              onChange={(event) => {
                setInstructions(event.target.value);
                setSaveMessage("");
              }}
              rows={22}
              placeholder="# Contexte du projet"
              disabled={isSaving}
            />
          </label>
        </section>
      )}

      {(error || saveMessage || deletedAgent) && (
        <div className={`project-editor__toast${error ? " project-editor__toast--error" : ""}`} role="status">
          {error ? (
            <span>{error}</span>
          ) : deletedAgent ? (
            <>
              <span>« {deletedAgent.agent.name} » sera supprimé à l’enregistrement.</span>
              <button type="button" onClick={restoreDeletedAgent}>
                <Undo2 aria-hidden="true" size={14} /> Annuler
              </button>
            </>
          ) : (
            <>
              <Check aria-hidden="true" size={15} />
              <span>{saveMessage}</span>
            </>
          )}
        </div>
      )}
    </section>
  );
}
