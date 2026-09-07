import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import { ProjectService } from "../src/back/application/service/projectService/ProjectService.ts";
import { ProjectUseCase } from "../src/back/application/usecase/ProjectUseCase.ts";
import { AgentUseCase } from "../src/back/application/usecase/AgentUseCase.ts";
import { AgentService } from "../src/back/application/service/iaService/AgentService.ts";
import { AgentConfigurationService } from "../src/back/application/service/iaService/AgentConfigurationService.ts";
import { DirectoryPickerService } from "../src/back/application/service/projectService/DirectoryPickerService.ts";
import { writeCortexProjectArchive } from "../src/back/infrastructure/archive/ProjectArchive.ts";
import { readCortexProjectArchive } from "../src/back/infrastructure/archive/ProjectArchiveReader.ts";

const baseline = JSON.parse(await readFile("artifacts/google-agenda-restoration.json", "utf8"));
const sourceService = new ProjectService(path.resolve("config.json"));
const source = (await sourceService.getProjects()).find((project) => project.id === baseline.projectId)!;
const cached = await sourceService.getAgentWorkflowConfiguration(source.id);
const chunks: Buffer[] = [];
await writeCortexProjectArchive(source.directoryPath, new Writable({
  write(chunk: Buffer, _encoding, callback) { chunks.push(Buffer.from(chunk)); callback(); }
}), cached);
const imported = await readCortexProjectArchive("Agenda-verification.ctx", Buffer.concat(chunks));
const directory = await mkdtemp(path.join(os.tmpdir(), "cortex-agenda-verify-"));
try {
  const configFile = path.join(directory, "config.json");
  const service = new ProjectService(configFile);
  const result = await service.importProject(imported.projectName, imported.files);
  const agentService = new AgentService([], new AgentConfigurationService(configFile));
  const useCase = new AgentUseCase(agentService, new ProjectUseCase(service, new DirectoryPickerService(), agentService));
  const restored = await useCase.loadProject(result.project.id);
  assert.deepEqual(new Map(restored.agents.map(({ id, nextAgentIds, inputMode }) => [id, { nextAgentIds, inputMode }])),
    new Map(cached!.agents.map(({ id, nextAgentIds, inputMode }) => [id, { nextAgentIds, inputMode }])));
  for (const [file, hash] of Object.entries(baseline.sourceFileHashes)) {
    const sourceBytes = await readFile(path.join(source.directoryPath, file));
    assert.equal(createHash("sha256").update(sourceBytes).digest("hex"), hash);
    assert.deepEqual(await readFile(path.join(result.project.directoryPath, file)), sourceBytes);
  }
  const summary = { sourceProjectId: source.id, newProjectId: restored.projectId,
    archivedFiles: imported.files.length, unchangedProjectFiles: Object.keys(baseline.sourceFileHashes).length,
    agentCount: restored.agents.length, engineProvidersAvailable: 0, loadedWithoutInference: true,
    roots: restored.agents.filter((agent) => !restored.agents.some((other) => other.nextAgentIds.includes(agent.id))).map((agent) => agent.name),
    aggregateAgents: restored.agents.filter((agent) => agent.inputMode === "aggregate").map((agent) => agent.name) };
  await writeFile("artifacts/google-agenda-portability-verification.json", JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary, null, 2));
} finally {
  assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
  assert.ok(path.basename(directory).startsWith("cortex-agenda-verify-"));
  await rm(directory, { recursive: true, force: true });
}
