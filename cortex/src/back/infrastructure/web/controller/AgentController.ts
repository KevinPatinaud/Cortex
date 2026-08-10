import { Router } from "express";
import type {
  AgentUseCase,
  AskAgentInput
} from "../../../application/usecase/AgentUseCase.ts";
import {
  agentErrorMappings,
  toAgentAnswerResponse,
  toAgentProjectResponse,
  toAgentStatusResponse
} from "../mapper/AgentResponseMapper.ts";
import { asyncRoute } from "../middleware/HttpErrorMiddleware.ts";

export function createAgentController(agentUseCase: AgentUseCase): Router {
  const router = Router();

  router.get(
    "/projects/:projectId",
    asyncRoute<unknown, { projectId: string }>(async (request, response) => {
      const project = await agentUseCase.loadProject(request.params.projectId);
      response.json(toAgentProjectResponse(project));
    }, agentErrorMappings.loadProject)
  );

  router.get(
    "/status",
    asyncRoute(async (_request, response) => {
      response.json(toAgentStatusResponse(await agentUseCase.getStatus()));
    }, agentErrorMappings.status)
  );

  router.post(
    "/ask",
    asyncRoute<AskAgentInput>(async (request, response) => {
      const answer = await agentUseCase.ask(request.body);
      response.json(toAgentAnswerResponse(answer));
    }, agentErrorMappings.ask)
  );

  return router;
}
