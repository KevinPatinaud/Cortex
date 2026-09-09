import { Router } from "express";
import type { WorkflowAutomationService } from "../../../application/service/workflowAutomation/WorkflowAutomationService.ts";
import { toAgentProjectResponse } from "../mapper/AgentResponseMapper.ts";
import { ValidationError } from "../../../application/error/ValidationError.ts";
import { WORKFLOW_JOB_FILTERS, type WorkflowJobFilter } from "../../../../shared/WorkflowAutomation.ts";

export function createWorkflowAutomationController(service: WorkflowAutomationService): Router {
  const router = Router();
  router.get("/:projectId/rules", (request, response) => { response.json({ rules: service.rules(request.params.projectId) }); });
  router.post("/:projectId/continue", async (request, response) => {
    if (typeof request.body?.agentId !== "string") throw new ValidationError("Choisissez un agent source.");
    await service.continueFromResults(request.params.projectId, request.body.agentId);
    response.json({ dispatched: true });
  });
  router.get("/:projectId/jobs", (request, response) => {
    const offset = Number(request.query.offset ?? 0);
    if (!Number.isSafeInteger(offset) || offset < 0) throw new ValidationError("Pagination invalide.");
    const ruleId = request.query.ruleId;
    if (ruleId !== undefined && typeof ruleId !== "string") throw new ValidationError("Filtre de dossiers invalide.");
    const filter = request.query.filter;
    if (filter !== undefined && (typeof filter !== "string" || !Object.hasOwn(WORKFLOW_JOB_FILTERS, filter))) throw new ValidationError("Filtre de dossiers invalide.");
    response.json(service.list(request.params.projectId, offset, ruleId, filter as WorkflowJobFilter | undefined));
  });
  router.get("/:projectId/jobs/:id", async (request, response) => {
    const { job, project } = await service.detail(request.params.projectId, request.params.id);
    response.json({ job, project: toAgentProjectResponse(project) });
  });
  router.post("/:projectId/jobs/:id/cancel", async (request, response) => {
    await service.cancel(request.params.projectId, request.params.id); response.json({ cancelled: true });
  });
  router.post("/:projectId/jobs/:id/resume", async (request, response) => {
    await service.resume(request.params.projectId, request.params.id, request.body); response.json({ queued: true });
  });
  router.post("/:projectId/jobs/:id/events", async (request, response) => {
    response.json(await service.event(request.params.projectId, request.params.id, request.body));
  });
  return router;
}
