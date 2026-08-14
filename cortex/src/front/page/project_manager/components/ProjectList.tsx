import { Check, Folder, LoaderCircle, RotateCcw, Trash2 } from "lucide-react";
import type { Project } from "../../../services/projectApi.ts";

export type ProjectActivityStatus = "running" | "completed";

interface ProjectListProps {
  projects: Project[];
  projectActivity: Record<string, ProjectActivityStatus>;
  isLoading: boolean;
  deletingProjectId: string | null;
  resettingProjectId: string | null;
  loadingProjectId: string | null;
  selectedProjectId: string | null;
  isInteractionLocked: boolean;
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
  projectActivity,
  isLoading,
  deletingProjectId,
  resettingProjectId,
  loadingProjectId,
  selectedProjectId,
  isInteractionLocked,
  onSelect,
  onResetWorkflow,
  onDelete
}: ProjectListProps) {
  if (isLoading) {
    return (
      <p className="project-list__state" aria-busy="true">
        Chargement des projets...
      </p>
    );
  }

  if (projects.length === 0) {
    return (
      <p className="project-list__state">
        Aucun projet enregistré pour le moment.
      </p>
    );
  }

  return (
    <ul
      className="project-list"
      aria-busy={loadingProjectId !== null}
    >
      {projects.map((project) => {
        const projectName = getProjectName(project.directoryPath);
        const isSelected = selectedProjectId === project.id;
        const isProjectLoading = loadingProjectId === project.id;
        const activityStatus = projectActivity[project.id];

        return (
          <li
            className={`project-list__item${isSelected ? " project-list__item--selected" : ""}`}
            key={project.id}
            title={project.directoryPath}
          >
            <button
              className="project-list__select-button"
              type="button"
              aria-busy={isProjectLoading}
              aria-pressed={isSelected}
              onClick={() => onSelect(project)}
              disabled={loadingProjectId !== null || isInteractionLocked}
            >
              <Folder aria-hidden="true" size={18} strokeWidth={1.8} />
              <span className="project-list__details">
                <span className="project-list__name-row">
                  <strong>{projectName}</strong>
                  {activityStatus && (
                    <span
                      className={`project-list__activity project-list__activity--${activityStatus}`}
                      role="status"
                      title={activityStatus === "running"
                        ? "Un agent est en cours d'exécution"
                        : "Un agent a terminé, résultat à consulter"}
                    >
                      {activityStatus === "running" ? (
                        <LoaderCircle aria-hidden="true" size={12} />
                      ) : (
                        <Check aria-hidden="true" size={12} />
                      )}
                      <span>
                        {activityStatus === "running" ? "En cours" : "À voir"}
                      </span>
                    </span>
                  )}
                </span>
                <small>
                  {isProjectLoading ? "Chargement..." : project.directoryPath}
                </small>
              </span>
            </button>
            <button
              className="project-list__reset-button"
              type="button"
              aria-label={`Réinitialiser le workflow de ${projectName}`}
              title={`Réinitialiser le workflow de ${projectName}`}
              onClick={() => onResetWorkflow(project)}
              disabled={resettingProjectId === project.id || isInteractionLocked}
            >
              <RotateCcw aria-hidden="true" size={16} />
            </button>
            <button
              className="project-list__delete-button"
              type="button"
              aria-label={`Supprimer ${projectName}`}
              title={`Supprimer ${projectName}`}
              onClick={() => onDelete(project)}
              disabled={deletingProjectId === project.id || isInteractionLocked}
            >
              <Trash2 aria-hidden="true" size={16} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
