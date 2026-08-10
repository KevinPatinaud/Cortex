import { Router } from "express";
import type {
  AgentUseCase,
  RunAgentInput
} from "../../../application/usecase/AgentUseCase.ts";
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

  router.get(
    "/status",
    asyncRoute(async (_request, response) => {
      response.json(toAgentStatusResponse(await agentUseCase.getStatus()));
    }, agentErrorMappings.status)
  );

  return router;
}
