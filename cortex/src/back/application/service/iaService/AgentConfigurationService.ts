import { readFile, writeFile } from "node:fs/promises";
import {
  DEFAULT_AGENT_CONFIGURATION,
  type AgentConfiguration
} from "./AgentProvider.ts";

interface ApplicationConfiguration {
  agentConfiguration?: unknown;
  [key: string]: unknown;
}

export class AgentConfigurationService {
  constructor(private readonly configurationFile: string) {}

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
    const applicationConfiguration = await this.readConfiguration();
    const storedConfiguration = { ...configuration };

    await writeFile(
      this.configurationFile,
      JSON.stringify({
        ...applicationConfiguration,
        agentConfiguration: storedConfiguration
      }, null, 2),
      "utf8"
    );

    return storedConfiguration;
  }

  private async readConfiguration(): Promise<ApplicationConfiguration> {
    try {
      const configuration: unknown = JSON.parse(
        await readFile(this.configurationFile, "utf8")
      );

      return this.isRecord(configuration) ? configuration : {};
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return {};
      }

      throw error;
    }
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }
}
