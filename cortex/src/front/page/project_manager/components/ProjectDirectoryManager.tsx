import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { ChevronDown, FileArchive, FolderInput, LoaderCircle, PanelLeftClose, PanelLeftOpen, Plus, Search } from "lucide-react";
import { useTranslation } from "../../../i18n.tsx";
import { AgentEngineStatus } from "../../agent/components/AgentEngineStatus.tsx";
import {
  getActualLoadedAgentProject,
  loadAgentProject,
  type AgentProject
} from "../../../services/agentApi.ts";
import {
  createProject,
  getSavedProjects,
  importProjectArchive,
  importProjectDirectory,
  prepareProjectDirectoryUpload,
  reorderProjects,
  type CreateProjectInput,
  type Project
} from "../../../services/projectApi.ts";
import { ProjectCreationDialog } from "./ProjectCreationDialog.tsx";
import { getNavigationIndex, initializeNavigation, updateBrowserUrl } from "../../shared/browserNavigation.ts";
import { type ProjectActivityStatus } from "./ProjectList.tsx";
import { ProjectFolderList } from "./ProjectFolderList.tsx";

interface ProjectDirectoryManagerProps {
  activeProject: Project | null;
  deletedProject: { id: string } | null;
  isEditing: boolean;
  projectActivity: Record<string, ProjectActivityStatus>;
  onProjectLoaded: (
    project: Project,
    content: AgentProject,
    openEditor?: boolean,
    requiresInitialSave?: boolean
  ) => void;
  onProjectCleared: () => void;
  onBeforeProjectChange: () => boolean;
  creationRequest: number;
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function getProjectName(project: Project): string {
  return project.directoryPath.split(/[\\/]/).filter(Boolean).at(-1) ||
    project.directoryPath;
}

function updateProjectUrl(
  projectId: string | null,
  replace = false,
  resetView = true
): void {
  const url = new URL(window.location.href);

  if (projectId) {
    url.searchParams.set("project", projectId);
    if (resetView) url.searchParams.delete("view");
  } else {
    url.searchParams.delete("project");
    url.searchParams.delete("view");
  }

  updateBrowserUrl(url, replace);
}

export function ProjectDirectoryManager({
  activeProject,
  deletedProject,
  isEditing,
  projectActivity,
  onProjectLoaded,
  onProjectCleared,
  onBeforeProjectChange,
  creationRequest
}: ProjectDirectoryManagerProps) {
  const { t } = useTranslation();
  const [projects, setProjects] = useState<Project[]>([]);
  const [saveMessage, setSaveMessage] = useState("");
  const [error, setError] = useState("");
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);
  const [hasProjectListError, setHasProjectListError] = useState(false);
  const [projectListAttempt, setProjectListAttempt] = useState(0);
  const [loadingProjectId, setLoadingProjectId] = useState<string | null>(null);
  const [loadingProjectName, setLoadingProjectName] = useState("");
  const [failedProject, setFailedProject] = useState<Project | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [isSelecting, setIsSelecting] = useState(false);
  const [isDraggingArchive, setIsDraggingArchive] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isReordering, setIsReordering] = useState(false);
  const [isCreationDialogOpen, setIsCreationDialogOpen] = useState(false);
  const [isProjectMenuOpen, setIsProjectMenuOpen] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [projectSearch, setProjectSearch] = useState("");
  const directoryInputRef = useRef<HTMLInputElement>(null);
  const archiveInputRef = useRef<HTMLInputElement>(null);
  const archiveDragDepthRef = useRef(0);
  const archiveImportPendingRef = useRef(false);
  const projectsRef = useRef<Project[]>([]);
  const selectedProjectIdRef = useRef<string | null>(null);
  const selectionRequestRef = useRef(0);
  const hasPendingSelectionRef = useRef(false);
  const beforeProjectChangeRef = useRef(onBeforeProjectChange);
  const currentNavigationRef = useRef({ url: window.location.href, index: getNavigationIndex() });
  const isRestoringNavigationRef = useRef(false);
  useEffect(() => {
    if (creationRequest > 0) setIsCreationDialogOpen(true);
  }, [creationRequest]);

  useEffect(() => {
    if (error) {
      setIsProjectMenuOpen(true);
      setIsSidebarCollapsed(false);
    }
  }, [error]);

  useEffect(() => {
    beforeProjectChangeRef.current = onBeforeProjectChange;
  }, [onBeforeProjectChange]);

  useEffect(() => {
    initializeNavigation();
    currentNavigationRef.current = { url: window.location.href, index: getNavigationIndex() };
  }, [isEditing, selectedProjectId]);

  useEffect(() => {
    projectsRef.current = projects;
  }, [projects]);

  useEffect(() => {
    selectedProjectIdRef.current = selectedProjectId;
  }, [selectedProjectId]);

  useEffect(() => {
    directoryInputRef.current?.setAttribute("webkitdirectory", "");
    directoryInputRef.current?.setAttribute("directory", "");
  }, []);

  useEffect(() => {
    const mobileViewport = window.matchMedia("(max-width: 700px)");
    const expandSidebarForMobile = (): void => {
      if (mobileViewport.matches) setIsSidebarCollapsed(false);
    };

    expandSidebarForMobile();
    mobileViewport.addEventListener("change", expandSidebarForMobile);
    return () => mobileViewport.removeEventListener("change", expandSidebarForMobile);
  }, []);

  useEffect(() => {
    if (!activeProject) {
      return;
    }

    setProjects((currentProjects) => currentProjects.map((project) =>
      project.id === activeProject.id ? activeProject : project
    ));
  }, [activeProject]);

  useEffect(() => {
    if (!deletedProject) {
      return;
    }

    setProjects((currentProjects) => currentProjects.filter(
      (project) => project.id !== deletedProject.id
    ));
    setSelectedProjectId((currentId) =>
      currentId === deletedProject.id ? null : currentId
    );
    if (selectedProjectIdRef.current === deletedProject.id) {
      updateProjectUrl(null, true);
    }
    setSaveMessage(t("project.deleted"));
  }, [deletedProject]);

  useEffect(() => {
    let isMounted = true;

    async function loadProjects(): Promise<void> {
      const selectionRequest = ++selectionRequestRef.current;
      setIsLoadingProjects(true);
      setHasProjectListError(false);
      setError("");
      try {
        const [savedResult, loadedResult] = await Promise.allSettled([
          getSavedProjects(),
          getActualLoadedAgentProject()
        ]);

        if (isMounted && selectionRequest === selectionRequestRef.current) {
          if (savedResult.status === "rejected") {
            setHasProjectListError(true);
            throw savedResult.reason;
          }
          const savedProjects = savedResult.value;
          const actualLoadedProject = loadedResult.status === "fulfilled" ? loadedResult.value : null;
          setProjects(savedProjects);

          const requestedProjectId = new URL(window.location.href).searchParams.get("project");
          const requestedProject = savedProjects.find((project) => project.id === requestedProjectId);
          const actualProject = actualLoadedProject
            ? savedProjects.find((project) => project.id === actualLoadedProject.projectId)
            : undefined;
          const projectToOpen = requestedProjectId ? requestedProject : actualProject;

          if (requestedProjectId && !requestedProject) {
            setError(t("project.notFound"));
            updateProjectUrl(null, true);
            setIsProjectMenuOpen(true);
          }

          if (projectToOpen) {
            hasPendingSelectionRef.current = true;
            setFailedProject(projectToOpen);
            const content = actualLoadedProject?.projectId === projectToOpen.id
              ? actualLoadedProject
              : await loadAgentProject(projectToOpen.id);
            if (!isMounted || selectionRequest !== selectionRequestRef.current) return;
            hasPendingSelectionRef.current = false;
            setFailedProject(null);
            setSelectedProjectId(projectToOpen.id);
            updateProjectUrl(projectToOpen.id, true, false);
            onProjectLoaded(projectToOpen, content);
          }
        }
      } catch (requestError) {
        if (isMounted && selectionRequest === selectionRequestRef.current) {
          setError(getErrorMessage(requestError, t("common.unexpectedError")));
        }
      } finally {
        if (isMounted) {
          if (selectionRequest === selectionRequestRef.current) hasPendingSelectionRef.current = false;
          setIsLoadingProjects(false);
        }
      }
    }

    void loadProjects();

    return () => {
      isMounted = false;
    };
  }, [projectListAttempt]);

  useEffect(() => {
    const handlePopState = (event: PopStateEvent): void => {
      if (isRestoringNavigationRef.current) {
        isRestoringNavigationRef.current = false;
        event.stopImmediatePropagation();
        return;
      }
      const projectId = new URL(window.location.href).searchParams.get("project");
      if (projectId === selectedProjectIdRef.current) {
        if (hasPendingSelectionRef.current) {
          selectionRequestRef.current += 1;
          hasPendingSelectionRef.current = false;
          setLoadingProjectId(null);
          setLoadingProjectName("");
          setFailedProject(null);
        }
        return;
      }

      if (!beforeProjectChangeRef.current()) {
        event.stopImmediatePropagation();
        const previous = currentNavigationRef.current;
        const nextIndex = getNavigationIndex();
        if (previous.index !== null && nextIndex !== null && previous.index !== nextIndex) {
          isRestoringNavigationRef.current = true;
          window.history.go(previous.index - nextIndex);
        } else {
          updateBrowserUrl(new URL(previous.url));
        }
        return;
      }
      currentNavigationRef.current = { url: window.location.href, index: getNavigationIndex() };

      if (!projectId) {
        selectionRequestRef.current += 1;
        hasPendingSelectionRef.current = false;
        setLoadingProjectId(null);
        setLoadingProjectName("");
        setFailedProject(null);
        setSelectedProjectId(null);
        setIsProjectMenuOpen(false);
        onProjectCleared();
        return;
      }

      const project = projectsRef.current.find((candidate) => candidate.id === projectId);
      if (project) {
        void handleProjectSelection(project, false);
      } else {
        selectionRequestRef.current += 1;
        hasPendingSelectionRef.current = false;
        setLoadingProjectId(null);
        setSelectedProjectId(null);
        setError(t("project.notFound"));
        updateProjectUrl(null, true);
        onProjectCleared();
      }
    };

    window.addEventListener("popstate", handlePopState, true);
    return () => window.removeEventListener("popstate", handlePopState, true);
  }, []);

  async function handleDirectorySelection(
    event: ChangeEvent<HTMLInputElement>
  ): Promise<void> {
    const selectedFiles = Array.from(event.target.files ?? []);
    event.target.value = "";

    if (selectedFiles.length === 0) {
      return;
    }

    setIsSelecting(true);
    setError("");
    setSaveMessage("");

    try {
      const upload = prepareProjectDirectoryUpload(selectedFiles);
      const result = await importProjectDirectory(upload);
      setProjects(result.projects);
      const content = await loadAgentProject(result.project.id);
      setSelectedProjectId(result.project.id);
      updateProjectUrl(result.project.id);
      setIsProjectMenuOpen(false);
      setSaveMessage(result.conversion
        ? t("project.importConverted", result.conversion)
        : t("project.imported")
      );
      onProjectLoaded(result.project, content);
    } catch (requestError) {
      setError(getErrorMessage(requestError, t("common.unexpectedError")));
    } finally {
      setIsSelecting(false);
    }
  }

  async function handleProjectSelection(project: Project, updateHistory = true): Promise<void> {
    if (updateHistory && !beforeProjectChangeRef.current()) return;
    const selectionRequest = ++selectionRequestRef.current;
    hasPendingSelectionRef.current = true;
    setLoadingProjectId(project.id);
    setLoadingProjectName(getProjectName(project));
    setFailedProject(null);
    setError("");
    setSaveMessage("");

    try {
      const content = await loadAgentProject(project.id);
      if (selectionRequest !== selectionRequestRef.current) return;
      setSelectedProjectId(project.id);
      if (updateHistory) updateProjectUrl(project.id);
      setIsProjectMenuOpen(false);
      onProjectLoaded(project, content);
      if (window.matchMedia("(max-width: 700px)").matches) {
        requestAnimationFrame(() => document.getElementById("main-content")?.focus());
      }
    } catch (requestError) {
      if (selectionRequest !== selectionRequestRef.current) return;
      setFailedProject(project);
      setError(getErrorMessage(requestError, t("common.unexpectedError")));
    } finally {
      if (selectionRequest === selectionRequestRef.current) {
        hasPendingSelectionRef.current = false;
        setLoadingProjectId(null);
        setLoadingProjectName("");
      }
    }
  }

  async function handleArchiveSelection(
    event: ChangeEvent<HTMLInputElement>
  ): Promise<void> {
    const archive = event.target.files?.[0];
    event.target.value = "";

    if (archive) await handleArchiveImport(archive);
  }

  function clearArchiveDragState(): void {
    archiveDragDepthRef.current = 0;
    setIsDraggingArchive(false);
  }

  function handleArchiveDragOver(event: DragEvent<HTMLDivElement>): void {
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = isImportDisabled ? "none" : "copy";
  }

  function handleArchiveDrop(event: DragEvent<HTMLDivElement>): void {
    clearArchiveDragState();
    if (!event.dataTransfer.types.includes("Files")) return;
    event.preventDefault();
    if (isImportDisabled || archiveImportPendingRef.current) return;

    const archives = Array.from(event.dataTransfer.files);
    const archive = archives[0];
    if (archives.length !== 1 || !archive || !/\.ctx$/i.test(archive.name)) {
      setSaveMessage("");
      setError(t("project.archiveDropInvalid"));
      return;
    }

    void handleArchiveImport(archive);
  }

  async function handleArchiveImport(archive: File): Promise<void> {
    if (isImportDisabled || archiveImportPendingRef.current) return;
    archiveImportPendingRef.current = true;
    setIsSelecting(true);
    setError("");
    setSaveMessage("");

    try {
      const result = await importProjectArchive(archive);
      setProjects(result.projects);
      const content = await loadAgentProject(result.project.id);
      setSelectedProjectId(result.project.id);
      updateProjectUrl(result.project.id);
      setIsProjectMenuOpen(false);
      setSaveMessage(result.conversion
        ? t("project.importConverted", result.conversion)
        : t("project.archiveImported")
      );
      onProjectLoaded(result.project, content);
    } catch (requestError) {
      setError(getErrorMessage(requestError, t("common.unexpectedError")));
    } finally {
      archiveImportPendingRef.current = false;
      setIsSelecting(false);
    }
  }

  async function handleProjectReorder(nextProjects: Project[]): Promise<void> {
    const previousProjects = projects;
    const reorderControl = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    setProjects(nextProjects);
    setIsReordering(true);
    setError("");

    try {
      setProjects(await reorderProjects(
        nextProjects.map((project) => project.id)
      ));
      setSaveMessage(t("project.reordered"));
    } catch (requestError) {
      setProjects(previousProjects);
      setError(getErrorMessage(requestError, t("project.reorderError")));
    } finally {
      setIsReordering(false);
      requestAnimationFrame(() => {
        if (!reorderControl?.isConnected ||
          (document.activeElement !== document.body && document.activeElement !== reorderControl)) return;
        const focusTarget = reorderControl.matches(":disabled")
          ? reorderControl.closest(".project-list__item")?.querySelector<HTMLElement>(".project-list__select-button")
          : reorderControl;
        focusTarget?.focus({ preventScroll: true });
      });
    }
  }

  async function handleProjectCreation(
    input: CreateProjectInput
  ): Promise<{ project: Project; content: AgentProject } | null> {
    setIsCreating(true);
    setError("");
    setSaveMessage("");

    try {
      const result = await createProject(input);
      const content = await loadAgentProject(result.project.id);
      setProjects(result.projects);
      setSelectedProjectId(result.project.id);
      updateProjectUrl(result.project.id);
      setIsProjectMenuOpen(false);
      setIsCreationDialogOpen(false);
      setSaveMessage(t("project.created"));
      onProjectLoaded(result.project, content, true, true);
      return { project: result.project, content };
    } catch (requestError) {
      setError(getErrorMessage(requestError, t("common.unexpectedError")));
      return null;
    } finally {
      setIsCreating(false);
    }
  }

  const selectedProject = projects.find(
    (project) => project.id === selectedProjectId
  );
  const isSidebarExpanded = isProjectMenuOpen;
  const isProjectActionPending = isSelecting || isCreating || isReordering || loadingProjectId !== null;
  const isImportDisabled = isProjectActionPending || isEditing || isLoadingProjects;

  return (
    <>
      <aside
        className={`project-sidebar${
          isSidebarExpanded ? " project-sidebar--expanded" : ""
        }${isSidebarCollapsed ? " project-sidebar--collapsed" : ""}`}
        aria-label={t("sidebar.aria")}
      >
        <header className="project-sidebar__header">
          <p className="project-sidebar__eyebrow">{t("sidebar.workspace")}</p>
          <div className="project-sidebar__title-row">
            <h2>{t("sidebar.projects")}</h2>
            <div className="project-sidebar__title-actions">
              <span className="project-sidebar__count" aria-label={t("sidebar.count", { count: projects.length })}>
                {projects.length}
              </span>
              <button
                className="project-sidebar__toggle"
                type="button"
                aria-controls="project-sidebar-panel"
                aria-expanded={isSidebarExpanded}
                aria-label={isSidebarExpanded
                  ? t("sidebar.hideList")
                  : t("sidebar.showList")
                }
                onClick={() => setIsProjectMenuOpen((isOpen) => !isOpen)}
              >
                <span>{isSidebarExpanded ? t("sidebar.hide") : t(selectedProject ? "sidebar.change" : "sidebar.show")}</span>
                <ChevronDown aria-hidden="true" size={17} />
              </button>
              <button
                className="project-sidebar__collapse"
                type="button"
                aria-expanded={!isSidebarCollapsed}
                aria-controls="project-sidebar-panel"
                aria-label={isSidebarCollapsed ? t("sidebar.expand") : t("sidebar.collapse")}
                title={isSidebarCollapsed ? t("sidebar.expand") : t("sidebar.collapse")}
                onClick={() => setIsSidebarCollapsed((collapsed) => !collapsed)}
              >
                {isSidebarCollapsed
                  ? <PanelLeftOpen aria-hidden="true" size={17} />
                  : <PanelLeftClose aria-hidden="true" size={17} />}
              </button>
            </div>
          </div>
          {selectedProject && (
            <p className="project-sidebar__current-project">
              {isEditing ? t("sidebar.editing") : t("sidebar.activeProject")}
              <strong>{getProjectName(selectedProject)}</strong>
            </p>
          )}
        </header>

        <div className="project-sidebar__content" id="project-sidebar-panel">
          <label className="project-sidebar__search">
            <Search aria-hidden="true" size={15} />
            <input
              type="search"
              value={projectSearch}
              placeholder={t("sidebar.search")}
              aria-label={t("sidebar.search")}
              onChange={(event) => setProjectSearch(event.target.value)}
            />
          </label>
          {hasProjectListError ? (
            <p className="project-list__state">{t("project.listUnavailable")}</p>
          ) : <ProjectFolderList
            projects={projects}
            search={projectSearch}
            onClearSearch={() => setProjectSearch("")}
            projectActivity={projectActivity}
            isLoading={isLoadingProjects}
            loadingProjectId={loadingProjectId}
            selectedProjectId={selectedProjectId}
            isInteractionLocked={isEditing || isProjectActionPending}
            isReorderLocked={Boolean(projectSearch.trim())}
            onSelect={(project) => void handleProjectSelection(project)}
            onReorder={(nextProjects) => void handleProjectReorder(nextProjects)}
          />}
        </div>

        <footer className="project-sidebar__footer">
          <input
            ref={directoryInputRef}
            type="file"
            multiple
            hidden
            aria-hidden="true"
            tabIndex={-1}
            onChange={(event) => void handleDirectorySelection(event)}
          />
          <input
            ref={archiveInputRef}
            type="file"
            accept=".ctx,application/vnd.cortex.project+zip,application/zip"
            hidden
            aria-hidden="true"
            tabIndex={-1}
            onChange={(event) => void handleArchiveSelection(event)}
          />
          <div className="project-sidebar__feedback" aria-live="polite">
            {saveMessage && <p className="success-message">{saveMessage}</p>}
            {error && (
              <div className="project-sidebar__error" role="alert">
                <p className="error">{error}</p>
                {failedProject && (
                  <button type="button" disabled={loadingProjectId !== null} onClick={() => void handleProjectSelection(failedProject)}>
                    {t("project.retry")}
                  </button>
                )}
                {hasProjectListError && (
                  <button type="button" onClick={() => setProjectListAttempt((attempt) => attempt + 1)}>
                    {t("project.retry")}
                  </button>
                )}
              </div>
            )}
          </div>
          <button
            className="project-sidebar__add-button"
            type="button"
            onClick={() => {
              setError("");
              setSaveMessage("");
              setIsCreationDialogOpen(true);
            }}
            disabled={isProjectActionPending || isEditing || isLoadingProjects}
          >
            <Plus aria-hidden="true" size={18} />
            {t("sidebar.newProject")}
          </button>
          <div
            className={`project-sidebar__import${isDraggingArchive && !isImportDisabled
              ? " project-sidebar__import--dragging"
              : ""}`}
            aria-label={t("sidebar.importLabel")}
            title={t("sidebar.importDropHelp")}
            onDragEnter={(event) => {
              if (!event.dataTransfer.types.includes("Files")) return;
              handleArchiveDragOver(event);
              archiveDragDepthRef.current += 1;
              if (!isImportDisabled) setIsDraggingArchive(true);
            }}
            onDragOver={handleArchiveDragOver}
            onDragLeave={(event) => {
              if (!event.dataTransfer.types.includes("Files")) return;
              archiveDragDepthRef.current = Math.max(0, archiveDragDepthRef.current - 1);
              if (archiveDragDepthRef.current === 0) setIsDraggingArchive(false);
            }}
            onDrop={handleArchiveDrop}
          >
            <span>{isSelecting
              ? t("sidebar.importing")
              : t("sidebar.importLabel")}</span>
            <div className="project-sidebar__import-options">
              <button
                className="project-sidebar__import-button"
                type="button"
                onClick={() => directoryInputRef.current?.click()}
                disabled={isImportDisabled}
              >
                <FolderInput aria-hidden="true" size={15} />
                {t("sidebar.importFolder")}
              </button>
              <button
                className="project-sidebar__import-button"
                type="button"
                onClick={() => archiveInputRef.current?.click()}
                disabled={isImportDisabled}
              >
                <FileArchive aria-hidden="true" size={15} />
                {t("sidebar.importArchive")}
              </button>
            </div>
          </div>
          <AgentEngineStatus projectId={activeProject?.id} />
        </footer>
      </aside>

      {loadingProjectId && (
        <div className="project-loading-overlay" role="status" aria-live="polite">
          <div>
            <LoaderCircle aria-hidden="true" size={22} />
            <strong>{t("project.loadingName", { name: loadingProjectName })}</strong>
          </div>
        </div>
      )}

      {isCreationDialogOpen && (
        <ProjectCreationDialog
          isPending={isCreating}
          error={error || undefined}
          onCancel={() => {
            if (!isCreating) {
              setError("");
              setIsCreationDialogOpen(false);
            }
          }}
          onCreate={handleProjectCreation}
        />
      )}

    </>
  );
}
