import { Folder, RotateCcw, Trash2 } from "lucide-react";
import type { Project } from "../../../services/projectApi.ts";

interface ProjectListProps {
  projects: Project[];
  isLoading: boolean;
  deletingProjectId: string | null;
  resettingProjectId: string | null;
  loadingProjectId: string | null;
  selectedProjectId: string | null;
  onSelect: (project: Project) => void;
  onResetWorkflow: (project: Project) => void;
  onDelete: (project: Project) => void;
}

function getProjectName(directoryPath: string): string {
  const pathParts = directoryPath.split(/[\\/]/).filter(Boolean);
  return pathParts.at(-1) || directoryPath;
}

export function ProjectList({
  projects,
  isLoading,
  deletingProjectId,
  resettingProjectId,
  loadingProjectId,
  selectedProjectId,
  onSelect,
  onResetWorkflow,
  onDelete
}: ProjectListProps) {
  if (isLoading) {
    return <p className="project-list__state">Chargement des projets...</p>;
  }

  if (projects.length === 0) {
    return (
      <p className="project-list__state">
        Aucun projet enregistre pour le moment.
      </p>
    );
  }

  return (
    <ul className="project-list">
      {projects.map((project) => {
        const projectName = getProjectName(project.directoryPath);
        const isSelected = selectedProjectId === project.id;
        const isProjectLoading = loadingProjectId === project.id;

        return (
          <li
            className={`project-list__item${isSelected ? " project-list__item--selected" : ""}`}
            key={project.id}
            title={project.directoryPath}
          >
            <button
              className="project-list__select-button"
              type="button"
              aria-pressed={isSelected}
              onClick={() => onSelect(project)}
              disabled={loadingProjectId !== null}
            >
              <Folder aria-hidden="true" size={18} strokeWidth={1.8} />
              <span className="project-list__details">
                <strong>{projectName}</strong>
                <small>
                  {isProjectLoading ? "Chargement..." : project.directoryPath}
                </small>
              </span>
            </button>
            <button
              className="project-list__reset-button"
              type="button"
              aria-label={`Reinitialiser le workflow de ${projectName}`}
              title={`Reinitialiser le workflow de ${projectName}`}
              onClick={() => onResetWorkflow(project)}
              disabled={resettingProjectId === project.id}
            >
              <RotateCcw aria-hidden="true" size={16} />
            </button>
            <button
              className="project-list__delete-button"
              type="button"
              aria-label={`Supprimer ${projectName}`}
              title={`Supprimer ${projectName}`}
              onClick={() => onDelete(project)}
              disabled={deletingProjectId === project.id}
            >
              <Trash2 aria-hidden="true" size={16} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
