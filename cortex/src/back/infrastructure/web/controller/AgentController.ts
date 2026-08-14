import { Router } from "express";
import type {
  AgentConfigurationInput,
  AgentUseCase,
  ImproveAgentInput,
  RunAgentInput
} from "../../../application/usecase/AgentUseCase.ts";
import type { EditAgentProjectInput } from "../../../application/usecase/ProjectUseCase.ts";
import {
  agentErrorMappings,
  toAgentProjectResponse,
  toAgentRunResponse,
  toAgentStatusResponse
} from "../mapper/AgentResponseMapper.ts";
import { asyncRoute } from "../middleware/HttpErrorMiddleware.ts";

export function createAgentController(agentUseCase: AgentUseCase): Router {
  const router = Router();

  router.get("/projects/actual", (_request, response) => {
    const project = agentUseCase.getActualLoadedProject();
    response.json(project ? toAgentProjectResponse(project) : null);
  });

  router.get(
    "/projects/:projectId",
    asyncRoute<unknown, { projectId: string }>(async (request, response) => {
      const project = await agentUseCase.loadProject(request.params.projectId);
      response.json(toAgentProjectResponse(project));
    }, agentErrorMappings.loadProject)
  );

  router.post(
    "/projects/:projectId/agents/improve",
    asyncRoute<ImproveAgentInput, { projectId: string }>(async (
      request,
      response
    ) => {
      response.json(await agentUseCase.improveAgent(
        request.params.projectId,
        request.body
      ));
    }, agentErrorMappings.improveAgent)
  );

  router.post(
    "/projects/:projectId/agents/run",
    asyncRoute<RunAgentInput, { projectId: string }>(async (
      request,
      response
    ) => {
      const result = await agentUseCase.runAgent(
        request.params.projectId,
        request.body
      );
      response.json(toAgentRunResponse(result));
    }, agentErrorMappings.runAgent)
  );

  router.post(
    "/projects/:projectId/workflow/reset",
    asyncRoute<unknown, { projectId: string }>(async (request, response) => {
      agentUseCase.resetWorkflow(request.params.projectId);
      response.json({ message: "The workflow was reset." });
    }, agentErrorMappings.resetWorkflow)
  );

  router.get(
    "/status",
    asyncRoute(async (_request, response) => {
      response.json(toAgentStatusResponse(await agentUseCase.getStatus()));
    }, agentErrorMappings.status)
  );

  router.put(
    "/projects/:projectId",
    asyncRoute<EditAgentProjectInput, { projectId: string }>(async (
      request,
      response
    ) => {
      const project = await agentUseCase.saveProject(
        request.params.projectId,
        request.body
      );
      response.json(toAgentProjectResponse(project));
    }, agentErrorMappings.saveProject)
  );

  router.get(
    "/configuration",
    asyncRoute(async (_request, response) => {
      response.json(await agentUseCase.getConfiguration());
    }, agentErrorMappings.getConfiguration)
  );

  router.put(
    "/configuration",
    asyncRoute<AgentConfigurationInput>(async (request, response) => {
      response.json(await agentUseCase.saveConfiguration(request.body));
    }, agentErrorMappings.saveConfiguration)
  );

  return router;
}
