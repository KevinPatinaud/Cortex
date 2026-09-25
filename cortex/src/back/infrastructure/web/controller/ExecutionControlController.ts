import { Router } from "express";
import type { ProjectUseCase } from "../../../application/usecase/ProjectUseCase.ts";
import type { ExecutionControlService } from "../../../application/service/executionControl/ExecutionControlService.ts";

export function createExecutionControlController(projects: ProjectUseCase, control: ExecutionControlService): Router {
  const router = Router();
  router.get("/:projectId/execution-control", async (request, response) => {
    await projects.getProject(request.params.projectId);
    response.set("Cache-Control", "no-store").json(control.status(request.params.projectId));
  });
  router.put("/:projectId/execution-control", async (request, response) => {
    await projects.getProject(request.params.projectId);
    response.json(control.update(request.params.projectId, request.body));
  });
  return router;
}
