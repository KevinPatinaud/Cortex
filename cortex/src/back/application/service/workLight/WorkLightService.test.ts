import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { WorkLightService, validateConfiguration } from "./WorkLightService.ts";
import { WorkForceService, type WorkForceAgents } from "../workForce/WorkForceService.ts";
import { GlobalExecutionQueue } from "../executionQueue/GlobalExecutionQueue.ts";
import type { WorkForceAgent } from "../../../../shared/WorkForce.ts";
import type { CodexQuotaStatus } from "../../../../shared/CodexQuota.ts";

const agents: WorkForceAgent[] = ["A", "B", "C"].map(id => ({ agentId: id, projectId: "project", name: id, projectName: "Project", description: "" }));
const refs = agents.map(({ agentId, projectId }) => ({ agentId, projectId }));
async function until(check: () => boolean | Promise<boolean>) {
  for (let i = 0; i < 300; i++) { if (await check()) return; await delay(5); } assert.fail("Work Light did not settle");
}
async function fixture(run: (h: ReturnType<typeof harness>, file: string) => Promise<void>) {
  const directory = await mkdtemp(path.join(tmpdir(), "cortex-work-light-")), file = path.join(directory, "config.json"), h = harness(file);
  try { await run(h, file); } finally {
    h.release(); await h.service.stop(); h.queue.stop();
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir()));
    assert.ok(path.basename(directory).startsWith("cortex-work-light-")); await rm(directory, { recursive: true, force: true });
  }
}
function harness(file: string) {
  let clock = Date.parse("2026-10-28T10:59:00Z"), five = 30, weekly = 8, reads = 0, slow = false, failure = false, waiting = false, offline = false;
  let release = () => {}, active = 0, maximum = 0;
  const calls: string[] = [], queue = new GlobalExecutionQueue(file);
  const registry: WorkForceAgents = { async catalog() { return { agents, errors: [] }; }, async prepare(ref) {
    const agent = agents.find(item => item.agentId === ref.agentId)!;
    const controller = new AbortController(); let finish = () => {};
    return { agent, runner: { async run(control) {
      return queue.run({ source: "work-light", label: agent.name, key: agent.agentId, signal: controller.signal, waitForSlot: control.waitForSlot }, async () => {
        await control.beforeStart?.(); await control.onStarted?.(); calls.push(agent.name); active++; maximum = Math.max(maximum, active);
        try { if (slow) await new Promise<void>(resolve => { release = finish = resolve; }); if (failure) throw new Error("mission failed"); return { answer: "Result " + agent.name, waiting }; }
        finally { active--; }
      });
    }, cancel() { controller.abort(); finish(); } } };
  } };
  const quota = { async getStatus(): Promise<CodexQuotaStatus> { reads++; if (offline) throw new Error("offline"); return {
    available: true, checkedAt: new Date(clock).toISOString(), fiveHour: { remainingPercent: five, resetsAt: null }, weekly: { remainingPercent: weekly, resetsAt: null }, error: null }; } };
  const service = new WorkLightService(file, registry, quota, () => clock);
  return { service, queue, registry, quota, calls, maximum: () => maximum, reads: () => reads, now: () => clock,
    at: (iso: string) => { clock = Date.parse(iso); }, release: () => release(), slow: () => { slow = true; }, fail: () => { failure = true; }, wait: () => { waiting = true; }, offline: () => { offline = true; },
    quotas: (f: number, w: number) => { five = f; weekly = w; } };
}
const configure = (h: ReturnType<typeof harness>, crons = ["0 12,20 * * *"]) => h.service.saveConfiguration({ agents: refs, crons, timezone: "Europe/Paris" });

test("round robin launches exactly one agent at daily 12 and 20 slots, wraps, deduplicates cron rules and never chains", async () => fixture(async h => {
  await configure(h, ["0 12,20 * * *", "0 12 * * *"]); await h.service.arm(); assert.deepEqual(h.calls, []);
  for (const [index, at] of ["2026-10-28T11:00:00Z", "2026-10-28T19:00:00Z", "2026-10-29T11:00:00Z", "2026-10-29T19:00:00Z"].entries()) {
    h.at(at); await Promise.all(Array.from({ length: 10 }, () => h.service.tick()));
    assert.equal(h.calls.length, index + 1); await h.service.tick(); assert.equal(h.calls.length, index + 1);
  }
  assert.deepEqual(h.calls, ["A", "B", "C", "A"]);
  const state = await h.service.overview(); assert.equal(state.runtime.cursor, 1); assert.equal(state.runtime.completedCycles, 1); assert.equal(h.maximum(), 1);
  assert.equal(state.runtime.occurrences.length, 4); assert.equal(h.reads(), 8);
}));
test("both quota reserves are mandatory; skipped slots retain cursor and quota recovery never catches up", async () => fixture(async h => {
  await configure(h); await h.service.arm();
  h.quotas(29, 8); h.at("2026-10-28T11:00:00Z"); await h.service.tick();
  h.quotas(30, 7); h.at("2026-10-28T19:00:00Z"); await h.service.tick();
  assert.deepEqual(h.calls, []); assert.equal((await h.service.overview()).runtime.cursor, 0);
  h.quotas(30, 8); h.at("2026-10-28T19:05:00Z"); await h.service.tick(); assert.deepEqual(h.calls, []);
  h.at("2026-10-29T11:00:00Z"); await h.service.tick(); assert.deepEqual(h.calls, ["A"]);
  assert.deepEqual((await h.service.overview()).runtime.occurrences.map(item => item.outcome), ["started", "skipped", "skipped"]);
}));
test("unknown quota skips one slot and status/overview never probe quotas", async () => fixture(async h => {
  await configure(h); await h.service.arm(); await h.service.overview(); await h.service.status(); assert.equal(h.reads(), 0);
  h.offline(); h.at("2026-10-28T11:00:00Z"); await h.service.tick(); assert.equal(h.reads(), 1); assert.equal((await h.service.overview()).runtime.armed, true); assert.deepEqual(h.calls, []);
}));
test("later slots queue behind a long execution; stop cancels queued slots and drains the active agent", async () => fixture(async h => {
  await configure(h); h.slow(); await h.service.arm(); h.at("2026-10-28T11:00:00Z"); const run = h.service.tick(); await until(() => h.calls.length === 1);
  h.at("2026-10-28T19:00:00Z"); const queued = h.service.tick();
  await until(async () => (await h.queue.status()).waiting.length === 1);
  assert.equal((await h.service.overview()).runtime.occurrences[0].outcome, "queued");
  assert.equal((await h.service.disarm()).runtime.phase, "stopping"); assert.equal(h.service.isActive(), true);
  h.release(); await Promise.all([run, queued]); assert.equal(h.service.isActive(), false); assert.equal((await h.service.overview()).runtime.cursor, 1);
  await h.service.arm(); await h.service.tick(); assert.deepEqual(h.calls, ["A"]);
}));
test("busy slots wait beyond their minute, parallel mode admits different agents and serializes the same agent", async () => fixture(async h => {
  await configure(h); await h.service.arm();
  let release!: () => void; const block = h.queue.run({ source: "prompt", label: "Blocker", key: "other" }, () => new Promise<void>(resolve => { release = resolve; }));
  await until(() => Boolean(release)); h.at("2026-10-28T11:00:00Z"); const first = h.service.tick();
  await until(async () => (await h.queue.status()).waiting.length === 1); assert.deepEqual(h.calls, []);
  h.at("2026-10-28T11:05:00Z"); await h.queue.saveSettings({ allowParallelExecutions: true }); await first;
  assert.deepEqual(h.calls, ["A"]); release(); await block;
  const same = h.queue.run({ source: "prompt", label: "B", key: "B" }, () => new Promise<void>(resolve => { release = resolve; }));
  await until(async () => (await h.queue.status()).active.length === 1); h.at("2026-10-29T11:00:00Z"); const second = h.service.tick();
  await until(async () => (await h.queue.status()).waiting.length === 1); assert.deepEqual(h.calls, ["A"]);
  release(); await Promise.all([same, second]); assert.deepEqual(h.calls, ["A", "B"]);
}));
test("restart preserves next agent and skips offline slots and the minute of startup without replay", async () => fixture(async (h, file) => {
  await configure(h); await h.service.arm(); h.at("2026-10-28T11:00:00Z"); await h.service.tick(); await h.service.stop();
  h.at("2026-10-29T11:00:20Z"); const resumed = new WorkLightService(file, h.registry, h.quota, h.now);
  try { await resumed.tick(); assert.deepEqual(h.calls, ["A"]); assert.equal((await resumed.overview()).runtime.cursor, 1);
    h.at("2026-10-29T19:00:00Z"); await resumed.tick(); assert.deepEqual(h.calls, ["A", "B"]);
    h.at("2026-10-29T11:00:00Z"); await resumed.tick(); assert.deepEqual(h.calls, ["A", "B"]);
  } finally { await resumed.stop(); }
}));
test("a durable active marker after crash pauses for review without advancing or launching", async () => fixture(async (h, file) => {
  await configure(h); await h.service.arm(); const stored = JSON.parse(await readFile(file, "utf8"));
  stored.workLight.runtime.active = { agent: agents[0], startedAt: "2026-10-28T11:00:00Z", finishedAt: null, outcome: "running", error: null, answer: null };
  await writeFile(file, JSON.stringify(stored));
  const resumed = new WorkLightService(file, h.registry, h.quota, h.now);
  try { const view = await resumed.overview(); assert.equal(view.runtime.phase, "interrupted"); assert.equal(view.runtime.armed, false); assert.equal(view.runtime.cursor, 0); assert.equal(view.runtime.history[0].outcome, "interrupted"); await resumed.tick(); assert.deepEqual(h.calls, []); }
  finally { await resumed.stop(); }
}));
for (const externalWait of [false, true]) test("failure or external wait pauses without advancing: " + externalWait, async () => fixture(async h => {
  await configure(h); if (externalWait) h.wait(); else h.fail(); await h.service.arm(); h.at("2026-10-28T11:00:00Z"); await h.service.tick();
  const view = await h.service.overview(); assert.equal(view.runtime.phase, "failed"); assert.equal(view.runtime.cursor, 0); assert.equal(view.runtime.armed, false);
  h.at("2026-10-28T19:00:00Z"); await h.service.tick(); assert.deepEqual(h.calls, ["A"]);
}));
test("Work Force and Work Light can be armed together, including concurrent requests and future windows", async () => fixture(async (h, file) => {
  const force = new WorkForceService(file, h.registry, h.quota, h.now);
  try { await configure(h); await force.saveConfiguration({ agents: refs, startsAt: "2026-11-01T11:00:00Z", endsAt: null });
    const result = await Promise.allSettled([h.service.arm(), force.arm()]); assert.equal(result.filter(item => item.status === "fulfilled").length, 2);
    assert.equal((await h.service.status()).armed, true); assert.equal((await force.status()).armed, true);
    await h.service.disarm(); assert.equal((await force.status()).armed, true); await h.service.arm();
    await force.disarm(); assert.equal((await h.service.status()).armed, true); await force.arm();
  } finally { await force.stop(); }
}));
test("editing preserves the next agent by identity, quota settings stay independent and invalid schedules fail", async () => fixture(async (h, file) => {
  await configure(h); await h.service.arm(); h.at("2026-10-28T11:00:00Z"); await h.service.tick(); await h.service.disarm();
  await h.service.saveConfiguration({ agents: [refs[1], refs[2], refs[0]], crons: ["0 12 * * *"], timezone: "Europe/Paris" }); assert.equal((await h.service.overview()).runtime.cursor, 0); assert.equal((await h.service.overview()).configuration.agents[0].agentId, "B");
  await h.service.saveSettings({ minimumFiveHourRemainingPercent: 35, minimumWeeklyRemainingPercent: 9 });
  const force = new WorkForceService(file, h.registry, h.quota); assert.equal((await force.overview()).settings.minimumFiveHourRemainingPercent, 30); await force.stop();
  assert.throws(() => validateConfiguration({ agents: refs, crons: [], timezone: "UTC" }));
  assert.throws(() => validateConfiguration({ agents: refs, crons: ["0 0 31 2 *"], timezone: "UTC" }));
  assert.throws(() => validateConfiguration({ agents: refs, crons: ["nope"], timezone: "UTC" }));
  assert.throws(() => validateConfiguration({ agents: refs, crons: ["* * * * *"], timezone: "nope" }));
}));
test("cron preview merges coincident slots and follows Europe/Paris daylight saving", async () => fixture(async h => {
  h.at("2026-10-24T00:00:00Z"); const preview = h.service.preview({ cron: "0 12 * * *", timezone: "Europe/Paris" });
  assert.deepEqual(preview.nextRuns.slice(0, 2), ["2026-10-24T10:00:00.000Z", "2026-10-25T11:00:00.000Z"]);
  const view = await configure(h, ["0 12,20 * * *", "0 12 * * *"]); assert.equal(new Set(view.nextRuns).size, 5);
}));
for (const stop of [false, true]) test("a delayed quota read can launch after its minute but never after a manual stop: " + stop, async () => fixture(async (h, file) => {
  let release!: () => void, entered = false;
  const service = new WorkLightService(file, h.registry, { async getStatus() { if (!entered) { entered = true; await new Promise<void>(resolve => { release = resolve; }); } return h.quota.getStatus(); } }, h.now);
  try {
    await service.saveConfiguration({ agents: refs, crons: ["0 12,20 * * *"], timezone: "Europe/Paris" }); await service.arm();
    h.at("2026-10-28T11:00:00Z"); const run = service.tick(); await until(() => entered);
    if (stop) await service.disarm(); else h.at("2026-10-28T11:01:00Z");
    release(); await run; assert.deepEqual(h.calls, stop ? [] : ["A"]);
    const view = await service.overview(); assert.equal(view.runtime.cursor, stop ? 0 : 1); assert.equal(view.runtime.occurrences[0].outcome, stop ? "skipped" : "started");
  } finally { release?.(); await service.stop(); }
}));

test("every eligible occurrence queues a different rotation entry, deduplicates its minute and rechecks quota at launch", async () => fixture(async h => {
  await configure(h, ["* * * * *"]); await h.service.arm();
  let release!: () => void;
  const block = h.queue.run({ source: "normal", label: "Blocker" }, () => new Promise<void>(resolve => { release = resolve; }));
  await until(() => Boolean(release));
  h.at("2026-10-28T11:00:00Z"); const first = h.service.tick();
  await until(async () => (await h.queue.status()).waiting.length === 1);
  await h.service.tick();
  h.at("2026-10-28T11:01:00Z"); const second = h.service.tick();
  await until(async () => (await h.queue.status()).waiting.length === 2);
  assert.deepEqual((await h.queue.status()).waiting.map(entry => entry.label), ["A", "B"]);
  h.quotas(0, 0); release(); await Promise.all([block, first, second]);
  assert.deepEqual(h.calls, []);
  assert.equal((await h.queue.status()).waiting.length, 0);
  assert.deepEqual((await h.service.overview()).runtime.occurrences.map(item => item.outcome), ["skipped", "skipped"]);
  h.quotas(30, 8); h.at("2026-10-28T11:02:00Z"); await h.service.tick();
  assert.deepEqual(h.calls, ["A"]);
}));
