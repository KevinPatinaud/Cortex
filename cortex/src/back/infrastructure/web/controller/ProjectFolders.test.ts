import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtemp, rm } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import express from "express";
import type { ProjectOrganization } from "../../../../shared/ProjectOrganization.ts";
import type { AgentService } from "../../../application/service/iaService/AgentService.ts";
import type { DirectoryPickerService } from "../../../application/service/projectService/DirectoryPickerService.ts";
import { ProjectService } from "../../../application/service/projectService/ProjectService.ts";
import { ProjectUseCase } from "../../../application/usecase/ProjectUseCase.ts";
import { httpErrorMiddleware } from "../middleware/HttpErrorMiddleware.ts";
import { createProjectController } from "./ProjectController.ts";

test("project folder HTTP API persists organization and returns 400/404 for invalid requests", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cortex-project-folder-http-"));
  const service = new ProjectService(path.join(directory, "config.json"));
  const [project] = await service.saveProject(path.join(directory, "Project"));
  const useCase = new ProjectUseCase(service, {} as DirectoryPickerService, {} as AgentService);
  const app = express();
  app.use(express.json());
  app.use("/api/projects", createProjectController(useCase));
  app.use(httpErrorMiddleware);
  const server = app.listen(0, "127.0.0.1");
  try {
    await once(server, "listening");
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/projects`;
    const request = (route: string, method = "GET", body?: unknown) => fetch(base + route, {
      method,
      ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
    });
    assert.deepEqual(await (await request("/folders")).json(), { folders: [], projectFolders: {} });
    const created = await request("/folders", "POST", { name: "  Clients " });
    assert.equal(created.status, 201);
    const organization = await created.json() as ProjectOrganization;
    const folder = organization.folders[0];
    assert.equal(folder.name, "Clients");
    const assigned = await request(`/${project.id}/folder`, "PUT", { folderId: folder.id });
    assert.equal(assigned.status, 200);
    assert.deepEqual((await assigned.json() as ProjectOrganization).projectFolders, { [project.id]: folder.id });

    for (const body of [undefined, {}, { name: 123 }, { name: " " }, { name: "x".repeat(81) }, { name: "clients" }]) {
      assert.equal((await request("/folders", "POST", body)).status, 400);
    }
    for (const body of [undefined, {}, { folderId: 123 }, { folderId: " " }]) {
      assert.equal((await request(`/${project.id}/folder`, "PUT", body)).status, 400);
    }
    assert.equal((await request(`/${project.id}/folder`, "PUT", { folderId: "missing" })).status, 404);
    assert.equal((await request("/missing/folder", "PUT", { folderId: folder.id })).status, 404);
    assert.equal((await request("/folders/missing", "PATCH", { name: "New" })).status, 404);
    assert.equal((await request("/folders/missing", "DELETE")).status, 404);

    const renamed = await request(`/folders/${folder.id}`, "PATCH", { name: "Customers" });
    assert.equal(renamed.status, 200);
    assert.equal((await renamed.json() as ProjectOrganization).folders[0].name, "Customers");
    const unfiled = await request(`/${project.id}/folder`, "PUT", { folderId: null });
    assert.equal(unfiled.status, 200);
    assert.deepEqual((await unfiled.json() as ProjectOrganization).projectFolders, {});
    await request(`/${project.id}/folder`, "PUT", { folderId: folder.id });
    const deleted = await request(`/folders/${folder.id}`, "DELETE");
    assert.equal(deleted.status, 200);
    assert.deepEqual(await deleted.json(), { folders: [], projectFolders: {} });
    assert.deepEqual(await service.getProjects(), [project]);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(directory, { recursive: true, force: true });
  }
});
