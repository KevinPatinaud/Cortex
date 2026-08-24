import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { MCPServerConfig } from "@github/copilot-sdk";
import { parse } from "smol-toml";
import type {
  McpConnectionEngine,
  McpConnectionScope,
  McpConnectionSummary,
  McpConnectionTransport,
  McpDiscoveryIssue,
  McpDiscoveryResult
} from "../../../../shared/McpConnection.ts";

type JsonRecord = Record<string, unknown>;
type McpServers = Record<string, MCPServerConfig>;

interface McpConfigurationPaths {
  codexConfigurationFile: string;
  claudeConfigurationFile: string;
  copilotConfigurationFile: string;
}

interface ConfigurationSource {
  source: McpConnectionEngine | "shared";
  scope: McpConnectionScope;
  configurationFile: string;
  configuredFor: McpConnectionEngine[];
  format: "json" | "toml";
  selectServers: (configuration: JsonRecord) => unknown;
}

const ALL_ENGINES: McpConnectionEngine[] = ["codex", "claude", "copilot"];

export class McpConfigurationService {
  private readonly paths: McpConfigurationPaths;

  constructor(paths: Partial<McpConfigurationPaths> = {}) {
    const homeDirectory = os.homedir();
    const codexHome = process.env.CODEX_HOME?.trim() ||
      path.join(homeDirectory, ".codex");
    const copilotHome = process.env.COPILOT_HOME?.trim() ||
      path.join(homeDirectory, ".copilot");

    this.paths = {
      codexConfigurationFile: paths.codexConfigurationFile ??
        path.join(codexHome, "config.toml"),
      claudeConfigurationFile: paths.claudeConfigurationFile ?? (
        process.env.CORTEX_CLAUDE_MCP_CONFIG?.trim() ||
        path.join(homeDirectory, ".claude.json")
      ),
      copilotConfigurationFile: paths.copilotConfigurationFile ?? (
        process.env.CORTEX_COPILOT_MCP_CONFIG?.trim() ||
        path.join(copilotHome, "mcp-config.json")
      )
    };
  }

  async discover(workingDirectory?: string): Promise<McpDiscoveryResult> {
    const sources = this.getSources(workingDirectory);
    const discovered = await Promise.all(sources.map((source) =>
      this.discoverSource(source)
    ));

    return {
      connections: discovered
        .flatMap((result) => result.connections)
        .sort(compareConnections),
      issues: discovered.flatMap((result) => result.issues)
    };
  }

  async getCopilotMcpServers(
    workingDirectory?: string
  ): Promise<McpServers> {
    const configuration = await this.readJsonFile(
      this.paths.copilotConfigurationFile
    );
    const userServers = configuration === null
      ? {}
      : this.parseCopilotServers(configuration.mcpServers);
    const projectServerNames = workingDirectory
      ? await this.getProjectServerNames(workingDirectory)
      : new Set<string>();

    return Object.fromEntries(
      Object.entries(userServers).filter(([name]) =>
        !projectServerNames.has(name)
      )
    );
  }

  private getSources(workingDirectory?: string): ConfigurationSource[] {
    const sources: ConfigurationSource[] = [
      {
        source: "codex",
        scope: "user",
        configurationFile: this.paths.codexConfigurationFile,
        configuredFor: ["codex"],
        format: "toml",
        selectServers: (configuration) => configuration.mcp_servers
      },
      {
        source: "claude",
        scope: "user",
        configurationFile: this.paths.claudeConfigurationFile,
        configuredFor: ["claude"],
        format: "json",
        selectServers: (configuration) => configuration.mcpServers
      },
      {
        source: "copilot",
        scope: "user",
        configurationFile: this.paths.copilotConfigurationFile,
        configuredFor: ["copilot"],
        format: "json",
        selectServers: (configuration) => configuration.mcpServers
      }
    ];

    if (!workingDirectory) {
      return sources;
    }

    const projectDirectory = path.resolve(workingDirectory);
    const portableProjectPath = path.join(projectDirectory, ".mcp.json");
    const githubProjectPath = path.join(
      projectDirectory,
      ".github",
      "mcp.json"
    );
    const codexProjectPath = path.join(
      projectDirectory,
      ".codex",
      "config.toml"
    );

    sources.push(
      {
        source: "shared",
        scope: "project",
        configurationFile: portableProjectPath,
        configuredFor: ["claude", "copilot"],
        format: "json",
        selectServers: selectJsonMcpServers
      },
      {
        source: "copilot",
        scope: "project",
        configurationFile: githubProjectPath,
        configuredFor: ["copilot"],
        format: "json",
        selectServers: selectJsonMcpServers
      },
      {
        source: "codex",
        scope: "project",
        configurationFile: codexProjectPath,
        configuredFor: ["codex"],
        format: "toml",
        selectServers: (configuration) => configuration.mcp_servers
      },
      {
        source: "claude",
        scope: "local",
        configurationFile: this.paths.claudeConfigurationFile,
        configuredFor: ["claude"],
        format: "json",
        selectServers: (configuration) => {
          const projects = asRecord(configuration.projects);
          const entry = Object.entries(projects).find(([projectPath]) =>
            pathsAreEqual(projectPath, projectDirectory)
          );

          return asRecord(entry?.[1]).mcpServers;
        }
      }
    );

    return sources;
  }

  private async discoverSource(
    source: ConfigurationSource
  ): Promise<McpDiscoveryResult> {
    try {
      const configuration = source.format === "json"
        ? await this.readJsonFile(source.configurationFile)
        : await this.readTomlFile(source.configurationFile);

      if (configuration === null) {
        return { connections: [], issues: [] };
      }

      const rawServers = source.selectServers(configuration);

      if (rawServers === undefined) {
        return { connections: [], issues: [] };
      }

      if (!isRecord(rawServers)) {
        throw new Error("The MCP server collection must be an object.");
      }

      const connections = Object.entries(rawServers).map(([name, server]) =>
        toConnectionSummary(source, name, server)
      );

      return { connections, issues: [] };
    } catch (error) {
      return {
        connections: [],
        issues: [{
          source: source.source,
          configurationFile: source.configurationFile,
          message: error instanceof Error ? error.message : String(error)
        }]
      };
    }
  }

  private async getProjectServerNames(
    workingDirectory: string
  ): Promise<Set<string>> {
    const projectDirectory = path.resolve(workingDirectory);
    const files = [
      path.join(projectDirectory, ".mcp.json"),
      path.join(projectDirectory, ".github", "mcp.json")
    ];
    const configurations = await Promise.all(files.map((file) =>
      this.readJsonFile(file)
    ));
    const names = new Set<string>();

    for (const configuration of configurations) {
      if (configuration === null) {
        continue;
      }

      for (const name of Object.keys(asRecord(selectJsonMcpServers(configuration)))) {
        names.add(name);
      }
    }

    return names;
  }

  private parseCopilotServers(value: unknown): McpServers {
    if (value === undefined) {
      return {};
    }

    if (!isRecord(value)) {
      throw new Error("The Copilot MCP configuration must contain an mcpServers object.");
    }

    return Object.fromEntries(
      Object.entries(value).map(([name, server]) => [
        name,
        parseCopilotServer(name, server)
      ])
    );
  }

  private async readJsonFile(file: string): Promise<JsonRecord | null> {
    try {
      const configuration: unknown = JSON.parse(await readFile(file, "utf8"));

      if (!isRecord(configuration)) {
        throw new Error("The MCP configuration must be a JSON object.");
      }

      return configuration;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }

      throw error;
    }
  }

  private async readTomlFile(file: string): Promise<JsonRecord | null> {
    try {
      const configuration: unknown = parse(await readFile(file, "utf8"));

      if (!isRecord(configuration)) {
        throw new Error("The MCP configuration must be a TOML table.");
      }

      return configuration;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }

      throw error;
    }
  }
}

function selectJsonMcpServers(configuration: JsonRecord): unknown {
  return configuration.mcpServers ?? configuration;
}

function toConnectionSummary(
  source: ConfigurationSource,
  name: string,
  value: unknown
): McpConnectionSummary {
  if (!isRecord(value)) {
    throw new Error(`The MCP server ${name} must be an object.`);
  }

  const transport = getTransport(value);
  const endpoint = transport === "stdio"
    ? requiredString(value.command, `The MCP server ${name} must define a command.`)
    : redactUrl(requiredString(
      value.url,
      `The MCP server ${name} must define a URL.`
    ));

  return {
    id: [source.source, source.scope, source.configurationFile, name].join(":"),
    name,
    transport,
    endpoint,
    source: source.source,
    scope: source.scope,
    configurationFile: source.configurationFile,
    configuredFor: [...source.configuredFor],
    compatibleEngines: transport === "sse"
      ? ["claude", "copilot"]
      : [...ALL_ENGINES],
    hasAuthentication: hasAuthenticationConfiguration(value)
  };
}

function getTransport(value: JsonRecord): McpConnectionTransport {
  if (value.type === "sse") {
    return "sse";
  }

  if (
    value.type === "http" ||
    value.type === "streamable-http" ||
    typeof value.url === "string"
  ) {
    return "http";
  }

  return "stdio";
}

function hasAuthenticationConfiguration(value: JsonRecord): boolean {
  return Object.keys(asRecord(value.headers)).length > 0 ||
    typeof value.bearer_token_env_var === "string" ||
    typeof value.oauth_client_id === "string";
}

function redactUrl(value: string): string {
  try {
    const url = new URL(value);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return value.replace(/[?#].*$/, "");
  }
}

function parseCopilotServer(name: string, value: unknown): MCPServerConfig {
  if (!isRecord(value)) {
    throw new Error(`The MCP server ${name} must be an object.`);
  }

  const tools = optionalStringArray(value.tools, `The MCP server ${name} tools`);
  const timeout = optionalNumber(value.timeout, `The MCP server ${name} timeout`);

  if (value.type === "http" || value.type === "sse") {
    return {
      type: value.type,
      url: requiredString(value.url, `The MCP server ${name} must define a URL.`),
      ...(tools ? { tools } : {}),
      ...(timeout === undefined ? {} : { timeout }),
      ...(value.headers === undefined
        ? {}
        : { headers: stringRecord(value.headers, `The MCP server ${name} headers`) })
    };
  }

  if (value.type !== undefined && value.type !== "local" && value.type !== "stdio") {
    throw new Error(`The MCP server ${name} has an unsupported type.`);
  }

  return {
    ...(value.type ? { type: value.type } : {}),
    command: requiredString(
      value.command,
      `The MCP server ${name} must define a command.`
    ),
    ...(tools ? { tools } : {}),
    ...(timeout === undefined ? {} : { timeout }),
    ...(value.args === undefined
      ? {}
      : { args: optionalStringArray(value.args, `The MCP server ${name} args`) }),
    ...(value.env === undefined
      ? {}
      : { env: stringRecord(value.env, `The MCP server ${name} env`) }),
    ...(value.workingDirectory === undefined
      ? {}
      : { workingDirectory: requiredString(
        value.workingDirectory,
        `The MCP server ${name} workingDirectory must be a string.`
      ) })
  };
}

function optionalStringArray(value: unknown, label: string): string[] | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new Error(`${label} must be an array of strings.`);
  }

  return value;
}

function optionalNumber(value: unknown, label: string): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${label} must be a finite number.`);
  }

  return value;
}

function stringRecord(value: unknown, label: string): Record<string, string> {
  if (!isRecord(value) || Object.values(value).some((item) => typeof item !== "string")) {
    throw new Error(`${label} must be an object of strings.`);
  }

  return value as Record<string, string>;
}

function requiredString(value: unknown, message: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(message);
  }

  return value;
}

function asRecord(value: unknown): JsonRecord {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function pathsAreEqual(firstPath: string, secondPath: string): boolean {
  const first = path.resolve(firstPath);
  const second = path.resolve(secondPath);

  return process.platform === "win32"
    ? first.toLowerCase() === second.toLowerCase()
    : first === second;
}

function compareConnections(
  first: McpConnectionSummary,
  second: McpConnectionSummary
): number {
  return first.name.localeCompare(second.name) ||
    first.source.localeCompare(second.source) ||
    first.scope.localeCompare(second.scope);
}
