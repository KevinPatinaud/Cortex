import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { ExecutionQualityService } from "./ExecutionQualityService.ts";
import { DEFAULT_EXECUTION_POLICY, type ExecutionPolicy } from "../../../../shared/ExecutionQuality.ts";
import type { AgentResponsePayload } from "../../../../shared/AgentResponse.ts";

async function fixture(t: test.TestContext) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cortex-quality-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const configuration = path.join(directory, "config.json");
  await writeFile(configuration, JSON.stringify({ sentinel: "preserved", workflowSchedules: { existing: true } }));
  return { directory, configuration, service: new ExecutionQualityService(configuration, path.join(directory, "state")) };
}
const completed = (): AgentResponsePayload => ({ status: "success", items: [{ content: "delivered" }], notes: null,
  nextAgentIds: [], isMultiSelectionAllowed: null, isMultiSelectionThreaded: null,
  continuity: { summary: "Delivered", decisions: ["Preserved original"], evidence: ["report.md"], remainingWork: [] }, acceptance: [] });
const policy = (changes: Partial<ExecutionPolicy> = {}): ExecutionPolicy => ({ ...DEFAULT_EXECUTION_POLICY, ...changes });
const signal = () => new AbortController().signal;

test("stores project profiles atomically without altering schedules or other projects", async t => {
  const f = await fixture(t);
  await Promise.all([f.service.savePolicy("one", policy({ defaultModel: "model-a" })),
    f.service.savePolicy("two", policy({ defaultModel: "model-b" }))]);
  const config = JSON.parse(await readFile(f.configuration, "utf8"));
  assert.equal(config.sentinel, "preserved"); assert.deepEqual(config.workflowSchedules, { existing: true });
  assert.equal((await f.service.getPolicy("one")).defaultModel, "model-a");
  assert.equal((await f.service.getPolicy("two")).defaultModel, "model-b");
  await assert.rejects(f.service.savePolicy("one", policy({ workspaceDirectory: path.join(f.directory, "missing") })));
  await assert.rejects(f.service.savePolicy("one", policy({ acceptanceCriteria: ["same", "same"] })));
});

test("distinguishes agent evidence, independently executed checks, and incomplete work", async t => {
  const f = await fixture(t);
  assert.equal((await f.service.assess(completed(), policy(), f.directory, signal())).outcome, "reported");
  const check = { label: "independent regression", command: process.execPath, args: ["-e", "process.exit(0)"] };
  assert.equal((await f.service.assess(completed(), policy({ checks: [check] }), f.directory, signal())).outcome, "verified");
  const response = completed(); response.acceptance = [{ criterion: "Beautiful", passed: true, evidence: "Screenshot inspected" }];
  assert.equal((await f.service.assess(response, policy({ checks: [check], acceptanceCriteria: ["Beautiful"] }), f.directory, signal())).outcome, "reported");
  response.continuity!.remainingWork.push("Inspect mobile layout");
  assert.equal((await f.service.assess(response, policy({ checks: [check] }), f.directory, signal())).outcome, "partial");
});

test("failed checks and missing evidence cannot be labelled verified; diagnostics do not leak command output", async t => {
  const f = await fixture(t);
  const assessment = await f.service.assess(completed(), policy({ acceptanceCriteria: ["Published"], checks: [
    { label: "failed check", command: process.execPath, args: ["-e", "console.error('SECRET_SENTINEL');process.exit(7)"] }
  ] }), f.directory, signal());
  assert.equal(assessment.outcome, "partial"); assert.equal(assessment.checks[0].passed, false);
  assert.ok(!JSON.stringify(assessment).includes("SECRET_SENTINEL"));
  assert.ok(assessment.reasons.some(reason => reason.includes("Published")));
  const r = completed(); r.continuity = undefined;
  assert.equal((await f.service.assess(r, policy(), f.directory, signal())).outcome, "partial");
});

test("terminal delivery checks do not run in parallel prerequisite stages and preflight failures stop early", async t => {
  const f = await fixture(t);
  const fail = { label: "browser runtime", command: process.execPath, args: ["-e", "process.exit(8)"] };
  const result = await f.service.assess(completed(), policy({ checks: [fail], acceptanceCriteria: ["Delivery"] }), f.directory, signal(), false);
  assert.equal(result.outcome, "reported"); assert.deepEqual(result.checks, []);
  await assert.rejects(f.service.preflight(policy({ preflightChecks: [fail] }), f.directory, signal()), /browser runtime/);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(f.service.preflight(policy({ preflightChecks: [fail] }), f.directory, controller.signal), { name: "AbortError" });
});

test("durable continuity survives restart and stays isolated by project and agent", async t => {
  const f = await fixture(t);
  const record = { fingerprint: f.service.fingerprint({ task: "one", parameters: { dossier: "a" } }),
    sessionId: "session", status: "partial", updatedAt: new Date().toISOString(), continuity: completed().continuity! };
  await f.service.saveMemory("project", "agent", record);
  const restarted = new ExecutionQualityService(f.configuration, path.join(f.directory, "state"));
  assert.deepEqual(await restarted.readMemory("project", "agent"), record);
  assert.equal(await restarted.readMemory("other", "agent"), null);
  assert.equal(await restarted.readMemory("project", "other"), null);
  assert.notEqual(record.fingerprint, restarted.fingerprint({ task: "one", parameters: { dossier: "b" } }));
  assert.match(restarted.context(record), /never new authorization/);
});
