import express, { type Request, type Response } from "express";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AgentService } from "../../../application/service/iaService/AgentService.ts";
import { AgentConfigurationService } from "../../../application/service/iaService/AgentConfigurationService.ts";
import { createDefaultAgentToolRegistry } from "../../../application/service/iaService/iaTools/AgentToolRegistry.ts";
import { ClaudeAgentProvider } from "../../../application/service/iaService/providers/ClaudeAgentProvider.ts";
import { CodexAgentProvider } from "../../../application/service/iaService/providers/CodexAgentProvider.ts";
import { CopilotAgentProvider } from "../../../application/service/iaService/providers/CopilotAgentProvider.ts";
import { DirectoryPickerService } from "../../../application/service/projectService/DirectoryPickerService.ts";
import { ProjectService } from "../../../application/service/projectService/ProjectService.ts";
import { AgentUseCase } from "../../../application/usecase/AgentUseCase.ts";
import { ProjectUseCase } from "../../../application/usecase/ProjectUseCase.ts";
import { WorkflowScheduler } from "../../../application/service/workflowScheduler/WorkflowScheduler.ts";
import { httpErrorMiddleware } from "../middleware/HttpErrorMiddleware.ts";
import { createAgentController } from "./AgentController.ts";
import { createProjectController } from "./ProjectController.ts";

const app = express();
const port = readPort(process.env.PORT);
const host = process.env.HOST?.trim() || "127.0.0.1";
const directoryName = path.dirname(fileURLToPath(import.meta.url));
const workspaceDirectory = path.resolve(directoryName, "../../../../..");
const clientDirectory = path.join(workspaceDirectory, "dist");
const configurationFile = path.join(workspaceDirectory, "config.json");
const shouldOpenBrowser = process.argv.includes("--open");
const agentToolRegistry = createDefaultAgentToolRegistry();
const agentConfigurationService = new AgentConfigurationService(
  configurationFile
);
const agentService = new AgentService([
  new CodexAgentProvider(workspaceDirectory),
  new ClaudeAgentProvider(workspaceDirectory),
  new CopilotAgentProvider(agentToolRegistry)
], agentConfigurationService);
const directoryPickerService = new DirectoryPickerService();
const projectService = new ProjectService(configurationFile);
const projectUseCase = new ProjectUseCase(
  projectService,
  directoryPickerService,
  agentService
);
const agentUseCase = new AgentUseCase(agentService, projectUseCase);
const workflowScheduler = new WorkflowScheduler(projectUseCase, agentUseCase);

app.disable("x-powered-by");
app.use((_request, response, next) => {
  response.set({
    "Content-Security-Policy": [
      "default-src 'self'",
      "base-uri 'self'",
      "connect-src 'self'",
      "font-src 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "img-src 'self' data:",
      "object-src 'none'",
      "script-src 'self'",
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
app.get("/api/health", (_request, response) => {
  response.json({ status: "ok" });
});
app.use(
  "/api/projects",
  createProjectController(projectUseCase)
);
app.use(
  "/api/agents",
  createAgentController(agentUseCase, workflowScheduler)
);
app.use("/api", (_request, response) => {
  response.status(404).json({ error: "API route not found." });
});

app.use(express.static(clientDirectory));

app.get(/.*/, (_request: Request, response: Response) => {
  response.sendFile(path.join(clientDirectory, "index.html"));
});

app.use(httpErrorMiddleware);

app.listen(port, host, () => {
  const browserHost = host === "0.0.0.0" || host === "::"
    ? "localhost"
    : host;
  const applicationUrl = `http://${browserHost}:${port}`;
  console.log(`Server available at ${applicationUrl}`);
  void workflowScheduler.start().catch((error: unknown) => {
    console.error("Unable to start the workflow scheduler:", error);
  });

  if (shouldOpenBrowser) {
    openDefaultBrowser(applicationUrl);
  }
});

function openDefaultBrowser(url: string): void {
  const browserProcess = process.platform === "win32"
    ? spawn("cmd.exe", ["/c", "start", "", url], {
      detached: true,
      stdio: "ignore",
      windowsHide: true
    })
    : process.platform === "darwin"
      ? spawn("open", [url], { detached: true, stdio: "ignore" })
      : spawn("xdg-open", [url], { detached: true, stdio: "ignore" });

  browserProcess.once("error", (error) => {
    console.warn("Unable to open the browser automatically.", error);
  });
  browserProcess.unref();
}

function readPort(value: string | undefined): number {
  if (value === undefined || value.trim() === "") {
    return 3000;
  }

  const parsedPort = Number(value);

  if (!Number.isInteger(parsedPort) || parsedPort < 1 || parsedPort > 65_535) {
    throw new Error("The PORT variable must be an integer between 1 and 65535.");
  }

  return parsedPort;
}
