import { Folder, Trash2 } from "lucide-react";

interface ProjectListProps {
  projects: string[];
  isLoading: boolean;
  deletingProjectPath: string | null;
  onDelete: (directoryPath: string) => void;
}

function getProjectName(directoryPath: string): string {
  const pathParts = directoryPath.split(/[\\/]/).filter(Boolean);
  return pathParts.at(-1) || directoryPath;
}

export function ProjectList({
  projects,
  isLoading,
  deletingProjectPath,
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
      {projects.map((directoryPath) => {
        const projectName = getProjectName(directoryPath);

        return (
          <li className="project-list__item" key={directoryPath} title={directoryPath}>
            <Folder aria-hidden="true" size={18} strokeWidth={1.8} />
            <span className="project-list__details">
              <strong>{projectName}</strong>
              <small>{directoryPath}</small>
            </span>
            <button
              className="project-list__delete-button"
              type="button"
              aria-label={`Supprimer ${projectName}`}
              title={`Supprimer ${projectName}`}
              onClick={() => onDelete(directoryPath)}
              disabled={deletingProjectPath === directoryPath}
            >
              <Trash2 aria-hidden="true" size={16} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
