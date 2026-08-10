
import type {
  AgentEngine,
  AgentExecutionOptions,
  AgentExecutionResult,
  AgentProvider
} from "./AgentProvider.ts";

export interface AgentStatus {
  engine: AgentEngine | null;
  label: string | null;
  error: string | null;
}

export class AgentService {
  private activeProvider: AgentProvider | null = null;
  private detectionPromise: Promise<AgentProvider | null> | null = null;

  constructor(private readonly providers: AgentProvider[]) {}

  async getStatus(): Promise<AgentStatus> {
    const provider = await this.getActiveProvider();

    if (!provider) {
      return {
        engine: null,
        label: null,
        error: "Aucun moteur IA configure. Installez et connectez Codex, Claude ou Copilot."
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
    const provider = this.providers.find(
      (candidate) => candidate.engine === engine
    );

    if (!provider || !(await provider.isAvailable())) {
      throw new Error(
        `Le moteur ${engine} requis par cet agent n'est pas disponible.`
      );
    }

    return provider.ask(prompt, options);
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
