import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { ChevronDown, FolderInput, Plus } from "lucide-react";
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
  importProjectDirectory,
  prepareProjectDirectoryUpload,
  type CreateProjectInput,
  type Project
} from "../../../services/projectApi.ts";
import { ProjectCreationDialog } from "./ProjectCreationDialog.tsx";
import {
  ProjectList,
  type ProjectActivityStatus
} from "./ProjectList.tsx";

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
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function getProjectName(project: Project): string {
  return project.directoryPath.split(/[\\/]/).filter(Boolean).at(-1) ||
    project.directoryPath;
}

export function ProjectDirectoryManager({
  activeProject,
  deletedProject,
  isEditing,
  projectActivity,
  onProjectLoaded
}: ProjectDirectoryManagerProps) {
  const { t } = useTranslation();
  const [projects, setProjects] = useState<Project[]>([]);
  const [saveMessage, setSaveMessage] = useState("");
  const [error, setError] = useState("");
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);
  const [loadingProjectId, setLoadingProjectId] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [isSelecting, setIsSelecting] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isCreationDialogOpen, setIsCreationDialogOpen] = useState(false);
  const [isProjectMenuOpen, setIsProjectMenuOpen] = useState(false);
  const directoryInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    directoryInputRef.current?.setAttribute("webkitdirectory", "");
    directoryInputRef.current?.setAttribute("directory", "");
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
    setSaveMessage(t("project.deleted"));
  }, [deletedProject]);

  useEffect(() => {
    let isMounted = true;

    async function loadProjects(): Promise<void> {
      try {
        const [savedProjects, actualLoadedProject] = await Promise.all([
          getSavedProjects(),
          getActualLoadedAgentProject()
        ]);

        if (isMounted) {
          setProjects(savedProjects);

          if (actualLoadedProject) {
            const actualProject = savedProjects.find(
              (project) => project.id === actualLoadedProject.projectId
            );

            if (actualProject) {
              setSelectedProjectId(actualProject.id);
              onProjectLoaded(actualProject, actualLoadedProject);
            }
          }
        }
      } catch (requestError) {
        if (isMounted) {
          setError(getErrorMessage(requestError, t("common.unexpectedError")));
        }
      } finally {
        if (isMounted) {
          setIsLoadingProjects(false);
        }
      }
    }

    void loadProjects();

    return () => {
      isMounted = false;
    };
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
      setIsProjectMenuOpen(false);
      setSaveMessage(t("project.imported"));
      onProjectLoaded(result.project, content);
    } catch (requestError) {
      setError(getErrorMessage(requestError, t("common.unexpectedError")));
    } finally {
      setIsSelecting(false);
    }
  }

  async function handleProjectSelection(project: Project): Promise<void> {
    setLoadingProjectId(project.id);
    setError("");
    setSaveMessage("");

    try {
      const content = await loadAgentProject(project.id);
      setSelectedProjectId(project.id);
      setIsProjectMenuOpen(false);
      onProjectLoaded(project, content);
    } catch (requestError) {
      setError(getErrorMessage(requestError, t("common.unexpectedError")));
    } finally {
      setLoadingProjectId(null);
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
  const isSidebarExpanded = isProjectMenuOpen || selectedProjectId === null;

  return (
    <>
      <aside
        className={`project-sidebar${
          isSidebarExpanded ? " project-sidebar--expanded" : ""
        }`}
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
                <span>{isSidebarExpanded ? t("sidebar.hide") : t("sidebar.change")}</span>
                <ChevronDown aria-hidden="true" size={17} />
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
          <ProjectList
            projects={projects}
            projectActivity={projectActivity}
            isLoading={isLoadingProjects}
            loadingProjectId={loadingProjectId}
            selectedProjectId={selectedProjectId}
            isInteractionLocked={isEditing}
            onSelect={(project) => void handleProjectSelection(project)}
          />
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
          <div className="project-sidebar__feedback" aria-live="polite">
            {saveMessage && <p className="success-message">{saveMessage}</p>}
            {error && (
              <p className="error" role="alert">{error}</p>
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
            disabled={isSelecting || isCreating || isEditing}
          >
            <Plus aria-hidden="true" size={18} />
            {t("sidebar.newProject")}
          </button>
          <button
            className="project-sidebar__import-button"
            type="button"
            onClick={() => directoryInputRef.current?.click()}
            disabled={isSelecting || isCreating || isEditing}
          >
            <FolderInput aria-hidden="true" size={16} />
            {isSelecting ? t("sidebar.importing") : t("sidebar.import")}
          </button>
          <AgentEngineStatus />
        </footer>
      </aside>

      {isCreationDialogOpen && (
        <ProjectCreationDialog
          defaultParentDirectory={
            projects[0]?.directoryPath.replace(/[\\/][^\\/]+$/, "") ?? ""
          }
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
