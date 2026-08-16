import { useEffect, useState } from "react";
import { LogOut } from "lucide-react";
import { AgentProjectWorkspace } from "./page/agent/components/AgentProjectWorkspace.tsx";
import { AgentProjectEditor } from "./page/agent/components/AgentProjectEditor.tsx";
import { LoginPage } from "./page/authentication/LoginPage.tsx";
import { ProjectDirectoryManager } from "./page/project_manager/components/ProjectDirectoryManager.tsx";
import type { ProjectActivityStatus } from "./page/project_manager/components/ProjectList.tsx";
import type { AgentProject } from "./services/agentApi.ts";
import type { Project } from "./services/projectApi.ts";
import { getAuthenticationStatus, logout } from "./services/authApi.ts";
import { useTranslation } from "./i18n.tsx";

interface ProjectSelection {
  project: Project;
  content: AgentProject;
  requiresInitialSave: boolean;
}

export function App() {
  const { t } = useTranslation();
  const [isAuthenticated, setIsAuthenticated] = useState<boolean | null>(null);
  const [isAuthenticationRequired, setIsAuthenticationRequired] = useState(false);
  const [selection, setSelection] = useState<ProjectSelection | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [deletedProject, setDeletedProject] = useState<{ id: string } | null>(null);
  const [projectActivity, setProjectActivity] = useState<
    Record<string, ProjectActivityStatus>
  >({});

  useEffect(() => {
    let isMounted = true;

    void getAuthenticationStatus()
      .then((status) => {
        if (isMounted) {
          setIsAuthenticated(status.authenticated);
          setIsAuthenticationRequired(status.required);
        }
      })
      .catch(() => {
        if (isMounted) {
          setIsAuthenticated(false);
        }
      });

    const handleUnauthorized = () => setIsAuthenticated(false);
    window.addEventListener("cortex:unauthorized", handleUnauthorized);

    return () => {
      isMounted = false;
      window.removeEventListener("cortex:unauthorized", handleUnauthorized);
    };
  }, []);

  if (isAuthenticated === null) {
    return <main className="login-page"><p>{t("common.loading")}</p></main>;
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

  return (
    <main>
      {isAuthenticationRequired && (
        <button
          className="logout-button"
          type="button"
          title={t("auth.logout")}
          aria-label={t("auth.logout")}
          onClick={() => void logout().finally(() => {
            setSelection(null);
            setIsAuthenticated(false);
          })}
        >
          <LogOut aria-hidden="true" size={17} />
        </button>
      )}
      <ProjectDirectoryManager
        activeProject={selection?.project ?? null}
        deletedProject={deletedProject}
        isEditing={isEditing}
        projectActivity={projectActivity}
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
      />
      {isEditing && selection ? (
        <AgentProjectEditor
          project={selection.project}
          content={selection.content}
          requiresInitialSave={selection.requiresInitialSave}
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
      ) : (
        <AgentProjectWorkspace
          project={selection?.project ?? null}
          content={selection?.content ?? null}
          onEdit={() => setIsEditing(true)}
          onContentRefresh={(content) => {
            setSelection((currentSelection) => currentSelection &&
                currentSelection.project.id === content.projectId
              ? { ...currentSelection, content }
              : currentSelection
            );
          }}
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
    </main>
  );
}
