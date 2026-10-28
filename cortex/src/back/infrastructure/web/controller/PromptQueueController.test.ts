import assert from "node:assert/strict";
import { once } from "node:events";
import { test } from "node:test";
import type { AddressInfo } from "node:net";
import { PromptQueueService } from "../../../application/service/promptQueue/PromptQueueService.ts";
import { SqlitePromptQueueRepository } from "../../promptQueue/SqlitePromptQueueRepository.ts";
import { PasswordAuthentication } from "../middleware/PasswordAuthentication.ts";
import { createCortexApplication } from "./CortexApplication.ts";
import type { ProjectUseCase } from "../../../application/usecase/ProjectUseCase.ts";
import type { AgentUseCase } from "../../../application/usecase/AgentUseCase.ts";
import type { WorkflowScheduler } from "../../../application/service/workflowScheduler/WorkflowScheduler.ts";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";

test("the production application authenticates all prompt queue routes before reading or mutating chats", async () => {
  const store = new SqlitePromptQueueRepository(":memory:");
  const service = new PromptQueueService(store, {
    execute: async () => { throw new Error("No execution expected"); },
    getCodexModels: async () => { throw new Error("No discovery expected"); }
  }, {
    assertMayStart: async () => { throw new Error("No quota request expected"); },
    getConfiguration: async () => ({ enabled: false, minimumFiveHourRemainingPercent: 50, minimumWeeklyRemainingPercent: 10 }),
    getLastStatus: () => null,
    getStatus: async () => ({ available: false, checkedAt: new Date().toISOString(), fiveHour: null, weekly: null, error: "Offline" })
  });
  const authentication = new PasswordAuthentication({ password: "test-password-for-queue", secureCookie: false });
  let engineChecks = 0;
  const engineStatus = { state: "idle" as const, installedVersion: null, latestVersion: null, checkedAt: null, updatedAt: null, error: null };
  const app = createCortexApplication({ projectUseCase: {} as ProjectUseCase, agentUseCase: {} as AgentUseCase,
    workflowScheduler: {} as WorkflowScheduler, authentication, clientDirectory: process.cwd(), promptQueue: service,
    codexUpdates: { status: () => engineStatus, check: async () => { engineChecks++; return engineStatus; } } });
  const server = app.listen(0, "127.0.0.1");
  try {
    await once(server, "listening");
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/prompt-queue`;
    for (const [route, method] of [["", "GET"], ["/chats", "POST"], ["/settings", "PUT"], ["/settings", "GET"], ["/models", "GET"], ["/chats/missing", "DELETE"], ["/check", "POST"], ["/chats/missing/prompts/missing/force", "POST"]]) {
      assert.equal((await fetch(base + route, { method })).status, 401);
    }
    const token = authentication.authenticate("test-password-for-queue")!;
    const headers = { cookie: `cortex_session=${token}`, "Content-Type": "application/json" };
    const engineBase = base.replace("/prompt-queue", "/codex-engine");
    assert.equal((await fetch(engineBase)).status, 401);
    assert.equal((await fetch(engineBase + "/check", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status, 401);
    assert.equal(engineChecks, 0);
    assert.equal((await fetch(engineBase + "/check", { method: "POST", headers, body: "{}" })).status, 202);
    assert.equal(engineChecks, 1);
    assert.equal((await fetch(engineBase + "/check", { method: "POST", headers: { cookie: headers.cookie }, body: "" })).status, 400);
    const settings = await fetch(base + "/settings", { headers });
    assert.equal(settings.status, 200);
    assert.deepEqual((await settings.json()).defaults, { workingDirectory: "", model: "", reasoningEffort: "", autoStart: true });
    const created = await fetch(base + "/chats", { method: "POST", headers, body: JSON.stringify({ title: "HTTP chat", workingDirectory: process.cwd(), paused: true }) });
    assert.equal(created.status, 201);
    const chat = await created.json() as { id: string };
    const queued = await fetch(`${base}/chats/${chat.id}/prompts`, { method: "POST", headers, body: JSON.stringify({ content: "Prepared task" }) });
    assert.equal(queued.status, 201);
    assert.equal((await queued.json()).quotaWarning.status.available, false);
    assert.equal((await fetch(base, { headers })).headers.get("cache-control"), "no-store");
    const detail = await (await fetch(`${base}/chats/${chat.id}`, { headers })).json();
    assert.equal(detail.paused, true);
    assert.equal(detail.prompts[0].status, "queued");
    assert.equal(Object.hasOwn(detail, "sessionId"), false);
    assert.equal((await fetch(`${base}/chats/${chat.id}/prompts`, { method: "POST", headers, body: "{}" })).status, 400);
    assert.equal((await fetch(base + "/chats/missing", { headers })).status, 404);
  } finally {
    await service.stop(); server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
    store.close();
  }
});

test("multipart prompts retain original names and bytes, protect downloads and reject unsafe or excessive uploads", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "cortex-attachment-http-"));
  const store = new SqlitePromptQueueRepository(":memory:");
  const service = new PromptQueueService(store, { execute: async () => { throw new Error("No execution expected"); }, getCodexModels: async () => { throw new Error("No discovery expected"); } }, {
    assertMayStart: async () => {}, getConfiguration: async () => ({ enabled: false, minimumFiveHourRemainingPercent: 50, minimumWeeklyRemainingPercent: 10 }), getLastStatus: () => null,
    getStatus: async () => ({ available: true, checkedAt: new Date().toISOString(), fiveHour: { remainingPercent: 50, resetsAt: null }, weekly: { remainingPercent: 10, resetsAt: null }, error: null })
  }, 1000, path.join(directory, "chats"));
  const authentication = new PasswordAuthentication({ password: "test-password-for-attachments", secureCookie: false });
  const app = createCortexApplication({ projectUseCase: {} as ProjectUseCase, agentUseCase: {} as AgentUseCase,
    workflowScheduler: {} as WorkflowScheduler, authentication, clientDirectory: directory, promptQueue: service });
  const server = app.listen(0, "127.0.0.1");
  try {
    await once(server, "listening");
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/prompt-queue`;
    const headers = { cookie: `cortex_session=${authentication.authenticate("test-password-for-attachments")!}` };
    const chat = await service.create({ workingDirectory: directory, paused: true });
    const upload = (names: string[], content = "") => {
      const body = new FormData();
      body.append("message", JSON.stringify({ content, fileNames: names }));
      for (const name of names) body.append("files", new Blob([`Original: ${name}`]), "original.txt");
      return body;
    };
    assert.equal((await fetch(`${base}/chats/${chat.id}/prompts`, { method: "POST", body: upload(["secret.txt"]) })).status, 401);
    assert.equal((await fetch(`${base}/chats/${chat.id}/prompts`, { method: "POST", headers: { ...headers, origin: "https://unrelated.example" }, body: upload(["foreign.txt"]) })).status, 400);
    const response = await fetch(`${base}/chats/${chat.id}/prompts`, { method: "POST", headers, body: upload(["Référence été.txt", "document.pdf"]) });
    assert.equal(response.status, 201);
    const prompt = await response.json();
    assert.equal(prompt.content, "");
    assert.equal(prompt.attachments[0].name, "Référence été.txt");
    assert.equal(Object.hasOwn(prompt.attachments[0], "path"), false);
    const url = `${base}/chats/${chat.id}/prompts/${prompt.id}/attachments/${prompt.attachments[0].id}`;
    assert.equal((await fetch(url)).status, 401);
    const download = await fetch(url, { headers });
    assert.equal(download.status, 200);
    assert.match(download.headers.get("content-disposition")!, /^attachment;/);
    assert.equal(download.headers.get("x-content-type-options"), "nosniff");
    assert.equal(await download.text(), "Original: Référence été.txt");
    const other = await service.create({ workingDirectory: directory, paused: true });
    assert.equal((await fetch(url.replace(chat.id, other.id), { headers })).status, 404);
    for (const names of [["../outside.txt"], ["unsafe.svg"], Array.from({ length: 11 }, () => "text.txt")]) {
      assert.equal((await fetch(`${base}/chats/${chat.id}/prompts`, { method: "POST", headers, body: upload(names) })).status, 400);
    }
    assert.equal(service.detail(chat.id).prompts.length, 1);
    const ten = await fetch(`${base}/chats/${chat.id}/prompts`, { method: "POST", headers, body: upload(Array.from({ length: 10 }, (_, index) => `${index}.txt`)) });
    assert.equal(ten.status, 201);
  } finally {
    await service.stop(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); store.close();
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
    assert.ok(path.basename(directory).startsWith("cortex-attachment-http-"));
    await rm(directory, { recursive: true, force: true });
  }
});
