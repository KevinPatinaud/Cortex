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
import { AgentService } from "./AgentService.ts";
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
