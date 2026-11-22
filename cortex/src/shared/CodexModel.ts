import type { CodexEngineUpdateStatus } from "./CodexEngineUpdate.ts";

export type ModelCatalogEngine = "codex" | "gemini";

export interface ModelCatalogSource {
  engine: ModelCatalogEngine;
  label: string;
  available: boolean;
  cliVersion: string | null;
  defaultModel: string | null;
  error: string | null;
}

export interface CodexModel {
  model: string;
  displayName: string;
  reasoningEfforts: string[];
  defaultReasoningEffort: string | null;
  isDefault: boolean;
  engine?: ModelCatalogEngine;
  effortModels?: Record<string, string>;
}

export interface CodexModelCatalog {
  engineUpdate?: CodexEngineUpdateStatus;
  declaredApps?: string[];
  configuredReasoningEffort?: string | null;
  availableSkills?: string[];
  declaredMcpServers?: string[];
  sources?: ModelCatalogSource[];
  available: boolean;
  cliVersion: string | null;
  defaultModel: string | null;
  models: CodexModel[];
  checkedAt: string;
  error: string | null;
}

export function modelEngine(model: Pick<CodexModel, "engine">): ModelCatalogEngine {
  return model.engine === "gemini" ? "gemini" : "codex";
}

export function modelSourceLabel(engine: ModelCatalogEngine): string {
  return engine === "gemini" ? "Antigravity" : "Codex";
}

export function formatModelOptionLabel(
  model: Pick<CodexModel, "model" | "displayName" | "engine">,
  options: { includeId?: boolean } = {}
): string {
  const origin = modelSourceLabel(modelEngine(model));
  const base = options.includeId && model.displayName !== model.model
    ? `${model.displayName} (${model.model})`
    : (model.displayName || model.model);
  return `${base} — ${origin}`;
}

export function findCatalogModel(
  models: readonly CodexModel[],
  savedModel: string | null | undefined
): { model: CodexModel; matchedEffort?: string } | undefined {
  const target = savedModel?.trim();
  if (!target) return undefined;
  const direct = models.find(candidate => candidate.model === target);
  if (direct) return { model: direct };
  for (const candidate of models) {
    if (!candidate.effortModels) continue;
    for (const [effort, rawId] of Object.entries(candidate.effortModels)) {
      if (rawId === target) return { model: candidate, matchedEffort: effort };
    }
  }
  return undefined;
}

export function resolveCatalogExecutionModel(
  catalog: CodexModelCatalog | null | undefined,
  model: string | undefined,
  reasoningEffort: string | undefined
): { engine?: ModelCatalogEngine; model?: string; reasoningEffort?: string; matched?: CodexModel } {
  const matched = findCatalogModel(catalog?.models ?? [], model);
  if (!matched) return { model, reasoningEffort };
  const engine = modelEngine(matched.model);
  const effectiveEffort = reasoningEffort || matched.matchedEffort || matched.model.defaultReasoningEffort || undefined;
  if (matched.model.effortModels) {
    const resolvedModel = (effectiveEffort ? matched.model.effortModels[effectiveEffort] : undefined)
      ?? (matched.model.defaultReasoningEffort ? matched.model.effortModels[matched.model.defaultReasoningEffort] : undefined)
      ?? (matched.matchedEffort ? matched.model.effortModels[matched.matchedEffort] : undefined)
      ?? Object.values(matched.model.effortModels)[0]
      ?? model;
    return {
      engine,
      model: resolvedModel,
      ...(effectiveEffort ? { reasoningEffort: effectiveEffort } : {}),
      matched: matched.model
    };
  }
  return {
    engine,
    model: matched.model.model,
    ...(reasoningEffort ? { reasoningEffort } : {}),
    matched: matched.model
  };
}

export function mergeModelCatalogs(
  entries: ReadonlyArray<{ engine: ModelCatalogEngine; label?: string; catalog: CodexModelCatalog }>
): CodexModelCatalog {
  const sources: ModelCatalogSource[] = entries.map(entry => ({
    engine: entry.engine,
    label: entry.label ?? modelSourceLabel(entry.engine),
    available: entry.catalog.available,
    cliVersion: entry.catalog.cliVersion,
    defaultModel: entry.catalog.defaultModel,
    error: entry.catalog.error
  }));

  const seen = new Set<string>();
  const models: CodexModel[] = [];
  const primaryAvailable = entries.find(entry => entry.catalog.available);

  for (const entry of entries) {
    if (!entry.catalog.available) continue;
    const isPrimary = entry === primaryAvailable;
    for (const candidate of entry.catalog.models) {
      if (seen.has(candidate.model)) continue;
      seen.add(candidate.model);
      models.push({
        ...candidate,
        engine: candidate.engine ?? entry.engine,
        isDefault: isPrimary && candidate.isDefault
      });
    }
  }

  const codexEntry = entries.find(entry => entry.engine === "codex")?.catalog;
  const available = Boolean(primaryAvailable);
  const checkedAt = entries
    .map(entry => entry.catalog.checkedAt)
    .filter(Boolean)
    .sort()
    .at(-1) ?? new Date().toISOString();

  return {
    ...(codexEntry?.engineUpdate ? { engineUpdate: codexEntry.engineUpdate } : {}),
    ...(codexEntry?.declaredApps ? { declaredApps: codexEntry.declaredApps } : {}),
    ...(codexEntry?.availableSkills ? { availableSkills: codexEntry.availableSkills } : {}),
    ...(codexEntry?.declaredMcpServers ? { declaredMcpServers: codexEntry.declaredMcpServers } : {}),
    configuredReasoningEffort: primaryAvailable?.catalog.configuredReasoningEffort ?? null,
    sources,
    available,
    cliVersion: primaryAvailable?.catalog.cliVersion ?? null,
    defaultModel: primaryAvailable?.catalog.defaultModel
      ?? models.find(candidate => candidate.isDefault)?.model
      ?? models[0]?.model
      ?? null,
    models,
    checkedAt,
    error: available ? null : (entries[0]?.catalog.error ?? entries.find(entry => entry.catalog.error)?.catalog.error ?? null)
  };
}

export function groupCatalogModels(
  models: readonly CodexModel[]
): Array<{ engine: ModelCatalogEngine; label: string; models: CodexModel[] }> {
  const groups = new Map<ModelCatalogEngine, CodexModel[]>();
  for (const candidate of models) {
    const engine = modelEngine(candidate);
    const list = groups.get(engine);
    if (list) list.push(candidate);
    else groups.set(engine, [candidate]);
  }
  return [...groups.entries()].map(([engine, grouped]) => ({
    engine,
    label: modelSourceLabel(engine),
    models: grouped
  }));
}

export function formatCatalogVersions(catalog: CodexModelCatalog | null | undefined): string {
  if (!catalog) return "";
  if (catalog.sources?.length) {
    const parts = catalog.sources
      .filter(source => source.available)
      .map(source => source.cliVersion ? `${source.label} ${source.cliVersion}` : source.label);
    if (parts.length) return parts.join(" · ");
  }
  return catalog.cliVersion ? `Codex ${catalog.cliVersion}` : "";
}
