import { Folder, Trash2 } from "lucide-react";
import type { Project } from "../../../services/projectApi.ts";

interface ProjectListProps {
  projects: Project[];
  isLoading: boolean;
  deletingProjectId: string | null;
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

        return (
          <li
            className="project-list__item"
            key={project.id}
            title={project.directoryPath}
          >
            <Folder aria-hidden="true" size={18} strokeWidth={1.8} />
            <span className="project-list__details">
              <strong>{projectName}</strong>
              <small>{project.directoryPath}</small>
            </span>
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
