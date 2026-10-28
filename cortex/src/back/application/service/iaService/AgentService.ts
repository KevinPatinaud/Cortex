
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
import type { CodexModelCatalog } from "../../../../shared/CodexModel.ts";
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
    readonly executionQueue?: GlobalExecutionQueue
  ) {}

  getCodexModels(workingDirectory?: string): Promise<CodexModelCatalog> {
    if (!this.codexModelService) return Promise.resolve({ available: false, models: [], cliVersion: null,
      defaultModel: null, checkedAt: new Date().toISOString(), error: "Codex model discovery is unavailable." });
    return this.codexModelService.getCatalog(workingDirectory);
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
        error: "No AI engine is configured. Install and connect Codex, Claude, or Copilot."
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
      const provider = this.providers.find(
        (candidate) => candidate.engine === engine
      );

      if (!provider || !(await provider.isAvailable())) {
        throw new Error(
          `The ${engine} engine required by this agent is unavailable.`
        );
      }

      const configuration = options.readOnly
        ? { autopilot: false, allowAll: false }
        : await this.configurationService.getConfiguration();
      options.signal?.throwIfAborted();
      const resolved = engine === "codex" && (options.persistSession || options.purpose === "interpretation")
        ? await this.resolveExecutionProfile(options) : options;
      if (resolved.profile) options.onProfile?.(resolved.profile);
      const result = await provider.ask(prompt, { ...resolved, configuration });
      return { ...result, ...(resolved.profile ? { profile: { ...resolved.profile,
        observedCapabilities: result.profile?.observedCapabilities ?? [] } } : {}) };
    });
  }

  async resolveExecutionProfile(options: AgentExecutionOptions): Promise<AgentExecutionOptions> {
    const catalog = await this.getCodexModels(options.workingDirectory);
    if (options.purpose === "interpretation" && (!catalog.available || !catalog.declaredMcpServers || !catalog.declaredApps)) {
      throw new Error("Impossible de lire la configuration Codex pour isoler l’interprétation. Le résultat de la mission est conservé pour reprise.");
    }
    const model = options.model || catalog.defaultModel || undefined;
    const selected = catalog.models.find(entry => entry.model === model);
    const reasoningEffort = options.reasoningEffort || catalog.configuredReasoningEffort || selected?.defaultReasoningEffort || undefined;
    if (selected && reasoningEffort && selected.reasoningEfforts.length && !selected.reasoningEfforts.includes(reasoningEffort)) {
      throw new ValidationError(`Effort ${reasoningEffort} indisponible pour ${model}. Choisissez un effort proposé par le serveur.`);
    }
    const profile: ExecutionProfile = { model: model ?? null, reasoningEffort: reasoningEffort ?? null,
      ...(catalog.declaredApps ? { declaredApps: catalog.declaredApps } : {}),
      ...(catalog.availableSkills ? { availableSkills: catalog.availableSkills } : {}),
      ...(catalog.declaredMcpServers ? { declaredMcpServers: catalog.declaredMcpServers } : {}),
      cliVersion: catalog.cliVersion, workingDirectory: options.workingDirectory ?? process.cwd(),
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
          "No AI engine is configured. Install and connect Codex, Claude, or Copilot."
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
