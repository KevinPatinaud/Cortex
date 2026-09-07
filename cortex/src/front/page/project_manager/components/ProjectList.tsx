import { useState, type DragEvent, type KeyboardEvent } from "react";
import { Check, Folder, FolderInput, GripVertical, LoaderCircle } from "lucide-react";
import type { ProjectFolder } from "../../../../shared/ProjectOrganization.ts";
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
  onReorder: (projects: Project[]) => void;
  folders?: ProjectFolder[];
  folderId?: string | null;
  isFolderLocked?: boolean;
  onMove?: (project: Project, folderId: string | null) => Promise<boolean>;
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
  onReorder,
  folders = [],
  folderId = null,
  isFolderLocked = false,
  onMove
}: ProjectListProps) {
  const { t } = useTranslation();
  const [draggedProjectId, setDraggedProjectId] = useState<string | null>(null);
  const [movingProjectId, setMovingProjectId] = useState<string | null>(null);
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
                <Folder aria-hidden="true" size={18} strokeWidth={1.8} />
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
            {onMove && folders.length > 0 && (
              <button
                type="button"
                className="project-list__move-button"
                aria-label={t("folders.move", { name: projectName })}
                title={t("folders.move", { name: projectName })}
                aria-expanded={movingProjectId === project.id}
                aria-controls={`project-folder-picker-${project.id}`}
                disabled={isInteractionLocked || isFolderLocked}
                onClick={() => setMovingProjectId((current) => current === project.id ? null : project.id)}
              >
                <FolderInput aria-hidden="true" size={15} />
              </button>
            )}
            {onMove && movingProjectId === project.id && (
              <div className="project-list__folder-picker" id={`project-folder-picker-${project.id}`}>
                <label htmlFor={`project-folder-select-${project.id}`}>
                  {t("folders.destination", { name: projectName })}
                </label>
                <select
                  id={`project-folder-select-${project.id}`}
                  autoFocus
                  value={folderId ?? ""}
                  disabled={isInteractionLocked || isFolderLocked}
                  onKeyDown={(event) => {
                    if (event.key !== "Escape") return;
                    event.preventDefault();
                    const button = event.currentTarget.closest("li")?.querySelector<HTMLButtonElement>(".project-list__move-button");
                    setMovingProjectId(null);
                    button?.focus();
                  }}
                  onChange={async (event) => {
                    const select = event.currentTarget;
                    const destination = event.target.value || null;
                    if (await onMove(project, destination)) {
                      setMovingProjectId(null);
                      requestAnimationFrame(() => {
                        const row = Array.from(document.querySelectorAll<HTMLElement>("[data-project-id]"))
                          .find((candidate) => candidate.dataset.projectId === project.id);
                        row?.querySelector<HTMLButtonElement>(".project-list__move-button")?.focus();
                      });
                    } else {
                      requestAnimationFrame(() => { if (select.isConnected) select.focus(); });
                    }
                  }}
                >
                  <option value="">{t("folders.unfiled")}</option>
                  {folders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
                </select>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
