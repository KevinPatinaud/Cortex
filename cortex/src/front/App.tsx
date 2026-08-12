import { useState } from "react";
import { AgentProjectWorkspace } from "./page/agent/components/AgentProjectWorkspace.tsx";
import { ProjectDirectoryManager } from "./page/project_manager/components/ProjectDirectoryManager.tsx";
import type { ProjectActivityStatus } from "./page/project_manager/components/ProjectList.tsx";
import type { AgentProject } from "./services/agentApi.ts";
import type { Project } from "./services/projectApi.ts";

interface ProjectSelection {
  project: Project;
  content: AgentProject;
}

export function App() {
  const [selection, setSelection] = useState<ProjectSelection | null>(null);
  const [projectActivity, setProjectActivity] = useState<
    Record<string, ProjectActivityStatus>
  >({});

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
      <ProjectDirectoryManager
        projectActivity={projectActivity}
        onProjectLoaded={(project, content) => {
          setSelection({ project, content });
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
        onProjectCleared={(projectId) => {
          clearProjectActivity(projectId);
          setSelection((currentSelection) =>
            currentSelection?.project.id === projectId
              ? null
              : currentSelection
          );
        }}
      />
      <AgentProjectWorkspace
        project={selection?.project ?? null}
        content={selection?.content ?? null}
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
    </main>
  );
}
