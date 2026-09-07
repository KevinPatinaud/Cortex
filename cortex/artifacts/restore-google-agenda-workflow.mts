import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { ProjectService } from "../src/back/application/service/projectService/ProjectService.ts";
import { toCodexAgentDefinitions } from "../src/back/application/mapper/agent/CodexAgentMapper.ts";
import { createAgentWorkflowHash } from "../src/back/application/service/workflowExecution/WorkflowConfiguration.ts";
import { AgentUseCase } from "../src/back/application/usecase/AgentUseCase.ts";
import { ProjectUseCase } from "../src/back/application/usecase/ProjectUseCase.ts";
import { AgentService } from "../src/back/application/service/iaService/AgentService.ts";
import { AgentConfigurationService } from "../src/back/application/service/iaService/AgentConfigurationService.ts";
import { DirectoryPickerService } from "../src/back/application/service/projectService/DirectoryPickerService.ts";

const projectId = "1442b75c-5d1b-41d9-9473-25ff62b134d7";
const configurationPath = path.resolve("config.json");
const service = new ProjectService(configurationPath);
const content = await service.getProjectContent(projectId);
assert.equal(path.resolve(content.directoryPath), path.resolve("projects/Google Agenda (2)"));
const directory = content.root.children.find((entry) => entry.type === "directory" && entry.name === ".codex");
assert.ok(directory && directory.type === "directory");
const agents = toCodexAgentDefinitions(directory);
const instructionsFile = content.root.children.find((entry) => entry.type === "file" && entry.name === "AGENTS.md");
assert.ok(instructionsFile && instructionsFile.type === "file");
const instructions = { fileName: instructionsFile.name, content: instructionsFile.content };
const id = (name: string) => `.codex/agents/${name}.toml`;
const edges = new Map([
  [id("chercheur-evenements"), [id("analyse-d-evenement-calendrier")]],
  [id("analyse-d-evenement-calendrier"), [id("synthese")]],
  [id("enqueteur"), [id("redacteur-journalistique")]],
  [id("redacteur-journalistique"), [id("synthese")]],
  [id("synthese"), [id("publieur")]],
  [id("publieur"), []]
]);
assert.deepEqual([...edges.keys()].sort(), agents.map((agent) => agent.id).sort());
async function fileHashes(directoryPath: string, prefix = ""): Promise<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const entry of await readdir(directoryPath, { withFileTypes: true })) {
    const relativePath = prefix + entry.name;
    if (entry.isDirectory()) Object.assign(result, await fileHashes(path.join(directoryPath, entry.name), `${relativePath}/`));
    else if (entry.isFile()) result[relativePath] = createHash("sha256").update(await readFile(path.join(directoryPath, entry.name))).digest("hex");
  }
  return result;
}
const before = await fileHashes(content.directoryPath);
const previous = await service.getAgentWorkflowConfiguration(projectId);
assert.equal(previous, null, "Refusing to replace a workflow established since the initial diagnosis.");
const workflow = {
  // Compatible with the already-running local server and the corrected loader.
  hash: createAgentWorkflowHash(instructions, agents, true),
  agents: agents.map((agent) => ({ id: agent.id, nextAgentIds: edges.get(agent.id)!,
    inputMode: agent.id === id("synthese") || agent.id === id("publieur") ? "aggregate" as const : "separate" as const })),
  parameters: []
};
await writeFile("artifacts/google-agenda-restoration.json", JSON.stringify({ projectId, previous, workflow, sourceFileHashes: before }, null, 2));
await service.saveAgentWorkflowConfiguration(projectId, workflow);
// No engine providers: a successful load proves no inference or task execution.
const agentService = new AgentService([], new AgentConfigurationService(configurationPath));
const useCase = new AgentUseCase(agentService, new ProjectUseCase(service, new DirectoryPickerService(), agentService));
const loaded = await useCase.loadProject(projectId);
assert.deepEqual(new Map(loaded.agents.map((agent) => [agent.id, agent.nextAgentIds])), edges);
assert.deepEqual(await fileHashes(content.directoryPath), before);
console.log(JSON.stringify({ projectId, restored: true, unchangedProjectFiles: Object.keys(before).length,
  graph: loaded.agents.map(({ id, name, nextAgentIds, inputMode }) => ({ id, name, nextAgentIds, inputMode })) }, null, 2));
