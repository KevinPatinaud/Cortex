import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { ExecutionControlService } from "./ExecutionControlService.ts";
import { SqliteExecutionControlRepository } from "../../../infrastructure/audit/SqliteExecutionControlRepository.ts";

const measured = () => Promise.resolve({ usage: { inputTokens: 8, outputTokens: 2, cachedInputTokens: 3 } });
const signal = () => new AbortController().signal;

test("all projects and authoring calls share the server concurrency ceiling", async () => {
  const repository = new SqliteExecutionControlRepository(":memory:");
  const control = new ExecutionControlService(repository, 2);
  let active = 0, peak = 0;
  try {
    await Promise.all(Array.from({ length: 12 }, (_, i) => control.execute({ projectId: `project-${i % 3}` }, "fake", signal(), async () => {
      active++; peak = Math.max(peak, active); await delay(10); active--; return measured();
    })));
    assert.equal(peak, 2);
    assert.equal(control.status("project-0").usage.calls, 4);
    assert.equal(control.status("project-0").usage.inputTokens, 32);
    assert.equal(control.status("project-0").server.queuedCalls, 0);
  } finally { repository.close(); }
});

test("pause rechecks queued calls, lets an in-flight call finish and protects related projects", async () => {
  const repository = new SqliteExecutionControlRepository(":memory:");
  const control = new ExecutionControlService(repository, 1);
  let release!: () => void;
  let called = false;
  try {
    const started = control.execute({ projectId: "source" }, "fake", signal(), async () => {
      await new Promise<void>(resolve => { release = resolve; }); return measured();
    });
    const queued = control.execute({ projectId: "target", relatedProjectId: "source" }, "fake", signal(), async () => { called = true; return measured(); });
    const rejection = assert.rejects(queued, /pause/);
    control.update("source", { paused: true }); release();
    await started; await rejection;
    assert.equal(called, false);
    assert.equal(control.status("source").usage.calls, 1);
    control.update("source", { paused: false });
    await control.execute({ projectId: "target", relatedProjectId: "source" }, "fake", signal(), measured);
    assert.equal(control.status("source").usage.calls, 2);
    assert.equal(control.status("target").usage.calls, 1);
  } finally { repository.close(); }
});

test("cancelled queued calls release their queue entry without consuming the daily budget", async () => {
  const repository = new SqliteExecutionControlRepository(":memory:");
  const control = new ExecutionControlService(repository, 1);
  let release!: () => void;
  try {
    const started = control.execute({ projectId: "p" }, "fake", signal(), async () => { await new Promise<void>(resolve => { release = resolve; }); return measured(); });
    const controller = new AbortController();
    const queued = control.execute({ projectId: "p" }, "fake", controller.signal, measured);
    const rejected = assert.rejects(queued, { name: "AbortError" }); controller.abort(); await rejected;
    assert.equal(control.status("p").server.queuedCalls, 0);
    release(); await started;
    assert.equal(control.status("p").usage.calls, 1);
  } finally { repository.close(); }
});

test("daily and per-instance budgets survive restart; UTC rollover resets only daily usage", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cortex-control-"));
  const file = path.join(directory, "control.sqlite");
  let now = new Date("2026-09-25T23:59:00Z");
  let repository = new SqliteExecutionControlRepository(file);
  let control = new ExecutionControlService(repository, 4, () => now);
  try {
    control.update("p", { maxCallsPerDay: 2, maxCallsPerRun: 1 });
    await control.execute({ projectId: "p", instanceId: "first" }, "fake", signal(), measured);
    await assert.rejects(control.execute({ projectId: "p", instanceId: "first" }, "fake", signal(), measured), /exécution/);
    await control.execute({ projectId: "p", instanceId: "second" }, "fake", signal(), measured);
    await assert.rejects(control.execute({ projectId: "p" }, "fake", signal(), measured), /quotidien/);
    control.update("p", { paused: true }); repository.close();
    repository = new SqliteExecutionControlRepository(file); control = new ExecutionControlService(repository, 4, () => now);
    assert.equal(control.status("p").policy.paused, true);
    assert.equal(control.status("p").usage.calls, 2);
    control.update("p", { paused: false }); now = new Date("2026-09-26T00:00:00Z");
    await control.execute({ projectId: "p" }, "fake", signal(), measured);
    assert.equal(control.status("p").usage.calls, 1);
    await assert.rejects(control.execute({ projectId: "p", instanceId: "first" }, "fake", signal(), measured), /exécution/);
  } finally { repository.close(); await rm(directory, { recursive: true, force: true }); }
});

test("token budgets stop at the observed threshold and fail closed on missing measurements", async () => {
  const repository = new SqliteExecutionControlRepository(":memory:");
  const control = new ExecutionControlService(repository);
  try {
    control.update("known", { maxTokensPerDay: 10 });
    await control.execute({ projectId: "known" }, "fake", signal(), measured);
    await assert.rejects(control.execute({ projectId: "known" }, "fake", signal(), measured), /tokens observés/);
    control.update("unknown", { maxTokensPerDay: 10 });
    await control.execute({ projectId: "unknown" }, "fake", signal(), async () => ({}));
    assert.equal(control.status("unknown").usage.measuredCalls, 0);
    await assert.rejects(control.execute({ projectId: "unknown" }, "fake", signal(), measured), /inconnue/);
    control.update("unknown", { maxTokensPerDay: null });
    await control.execute({ projectId: "unknown" }, "fake", signal(), measured);
  } finally { repository.close(); }
});
