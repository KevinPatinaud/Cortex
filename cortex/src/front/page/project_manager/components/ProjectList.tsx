import { Folder } from "lucide-react";

interface ProjectListProps {
  projects: string[];
  isLoading: boolean;
}

function getProjectName(directoryPath: string): string {
  const pathParts = directoryPath.split(/[\\/]/).filter(Boolean);
  return pathParts.at(-1) || directoryPath;
}

export function ProjectList({ projects, isLoading }: ProjectListProps) {
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
      {projects.map((directoryPath) => (
        <li className="project-list__item" key={directoryPath} title={directoryPath}>
          <Folder aria-hidden="true" size={18} strokeWidth={1.8} />
          <span>
            <strong>{getProjectName(directoryPath)}</strong>
            <small>{directoryPath}</small>
          </span>
        </li>
      ))}
    </ul>
  );
}
