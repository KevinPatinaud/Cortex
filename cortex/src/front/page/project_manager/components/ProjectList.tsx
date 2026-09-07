import { useState, type DragEvent, type KeyboardEvent } from "react";
import { Box, Check, GripVertical, LoaderCircle, Trash2 } from "lucide-react";
import type { Project } from "../../../services/projectApi.ts";
import { useTranslation } from "../../../i18n.tsx";

export type ProjectActivityStatus = "running" | "completed";

export interface ProjectListProps {
  projects: Project[];
  projectActivity: Record<string, ProjectActivityStatus>;
  isLoading: boolean;
  loadingProjectId: string | null;
  selectedProjectId: string | null;
  isInteractionLocked: boolean;
  isReorderLocked: boolean;
  onSelect: (project: Project) => void;
  onDelete: (project: Project, button: HTMLButtonElement) => void;
  onReorder: (projects: Project[]) => void;
}

export const projectDragType = "application/x-cortex-project";

type DropPosition = "before" | "after";

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
  isReorderLocked,
  onSelect,
  onDelete,
  onReorder
}: ProjectListProps) {
  const { t } = useTranslation();
  const [draggedProjectId, setDraggedProjectId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{
    projectId: string;
    position: DropPosition;
  } | null>(null);

  function clearDragState(): void {
    setDraggedProjectId(null);
    setDropTarget(null);
  }

  function moveProject(
    projectId: string,
    targetProjectId: string,
    position: DropPosition
  ): void {
    const sourceIndex = projects.findIndex((project) => project.id === projectId);
    if (sourceIndex < 0 || projectId === targetProjectId) {
      clearDragState();
      return;
    }

    const nextProjects = [...projects];
    const [movedProject] = nextProjects.splice(sourceIndex, 1);
    const targetIndex = nextProjects.findIndex(
      (project) => project.id === targetProjectId
    );

    if (!movedProject || targetIndex < 0) {
      clearDragState();
      return;
    }

    nextProjects.splice(
      targetIndex + (position === "after" ? 1 : 0),
      0,
      movedProject
    );
    clearDragState();

    if (nextProjects.some((project, index) => project.id !== projects[index]?.id)) {
      onReorder(nextProjects);
    }
  }

  function moveProjectWithKeyboard(
    event: KeyboardEvent<HTMLButtonElement>,
    projectId: string
  ): void {
    if (
      isReorderLocked ||
      isInteractionLocked ||
      !event.altKey ||
      (event.key !== "ArrowUp" && event.key !== "ArrowDown")
    ) {
      return;
    }

    event.preventDefault();
    const currentIndex = projects.findIndex((project) => project.id === projectId);
    const targetIndex = currentIndex + (event.key === "ArrowUp" ? -1 : 1);
    const targetProject = projects[targetIndex];

    if (currentIndex < 0 || !targetProject) {
      return;
    }

    moveProject(
      projectId,
      targetProject.id,
      event.key === "ArrowUp" ? "before" : "after"
    );
  }

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
      className={`project-list${draggedProjectId ? " project-list--dragging" : ""}`}
      aria-busy={loadingProjectId !== null}
    >
      {projects.map((project) => {
        const projectName = getProjectName(project.directoryPath);
        const isSelected = selectedProjectId === project.id;
        const isProjectLoading = loadingProjectId === project.id;
        const activityStatus = projectActivity[project.id];
        const isDropTarget = dropTarget?.projectId === project.id;

        return (
          <li
            className={`project-list__item${isSelected ? " project-list__item--selected" : ""}${
              draggedProjectId === project.id ? " project-list__item--dragging" : ""
            }${
              isDropTarget
                ? ` project-list__item--drop-${dropTarget.position}`
                : ""
            }`}
            key={project.id}
            data-project-id={project.id}
            draggable={!isInteractionLocked && !isReorderLocked}
            title={isReorderLocked ? undefined : t("project.reorderHelp")}
            onDragStart={(event: DragEvent<HTMLLIElement>) => {
              setDraggedProjectId(project.id);
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/plain", project.id);
              event.dataTransfer.setData(projectDragType, project.id);
              event.dataTransfer.setDragImage(event.currentTarget, 24, 24);
            }}
            onDragEnd={clearDragState}
            onDragOver={(event: DragEvent<HTMLLIElement>) => {
              if (!draggedProjectId || isInteractionLocked || isReorderLocked) {
                return;
              }

              event.preventDefault();
              event.dataTransfer.dropEffect = "move";
              const bounds = event.currentTarget.getBoundingClientRect();
              setDropTarget({
                projectId: project.id,
                position: event.clientY < bounds.top + bounds.height / 2
                  ? "before"
                  : "after"
              });
            }}
            onDrop={(event: DragEvent<HTMLLIElement>) => {
              if (draggedProjectId && dropTarget && !isInteractionLocked && !isReorderLocked) {
                event.preventDefault();
                event.stopPropagation();
                moveProject(
                  draggedProjectId,
                  dropTarget.projectId,
                  dropTarget.position
                );
              }
            }}
          >
            <span
              className={`project-list__drag-handle${isReorderLocked
                ? " project-list__drag-handle--disabled"
                : ""}`}
              aria-hidden="true"
              title={isReorderLocked ? undefined : t("project.reorderHelp")}
            >
              <GripVertical size={15} />
            </span>
            <button
              className="project-list__select-button"
              type="button"
              aria-busy={isProjectLoading}
              aria-current={isSelected ? "page" : undefined}
              aria-keyshortcuts={isReorderLocked ? undefined : "Alt+ArrowUp Alt+ArrowDown"}
              title={project.directoryPath}
              onClick={() => onSelect(project)}
              onKeyDown={(event) => moveProjectWithKeyboard(event, project.id)}
              disabled={loadingProjectId !== null || isInteractionLocked}
            >
              {isProjectLoading ? (
                <LoaderCircle
                  className="project-list__loading-icon"
                  aria-hidden="true"
                  size={18}
                  strokeWidth={1.8}
                />
              ) : (
                <Box aria-hidden="true" size={18} strokeWidth={1.8} />
              )}
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
              </span>
            </button>
            <button
              className="project-list__delete-button"
              type="button"
              aria-label={t("project.deleteAria", { name: projectName })}
              title={t("project.deleteAria", { name: projectName })}
              disabled={loadingProjectId !== null || isInteractionLocked}
              onClick={(event) => onDelete(project, event.currentTarget)}
            >
              <Trash2 aria-hidden="true" size={16} />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
