import express, { type Request, type Response } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CopilotService } from "../engine/service/iaService/CopilotService.ts";
import { DirectoryPickerService } from "../engine/service/projectService/DirectoryPickerService.ts";
import { ProjectService } from "../engine/service/projectService/ProjectService.ts";
import { createAgentController } from "./AgentController.ts";
import { createProjectController } from "./ProjectController.ts";

const app = express();
const port = 3000;
const directoryName = path.dirname(fileURLToPath(import.meta.url));
const clientDirectory = path.resolve(directoryName, "../../../dist");
const configurationFile = path.resolve(directoryName, "../../../config.json");
const copilotService = new CopilotService();
const directoryPickerService = new DirectoryPickerService();
const projectService = new ProjectService(configurationFile);

app.use(express.json());
app.use(
  "/api/projects",
  createProjectController(projectService, directoryPickerService)
);
app.use("/api/agents", createAgentController(copilotService));

app.use(express.static(clientDirectory));

app.get(/.*/, (_request: Request, response: Response) => {
  response.sendFile(path.join(clientDirectory, "index.html"));
});

app.listen(port, () => {
  console.log(`Serveur disponible sur http://localhost:${port}`);
});
