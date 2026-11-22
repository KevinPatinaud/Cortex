import assert from "node:assert/strict";
import test from "node:test";
import {
  findCatalogModel,
  formatCatalogVersions,
  formatModelOptionLabel,
  groupCatalogModels,
  mergeModelCatalogs,
  resolveCatalogExecutionModel,
  type CodexModelCatalog
} from "./CodexModel.ts";

const codexCatalog: CodexModelCatalog = {
  available: true,
  cliVersion: "0.163.0",
  defaultModel: "gpt-5.4",
  configuredReasoningEffort: "high",
  declaredApps: [],
  declaredMcpServers: ["github"],
  checkedAt: "2026-11-22T10:00:00.000Z",
  error: null,
  models: [
    { model: "gpt-5.4", displayName: "GPT-5.4", reasoningEfforts: ["low", "medium", "high"], defaultReasoningEffort: "medium", isDefault: true, engine: "codex" }
  ]
};

const antigravityCatalog: CodexModelCatalog = {
  available: true,
  cliVersion: "1.5.14",
  defaultModel: "gemini-4-neon",
  configuredReasoningEffort: "xhigh",
  checkedAt: "2026-11-22T10:00:01.000Z",
  error: null,
  models: [
    {
      model: "gemini-4-neon",
      displayName: "Gemini 4 Neon",
      reasoningEfforts: ["low", "medium", "high", "xhigh"],
      defaultReasoningEffort: "medium",
      isDefault: true,
      engine: "gemini",
      effortModels: {
        low: "gemini-4-neon-low",
        medium: "gemini-4-neon-medium",
        high: "gemini-4-neon-high",
        xhigh: "gemini-4-neon-xhigh"
      }
    },
    {
      model: "gemini-pro-orchestrator-neon",
      displayName: "Orchestrator (Neon)",
      reasoningEfforts: [],
      defaultReasoningEffort: null,
      isDefault: false,
      engine: "gemini"
    }
  ]
};

test("merges Codex and Antigravity catalogs in priority order and formats source versions", () => {
  const merged = mergeModelCatalogs([
    { engine: "codex", catalog: codexCatalog },
    { engine: "gemini", catalog: antigravityCatalog }
  ]);
  assert.equal(merged.available, true);
  assert.equal(merged.defaultModel, "gpt-5.4");
  assert.equal(merged.cliVersion, "0.163.0");
  assert.deepEqual(merged.declaredMcpServers, ["github"]);
  assert.deepEqual(merged.models.map(m => m.model), ["gpt-5.4", "gemini-4-neon", "gemini-pro-orchestrator-neon"]);
  assert.equal(merged.models.find(m => m.model === "gpt-5.4")?.isDefault, true);
  assert.equal(merged.models.find(m => m.model === "gemini-4-neon")?.isDefault, false);
  assert.equal(formatCatalogVersions(merged), "Codex 0.163.0 · Antigravity 1.5.14");
  assert.deepEqual(groupCatalogModels(merged.models).map(g => g.label), ["Codex", "Antigravity"]);
  assert.equal(formatModelOptionLabel(merged.models[0]), "GPT-5.4 — Codex");
  assert.equal(formatModelOptionLabel(merged.models[0], { includeId: true }), "GPT-5.4 (gpt-5.4) — Codex");
  assert.equal(formatModelOptionLabel(merged.models[1]), "Gemini 4 Neon — Antigravity");
  assert.equal(formatModelOptionLabel(merged.models[1], { includeId: true }), "Gemini 4 Neon (gemini-4-neon) — Antigravity");
});

test("falls back cleanly when only one CLI catalog is available", () => {
  const unavailableCodex: CodexModelCatalog = {
    available: false, cliVersion: null, defaultModel: null, models: [], checkedAt: "2026-11-22T10:00:00.000Z", error: "Codex offline"
  };
  const merged = mergeModelCatalogs([
    { engine: "codex", catalog: unavailableCodex },
    { engine: "gemini", catalog: antigravityCatalog }
  ]);
  assert.equal(merged.available, true);
  assert.equal(merged.error, null);
  assert.equal(merged.defaultModel, "gemini-4-neon");
  assert.equal(merged.configuredReasoningEffort, "xhigh");
  assert.equal(formatCatalogVersions(merged), "Antigravity 1.5.14");
  assert.deepEqual(groupCatalogModels(merged.models).map(g => g.label), ["Antigravity"]);
});

test("matches both grouped family IDs and legacy exact variant IDs and resolves exact CLI slugs", () => {
  const merged = mergeModelCatalogs([
    { engine: "codex", catalog: codexCatalog },
    { engine: "gemini", catalog: antigravityCatalog }
  ]);

  const byFamily = resolveCatalogExecutionModel(merged, "gemini-4-neon", "xhigh");
  assert.equal(byFamily.engine, "gemini");
  assert.equal(byFamily.model, "gemini-4-neon-xhigh");
  assert.equal(byFamily.reasoningEffort, "xhigh");

  const defaultEffort = resolveCatalogExecutionModel(merged, "gemini-4-neon", "");
  assert.equal(defaultEffort.engine, "gemini");
  assert.equal(defaultEffort.model, "gemini-4-neon-medium");
  assert.equal(defaultEffort.reasoningEffort, "medium");

  const legacyMatch = findCatalogModel(merged.models, "gemini-4-neon-high");
  assert.equal(legacyMatch?.model.model, "gemini-4-neon");
  assert.equal(legacyMatch?.matchedEffort, "high");

  const legacyExecution = resolveCatalogExecutionModel(merged, "gemini-4-neon-high", "");
  assert.equal(legacyExecution.engine, "gemini");
  assert.equal(legacyExecution.model, "gemini-4-neon-high");
  assert.equal(legacyExecution.reasoningEffort, "high");

  const orchestrator = resolveCatalogExecutionModel(merged, "gemini-pro-orchestrator-neon", "");
  assert.equal(orchestrator.engine, "gemini");
  assert.equal(orchestrator.model, "gemini-pro-orchestrator-neon");
  assert.equal(orchestrator.reasoningEffort, undefined);
});
