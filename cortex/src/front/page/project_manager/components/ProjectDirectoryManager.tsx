import { useEffect, useState } from "react";
import { ChevronDown, FolderInput, Plus } from "lucide-react";
import { AgentEngineStatus } from "../../agent/components/AgentEngineStatus.tsx";
import {
  getActualLoadedAgentProject,
  loadAgentProject,
  resetAgentProjectWorkflow,
  type AgentProject
} from "../../../services/agentApi.ts";
import {
  createProject,
  deleteProjectDirectory,
  getSavedProjects,
  type CreateProjectInput,
  type Project,
  saveProjectDirectory,
  selectProjectInstructionsFile
} from "../../../services/projectApi.ts";
import { ConfirmationDialog } from "./ConfirmationDialog.tsx";
import { ProjectCreationDialog } from "./ProjectCreationDialog.tsx";
import {
  ProjectList,
  type ProjectActivityStatus
} from "./ProjectList.tsx";

interface ProjectDirectoryManagerProps {
  activeProject: Project | null;
  isEditing: boolean;
  projectActivity: Record<string, ProjectActivityStatus>;
  onProjectLoaded: (
    project: Project,
    content: AgentProject,
    openEditor?: boolean
  ) => void;
  onProjectCleared: (projectId: string) => void;
}

interface ProjectConfirmation {
  action: "reset" | "delete";
  project: Project;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Une erreur inattendue est survenue.";
}

function getProjectName(project: Project): string {
  return project.directoryPath.split(/[\\/]/).filter(Boolean).at(-1) ||
    project.directoryPath;
}

export function ProjectDirectoryManager({
  activeProject,
  isEditing,
  projectActivity,
  onProjectLoaded,
  onProjectCleared
}: ProjectDirectoryManagerProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [saveMessage, setSaveMessage] = useState("");
  const [error, setError] = useState("");
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);
  const [deletingProjectId, setDeletingProjectId] = useState<string | null>(null);
  const [resettingProjectId, setResettingProjectId] = useState<string | null>(null);
  const [loadingProjectId, setLoadingProjectId] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [isSelecting, setIsSelecting] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [isCreationDialogOpen, setIsCreationDialogOpen] = useState(false);
  const [isProjectMenuOpen, setIsProjectMenuOpen] = useState(false);
  const [confirmation, setConfirmation] = useState<ProjectConfirmation | null>(
    null
  );

  useEffect(() => {
    if (!activeProject) {
      return;
    }

    setProjects((currentProjects) => currentProjects.map((project) =>
      project.id === activeProject.id ? activeProject : project
    ));
  }, [activeProject]);

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
          setError(getErrorMessage(requestError));
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

  async function handleInstructionsFileSelection(): Promise<void> {
    setIsSelecting(true);
    setError("");
    setSaveMessage("");

    try {
      const selectedDirectoryPath = await selectProjectInstructionsFile();

      if (selectedDirectoryPath) {
        const result = await saveProjectDirectory(selectedDirectoryPath);
        setProjects(result.projects);
        setSaveMessage("Le projet a été ajouté depuis son fichier d'instructions.");
      }
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setIsSelecting(false);
    }
  }

  async function handleDeleteProject(project: Project): Promise<boolean> {
    setDeletingProjectId(project.id);
    setError("");
    setSaveMessage("");

    try {
      const result = await deleteProjectDirectory(project.directoryPath);
      setProjects(result.projects);
      setSaveMessage("Le projet a été supprimé.");

      if (selectedProjectId === project.id) {
        setSelectedProjectId(null);
        onProjectCleared(project.id);
      }

      return true;
    } catch (requestError) {
      setError(getErrorMessage(requestError));
      return false;
    } finally {
      setDeletingProjectId(null);
    }
  }

  async function handleResetWorkflow(project: Project): Promise<boolean> {
    setResettingProjectId(project.id);
    setError("");
    setSaveMessage("");

    try {
      await resetAgentProjectWorkflow(project.id);
      const content = await loadAgentProject(project.id);
      setSelectedProjectId(project.id);
      setIsProjectMenuOpen(false);
      onProjectLoaded(project, content);
      setSaveMessage("Les fichiers du projet ont été rechargés.");
      return true;
    } catch (requestError) {
      setError(getErrorMessage(requestError));
      return false;
    } finally {
      setResettingProjectId(null);
    }
  }

  function openConfirmation(
    action: ProjectConfirmation["action"],
    project: Project
  ): void {
    setError("");
    setSaveMessage("");
    setConfirmation({ action, project });
  }

  async function handleConfirmation(): Promise<void> {
    if (!confirmation) {
      return;
    }

    const succeeded = confirmation.action === "reset"
      ? await handleResetWorkflow(confirmation.project)
      : await handleDeleteProject(confirmation.project);

    if (succeeded) {
      setConfirmation(null);
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
      setError(getErrorMessage(requestError));
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
      setSaveMessage("Le projet est prêt. Créez maintenant votre premier agent.");
      onProjectLoaded(result.project, content, true);
      return { project: result.project, content };
    } catch (requestError) {
      setError(getErrorMessage(requestError));
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
        aria-label="Gestion des projets"
      >
        <header className="project-sidebar__header">
          <p className="project-sidebar__eyebrow">Espace de travail</p>
          <div className="project-sidebar__title-row">
            <h2>Projets</h2>
            <div className="project-sidebar__title-actions">
              <span className="project-sidebar__count" aria-label={`${projects.length} projets`}>
                {projects.length}
              </span>
              <button
                className="project-sidebar__toggle"
                type="button"
                aria-controls="project-sidebar-panel"
                aria-expanded={isSidebarExpanded}
                aria-label={isSidebarExpanded
                  ? "Masquer la liste des projets"
                  : "Afficher la liste des projets"
                }
                onClick={() => setIsProjectMenuOpen((isOpen) => !isOpen)}
              >
                <span>{isSidebarExpanded ? "Masquer" : "Changer"}</span>
                <ChevronDown aria-hidden="true" size={17} />
              </button>
            </div>
          </div>
          {selectedProject && (
            <p className="project-sidebar__current-project">
              {isEditing ? "Édition en cours" : "Projet actif"}
              <strong>{getProjectName(selectedProject)}</strong>
            </p>
          )}
        </header>

        <div className="project-sidebar__content" id="project-sidebar-panel">
          <ProjectList
            projects={projects}
            projectActivity={projectActivity}
            isLoading={isLoadingProjects}
            deletingProjectId={deletingProjectId}
            resettingProjectId={resettingProjectId}
            loadingProjectId={loadingProjectId}
            selectedProjectId={selectedProjectId}
            isInteractionLocked={isEditing}
            onSelect={(project) => void handleProjectSelection(project)}
            onResetWorkflow={(project) => openConfirmation("reset", project)}
            onDelete={(project) => openConfirmation("delete", project)}
          />
        </div>

        <footer className="project-sidebar__footer">
          <div className="project-sidebar__feedback" aria-live="polite">
            {saveMessage && <p className="success-message">{saveMessage}</p>}
            {error && !confirmation && (
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
            Nouveau projet
          </button>
          <button
            className="project-sidebar__import-button"
            type="button"
            onClick={handleInstructionsFileSelection}
            disabled={isSelecting || isCreating || isEditing}
          >
            <FolderInput aria-hidden="true" size={16} />
            {isSelecting ? "Ouverture..." : "Importer un projet existant"}
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

      {confirmation?.action === "reset" && (
        <ConfirmationDialog
          variant="reset"
          title="Réinitialiser le workflow ?"
          description="Vous vous apprêtez à réinitialiser le workflow suivant :"
          projectName={getProjectName(confirmation.project)}
          confirmLabel="Réinitialiser"
          pendingLabel="Réinitialisation..."
          isPending={resettingProjectId === confirmation.project.id}
          error={error || undefined}
          onCancel={() => {
            setError("");
            setConfirmation(null);
          }}
          onConfirm={() => void handleConfirmation()}
        />
      )}

      {confirmation?.action === "delete" && (
        <ConfirmationDialog
          variant="delete"
          title="Supprimer ce projet ?"
          description="Le projet sera retiré de Cortex. Les fichiers resteront présents sur le disque et ne seront pas supprimés."
          projectName={getProjectName(confirmation.project)}
          confirmLabel="Supprimer"
          pendingLabel="Suppression..."
          isPending={deletingProjectId === confirmation.project.id}
          error={error || undefined}
          onCancel={() => {
            setError("");
            setConfirmation(null);
          }}
          onConfirm={() => void handleConfirmation()}
        />
      )}
    </>
  );
}
