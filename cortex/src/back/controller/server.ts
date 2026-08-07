import express, { type Request, type Response } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { AgentService } from "../engine/service/iaService/AgentService.ts";
import { ClaudeAgentProvider } from "../engine/service/iaService/providers/ClaudeAgentProvider.ts";
import { CodexAgentProvider } from "../engine/service/iaService/providers/CodexAgentProvider.ts";
import { CopilotAgentProvider } from "../engine/service/iaService/providers/CopilotAgentProvider.ts";
import { DirectoryPickerService } from "../engine/service/projectService/DirectoryPickerService.ts";
import { ProjectService } from "../engine/service/projectService/ProjectService.ts";
import { createAgentController } from "./AgentController.ts";
import { createProjectController } from "./ProjectController.ts";

const app = express();
const port = 3000;
const directoryName = path.dirname(fileURLToPath(import.meta.url));
const workspaceDirectory = path.resolve(directoryName, "../../..");
const clientDirectory = path.join(workspaceDirectory, "dist");
const configurationFile = path.join(workspaceDirectory, "config.json");
const agentService = new AgentService([
  new CodexAgentProvider(workspaceDirectory),
  new ClaudeAgentProvider(workspaceDirectory),
  new CopilotAgentProvider()
]);
const directoryPickerService = new DirectoryPickerService();
const projectService = new ProjectService(configurationFile);

app.use(express.json());
app.use(
  "/api/projects",
  createProjectController(projectService, directoryPickerService)
);
app.use("/api/agents", createAgentController(agentService));

app.use(express.static(clientDirectory));

app.get(/.*/, (_request: Request, response: Response) => {
  response.sendFile(path.join(clientDirectory, "index.html"));
});

app.listen(port, () => {
  console.log(`Serveur disponible sur http://localhost:${port}`);
});
