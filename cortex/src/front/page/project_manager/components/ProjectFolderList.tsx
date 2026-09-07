import { useEffect, useRef, useState, type DragEvent, type FormEvent } from "react";
import { ChevronDown, ChevronRight, Folder, FolderOpen, FolderPlus, Pencil, Trash2 } from "lucide-react";
import type { ProjectFolder, ProjectOrganization } from "../../../../shared/ProjectOrganization.ts";
import { useTranslation } from "../../../i18n.tsx";
import type { Project } from "../../../services/projectApi.ts";
import { ApiRequestError } from "../../../services/apiClient.ts";
import { createProjectFolder, deleteProjectFolder, getProjectFolders, moveProjectToFolder, renameProjectFolder } from "../../../services/projectFolderApi.ts";
import { ProjectList, projectDragType, type ProjectListProps } from "./ProjectList.tsx";

interface ProjectFolderListProps extends ProjectListProps {
  search: string;
  onClearSearch: () => void;
}

function projectName(project: Project): string {
  return project.directoryPath.split(/[\\/]/).filter(Boolean).at(-1) || project.directoryPath;
}

export function ProjectFolderList({ search, onClearSearch, ...listProps }: ProjectFolderListProps) {
  const { t } = useTranslation();
  const [organization, setOrganization] = useState<ProjectOrganization>({ folders: [], projectFolders: {} });
  const [isLoading, setIsLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [editor, setEditor] = useState<{ id: string | null; name: string } | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [dropFolderId, setDropFolderId] = useState<string | null>(null);
  const pendingRef = useRef(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const newFolderRef = useRef<HTMLButtonElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const query = search.trim().toLocaleLowerCase();
  const isLocked = listProps.isInteractionLocked || listProps.isLoading || isLoading || isSaving || loadFailed;

  useEffect(() => {
    let mounted = true;
    setIsLoading(true);
    setError("");
    void getProjectFolders().then((result) => {
      if (!mounted) return;
      setOrganization(result);
      setLoadFailed(false);
    }).catch((cause: unknown) => {
      if (!mounted) return;
      setLoadFailed(true);
      setError(t(cause instanceof ApiRequestError && cause.status === 404
        ? "folders.serverRestartRequired"
        : "folders.loadError"));
    }).finally(() => { if (mounted) setIsLoading(false); });
    return () => { mounted = false; };
  }, [loadAttempt]);

  useEffect(() => {
    if (editor !== null) nameRef.current?.focus();
  }, [editor?.id, editor === null]);

  const activeFolderId = listProps.selectedProjectId
    ? organization.projectFolders[listProps.selectedProjectId]
    : undefined;
  useEffect(() => {
    if (activeFolderId) setCollapsed((current) => {
      const next = new Set(current);
      next.delete(activeFolderId);
      return next;
    });
  }, [activeFolderId, listProps.selectedProjectId]);

  function focusFolder(folderId: string | null): void {
    requestAnimationFrame(() => {
      const section = Array.from(rootRef.current?.querySelectorAll<HTMLElement>("[data-folder-id]") ?? [])
        .find((candidate) => candidate.dataset.folderId === folderId);
      const button = section?.querySelector<HTMLButtonElement>(".project-folder__toggle");
      (button ?? newFolderRef.current)?.focus();
    });
  }

  async function mutate(operation: () => Promise<ProjectOrganization>, success: string): Promise<ProjectOrganization | null> {
    if (isLocked || pendingRef.current) return null;
    pendingRef.current = true;
    setIsSaving(true);
    setError("");
    setMessage("");
    try {
      const result = await operation();
      setOrganization(result);
      setMessage(success);
      return result;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t("folders.saveError"));
      return null;
    } finally {
      pendingRef.current = false;
      setIsSaving(false);
    }
  }

  function cancelEditor(): void {
    const previousId = editor?.id ?? null;
    setEditor(null);
    setError("");
    focusFolder(previousId);
  }

  async function saveFolder(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!editor || isLocked) return;
    const name = editor.name.trim();
    if (!name) {
      setError(t("folders.nameRequired"));
      nameRef.current?.focus();
      return;
    }
    if (organization.folders.some((folder) => folder.id !== editor.id && folder.name.toLocaleLowerCase() === name.toLocaleLowerCase())) {
      setError(t("folders.duplicate"));
      nameRef.current?.focus();
      return;
    }
    const result = await mutate(
      () => editor.id ? renameProjectFolder(editor.id, name) : createProjectFolder(name),
      t(editor.id ? "folders.renamed" : "folders.created")
    );
    if (result) {
      setEditor(null);
      onClearSearch();
      focusFolder(editor.id ?? result.folders.find((folder) => !organization.folders.some((previous) => previous.id === folder.id))?.id ?? null);
    } else {
      requestAnimationFrame(() => nameRef.current?.focus());
    }
  }

  async function moveProject(project: Project, folderId: string | null): Promise<boolean> {
    if ((organization.projectFolders[project.id] ?? null) === folderId) return true;
    const result = await mutate(() => moveProjectToFolder(project.id, folderId), t("folders.moved", { name: projectName(project) }));
    if (result) {
      onClearSearch();
      setCollapsed((current) => {
        const next = new Set(current);
        next.delete(folderId ?? "");
        return next;
      });
    }
    return result !== null;
  }

  function acceptDrop(event: DragEvent, folderId: string): void {
    if (isLocked || listProps.isReorderLocked || !event.dataTransfer.types.includes(projectDragType)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDropFolderId(folderId);
  }

  function dropProject(event: DragEvent, folderId: string): void {
    setDropFolderId(null);
    if (isLocked || listProps.isReorderLocked || !event.dataTransfer.types.includes(projectDragType)) return;
    event.preventDefault();
    event.stopPropagation();
    const id = event.dataTransfer.getData(projectDragType);
    const project = listProps.projects.find((candidate) => candidate.id === id);
    if (project) void moveProject(project, folderId || null);
  }

  function renderProjects(projects: Project[], folderId: string | null) {
    return <ProjectList
      {...listProps}
      projects={projects}
      isInteractionLocked={listProps.isInteractionLocked || isSaving}
      isReorderLocked={listProps.isReorderLocked || isLoading || loadFailed}
      folders={organization.folders}
      folderId={folderId}
      isFolderLocked={isLocked}
      onMove={moveProject}
      onReorder={(reordered) => {
        const ids = new Set(projects.map((project) => project.id));
        let index = 0;
        listProps.onReorder(listProps.projects.map((project) => ids.has(project.id) ? reordered[index++]! : project));
      }}
    />;
  }

  function renderFolder(folder: ProjectFolder | null, projects: Project[]) {
    const id = folder?.id ?? "";
    const name = folder?.name ?? t("folders.unfiled");
    const isOpen = Boolean(query) || !collapsed.has(id);
    return <section
      key={id}
      data-folder-id={id}
      className={`project-folder${dropFolderId === id ? " project-folder--drop-target" : ""}`}
      onDragOver={(event) => acceptDrop(event, id)}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropFolderId(null);
      }}
      onDrop={(event) => dropProject(event, id)}
    >
      <div className="project-folder__header">
        <button
          type="button"
          className="project-folder__toggle"
          aria-expanded={isOpen}
          aria-controls={`project-folder-content-${id || "root"}`}
          title={name}
          onClick={() => setCollapsed((current) => {
            const next = new Set(current);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
          })}
        >
          {isOpen ? <ChevronDown aria-hidden="true" size={14} /> : <ChevronRight aria-hidden="true" size={14} />}
          {isOpen ? <FolderOpen aria-hidden="true" size={16} /> : <Folder aria-hidden="true" size={16} />}
          <span>{name}</span>
          <small>{projects.length}</small>
        </button>
        {folder && <div className="project-folder__actions">
          <button type="button" aria-label={t("folders.rename", { name })} title={t("folders.rename", { name })}
            disabled={isLocked} onClick={() => { setError(""); setEditor({ id, name }); }}>
            <Pencil aria-hidden="true" size={13} />
          </button>
          <button type="button" aria-label={t("folders.delete", { name })} title={t("folders.deleteHelp")}
            disabled={isLocked} onClick={async () => {
              if (await mutate(() => deleteProjectFolder(id), t("folders.deleted"))) {
                if (editor?.id === id) setEditor(null);
                focusFolder(null);
              }
            }}>
            <Trash2 aria-hidden="true" size={13} />
          </button>
        </div>}
      </div>
      <div id={`project-folder-content-${id || "root"}`} hidden={!isOpen}>
        {projects.length > 0 ? renderProjects(projects, folder?.id ?? null)
          : <p className="project-folder__empty">{t("folders.empty")}</p>}
      </div>
    </section>;
  }

  const folders = organization.folders.map((folder) => ({
    folder,
    projects: listProps.projects.filter((project) => organization.projectFolders[project.id] === folder.id &&
      (!query || folder.name.toLocaleLowerCase().includes(query) || projectName(project).toLocaleLowerCase().includes(query)))
  })).filter(({ folder, projects }) => !query || projects.length > 0 || folder.name.toLocaleLowerCase().includes(query));
  const folderIds = new Set(organization.folders.map((folder) => folder.id));
  const unfiled = listProps.projects.filter((project) => !folderIds.has(organization.projectFolders[project.id] ?? "") &&
    (!query || projectName(project).toLocaleLowerCase().includes(query)));

  return <div className="project-folders" ref={rootRef} onDragEnd={() => setDropFolderId(null)}>
    <button type="button" className="project-folders__create" ref={newFolderRef} disabled={isLocked}
      onClick={() => { setError(""); setMessage(""); setEditor({ id: null, name: "" }); }}>
      <FolderPlus aria-hidden="true" size={16} />{t("folders.new")}
    </button>
    {editor && <form className="project-folders__form" onSubmit={(event) => void saveFolder(event)}
      onKeyDown={(event) => { if (event.key === "Escape" && !isSaving) { event.preventDefault(); cancelEditor(); } }}>
      <label htmlFor="project-folder-name">{t("folders.name")}</label>
      <input id="project-folder-name" ref={nameRef} value={editor.name} maxLength={80} required disabled={isLocked}
        onChange={(event) => { setEditor({ ...editor, name: event.target.value }); setError(""); }} />
      <div>
        <button type="submit" disabled={isLocked || !editor.name.trim()}>{t(isSaving ? "common.saving" : editor.id ? "common.save" : "folders.create")}</button>
        <button type="button" disabled={isSaving} onClick={cancelEditor}>{t("common.cancel")}</button>
      </div>
    </form>}
    {error && <div className="project-folders__error" role="alert">
      <p>{error}</p>
      {loadFailed && <button type="button" disabled={isLoading} onClick={() => setLoadAttempt((attempt) => attempt + 1)}>{t("project.retry")}</button>}
    </div>}
    {message && <p className="project-folders__message" role="status">{message}</p>}
    {listProps.isLoading || isLoading ? <p className="project-list__state" aria-busy="true">{t("project.loadingList")}</p>
      : query && folders.length === 0 && unfiled.length === 0 ? <p className="project-list__state" role="status">{t("sidebar.noSearchResult")}</p>
      : <>
        {folders.map(({ folder, projects }) => renderFolder(folder, projects))}
        {organization.folders.length > 0 ? ((!query || unfiled.length > 0) && renderFolder(null, unfiled)) : renderProjects(unfiled, null)}
      </>}
  </div>;
}
