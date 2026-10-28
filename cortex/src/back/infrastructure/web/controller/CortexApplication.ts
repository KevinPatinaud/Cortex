import express from "express";
import path from "node:path";
import type { AgentUseCase } from "../../../application/usecase/AgentUseCase.ts";
import type { ProjectUseCase } from "../../../application/usecase/ProjectUseCase.ts";
import type { WorkflowScheduler } from "../../../application/service/workflowScheduler/WorkflowScheduler.ts";
import { httpErrorMiddleware } from "../middleware/HttpErrorMiddleware.ts";
import { createAuthenticationRouter, requireAuthentication, type PasswordAuthentication } from "../middleware/PasswordAuthentication.ts";
import { createAgentController } from "./AgentController.ts";
import { createProjectController } from "./ProjectController.ts";
import { createGmailController } from "./GmailController.ts";
import { createWorkflowAutomationController } from "./WorkflowAutomationController.ts";
import type { WorkflowAutomationService } from "../../../application/service/workflowAutomation/WorkflowAutomationService.ts";
import type { GmailService } from "../../../application/service/gmail/GmailService.ts";
import type { PromptQueueService } from "../../../application/service/promptQueue/PromptQueueService.ts";
import { createPromptQueueController } from "./PromptQueueController.ts";
import type { CodexUpdateService } from "../../../application/service/iaService/CodexUpdateService.ts";
import { ValidationError } from "../../../application/error/ValidationError.ts";
import type { WorkLightService } from "../../../application/service/workLight/WorkLightService.ts";
import { createWorkLightController } from "./WorkLightController.ts";
import type { WorkForceService } from "../../../application/service/workForce/WorkForceService.ts";
import { createWorkForceController } from "./WorkForceController.ts";
import type { GlobalExecutionQueue } from "../../../application/service/executionQueue/GlobalExecutionQueue.ts";
import { createExecutionQueueController } from "./ExecutionQueueController.ts";

/** Production and integration tests share the same HTTP application. */
export function createCortexApplication(options: {
  projectUseCase: ProjectUseCase;
  agentUseCase: AgentUseCase;
  workflowScheduler: WorkflowScheduler;
  authentication: PasswordAuthentication | null;
  clientDirectory: string;
  gmail?: GmailService;
  automations?: WorkflowAutomationService;
  promptQueue?: PromptQueueService;
  workForce?: WorkForceService;
  workLight?: WorkLightService;
  executionQueue?: GlobalExecutionQueue;
  codexUpdates?: Pick<CodexUpdateService, "check" | "status">;
}) {
  const app = express();
  app.disable("x-powered-by");
  app.use((_request, response, next) => {
    response.set({
      "Content-Security-Policy": [
        "default-src 'self'", "base-uri 'self'", "connect-src 'self'",
        "font-src 'self'", "form-action 'self'", "frame-ancestors 'none'",
        "img-src 'self' data: blob:", "object-src 'none'", "script-src 'self'",
        "style-src 'self' 'unsafe-inline'"
      ].join("; "),
      "Permissions-Policy": "camera=(), geolocation=(), microphone=()",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY"
    });
    next();
  });
  app.use(express.json({ limit: "1mb", strict: true }));
  app.use("/api/auth", createAuthenticationRouter(options.authentication));
  app.get("/api/health", (_request, response) => { response.json({ status: "ok" }); });
  if (options.authentication) app.use("/api", requireAuthentication(options.authentication));
  if (options.codexUpdates) {
    app.get("/api/codex-engine", (_request, response) => { response.setHeader("Cache-Control", "no-store"); response.json(options.codexUpdates!.status()); });
    app.post("/api/codex-engine/check", (request, response) => {
      if (!request.is("application/json")) throw new ValidationError("La vérification doit être envoyée en JSON.");
      void options.codexUpdates!.check(true);
      response.status(202).json(options.codexUpdates!.status());
    });
  }
  if (options.promptQueue) app.use("/api/prompt-queue", createPromptQueueController(options.promptQueue));
  if (options.workLight) app.use("/api/work-light", createWorkLightController(options.workLight));
  if (options.workForce) app.use("/api/work-force", createWorkForceController(options.workForce));
  if (options.executionQueue) app.use("/api/execution-queue", createExecutionQueueController(options.executionQueue));
  if (options.gmail) app.use("/api/gmail", createGmailController(options.gmail));
  if (options.automations) app.use("/api/automations", createWorkflowAutomationController(options.automations));
  app.use("/api/projects", createProjectController(options.projectUseCase, options.automations));
  app.use("/api/agents", createAgentController(options.agentUseCase, options.workflowScheduler));
  app.use("/api", (_request, response) => {
    response.status(404).json({ error: "API route not found." });
  });
  app.use(express.static(options.clientDirectory));
  app.get(/.*/, (_request, response) => {
    response.sendFile(path.join(options.clientDirectory, "index.html"));
  });
  app.use(httpErrorMiddleware);
  return app;
}
