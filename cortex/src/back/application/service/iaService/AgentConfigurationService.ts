import { JsonConfigurationRepository } from "../configuration/JsonConfigurationRepository.ts";
import {
  DEFAULT_AGENT_CONFIGURATION,
  type AgentConfiguration
} from "./AgentProvider.ts";

interface ApplicationConfiguration {
  agentConfiguration?: unknown;
  [key: string]: unknown;
}

export class AgentConfigurationService {
  private readonly repository: JsonConfigurationRepository;

  constructor(configurationFile: string) {
    this.repository = new JsonConfigurationRepository(configurationFile);
  }

  async getConfiguration(): Promise<AgentConfiguration> {
    const applicationConfiguration = await this.readConfiguration();
    const storedConfiguration = applicationConfiguration.agentConfiguration;

    if (!this.isRecord(storedConfiguration)) {
      return { ...DEFAULT_AGENT_CONFIGURATION };
    }

    return {
      autopilot: typeof storedConfiguration.autopilot === "boolean"
        ? storedConfiguration.autopilot
        : DEFAULT_AGENT_CONFIGURATION.autopilot,
      allowAll: typeof storedConfiguration.allowAll === "boolean"
        ? storedConfiguration.allowAll
        : DEFAULT_AGENT_CONFIGURATION.allowAll
    };
  }

  async saveConfiguration(
    configuration: AgentConfiguration
  ): Promise<AgentConfiguration> {
    const storedConfiguration = { ...configuration };
    await this.repository.update<ApplicationConfiguration>((applicationConfiguration) => ({
      ...applicationConfiguration,
      agentConfiguration: storedConfiguration
    }));

    return storedConfiguration;
  }

  private async readConfiguration(): Promise<ApplicationConfiguration> {
    return this.repository.read<ApplicationConfiguration>();
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
}
