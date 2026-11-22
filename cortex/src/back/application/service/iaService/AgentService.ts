
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

export class AgentService {
  private activeProvider: AgentProvider | null = null;
  private detectionPromise: Promise<AgentProvider | null> | null = null;
  private readonly executionControllers = new Set<AbortController>();
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
    private readonly antigravityModelService?: AntigravityModelService
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
      let resolved: AgentExecutionOptions = options;
      if (effectiveEngine === "codex" && (options.persistSession || options.purpose === "interpretation")) {
        resolved = await this.resolveExecutionProfile(options, "codex", prefetchedCatalog);
      } else if (effectiveEngine === "gemini" && this.antigravityModelService && (options.persistSession || options.purpose === "interpretation")) {
        resolved = await this.resolveExecutionProfile(options, "gemini", prefetchedCatalog);
      } else if (effectiveEngine === "gemini" && options.model && prefetchedCatalog) {
        const mapped = resolveCatalogExecutionModel(prefetchedCatalog, options.model, options.reasoningEffort);
        resolved = {
          ...options,
          ...(mapped.model ? { model: mapped.model } : {}),
          ...(mapped.reasoningEffort ? { reasoningEffort: mapped.reasoningEffort } : {})
        };
      }
      if (resolved.profile) options.onProfile?.(resolved.profile);
      const result = await provider.ask(prompt, { ...resolved, configuration });
      return { ...result, ...(resolved.profile ? { profile: { ...resolved.profile,
        observedCapabilities: result.profile?.observedCapabilities ?? [] } } : {}) };
    });
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
