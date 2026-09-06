import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  Bot,
  Check,
  ChevronRight,
  FileText,
  LoaderCircle,
  MoreHorizontal,
  Plus,
  RotateCcw,
  Save,
  ScanSearch,
  Settings2,
  Sparkles,
  Trash2,
  Undo2,
  X
} from "lucide-react";
import {
  improveAgent,
  improveInstructions,
  saveAgentProject,
  type AgentProject,
  type ImproveProjectAgent,
  type ProjectReviewFinding
} from "../../../services/agentApi.ts";
import {
  deleteProjectDirectory,
  type Project
} from "../../../services/projectApi.ts";
import { useTranslation } from "../../../i18n.tsx";
import { ConfirmationDialog } from "../../project_manager/components/ConfirmationDialog.tsx";
import { MarkdownEditor } from "./MarkdownEditor.tsx";
import { ProjectReviewDialog } from "./ProjectReviewDialog.tsx";
import { readProjectDraft, removeProjectDraft, saveProjectDraft, type DraftAgent } from "./projectDraft.ts";

interface AgentProjectEditorProps {
  project: Project;
  content: AgentProject;
  requiresInitialSave: boolean;
  onClose: () => void;
  onSaved: (content: AgentProject) => void;
  onDeleted: (projectId: string) => void;
  onDirtyChange: (dirty: boolean) => void;
}

interface DeletedAgent {
  agent: DraftAgent;
  index: number;
}

type EditorSection = "agents" | "instructions";

interface ProjectContent {
  instructions: string;
  agents: ImproveProjectAgent[];
}

interface AgentImprovementPreview {
  original: ImproveProjectAgent;
  improved: ImproveProjectAgent;
}

interface InstructionsImprovementPreview {
  original: string;
  improved: string;
}

const modelSuggestions = {
  codex: ["gpt-5.6-sol", "gpt-5.6-terra", "gpt-5.6-luna"],
  claude: ["sonnet", "opus", "haiku"],
  copilot: []
} as const;

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

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export function AgentProjectEditor({
  project,
  content,
  requiresInitialSave,
  onClose,
  onSaved,
  onDeleted,
  onDirtyChange
}: AgentProjectEditorProps) {
  const { t } = useTranslation();
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
  const [isImprovingAgent, setIsImprovingAgent] = useState(false);
  const [agentImprovement, setAgentImprovement] =
    useState<AgentImprovementPreview | null>(null);
  const [isImprovingInstructions, setIsImprovingInstructions] = useState(false);
  const [instructionsImprovement, setInstructionsImprovement] =
    useState<InstructionsImprovementPreview | null>(null);
  const [isReviewingProject, setIsReviewingProject] = useState(false);
  const [isProjectReviewOpen, setIsProjectReviewOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isDeleteDialogOpen, setIsDeleteDialogOpen] = useState(false);
  const [error, setError] = useState("");
  const [saveMessage, setSaveMessage] = useState("");
  const initialDraft = useRef(serializeDraft(projectName, instructions, agents));
  const [recovery, setRecovery] = useState(() => readProjectDraft(project.id));
  const [draftStorageAvailable, setDraftStorageAvailable] = useState(true);

  useEffect(() => {
    if (!agentImprovement && !instructionsImprovement) {
      return;
    }

    function closeOnEscape(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        setAgentImprovement(null);
        setInstructionsImprovement(null);
      }
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [agentImprovement, instructionsImprovement]);

  const selectedAgent = agents.find(
    (agent) => agent.clientId === selectedAgentId
  ) ?? null;
  const currentDraft = useMemo(
    () => serializeDraft(projectName, instructions, agents),
    [agents, instructions, projectName]
  );
  const isDirty = requiresInitialSave || currentDraft !== initialDraft.current;
  useEffect(() => {
    onDirtyChange(isDirty);
    return () => onDirtyChange(false);
  }, [isDirty, onDirtyChange]);

  useEffect(() => {
    if (isDirty) {
      setDraftStorageAvailable(saveProjectDraft(project.id, initialDraft.current, {
        projectName, instructions, agents
      }));
    } else if (!recovery) {
      removeProjectDraft(project.id);
    }
  }, [project.id, projectName, instructions, agents, isDirty, recovery]);

  useEffect(() => {
    if (!isDirty) return;
    const persist = () => saveProjectDraft(project.id, initialDraft.current, {
      projectName, instructions, agents
    });
    const beforeUnload = (event: BeforeUnloadEvent) => {
      persist();
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    window.addEventListener("pagehide", persist);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      window.removeEventListener("pagehide", persist);
    };
  }, [project.id, projectName, instructions, agents, isDirty]);

  const isImproving = isImprovingAgent ||
    isImprovingInstructions ||
    isReviewingProject;

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
      name: t("editor.newAgent", { number: agents.length + 1 }),
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

  async function handleImproveAgent(): Promise<void> {
    if (!selectedAgent) {
      return;
    }

    const projectContext: ProjectContent = {
      instructions,
      agents: agents.map((agent) => ({
        key: agent.clientId,
        name: agent.name,
        description: agent.description,
        prompt: agent.prompt
      }))
    };
    const original: ImproveProjectAgent = {
      key: selectedAgent.clientId,
      name: selectedAgent.name,
      description: selectedAgent.description,
      prompt: selectedAgent.prompt
    };
    setIsImprovingAgent(true);
    setError("");
    setSaveMessage("");

    try {
      const improved = await improveAgent(content.projectId, {
        targetAgentKey: selectedAgent.clientId,
        ...projectContext
      });
      setAgentImprovement({ original, improved });
    } catch (requestError) {
      setError(getErrorMessage(requestError, t("editor.improveError")));
    } finally {
      setIsImprovingAgent(false);
    }
  }

  function applyAgentImprovement(): void {
    if (
      !agentImprovement ||
      !agentImprovement.improved.name.trim() ||
      !agentImprovement.improved.prompt.trim()
    ) {
      return;
    }

    const improvement = agentImprovement.improved;
    setAgents((currentAgents) => currentAgents.map((agent) => {
      return agent.clientId === improvement.key
        ? {
          ...agent,
          name: improvement.name.trim(),
          description: improvement.description.trim(),
          prompt: improvement.prompt.trim()
        }
        : agent;
    }));
    setSelectedAgentId(improvement.key);
    setSection("agents");
    setAgentImprovement(null);
    setSaveMessage(t("editor.improved"));
  }

  async function handleImproveInstructions(): Promise<void> {
    setIsImprovingInstructions(true);
    setError("");
    setSaveMessage("");

    try {
      const result = await improveInstructions(content.projectId, {
        instructions,
        agents: agents.map((agent) => ({
          key: agent.clientId,
          name: agent.name,
          description: agent.description,
          prompt: agent.prompt
        }))
      });
      setInstructionsImprovement({
        original: instructions,
        improved: result.instructions
      });
    } catch (requestError) {
      setError(getErrorMessage(
        requestError,
        t("editor.instructionsImproveError")
      ));
    } finally {
      setIsImprovingInstructions(false);
    }
  }

  function applyInstructionsImprovement(): void {
    if (!instructionsImprovement?.improved.trim()) {
      return;
    }

    setInstructions(instructionsImprovement.improved.trim());
    setSection("instructions");
    setInstructionsImprovement(null);
    setSaveMessage(t("editor.instructionsImproved"));
  }

  function openReviewFinding(finding: ProjectReviewFinding): void {
    if (finding.scope === "agent" && finding.agentKey) {
      setSelectedAgentId(finding.agentKey);
      setSection("agents");
    } else if (finding.scope === "instructions") {
      setSection("instructions");
    } else {
      return;
    }

    setIsProjectReviewOpen(false);
  }

  function requestClose(): void {
    if (
      (isDirty || recovery !== null) &&
      !window.confirm(t("editor.leaveConfirm"))
    ) {
      return;
    }

    removeProjectDraft(project.id);
    onClose();
  }

  async function handleSave(): Promise<void> {
    if (!projectName.trim()) {
      setError(t("editor.nameRequired"));
      return;
    }

    const invalidAgent = agents.find(
      (agent) => !agent.name.trim() || !agent.prompt.trim()
    );

    if (invalidAgent) {
      setSection("agents");
      setSelectedAgentId(invalidAgent.clientId);
      setError(t("editor.agentRequired"));
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
      removeProjectDraft(project.id);
      setSaveMessage(t("editor.saved"));
      onSaved(savedContent);
      onClose();
    } catch (requestError) {
      setError(getErrorMessage(requestError, t("common.unexpectedError")));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDeleteProject(): Promise<void> {
    setIsDeleting(true);
    setError("");

    try {
      await deleteProjectDirectory(project.directoryPath);
      removeProjectDraft(project.id);
      setIsDeleteDialogOpen(false);
      onDeleted(project.id);
    } catch (requestError) {
      setError(getErrorMessage(requestError, t("common.unexpectedError")));
    } finally {
      setIsDeleting(false);
    }
  }

  const suggestions = modelSuggestions[content.engine];

  return (
    <main id="main-content" tabIndex={-1} className="workspace-content workspace-content--editor">
      {recovery && (
        <section className="project-editor__recovery" aria-label={t("editor.draftRecovery")}>
          <div>
            <strong>{t("editor.draftRecovery")}</strong>
            <p>{t(recovery.base === initialDraft.current
              ? "editor.draftRecoveryHelp"
              : "editor.draftRecoveryConflict")}</p>
          </div>
          <button type="button" onClick={() => {
            setProjectName(recovery.value.projectName);
            setInstructions(recovery.value.instructions);
            setAgents(recovery.value.agents);
            setSelectedAgentId(recovery.value.agents[0]?.clientId ?? null);
            setRecovery(null);
            setSaveMessage(t("editor.draftRestored"));
          }}>{t("editor.restoreDraft")}</button>
          <button type="button" onClick={() => {
            if (!window.confirm(t("editor.discardDraftConfirm"))) return;
            removeProjectDraft(project.id);
            setRecovery(null);
          }}>{t("editor.discardDraft")}</button>
        </section>
      )}
      {!draftStorageAvailable && (
        <p className="project-editor__storage-warning" role="status">{t("editor.draftStorageUnavailable")}</p>
      )}
      <header className="project-editor__topbar">
        <div className="project-editor__heading">
          <span className="project-editor__mode-pill">
            <Settings2 aria-hidden="true" size={13} />
            {t("editor.mode")}
          </span>
          <div>
            <p className="eyebrow">{t("editor.workshop", { engine: content.engine })}</p>
            <label className="project-editor__name-field">
              <span>{t("creation.projectName")}</span>
              <input
                value={projectName}
                onChange={(event) => {
                  setProjectName(event.target.value);
                  setSaveMessage("");
                }}
                disabled={isSaving || isImproving}
                aria-label={t("creation.projectName")}
              />
            </label>
          </div>
        </div>
        <div className="project-editor__topbar-actions">
          <span className={`project-editor__draft-status${isDirty ? " project-editor__draft-status--dirty" : ""}`}>
            <i aria-hidden="true" />
            {isDirty ? t("editor.draftChanged") : t("editor.upToDate")}
          </span>
          <button
            className="project-editor__review"
            type="button"
            onClick={() => setIsProjectReviewOpen(true)}
            disabled={
              isSaving ||
              isDeleting ||
              isImprovingAgent ||
              isImprovingInstructions ||
              !projectName.trim()
            }
          >
            {isReviewingProject ? (
              <LoaderCircle aria-hidden="true" className="spin" size={16} />
            ) : (
              <ScanSearch aria-hidden="true" size={16} />
            )}
            {t("editor.reviewProject")}
          </button>
          <button
            className="project-editor__save"
            type="button"
            onClick={() => void handleSave()}
            disabled={isSaving || isImproving || !isDirty}
          >
            {isSaving ? (
              <LoaderCircle aria-hidden="true" className="spin" size={16} />
            ) : (
              <Save aria-hidden="true" size={16} />
            )}
            {isSaving ? t("common.saving") : t("editor.saveAndClose")}
          </button>
          <button
            className="project-editor__exit"
            type="button"
            onClick={requestClose}
            disabled={isSaving || isImproving}
          >
            <X aria-hidden="true" size={16} />
            {t("editor.leave")}
          </button>
          <details className="project-editor__more">
            <summary title={t("common.moreActions")} aria-label={t("common.moreActions")}>
              <MoreHorizontal aria-hidden="true" size={18} />
            </summary>
            <div>
              <button
                className="project-editor__delete"
                type="button"
                onClick={() => {
                  setError("");
                  setIsDeleteDialogOpen(true);
                }}
                disabled={isSaving || isDeleting || isImproving}
              >
                <Trash2 aria-hidden="true" size={16} />
                {t("editor.deleteProject")}
              </button>
            </div>
          </details>
        </div>
      </header>

      <div className="project-editor__summary">
        <div>
          <span>{t("editor.composition")}</span>
          <strong>{agents.length} {t(agents.length === 1 ? "workspace.agentSingular" : "workspace.agentPlural")}</strong>
        </div>
        <div>
          <span>{t("creation.engine")}</span>
          <strong>{content.engine}</strong>
        </div>
        <div>
          <span>{t("workspace.instructionsTab")}</span>
          <strong>{instructions.trim() ? t("editor.configured") : t("editor.toComplete")}</strong>
        </div>
        <div className="project-editor__flow-preview" aria-label={t("editor.workflowPreview")}>
          {agents.slice(0, 5).map((agent, index) => (
            <span key={agent.clientId}>
              <i>{index + 1}</i>
              {agent.name || t("editor.unnamed")}
              {index < Math.min(agents.length, 5) - 1 && (
                <ArrowRight aria-hidden="true" size={13} />
              )}
            </span>
          ))}
          {agents.length > 5 && <em>+{agents.length - 5}</em>}
        </div>
      </div>

      <nav className="project-editor__sections" aria-label={t("editor.sections")}>
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
          {t("workspace.instructionsTab")}
        </button>
      </nav>

      {section === "agents" ? (
        <div className="project-editor__canvas">
          <aside className="agent-library">
            <header>
              <div>
                <span>{t("editor.library")}</span>
                <strong>{t("editor.projectAgents")}</strong>
              </div>
              <button
                type="button"
                onClick={addAgent}
                disabled={isSaving || isImproving}
              >
                <Plus aria-hidden="true" size={16} />
                {t("common.add")}
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
                        <strong>{agent.name || t("editor.unnamedAgent")}</strong>
                        <small>{agent.description || t("editor.missionMissing")}</small>
                      </span>
                      {!agent.id && <span className="agent-library__new">{t("editor.new")}</span>}
                      <ChevronRight aria-hidden="true" size={15} />
                    </button>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="agent-library__empty">
                <Bot aria-hidden="true" size={25} />
                <strong>{t("editor.emptyWorkflow")}</strong>
                <p>{t("editor.firstAgentHelp")}</p>
                <button type="button" onClick={addAgent}>
                  <Plus aria-hidden="true" size={15} /> {t("editor.firstAgent")}
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
                    <span>{t("editor.agentConfiguration")}</span>
                    <h2>{selectedAgent.name || t("editor.unnamedAgent")}</h2>
                  </div>
                  <button
                    className="agent-inspector__improve"
                    type="button"
                    onClick={() => void handleImproveAgent()}
                    disabled={isSaving || isDeleting || isImproving}
                  >
                    {isImprovingAgent ? (
                      <LoaderCircle aria-hidden="true" className="spin" size={16} />
                    ) : (
                      <Sparkles aria-hidden="true" size={16} />
                    )}
                    {isImprovingAgent
                      ? t("editor.improving")
                      : t("editor.improveWithAi")}
                  </button>
                  <button
                    className="agent-inspector__delete"
                    type="button"
                    onClick={removeSelectedAgent}
                    disabled={isSaving || isImproving}
                  >
                    <Trash2 aria-hidden="true" size={16} />
                    {t("common.delete")}
                  </button>
                </header>

                <div className="agent-inspector__form">
                  <div className="agent-inspector__row">
                    <label className="editor-field">
                      <span>{t("editor.name")}</span>
                      <input
                        value={selectedAgent.name}
                        onChange={(event) => updateSelectedAgent({ name: event.target.value })}
                        placeholder={t("editor.namePlaceholder")}
                        disabled={isSaving || isImproving}
                      />
                    </label>
                    <label className="editor-field">
                      <span>{t("editor.shortDescription")}</span>
                      <input
                        value={selectedAgent.description}
                        onChange={(event) => updateSelectedAgent({ description: event.target.value })}
                        placeholder={t("editor.descriptionPlaceholder")}
                        disabled={isSaving || isImproving}
                      />
                    </label>
                  </div>

                  <div className="agent-inspector__row agent-inspector__row--compact">
                    <label className="editor-field">
                      <span>{t("agent.model")} <em>{t("editor.optional")}</em></span>
                      <input
                        value={selectedAgent.model ?? ""}
                        onChange={(event) => updateSelectedAgent({ model: event.target.value })}
                        placeholder={t("editor.defaultModel")}
                        list="cortex-model-suggestions"
                        disabled={isSaving || isImproving}
                      />
                      {suggestions.length > 0 && (
                        <datalist id="cortex-model-suggestions">
                          {suggestions.map((model) => <option value={model} key={model} />)}
                        </datalist>
                      )}
                    </label>
                    <label className="editor-field">
                      <span>{t("editor.reasoningEffort")} <em>{t("editor.optional")}</em></span>
                      <select
                        value={selectedAgent.reasoningEffort ?? ""}
                        onChange={(event) => updateSelectedAgent({ reasoningEffort: event.target.value })}
                        disabled={isSaving || isImproving}
                      >
                        <option value="">{t("editor.default")}</option>
                        <option value="low">{t("editor.low")}</option>
                        <option value="medium">{t("editor.medium")}</option>
                        <option value="high">{t("editor.high")}</option>
                        <option value="xhigh">{t("editor.xhigh")}</option>
                      </select>
                    </label>
                  </div>

                  <MarkdownEditor
                    value={selectedAgent.prompt}
                    onChange={(prompt) => updateSelectedAgent({ prompt })}
                    label={t("editor.mission")}
                    placeholder={t("editor.promptPlaceholder")}
                    help={t("editor.promptHelp")}
                    rows={12}
                    disabled={isSaving || isImproving}
                  />
                </div>
              </>
            ) : (
              <div className="agent-inspector__placeholder">
                <Bot aria-hidden="true" size={30} />
                <h2>{t("editor.selectAgent")}</h2>
                <p>{t("editor.settingsHere")}</p>
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
              <span>{t("editor.sharedContext")}</span>
              <h2>{content.instructions.fileName}</h2>
              <p>{t("editor.sharedHelp")}</p>
            </div>
            <button
              className="agent-inspector__improve"
              type="button"
              onClick={() => void handleImproveInstructions()}
              disabled={isSaving || isDeleting || isImproving}
            >
              {isImprovingInstructions ? (
                <LoaderCircle aria-hidden="true" className="spin" size={16} />
              ) : (
                <Sparkles aria-hidden="true" size={16} />
              )}
              {isImprovingInstructions
                ? t("editor.improving")
                : t("editor.improveWithAi")}
            </button>
          </header>
          <MarkdownEditor
            value={instructions}
            onChange={(nextInstructions) => {
              setInstructions(nextInstructions);
              setSaveMessage("");
            }}
            label={t("editor.markdown")}
            rows={22}
            placeholder={t("editor.contextPlaceholder")}
            disabled={isSaving || isImproving}
          />
        </section>
      )}

      {(error || saveMessage || deletedAgent) && (
        <div className={`project-editor__toast${error ? " project-editor__toast--error" : ""}`} role="status">
          {error ? (
            <span>{error}</span>
          ) : deletedAgent ? (
            <>
              <span>{t("editor.deletedOnSave", { name: deletedAgent.agent.name })}</span>
              <button type="button" onClick={restoreDeletedAgent}>
                <Undo2 aria-hidden="true" size={14} /> {t("common.cancel")}
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

      {isDeleteDialogOpen && (
        <ConfirmationDialog
          variant="delete"
          title={t("project.deleteTitle")}
          description={t("project.deleteDescription")}
          projectName={getProjectName(project)}
          confirmLabel={t("common.delete")}
          pendingLabel={t("project.deleting")}
          isPending={isDeleting}
          error={error || undefined}
          onCancel={() => {
            if (!isDeleting) {
              setError("");
              setIsDeleteDialogOpen(false);
            }
          }}
          onConfirm={() => void handleDeleteProject()}
        />
      )}

      <ProjectReviewDialog
        key={content.projectId}
        projectId={content.projectId}
        projectName={projectName}
        instructions={instructions}
        agents={agents}
        isOpen={isProjectReviewOpen}
        onClose={() => setIsProjectReviewOpen(false)}
        onBusyChange={setIsReviewingProject}
        onOpenFinding={openReviewFinding}
      />

      {agentImprovement && (
        <div
          className="agent-improvement__backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setAgentImprovement(null);
            }
          }}
        >
          <section
            className="agent-improvement"
            role="dialog"
            aria-modal="true"
            aria-labelledby="agent-improvement-title"
          >
            <header>
              <span className="agent-improvement__icon" aria-hidden="true">
                <Sparkles size={21} />
              </span>
              <div>
                <span>{t("editor.aiSuggestion")}</span>
                <h2 id="agent-improvement-title">
                  {t("editor.improvementTitle")}
                </h2>
                <p>{t("editor.improvementHelp")}</p>
              </div>
              <button
                className="agent-improvement__close"
                type="button"
                aria-label={t("common.close")}
                onClick={() => setAgentImprovement(null)}
              >
                <X aria-hidden="true" size={18} />
              </button>
            </header>

            <div className="agent-improvement__comparison">
              <section className="agent-improvement__version">
                <h3>{t("editor.currentAgent")}</h3>
                <label className="editor-field">
                  <span>{t("editor.name")}</span>
                  <input value={agentImprovement.original.name} readOnly />
                </label>
                <label className="editor-field">
                  <span>{t("editor.shortDescription")}</span>
                  <input value={agentImprovement.original.description} readOnly />
                </label>
                <label className="editor-field">
                  <span>{t("editor.mission")}</span>
                  <textarea value={agentImprovement.original.prompt} rows={11} readOnly />
                </label>
              </section>

              <section className="agent-improvement__version agent-improvement__version--improved">
                <h3>{t("editor.improvedAgent")}</h3>
                <label className="editor-field">
                    <span>{t("editor.name")}</span>
                    <input
                      value={agentImprovement.improved.name}
                      onChange={(event) => setAgentImprovement({
                        ...agentImprovement,
                        improved: { ...agentImprovement.improved, name: event.target.value }
                      })}
                    />
                </label>
                <label className="editor-field">
                    <span>{t("editor.shortDescription")}</span>
                    <input
                      value={agentImprovement.improved.description}
                      onChange={(event) => setAgentImprovement({
                        ...agentImprovement,
                        improved: { ...agentImprovement.improved, description: event.target.value }
                      })}
                    />
                </label>
                <label className="editor-field">
                    <span>{t("editor.mission")}</span>
                    <textarea
                      value={agentImprovement.improved.prompt}
                      onChange={(event) => setAgentImprovement({
                        ...agentImprovement,
                        improved: { ...agentImprovement.improved, prompt: event.target.value }
                      })}
                      rows={11}
                    />
                </label>
              </section>
            </div>

            <footer>
              <button type="button" onClick={() => setAgentImprovement(null)}>
                {t("common.cancel")}
              </button>
              <button
                className="agent-improvement__apply"
                type="button"
                onClick={applyAgentImprovement}
                disabled={!agentImprovement.improved.name.trim() || !agentImprovement.improved.prompt.trim()}
              >
                <Check aria-hidden="true" size={15} />
                {t("editor.useImprovedAgent")}
              </button>
            </footer>
          </section>
        </div>
      )}

      {instructionsImprovement && (
        <div
          className="agent-improvement__backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) {
              setInstructionsImprovement(null);
            }
          }}
        >
          <section
            className="agent-improvement"
            role="dialog"
            aria-modal="true"
            aria-labelledby="instructions-improvement-title"
          >
            <header>
              <span className="agent-improvement__icon" aria-hidden="true">
                <Sparkles size={21} />
              </span>
              <div>
                <span>{t("editor.aiSuggestion")}</span>
                <h2 id="instructions-improvement-title">
                  {t("editor.instructionsImprovementTitle")}
                </h2>
                <p>{t("editor.instructionsImprovementHelp")}</p>
              </div>
              <button
                className="agent-improvement__close"
                type="button"
                aria-label={t("common.close")}
                onClick={() => setInstructionsImprovement(null)}
              >
                <X aria-hidden="true" size={18} />
              </button>
            </header>

            <div className="agent-improvement__comparison">
              <section className="agent-improvement__version">
                <h3>{t("editor.currentInstructions")}</h3>
                <label className="editor-field">
                  <span>{t("editor.markdown")}</span>
                  <textarea
                    value={instructionsImprovement.original}
                    rows={18}
                    readOnly
                  />
                </label>
              </section>

              <section className="agent-improvement__version agent-improvement__version--improved">
                <h3>{t("editor.improvedInstructions")}</h3>
                <label className="editor-field">
                  <span>{t("editor.markdown")}</span>
                  <textarea
                    value={instructionsImprovement.improved}
                    onChange={(event) => setInstructionsImprovement({
                      ...instructionsImprovement,
                      improved: event.target.value
                    })}
                    rows={18}
                  />
                </label>
              </section>
            </div>

            <footer>
              <button
                type="button"
                onClick={() => setInstructionsImprovement(null)}
              >
                {t("common.cancel")}
              </button>
              <button
                className="agent-improvement__apply"
                type="button"
                onClick={applyInstructionsImprovement}
                disabled={!instructionsImprovement.improved.trim()}
              >
                <Check aria-hidden="true" size={15} />
                {t("editor.useImprovedInstructions")}
              </button>
            </footer>
          </section>
        </div>
      )}
    </main>
  );
}
