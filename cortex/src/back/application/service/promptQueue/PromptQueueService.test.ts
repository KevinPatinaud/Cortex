import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { access, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { AgentExecutionOptions } from "../iaService/AgentProvider.ts";
import { CodexQuotaService } from "../iaService/CodexQuotaService.ts";
import { SqlitePromptQueueRepository } from "../../../infrastructure/promptQueue/SqlitePromptQueueRepository.ts";
import { PromptQueueService } from "./PromptQueueService.ts";
import { GlobalExecutionQueue } from "../executionQueue/GlobalExecutionQueue.ts";
import { AgentService } from "../iaService/AgentService.ts";
import { AgentConfigurationService } from "../iaService/AgentConfigurationService.ts";
import type { CodexModelCatalog } from "../../../../shared/CodexModel.ts";

async function fixture(t: TestContext, hold = false, freezeTime = false) {
  const directory = await mkdtemp(path.join(tmpdir(), "cortex-prompt-queue-"));
  const file = path.join(directory, "queue.sqlite");
  const store = new SqlitePromptQueueRepository(file);
  let used = { fiveHour: 50, weekly: 90 }, unavailable = false, reads = 0, clock = Date.now();
  let queueClock: number | null = freezeTime ? Date.now() : null;
  const queueTime = () => queueClock ?? Date.now();
  const quota = new CodexQuotaService(path.join(directory, "config.json"), async () => {
    reads++;
    if (unavailable) throw new Error("Offline");
    return { rateLimits: { primary: { windowDurationMins: 300, usedPercent: used.fiveHour }, secondary: { windowDurationMins: 10080, usedPercent: used.weekly } } };
  }, () => clock);
  const calls: { prompt: string; options: AgentExecutionOptions; release: () => void }[] = [];
  const executor = {
    async execute(_engine: "codex" | "claude" | "copilot", prompt: string, options: AgentExecutionOptions) {
      let release!: () => void;
      const pending = new Promise<void>(resolve => { release = resolve; });
      const sessionId = options.sessionId ?? `session-${calls.length + 1}`;
      calls.push({ prompt, options, release });
      options.onSessionId?.(sessionId);
      options.onProgress?.("Aperçu en cours");
      if (hold) await Promise.race([pending, new Promise<never>((_, reject) => {
        options.signal?.addEventListener("abort", () => reject(new DOMException("Stopped", "AbortError")), { once: true });
      })]);
      if (prompt.includes("FAIL")) throw new Error("Provider failed");
      await delay(1);
      return { sessionId, answer: `Réponse : ${prompt}` };
    },
    async getCodexModels(): Promise<CodexModelCatalog> { return { available: true, models: [], cliVersion: null, defaultModel: null, checkedAt: new Date().toISOString(), error: null }; }
  };
  const service = new PromptQueueService(store, executor, quota, 10, path.join(directory, "chats"), undefined, queueTime);
  t.after(async () => {
    await service.stop(); store.close();
    const resolved = path.resolve(directory);
    assert.equal(path.dirname(resolved), path.resolve(tmpdir()));
    assert.ok(path.basename(resolved).startsWith("cortex-prompt-queue-"));
    await rm(resolved, { recursive: true, force: true });
  });
  return { directory, file, store, service, quota, calls, executor, time: queueTime, advance: (ms: number) => { queueClock = queueTime() + ms; },
    create: (title = "Chat") => service.create({ title, workingDirectory: directory, paused: true }),
    setUsed: (fiveHour: number, weekly: number) => { used = { fiveHour, weekly }; clock += 61_000; },
    offline: () => { unavailable = true; clock += 61_000; }, reads: () => reads };
}

async function until(predicate: () => boolean) {
  const end = Date.now() + 3000;
  while (!predicate() && Date.now() < end) await delay(5);
  assert.ok(predicate(), "Expected queue state was not reached");
}

test("an accepted stop wins over a late provider response and keeps following prompts paused", async t => {
  const f = await fixture(t), chat = await f.create();
  let release!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  f.executor.execute = async (_engine, _prompt, options) => {
    options.onProgress?.("Travail partiellement effectué");
    await pending;
    return { sessionId: "late-session", answer: "Late response after cancellation" };
  };
  const first = f.service.enqueue(chat.id, { content: "Stop this turn" });
  f.service.enqueue(chat.id, { content: "Keep this turn queued" });
  f.service.setPaused(chat.id, { paused: false });
  await f.service.tick();
  await until(() => Boolean(release) && f.service.detail(chat.id).prompts[0].status === "running");
  f.service.cancel(chat.id, first.id);
  release();
  await until(() => f.service.detail(chat.id).prompts[0].status !== "running");
  const detail = f.service.detail(chat.id);
  assert.equal(detail.prompts[0].status, "cancelled");
  assert.equal(detail.prompts[0].answer, "Travail partiellement effectué");
  assert.equal(detail.paused, true);
  assert.equal(detail.prompts[1].status, "queued");
});

test("a forced prompt in a paused chat waits for the global queue and leaves following prompts paused", async t => {
  const f = await fixture(t), queue = new GlobalExecutionQueue(path.join(f.directory, "config.json"));
  await queue.status();
  const original = f.executor.execute.bind(f.executor);
  const agentService = new AgentService([{ engine: "codex", label: "Test", isAvailable: async () => true,
    ask: (prompt, options = {}) => original("codex", prompt, options) }],
    new AgentConfigurationService(path.join(f.directory, "config.json")), undefined, undefined, undefined, queue);
  Object.assign(f.executor, { executionQueue: queue, execute: agentService.execute.bind(agentService) });
  let release!: () => void;
  const blocker = queue.run({ source: "normal", label: "Normal agent", key: "normal" },
    () => new Promise<void>(resolve => { release = resolve; }));
  await until(() => Boolean(release));
  f.setUsed(80, 99);
  const chat = await f.create(), first = f.service.enqueue(chat.id, { content: "Only this attempt", model: "test", reasoningEffort: "low" });
  f.service.enqueue(chat.id, { content: "Keep waiting" });
  f.service.forceNow(chat.id, first.id);
  await until(() => queue.hasExecutions() && f.service.detail(chat.id).progress !== null);
  assert.equal((await queue.status()).waiting.length, 1);
  assert.equal(f.calls.length, 0);
  assert.equal(f.service.detail(chat.id).prompts[0].startedAt, null);
  release(); await blocker;
  await until(() => f.service.detail(chat.id).prompts[0].status === "completed");
  assert.equal(f.calls.length, 1);
  assert.equal(f.service.detail(chat.id).paused, true);
  assert.equal(f.service.detail(chat.id).prompts[1].status, "queued");
  assert.equal(f.service.detail(chat.id).prompts[0].attempts, 1);
  assert.equal(f.service.detail(chat.id).prompts[0].quotaOverrideUsed, true);
  queue.stop();
});

test("scheduled prompts never launch early, preserve chat order and leave execution slots available to other chats", async t => {
  const f = await fixture(t, true, true), a = await f.create("Scheduled"), b = await f.create("Ready");
  f.service.setConcurrency({ maxConcurrentChats: 1 });
  const scheduledAt = new Date(f.time() + 60_000).toISOString();
  f.service.enqueue(a.id, { content: "A first", scheduledAt });
  f.service.enqueue(a.id, { content: "A second" });
  f.service.setPaused(a.id, { paused: false }); await f.service.tick();
  assert.equal(f.calls.length, 0); assert.equal(f.reads(), 0);
  f.service.enqueue(b.id, { content: "B immediately" });
  f.service.setPaused(b.id, { paused: false }); await f.service.tick();
  assert.deepEqual(f.calls.map(call => call.prompt), ["B immediately"]);
  f.calls[0].release(); await until(() => f.service.detail(b.id).prompts[0].status === "completed");
  f.advance(59_999); await f.service.tick(); assert.equal(f.calls.length, 1);
  f.advance(1); await f.service.tick(); assert.equal(f.calls.length, 2);
  assert.equal(f.calls[1].prompt, "A first");
  assert.equal(f.service.detail(a.id).prompts[0].startedAt, scheduledAt);
  f.calls[1].release(); await until(() => f.calls.length === 3);
  assert.equal(f.calls[2].prompt, "A second");
  assert.equal(f.calls[2].options.sessionId, f.calls[1].options.sessionId ?? "session-2");
  f.calls[2].release();
});

test("scheduled launch still requires quotas, and forcing reserves cannot bypass the chosen time", async t => {
  const f = await fixture(t, false, true), chat = await f.create();
  f.setUsed(80, 99);
  const prompt = await f.service.submit(chat.id, { content: "Wait for both", scheduledAt: new Date(f.time() + 60_000).toISOString() });
  f.service.setPaused(chat.id, { paused: false }); await f.service.tick();
  assert.throws(() => f.service.forceNow(chat.id, prompt.id), /programmé/);
  f.advance(60_000); await f.service.tick();
  assert.equal(f.calls.length, 0); assert.match(f.service.detail(chat.id).blockedReason!, /quotas/);
  f.setUsed(50, 90); await f.service.tick();
  await until(() => f.service.detail(chat.id).prompts[0].status === "completed");
  assert.equal(f.calls.length, 1);
});

test("rescheduling during a quota probe postpones the launch, and removing the schedule wakes the queue", async t => {
  const f = await fixture(t, false, true), chat = await f.create();
  const prompt = f.service.enqueue(chat.id, { content: "Keep content", model: "chosen", reasoningEffort: "high" });
  const originalCheck = f.quota.assertMayStart.bind(f.quota);
  let release!: () => void;
  f.quota.assertMayStart = () => new Promise(resolve => { release = resolve; });
  f.service.setPaused(chat.id, { paused: false }); await until(() => Boolean(release));
  const scheduledAt = new Date(f.time() + 60_000).toISOString();
  f.service.edit(chat.id, prompt.id, { scheduledAt });
  release(); await f.service.tick(); assert.equal(f.calls.length, 0);
  assert.deepEqual([f.service.detail(chat.id).prompts[0].content, f.service.detail(chat.id).prompts[0].model], ["Keep content", "chosen"]);
  assert.equal((await f.service.overview()).chats[0].nextScheduledAt, scheduledAt);
  f.quota.assertMayStart = originalCheck;
  f.service.edit(chat.id, prompt.id, { scheduledAt: null }); await f.service.tick();
  assert.equal(f.calls.length, 1);
});

test("schedule validation requires a real future instant with a timezone, preserves atomic edits and normalizes offsets", async t => {
  const f = await fixture(t, false, true), chat = await f.create();
  for (const scheduledAt of ["", false, 42, {}, new Date(f.time() - 1).toISOString(), "2099-02-30T12:00:00Z", "2099-01-01T12:00", "2099-01-01T12:00:00", "2099-13-01T12:00:00Z"]) {
    assert.throws(() => f.service.enqueue(chat.id, { content: "Invalid", scheduledAt }));
  }
  assert.equal(f.service.detail(chat.id).prompts.length, 0);
  const prompt = f.service.enqueue(chat.id, { content: "Original", scheduledAt: "2099-03-31T12:45:00+02:00" });
  assert.equal(prompt.scheduledAt, "2099-03-31T10:45:00.000Z");
  assert.throws(() => f.service.edit(chat.id, prompt.id, { content: "Changed", scheduledAt: "bad" }));
  assert.equal(f.service.detail(chat.id).prompts[0].content, "Original");
});

test("scheduled work survives a reopened database and starts once if its date has passed during downtime", async t => {
  const f = await fixture(t, false, true), chat = await f.create();
  const prompt = f.service.enqueue(chat.id, { content: "After restart", scheduledAt: new Date(f.time() + 60_000).toISOString() });
  f.service.setPaused(chat.id, { paused: false }); await f.service.tick(); await f.service.stop();
  const store = new SqlitePromptQueueRepository(f.file);
  const resumed = new PromptQueueService(store, f.executor, f.quota, 10, path.join(f.directory, "chats"), undefined, f.time);
  try {
    assert.equal(resumed.detail(chat.id).prompts[0].scheduledAt, prompt.scheduledAt);
    await resumed.tick(); assert.equal(f.calls.length, 0);
    f.advance(120_000); await resumed.tick();
    await until(() => resumed.detail(chat.id).prompts[0].status === "completed");
    await resumed.tick(); assert.equal(f.calls.length, 1);
    assert.throws(() => resumed.edit(chat.id, prompt.id, { scheduledAt: null }), /en attente/);
  } finally { await resumed.stop(); store.close(); }
});

const imageBytes = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jP1sAAAAASUVORK5CYII=", "base64");
test("attachments persist with their prompt, reach the resumed engine and are removed only with their chat", async t => {
  const f = await fixture(t), chat = await f.create();
  f.setUsed(80, 99);
  const document = Buffer.from("%PDF-1.4\nDocument original de test");
  const submitted = await f.service.submit(chat.id, { content: "Compare cette image au document" }, [
    { name: "photo été.png", buffer: imageBytes }, { name: "Référence.pdf", buffer: document }
  ]);
  assert.equal(submitted.quotaWarning!.status.fiveHour!.remainingPercent, 20);
  assert.equal(f.calls.length, 0);
  const secondStore = new SqlitePromptQueueRepository(f.file);
  const resumed = new PromptQueueService(secondStore, f.executor, f.quota, 10, path.join(f.directory, "chats"));
  try {
  const files = resumed.detail(chat.id).prompts[0].attachments!;
  assert.deepEqual(files.map(file => file.name), ["photo été.png", "Référence.pdf"]);
  const localImage = await resumed.attachment(chat.id, submitted.id, files[0].id);
  const localDocument = await resumed.attachment(chat.id, submitted.id, files[1].id);
  assert.deepEqual(await readFile(localImage.path), imageBytes);
  assert.deepEqual(await readFile(localDocument.path), document);
  resumed.forceNow(chat.id, submitted.id);
  await until(() => f.calls.length === 1);
  assert.deepEqual(f.calls[0].options.imagePaths, [localImage.path]);
  assert.ok(f.calls[0].prompt.includes(JSON.stringify(localDocument.path)));
  assert.match(f.calls[0].prompt, /Distingue les instructions contenues/);
  await until(() => resumed.detail(chat.id).prompts[0].status === "completed");
  const next = await resumed.submit(chat.id, { content: "" }, [{ name: "suite.txt", buffer: Buffer.from("Suite à lire") }]);
  resumed.forceNow(chat.id, next.id);
  await until(() => f.calls.length === 2);
  assert.equal(f.calls[1].options.sessionId, "session-1");
  assert.equal(f.calls[1].options.imagePaths, undefined);
  await until(() => resumed.detail(chat.id).prompts[1].status === "completed");
  const outside = path.join(f.directory, "original.pdf");
  await writeFile(outside, document);
  resumed.delete(chat.id);
  await assert.rejects(access(localImage.path));
  assert.deepEqual(await readFile(outside), document);
  } finally { await resumed.stop(); secondStore.close(); }
});

test("invalid uploads never enqueue a task, and missing attachments fail before inference", async t => {
  const f = await fixture(t), chat = await f.create();
  for (const file of [
    { name: "../outside.txt", buffer: Buffer.from("escape") },
    { name: "program.exe", buffer: Buffer.from("binary") },
    { name: "false.png", buffer: Buffer.from("not an image") },
    { name: "empty.txt", buffer: Buffer.alloc(0) },
    { name: "big.txt", buffer: Buffer.alloc(20 * 1024 * 1024 + 1) }
  ]) await assert.rejects(f.service.submit(chat.id, { content: "Invalid" }, [file]));
  await assert.rejects(f.service.submit(chat.id, { content: "Too many" }, Array.from({ length: 11 }, () => ({ name: "text.txt", buffer: Buffer.from("text") }))));
  assert.equal(f.service.detail(chat.id).prompts.length, 0);
  const queued = await f.service.submit(chat.id, { content: "  \n  " }, [{ name: "image.png", buffer: imageBytes }]);
  assert.equal(queued.content, "");
  f.service.edit(chat.id, queued.id, { content: " " });
  assert.equal(f.service.detail(chat.id).title, chat.title);
  const attachment = await f.service.attachment(chat.id, queued.id, queued.attachments![0].id);
  await rm(attachment.path);
  f.service.forceNow(chat.id, queued.id);
  await until(() => f.service.detail(chat.id).prompts[0].status === "failed");
  assert.equal(f.calls.length, 0);
  assert.match(f.service.detail(chat.id).prompts[0].error!, /manquante/);
});

test("submission warnings use current configured thresholds, permit equality and describe unavailable quotas", async t => {
  const f = await fixture(t), chat = await f.create();
  await f.quota.saveConfiguration({ enabled: false, minimumFiveHourRemainingPercent: 60, minimumWeeklyRemainingPercent: 15 });
  for (const [fiveHourUsed, weeklyUsed, expected] of [[41, 0, /5 h/], [0, 86, /semaine/]] as const) {
    f.setUsed(fiveHourUsed, weeklyUsed);
    const result = await f.service.submit(chat.id, { content: "Prepared" });
    assert.match(result.quotaWarning!.reason, expected);
    assert.equal(result.quotaWarning!.quota.minimumFiveHourRemainingPercent, 60);
    assert.equal(result.status, "queued");
  }
  f.setUsed(40, 85);
  assert.equal((await f.service.submit(chat.id, { content: "At both thresholds" })).quotaWarning, null);
  f.offline();
  const offline = await f.service.submit(chat.id, { content: "Offline" });
  assert.equal(offline.quotaWarning!.status.available, false);
  assert.equal(f.calls.length, 0);
});

test("forcing starts only the selected attempt, keeps its profile and restores quota gates for the next prompt", async t => {
  const f = await fixture(t, true), chat = await f.create();
  f.setUsed(80, 99);
  const first = await f.service.submit(chat.id, { content: "First", model: "selected-model", reasoningEffort: "high" });
  const second = f.service.enqueue(chat.id, { content: "Second" });
  f.service.setPaused(chat.id, { paused: false }); await f.service.tick();
  assert.equal(f.calls.length, 0);
  assert.throws(() => f.service.forceNow(chat.id, second.id), /précédents/);
  const before = await f.quota.getConfiguration();
  f.service.forceNow(chat.id, first.id);
  assert.equal(f.calls.length, 1);
  assert.equal(f.service.detail(chat.id).prompts[0].quotaOverrideUsed, true);
  assert.deepEqual([f.calls[0].options.model, f.calls[0].options.reasoningEffort], ["selected-model", "high"]);
  assert.throws(() => f.service.forceNow(chat.id, first.id), /en attente/);
  f.calls[0].release(); await until(() => f.service.detail(chat.id).prompts[0].status === "completed");
  await f.service.tick();
  assert.equal(f.calls.length, 1);
  assert.equal(f.service.detail(chat.id).prompts[1].status, "queued");
  assert.deepEqual(await f.quota.getConfiguration(), before);
  f.setUsed(50, 90); await f.service.tick();
  assert.equal(f.calls.length, 2);
  assert.equal(f.service.detail(chat.id).prompts[1].quotaOverrideUsed, false);
  assert.equal(f.calls[1].options.sessionId, "session-1");
  f.calls[1].release();
});

test("manual execution respects capacity, preserves pause and does not duplicate a turn whose automatic probe is in flight", async t => {
  const f = await fixture(t, true), a = await f.create("A"), b = await f.create("B");
  f.service.setConcurrency({ maxConcurrentChats: 1 });
  const first = f.service.enqueue(a.id, { content: "First" });
  const waiting = f.service.enqueue(b.id, { content: "Waiting" });
  let release!: () => void;
  f.quota.assertMayStart = () => new Promise(resolve => { release = resolve; });
  f.service.setPaused(a.id, { paused: false });
  await until(() => Boolean(release));
  f.service.forceNow(b.id, waiting.id);
  assert.equal(f.service.detail(b.id).paused, true);
  assert.throws(() => f.service.forceNow(a.id, first.id), /créneaux/);
  release(); await f.service.tick();
  assert.equal(f.calls.length, 1);
  assert.equal(f.service.detail(a.id).prompts[0].status, "queued");
  f.service.setPaused(a.id, { paused: true });
  f.calls[0].release(); await until(() => f.service.detail(b.id).prompts[0].status === "completed");
  // A forced claim of the very same head also wins over its outstanding probe.
  release = undefined!;
  f.service.setPaused(a.id, { paused: false });
  await until(() => Boolean(release));
  f.service.forceNow(a.id, first.id);
  release(); await f.service.tick();
  assert.equal(f.calls.length, 2);
  f.calls[1].release();
});

test("a failed forced attempt cannot authorize a retry, and unavailable quotas can be explicitly overridden", async t => {
  const f = await fixture(t), chat = await f.create();
  f.offline();
  const prompt = await f.service.submit(chat.id, { content: "FAIL" });
  f.service.forceNow(chat.id, prompt.id);
  await until(() => f.service.detail(chat.id).prompts[0].status === "failed");
  f.service.retry(chat.id, prompt.id); await f.service.tick();
  assert.equal(f.calls.length, 1);
  assert.equal(f.service.detail(chat.id).prompts[0].quotaOverrideUsed, false);
  assert.equal(f.service.detail(chat.id).prompts[0].status, "queued");
});

test("preparing a chat never runs inference, and mandatory queue reserves apply even when the global toggle is off", async t => {
  const f = await fixture(t);
  const chat = await f.create();
  f.service.enqueue(chat.id, { content: "Prepared prompt" });
  await f.service.tick();
  assert.equal(f.calls.length, 0);
  assert.equal(f.reads(), 0);
  assert.equal((await f.quota.getConfiguration()).enabled, false);
  f.setUsed(51, 0);
  f.service.setPaused(chat.id, { paused: false }); await f.service.tick();
  assert.equal(f.calls.length, 0);
  assert.equal(f.service.detail(chat.id).prompts[0].status, "queued");
  assert.match(f.service.detail(chat.id).blockedReason!, /5 h : 49 %/);
  f.setUsed(0, 91); await f.service.tick();
  assert.equal(f.calls.length, 0);
  assert.match(f.service.detail(chat.id).blockedReason!, /semaine : 9 %/);
  f.offline(); await f.service.tick();
  assert.equal(f.calls.length, 0);
  assert.match(f.service.detail(chat.id).blockedReason!, /indisponibles/);
});

test("exactly 50% and 10% permit a launch, and every next prompt uses a fresh quota reading", async t => {
  const f = await fixture(t, true);
  const chat = await f.create();
  f.service.enqueue(chat.id, { content: "First" });
  f.service.enqueue(chat.id, { content: "Second" });
  f.service.setPaused(chat.id, { paused: false }); await f.service.tick();
  assert.equal(f.calls.length, 1);
  f.setUsed(51, 0); f.calls[0].release();
  await until(() => f.service.detail(chat.id).prompts[0].status === "completed");
  await f.service.tick();
  assert.equal(f.calls.length, 1);
  assert.equal(f.service.detail(chat.id).prompts[1].status, "queued");
  f.setUsed(50, 90); await f.service.tick();
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[1].options.sessionId, "session-1");
  assert.ok(f.reads() >= 3);
  f.calls[1].release();
  await until(() => f.service.detail(chat.id).prompts.every(prompt => prompt.status === "completed"));
});

test("automatic polling resumes queued work once reserves recover", async t => {
  const f = await fixture(t);
  const chat = await f.create();
  f.setUsed(70, 95);
  f.service.enqueue(chat.id, { content: "Waiting" });
  f.service.setPaused(chat.id, { paused: false }); await f.service.tick();
  assert.equal(f.calls.length, 0);
  f.service.start(); f.setUsed(50, 90);
  await until(() => f.service.detail(chat.id).prompts[0].status === "completed");
  assert.equal(f.calls.length, 1);
});

test("different chats run concurrently, each chat stays sequential and retains an isolated session", async t => {
  const f = await fixture(t, true);
  const a = await f.create("A"), b = await f.create("B");
  for (const chat of [a, b]) {
    f.service.enqueue(chat.id, { content: `${chat.title}-1` });
    f.service.enqueue(chat.id, { content: `${chat.title}-2` });
    f.service.setPaused(chat.id, { paused: false });
  }
  await f.service.tick();
  assert.equal(f.calls.length, 2);
  assert.deepEqual(f.calls.map(call => call.prompt), ["A-1", "B-1"]);
  assert.equal(f.calls[0].options.sessionId, undefined);
  assert.equal(f.calls[1].options.sessionId, undefined);
  f.calls[0].release();
  await until(() => f.calls.length === 3);
  assert.equal(f.calls[2].prompt, "A-2");
  assert.equal(f.calls[2].options.sessionId, "session-1");
  assert.equal(f.service.detail(b.id).prompts[0].status, "running");
  f.calls[1].release();
  await until(() => f.calls.length === 4);
  assert.equal(f.calls[3].options.sessionId, "session-2");
  f.calls[2].release(); f.calls[3].release();
  await until(() => f.service.detail(a.id).prompts.every(prompt => prompt.status === "completed"));
});

test("a single execution slot rotates between chats without replaying completed prompts", async t => {
  const f = await fixture(t, true);
  f.service.setConcurrency({ maxConcurrentChats: 1 });
  const a = await f.create("A"), b = await f.create("B");
  for (const chat of [a, b]) {
    f.service.enqueue(chat.id, { content: `${chat.title}-1` });
    f.service.enqueue(chat.id, { content: `${chat.title}-2` });
    f.service.setPaused(chat.id, { paused: false });
  }
  await f.service.tick(); assert.equal(f.calls.length, 1);
  f.calls[0].release(); await until(() => f.calls.length === 2);
  assert.equal(f.calls[1].prompt, "B-1");
  f.calls[1].release(); await until(() => f.calls.length === 3);
  assert.equal(f.calls[2].prompt, "A-2");
  f.calls[2].release(); await until(() => f.calls.length === 4);
  f.calls[3].release();
});

test("pausing during a turn lets it finish and prevents the next launch", async t => {
  const f = await fixture(t, true), chat = await f.create();
  f.service.enqueue(chat.id, { content: "First" }); f.service.enqueue(chat.id, { content: "Next" });
  f.service.setPaused(chat.id, { paused: false }); await f.service.tick();
  f.service.setPaused(chat.id, { paused: true });
  assert.equal(f.calls[0].options.signal?.aborted, false);
  f.calls[0].release(); await until(() => f.service.detail(chat.id).prompts[0].status === "completed");
  await f.service.tick(); assert.equal(f.calls.length, 1);
});

test("engine errors pause the chat; following prompts wait until retry succeeds or the failed prompt is cancelled", async t => {
  const f = await fixture(t), chat = await f.create();
  const first = f.service.enqueue(chat.id, { content: "FAIL" });
  f.service.enqueue(chat.id, { content: "Next" });
  f.service.setPaused(chat.id, { paused: false });
  await until(() => f.service.detail(chat.id).prompts[0].status === "failed");
  assert.equal(f.service.detail(chat.id).paused, true);
  f.service.setPaused(chat.id, { paused: false }); await f.service.tick(); assert.equal(f.calls.length, 1);
  f.service.cancel(chat.id, first.id);
  await until(() => f.service.detail(chat.id).prompts[1].status === "completed");
  assert.equal(f.calls[1].options.sessionId, "session-1");
});

test("shutdown preserves the session and unfinished turn for explicit recovery", async t => {
  const f = await fixture(t, true), chat = await f.create();
  const prompt = f.service.enqueue(chat.id, { content: "Interrupted task" });
  f.service.enqueue(chat.id, { content: "Next" });
  f.service.setPaused(chat.id, { paused: false }); await f.service.tick();
  await f.service.stop();
  assert.equal(f.service.detail(chat.id).prompts[0].status, "interrupted");
  const reopened = new SqlitePromptQueueRepository(f.file);
  const resumed = new PromptQueueService(reopened, f.executor, f.quota);
  try {
    assert.equal(resumed.detail(chat.id).paused, true);
    assert.equal(reopened.chat(chat.id)?.sessionId, "session-1");
    await resumed.tick(); assert.equal(f.calls.length, 1);
    resumed.retry(chat.id, prompt.id); await resumed.tick();
    assert.equal(f.calls[1].options.sessionId, "session-1");
    assert.match(f.calls[1].prompt, /effets déjà produits/);
    f.calls[1].release();
    await until(() => resumed.detail(chat.id).prompts[0].status === "completed");
  } finally { await resumed.stop(); reopened.close(); }
});

test("a crash marks only the running prompt interrupted and never replays completed turns", async t => {
  const f = await fixture(t), chat = await f.create();
  const done = f.service.enqueue(chat.id, { content: "Done" }), running = f.service.enqueue(chat.id, { content: "Running" });
  f.service.enqueue(chat.id, { content: "Next" });
  await f.service.stop();
  f.store.savePrompt({ ...done, status: "completed", answer: "Saved answer" });
  f.store.savePrompt({ ...running, status: "running" });
  f.store.saveChat({ ...f.store.chat(chat.id)!, paused: false, sessionId: "existing-session" });
  const recovered = new PromptQueueService(f.store, f.executor, f.quota);
  try {
    recovered.start();
    assert.deepEqual(recovered.detail(chat.id).prompts.map(prompt => prompt.status), ["completed", "interrupted", "queued"]);
    assert.equal(recovered.detail(chat.id).paused, true);
    await recovered.tick(); assert.equal(f.calls.length, 0);
  } finally { await recovered.stop(); }
});

test("constructing another HTTP server's queue does not recover a turn still owned by the running server", async t => {
  const f = await fixture(t, true), chat = await f.create();
  f.service.enqueue(chat.id, { content: "Still running" });
  f.service.setPaused(chat.id, { paused: false }); await f.service.tick();
  const secondStore = new SqlitePromptQueueRepository(f.file);
  const second = new PromptQueueService(secondStore, f.executor, f.quota);
  try {
    assert.equal(second.detail(chat.id).prompts[0].status, "running");
    assert.equal(second.detail(chat.id).paused, false);
  } finally { await second.stop(); secondStore.close(); }
  f.calls[0].release();
  await until(() => f.service.detail(chat.id).prompts[0].status === "completed");
});

test("queued prompts can be edited and cancelled; invalid inputs and active chat deletion are rejected", async t => {
  const f = await fixture(t, true), chat = await f.create();
  const prompt = f.service.enqueue(chat.id, { content: "Initial" });
  f.service.edit(chat.id, prompt.id, { content: "Edited" });
  assert.throws(() => f.service.enqueue(chat.id, { content: " " }));
  assert.throws(() => f.service.setConcurrency({ maxConcurrentChats: 0 }));
  assert.throws(() => f.service.setConcurrency({ maxConcurrentChats: 1.5 }));
  assert.throws(() => f.service.setPaused(chat.id, { paused: "false" }));
  await assert.rejects(f.service.create({ title: "Invalid", workingDirectory: "relative/path" }));
  await assert.rejects(f.service.create({ title: "Invalid", workingDirectory: path.join(f.directory, "missing") }));
  f.service.setPaused(chat.id, { paused: false }); await f.service.tick();
  assert.equal(f.calls[0].prompt, "Edited");
  assert.throws(() => f.service.edit(chat.id, prompt.id, { content: "Late" }));
  assert.throws(() => f.service.delete(chat.id));
  f.service.cancel(chat.id, prompt.id);
  await until(() => f.service.detail(chat.id).prompts[0].status === "cancelled");
  assert.equal(f.service.detail(chat.id).paused, true);
  f.service.delete(chat.id); assert.throws(() => f.service.detail(chat.id));
});

test("a pause or cancellation during a quota probe prevents launch", async t => {
  const f = await fixture(t), chat = await f.create();
  f.service.enqueue(chat.id, { content: "Do not run" });
  let release!: () => void;
  f.quota.assertMayStart = () => new Promise(resolve => { release = resolve; });
  f.service.setPaused(chat.id, { paused: false });
  await until(() => Boolean(release));
  f.service.setPaused(chat.id, { paused: true }); release(); await f.service.tick();
  assert.equal(f.calls.length, 0);
});

test("new chats pin a supported catalog default when the CLI default is absent, without replacing explicit choices", async t => {
  const f = await fixture(t);
  f.executor.getCodexModels = async () => ({ available: true, cliVersion: null, checkedAt: new Date().toISOString(), error: null,
    defaultModel: "unavailable-configured-model", configuredReasoningEffort: "xhigh",
    models: [{ model: "catalog-default", displayName: "Catalog default", isDefault: true, reasoningEfforts: ["low", "high"], defaultReasoningEffort: "low" }] });
  const chat = await f.create();
  assert.equal(chat.model, "catalog-default");
  assert.equal(chat.reasoningEffort, "low");
  const explicit = await f.service.create({ title: "Explicit", workingDirectory: f.directory, model: "saved-explicit-model", reasoningEffort: "high" });
  assert.equal(explicit.model, "saved-explicit-model");
  assert.equal(explicit.reasoningEffort, "high");
  assert.equal(f.calls.length, 0);
  await f.service.configureChat(explicit.id, { title: "Use automatic selection", model: "", reasoningEffort: "" });
  assert.equal(f.service.detail(explicit.id).model, "catalog-default");
  assert.equal(f.service.detail(explicit.id).reasoningEffort, "low");
  f.executor.getCodexModels = async () => { throw new Error("Offline"); };
  const offline = await f.create("Prepared while offline");
  assert.equal(offline.paused, true);
  assert.equal(offline.model, "");
});

test("zero-configuration chats receive separate managed folders and a title from their first prompt while preserving quota gates", async t => {
  const f = await fixture(t);
  f.setUsed(51, 0);
  const a = await f.service.create(), b = await f.service.create({});
  assert.equal(a.title, "Nouveau chat");
  assert.equal(a.paused, false);
  assert.notEqual(a.workingDirectory, b.workingDirectory);
  for (const chat of [a, b]) {
    assert.equal(path.dirname(chat.workingDirectory), path.join(f.directory, "chats"));
    assert.ok((await stat(chat.workingDirectory)).isDirectory());
  }
  f.service.enqueue(a.id, { content: "# Préparer mon projet\n\nPremière demande." });
  f.service.enqueue(a.id, { content: "Suite de la demande" });
  await f.service.tick();
  assert.equal(f.service.detail(a.id).title, "Préparer mon projet Première demande.");
  assert.equal(f.calls.length, 0);
  assert.match(f.service.detail(a.id).blockedReason!, /49 %/);
  assert.equal(Object.hasOwn(f.service.detail(a.id), "automaticTitle"), false);
});

test("saved defaults survive reopen, apply to new chats and never change existing chats", async t => {
  const f = await fixture(t);
  const previous = await f.create("Existing chat");
  const defaults = { workingDirectory: f.directory, model: "my-selected-model", reasoningEffort: "high", autoStart: false };
  await f.service.saveSettings({ defaults, maxConcurrentChats: 1 });
  const next = await f.service.create();
  assert.equal(next.model, "my-selected-model");
  assert.equal(next.reasoningEffort, "high");
  assert.equal(next.workingDirectory, f.directory);
  assert.equal(next.paused, true);
  assert.deepEqual(f.service.detail(previous.id), { ...previous, progress: null });
  const reopened = new SqlitePromptQueueRepository(f.file);
  try { assert.deepEqual(reopened.defaults(), defaults); assert.equal(reopened.concurrency(), 1); }
  finally { reopened.close(); }
  await f.service.saveSettings({ maxConcurrentChats: 3 });
  assert.deepEqual(f.service.settings(), { maxConcurrentChats: 3, defaults });
});

test("invalid defaults never partially update persisted settings", async t => {
  const f = await fixture(t);
  const original = f.service.settings();
  for (const defaults of [{ workingDirectory: "relative" }, { workingDirectory: path.join(f.directory, "missing") },
    { autoStart: "yes" }, { model: null }, { reasoningEffort: [] }]) {
    await assert.rejects(f.service.saveSettings({ maxConcurrentChats: 1, defaults }));
    assert.deepEqual(f.service.settings(), original);
  }
  await assert.rejects(f.service.saveSettings({ maxConcurrentChats: 9, defaults: { autoStart: false } }));
  assert.deepEqual(f.service.settings(), original);
  await assert.rejects(f.service.create({ paused: "yes" }));
});

test("each queued prompt keeps its selected model and reasoning level while the chat preference changes", async t => {
  const f = await fixture(t, true), chat = await f.create();
  const first = f.service.enqueue(chat.id, { content: "First profile", model: "model-a", reasoningEffort: "low" });
  f.service.setPaused(chat.id, { paused: false }); await f.service.tick();
  assert.equal(f.calls[0].options.model, "model-a");
  assert.equal(f.calls[0].options.reasoningEffort, "low");
  const second = f.service.enqueue(chat.id, { content: "Next profile", model: "model-b", reasoningEffort: "high" });
  const third = f.service.enqueue(chat.id, { content: "Reuse preference" });
  assert.equal(f.calls[0].options.signal?.aborted, false);
  assert.deepEqual(f.service.detail(chat.id).prompts.map(prompt => [prompt.model, prompt.reasoningEffort]), [["model-a", "low"], ["model-b", "high"], ["model-b", "high"]]);
  assert.deepEqual([f.service.detail(chat.id).model, f.service.detail(chat.id).reasoningEffort], ["model-b", "high"]);
  f.calls[0].release(); await until(() => f.calls.length === 2);
  assert.equal(f.calls[1].options.model, "model-b");
  assert.equal(f.calls[1].options.reasoningEffort, "high");
  assert.equal(f.calls[1].options.sessionId, f.store.chat(chat.id)?.sessionId);
  f.calls[1].release(); await until(() => f.calls.length === 3);
  f.calls[2].release(); await until(() => f.service.detail(chat.id).prompts.every(prompt => prompt.status === "completed"));
  assert.deepEqual(f.service.detail(chat.id).prompts.map(prompt => prompt.id), [first.id, second.id, third.id]);
});

test("older pending prompts are pinned before a new composer selection replaces the chat preference", async t => {
  const f = await fixture(t), chat = await f.create();
  await f.service.configureChat(chat.id, { title: "Existing chat", model: "original", reasoningEffort: "low" });
  const first = f.service.enqueue(chat.id, { content: "Legacy pending turn" });
  const { model, reasoningEffort, ...legacy } = first;
  f.store.savePrompt(legacy);
  f.service.enqueue(chat.id, { content: "New turn", model: "new-choice", reasoningEffort: "ultra" });
  assert.equal(f.service.detail(chat.id).prompts[0].model, "original");
  assert.equal(f.service.detail(chat.id).prompts[0].reasoningEffort, "low");
  assert.equal(f.service.detail(chat.id).prompts[1].model, "new-choice");
  const { model: secondModel, reasoningEffort: secondEffort, ...secondLegacy } = f.service.detail(chat.id).prompts[1];
  f.store.savePrompt(secondLegacy);
  await f.service.configureChat(chat.id, { title: "Menu selection", model: "from-settings", reasoningEffort: "high" });
  assert.equal(f.service.detail(chat.id).prompts[1].model, "new-choice");
  assert.equal(f.service.detail(chat.id).prompts[1].reasoningEffort, "ultra");
});

test("invalid composer selections are rejected before changing the queue or preference", async t => {
  const f = await fixture(t), chat = await f.create();
  const original = f.service.detail(chat.id);
  for (const selection of [{ model: 42 }, { model: " " }, { model: "x".repeat(161) }, { model: "valid", reasoningEffort: {} }]) {
    assert.throws(() => f.service.enqueue(chat.id, { content: "Do not queue", ...selection }));
    assert.deepEqual(f.service.detail(chat.id), original);
  }
  assert.equal(f.calls.length, 0);
});
