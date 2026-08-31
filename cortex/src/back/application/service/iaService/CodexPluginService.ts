import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { ValidationError } from "../../error/ValidationError.ts";
import type {
  CodexPluginAuthPolicy,
  CodexPluginCatalog,
  CodexPluginSummary
} from "../../../../shared/CodexPlugin.ts";

const COMMAND_TIMEOUT_MS = 120_000;
const PLUGIN_SELECTOR_PATTERN = /^[a-z0-9][a-z0-9._-]{0,127}@[a-z0-9][a-z0-9._-]{0,127}$/;

type CodexCommandRunner = (args: string[]) => Promise<string>;

export class CodexPluginService {
  private mutationQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly runCommand: CodexCommandRunner = createCodexCommandRunner()
  ) {}

  async getCatalog(): Promise<CodexPluginCatalog> {
    try {
      const output = await this.runCommand([
        "plugin",
        "list",
        "--available",
        "--json"
      ]);

      return {
        available: true,
        plugins: parsePluginCatalog(output),
        error: null
      };
    } catch (error) {
      return {
        available: false,
        plugins: [],
        error: getCommandErrorMessage(
          error,
          "Codex CLI is unavailable or does not support plugins."
        )
      };
    }
  }

  install(pluginId: string): Promise<CodexPluginCatalog> {
    const normalizedPluginId = normalizePluginId(pluginId);

    return this.enqueueMutation(async () => {
      await this.runCommand([
        "plugin",
        "add",
        normalizedPluginId,
        "--json"
      ]);
      return this.requireCatalog();
    });
  }

  remove(pluginId: string): Promise<CodexPluginCatalog> {
    const normalizedPluginId = normalizePluginId(pluginId);

    return this.enqueueMutation(async () => {
      await this.runCommand([
        "plugin",
        "remove",
        normalizedPluginId,
        "--json"
      ]);
      return this.requireCatalog();
    });
  }

  private enqueueMutation(
    operation: () => Promise<CodexPluginCatalog>
  ): Promise<CodexPluginCatalog> {
    const result = this.mutationQueue.then(operation, operation);
    this.mutationQueue = result.then(() => undefined, () => undefined);
    return result;
  }

  private async requireCatalog(): Promise<CodexPluginCatalog> {
    const catalog = await this.getCatalog();

    if (!catalog.available) {
      throw new Error(catalog.error ?? "Unable to reload Codex plugins.");
    }

    return catalog;
  }
}

function createCodexCommandRunner(): CodexCommandRunner {
  const npmCodexScript = process.env.APPDATA
    ? path.join(
        process.env.APPDATA,
        "npm",
        "node_modules",
        "@openai",
        "codex",
        "bin",
        "codex.js"
      )
    : "";
  const command = process.platform === "win32" &&
    npmCodexScript &&
    existsSync(npmCodexScript)
    ? process.execPath
    : "codex";
  const argumentPrefix = command === process.execPath
    ? [npmCodexScript]
    : [];

  return (args) => new Promise((resolve, reject) => {
    const child = execFile(command, [...argumentPrefix, ...args], {
      encoding: "utf8",
      maxBuffer: 10 * 1024 * 1024,
      timeout: COMMAND_TIMEOUT_MS,
      windowsHide: true
    }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(
          stderr.trim() || stdout.trim() || error.message,
          { cause: error }
        ));
        return;
      }

      resolve(stdout.trim());
    });

    child.stdin?.end();
  });
}

export function parsePluginCatalog(output: string): CodexPluginSummary[] {
  let parsed: unknown;

  try {
    parsed = JSON.parse(output);
  } catch {
    throw new Error("Codex returned an invalid plugin catalog.");
  }

  const catalog = asRecord(parsed);
  const installed = readPluginArray(catalog.installed, true);
  const available = readPluginArray(catalog.available, false);
  const plugins = new Map<string, CodexPluginSummary>();

  for (const plugin of [...available, ...installed]) {
    plugins.set(plugin.id, plugin);
  }

  return [...plugins.values()].sort(comparePlugins);
}

function readPluginArray(
  value: unknown,
  installedFallback: boolean
): CodexPluginSummary[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.flatMap((entry) => {
    const plugin = asRecord(entry);
    const id = readString(plugin.pluginId);
    const name = readString(plugin.name);
    const marketplace = readString(plugin.marketplaceName);

    if (!id || !name || !marketplace || !PLUGIN_SELECTOR_PATTERN.test(id)) {
      return [];
    }

    return [{
      id,
      name,
      marketplace,
      version: readString(plugin.version),
      installed: typeof plugin.installed === "boolean"
        ? plugin.installed
        : installedFallback,
      enabled: typeof plugin.enabled === "boolean"
        ? plugin.enabled
        : installedFallback,
      authPolicy: readAuthPolicy(plugin.authPolicy),
      installPolicy: readString(plugin.installPolicy)
    }];
  });
}

function normalizePluginId(value: unknown): string {
  if (typeof value !== "string") {
    throw new ValidationError("The Codex plugin identifier is required.");
  }

  const pluginId = value.trim().toLowerCase();

  if (!PLUGIN_SELECTOR_PATTERN.test(pluginId)) {
    throw new ValidationError("The Codex plugin identifier is invalid.");
  }

  return pluginId;
}

function readAuthPolicy(value: unknown): CodexPluginAuthPolicy | null {
  return value === "ON_INSTALL" || value === "ON_USE" || value === "NONE"
    ? value
    : null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function comparePlugins(
  first: CodexPluginSummary,
  second: CodexPluginSummary
): number {
  if (first.installed !== second.installed) {
    return first.installed ? -1 : 1;
  }

  return first.name.localeCompare(second.name);
}

function getCommandErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message.trim()
    ? error.message.trim()
    : fallback;
}
