import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { WorkForceService, validateConfiguration, validateSettings, type WorkForceAgents } from "./WorkForceService.ts";
import type { CodexQuotaStatus } from "../../../../shared/CodexQuota.ts";
import { WORK_FORCE_QUOTA_RETRY_MS, type WorkForceAgent } from "../../../../shared/WorkForce.ts";
import { ExecutionWorkspaceBusyError } from "../executionWorkspace/ExecutionWorkspaceGuard.ts";

async function until(check: () => boolean | Promise<boolean>) {
  for (let i = 0; i < 500; i++) { if (await check()) return; await delay(5); }
  assert.fail("Work Force did not reach the expected state");
}
const agents: WorkForceAgent[] = ["A", "B"].map(id => ({ projectId: `project-${id}`, agentId: id, projectName: `Project ${id}`, name: id, description: `Agent ${id}` }));
const refs = agents.map(({ projectId, agentId }) => ({ projectId, agentId }));
function harness(file: string) {
  let clock = Date.parse("2026-10-27T10:00:00Z"), reads = 0, active = 0, maximum = 0;
  let fiveHour = 30, weekly = 8, available = true, throwQuota = false, busy = false;
  const calls: string[] = [], pending: Array<{ finish(waiting?: boolean): void; fail(error: Error): void }> = [];
  const registry: WorkForceAgents = {
    async catalog() { return { agents, errors: [] }; },
    async prepare(ref) {
      if (busy) throw new ExecutionWorkspaceBusyError("Projet occupé");
      const agent = agents.find(agent => agent.agentId === ref.agentId)!;
      let cancel = () => {};
      return { agent, runner: {
        async run(control) {
          await control.beforeStart?.();
          await control.onStarted?.();
          calls.push(agent.agentId); active++; maximum = Math.max(maximum, active);
          return new Promise<{ answer: string; waiting: boolean }>((resolve, reject) => {
            let done = false;
            const finish = (waiting = false) => { if (done) return; done = true; active--; resolve({ answer: `Result ${agent.agentId}`, waiting }); };
            const fail = (error: Error) => { if (done) return; done = true; active--; reject(error); };
            cancel = () => fail(new Error("Interrupted"));
            pending.push({ finish, fail });
          });
        }, cancel() { cancel(); }
      } };
    }
  };
  const quota = { async getStatus(): Promise<CodexQuotaStatus> {
    reads++;
    if (throwQuota) throw new Error("offline");
    return { available, checkedAt: new Date(clock).toISOString(), fiveHour: available ? { remainingPercent: fiveHour, resetsAt: null } : null,
      weekly: available ? { remainingPercent: weekly, resetsAt: null } : null, error: available ? null : "Quotas inconnus" };
  } };
  const service = new WorkForceService(file, registry, quota, () => clock);
  return { service, registry, quota, now: () => clock, calls, pending, reads: () => reads, maximum: () => maximum,
    advance: (ms: number) => { clock += ms; },
    quotas: (five: number, week: number) => { fiveHour = five; weekly = week; },
    unavailable: () => { available = false; }, throwQuota: () => { throwQuota = true; }, busy: (value: boolean) => { busy = value; } };
}
async function fixture(run: (h: ReturnType<typeof harness>, file: string) => Promise<void>) {
  const directory = await mkdtemp(path.join(tmpdir(), "cortex-work-force-"));
  const file = path.join(directory, "config.json"), h = harness(file);
  try { await run(h, file); }
  finally {
    await h.service.stop();
    const resolved = path.resolve(directory);
    assert.equal(path.dirname(resolved), path.resolve(tmpdir()));
    assert.ok(path.basename(resolved).startsWith("cortex-work-force-"));
    await rm(resolved, { recursive: true, force: true });
  }
}
const configure = (service: WorkForceService, dates: { startsAt?: string; endsAt?: string } = {}) => service.saveConfiguration({ agents: refs, startsAt: null, endsAt: null, ...dates });

test("runs agents in manual order, wraps to the first and never overlaps; manual stop drains the active agent", async () => fixture(async h => {
  await h.service.saveConfiguration({ agents: [...refs].reverse(), startsAt: null, endsAt: null });
  assert.deepEqual((await h.service.overview()).settings, { minimumFiveHourRemainingPercent: 30, minimumWeeklyRemainingPercent: 8 });
  await h.service.arm(); await until(() => h.calls.length === 1);
  await Promise.all(Array.from({ length: 20 }, () => h.service.tick()));
  assert.deepEqual(h.calls, ["B"]);
  h.pending[0].finish(); await until(() => h.calls.length === 2);
  h.pending[1].finish(); await until(() => h.calls.length === 3);
  const stopping = await h.service.disarm();
  assert.equal(stopping.runtime.phase, "stopping");
  h.pending[2].finish(); await until(async () => (await h.service.overview()).runtime.phase === "stopped");
  assert.deepEqual(h.calls, ["B", "A", "B"]);
  assert.equal(h.maximum(), 1);
  assert.equal((await h.service.overview()).runtime.completedCycles, 1);
  assert.equal((await h.service.overview()).runtime.cursor, 1);
}));

test("requires BOTH quota reserves, accepts exact thresholds and retries at five minutes without skipping the next agent", async () => fixture(async h => {
  await configure(h.service); await h.service.arm(); await until(() => h.calls.length === 1);
  h.quotas(29, 8); h.pending[0].finish();
  await until(async () => (await h.service.overview()).runtime.phase === "waiting_quota");
  assert.equal((await h.service.overview()).runtime.cursor, 1);
  const reads = h.reads();
  h.quotas(30, 7); h.advance(WORK_FORCE_QUOTA_RETRY_MS - 1); await h.service.tick();
  assert.equal(h.reads(), reads);
  h.advance(1); await until(async () => { await h.service.tick(); return h.reads() === reads + 1; }); assert.deepEqual(h.calls, ["A"]);
  h.quotas(30, 8); h.advance(WORK_FORCE_QUOTA_RETRY_MS);
  const launch = h.service.tick(); await until(() => h.calls.length === 2);
  await h.service.disarm(); h.pending[1].finish(); await launch;
  assert.deepEqual(h.calls, ["A", "B"]);
}));

test("missing quotas and read failures wait rather than launching", async () => fixture(async h => {
  await configure(h.service); h.unavailable(); await h.service.arm();
  await until(async () => (await h.service.overview()).runtime.phase === "waiting_quota");
  assert.equal(h.calls.length, 0);
  h.throwQuota(); h.advance(WORK_FORCE_QUOTA_RETRY_MS); await h.service.tick();
  assert.equal((await h.service.overview()).runtime.phase, "waiting_quota");
  assert.equal(h.calls.length, 0);
}));

test("stopping during a quota read prevents the prepared agent from launching", async () => fixture(async (h, file) => {
  let release!: (status: CodexQuotaStatus) => void;
  let reading = false;
  const service = new WorkForceService(file, h.registry, { getStatus: () => {
    reading = true;
    return new Promise<CodexQuotaStatus>(resolve => { release = resolve; });
  } }, h.now);
  try {
    await configure(service); await service.arm(); await until(() => reading);
    await service.disarm();
    release(await h.quota.getStatus());
    await delay(20); await service.tick();
    assert.equal(h.calls.length, 0);
    assert.equal((await service.overview()).runtime.phase, "stopped");
  } finally { await service.stop(); }
}));

test("scheduled start and quota wait survive restart; the end cancels a quota wait", async () => fixture(async (h, file) => {
  const startsAt = new Date(h.now() + 60_000).toISOString(), endsAt = new Date(h.now() + 120_000).toISOString();
  await configure(h.service, { startsAt, endsAt }); await h.service.arm();
  assert.equal((await h.service.overview()).runtime.phase, "scheduled");
  await h.service.tick(); assert.equal(h.reads(), 0);
  await h.service.stop();
  const restarted = new WorkForceService(file, h.registry, h.quota, h.now);
  try {
    assert.equal((await restarted.overview()).runtime.armed, true);
    h.unavailable(); h.advance(60_000); await restarted.tick();
    assert.equal((await restarted.overview()).runtime.phase, "waiting_quota");
    h.advance(60_000); await restarted.tick();
    assert.equal((await restarted.overview()).runtime.phase, "stopped");
    assert.equal((await restarted.overview()).runtime.armed, false);
    assert.equal(h.calls.length, 0);
  } finally { await restarted.stop(); }
}));

test("end-only scheduling lets the active agent finish and prevents its successor", async () => fixture(async h => {
  await configure(h.service, { endsAt: new Date(h.now() + 60_000).toISOString() });
  await h.service.arm(); await until(() => h.calls.length === 1);
  h.advance(60_000); await h.service.tick();
  assert.equal((await h.service.overview()).runtime.phase, "stopping");
  assert.equal(h.pending.length, 1);
  h.pending[0].finish(); await until(async () => (await h.service.overview()).runtime.phase === "stopped");
  assert.equal((await h.service.overview()).runtime.history[0].outcome, "succeeded");
  assert.equal(h.calls.length, 1);
}));

test("failed agents stop the loop at the same position; busy projects wait and retry", async () => fixture(async h => {
  await configure(h.service); h.busy(true); await h.service.arm();
  await until(async () => (await h.service.overview()).runtime.phase === "waiting_agent");
  assert.equal(h.calls.length, 0);
  h.busy(false); h.advance(5000); const launch = h.service.tick(); await until(() => h.calls.length === 1);
  h.pending[0].fail(new Error("Agent failure")); await launch;
  assert.equal((await h.service.overview()).runtime.phase, "failed");
  assert.equal((await h.service.overview()).runtime.cursor, 0);
  assert.equal((await h.service.overview()).runtime.armed, false);
}));

test("a persisted active execution is interrupted on restart and never silently replayed", async () => fixture(async (h, file) => {
  await configure(h.service);
  const stored = await h.service.overview();
  stored.runtime.armed = true; stored.runtime.phase = "running";
  stored.runtime.active = { agent: agents[0], startedAt: new Date(h.now()).toISOString(), finishedAt: null, outcome: "running", error: null, answer: null };
  await writeFile(file, JSON.stringify({ workForce: stored }));
  const restarted = new WorkForceService(file, h.registry, h.quota, h.now);
  try {
    await restarted.tick();
    const value = await restarted.overview();
    assert.equal(value.runtime.phase, "interrupted"); assert.equal(value.runtime.armed, false);
    assert.equal(value.runtime.history[0].outcome, "interrupted"); assert.equal(value.runtime.cursor, 0);
    assert.equal(h.calls.length, 0);
  } finally { await restarted.stop(); }
}));

test("validates thresholds, duplicate agents, timezone-bearing instants and schedule ordering", () => {
  for (const value of [-1, 101, NaN, "30", null]) assert.throws(() => validateSettings({ minimumFiveHourRemainingPercent: value, minimumWeeklyRemainingPercent: 8 }));
  assert.throws(() => validateConfiguration({ agents: [refs[0], refs[0]] }));
  assert.throws(() => validateConfiguration({ agents: refs, startsAt: "2026-10-28T10:00" }));
  assert.throws(() => validateConfiguration({ agents: refs, startsAt: "2026-10-28T10:00:00Z", endsAt: "2026-10-28T09:00:00Z" }));
  assert.equal(validateConfiguration({ agents: refs, startsAt: "2026-10-28T10:00:00+01:00" }).startsAt, "2026-10-28T09:00:00.000Z");
});
