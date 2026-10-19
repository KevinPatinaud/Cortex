import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { DEFAULT_CODEX_QUOTA_CONFIGURATION as defaults } from "../../../../shared/CodexQuota.ts";
import { CodexQuotaBlockedError } from "../../error/CodexQuotaBlockedError.ts";
import { CodexQuotaService, parseCodexQuota } from "./CodexQuotaService.ts";

const now = Date.parse("2026-10-19T10:00:00Z");
function limits(fiveHour = 50, weekly = 90) {
  return { limitId: "codex", primary: { usedPercent: fiveHour, windowDurationMins: 300, resetsAt: now / 1000 + 300 },
    secondary: { usedPercent: weekly, windowDurationMins: 10080, resetsAt: now / 1000 + 1000 } };
}

async function fixture(run: (file: string) => Promise<void>) {
  const directory = await mkdtemp(path.join(tmpdir(), "cortex-quota-"));
  try { await run(path.join(directory, "config.json")); }
  finally { await rm(directory, { recursive: true, force: true }); }
}

test("selects the Codex bucket and identifies windows by duration, including reversed primary/secondary", () => {
  const bucket = limits();
  const status = parseCodexQuota({ rateLimits: limits(0, 0), rateLimitsByLimitId: {
    codex_other: limits(0, 0), codex: { primary: bucket.secondary, secondary: bucket.primary }
  } }, now);
  assert.equal(status.available, true);
  assert.equal(status.fiveHour?.remainingPercent, 50);
  assert.equal(status.weekly?.remainingPercent, 10);
  assert.deepEqual(parseCodexQuota({ rateLimits: bucket }, now), status);
});

test("never substitutes another bucket, unknown windows, missing data, or stale usage", () => {
  for (const value of [null, {}, { rateLimits: limits(), rateLimitsByLimitId: { codex_other: limits() } },
    { rateLimits: { ...limits(), limitId: "codex_other" } },
    { rateLimits: { ...limits(), secondary: null } },
    { rateLimits: { ...limits(), primary: { usedPercent: 0, windowDurationMins: 60 } } },
    { rateLimits: { ...limits(), primary: { ...limits().primary, resetsAt: now / 1000 } } }]) {
    assert.equal(parseCodexQuota(value, now).available, false);
  }
  for (const usedPercent of [NaN, Infinity, -1, 101, "50", null]) {
    assert.equal(parseCodexQuota({ rateLimits: { ...limits(), primary: { ...limits().primary, usedPercent } } }, now).available, false);
  }
});

test("defaults are opt-in, persisted settings survive restart, and other configuration is preserved", async () => fixture(async file => {
  const service = new CodexQuotaService(file);
  assert.deepEqual(await service.getConfiguration(), defaults);
  await writeFile(file, JSON.stringify({ projects: [{ id: "keep" }], agentConfiguration: { autopilot: true } }));
  const custom = { enabled: true, minimumFiveHourRemainingPercent: 62.5, minimumWeeklyRemainingPercent: 25 };
  await service.saveConfiguration(custom);
  assert.deepEqual(await new CodexQuotaService(file).getConfiguration(), custom);
  assert.deepEqual(JSON.parse(await readFile(file, "utf8")), {
    projects: [{ id: "keep" }], agentConfiguration: { autopilot: true }, codexQuota: custom
  });
}));

test("invalid options and out-of-range thresholds never modify the saved policy", async () => fixture(async file => {
  const service = new CodexQuotaService(file);
  await service.saveConfiguration(defaults);
  const original = await readFile(file, "utf8");
  for (const input of [null, [], {}, { ...defaults, enabled: "true" },
    ...[-1, 101, NaN, Infinity, "50", null].flatMap(value => [
      { ...defaults, minimumFiveHourRemainingPercent: value }, { ...defaults, minimumWeeklyRemainingPercent: value }
    ])]) await assert.rejects(service.saveConfiguration(input));
  assert.equal(await readFile(file, "utf8"), original);
}));

test("disabled policy performs no account read, even when the CLI is unavailable", async () => fixture(async file => {
  const service = new CodexQuotaService(file, async () => { assert.fail("Quota lookup should be skipped"); });
  await service.assertMayStart();
}));

test("both thresholds are inclusive and independently required; every allowed launch is freshly checked", async () => fixture(async file => {
  let bucket = limits();
  let reads = 0;
  const service = new CodexQuotaService(file, async () => { reads++; return { rateLimits: bucket }; }, () => now);
  await service.saveConfiguration({ ...defaults, enabled: true });
  await service.assertMayStart();
  await service.assertMayStart();
  assert.equal(reads, 2);
  for (const [fiveHour, weekly, reason] of [[50.01, 0, /5 h/], [0, 90.01, /semaine/]] as const) {
    bucket = limits(fiveHour, weekly);
    await service.getStatus();
    await assert.rejects(service.assertMayStart(), reason);
  }
  await service.saveConfiguration({ enabled: true, minimumFiveHourRemainingPercent: 20, minimumWeeklyRemainingPercent: 5 });
  bucket = limits(80, 95);
  await service.assertMayStart();
}));

test("0 and 100 percent thresholds work and extra credits cannot bypass a failed quota", async () => fixture(async file => {
  const service = new CodexQuotaService(file, async () => ({ rateLimits: { ...limits(100, 100), credits: { unlimited: true } } }), () => now);
  await service.saveConfiguration({ ...defaults, enabled: true });
  await assert.rejects(service.assertMayStart(), CodexQuotaBlockedError);
  await service.saveConfiguration({ enabled: true, minimumFiveHourRemainingPercent: 0, minimumWeeklyRemainingPercent: 0 });
  await service.assertMayStart();
  const full = new CodexQuotaService(file, async () => ({ rateLimits: limits(0, 0) }), () => now);
  await full.saveConfiguration({ enabled: true, minimumFiveHourRemainingPercent: 100, minimumWeeklyRemainingPercent: 100 });
  await full.assertMayStart();
}));

test("unavailable quotas fail closed without exposing CLI diagnostic output", async () => fixture(async file => {
  const service = new CodexQuotaService(file, async () => { throw new Error("sensitive CLI diagnostic"); }, () => now);
  await service.saveConfiguration({ ...defaults, enabled: true });
  const status = await service.getStatus();
  assert.equal(status.available, false);
  assert.ok(!JSON.stringify(status).includes("sensitive"));
  await assert.rejects(service.assertMayStart(), /Lancement bloqué/);
  await service.saveConfiguration(defaults);
  await service.assertMayStart();
}));

test("denied retries are throttled for at most one minute; refreshing and disabling take effect immediately", async () => fixture(async file => {
  let clock = now, reads = 0, bucket = limits(99, 99);
  const service = new CodexQuotaService(file, async () => { reads++; return { rateLimits: bucket }; }, () => clock);
  await service.saveConfiguration({ ...defaults, enabled: true });
  await assert.rejects(service.assertMayStart());
  await assert.rejects(service.assertMayStart());
  assert.equal(reads, 1);
  clock += 60_000;
  await assert.rejects(service.assertMayStart());
  assert.equal(reads, 2);
  bucket = limits();
  await service.getStatus();
  await service.assertMayStart();
  assert.equal(reads, 4);
  await service.saveConfiguration(defaults);
  await service.assertMayStart();
  assert.equal(reads, 4);
}));

test("simultaneous status requests share one read", async () => fixture(async file => {
  let reads = 0;
  const service = new CodexQuotaService(file, async () => {
    reads++;
    await new Promise(setImmediate);
    return { rateLimits: limits() };
  }, () => now);
  const statuses = await Promise.all([service.getStatus(), service.getStatus(), service.getStatus()]);
  assert.equal(reads, 1);
  assert.equal(statuses[0].available, true);
}));
