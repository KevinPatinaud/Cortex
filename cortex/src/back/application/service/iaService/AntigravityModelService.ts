import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { CodexModel, CodexModelCatalog } from "../../../../shared/CodexModel.ts";
import { resolveAgyBinary } from "./providers/GeminiAgentProvider.ts";

const EFFORT_ORDER = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"] as const;
const EFFORT_INDEX = new Map<string, number>(EFFORT_ORDER.map((effort, index) => [effort, index]));
const ID_EFFORT_PATTERN = /^(.+)-(none|minimal|low|medium|high|xhigh|max|ultra)$/i;
const DISPLAY_EFFORT_PATTERN = /^(.+?)\s*\((none|minimal|low|medium|high|xhigh|very high|extra high|max|maximum|ultra)\)$/i;
const MODEL_ID_PATTERN = /^[A-Za-z0-9._:/-]+$/;
const MAX_OUTPUT_BYTES = 1024 * 1024;
const UNAVAILABLE_MESSAGE = "Impossible de lire les modèles Antigravity sur le serveur. Vérifiez la connexion et la version d’Antigravity CLI, puis actualisez la liste.";

interface FamilyAccumulator {
  model: string;
  displayName: string;
  effortModels: Record<string, string>;
  firstEffort: string | null;
}

export class AntigravityModelService {
  private readonly pending = new Map<string, Promise<CodexModelCatalog>>();

  constructor(
    private readonly workingDirectory: string,
    private readonly read: (directory: string) => Promise<CodexModelCatalog> = directory => runAntigravityModelsCli(directory)
  ) {}

  async getCatalog(directory = this.workingDirectory): Promise<CodexModelCatalog> {
    let request = this.pending.get(directory);
    if (!request) {
      request = this.read(directory).catch(() => unavailableAntigravityCatalog());
      this.pending.set(directory, request);
    }
    try { return await request; }
    finally { if (this.pending.get(directory) === request) this.pending.delete(directory); }
  }
}

export function unavailableAntigravityCatalog(): CodexModelCatalog {
  return {
    available: false,
    cliVersion: null,
    defaultModel: null,
    models: [],
    checkedAt: new Date().toISOString(),
    error: UNAVAILABLE_MESSAGE,
    sources: [{
      engine: "gemini",
      label: "Antigravity",
      available: false,
      cliVersion: null,
      defaultModel: null,
      error: UNAVAILABLE_MESSAGE
    }]
  };
}

export function parseAntigravityModelOutput(
  stdout: string,
  options: { cliVersion?: string | null; configuredModel?: string | null } = {}
): CodexModelCatalog {
  const families = new Map<string, FamilyAccumulator>();
  const rawLookup = new Map<string, { familyId: string; effort: string | null }>();
  const seenRawIds = new Set<string>();

  for (const rawLine of stdout.split(/\r?\n/)) {
    const parsed = parseModelLine(rawLine);
    if (!parsed || seenRawIds.has(parsed.id)) continue;
    seenRawIds.add(parsed.id);

    const idMatch = parsed.id.match(ID_EFFORT_PATTERN);
    const nameMatch = parsed.displayName.match(DISPLAY_EFFORT_PATTERN);
    const familyId = idMatch ? idMatch[1] : parsed.id;
    const effort = idMatch ? idMatch[2].toLowerCase() : null;
    const familyDisplayName = idMatch && nameMatch ? nameMatch[1].trim() : parsed.displayName;

    let entry = families.get(familyId);
    if (!entry) {
      entry = {
        model: familyId,
        displayName: familyDisplayName,
        effortModels: {},
        firstEffort: effort
      };
      families.set(familyId, entry);
    } else if (!idMatch && parsed.displayName) {
      entry.displayName = parsed.displayName;
    }

    if (effort && !entry.effortModels[effort]) {
      entry.effortModels[effort] = parsed.id;
    }

    rawLookup.set(parsed.id.toLowerCase(), { familyId, effort });
    rawLookup.set(parsed.displayName.toLowerCase(), { familyId, effort });
  }

  if (!families.size) {
    throw new Error("Antigravity returned no selectable models.");
  }

  const models: CodexModel[] = [...families.values()].map(entry => {
    const efforts = Object.keys(entry.effortModels).sort((a, b) => {
      const aIndex = EFFORT_INDEX.get(a) ?? Number.MAX_SAFE_INTEGER;
      const bIndex = EFFORT_INDEX.get(b) ?? Number.MAX_SAFE_INTEGER;
      return aIndex - bIndex;
    });
    const defaultReasoningEffort = efforts.length === 0
      ? null
      : efforts.includes("medium")
        ? "medium"
        : efforts.includes("high")
          ? "high"
          : entry.firstEffort ?? efforts[0];
    return {
      model: entry.model,
      displayName: entry.displayName,
      reasoningEfforts: efforts,
      defaultReasoningEffort,
      isDefault: false,
      engine: "gemini" as const,
      ...(efforts.length ? { effortModels: entry.effortModels } : {})
    };
  });

  const configured = options.configuredModel?.trim();
  let defaultModel: string | null = null;
  let configuredReasoningEffort: string | null = null;

  if (configured) {
    const lower = configured.toLowerCase();
    const rawMatch = rawLookup.get(lower);
    if (rawMatch) {
      defaultModel = rawMatch.familyId;
      configuredReasoningEffort = rawMatch.effort;
    } else {
      const familyMatch = models.find(candidate =>
        candidate.model.toLowerCase() === lower || candidate.displayName.toLowerCase() === lower
      );
      if (familyMatch) defaultModel = familyMatch.model;
    }
  }

  defaultModel ??= models[0].model;
  for (const candidate of models) {
    candidate.isDefault = candidate.model === defaultModel;
  }

  const cliVersion = options.cliVersion?.trim() || null;
  return {
    available: true,
    cliVersion,
    defaultModel,
    configuredReasoningEffort,
    models,
    checkedAt: new Date().toISOString(),
    error: null,
    sources: [{
      engine: "gemini",
      label: "Antigravity",
      available: true,
      cliVersion,
      defaultModel,
      error: null
    }]
  };
}

export async function readAntigravitySettingsModel(
  settingsPath = path.join(os.homedir(), ".gemini", "antigravity-cli", "settings.json")
): Promise<string | null> {
  try {
    const parsed = JSON.parse(await readFile(settingsPath, "utf8")) as Record<string, unknown>;
    return typeof parsed?.model === "string" && parsed.model.trim() ? parsed.model.trim() : null;
  } catch {
    return null;
  }
}

export async function runAntigravityModelsCli(
  workingDirectory: string,
  binary: string | { command: string; args?: string[] } = resolveAgyBinary(),
  timeoutMs = 15_000,
  settingsPath?: string
): Promise<CodexModelCatalog> {
  const command = typeof binary === "string" ? binary : binary.command;
  const baseArgs = typeof binary === "string" ? [] : (binary.args ?? []);
  const [modelsOutput, versionOutput, configuredModel] = await Promise.all([
    execCliStdout(command, [...baseArgs, "models"], workingDirectory, timeoutMs),
    execCliStdout(command, [...baseArgs, "--version"], workingDirectory, Math.min(timeoutMs, 5_000)).catch(() => ""),
    readAntigravitySettingsModel(settingsPath)
  ]);
  const versionMatch = versionOutput.trim().match(/\d+\.\d+[^\s]*/);
  const cliVersion = versionMatch ? versionMatch[0] : (versionOutput.trim() || null);
  return parseAntigravityModelOutput(modelsOutput, { cliVersion, configuredModel });
}

function parseModelLine(rawLine: string): { id: string; displayName: string } | null {
  const line = rawLine.trim();
  if (!line || /^(fetching\b|usage:|error:|flags:|available\b)/i.test(line)) return null;

  const tabIndex = line.indexOf("\t");
  if (tabIndex > 0) {
    const id = line.slice(0, tabIndex).trim();
    const displayName = line.slice(tabIndex + 1).trim();
    if (!MODEL_ID_PATTERN.test(id)) return null;
    return { id, displayName: displayName || id };
  }

  const spaced = line.match(/^([A-Za-z0-9._:/-]+)\s{2,}(.+)$/);
  if (spaced) {
    return { id: spaced[1], displayName: spaced[2].trim() || spaced[1] };
  }

  if (MODEL_ID_PATTERN.test(line)) {
    return { id: line, displayName: line };
  }

  return null;
}

function execCliStdout(
  command: string,
  args: string[],
  workingDirectory: string,
  timeoutMs: number
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: workingDirectory,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    let stdout = "";
    let totalBytes = 0;
    let settled = false;

    const finish = (error: Error | null, output?: string) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) {
        child.kill();
        reject(error);
      } else {
        resolve(output ?? "");
      }
    };

    const timer = setTimeout(() => finish(new Error("Antigravity CLI timed out.")), timeoutMs);
    timer.unref();
    // Drain stderr without retaining or exposing tokens, paths, or diagnostics.
    child.stderr.resume();
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (text: string) => {
      totalBytes += Buffer.byteLength(text, "utf8");
      if (totalBytes > MAX_OUTPUT_BYTES) {
        finish(new Error("Antigravity CLI output exceeded size limit."));
        return;
      }
      stdout += text;
    });
    child.once("error", () => finish(new Error("Antigravity CLI is unavailable.")));
    child.once("close", (code) => {
      if (code === 0) finish(null, stdout);
      else finish(new Error(`Antigravity CLI exited with code ${code ?? "unknown"}.`));
    });
  });
}
