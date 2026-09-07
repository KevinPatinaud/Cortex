import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import test from "node:test";
import { toCodexAgentDefinitions } from "../../mapper/agent/CodexAgentMapper.ts";
import { AgentUseCase } from "../../usecase/AgentUseCase.ts";
import { ProjectUseCase } from "../../usecase/ProjectUseCase.ts";
import { readCortexProjectArchive } from "../../../infrastructure/archive/ProjectArchiveReader.ts";
import { writeCortexProjectArchive } from "../../../infrastructure/archive/ProjectArchive.ts";
import { maximumFileBytes } from "../../../../shared/ProjectArchivePolicy.ts";
import { JsonConfigurationRepository } from "../configuration/JsonConfigurationRepository.ts";
import type { AgentService } from "../iaService/AgentService.ts";
import { createAgentWorkflowHash } from "../workflowExecution/WorkflowConfiguration.ts";
import type { DirectoryPickerService } from "./DirectoryPickerService.ts";
import { ProjectService, type AgentWorkflowConfiguration, type UploadedProjectFile } from "./ProjectService.ts";
import { canonicalizeArchivedWorkflow, projectWorkflowArchivePath } from "./ProjectWorkflowArchive.ts";

const graph = {
  Analyse: ["Synthese"], Detecteur: ["Analyse"], Enqueteur: ["Redacteur"],
  Publieur: [], Redacteur: ["Synthese"], Synthese: ["Publieur"]
};

async function fixture() {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cortex-workflow-archive-"));
  const configFile = path.join(directory, "config.json");
  const service = new ProjectService(configFile);
  const importedDirectory = path.join(directory, "imported");
  await service.saveManagedProjectsDirectory(importedDirectory);
  const instructions = Buffer.from("# Agenda et actualité\r\n\r\nDeux recherches indépendantes et un seul livrable.\r\n", "utf8");
  const { project } = await service.createProject({
    parentDirectory: directory, name: "Original", engine: "codex", instructions: instructions.toString("utf8"),
    agents: Object.keys(graph).map((name) => ({ name, description: `Rôle ${name}`,
      prompt: `Mission ${name}.\nConserver les instructions et les responsabilités.` }))
  });
  const content = await service.getProjectContent(project.id);
  const codex = content.root.children.find((entry) => entry.type === "directory" && entry.name === ".codex");
  assert.ok(codex && codex.type === "directory");
  const agents = toCodexAgentDefinitions(codex);
  const ids = new Map(agents.map((agent) => [agent.name, agent.id]));
  const workflow: AgentWorkflowConfiguration = {
    hash: createAgentWorkflowHash({ fileName: "AGENTS.md", content: instructions.toString("utf8") }, agents),
    agents: agents.map((agent) => ({ id: agent.id,
      nextAgentIds: graph[agent.name as keyof typeof graph].map((name) => ids.get(name)!),
      inputMode: agent.name === "Synthese" ? "aggregate" : "separate" })),
    parameters: [{ id: "period", label: "Période", description: "Contexte commun aux deux recherches.",
      required: false, inputType: "select", placeholder: "Choisir", options: ["Aujourd'hui", "Cette semaine"] }]
  };
  await service.saveAgentWorkflowConfiguration(project.id, workflow);
  const files: UploadedProjectFile[] = [{ relativePath: "AGENTS.md", content: instructions }];
  for (const agent of agents) files.push({ relativePath: agent.id, content: await readFile(path.join(project.directoryPath, agent.id)) });
  return { directory, configFile, service, importedDirectory, project, instructions, agents, workflow, files,
    async cleanup() {
      assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
      assert.ok(path.basename(directory).startsWith("cortex-workflow-archive-"));
      await rm(directory, { recursive: true, force: true });
    } };
}

async function archive(directory: string, workflow: AgentWorkflowConfiguration | null): Promise<Buffer> {
  const chunks: Buffer[] = [];
  await writeCortexProjectArchive(directory, new Writable({
    write(chunk: Buffer, _encoding, callback) { chunks.push(Buffer.from(chunk)); callback(); }
  }), workflow);
  return Buffer.concat(chunks);
}

function metadataFile(workflow: unknown, version = 1): UploadedProjectFile {
  return { relativePath: projectWorkflowArchivePath, content: Buffer.from(JSON.stringify({ version, workflow })) };
}

test("round-trips two roots and their aggregate join through .ctx without engine inference", async () => {
  const f = await fixture();
  try {
    await f.service.saveWorkflowScheduleConfiguration(f.project.id, {
      cron: "0 7 * * *", enabled: true, parameterValues: { period: "SCHEDULE_VALUE_PRIVATE" }
    });
    const enriched = Object.assign(structuredClone(f.workflow), {
      sessionId: "SESSION_PRIVATE", workflowParameterValues: { period: "RUNTIME_VALUE_PRIVATE" }
    });
    Object.assign(enriched.parameters[0], { value: "PARAMETER_VALUE_PRIVATE" });
    Object.assign(enriched.agents[0], { conversation: ["CONVERSATION_PRIVATE"] });
    const sourceMetadata = path.join(f.project.directoryPath, projectWorkflowArchivePath);
    await mkdir(path.dirname(sourceMetadata), { recursive: true });
    await writeFile(sourceMetadata, "obsolete metadata left on disk");
    const exported = await readCortexProjectArchive("Portable.ctx", await archive(f.project.directoryPath, enriched));
    assert.equal(await readFile(sourceMetadata, "utf8"), "obsolete metadata left on disk", "Export never edits the source project");
    assert.equal(exported.files.length, f.files.length + 1);
    const metadata = exported.files.find((file) => file.relativePath === projectWorkflowArchivePath)!;
    assert.ok(metadata);
    assert.deepEqual(JSON.parse(metadata.content.toString("utf8")), { version: 1, workflow: f.workflow });
    assert.doesNotMatch(metadata.content.toString("utf8"), /PRIVATE|schedule|conversation|session/i);

    for (const targetEngine of ["codex", "claude", "copilot"] as const) {
      const result = await f.service.importProject(`Restored-${targetEngine}`, exported.files, targetEngine);
      assert.notEqual(result.project.id, f.project.id);
      assert.equal(await f.service.getWorkflowScheduleConfiguration(result.project.id), null);
      await assert.rejects(readFile(path.join(result.project.directoryPath, projectWorkflowArchivePath)), { code: "ENOENT" });
      const instructionsName = targetEngine === "claude" ? "CLAUDE.md" : "AGENTS.md";
      assert.deepEqual(await readFile(path.join(result.project.directoryPath, instructionsName)), f.instructions);
      if (targetEngine === "codex") {
        for (const source of f.files) assert.deepEqual(await readFile(path.join(result.project.directoryPath, source.relativePath)), source.content);
      }
      let engineCalls = 0;
      const agentService = { execute: async () => { engineCalls++; throw new Error("No inference or execution expected"); } } as unknown as AgentService;
      const useCase = new AgentUseCase(agentService,
        new ProjectUseCase(f.service, {} as DirectoryPickerService, agentService));
      const loaded = await useCase.loadProject(result.project.id);
      assert.equal(engineCalls, 0);
      assert.equal(loaded.engine, targetEngine);
      assert.deepEqual(loaded.parameters, f.workflow.parameters);
      assert.deepEqual(loaded.workflowParameterValues, {});
      assert.equal(loaded.workflowResumable, false);
      const names = new Map(loaded.agents.map((agent) => [agent.id, agent.name]));
      const roots = loaded.agents.filter((agent) => !loaded.agents.some((other) => other.nextAgentIds.includes(agent.id)));
      assert.deepEqual(roots.map((agent) => agent.name).sort(), ["Detecteur", "Enqueteur"]);
      for (const agent of loaded.agents) {
        assert.deepEqual(agent.nextAgentIds.map((id) => names.get(id)), graph[agent.name as keyof typeof graph]);
        assert.equal(agent.inputMode, agent.name === "Synthese" ? "aggregate" : "separate");
        assert.equal(agent.prompt, f.agents.find((source) => source.name === agent.name)!.prompt);
        assert.equal(agent.hasSession, false);
        assert.deepEqual(agent.threads, []);
      }
    }
    for (const source of f.files) assert.deepEqual(await readFile(path.join(f.project.directoryPath, source.relativePath)), source.content);
  } finally { await f.cleanup(); }
});

test("archives canonical and legacy caches despite file ordering and line-ending changes", async () => {
  const f = await fixture();
  try {
    const reordered = [...f.files].reverse().map((file) => ({ ...file,
      content: Buffer.from(file.content.toString("utf8").replace(/\r\n/g, "\n")) }));
    assert.deepEqual(canonicalizeArchivedWorkflow(reordered, f.workflow), f.workflow);
    const legacy = { ...f.workflow, hash: createAgentWorkflowHash({
      fileName: "AGENTS.md", content: f.instructions.toString("utf8")
    }, f.agents, true) };
    assert.deepEqual(canonicalizeArchivedWorkflow(f.files, legacy), f.workflow);
    const exported = await readCortexProjectArchive("Legacy.ctx", await archive(f.project.directoryPath, legacy));
    assert.deepEqual(JSON.parse(exported.files.find((file) => file.relativePath === projectWorkflowArchivePath)!.content.toString()),
      { version: 1, workflow: f.workflow });
  } finally { await f.cleanup(); }
});

test("omits stale workflow caches and ignores stale imported metadata without changing instructions", async () => {
  const f = await fixture();
  try {
    const changed = Buffer.concat([f.instructions, Buffer.from("Instructions updated.\n")]);
    await writeFile(path.join(f.project.directoryPath, "AGENTS.md"), changed);
    await mkdir(path.join(f.project.directoryPath, ".cortex"));
    await writeFile(path.join(f.project.directoryPath, projectWorkflowArchivePath), metadataFile(f.workflow).content);
    const exported = await readCortexProjectArchive("Changed.ctx", await archive(f.project.directoryPath, f.workflow));
    assert.equal(exported.files.some((file) => file.relativePath === projectWorkflowArchivePath), false);
    const staleFiles = f.files.map((file) => file.relativePath === "AGENTS.md" ? { ...file, content: changed } : file);
    const imported = await f.service.importProject("Changed-import", [...staleFiles, metadataFile(f.workflow)]);
    assert.equal(await f.service.getAgentWorkflowConfiguration(imported.project.id), null);
    assert.deepEqual(await readFile(path.join(imported.project.directoryPath, "AGENTS.md")), changed);
  } finally { await f.cleanup(); }
});

test("rejects invalid workflow metadata before creating project files or registering a project", async () => {
  const f = await fixture();
  try {
    const invalid: UploadedProjectFile[] = [
      { relativePath: projectWorkflowArchivePath, content: Buffer.from("not JSON") },
      metadataFile(f.workflow, 2), metadataFile({ ...f.workflow, parameters: undefined }),
      metadataFile({ ...f.workflow, agents: f.workflow.agents.slice(1) }),
      metadataFile({ ...f.workflow, agents: [f.workflow.agents[0], ...f.workflow.agents.slice(0, -1)] }),
      metadataFile({ ...f.workflow, agents: f.workflow.agents.map((agent, index) => index === 0
        ? { ...agent, nextAgentIds: [".codex/agents/unknown.toml"] } : agent) }),
      metadataFile({ ...f.workflow, agents: f.workflow.agents.map((agent, index) => index === 0
        ? { ...agent, nextAgentIds: [...agent.nextAgentIds, ...agent.nextAgentIds] } : agent) }),
      metadataFile({ ...f.workflow, parameters: [f.workflow.parameters[0], f.workflow.parameters[0]] }),
      ...[
        { id: "invalid id" }, { label: " " }, { inputType: "password" },
        { options: ["only"] }, { options: ["duplicate", "duplicate "] },
        { inputType: "text", options: ["unexpected"] }
      ].map((updates) => metadataFile({ ...f.workflow, parameters: [{ ...f.workflow.parameters[0], ...updates }] }))
    ];
    const originalConfiguration = await readFile(f.configFile);
    for (const [index, metadata] of invalid.entries()) {
      await assert.rejects(f.service.importProject(`Invalid-${index}`, [...f.files, metadata]), /archived.*(?:invalid|match)/i);
    }
    assert.deepEqual(await readFile(f.configFile), originalConfiguration);
    assert.deepEqual(await readdir(f.importedDirectory), []);
  } finally { await f.cleanup(); }
});

test("preserves explicit cycles in portable workflow metadata", async () => {
  const f = await fixture();
  try {
    const workflow = structuredClone(f.workflow);
    workflow.agents.find((agent) => agent.id.endsWith("publieur.toml"))!.nextAgentIds = [
      workflow.agents.find((agent) => agent.id.endsWith("detecteur.toml"))!.id
    ];
    assert.deepEqual(canonicalizeArchivedWorkflow(f.files, workflow), workflow);
  } finally { await f.cleanup(); }
});

test("checks generated workflow metadata against archive size limits before sending bytes", async () => {
  const f = await fixture();
  try {
    const workflow = structuredClone(f.workflow);
    workflow.parameters[0].description = "x".repeat(maximumFileBytes);
    let sentBytes = 0;
    const destination = new Writable({
      write(chunk: Buffer, _encoding, callback) { sentBytes += chunk.byteLength; callback(); }
    });
    await assert.rejects(writeCortexProjectArchive(f.project.directoryPath, destination, workflow), /20 MB limit/);
    assert.equal(sentBytes, 0);
    assert.equal(destination.destroyed, false);
  } finally { await f.cleanup(); }
});

test("rolls back an imported project and its graph when the configuration commit fails", async (context) => {
  const f = await fixture();
  try {
    const before = await readFile(f.configFile);
    context.mock.method(JsonConfigurationRepository.prototype, "replace", async () => { throw new Error("Config unavailable"); });
    await assert.rejects(f.service.importProject("Failed-import", [...f.files, metadataFile(f.workflow)]), /Config unavailable/);
    assert.deepEqual(await readFile(f.configFile), before);
    assert.deepEqual(await readdir(f.importedDirectory), []);
  } finally { await f.cleanup(); }
});
