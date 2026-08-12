import express, { type Request, type Response } from "express";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AgentService } from "../../../application/service/iaService/AgentService.ts";
import { createDefaultAgentToolRegistry } from "../../../application/service/iaService/iaTools/AgentToolRegistry.ts";
import { ClaudeAgentProvider } from "../../../application/service/iaService/providers/ClaudeAgentProvider.ts";
import { CodexAgentProvider } from "../../../application/service/iaService/providers/CodexAgentProvider.ts";
import { CopilotAgentProvider } from "../../../application/service/iaService/providers/CopilotAgentProvider.ts";
import { DirectoryPickerService } from "../../../application/service/projectService/DirectoryPickerService.ts";
import { ProjectService } from "../../../application/service/projectService/ProjectService.ts";
import { AgentUseCase } from "../../../application/usecase/AgentUseCase.ts";
import { ProjectUseCase } from "../../../application/usecase/ProjectUseCase.ts";
import { httpErrorMiddleware } from "../middleware/HttpErrorMiddleware.ts";
import { createAgentController } from "./AgentController.ts";
import { createProjectController } from "./ProjectController.ts";

const app = express();
const port = 3000;
const directoryName = path.dirname(fileURLToPath(import.meta.url));
const workspaceDirectory = path.resolve(directoryName, "../../../../..");
const clientDirectory = path.join(workspaceDirectory, "dist");
const configurationFile = path.join(workspaceDirectory, "config.json");
const shouldOpenBrowser = process.argv.includes("--open");
const agentToolRegistry = createDefaultAgentToolRegistry();
const agentService = new AgentService([
  new CodexAgentProvider(workspaceDirectory),
  new ClaudeAgentProvider(workspaceDirectory),
  new CopilotAgentProvider(agentToolRegistry)
]);
const directoryPickerService = new DirectoryPickerService();
const projectService = new ProjectService(configurationFile);
const projectUseCase = new ProjectUseCase(
  projectService,
  directoryPickerService
);
const agentUseCase = new AgentUseCase(agentService, projectUseCase);

app.use(express.json());
app.use(
  "/api/projects",
  createProjectController(projectUseCase)
);
app.use("/api/agents", createAgentController(agentUseCase));

app.use(express.static(clientDirectory));

app.get(/.*/, (_request: Request, response: Response) => {
  response.sendFile(path.join(clientDirectory, "index.html"));
});

app.use(httpErrorMiddleware);

app.listen(port, () => {
  const applicationUrl = `http://localhost:${port}`;
  console.log(`Serveur disponible sur ${applicationUrl}`);

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
    console.warn("Impossible d'ouvrir automatiquement le navigateur.", error);
  });
  browserProcess.unref();
}
