import {
  copyFile,
  mkdir,
  readFile,
  rename,
  stat,
  unlink,
  writeFile
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { MCPServerConfig } from "@github/copilot-sdk";
import { parse, stringify } from "smol-toml";
import { NotFoundError } from "../../error/NotFoundError.ts";
import { ValidationError } from "../../error/ValidationError.ts";
import type {
  McpConnectionEngine,
  McpConnectionScope,
  McpConnectionSummary,
  McpConnectionTransport,
  McpDiscoveryIssue,
  McpDiscoveryResult,
  McpMachineConnectionDetail,
  McpMachineConnectionInput
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
  private writeQueue: Promise<void> = Promise.resolve();

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

  async getMachineConnection(
    engine: McpConnectionEngine,
    name: string
  ): Promise<McpMachineConnectionDetail> {
    const normalizedEngine = normalizeEngine(engine);
    const normalizedName = normalizeName(name);
    const configuration = await this.readEngineConfiguration(normalizedEngine);
    const servers = getEngineServers(configuration, normalizedEngine);
    const server = servers[normalizedName];

    if (!isRecord(server)) {
      throw new NotFoundError(`The MCP connection ${normalizedName} was not found.`);
    }

    const transport = getTransport(server);
    const command = transport === "stdio"
      ? requiredString(
        server.command,
        `The MCP server ${normalizedName} must define a command.`
      )
      : "";
    const rawUrl = transport === "stdio"
      ? ""
      : requiredString(
        server.url,
        `The MCP server ${normalizedName} must define a URL.`
      );

    return {
      engine: normalizedEngine,
      name: normalizedName,
      transport,
      command,
      args: transport === "stdio"
        ? optionalStringArray(
          server.args,
          `The MCP server ${normalizedName} args`
        ) ?? []
        : [],
      url: redactUrl(rawUrl),
      environmentKeys: Object.keys(asRecord(server.env)).sort(),
      headerNames: Object.keys(getServerHeaders(server, normalizedEngine)).sort()
    };
  }

  async createMachineConnection(
    input: McpMachineConnectionInput | null | undefined
  ): Promise<McpConnectionSummary> {
    const draft = parseMachineConnectionInput(input);

    return this.withWriteLock(async () => {
      const configuration = await this.readEngineConfiguration(draft.engine);
      const servers = getEngineServers(configuration, draft.engine);

      if (servers[draft.name] !== undefined) {
        throw new ValidationError(
          `The MCP connection ${draft.name} already exists for ${draft.engine}.`
        );
      }

      servers[draft.name] = toRawServer(draft.engine, draft);
      setEngineServers(configuration, draft.engine, servers);
      await this.writeEngineConfiguration(draft.engine, configuration);

      return this.getRequiredMachineConnectionSummary(draft.engine, draft.name);
    });
  }

  async updateMachineConnection(
    engine: McpConnectionEngine,
    currentName: string,
    input: McpMachineConnectionInput | null | undefined
  ): Promise<McpConnectionSummary> {
    const normalizedEngine = normalizeEngine(engine);
    const normalizedCurrentName = normalizeName(currentName);
    const draft = parseMachineConnectionInput(input, normalizedEngine);

    return this.withWriteLock(async () => {
      const configuration = await this.readEngineConfiguration(normalizedEngine);
      const servers = getEngineServers(configuration, normalizedEngine);
      const existing = servers[normalizedCurrentName];

      if (!isRecord(existing)) {
        throw new NotFoundError(
          `The MCP connection ${normalizedCurrentName} was not found.`
        );
      }

      if (
        draft.name !== normalizedCurrentName &&
        servers[draft.name] !== undefined
      ) {
        throw new ValidationError(
          `The MCP connection ${draft.name} already exists for ${normalizedEngine}.`
        );
      }

      const updated = toRawServer(normalizedEngine, draft, existing);
      delete servers[normalizedCurrentName];
      servers[draft.name] = updated;
      setEngineServers(configuration, normalizedEngine, servers);
      await this.writeEngineConfiguration(normalizedEngine, configuration);

      return this.getRequiredMachineConnectionSummary(
        normalizedEngine,
        draft.name
      );
    });
  }

  async deleteMachineConnection(
    engine: McpConnectionEngine,
    name: string
  ): Promise<void> {
    const normalizedEngine = normalizeEngine(engine);
    const normalizedName = normalizeName(name);

    await this.withWriteLock(async () => {
      const configuration = await this.readEngineConfiguration(normalizedEngine);
      const servers = getEngineServers(configuration, normalizedEngine);

      if (servers[normalizedName] === undefined) {
        throw new NotFoundError(
          `The MCP connection ${normalizedName} was not found.`
        );
      }

      delete servers[normalizedName];
      setEngineServers(configuration, normalizedEngine, servers);
      await this.writeEngineConfiguration(normalizedEngine, configuration);
    });
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

  private async readEngineConfiguration(
    engine: McpConnectionEngine
  ): Promise<JsonRecord> {
    const file = this.getEngineConfigurationFile(engine);
    const configuration = engine === "codex"
      ? await this.readTomlFile(file)
      : await this.readJsonFile(file);

    return configuration ?? {};
  }

  private async writeEngineConfiguration(
    engine: McpConnectionEngine,
    configuration: JsonRecord
  ): Promise<void> {
    const file = this.getEngineConfigurationFile(engine);
    const content = engine === "codex"
      ? `${stringify(configuration)}\n`
      : `${JSON.stringify(configuration, null, 2)}\n`;

    await atomicWriteFile(file, content);
  }

  private getEngineConfigurationFile(engine: McpConnectionEngine): string {
    return engine === "codex"
      ? this.paths.codexConfigurationFile
      : engine === "claude"
        ? this.paths.claudeConfigurationFile
        : this.paths.copilotConfigurationFile;
  }

  private async getRequiredMachineConnectionSummary(
    engine: McpConnectionEngine,
    name: string
  ): Promise<McpConnectionSummary> {
    const result = await this.discover();
    const connection = result.connections.find((candidate) =>
      candidate.source === engine &&
      candidate.scope === "user" &&
      candidate.name === name
    );

    if (!connection) {
      throw new Error(`The MCP connection ${name} could not be reloaded.`);
    }

    return connection;
  }

  private async withWriteLock<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.writeQueue;
    let release!: () => void;
    this.writeQueue = new Promise<void>((resolve) => {
      release = resolve;
    });

    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}

interface ParsedMachineConnectionInput {
  engine: McpConnectionEngine;
  name: string;
  transport: McpConnectionTransport;
  command: string;
  args: string[];
  url: string;
  environment: Record<string, string | null>;
  headers: Record<string, string | null>;
}

function parseMachineConnectionInput(
  input: McpMachineConnectionInput | null | undefined,
  requiredEngine?: McpConnectionEngine
): ParsedMachineConnectionInput {
  if (!input || !isRecord(input)) {
    throw new ValidationError("The MCP connection is required.");
  }

  const engine = normalizeEngine(input.engine);
  if (requiredEngine && engine !== requiredEngine) {
    throw new ValidationError("The MCP connection engine cannot be changed.");
  }

  const name = normalizeName(input.name);
  const transport = normalizeTransport(input.transport);
  if (engine === "codex" && transport === "sse") {
    throw new ValidationError("Codex does not support legacy SSE MCP servers.");
  }

  const command = typeof input.command === "string" ? input.command.trim() : "";
  const url = typeof input.url === "string" ? input.url.trim() : "";
  const args = optionalStringArray(input.args, "The MCP server arguments") ?? [];
  const environment = nullableStringRecord(
    input.environment,
    "The MCP server environment"
  );
  const headers = nullableStringRecord(input.headers, "The MCP server headers");

  if (transport === "stdio" && !command) {
    throw new ValidationError("The MCP server command is required.");
  }

  if (transport !== "stdio") {
    if (!url) {
      throw new ValidationError("The MCP server URL is required.");
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      throw new ValidationError("The MCP server URL is invalid.");
    }

    if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
      throw new ValidationError("The MCP server URL must use HTTP or HTTPS.");
    }
  }

  if (name.length > 80 || command.length > 4_096 || url.length > 8_192) {
    throw new ValidationError("The MCP connection contains an oversized field.");
  }

  return {
    engine,
    name,
    transport,
    command,
    args,
    url,
    environment,
    headers
  };
}

function normalizeEngine(value: unknown): McpConnectionEngine {
  if (value === "codex" || value === "claude" || value === "copilot") {
    return value;
  }

  throw new ValidationError("The MCP connection engine is invalid.");
}

function normalizeTransport(value: unknown): McpConnectionTransport {
  if (value === "stdio" || value === "http" || value === "sse") {
    return value;
  }

  throw new ValidationError("The MCP connection transport is invalid.");
}

function normalizeName(value: unknown): string {
  if (typeof value !== "string") {
    throw new ValidationError("The MCP connection name is required.");
  }

  const name = value.trim();
  if (!name) {
    throw new ValidationError("The MCP connection name is required.");
  }

  if (!/^[a-zA-Z0-9_-]+$/.test(name) || name.length > 80) {
    throw new ValidationError(
      "The MCP connection name may only contain letters, numbers, dashes, and underscores."
    );
  }

  return name;
}

function getEngineServers(
  configuration: JsonRecord,
  engine: McpConnectionEngine
): JsonRecord {
  const value = engine === "codex"
    ? configuration.mcp_servers
    : configuration.mcpServers;

  if (value === undefined) {
    return {};
  }

  if (!isRecord(value)) {
    throw new ValidationError(
      `The ${engine} MCP server collection must be an object.`
    );
  }

  return value;
}

function setEngineServers(
  configuration: JsonRecord,
  engine: McpConnectionEngine,
  servers: JsonRecord
): void {
  if (engine === "codex") {
    configuration.mcp_servers = servers;
    return;
  }

  configuration.mcpServers = servers;
}

function toRawServer(
  engine: McpConnectionEngine,
  input: ParsedMachineConnectionInput,
  existing: JsonRecord = {}
): JsonRecord {
  const server: JsonRecord = { ...existing };

  delete server.command;
  delete server.args;
  delete server.env;
  delete server.workingDirectory;
  delete server.cwd;
  delete server.url;
  delete server.headers;
  delete server.http_headers;

  if (input.transport === "stdio") {
    if (engine === "codex") {
      delete server.type;
    } else {
      server.type = "stdio";
    }
    server.command = input.command;
    if (input.args.length > 0) {
      server.args = input.args;
    }
    const environment = mergeSecretRecord(
      asRecord(existing.env),
      input.environment,
      "environment variable"
    );
    if (Object.keys(environment).length > 0) {
      server.env = environment;
    }
    return server;
  }

  server.type = input.transport;
  if (engine === "codex") {
    delete server.type;
  }
  server.url = preserveRedactedUrl(existing.url, input.url);
  const existingHeaders = getServerHeaders(existing, engine);
  const headers = mergeSecretRecord(
    existingHeaders,
    input.headers,
    "HTTP header"
  );
  if (Object.keys(headers).length > 0) {
    server[engine === "codex" ? "http_headers" : "headers"] = headers;
  }
  return server;
}

function preserveRedactedUrl(existing: unknown, next: string): string {
  if (typeof existing !== "string") {
    return next;
  }

  return redactUrl(existing) === next ? existing : next;
}

function getServerHeaders(
  server: JsonRecord,
  engine: McpConnectionEngine
): JsonRecord {
  return asRecord(engine === "codex"
    ? server.http_headers ?? server.headers
    : server.headers);
}

function mergeSecretRecord(
  existing: JsonRecord,
  next: Record<string, string | null>,
  label: string
): Record<string, string> {
  return Object.fromEntries(Object.entries(next).map(([key, value]) => {
    if (value !== null) {
      return [key, value];
    }

    const current = existing[key];
    if (typeof current !== "string") {
      throw new ValidationError(
        `The ${label} ${key} has no existing value to preserve.`
      );
    }

    return [key, current];
  }));
}

function nullableStringRecord(
  value: unknown,
  label: string
): Record<string, string | null> {
  if (value === undefined) {
    return {};
  }

  if (
    !isRecord(value) ||
    Object.entries(value).some(([key, item]) =>
      !key.trim() ||
      key.length > 256 ||
      (typeof item !== "string" && item !== null) ||
      (typeof item === "string" && item.length > 20_000)
    )
  ) {
    throw new ValidationError(`${label} must be an object of strings.`);
  }

  return value as Record<string, string | null>;
}

async function atomicWriteFile(file: string, content: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temporaryFile = path.join(
    path.dirname(file),
    `.${path.basename(file)}.${process.pid}.${Date.now()}.tmp`
  );
  let mode: number | undefined;

  try {
    mode = (await stat(file)).mode;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  await writeFile(temporaryFile, content, {
    encoding: "utf8",
    ...(mode === undefined ? {} : { mode })
  });

  try {
    if (mode !== undefined) {
      await copyFile(file, `${file}.cortex-backup`);
    }
    await rename(temporaryFile, file);
  } catch (error) {
    try {
      await unlink(temporaryFile);
    } catch {
      // Best effort cleanup after a failed atomic replacement.
    }
    throw error;
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
    hasAuthentication: hasAuthenticationConfiguration(value),
    manageable: source.scope === "user" && source.source !== "shared"
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
    Object.keys(asRecord(value.http_headers)).length > 0 ||
    Object.keys(asRecord(value.env_http_headers)).length > 0 ||
    typeof value.bearer_token_env_var === "string" ||
    typeof value.oauth_client_id === "string" ||
    Object.keys(asRecord(value.oauth)).length > 0;
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
