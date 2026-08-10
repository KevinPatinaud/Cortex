import { type FormEvent, useEffect, useRef, useState } from "react";
import { FolderPlus } from "lucide-react";
import { AgentEngineStatus } from "../../agent/components/AgentEngineStatus.tsx";
import {
  getActualLoadedAgentProject,
  loadAgentProject,
  resetAgentProjectWorkflow,
  type AgentProject
} from "../../../services/agentApi.ts";
import {
  deleteProjectDirectory,
  getSavedProjects,
  type Project,
  saveProjectDirectory,
  selectProjectDirectory
} from "../../../services/projectApi.ts";
import { ConfirmationDialog } from "./ConfirmationDialog.tsx";
import { ProjectList } from "./ProjectList.tsx";

interface ProjectDirectoryManagerProps {
  onProjectLoaded: (project: Project, content: AgentProject) => void;
  onProjectCleared: (projectId: string) => void;
  onProjectWorkflowReset: (projectId: string) => void;
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
  onProjectLoaded,
  onProjectCleared,
  onProjectWorkflowReset
}: ProjectDirectoryManagerProps) {
  const directoryDialog = useRef<HTMLDialogElement>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [directoryPath, setDirectoryPath] = useState("");
  const [projects, setProjects] = useState<Project[]>([]);
  const [saveMessage, setSaveMessage] = useState("");
  const [error, setError] = useState("");
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);
  const [deletingProjectId, setDeletingProjectId] = useState<string | null>(null);
  const [resettingProjectId, setResettingProjectId] = useState<string | null>(null);
  const [loadingProjectId, setLoadingProjectId] = useState<string | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [isSelecting, setIsSelecting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [confirmation, setConfirmation] = useState<ProjectConfirmation | null>(
    null
  );

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

  useEffect(() => {
    if (isModalOpen && !directoryDialog.current?.open) {
      directoryDialog.current?.showModal();
    }
  }, [isModalOpen]);

  async function handleDirectorySelection(): Promise<void> {
    setIsSelecting(true);
    setError("");
    setSaveMessage("");

    try {
      const selectedDirectoryPath = await selectProjectDirectory();

      if (selectedDirectoryPath) {
        setDirectoryPath(selectedDirectoryPath);
        setIsModalOpen(true);
      }
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setIsSelecting(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setIsSaving(true);
    setError("");
    setSaveMessage("");

    try {
      const result = await saveProjectDirectory(directoryPath);
      setProjects(result.projects);
      setSaveMessage("Le repertoire du projet a ete enregistre.");
      setIsModalOpen(false);
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDeleteProject(project: Project): Promise<boolean> {
    setDeletingProjectId(project.id);
    setError("");
    setSaveMessage("");

    try {
      const result = await deleteProjectDirectory(project.directoryPath);
      setProjects(result.projects);
      setSaveMessage("Le projet a ete supprime.");

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
      onProjectWorkflowReset(project.id);
      setSaveMessage("Le workflow a ete reinitialise.");
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
      onProjectLoaded(project, content);
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setLoadingProjectId(null);
    }
  }

  function closeModal(): void {
    setError("");
    setIsModalOpen(false);
  }

  return (
    <>
      <aside className="project-sidebar" aria-label="Gestion des projets">
        <header className="project-sidebar__header">
          <p className="project-sidebar__eyebrow">Espace de travail</p>
          <div className="project-sidebar__title-row">
            <h2>Projets</h2>
            <span className="project-sidebar__count" aria-label={`${projects.length} projets`}>
              {projects.length}
            </span>
          </div>
        </header>

        <div className="project-sidebar__content">
          <ProjectList
            projects={projects}
            isLoading={isLoadingProjects}
            deletingProjectId={deletingProjectId}
            resettingProjectId={resettingProjectId}
            loadingProjectId={loadingProjectId}
            selectedProjectId={selectedProjectId}
            onSelect={(project) => void handleProjectSelection(project)}
            onResetWorkflow={(project) => openConfirmation("reset", project)}
            onDelete={(project) => openConfirmation("delete", project)}
          />
        </div>

        <footer className="project-sidebar__footer">
          <div className="project-sidebar__feedback" aria-live="polite">
            {saveMessage && <p className="success-message">{saveMessage}</p>}
            {error && !isModalOpen && !confirmation && (
              <p className="error" role="alert">{error}</p>
            )}
          </div>
          <button
            className="project-sidebar__add-button"
            type="button"
            onClick={handleDirectorySelection}
            disabled={isSelecting}
          >
            <FolderPlus aria-hidden="true" size={18} />
            {isSelecting ? "Ouverture..." : "Ajouter un projet"}
          </button>
          <AgentEngineStatus />
        </footer>
      </aside>

      {isModalOpen && (
        <dialog
          ref={directoryDialog}
          aria-labelledby="directory-dialog-title"
          onClose={closeModal}
        >
          <form onSubmit={handleSubmit}>
            <h2 id="directory-dialog-title">Repertoire du projet</h2>
            <p>Verifiez le repertoire selectionne avant de l'enregistrer.</p>
            <label htmlFor="directory-path">Chemin du repertoire</label>
            <input
              id="directory-path"
              type="text"
              value={directoryPath}
              readOnly
              required
            />
            {error && <p className="error" role="alert">{error}</p>}
            <div className="dialog-actions">
              <button
                className="secondary-button"
                type="button"
                onClick={closeModal}
              >
                Annuler
              </button>
              <button type="submit" disabled={isSaving}>
                {isSaving ? "Enregistrement..." : "Enregistrer"}
              </button>
            </div>
          </form>
        </dialog>
      )}

      {confirmation?.action === "reset" && (
        <ConfirmationDialog
          variant="reset"
          title="Réinitialiser le workflow ?"
          description="Vous vous appretez à réintialiser le workflow suivant :"
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
