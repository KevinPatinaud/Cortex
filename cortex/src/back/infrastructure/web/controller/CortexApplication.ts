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

/** Production and integration tests share the same HTTP application. */
export function createCortexApplication(options: {
  projectUseCase: ProjectUseCase;
  agentUseCase: AgentUseCase;
  workflowScheduler: WorkflowScheduler;
  authentication: PasswordAuthentication | null;
  clientDirectory: string;
  gmail?: GmailService;
  automations?: WorkflowAutomationService;
}) {
  const app = express();
  app.disable("x-powered-by");
  app.use((_request, response, next) => {
    response.set({
      "Content-Security-Policy": [
        "default-src 'self'", "base-uri 'self'", "connect-src 'self'",
        "font-src 'self'", "form-action 'self'", "frame-ancestors 'none'",
        "img-src 'self' data:", "object-src 'none'", "script-src 'self'",
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
