import { Check, Folder, LoaderCircle } from "lucide-react";
import type { Project } from "../../../services/projectApi.ts";
import { useTranslation } from "../../../i18n.tsx";

export type ProjectActivityStatus = "running" | "completed";

interface ProjectListProps {
  projects: Project[];
  projectActivity: Record<string, ProjectActivityStatus>;
  isLoading: boolean;
  loadingProjectId: string | null;
  selectedProjectId: string | null;
  isInteractionLocked: boolean;
  onSelect: (project: Project) => void;
}

function getProjectName(directoryPath: string): string {
  const pathParts = directoryPath.split(/[\\/]/).filter(Boolean);
  return pathParts.at(-1) || directoryPath;
}

export function ProjectList({
  projects,
  projectActivity,
  isLoading,
  loadingProjectId,
  selectedProjectId,
  isInteractionLocked,
  onSelect
}: ProjectListProps) {
  const { t } = useTranslation();

  if (isLoading) {
    return (
      <p className="project-list__state" aria-busy="true">
        {t("project.loadingList")}
      </p>
    );
  }

  if (projects.length === 0) {
    return (
      <p className="project-list__state">
        {t("project.emptyList")}
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
                        ? t("project.agentRunning")
                        : t("project.agentCompleted")}
                    >
                      {activityStatus === "running" ? (
                        <LoaderCircle aria-hidden="true" size={12} />
                      ) : (
                        <Check aria-hidden="true" size={12} />
                      )}
                      <span>
                        {activityStatus === "running" ? t("project.running") : t("project.review")}
                      </span>
                    </span>
                  )}
                </span>
                <small>
                  {isProjectLoading ? t("common.loading") : project.directoryPath}
                </small>
              </span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
