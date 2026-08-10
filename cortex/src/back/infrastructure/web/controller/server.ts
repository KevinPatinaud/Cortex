import express, { type Request, type Response } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AgentService } from "../../../application/service/iaService/AgentService.ts";
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
const agentService = new AgentService([
  new CodexAgentProvider(workspaceDirectory),
  new ClaudeAgentProvider(workspaceDirectory),
  new CopilotAgentProvider()
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
  console.log(`Serveur disponible sur http://localhost:${port}`);
});
