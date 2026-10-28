import { lazy, Suspense, useCallback, useEffect, useState } from "react";
import { LogOut } from "lucide-react";
import { AgentProjectWorkspace } from "./page/agent/components/AgentProjectWorkspace.tsx";
import { LoginPage } from "./page/authentication/LoginPage.tsx";
import { ProjectDirectoryManager } from "./page/project_manager/components/ProjectDirectoryManager.tsx";
import type { ProjectActivityStatus } from "./page/project_manager/components/ProjectList.tsx";
import type { AgentProject } from "./services/agentApi.ts";
import type { Project } from "./services/projectApi.ts";
import { getAuthenticationStatus, logout } from "./services/authApi.ts";
import { useTranslation } from "./i18n.tsx";
import "./page/prompt_queue/promptQueue.css";

const AgentProjectEditor = lazy(() => import("./page/agent/components/AgentProjectEditor.tsx")
  .then((module) => ({ default: module.AgentProjectEditor })));
const PromptQueueWorkspace = lazy(() => import("./page/prompt_queue/PromptQueueWorkspace.tsx")
  .then(module => ({ default: module.PromptQueueWorkspace })));
const WorkLightWorkspace = lazy(() => import("./page/work_light/WorkLightWorkspace.tsx").then(module => ({ default: module.WorkLightWorkspace })));
const WorkForceWorkspace = lazy(() => import("./page/work_force/WorkForceWorkspace.tsx")
  .then(module => ({ default: module.WorkForceWorkspace })));

interface ProjectSelection {
  project: Project;
  content: AgentProject;
  requiresInitialSave: boolean;
}

export function App() {
  const { t } = useTranslation();
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [hasConnectionError, setHasConnectionError] = useState(false);
  const [connectionAttempt, setConnectionAttempt] = useState(0);
  const [isAuthenticationRequired, setIsAuthenticationRequired] = useState(false);
  const [selection, setSelection] = useState<ProjectSelection | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [promptMode, setPromptMode] = useState(() => new URL(window.location.href).searchParams.get("mode") === "prompts");
  const [workLightMode, setWorkLightMode] = useState(() => new URL(window.location.href).searchParams.get("mode") === "work-light");
  const [workForceMode, setWorkForceMode] = useState(() => new URL(window.location.href).searchParams.get("mode") === "work-force");
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [creationRequest, setCreationRequest] = useState(0);
  const [deletedProject, setDeletedProject] = useState<{ id: string } | null>(null);
  const [projectActivity, setProjectActivity] = useState<
    Record<string, ProjectActivityStatus>
  >({});
  const confirmProjectChange = useCallback(() => !hasUnsavedChanges ||
    window.confirm(t("editor.leaveWithDraftConfirm")), [hasUnsavedChanges, t]);
  function changeMode(prompts: boolean, workForce = false, workLight = false) {
    if (!confirmProjectChange()) return;
    setPromptMode(prompts);
    setWorkForceMode(workForce); setWorkLightMode(workLight);
    const url = new URL(window.location.href);
    if (workLight) { url.searchParams.set("mode", "work-light"); url.searchParams.delete("chat"); }
    else if (workForce) { url.searchParams.set("mode", "work-force"); url.searchParams.delete("chat"); }
    else if (prompts) url.searchParams.set("mode", "prompts");
    else { url.searchParams.delete("mode"); url.searchParams.delete("chat"); }
    window.history.pushState(window.history.state, "", url);
  }
  useEffect(() => {
    const sync = () => {
      const mode = new URL(window.location.href).searchParams.get("mode");
      setPromptMode(mode === "prompts"); setWorkForceMode(mode === "work-force"); setWorkLightMode(mode === "work-light");
    };
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);
  const refreshContent = useCallback((content: AgentProject) => {
    setProjectActivity(current => {
      if (content.workflowInstance?.status === "running" || content.agents.some(agent => agent.executionStatus === "running")) {
        return { ...current, [content.projectId]: "running" };
      }
      if (!current[content.projectId]) return current;
      const next = { ...current };
      delete next[content.projectId];
      return next;
    });
    setSelection((currentSelection) => currentSelection &&
        currentSelection.project.id === content.projectId
      ? { ...currentSelection, content }
      : currentSelection);
  }, []);

  useEffect(() => {
    let isMounted = true;
    setHasConnectionError(false);

    void getAuthenticationStatus()
      .then((status) => {
        if (isMounted) {
          setIsAuthenticated(status.authenticated);
          setIsAuthenticationRequired(status.required);
        }
      })
      .catch(() => {
        if (isMounted) {
          setHasConnectionError(true);
        }
      });

    const handleUnauthorized = () => setIsAuthenticated(false);
    window.addEventListener("cortex:unauthorized", handleUnauthorized);

    return () => {
      isMounted = false;
      window.removeEventListener("cortex:unauthorized", handleUnauthorized);
    };
  }, [connectionAttempt]);

  useEffect(() => {
    if (workLightMode) { document.title = "Work Light · Cortex"; return; }
    if (workForceMode) { document.title = "Work Force · Cortex"; return; }
    if (promptMode) { document.title = "Chats et prompts · Cortex"; return; }
    const projectName = selection?.project.directoryPath
      .split(/[\\/]/)
      .filter(Boolean)
      .at(-1);
    document.title = projectName ? `${projectName} · Cortex` : "Cortex";
  }, [selection?.project.directoryPath, promptMode, workForceMode, workLightMode]);

  if (hasConnectionError) {
    return (
      <main className="login-page">
        <section className="login-card connection-state" aria-labelledby="connection-title">
          <h1 id="connection-title">{t("auth.connectionTitle")}</h1>
          <p className="login-card__description" role="alert">{t("auth.connectionError")}</p>
          <button type="button" onClick={() => setConnectionAttempt((attempt) => attempt + 1)}>
            {t("project.retry")}
          </button>
        </section>
      </main>
    );
  }

  if (isAuthenticated === null) {
    return <main className="login-page" aria-busy="true"><p role="status">{t("common.loading")}</p></main>;
  }

  if (!isAuthenticated) {
    return <LoginPage onAuthenticated={() => setIsAuthenticated(true)} />;
  }

  function clearProjectActivity(projectId: string): void {
    setProjectActivity((currentActivity) => {
      if (!currentActivity[projectId]) {
        return currentActivity;
      }

      const nextActivity = { ...currentActivity };
      delete nextActivity[projectId];
      return nextActivity;
    });
  }

  if (workLightMode) return <Suspense fallback={<main className="login-page" aria-busy="true"><p role="status">{t("common.loading")}</p></main>}>
    <WorkLightWorkspace onNormal={() => changeMode(false)} onPrompts={() => changeMode(true)} onWorkForce={() => changeMode(false, true)} />
  </Suspense>;

  if (workForceMode) return <Suspense fallback={<main className="login-page" aria-busy="true"><p role="status">{t("common.loading")}</p></main>}>
    <WorkForceWorkspace onWorkLight={() => changeMode(false, false, true)} onNormal={() => changeMode(false)} onPrompts={() => changeMode(true)} />
  </Suspense>;

  if (promptMode) return <Suspense fallback={<main className="login-page" aria-busy="true"><p role="status">{t("common.loading")}</p></main>}>
    <PromptQueueWorkspace onWorkflows={() => changeMode(false)} />
  </Suspense>;

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">{t("navigation.skipToContent")}</a>
      {isAuthenticationRequired && (
        <button
          className="logout-button"
          type="button"
          title={t("auth.logout")}
          aria-label={t("auth.logout")}
          onClick={() => {
            if (!confirmProjectChange()) return;
            void logout().finally(() => {
              setSelection(null);
              setIsAuthenticated(false);
            });
          }}
        >
          <LogOut aria-hidden="true" size={17} />
        </button>
      )}
      <ProjectDirectoryManager
        onOpenWorkLight={() => changeMode(false, false, true)}
        onOpenWorkForce={() => changeMode(false, true)}
        onOpenPromptQueue={() => changeMode(true)}
        activeProject={selection?.project ?? null}
        deletedProject={deletedProject}
        isEditing={isEditing}
        projectActivity={projectActivity}
        onBeforeProjectChange={confirmProjectChange}
        onProjectDeleted={(projectId) => {
          clearProjectActivity(projectId);
          setDeletedProject({ id: projectId });
          if (selection?.project.id === projectId) {
            setIsEditing(false);
            setSelection(null);
          }
        }}
        creationRequest={creationRequest}
        onProjectLoaded={(
          project,
          content,
          openEditor = false,
          requiresInitialSave = false
        ) => {
          setSelection({ project, content, requiresInitialSave });
          setIsEditing(openEditor);
          if (content.agents.some(
            (agent) => agent.executionStatus === "running"
          )) {
            setProjectActivity((currentActivity) => ({
              ...currentActivity,
              [project.id]: "running"
            }));
          } else {
            clearProjectActivity(project.id);
          }
        }}
        onProjectCleared={() => {
          setSelection(null);
          setIsEditing(false);
        }}
      />
      {isEditing && selection ? (
        <Suspense fallback={<main id="main-content" tabIndex={-1} className="workspace-content" aria-busy="true"><p role="status">{t("common.loading")}</p></main>}>
        <AgentProjectEditor
          key={selection.project.id}
          project={selection.project}
          content={selection.content}
          requiresInitialSave={selection.requiresInitialSave}
          onDirtyChange={setHasUnsavedChanges}
          onClose={() => setIsEditing(false)}
          onSaved={(content) => {
            setSelection((currentSelection) => currentSelection &&
                currentSelection.project.id === content.projectId
              ? {
                  project: {
                    ...currentSelection.project,
                    directoryPath: content.directoryPath
                  },
                  content,
                  requiresInitialSave: false
                }
              : currentSelection
            );
          }}
          onDeleted={(projectId) => {
            clearProjectActivity(projectId);
            setDeletedProject({ id: projectId });
            setIsEditing(false);
            setSelection(null);
          }}
        />
        </Suspense>
      ) : (
        <AgentProjectWorkspace
          project={selection?.project ?? null}
          content={selection?.content ?? null}
          onEdit={() => setIsEditing(true)}
          onCreateProject={() => setCreationRequest((request) => request + 1)}
          onContentRefresh={refreshContent}
          onRunStateChange={(projectId, status) => {
            setProjectActivity((currentActivity) => {
              if (status === "completed" && selection?.project.id === projectId) {
                const nextActivity = { ...currentActivity };
                delete nextActivity[projectId];
                return nextActivity;
              }

              if (status === "idle") {
                const nextActivity = { ...currentActivity };
                delete nextActivity[projectId];
                return nextActivity;
              }

              return { ...currentActivity, [projectId]: status };
            });
          }}
        />
      )}
    </div>
  );
}
