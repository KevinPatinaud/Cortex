import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  AntigravityModelService,
  parseAntigravityModelOutput,
  runAntigravityModelsCli
} from "./AntigravityModelService.ts";
import { CodexModelService } from "./CodexModelService.ts";
import {
  AgentService,
  isGeminiIndividualQuotaError,
  parseGeminiQuotaResetMs,
  selectGeminiQuotaFallbackModels
} from "./AgentService.ts";
import { AgentConfigurationService } from "./AgentConfigurationService.ts";
import type { AgentExecutionOptions } from "./AgentProvider.ts";

const REAL_AGY_OUTPUT = [
  "gemini-4-neon-high\tGemini 4 Neon (High)",
  "gemini-4-neon-xhigh\tGemini 4 Neon (XHigh)",
  "gemini-4-neon-medium\tGemini 4 Neon (Medium)",
  "gemini-4-neon-low\tGemini 4 Neon (Low)",
  "gemini-4-argon-medium\tGemini 4 Argon (Medium)",
  "gemini-4-argon-high\tGemini 4 Argon (High)",
  "gemini-4-argon-low\tGemini 4 Argon (Low)",
  "gemini-pro-orchestrator-neon\tOrchestrator (Neon)",
  "gemini-3.8-flash-high\tGemini 3.8 Flash (High)",
  "gemini-3.8-flash-medium\tGemini 3.8 Flash (Medium)",
  "gemini-3.8-flash-low\tGemini 3.8 Flash (Low)",
  "claude-opus-5-5-low\tClaude Opus 5.5 (Low)",
  "claude-opus-5-5-medium\tClaude Opus 5.5 (Medium)",
  "claude-opus-5-5-high\tClaude Opus 5.5 (High)",
  "gpt-oss-120b-medium\tGPT-OSS 120B (Medium)"
].join("\n");

test("groups Antigravity effort variants by model family, sorts efforts canonically, and preserves standalone models", () => {
  const catalog = parseAntigravityModelOutput(REAL_AGY_OUTPUT, { cliVersion: "1.5.14" });
  assert.equal(catalog.available, true);
  assert.equal(catalog.cliVersion, "1.5.14");
  assert.equal(catalog.defaultModel, "gemini-4-neon");
  assert.deepEqual(
    catalog.models.map(model => model.model),
    ["gemini-4-neon", "gemini-4-argon", "gemini-pro-orchestrator-neon", "gemini-3.8-flash", "claude-opus-5-5", "gpt-oss-120b"]
  );

  const neon = catalog.models[0];
  assert.equal(neon.displayName, "Gemini 4 Neon");
  assert.equal(neon.engine, "gemini");
  assert.equal(neon.isDefault, true);
  assert.deepEqual(neon.reasoningEfforts, ["low", "medium", "high", "xhigh"]);
  assert.equal(neon.defaultReasoningEffort, "medium");
  assert.deepEqual(neon.effortModels, {
    high: "gemini-4-neon-high",
    xhigh: "gemini-4-neon-xhigh",
    medium: "gemini-4-neon-medium",
    low: "gemini-4-neon-low"
  });

  const orchestrator = catalog.models[2];
  assert.equal(orchestrator.displayName, "Orchestrator (Neon)");
  assert.deepEqual(orchestrator.reasoningEfforts, []);
  assert.equal(orchestrator.defaultReasoningEffort, null);
  assert.equal(orchestrator.effortModels, undefined);

  const gptOss = catalog.models[5];
  assert.equal(gptOss.displayName, "GPT-OSS 120B");
  assert.deepEqual(gptOss.reasoningEfforts, ["medium"]);
  assert.equal(gptOss.defaultReasoningEffort, "medium");
  assert.deepEqual(gptOss.effortModels, { medium: "gpt-oss-120b-medium" });
});

test("resolves configured Antigravity default model from display name, exact slug, or family ID", () => {
  const byDisplayName = parseAntigravityModelOutput(REAL_AGY_OUTPUT, {
    configuredModel: "Gemini 4 Neon (XHigh)"
  });
  assert.equal(byDisplayName.defaultModel, "gemini-4-neon");
  assert.equal(byDisplayName.configuredReasoningEffort, "xhigh");

  const byRawSlug = parseAntigravityModelOutput(REAL_AGY_OUTPUT, {
    configuredModel: "claude-opus-5-5-high"
  });
  assert.equal(byRawSlug.defaultModel, "claude-opus-5-5");
  assert.equal(byRawSlug.configuredReasoningEffort, "high");
  assert.equal(byRawSlug.models.find(m => m.model === "claude-opus-5-5")?.isDefault, true);
  assert.equal(byRawSlug.models.find(m => m.model === "gemini-4-neon")?.isDefault, false);

  const byFamily = parseAntigravityModelOutput(REAL_AGY_OUTPUT, {
    configuredModel: "gemini-3.8-flash"
  });
  assert.equal(byFamily.defaultModel, "gemini-3.8-flash");
  assert.equal(byFamily.configuredReasoningEffort, null);
});

test("rejects empty or status-only CLI outputs instead of fabricating models", () => {
  for (const output of ["", "   \n", "Fetching available models...\n", "Error: not logged in\n"]) {
    assert.throws(() => parseAntigravityModelOutput(output), /no selectable models/);
  }
});

test("deduplicates concurrent requests, masks diagnostics on failure, and recovers on retry", async () => {
  let calls = 0;
  let failed = true;
  const service = new AntigravityModelService("/server", async () => {
    calls++;
    await new Promise(setImmediate);
    if (failed) throw new Error("secret-token-leak");
    return parseAntigravityModelOutput("gemini-4-neon-high\tGemini 4 Neon (High)", { cliVersion: "1.5.14" });
  });

  const [first, second] = await Promise.all([service.getCatalog("/p1"), service.getCatalog("/p1")]);
  assert.equal(calls, 1);
  assert.equal(first.available, false);
  assert.equal(second.available, false);
  assert.deepEqual(first.models, []);
  assert.equal(JSON.stringify(first).includes("secret-token-leak"), false);

  failed = false;
  const recovered = await service.getCatalog("/p1");
  assert.equal(calls, 2);
  assert.equal(recovered.available, true);
  assert.equal(recovered.models[0].model, "gemini-4-neon");
});

test("real CLI subprocess discovers models, version, and settings default while ignoring stderr", async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "cortex-agy-models-"));
  t.after(async () => { await rm(dir, { recursive: true, force: true }); });
  const settingsPath = path.join(dir, "settings.json");
  await writeFile(settingsPath, JSON.stringify({ model: "Gemini 4 Argon (High)" }), "utf8");

  const script = `
    const arg = process.argv[1];
    process.stderr.write("Fetching available models... secret-stderr\\n");
    if (arg === "--version") { console.log("1.5.14"); }
    else if (arg === "models") {
      console.log("gemini-4-neon-xhigh\\tGemini 4 Neon (XHigh)");
      console.log("gemini-4-argon-high\\tGemini 4 Argon (High)");
      console.log("gemini-4-argon-low\\tGemini 4 Argon (Low)");
    } else { process.exit(2); }
  `;

  const catalog = await runAntigravityModelsCli(
    dir,
    { command: process.execPath, args: ["--eval", script, "--"] },
    10_000,
    settingsPath
  );
  assert.equal(catalog.available, true);
  assert.equal(catalog.cliVersion, "1.5.14");
  assert.equal(catalog.defaultModel, "gemini-4-argon");
  assert.equal(catalog.configuredReasoningEffort, "high");
  assert.deepEqual(catalog.models.map(m => m.model), ["gemini-4-neon", "gemini-4-argon"]);
  assert.deepEqual(catalog.models[1].reasoningEfforts, ["low", "high"]);
  assert.equal(JSON.stringify(catalog).includes("secret-stderr"), false);
});

test("AgentService merges Codex and Antigravity catalogs and resolves grouped Antigravity families to exact CLI slugs", async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "cortex-multi-cli-"));
  t.after(async () => { await rm(dir, { recursive: true, force: true }); });
  const calls: Array<{ engine: string; model?: string; effort?: string }> = [];

  const codexModels = new CodexModelService(dir, async () => ({
    available: true,
    cliVersion: "0.163.0",
    defaultModel: "gpt-codex",
    declaredApps: [],
    declaredMcpServers: [],
    checkedAt: new Date().toISOString(),
    error: null,
    models: [
      { model: "gpt-codex", displayName: "GPT Codex", reasoningEfforts: ["low", "high"], defaultReasoningEffort: "low", isDefault: true }
    ]
  }));

  const agyModels = new AntigravityModelService(dir, async () =>
    parseAntigravityModelOutput(REAL_AGY_OUTPUT, { cliVersion: "1.5.14" })
  );

  const service = new AgentService([
    {
      engine: "codex",
      label: "Codex",
      isAvailable: async () => true,
      ask: async (_prompt, options: AgentExecutionOptions = {}) => {
        calls.push({ engine: "codex", model: options.model, effort: options.reasoningEffort });
        return { answer: "codex-ok", sessionId: "c1" };
      }
    },
    {
      engine: "gemini",
      label: "Gemini",
      isAvailable: async () => true,
      ask: async (_prompt, options: AgentExecutionOptions = {}) => {
        calls.push({ engine: "gemini", model: options.model, effort: options.reasoningEffort });
        return { answer: "agy-ok", sessionId: "g1" };
      }
    }
  ], new AgentConfigurationService(path.join(dir, "config.json")), undefined, undefined, codexModels, undefined, agyModels);

  const codexFirst = await service.getModels(dir, "codex");
  assert.equal(codexFirst.models[0].model, "gpt-codex");
  assert.equal(codexFirst.models.some(m => m.model === "gemini-4-neon" && m.engine === "gemini"), true);

  const agyFirst = await service.getModels(dir, "gemini");
  assert.equal(agyFirst.models[0].model, "gemini-4-neon");
  assert.equal(agyFirst.models.some(m => m.model === "gpt-codex" && m.engine === "codex"), true);

  // Executing on codex engine with a grouped Antigravity model family routes to gemini with the exact CLI variant slug.
  const agyRun = await service.execute("codex", "Test", {
    model: "gemini-4-neon",
    reasoningEffort: "xhigh",
    persistSession: true,
    workingDirectory: dir
  });
  assert.equal(agyRun.answer, "agy-ok");
  assert.equal(agyRun.profile?.model, "gemini-4-neon");
  assert.equal(agyRun.profile?.reasoningEffort, "xhigh");
  assert.equal(agyRun.profile?.cliVersion, "1.5.14");
  assert.equal(agyRun.profile?.resolution, "pinned");
  assert.deepEqual(calls[0], { engine: "gemini", model: "gemini-4-neon-xhigh", effort: "xhigh" });

  // Standalone Antigravity model without efforts resolves as-is and pins without effort.
  const orchRun = await service.execute("gemini", "Orchestrate", {
    model: "gemini-pro-orchestrator-neon",
    persistSession: true,
    workingDirectory: dir
  });
  assert.equal(orchRun.profile?.resolution, "pinned");
  assert.deepEqual(calls[1], { engine: "gemini", model: "gemini-pro-orchestrator-neon", effort: undefined });

  // Executing on gemini engine with a Codex model routes back to codex.
  const codexRun = await service.execute("gemini", "Codex task", {
    model: "gpt-codex",
    reasoningEffort: "high",
    persistSession: true,
    workingDirectory: dir
  });
  assert.equal(codexRun.answer, "codex-ok");
  assert.deepEqual(calls[2], { engine: "codex", model: "gpt-codex", effort: "high" });
});

test("detects Antigravity individual model quota errors and parses reset duration", () => {
  const realError = new Error("Individual quota reached. Please upgrade your subscription to increase your limits. Resets in 113h31m7s.");
  assert.equal(isGeminiIndividualQuotaError(realError), true);
  assert.equal(parseGeminiQuotaResetMs(realError), ((113 * 3600) + (31 * 60) + 7) * 1000);

  assert.equal(isGeminiIndividualQuotaError(new Error("Model quota exceeded. Resets in 2d4h.")), true);
  assert.equal(parseGeminiQuotaResetMs(new Error("Model quota exceeded. Resets in 2d4h.")), ((2 * 86400) + (4 * 3600)) * 1000);

  assert.equal(isGeminiIndividualQuotaError(new Error("Individual quota reached.")), true);
  assert.equal(parseGeminiQuotaResetMs(new Error("Individual quota reached.")), 15 * 60 * 1000);

  assert.equal(isGeminiIndividualQuotaError(new Error("authentication failed or timed out")), false);
  assert.equal(isGeminiIndividualQuotaError(new Error("Gemini execution failed.")), false);
});

test("selects same-family non-orchestrator Antigravity fallback models preferring default", () => {
  const outputWithHydrogen = `${REAL_AGY_OUTPUT}\ngemini-4-hydrogen-high\tGemini 4 Hydrogen (High)\ngemini-4-hydrogen-xhigh\tGemini 4 Hydrogen (XHigh)\nclaude-sonnet-5-5-high\tClaude Sonnet 5.5 (High)`;
  const catalog = parseAntigravityModelOutput(outputWithHydrogen, { cliVersion: "1.5.18" });

  assert.deepEqual(
    selectGeminiQuotaFallbackModels(catalog, "gemini-4-hydrogen").map(m => m.model),
    ["gemini-4-neon", "gemini-4-argon", "gemini-3.8-flash"]
  );
  assert.deepEqual(
    selectGeminiQuotaFallbackModels(catalog, "gemini-4-neon").map(m => m.model),
    ["gemini-4-argon", "gemini-3.8-flash", "gemini-4-hydrogen"]
  );
  assert.deepEqual(
    selectGeminiQuotaFallbackModels(catalog, "claude-opus-5-5").map(m => m.model),
    ["claude-sonnet-5-5"]
  );
});

test("AgentService falls back to another Gemini model on individual quota, clamps effort, caches cooldown, and recovers after reset", async t => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "cortex-gemini-quota-"));
  t.after(async () => { await rm(dir, { recursive: true, force: true }); });

  const outputWithHydrogen = [
    REAL_AGY_OUTPUT,
    "gemini-4-hydrogen-high\tGemini 4 Hydrogen (High)",
    "gemini-4-hydrogen-xhigh\tGemini 4 Hydrogen (XHigh)",
    "gemini-4-hydrogen-medium\tGemini 4 Hydrogen (Medium)"
  ].join("\n");

  const agyModels = new AntigravityModelService(dir, async () =>
    parseAntigravityModelOutput(outputWithHydrogen, { cliVersion: "1.5.18" })
  );

  let currentTime = Date.parse("2026-11-26T08:00:00Z");
  const exhausted = new Set<string>(["gemini-4-hydrogen"]);
  const attempts: Array<{ model?: string; effort?: string; sessionId?: string }> = [];

  const service = new AgentService(
    [{
      engine: "gemini",
      label: "Gemini",
      isAvailable: async () => true,
      ask: async (_prompt, options: AgentExecutionOptions = {}) => {
        attempts.push({ model: options.model, effort: options.reasoningEffort, sessionId: options.sessionId });
        if (options.model?.startsWith("gemini-4-hydrogen") && exhausted.has("gemini-4-hydrogen")) {
          throw new Error("Individual quota reached. Please upgrade your subscription to increase your limits. Resets in 2h0m0s.");
        }
        if (options.model?.startsWith("gemini-4-neon") && exhausted.has("gemini-4-neon")) {
          throw new Error("Individual quota reached. Please upgrade your subscription to increase your limits. Resets in 1h0m0s.");
        }
        if (options.model?.startsWith("gemini-4-argon") && exhausted.has("gemini-4-argon")) {
          throw new Error("authentication failed or timed out");
        }
        return { answer: `ok:${options.model}`, sessionId: options.sessionId ?? `sess-${attempts.length}` };
      }
    }],
    new AgentConfigurationService(path.join(dir, "config.json")),
    undefined,
    undefined,
    undefined,
    undefined,
    agyModels,
    () => currentTime
  );

  const observedProfiles: Array<string | null> = [];
  const progressMessages: string[] = [];

  // 1. Hydrogen fails with individual quota -> falls back to default gemini-4-neon with same effort.
  const first = await service.execute("gemini", "Write article", {
    model: "gemini-4-hydrogen",
    reasoningEffort: "high",
    persistSession: true,
    workingDirectory: dir,
    onProfile: profile => observedProfiles.push(profile.model),
    onProgress: message => progressMessages.push(message)
  });
  assert.equal(first.answer, "ok:gemini-4-neon-high");
  assert.equal(first.profile?.model, "gemini-4-neon");
  assert.equal(first.profile?.reasoningEffort, "high");
  assert.deepEqual(attempts, [
    { model: "gemini-4-hydrogen-high", effort: "high", sessionId: undefined },
    { model: "gemini-4-neon-high", effort: "high", sessionId: undefined }
  ]);
  assert.deepEqual(observedProfiles, ["gemini-4-hydrogen", "gemini-4-neon"]);
  assert.equal(progressMessages.some(m => m.includes("gemini-4-hydrogen") && m.includes("gemini-4-neon")), true);

  // 2. While Hydrogen is in cooldown, subsequent call skips Hydrogen proactively and goes straight to Neon.
  attempts.length = 0;
  const second = await service.execute("gemini", "Next article", {
    model: "gemini-4-hydrogen",
    reasoningEffort: "high",
    persistSession: true,
    workingDirectory: dir,
    sessionId: "existing-session"
  });
  assert.equal(second.answer, "ok:gemini-4-neon-high");
  assert.equal(second.profile?.model, "gemini-4-neon");
  assert.deepEqual(attempts, [
    { model: "gemini-4-neon-high", effort: "high", sessionId: "existing-session" }
  ]);

  // 3. When Neon also hits quota and xhigh is requested, Argon clamps xhigh -> high without ValidationError.
  attempts.length = 0;
  exhausted.add("gemini-4-neon");
  const third = await service.execute("gemini", "Deep synthesis", {
    model: "gemini-4-hydrogen",
    reasoningEffort: "xhigh",
    persistSession: true,
    workingDirectory: dir
  });
  assert.equal(third.answer, "ok:gemini-4-argon-high");
  assert.equal(third.profile?.model, "gemini-4-argon");
  assert.equal(third.profile?.reasoningEffort, "high");
  assert.deepEqual(attempts, [
    { model: "gemini-4-neon-xhigh", effort: "xhigh", sessionId: undefined },
    { model: "gemini-4-argon-high", effort: "high", sessionId: undefined }
  ]);

  // 4. Non-quota error on Argon is NOT retried on Flash.
  attempts.length = 0;
  exhausted.add("gemini-4-argon");
  await assert.rejects(
    service.execute("gemini", "Auth fail", {
      model: "gemini-4-hydrogen",
      reasoningEffort: "high",
      persistSession: true,
      workingDirectory: dir
    }),
    /authentication failed or timed out/
  );
  assert.deepEqual(attempts, [
    { model: "gemini-4-argon-high", effort: "high", sessionId: undefined }
  ]);

  // 5. After Hydrogen's 2h reset window expires, Hydrogen is used again.
  attempts.length = 0;
  exhausted.delete("gemini-4-hydrogen");
  currentTime += (2 * 3600 + 10) * 1000;
  const recovered = await service.execute("gemini", "Back to Hydrogen", {
    model: "gemini-4-hydrogen",
    reasoningEffort: "high",
    persistSession: true,
    workingDirectory: dir
  });
  assert.equal(recovered.answer, "ok:gemini-4-hydrogen-high");
  assert.equal(recovered.profile?.model, "gemini-4-hydrogen");
  assert.deepEqual(attempts, [
    { model: "gemini-4-hydrogen-high", effort: "high", sessionId: undefined }
  ]);
});
