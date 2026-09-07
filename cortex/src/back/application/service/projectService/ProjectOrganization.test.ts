import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { NotFoundError } from "../../error/NotFoundError.ts";
import { JsonConfigurationRepository } from "../configuration/JsonConfigurationRepository.ts";
import { ProjectService } from "./ProjectService.ts";

async function withService(
  assertion: (service: ProjectService, configurationFile: string, directory: string) => Promise<void>
): Promise<void> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cortex-project-folders-"));
  const configurationFile = path.join(directory, "config.json");
  try {
    await assertion(new ProjectService(configurationFile), configurationFile, directory);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("persists virtual folders and assignments across reload, project rename and reorder", async () => {
  await withService(async (service, configurationFile, directory) => {
    const { project } = await service.createProject({
      parentDirectory: directory, name: "Original", engine: "codex", instructions: "Keep this file"
    });
    const projects = await service.saveProject(path.join(directory, "Second"));
    const folder = (await service.createProjectFolder("  Clients  ")).folders[0];
    assert.equal(folder.name, "Clients");
    await service.setProjectFolder(project.id, folder.id);
    await service.renameProjectFolder(folder.id, "CLIENTS");
    await service.saveAgentProject(project.id, {
      name: "Renamed", engine: "codex", instructions: "Keep this file", agents: []
    });
    await service.reorderProjects(projects.map((candidate) => candidate.id).reverse());

    const reloaded = new ProjectService(configurationFile);
    assert.deepEqual(await reloaded.getProjectOrganization(), {
      folders: [{ id: folder.id, name: "CLIENTS" }], projectFolders: { [project.id]: folder.id }
    });
    assert.deepEqual((await reloaded.getProjects()).map((candidate) => candidate.id),
      projects.map((candidate) => candidate.id).reverse());
    assert.equal((await reloaded.getProjects()).find((candidate) => candidate.id === project.id)?.directoryPath,
      path.join(directory, "Renamed"));
    assert.equal(await readFile(path.join(directory, "Renamed", "AGENTS.md"), "utf8"), "Keep this file");
  });
});

test("deleting a folder unfiles its projects without deleting projects or physical files", async () => {
  await withService(async (service, configurationFile, directory) => {
    const { project } = await service.createProject({
      parentDirectory: directory, name: "Protected", engine: "codex", instructions: "Preserved"
    });
    const folder = (await service.createProjectFolder("Archive")).folders[0];
    await service.setProjectFolder(project.id, folder.id);
    assert.deepEqual(await service.deleteProjectFolder(folder.id), { folders: [], projectFolders: {} });
    assert.deepEqual(await new ProjectService(configurationFile).getProjectOrganization(),
      { folders: [], projectFolders: {} });
    assert.deepEqual(await service.getProjects(), [project]);
    assert.equal(await readFile(path.join(project.directoryPath, "AGENTS.md"), "utf8"), "Preserved");
  });
});

test("supports moving, unfiling and removing project assignments when projects are deleted", async () => {
  await withService(async (service, configurationFile, directory) => {
    const [project] = await service.saveProject(path.join(directory, "Project"));
    const first = (await service.createProjectFolder("First")).folders[0];
    const second = (await service.createProjectFolder("Second")).folders[1];
    await service.setProjectFolder(project.id, first.id);
    assert.deepEqual((await service.setProjectFolder(project.id, second.id)).projectFolders,
      { [project.id]: second.id });
    assert.deepEqual((await service.setProjectFolder(project.id, null)).projectFolders, {});
    await service.setProjectFolder(project.id, first.id);
    await service.deleteProject(project.directoryPath);
    assert.deepEqual((await service.getProjectOrganization()).projectFolders, {});
    const stored = JSON.parse(await readFile(configurationFile, "utf8"));
    assert.deepEqual(stored.projectOrganization.projectFolders, {});
    assert.equal(stored.projectOrganization.folders.length, 2);
  });
});

test("rejects invalid names, duplicates and unknown assignments without changing saved organization", async () => {
  await withService(async (service, configurationFile, directory) => {
    const [project] = await service.saveProject(path.join(directory, "Project"));
    const first = (await service.createProjectFolder("Clients")).folders[0];
    const second = (await service.createProjectFolder("Internal")).folders[1];
    const original = await readFile(configurationFile, "utf8");
    for (const name of ["", " \t ", "x".repeat(81), " clients "]) {
      await assert.rejects(service.createProjectFolder(name), TypeError);
    }
    await assert.rejects(service.renameProjectFolder(second.id, "CLIENTS"), TypeError);
    await assert.rejects(service.renameProjectFolder(first.id, " "), TypeError);
    await assert.rejects(service.renameProjectFolder("missing", "Name"), NotFoundError);
    await assert.rejects(service.deleteProjectFolder("missing"), NotFoundError);
    await assert.rejects(service.setProjectFolder("missing", first.id), NotFoundError);
    await assert.rejects(service.setProjectFolder("missing", null), NotFoundError);
    await assert.rejects(service.setProjectFolder(project.id, "missing"), NotFoundError);
    assert.equal(await readFile(configurationFile, "utf8"), original);
    assert.equal((await service.createProjectFolder("x".repeat(80))).folders.length, 3);
  });
});

test("loads legacy and malformed folder configuration without losing valid projects or other settings", async () => {
  await withService(async (service, configurationFile, directory) => {
    await writeFile(configurationFile, JSON.stringify({ directoryPath: path.join(directory, "Legacy"), theme: "dark" }));
    assert.deepEqual(await service.getProjectOrganization(), { folders: [], projectFolders: {} });
    const [project] = await service.getProjects();
    await new JsonConfigurationRepository(configurationFile).update((configuration) => ({
      ...configuration,
      projectOrganization: {
        folders: [null, { id: "valid", name: " Work " }, { id: "duplicate", name: "WORK" },
          { id: "valid", name: "Other" }, { id: "bad", name: " " }, { name: "No ID" }],
        projectFolders: { [project.id]: "valid", missing: "valid", orphan: "missing" }
      }
    }));
    assert.deepEqual(await service.getProjectOrganization(), {
      folders: [{ id: "valid", name: "Work" }], projectFolders: { [project.id]: "valid" }
    });
    await service.createProjectFolder("Personal");
    const stored = JSON.parse(await readFile(configurationFile, "utf8"));
    assert.equal(stored.theme, "dark");
    assert.equal(stored.projects[0].id, project.id);
    assert.deepEqual(stored.projectOrganization.projectFolders, { [project.id]: "valid" });
    assert.equal(stored.projectOrganization.folders.length, 2);
  });
});

test("serializes folder creation and assignment with concurrent project and configuration changes", async () => {
  await withService(async (service, configurationFile, directory) => {
    const other = new ProjectService(configurationFile);
    const repository = new JsonConfigurationRepository(configurationFile);
    await Promise.all([
      ...Array.from({ length: 8 }, (_, index) =>
        (index % 2 ? service : other).createProjectFolder(`Folder ${index}`)),
      ...Array.from({ length: 8 }, (_, index) =>
        (index % 2 ? service : other).saveProject(path.join(directory, `Project ${index}`))),
      repository.update((configuration) => ({ ...configuration, unrelated: "preserved" }))
    ]);
    const projects = await service.getProjects();
    const { folders } = await service.getProjectOrganization();
    assert.equal(folders.length, 8);
    assert.equal(projects.length, 8);
    await Promise.all(projects.map((project, index) =>
      (index % 2 ? service : other).setProjectFolder(project.id, folders[index].id)));
    assert.equal(Object.keys((await service.getProjectOrganization()).projectFolders).length, 8);
    const duplicates = await Promise.allSettled([
      service.createProjectFolder("Unique"), other.createProjectFolder(" unique ")
    ]);
    assert.equal(duplicates.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal((JSON.parse(await readFile(configurationFile, "utf8"))).unrelated, "preserved");
  });
});
