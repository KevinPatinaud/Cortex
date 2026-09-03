import {
  Bot,
  Cable,
  Check,
  FolderCog,
  Globe2,
  KeyRound,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  SlidersHorizontal,
  TerminalSquare,
  Trash2,
  TriangleAlert,
  X
} from "lucide-react";
import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent
} from "react";
import { useTranslation } from "../../../i18n.tsx";
import {
  getAgentConfiguration,
  getMcpConnections,
  getAgentStatus,
  saveAgentConfiguration,
  deleteMachineMcpConnection,
  type AgentConfiguration,
  type AgentStatus,
  type McpConnectionEngine,
  type McpConnectionSummary,
  type McpDiscoveryResult
} from "../../../services/agentApi.ts";
import {
  getProjectSettings,
  saveProjectSettings
} from "../../../services/projectApi.ts";
import { McpConnectionDialog } from "./McpConnectionDialog.tsx";
import { CodexPluginPanel } from "./CodexPluginPanel.tsx";
import { trapDialogFocus } from "../../shared/dialogFocus.ts";

const EMPTY_STATUS: AgentStatus = {
  engine: null,
  label: null,
  error: null
};

const DEFAULT_CONFIGURATION: AgentConfiguration = {
  autopilot: true,
  allowAll: false
};

const EMPTY_MCP_DISCOVERY: McpDiscoveryResult = {
  connections: [],
  issues: []
};

interface AgentEngineStatusProps {
  projectId?: string;
}

export function AgentEngineStatus({ projectId }: AgentEngineStatusProps) {
  const { language, setLanguage, t } = useTranslation();
  const [status, setStatus] = useState<AgentStatus>(EMPTY_STATUS);
  const [configuration, setConfiguration] = useState(DEFAULT_CONFIGURATION);
  const [mcpDiscovery, setMcpDiscovery] = useState(EMPTY_MCP_DISCOVERY);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [projectsDirectory, setProjectsDirectory] = useState("");
  const [projectsDirectoryDraft, setProjectsDirectoryDraft] = useState("");
  const [isSavingProjectsDirectory, setIsSavingProjectsDirectory] = useState(false);
  const [projectsDirectoryMessage, setProjectsDirectoryMessage] = useState("");
  const [isRefreshingMcp, setIsRefreshingMcp] = useState(false);
  const [mcpDialogOpen, setMcpDialogOpen] = useState(false);
  const [editedMcpConnection, setEditedMcpConnection] = useState<McpConnectionSummary | null>(null);
  const [pendingMcpConnectionId, setPendingMcpConnectionId] = useState("");
  const [configurationError, setConfigurationError] = useState("");
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<"general" | "connections">("general");
  const [showAllowAllWarning, setShowAllowAllWarning] = useState(false);
  const settingsDialogRef = useRef<HTMLDialogElement>(null);
  const settingsTriggerRef = useRef<HTMLButtonElement>(null);
  const settingsCloseRef = useRef<HTMLButtonElement>(null);
  const generalTabRef = useRef<HTMLButtonElement>(null);
  const connectionsTabRef = useRef<HTMLButtonElement>(null);
  const settingsTitleId = useId();
  const settingsDescriptionId = useId();
  const generalTabId = useId();
  const generalPanelId = useId();
  const connectionsTabId = useId();
  const connectionsPanelId = useId();

  useEffect(() => {
    let isMounted = true;

    async function loadStatus(): Promise<void> {
      try {
        const [agentStatus, agentConfiguration, discoveredMcp, projectSettings] = await Promise.all([
          getAgentStatus(),
          getAgentConfiguration(),
          getMcpConnections(projectId),
          getProjectSettings()
        ]);

        if (isMounted) {
          setStatus(agentStatus);
          setConfiguration(agentConfiguration);
          setMcpDiscovery(discoveredMcp);
          setProjectsDirectory(projectSettings.projectsDirectory);
          setProjectsDirectoryDraft(projectSettings.projectsDirectory);
        }
      } catch (error) {
        if (isMounted) {
          setStatus({
            engine: null,
            label: null,
            error: error instanceof Error
              ? error.message
              : t("engine.detectError")
          });
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void loadStatus();

    return () => {
      isMounted = false;
    };
  }, [projectId]);

  useEffect(() => {
    const dialog = settingsDialogRef.current;
    let focusFrame = 0;

    if (isSettingsOpen && !dialog?.open) {
      dialog?.showModal();
      focusFrame = window.requestAnimationFrame(() => {
        settingsCloseRef.current?.focus();
      });
    } else if (!isSettingsOpen && dialog?.open) {
      dialog.close();
    }

    return () => window.cancelAnimationFrame(focusFrame);
  }, [isSettingsOpen]);

  const hasError = !isLoading && Boolean(status.error);

  function handleSettingsTabKeyDown(
    event: ReactKeyboardEvent<HTMLButtonElement>
  ): void {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const nextSection = settingsSection === "general" ? "connections" : "general";
    setSettingsSection(nextSection);
    window.requestAnimationFrame(() => {
      (nextSection === "general" ? generalTabRef : connectionsTabRef).current?.focus();
    });
  }

  async function updateConfiguration(
    change: Partial<AgentConfiguration>
  ): Promise<void> {
    const nextConfiguration = { ...configuration, ...change };

    setIsSaving(true);
    setConfigurationError("");

    try {
      setConfiguration(await saveAgentConfiguration(nextConfiguration));
    } catch (error) {
      setConfigurationError(error instanceof Error
        ? error.message
        : t("engine.saveError")
      );
    } finally {
      setIsSaving(false);
    }
  }

  async function refreshMcpConnections(): Promise<void> {
    setIsRefreshingMcp(true);

    try {
      setMcpDiscovery(await getMcpConnections(projectId));
    } catch (error) {
      setMcpDiscovery({
        connections: [],
        issues: [{
          source: "shared",
          configurationFile: "",
          message: error instanceof Error
            ? error.message
            : t("mcp.loadError")
        }]
      });
    } finally {
      setIsRefreshingMcp(false);
    }
  }

  async function deleteMcpConnection(
    connection: McpConnectionSummary
  ): Promise<void> {
    if (!window.confirm(t("mcp.deleteConfirm", { name: connection.name }))) {
      return;
    }

    setPendingMcpConnectionId(connection.id);
    setConfigurationError("");
    try {
      await deleteMachineMcpConnection(
        connection.source as McpConnectionEngine,
        connection.name
      );
      await refreshMcpConnections();
    } catch (error) {
      setConfigurationError(error instanceof Error
        ? error.message
        : t("mcp.deleteError"));
    } finally {
      setPendingMcpConnectionId("");
    }
  }

  async function updateProjectsDirectory(): Promise<void> {
    const nextDirectory = projectsDirectoryDraft.trim();
    if (!nextDirectory) {
      setConfigurationError(t("storage.required"));
      return;
    }

    setIsSavingProjectsDirectory(true);
    setConfigurationError("");
    setProjectsDirectoryMessage("");

    try {
      const settings = await saveProjectSettings(nextDirectory);
      setProjectsDirectory(settings.projectsDirectory);
      setProjectsDirectoryDraft(settings.projectsDirectory);
      setProjectsDirectoryMessage(t("storage.saved"));
    } catch (error) {
      setConfigurationError(error instanceof Error
        ? error.message
        : t("storage.saveError")
      );
    } finally {
      setIsSavingProjectsDirectory(false);
    }
  }

  return (
    <div className="agent-engine-panel">
      <button
        ref={settingsTriggerRef}
        className={`agent-engine-settings-trigger${hasError ? " agent-engine-status--error" : ""}`}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={isSettingsOpen}
        onClick={() => {
          setSettingsSection("general");
          setShowAllowAllWarning(false);
          setIsSettingsOpen(true);
        }}
      >
        <Bot aria-hidden="true" size={18} strokeWidth={1.8} />
        <span className="agent-engine-status__content" aria-live="polite">
          <strong>
            {isLoading ? t("engine.detecting") : status.label || t("engine.notConfigured")}
          </strong>
          <small>{t("engine.settings")}</small>
          {hasError && (
            <span className="agent-engine-status__error">{status.error}</span>
          )}
        </span>
        {(isSaving || isSavingProjectsDirectory) && (
          <small className="agent-engine-settings__saving">
            {t("engine.saving")}
          </small>
        )}
        <span className="agent-engine-status__indicator" aria-hidden="true" />
        <SlidersHorizontal aria-hidden="true" size={15} strokeWidth={1.8} />
      </button>

      <dialog
        ref={settingsDialogRef}
        className={`agent-settings-dialog agent-engine-settings${hasError ? " agent-engine-status--error" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={settingsTitleId}
        aria-describedby={settingsDescriptionId}
        onKeyDown={trapDialogFocus}
        onCancel={(event) => {
          event.preventDefault();
          setIsSettingsOpen(false);
        }}
        onClose={() => {
          setIsSettingsOpen(false);
          settingsTriggerRef.current?.focus();
        }}
        onClick={(event) => {
          if (event.target === event.currentTarget) {
            setIsSettingsOpen(false);
          }
        }}
      >
        <header className="agent-settings-dialog__header">
          <span className="agent-settings-dialog__icon" aria-hidden="true">
            <Bot size={22} strokeWidth={1.8} />
          </span>
          <div>
            <span className="agent-settings-dialog__eyebrow">
              {isLoading ? t("engine.detecting") : status.label || t("engine.notConfigured")}
            </span>
            <h2 id={settingsTitleId}>{t("engine.settingsDialogTitle")}</h2>
            <p id={settingsDescriptionId}>{t("engine.settingsDialogDescription")}</p>
          </div>
          <button
            ref={settingsCloseRef}
            className="agent-settings-dialog__close"
            type="button"
            aria-label={t("common.close")}
            title={t("common.close")}
            onClick={() => setIsSettingsOpen(false)}
          >
            <X aria-hidden="true" size={18} />
          </button>
        </header>

        <div className="agent-settings-dialog__tabs" role="tablist" aria-label={t("engine.settingsDialogTitle")}>
          <button
            ref={generalTabRef}
            id={generalTabId}
            type="button"
            role="tab"
            aria-selected={settingsSection === "general"}
            aria-controls={generalPanelId}
            tabIndex={settingsSection === "general" ? 0 : -1}
            className={settingsSection === "general" ? "is-active" : ""}
            onClick={() => setSettingsSection("general")}
            onKeyDown={handleSettingsTabKeyDown}
          >
            <SlidersHorizontal aria-hidden="true" size={15} />
            {t("engine.generalTab")}
          </button>
          <button
            ref={connectionsTabRef}
            id={connectionsTabId}
            type="button"
            role="tab"
            aria-selected={settingsSection === "connections"}
            aria-controls={connectionsPanelId}
            tabIndex={settingsSection === "connections" ? 0 : -1}
            className={settingsSection === "connections" ? "is-active" : ""}
            onClick={() => setSettingsSection("connections")}
            onKeyDown={handleSettingsTabKeyDown}
          >
            <Cable aria-hidden="true" size={15} />
            {t("engine.connectionsTab")}
          </button>
        </div>

        <div className="agent-settings-dialog__body agent-engine-settings__content">
          <section
            id={generalPanelId}
            className="agent-settings-dialog__section"
            role="tabpanel"
            aria-labelledby={generalTabId}
            hidden={settingsSection !== "general"}
          >
            <header className="agent-settings-dialog__section-header">
              <SlidersHorizontal aria-hidden="true" size={17} strokeWidth={1.8} />
              <div>
                <h3 id="general-settings-title">{t("engine.generalSettings")}</h3>
                <p>{t("engine.generalSettingsHelp")}</p>
              </div>
            </header>
            <div className="agent-settings-dialog__section-content">
              <label className="agent-engine-settings__language">
                <span>
                  <strong>{t("language.label")}</strong>
                  <small>{t("language.help")}</small>
                </span>
                <select
                  value={language}
                  onChange={(event) => setLanguage(event.target.value as "fr" | "en")}
                  aria-label={t("language.label")}
                >
                  <option value="fr">{t("language.fr")}</option>
                  <option value="en">{t("language.en")}</option>
                </select>
              </label>
              <label>
                <span>
                  <strong>Autopilot</strong>
                  <small>{t("engine.autopilotHelp")}</small>
                </span>
                <input
                  type="checkbox"
                  checked={configuration.autopilot}
                  disabled={isLoading || isSaving}
                  onChange={(event) => void updateConfiguration({
                    autopilot: event.target.checked
                  })}
                />
              </label>
              <label className="agent-engine-settings__danger-setting">
                <span>
                  <strong>{t("engine.allowAll")}</strong>
                  <small id="allow-all-help">{t("engine.allowAllHelp")}</small>
                </span>
                <input
                  type="checkbox"
                  checked={configuration.allowAll}
                  disabled={isLoading || isSaving || !configuration.autopilot}
                  aria-describedby={showAllowAllWarning
                    ? "allow-all-help allow-all-warning"
                    : "allow-all-help"}
                  onChange={(event) => {
                    if (event.target.checked) {
                      setShowAllowAllWarning(true);
                    } else {
                      setShowAllowAllWarning(false);
                      void updateConfiguration({ allowAll: false });
                    }
                  }}
                />
              </label>
              {showAllowAllWarning && (
                <div className="agent-engine-settings__danger-confirmation" id="allow-all-warning" role="alert">
                  <TriangleAlert aria-hidden="true" size={18} />
                  <p>{t("engine.allowAllWarning")}</p>
                  <div>
                    <button type="button" onClick={() => setShowAllowAllWarning(false)}>
                      {t("common.cancel")}
                    </button>
                    <button
                      type="button"
                      className="agent-engine-settings__danger-confirm"
                      onClick={() => {
                        setShowAllowAllWarning(false);
                        void updateConfiguration({ allowAll: true });
                      }}
                    >
                      {t("engine.allowAllConfirm")}
                    </button>
                  </div>
                </div>
              )}
              <section className="agent-engine-storage" aria-labelledby="projects-storage-title">
                <header>
                  <FolderCog aria-hidden="true" size={15} strokeWidth={1.8} />
                  <span>
                    <strong id="projects-storage-title">{t("storage.title")}</strong>
                    <small>{t("storage.help")}</small>
                  </span>
                </header>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void updateProjectsDirectory();
                  }}
                >
                  <input
                    type="text"
                    value={projectsDirectoryDraft}
                    title={projectsDirectoryDraft}
                    aria-label={t("storage.path")}
                    onChange={(event) => {
                      setProjectsDirectoryDraft(event.target.value);
                      setProjectsDirectoryMessage("");
                      setConfigurationError("");
                    }}
                    disabled={isLoading || isSavingProjectsDirectory}
                  />
                  <button
                    type="submit"
                    disabled={
                      isLoading ||
                      isSavingProjectsDirectory ||
                      !projectsDirectoryDraft.trim() ||
                      projectsDirectoryDraft.trim() === projectsDirectory
                    }
                    title={t("storage.save")}
                    aria-label={t("storage.save")}
                  >
                    <Save aria-hidden="true" size={14} />
                  </button>
                </form>
                {projectsDirectoryMessage && (
                  <p className="agent-engine-storage__success" role="status">
                    <Check aria-hidden="true" size={12} />
                    {projectsDirectoryMessage}
                  </p>
                )}
              </section>
            </div>
          </section>

          <section
            id={connectionsPanelId}
            className="agent-settings-dialog__section"
            role="tabpanel"
            aria-labelledby={connectionsTabId}
            hidden={settingsSection !== "connections"}
          >
            <header className="agent-settings-dialog__section-header">
              <Cable aria-hidden="true" size={17} strokeWidth={1.8} />
              <span>
                <h3 id="connections-settings-title">{t("engine.connectionsSettings")}</h3>
                <p>{t("engine.connectionsSettingsHelp")}</p>
              </span>
            </header>
            <div className="agent-settings-dialog__section-content">
              <CodexPluginPanel onChanged={() => void refreshMcpConnections()} />
              <section className="agent-engine-mcp" aria-labelledby="mcp-connections-title">
                <header>
                  <span>
                    <Cable aria-hidden="true" size={15} strokeWidth={1.8} />
                    <span>
                      <strong id="mcp-connections-title">{t("mcp.title")}</strong>
                      <small>{t("mcp.count", {
                        count: mcpDiscovery.connections.length
                      })}</small>
                    </span>
                  </span>
                  <span className="agent-engine-mcp__header-actions">
                    <button
                      type="button"
                      className="agent-engine-mcp__add"
                      onClick={() => {
                        setEditedMcpConnection(null);
                        setMcpDialogOpen(true);
                      }}
                      title={t("mcp.add")}
                      aria-label={t("mcp.add")}
                    >
                      <Plus aria-hidden="true" size={14} />
                    </button>
                    <button
                      type="button"
                      className="agent-engine-mcp__refresh"
                      onClick={() => void refreshMcpConnections()}
                      disabled={isRefreshingMcp}
                      title={t("mcp.refresh")}
                      aria-label={t("mcp.refresh")}
                    >
                      <RefreshCw
                        className={isRefreshingMcp ? "spin" : undefined}
                        aria-hidden="true"
                        size={14}
                      />
                    </button>
                  </span>
                </header>
                <p className="agent-engine-mcp__help">{t("mcp.machineOnly")}</p>
                {mcpDiscovery.issues.length > 0 && (
                  <div className="agent-engine-mcp__issues" role="status">
                    {mcpDiscovery.issues.map((issue) => (
                      <p key={`${issue.source}:${issue.configurationFile}`}>
                        <TriangleAlert aria-hidden="true" size={13} />
                        <span>{issue.message}</span>
                      </p>
                    ))}
                  </div>
                )}
                {mcpDiscovery.connections.length === 0 ? (
                  <p className="agent-engine-mcp__empty">{t("mcp.empty")}</p>
                ) : (
                  <ul className="agent-engine-mcp__list">
                    {mcpDiscovery.connections.map((connection) => (
                      <McpConnectionItem
                        key={connection.id}
                        connection={connection}
                        isPending={pendingMcpConnectionId === connection.id}
                        onEdit={() => {
                          setEditedMcpConnection(connection);
                          setMcpDialogOpen(true);
                        }}
                        onDelete={() => void deleteMcpConnection(connection)}
                      />
                    ))}
                  </ul>
                )}
              </section>
              {configurationError && (
                <p className="agent-engine-settings__error" role="alert">
                  {configurationError}
                </p>
              )}
            </div>
          </section>
        </div>
      </dialog>
      <McpConnectionDialog
        connection={editedMcpConnection}
        isOpen={mcpDialogOpen}
        onClose={() => setMcpDialogOpen(false)}
        onSaved={() => void refreshMcpConnections()}
      />
    </div>
  );
}

function McpConnectionItem({
  connection,
  isPending,
  onEdit,
  onDelete
}: {
  connection: McpConnectionSummary;
  isPending: boolean;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const sourceLabel = connection.source === "shared"
    ? t("mcp.source.shared")
    : connection.source === "codex"
      ? "Codex"
      : connection.source === "claude"
        ? "Claude"
        : "Copilot";
  const scopeLabel = t(`mcp.scope.${connection.scope}`);
  const configuredFor = connection.configuredFor.map((engine) =>
    engine === "codex" ? "Codex" : engine === "claude" ? "Claude" : "Copilot"
  ).join(" + ");

  return (
    <li>
      <span className="agent-engine-mcp__transport" aria-hidden="true">
        {connection.transport === "stdio"
          ? <TerminalSquare size={14} />
          : <Globe2 size={14} />}
      </span>
      <span className="agent-engine-mcp__connection">
        <strong>{connection.name}</strong>
        <small>{sourceLabel} · {scopeLabel} · {configuredFor}</small>
        <code title={connection.endpoint}>{connection.endpoint}</code>
      </span>
      <span className="agent-engine-mcp__item-actions">
        {connection.hasAuthentication && (
          <KeyRound
            className="agent-engine-mcp__authentication"
            aria-label={t("mcp.authentication")}
            size={13}
          />
        )}
        {connection.manageable ? (
          <>
            <button
              type="button"
              onClick={onEdit}
              disabled={isPending}
              title={t("mcp.edit")}
              aria-label={`${t("mcp.edit")} ${connection.name}`}
            >
              <Pencil aria-hidden="true" size={13} />
            </button>
            <button
              type="button"
              className="agent-engine-mcp__delete"
              onClick={onDelete}
              disabled={isPending}
              title={t("mcp.delete")}
              aria-label={`${t("mcp.delete")} ${connection.name}`}
            >
              <Trash2 aria-hidden="true" size={13} />
            </button>
          </>
        ) : (
          <span className="agent-engine-mcp__read-only" title={t("mcp.readOnly")}>
            {t("mcp.scope.project")}
          </span>
        )}
      </span>
    </li>
  );
}
