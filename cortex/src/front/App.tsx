import { useState } from "react";
import { AgentProjectWorkspace } from "./page/agent/components/AgentProjectWorkspace.tsx";
import { ProjectDirectoryManager } from "./page/project_manager/components/ProjectDirectoryManager.tsx";
import type { AgentProject } from "./services/agentApi.ts";
import type { Project } from "./services/projectApi.ts";

interface ProjectSelection {
  project: Project;
  content: AgentProject;
}

export function App() {
  const [selection, setSelection] = useState<ProjectSelection | null>(null);

  return (
    <main>
      <ProjectDirectoryManager
        onProjectLoaded={(project, content) => {
          setSelection({ project, content });
        }}
        onProjectCleared={(projectId) => {
          setSelection((currentSelection) =>
            currentSelection?.project.id === projectId
              ? null
              : currentSelection
          );
        }}
        onProjectWorkflowReset={(projectId) => {
          setSelection((currentSelection) => {
            if (currentSelection?.project.id !== projectId) {
              return currentSelection;
            }

            return {
              ...currentSelection,
              content: {
                ...currentSelection.content,
                agents: currentSelection.content.agents.map((agent) => ({
                  ...agent,
                  hasSession: false,
                  conversation: []
                }))
              }
            };
          });
        }}
      />
      <AgentProjectWorkspace
        project={selection?.project ?? null}
        content={selection?.content ?? null}
      />
    </main>
  );
}
