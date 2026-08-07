import { type FormEvent, useEffect, useRef, useState } from "react";
import { FolderPlus } from "lucide-react";
import {
  deleteProjectDirectory,
  getSavedProjects,
  saveProjectDirectory,
  selectProjectDirectory
} from "../../../services/projectApi.ts";
import { ProjectList } from "./ProjectList.tsx";

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Une erreur inattendue est survenue.";
}

export function ProjectDirectoryManager() {
  const directoryDialog = useRef<HTMLDialogElement>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [directoryPath, setDirectoryPath] = useState("");
  const [projects, setProjects] = useState<string[]>([]);
  const [saveMessage, setSaveMessage] = useState("");
  const [error, setError] = useState("");
  const [isLoadingProjects, setIsLoadingProjects] = useState(true);
  const [deletingProjectPath, setDeletingProjectPath] = useState<string | null>(null);
  const [isSelecting, setIsSelecting] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function loadProjects(): Promise<void> {
      try {
        const savedProjects = await getSavedProjects();

        if (isMounted) {
          setProjects(savedProjects);
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

  async function handleDeleteProject(projectPath: string): Promise<void> {
    const projectName = projectPath.split(/[\\/]/).filter(Boolean).at(-1) || projectPath;
    const deletionConfirmed = window.confirm(
      `Supprimer le projet « ${projectName} » de la liste ?`
    );

    if (!deletionConfirmed) {
      return;
    }

    setDeletingProjectPath(projectPath);
    setError("");
    setSaveMessage("");

    try {
      const result = await deleteProjectDirectory(projectPath);
      setProjects(result.projects);
      setSaveMessage("Le projet a ete supprime.");
    } catch (requestError) {
      setError(getErrorMessage(requestError));
    } finally {
      setDeletingProjectPath(null);
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
            deletingProjectPath={deletingProjectPath}
            onDelete={(projectPath) => void handleDeleteProject(projectPath)}
          />
        </div>

        <footer className="project-sidebar__footer">
          <div className="project-sidebar__feedback" aria-live="polite">
            {saveMessage && <p className="success-message">{saveMessage}</p>}
            {error && !isModalOpen && <p className="error" role="alert">{error}</p>}
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
    </>
  );
}
