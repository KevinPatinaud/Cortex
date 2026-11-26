
import type {
  AgentConfiguration,
  AgentEngine,
  AgentExecutionOptions,
  AgentExecutionResult,
  AgentProvider
} from "./AgentProvider.ts";
import type { AgentConfigurationService } from "./AgentConfigurationService.ts";
import type { McpConfigurationService } from "./McpConfigurationService.ts";
import type { CodexPluginService } from "./CodexPluginService.ts";
import type { CodexModelService } from "./CodexModelService.ts";
import { unavailableAntigravityCatalog, type AntigravityModelService } from "./AntigravityModelService.ts";
import {
  findCatalogModel,
  mergeModelCatalogs,
  modelEngine,
  resolveCatalogExecutionModel,
  type CodexModel,
  type CodexModelCatalog,
  type ModelCatalogEngine
} from "../../../../shared/CodexModel.ts";
import type { CodexPluginCatalog } from "../../../../shared/CodexPlugin.ts";
import type { ExecutionProfile } from "../../../../shared/ExecutionQuality.ts";
import { ValidationError } from "../../error/ValidationError.ts";
import type { GlobalExecutionQueue } from "../executionQueue/GlobalExecutionQueue.ts";
import type {
  McpConnectionEngine,
  McpConnectionSummary,
  McpDiscoveryResult,
  McpMachineConnectionDetail,
  McpMachineConnectionInput
} from "../../../../shared/McpConnection.ts";

export interface AgentStatus {
  engine: AgentEngine | null;
  label: string | null;
  error: string | null;
}

const GEMINI_INDIVIDUAL_QUOTA_PATTERN = /\b(?:individual|model)\s+quota\s+(?:reached|exceeded|exhausted)\b/i;
const QUOTA_RESET_DURATION_PATTERN = /resets?\s+in\s+((?:\d+\s*[dhms]\s*)+)/i;
const DEFAULT_GEMINI_QUOTA_COOLDOWN_MS = 15 * 60 * 1000;
const MIN_GEMINI_QUOTA_COOLDOWN_MS = 30 * 1000;
const MAX_GEMINI_QUOTA_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000;
const EFFORT_ORDER = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"] as const;

export function isGeminiIndividualQuotaError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  return GEMINI_INDIVIDUAL_QUOTA_PATTERN.test(message);
}

export function parseGeminiQuotaResetMs(error: unknown): number {
  const message = error instanceof Error ? error.message : typeof error === "string" ? error : "";
  const match = message.match(QUOTA_RESET_DURATION_PATTERN);
  if (!match) return DEFAULT_GEMINI_QUOTA_COOLDOWN_MS;

  let totalSeconds = 0;
  for (const part of match[1].matchAll(/(\d+)\s*([dhms])/gi)) {
    const value = Number(part[1]);
    const unit = part[2].toLowerCase();
    if (!Number.isFinite(value)) continue;
    if (unit === "d") totalSeconds += value * 86400;
    else if (unit === "h") totalSeconds += value * 3600;
    else if (unit === "m") totalSeconds += value * 60;
    else if (unit === "s") totalSeconds += value;
  }

  if (totalSeconds <= 0) return DEFAULT_GEMINI_QUOTA_COOLDOWN_MS;
  return Math.min(MAX_GEMINI_QUOTA_COOLDOWN_MS, Math.max(MIN_GEMINI_QUOTA_COOLDOWN_MS, totalSeconds * 1000));
}

function geminiModelVendorFamily(modelId: string | undefined): string {
  const normalized = (modelId ?? "").trim().toLowerCase();
  if (!normalized || normalized.startsWith("gemini-")) return "gemini-";
  if (normalized.startsWith("claude-")) return "claude-";
  return "";
}

function isSelectableGeminiFallback(entry: CodexModel, vendorFamily: string): boolean {
  if (modelEngine(entry) !== "gemini") return false;
  if (/\borchestrator\b/i.test(entry.model) || /\borchestrator\b/i.test(entry.displayName)) return false;
  if (!vendorFamily) return false;
  return entry.model.toLowerCase().startsWith(vendorFamily);
}

export function selectGeminiQuotaFallbackModels(
  catalog: CodexModelCatalog | null | undefined,
  requestedModel?: string
): CodexModel[] {
  if (!catalog?.models?.length) return [];
  const requestedFamily = findCatalogModel(catalog.models, requestedModel)?.model.model ?? requestedModel;
  const requestedLower = requestedFamily?.trim().toLowerCase();
  const vendorFamily = geminiModelVendorFamily(requestedFamily);
  const eligible = catalog.models.filter(entry =>
    isSelectableGeminiFallback(entry, vendorFamily) && entry.model.toLowerCase() !== requestedLower
  );
  if (!eligible.length) return [];

  const antigravitySource = catalog.sources?.find(source => source.engine === "gemini");
  const defaultModelId = (antigravitySource?.defaultModel ?? catalog.defaultModel)?.trim().toLowerCase();
  const preferred = defaultModelId
    ? eligible.find(entry => entry.model.toLowerCase() === defaultModelId)
    : undefined;
  return preferred
    ? [preferred, ...eligible.filter(entry => entry.model !== preferred.model)]
    : eligible;
}

function resolveCompatibleReasoningEffort(target: CodexModel, requestedEffort?: string): string | undefined {
  if (!target.reasoningEfforts.length) return undefined;
  const normalized = requestedEffort?.trim().toLowerCase();
  if (normalized && target.reasoningEfforts.includes(normalized)) return normalized;
  if (normalized) {
    const requestedIndex = EFFORT_ORDER.indexOf(normalized as (typeof EFFORT_ORDER)[number]);
    if (requestedIndex >= 0) {
      const ranked = target.reasoningEfforts
        .map(effort => ({ effort, index: EFFORT_ORDER.indexOf(effort as (typeof EFFORT_ORDER)[number]) }))
        .filter(entry => entry.index >= 0)
        .sort((a, b) => a.index - b.index);
      const lowerOrEqual = ranked.filter(entry => entry.index <= requestedIndex).at(-1);
      if (lowerOrEqual) return lowerOrEqual.effort;
      if (ranked[0]) return ranked[0].effort;
    }
  }
  return target.defaultReasoningEffort ?? target.reasoningEfforts[0];
}

export class AgentService {
  private activeProvider: AgentProvider | null = null;
  private detectionPromise: Promise<AgentProvider | null> | null = null;
  private readonly executionControllers = new Set<AbortController>();
  private readonly geminiQuotaCooldowns = new Map<string, number>();
  private shutdownRequested = false;

  cancelAllExecutions(): void {
    this.shutdownRequested = true;
    for (const controller of this.executionControllers) {
      controller.abort(new DOMException("The server is stopping.", "AbortError"));
    }
  }

  hasActiveExecutions(): boolean {
    return this.executionControllers.size > 0;
  }

  private async trackExecution<T>(
    options: AgentExecutionOptions,
    execute: (options: AgentExecutionOptions) => Promise<T>
  ): Promise<T> {
    if (this.shutdownRequested) throw new DOMException("The server is stopping.", "AbortError");
    const controller = new AbortController();
    this.executionControllers.add(controller);
    try {
      const signal = options.signal
        ? AbortSignal.any([options.signal, controller.signal]) : controller.signal;
      signal.throwIfAborted();
      const operation = async () => {
        signal.throwIfAborted();
        await options.beforeStart?.();
        signal.throwIfAborted();
        return execute({ ...options, signal,
          ...(this.executionQueue && !this.executionQueue.allowsParallelExecutions() ? { delegation: "none" as const } : {}) });
      };
      return this.executionQueue
        ? await this.executionQueue.run({ source: options.executionSource ?? "internal", label: options.executionLabel ?? "Tâche Cortex",
          key: options.executionKey, signal, onQueued: () => options.onProgress?.("En attente dans la file globale de Cortex…") }, operation)
        : await operation();
    } finally {
      this.executionControllers.delete(controller);
    }
  }

  constructor(
    private readonly providers: AgentProvider[],
    private readonly configurationService: AgentConfigurationService,
    private readonly mcpConfigurationService?: McpConfigurationService,
    private readonly codexPluginService?: CodexPluginService,
    private readonly codexModelService?: CodexModelService,
    readonly executionQueue?: GlobalExecutionQueue,
    private readonly antigravityModelService?: AntigravityModelService,
    private readonly now: () => number = () => Date.now()
  ) {}

  private getCodexOnlyModels(workingDirectory?: string): Promise<CodexModelCatalog> {
    if (!this.codexModelService) return Promise.resolve({ available: false, models: [], cliVersion: null,
      defaultModel: null, checkedAt: new Date().toISOString(), error: "Codex model discovery is unavailable." });
    return this.codexModelService.getCatalog(workingDirectory);
  }

  getAntigravityModels(workingDirectory?: string): Promise<CodexModelCatalog> {
    if (!this.antigravityModelService) return Promise.resolve(unavailableAntigravityCatalog());
    return this.antigravityModelService.getCatalog(workingDirectory);
  }

  async getModels(
    workingDirectory?: string,
    primaryEngine: ModelCatalogEngine = "codex"
  ): Promise<CodexModelCatalog> {
    if (!this.antigravityModelService) {
      const codex = await this.getCodexOnlyModels(workingDirectory);
      if (primaryEngine === "codex") return codex;
      return mergeModelCatalogs([
        { engine: "gemini", catalog: unavailableAntigravityCatalog() },
        { engine: "codex", catalog: codex }
      ]);
    }
    const [codex, antigravity] = await Promise.all([
      this.getCodexOnlyModels(workingDirectory),
      this.getAntigravityModels(workingDirectory)
    ]);
    return mergeModelCatalogs(
      primaryEngine === "gemini"
        ? [{ engine: "gemini", catalog: antigravity }, { engine: "codex", catalog: codex }]
        : [{ engine: "codex", catalog: codex }, { engine: "gemini", catalog: antigravity }]
    );
  }

  getCodexModels(workingDirectory?: string): Promise<CodexModelCatalog> {
    return this.getModels(workingDirectory, "codex");
  }

  async resolveModelEngine(
    defaultEngine: AgentEngine,
    model?: string,
    workingDirectory?: string
  ): Promise<AgentEngine> {
    if (!model || (defaultEngine !== "codex" && defaultEngine !== "gemini")) return defaultEngine;
    if (!this.codexModelService && !this.antigravityModelService) return defaultEngine;
    const catalog = await this.getModels(workingDirectory, defaultEngine).catch(() => null);
    const matched = findCatalogModel(catalog?.models ?? [], model);
    return matched ? modelEngine(matched.model) : defaultEngine;
  }

  getCodexPlugins(): Promise<CodexPluginCatalog> {
    return this.codexPluginService?.getCatalog() ?? Promise.resolve({
      available: false,
      plugins: [],
      error: "Codex plugin management is unavailable."
    });
  }

  installCodexPlugin(pluginId: string): Promise<CodexPluginCatalog> {
    if (!this.codexPluginService) {
      return Promise.reject(new Error("Codex plugin management is unavailable."));
    }

    return this.codexPluginService.install(pluginId);
  }

  removeCodexPlugin(pluginId: string): Promise<CodexPluginCatalog> {
    if (!this.codexPluginService) {
      return Promise.reject(new Error("Codex plugin management is unavailable."));
    }

    return this.codexPluginService.remove(pluginId);
  }

  getMcpConnections(workingDirectory?: string): Promise<McpDiscoveryResult> {
    return this.mcpConfigurationService?.discover(workingDirectory) ??
      Promise.resolve({ connections: [], issues: [] });
  }

  getMachineMcpConnection(
    engine: McpConnectionEngine,
    name: string
  ): Promise<McpMachineConnectionDetail> {
    if (!this.mcpConfigurationService) {
      return Promise.reject(new Error("MCP configuration is unavailable."));
    }

    return this.mcpConfigurationService.getMachineConnection(engine, name);
  }

  createMachineMcpConnection(
    input: McpMachineConnectionInput | null | undefined
  ): Promise<McpConnectionSummary> {
    if (!this.mcpConfigurationService) {
      return Promise.reject(new Error("MCP configuration is unavailable."));
    }

    return this.mcpConfigurationService.createMachineConnection(input);
  }

  updateMachineMcpConnection(
    engine: McpConnectionEngine,
    name: string,
    input: McpMachineConnectionInput | null | undefined
  ): Promise<McpConnectionSummary> {
    if (!this.mcpConfigurationService) {
      return Promise.reject(new Error("MCP configuration is unavailable."));
    }

    return this.mcpConfigurationService.updateMachineConnection(
      engine,
      name,
      input
    );
  }

  deleteMachineMcpConnection(
    engine: McpConnectionEngine,
    name: string
  ): Promise<void> {
    if (!this.mcpConfigurationService) {
      return Promise.reject(new Error("MCP configuration is unavailable."));
    }

    return this.mcpConfigurationService.deleteMachineConnection(engine, name);
  }

  getConfiguration(): Promise<AgentConfiguration> {
    return this.configurationService.getConfiguration();
  }

  saveConfiguration(
    configuration: AgentConfiguration
  ): Promise<AgentConfiguration> {
    return this.configurationService.saveConfiguration(configuration);
  }

  async getStatus(): Promise<AgentStatus> {
    const provider = await this.getActiveProvider();

    if (!provider) {
      return {
        engine: null,
        label: null,
        error: "No AI engine is configured. Install and connect Codex, Claude, Copilot, or Gemini."
      };
    }

    return {
      engine: provider.engine,
      label: provider.label,
      error: null
    };
  }

  async execute(
    engine: AgentEngine,
    prompt: string,
    options: AgentExecutionOptions
  ): Promise<AgentExecutionResult> {
    return this.trackExecution(options, async (options) => {
      let effectiveEngine: AgentEngine = engine;
      let prefetchedCatalog: CodexModelCatalog | undefined;

      if ((engine === "codex" || engine === "gemini") && options.model && (this.codexModelService || this.antigravityModelService)) {
        prefetchedCatalog = await this.getModels(options.workingDirectory, engine).catch(() => undefined);
        const matched = findCatalogModel(prefetchedCatalog?.models ?? [], options.model);
        if (matched) effectiveEngine = modelEngine(matched.model);
      }

      const provider = this.providers.find(
        (candidate) => candidate.engine === effectiveEngine
      );

      if (!provider || !(await provider.isAvailable())) {
        throw new Error(
          `The ${effectiveEngine} engine required by this agent is unavailable.`
        );
      }

      const configuration = options.readOnly
        ? { autopilot: false, allowAll: false }
        : await this.configurationService.getConfiguration();
      options.signal?.throwIfAborted();
      if (effectiveEngine === "gemini" && this.antigravityModelService && !prefetchedCatalog) {
        prefetchedCatalog = await this.getModels(options.workingDirectory, "gemini").catch(() => undefined);
      }
      const includeProfile = Boolean(options.persistSession || options.purpose === "interpretation");
      let resolved: AgentExecutionOptions = options;
      if (effectiveEngine === "codex" && includeProfile) {
        resolved = await this.resolveExecutionProfile(options, "codex", prefetchedCatalog);
      } else if (effectiveEngine === "gemini" && this.antigravityModelService && includeProfile) {
        resolved = await this.resolveExecutionProfile(options, "gemini", prefetchedCatalog);
      } else if (effectiveEngine === "gemini" && options.model && prefetchedCatalog) {
        const mapped = resolveCatalogExecutionModel(prefetchedCatalog, options.model, options.reasoningEffort);
        resolved = {
          ...options,
          ...(mapped.model ? { model: mapped.model } : {}),
          ...(mapped.reasoningEffort ? { reasoningEffort: mapped.reasoningEffort } : {})
        };
      }

      const triedFamilies = new Set<string>();
      let activeOptions = resolved;
      let activeFamily = effectiveEngine === "gemini"
        ? this.resolveGeminiFamilyId(prefetchedCatalog, activeOptions.profile?.model ?? activeOptions.model ?? options.model)
        : undefined;

      if (effectiveEngine === "gemini" && prefetchedCatalog && activeFamily && this.isGeminiModelInQuotaCooldown(activeFamily)) {
        const proactiveFallback = this.pickNextGeminiFallback(prefetchedCatalog, activeFamily, triedFamilies);
        if (proactiveFallback) {
          const notice = `Quota temporairement épuisé sur ${activeFamily}, bascule vers ${proactiveFallback.model}…`;
          options.onProgress?.(notice);
          options.onTrace?.({ kind: "status", content: notice });
          activeOptions = await this.buildGeminiFallbackExecutionOptions(
            options,
            activeOptions.reasoningEffort,
            prefetchedCatalog,
            proactiveFallback,
            includeProfile
          );
          activeFamily = proactiveFallback.model;
        }
      }

      while (true) {
        if (activeFamily) triedFamilies.add(activeFamily.toLowerCase());
        if (activeOptions.profile) options.onProfile?.(activeOptions.profile);
        try {
          const result = await provider.ask(prompt, { ...activeOptions, configuration });
          return {
            ...result,
            ...(activeOptions.profile ? {
              profile: {
                ...activeOptions.profile,
                observedCapabilities: result.profile?.observedCapabilities ?? []
              }
            } : {})
          };
        } catch (error) {
          if (
            effectiveEngine !== "gemini" ||
            options.signal?.aborted ||
            !prefetchedCatalog ||
            !isGeminiIndividualQuotaError(error)
          ) {
            throw error;
          }
          if (activeFamily) {
            this.markGeminiModelQuotaExhausted(activeFamily, error);
          }
          const nextModel = this.pickNextGeminiFallback(prefetchedCatalog, activeFamily ?? options.model, triedFamilies);
          if (!nextModel) {
            throw error;
          }
          const fromLabel = activeFamily ?? activeOptions.model ?? "modèle Gemini";
          const notice = `Quota atteint sur ${fromLabel}, bascule vers ${nextModel.model}…`;
          options.onProgress?.(notice);
          options.onTrace?.({ kind: "status", content: notice });
          activeOptions = await this.buildGeminiFallbackExecutionOptions(
            options,
            activeOptions.reasoningEffort,
            prefetchedCatalog,
            nextModel,
            includeProfile
          );
          activeFamily = nextModel.model;
          options.signal?.throwIfAborted();
        }
      }
    });
  }

  private resolveGeminiFamilyId(
    catalog: CodexModelCatalog | undefined,
    model: string | undefined
  ): string | undefined {
    if (catalog) {
      const matched = findCatalogModel(catalog.models, model);
      if (matched) return matched.model.model;
      if (!model) {
        const antigravitySource = catalog.sources?.find(source => source.engine === "gemini");
        return antigravitySource?.defaultModel ?? catalog.defaultModel ?? undefined;
      }
    }
    return model?.trim() || undefined;
  }

  private isGeminiModelInQuotaCooldown(modelId: string): boolean {
    const key = modelId.trim().toLowerCase();
    const until = this.geminiQuotaCooldowns.get(key);
    if (until === undefined) return false;
    if (until > this.now()) return true;
    this.geminiQuotaCooldowns.delete(key);
    return false;
  }

  private markGeminiModelQuotaExhausted(modelId: string, error: unknown): void {
    const key = modelId.trim().toLowerCase();
    if (!key) return;
    this.geminiQuotaCooldowns.set(key, this.now() + parseGeminiQuotaResetMs(error));
  }

  private pickNextGeminiFallback(
    catalog: CodexModelCatalog,
    requestedModel: string | undefined,
    triedFamilies: ReadonlySet<string>
  ): CodexModel | undefined {
    return selectGeminiQuotaFallbackModels(catalog, requestedModel).find(candidate => {
      const key = candidate.model.toLowerCase();
      return !triedFamilies.has(key) && !this.isGeminiModelInQuotaCooldown(candidate.model);
    });
  }

  private async buildGeminiFallbackExecutionOptions(
    originalOptions: AgentExecutionOptions,
    resolvedEffort: string | undefined,
    catalog: CodexModelCatalog,
    nextModel: CodexModel,
    includeProfile: boolean
  ): Promise<AgentExecutionOptions> {
    const compatibleEffort = resolveCompatibleReasoningEffort(
      nextModel,
      originalOptions.reasoningEffort ?? resolvedEffort
    );
    const nextOptions: AgentExecutionOptions = {
      ...originalOptions,
      model: nextModel.model,
      reasoningEffort: compatibleEffort
    };
    if (includeProfile) {
      return this.resolveExecutionProfile(nextOptions, "gemini", catalog);
    }
    const mapped = resolveCatalogExecutionModel(catalog, nextModel.model, compatibleEffort);
    return {
      ...nextOptions,
      ...(mapped.model ? { model: mapped.model } : {}),
      ...(mapped.reasoningEffort ? { reasoningEffort: mapped.reasoningEffort } : {})
    };
  }

  async resolveExecutionProfile(
    options: AgentExecutionOptions,
    requestedEngine: AgentEngine = "codex",
    prefetchedCatalog?: CodexModelCatalog
  ): Promise<AgentExecutionOptions> {
    const primary: ModelCatalogEngine = requestedEngine === "gemini" ? "gemini" : "codex";
    const catalog = prefetchedCatalog ?? await this.getModels(options.workingDirectory, primary);
    const matched = findCatalogModel(catalog.models, options.model);
    const effectiveEngine: ModelCatalogEngine = matched ? modelEngine(matched.model) : primary;

    if (effectiveEngine === "gemini") {
      const antigravitySource = catalog.sources?.find(source => source.engine === "gemini");
      const engineModels = catalog.models.filter(entry => modelEngine(entry) === "gemini");
      const defaultModelId = antigravitySource?.defaultModel ?? (primary === "gemini" ? catalog.defaultModel : null);
      const selected = matched?.model
        ?? (!options.model ? (engineModels.find(entry => entry.model === defaultModelId) ?? engineModels.find(entry => entry.isDefault) ?? engineModels[0]) : undefined);
      const displayModel = selected?.model ?? options.model ?? undefined;
      const configuredEffort = selected?.model === catalog.defaultModel ? catalog.configuredReasoningEffort : null;
      const reasoningEffort = options.reasoningEffort
        || matched?.matchedEffort
        || (configuredEffort && selected?.reasoningEfforts.includes(configuredEffort) ? configuredEffort : undefined)
        || selected?.defaultReasoningEffort
        || undefined;
      if (selected && reasoningEffort && selected.reasoningEfforts.length && !selected.reasoningEfforts.includes(reasoningEffort)) {
        throw new ValidationError(`Effort ${reasoningEffort} indisponible pour ${displayModel}. Choisissez un effort proposé par le serveur.`);
      }
      const mapped = resolveCatalogExecutionModel(catalog, displayModel, reasoningEffort);
      const cliModel = mapped.model ?? options.model;
      const cliVersion = antigravitySource?.cliVersion ?? (primary === "gemini" ? catalog.cliVersion : null);
      const pinned = Boolean(displayModel && (reasoningEffort || (selected && selected.reasoningEfforts.length === 0)));
      const profile: ExecutionProfile = {
        model: displayModel ?? null,
        reasoningEffort: reasoningEffort ?? null,
        cliVersion,
        workingDirectory: options.workingDirectory ?? process.cwd(),
        delegation: options.delegation ?? "none",
        observedCapabilities: [],
        resolution: pinned ? "pinned" : "unavailable"
      };
      return {
        ...options,
        ...(cliModel ? { model: cliModel } : {}),
        ...(reasoningEffort ? { reasoningEffort } : {}),
        profile
      };
    }

    const codexSource = catalog.sources?.find(source => source.engine === "codex");
    const codexAvailable = codexSource ? codexSource.available : catalog.available;
    if (options.purpose === "interpretation" && (!codexAvailable || !catalog.declaredMcpServers || !catalog.declaredApps)) {
      throw new Error("Impossible de lire la configuration Codex pour isoler l’interprétation. Le résultat de la mission est conservé pour reprise.");
    }
    const codexDefaultModel = codexSource ? codexSource.defaultModel : catalog.defaultModel;
    const model = options.model || codexDefaultModel || undefined;
    const selected = catalog.models.find(entry => entry.model === model);
    const configuredEffort = codexDefaultModel && codexDefaultModel === catalog.defaultModel ? catalog.configuredReasoningEffort : null;
    const reasoningEffort = options.reasoningEffort || configuredEffort || selected?.defaultReasoningEffort || undefined;
    if (selected && reasoningEffort && selected.reasoningEfforts.length && !selected.reasoningEfforts.includes(reasoningEffort)) {
      throw new ValidationError(`Effort ${reasoningEffort} indisponible pour ${model}. Choisissez un effort proposé par le serveur.`);
    }
    const cliVersion = codexSource ? codexSource.cliVersion : catalog.cliVersion;
    const profile: ExecutionProfile = { model: model ?? null, reasoningEffort: reasoningEffort ?? null,
      ...(catalog.declaredApps ? { declaredApps: catalog.declaredApps } : {}),
      ...(catalog.availableSkills ? { availableSkills: catalog.availableSkills } : {}),
      ...(catalog.declaredMcpServers ? { declaredMcpServers: catalog.declaredMcpServers } : {}),
      cliVersion, workingDirectory: options.workingDirectory ?? process.cwd(),
      delegation: options.delegation ?? "none", observedCapabilities: [], resolution: model && reasoningEffort ? "pinned" : "unavailable" };
    return { ...options, ...(model ? { model } : {}), ...(reasoningEffort ? { reasoningEffort } : {}), profile };
  }

  async executeActive(
    prompt: string,
    options: AgentExecutionOptions
  ): Promise<AgentExecutionResult> {
    return this.trackExecution(options, async (options) => {
      const provider = await this.getActiveProvider();

      if (!provider) {
        throw new Error(
          "No AI engine is configured. Install and connect Codex, Claude, Copilot, or Gemini."
        );
      }

      const configuration = options.readOnly
        ? { autopilot: false, allowAll: false }
        : await this.configurationService.getConfiguration();

      options.signal?.throwIfAborted();
      return provider.ask(prompt, {
        ...options, configuration
      });
    });
  }

  private async getActiveProvider(): Promise<AgentProvider | null> {
    if (this.activeProvider) {
      return this.activeProvider;
    }

    this.detectionPromise ??= this.detectProvider();

    try {
      const detectedProvider = await this.detectionPromise;

      if (detectedProvider) {
        this.activeProvider = detectedProvider;
      }

      return detectedProvider;
    } finally {
      this.detectionPromise = null;
    }
  }

  private async detectProvider(): Promise<AgentProvider | null> {
    for (const provider of this.providers) {
      if (await provider.isAvailable()) {
        return provider;
      }
    }

    return null;
  }
}
