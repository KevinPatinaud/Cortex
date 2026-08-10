import { Bot } from "lucide-react";
import type { AgentProject } from "../../../services/agentApi.ts";
import type { Project } from "../../../services/projectApi.ts";

interface AgentProjectWorkspaceProps {
  project: Project | null;
  content: AgentProject | null;
}

function getProjectName(directoryPath: string): string {
  const pathParts = directoryPath.split(/[\\/]/).filter(Boolean);
  return pathParts.at(-1) || directoryPath;
}

export function AgentProjectWorkspace({
  project,
  content
}: AgentProjectWorkspaceProps) {
  if (!project || !content) {
    return (
      <section className="workspace-content">
        <p className="eyebrow">Cortex workspace</p>
        <h1>Cortex.</h1>
        <p className="intro">
          Selectionnez un projet dans le bandeau lateral pour afficher ses agents.
        </p>
      </section>
    );
  }

  const projectName = getProjectName(project.directoryPath);

  return (
    <section className="workspace-content workspace-content--project">
      <header className="agent-project__header">
        <p className="eyebrow">Projet {content.engine}</p>
        <h1>{projectName}</h1>
        <p className="intro">
          {content.agents.length} agent{content.agents.length > 1 ? "s" : ""}
          {" "}configure{content.agents.length > 1 ? "s" : ""}.
        </p>
      </header>

      {content.agents.length === 0 ? (
        <p className="agent-project__empty">
          Aucun agent n'est configure dans ce projet.
        </p>
      ) : (
        <div className="agent-project__grid">
          {content.agents.map((agent, index) => (
            <article className="agent-card" key={`${agent.name}-${index}`}>
              <header className="agent-card__header">
                <Bot aria-hidden="true" size={22} strokeWidth={1.7} />
                <div>
                  <span>Agent {index + 1}</span>
                  <h2>{agent.name}</h2>
                </div>
              </header>
              <p className="agent-card__description">
                {agent.description || "Aucune description."}
              </p>
              <div className="agent-card__prompt">
                <span>Instructions</span>
                <pre>{agent.prompt || "Aucune instruction."}</pre>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
