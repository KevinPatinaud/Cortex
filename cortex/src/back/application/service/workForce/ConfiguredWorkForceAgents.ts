import path from "node:path";
import type { WorkForceAgentRef, WorkForceCatalog } from "../../../../shared/WorkForce.ts";
import type { AgentUseCase } from "../../usecase/AgentUseCase.ts";
import type { ProjectUseCase } from "../../usecase/ProjectUseCase.ts";
import { ValidationError } from "../../error/ValidationError.ts";
import { ExecutionWorkspaceBusyError } from "../executionWorkspace/ExecutionWorkspaceGuard.ts";
import type { WorkForceAgents } from "./WorkForceService.ts";
import { parseAgentResponse } from "../../../../shared/AgentResponse.ts";

export class ConfiguredWorkForceAgents implements WorkForceAgents {
  constructor(private readonly projects: ProjectUseCase, private readonly agents: AgentUseCase, private readonly kind: "work-force" | "work-light" = "work-force") {}

  async catalog(): Promise<WorkForceCatalog> {
    const catalog: WorkForceCatalog = { agents: [], errors: [] };
    for (const project of await this.projects.getProjects()) {
      const projectName = path.basename(project.directoryPath);
      try {
        const configured = await this.agents.getConfiguredProject(project.id);
        catalog.agents.push(...configured.agents.map(agent => ({ projectId: project.id, agentId: agent.id,
          projectName, name: agent.name, description: agent.description })));
      } catch (error) { catalog.errors.push(`${projectName} : ${error instanceof Error ? error.message : "Lecture impossible."}`); }
    }
    return catalog;
  }
  async prepare(ref: WorkForceAgentRef) {
    if (!this.agents.usesGlobalExecutionQueue() && this.agents.isProjectRunning(ref.projectId)) throw new ExecutionWorkspaceBusyError("Ce projet est déjà en cours d’exécution. Work Force réessaiera automatiquement.");
    const project = await this.agents.getConfiguredProject(ref.projectId);
    const agent = project.agents.find(candidate => candidate.id === ref.agentId);
    if (!agent?.prompt.trim()) throw new ValidationError("L’agent Work Force est absent ou ses instructions sont vides.");
    const runner = this.agents.createWorkForceRunner(project, agent.id, this.kind);
    const mainRunner = this.agents;
    return { agent: { projectId: project.projectId, agentId: agent.id, name: agent.name,
      description: agent.description, projectName: path.basename(project.directoryPath) },
      runner: {
        async run(control?: import("../../usecase/AgentUseCase.ts").AgentStartControl) {
          const result = await mainRunner.runWorkForceAgent(runner, project.projectId, agent.id, {
            ...control, label: agent.name,
            beforeStart: async () => {
              // Read the checkpoint only after admission: an earlier queued occurrence
              // of this agent may have updated its native session in the meantime.
              await runner.loadProject(project.projectId, false);
              await control?.beforeStart?.();
            }
          });
          const parsed = parseAgentResponse(result.answer);
          return { answer: parsed ? [...parsed.items.map(item => item.content), parsed.notes].filter(Boolean).join("\n\n") : result.answer,
            waiting: runner.hasWorkflowWaits(project.projectId) };
        },
        cancel() { runner.cancelAllExecutions(); }
      }
    };
  }
}
