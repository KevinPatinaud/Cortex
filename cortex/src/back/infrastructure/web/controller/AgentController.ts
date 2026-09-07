import { Router } from "express";
import type {
  AgentConfigurationInput,
  AgentUseCase,
  ImproveAgentInput,
  ImproveInstructionsInput,
  ReviewProjectInput,
  RunAgentInput
} from "../../../application/usecase/AgentUseCase.ts";
import type { EditAgentProjectInput } from "../../../application/usecase/ProjectUseCase.ts";
import type {
  WorkflowScheduleInput,
  WorkflowScheduler
} from "../../../application/service/workflowScheduler/WorkflowScheduler.ts";
import type {
  McpConnectionEngine,
  McpMachineConnectionInput
} from "../../../../shared/McpConnection.ts";
import {
  agentErrorMappings,
  toAgentProjectResponse,
  toAgentRunResponse,
  toAgentStatusResponse
} from "../mapper/AgentResponseMapper.ts";
import { asyncRoute } from "../middleware/HttpErrorMiddleware.ts";

export function createAgentController(
  agentUseCase: AgentUseCase,
  workflowScheduler: WorkflowScheduler
): Router {
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
    "/projects/:projectId/instructions/improve",
    asyncRoute<ImproveInstructionsInput, { projectId: string }>(async (
      request,
      response
    ) => {
      response.json(await agentUseCase.improveInstructions(
        request.params.projectId,
        request.body
      ));
    }, agentErrorMappings.improveInstructions)
  );

  router.post(
    "/projects/:projectId/review",
    asyncRoute<ReviewProjectInput, { projectId: string }>(async (
      request,
      response
    ) => {
      response.json(await agentUseCase.reviewProject(
        request.params.projectId,
        request.body
      ));
    }, agentErrorMappings.reviewProject)
  );

  router.get(
    "/projects/:projectId/workflow/schedule",
    asyncRoute<unknown, { projectId: string }>(async (request, response) => {
      response.json(await workflowScheduler.getSchedule(
        request.params.projectId
      ));
    }, agentErrorMappings.getWorkflowSchedule)
  );

  router.post(
    "/projects/:projectId/workflow/schedule/preview",
    asyncRoute<WorkflowScheduleInput, { projectId: string }>(async (request, response) => {
      response.json(await workflowScheduler.previewSchedule(request.params.projectId, request.body));
    }, agentErrorMappings.saveWorkflowSchedule)
  );

  router.put(
    "/projects/:projectId/workflow/schedule",
    asyncRoute<WorkflowScheduleInput, { projectId: string }>(async (
      request,
      response
    ) => {
      response.json(await workflowScheduler.saveSchedule(
        request.params.projectId,
        request.body
      ));
    }, agentErrorMappings.saveWorkflowSchedule)
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

  router.post("/projects/:projectId/workflow/run", asyncRoute<unknown, { projectId: string }>(async (request, response) => {
    const body = request.body as { parameterValues?: unknown } | undefined;
    response.json(await agentUseCase.runWorkflow(request.params.projectId, body?.parameterValues, "manual"));
  }, agentErrorMappings.runAgent));

  router.post("/projects/:projectId/workflow/events", asyncRoute<unknown, { projectId: string }>(async (request, response) => {
    response.status(202).json(await agentUseCase.receiveWorkflowEvent(request.params.projectId, request.body));
  }, agentErrorMappings.runAgent));

  router.post(
    "/projects/:projectId/workflow/resume",
    asyncRoute<unknown, { projectId: string }>(async (request, response) => {
      response.json(await agentUseCase.resumeWorkflow(request.params.projectId));
    }, agentErrorMappings.runAgent)
  );

  router.post(
    "/projects/:projectId/workflow/cancel",
    asyncRoute<unknown, { projectId: string }>(async (request, response) => {
      await agentUseCase.loadProject(request.params.projectId, false);
      const cancelled = agentUseCase.cancelProjectExecution(request.params.projectId);
      response.json({ cancelled });
    }, agentErrorMappings.resetWorkflow)
  );

  router.post(
    "/projects/:projectId/workflow/reset",
    asyncRoute<unknown, { projectId: string }>(async (request, response) => {
      await agentUseCase.loadProject(request.params.projectId, false);
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

  router.get(
    "/projects/:projectId/audit/runs",
    asyncRoute<unknown, { projectId: string }>(async (request, response) => {
      const limit = Number(request.query.limit ?? 20);
      const offset = Number(request.query.offset ?? 0);
      const scope = request.query.scope === "workflow" || request.query.scope === "agent"
        ? request.query.scope
        : undefined;
      response.json(agentUseCase.listWorkflowAuditRuns(
        request.params.projectId,
        limit,
        offset,
        scope
      ));
    }, agentErrorMappings.listWorkflowAuditRuns)
  );

  router.get(
    "/projects/:projectId/audit/runs/:runId/export",
    asyncRoute<unknown, { projectId: string; runId: string }>(async (
      request,
      response
    ) => {
      const run = agentUseCase.getWorkflowAuditRun(
        request.params.projectId,
        request.params.runId
      );
      response.setHeader(
        "Content-Disposition",
        `attachment; filename="cortex-audit-${run.id}.json"`
      );
      response.type("application/json").send(JSON.stringify(run, null, 2));
    }, agentErrorMappings.getWorkflowAuditRun)
  );

  router.get(
    "/projects/:projectId/audit/runs/:runId",
    asyncRoute<unknown, { projectId: string; runId: string }>(async (
      request,
      response
    ) => {
      response.json(agentUseCase.getWorkflowAuditRun(
        request.params.projectId,
        request.params.runId
      ));
    }, agentErrorMappings.getWorkflowAuditRun)
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

  router.get(
    "/mcp-connections",
    asyncRoute(async (request, response) => {
      const projectId = typeof request.query.projectId === "string"
        ? request.query.projectId
        : undefined;

      response.json(await agentUseCase.getMcpConnections(projectId));
    }, agentErrorMappings.getMcpConnections)
  );

  router.get(
    "/codex-plugins",
    asyncRoute(async (_request, response) => {
      response.json(await agentUseCase.getCodexPlugins());
    }, agentErrorMappings.getCodexPlugins)
  );

  router.post(
    "/codex-plugins/:pluginId/install",
    asyncRoute<unknown, { pluginId: string }>(async (request, response) => {
      response.json(await agentUseCase.installCodexPlugin(
        request.params.pluginId
      ));
    }, agentErrorMappings.installCodexPlugin)
  );

  router.delete(
    "/codex-plugins/:pluginId",
    asyncRoute<unknown, { pluginId: string }>(async (request, response) => {
      response.json(await agentUseCase.removeCodexPlugin(
        request.params.pluginId
      ));
    }, agentErrorMappings.removeCodexPlugin)
  );

  router.get(
    "/mcp-connections/:engine/:name",
    asyncRoute<unknown, { engine: string; name: string }>(async (
      request,
      response
    ) => {
      response.json(await agentUseCase.getMachineMcpConnection(
        request.params.engine as McpConnectionEngine,
        request.params.name
      ));
    }, agentErrorMappings.getMachineMcpConnection)
  );

  router.post(
    "/mcp-connections",
    asyncRoute<McpMachineConnectionInput>(async (request, response) => {
      response.status(201).json(await agentUseCase.createMachineMcpConnection(
        request.body
      ));
    }, agentErrorMappings.createMachineMcpConnection)
  );

  router.put(
    "/mcp-connections/:engine/:name",
    asyncRoute<
      McpMachineConnectionInput,
      { engine: string; name: string }
    >(async (request, response) => {
      response.json(await agentUseCase.updateMachineMcpConnection(
        request.params.engine as McpConnectionEngine,
        request.params.name,
        request.body
      ));
    }, agentErrorMappings.updateMachineMcpConnection)
  );

  router.delete(
    "/mcp-connections/:engine/:name",
    asyncRoute<unknown, { engine: string; name: string }>(async (
      request,
      response
    ) => {
      await agentUseCase.deleteMachineMcpConnection(
        request.params.engine as McpConnectionEngine,
        request.params.name
      );
      response.json({ message: "The MCP connection was deleted." });
    }, agentErrorMappings.deleteMachineMcpConnection)
  );

  router.put(
    "/configuration",
    asyncRoute<AgentConfigurationInput>(async (request, response) => {
      response.json(await agentUseCase.saveConfiguration(request.body));
    }, agentErrorMappings.saveConfiguration)
  );

  return router;
}
