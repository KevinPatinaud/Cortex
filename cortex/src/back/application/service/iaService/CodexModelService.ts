import type { CodexModel, CodexModelCatalog } from "../../../../shared/CodexModel.ts";
import { withCodexAppServer, type CodexAppServerSession } from "./CodexAppServer.ts";

export class CodexModelService {
  private readonly pending = new Map<string, Promise<CodexModelCatalog>>();

  constructor(private readonly workingDirectory: string,
    private readonly read: (directory: string) => Promise<CodexModelCatalog> = directory => withCodexAppServer(directory, async session => {
      const catalog = await readCodexModelCatalog(session);
      try {
        const result = record(await session.request("skills/list", { cwds: [directory], forceReload: false }));
        if (Array.isArray(result.data)) catalog.availableSkills = [...new Set(result.data.flatMap(entry => {
          const skills = record(entry).skills;
          return Array.isArray(skills) ? skills.flatMap(value => {
            const skill = record(value), name = string(skill.name);
            return name && skill.enabled !== false ? [name] : [];
          }) : [];
        }))].sort();
      } catch { /* Discovery is optional on older CLIs; absence is not proof that tools are unavailable. */ }
      return catalog;
    })) {}

  async getCatalog(directory = this.workingDirectory): Promise<CodexModelCatalog> {
    let request = this.pending.get(directory);
    if (!request) {
      request = this.read(directory).catch(() => ({
        available: false, cliVersion: null, defaultModel: null, models: [], checkedAt: new Date().toISOString(),
        error: "Impossible de lire les modèles du Codex installé sur le serveur. Vérifiez sa connexion et sa version, puis actualisez la liste."
      }));
      this.pending.set(directory, request);
    }
    try { return await request; }
    finally { if (this.pending.get(directory) === request) this.pending.delete(directory); }
  }
}

export async function readCodexModelCatalog(session: CodexAppServerSession): Promise<CodexModelCatalog> {
  const models = new Map<string, CodexModel>();
  const cursors = new Set<string>();
  let cursor: string | undefined;
  for (let page = 0; ; page++) {
    if (page >= 20) throw new Error("Codex model catalog exceeded the page limit.");
    const result = record(await session.request("model/list", { limit: 100, includeHidden: false, ...(cursor ? { cursor } : {}) }));
    if (!Array.isArray(result.data)) throw new Error("Invalid Codex model catalog.");
    for (const entry of result.data) {
      const value = record(entry);
      const model = string(value.model);
      if (!model || value.hidden === true || models.has(model)) continue;
      const reasoningEfforts = Array.isArray(value.supportedReasoningEfforts)
        ? [...new Set(value.supportedReasoningEfforts.map(item => string(record(item).reasoningEffort)).filter((effort): effort is string => Boolean(effort)))] : [];
      models.set(model, { model, displayName: string(value.displayName) ?? model, reasoningEfforts,
        defaultReasoningEffort: string(value.defaultReasoningEffort), isDefault: value.isDefault === true });
    }
    if (result.nextCursor == null) break;
    if (typeof result.nextCursor !== "string" || !result.nextCursor || cursors.has(result.nextCursor)) throw new Error("Invalid Codex model cursor.");
    cursor = result.nextCursor;
    cursors.add(cursor);
  }
  if (!models.size) throw new Error("Codex returned no selectable models.");
  // The configured default can differ from the catalog's recommended default.
  let configuredModel: string | null = null;
  let configuredReasoningEffort: string | null = null;
  let declaredMcpServers: string[] | undefined;
  let declaredApps: string[] | undefined;
  try {
    const configuration = record(record(await session.request("config/read", { includeLayers: false })).config);
    configuredModel = string(configuration.model);
    configuredReasoningEffort = string(configuration.model_reasoning_effort);
    declaredMcpServers = Object.keys(record(configuration.mcp_servers));
    declaredApps = Object.keys(record(configuration.apps)).filter(key => key !== "_default");
  }
  catch { /* Older CLIs can still expose their picker catalog without config/read. */ }
  const initialization = record(session.initialization);
  const cliVersion = string(record(initialization.serverInfo).version) ?? string(initialization.userAgent)?.match(/^[^/]+\/(\d[^\s]*)/)?.[1] ?? null;
  return { available: true, cliVersion, configuredReasoningEffort, declaredMcpServers, declaredApps,
    defaultModel: configuredModel ?? [...models.values()].find(model => model.isDefault)?.model ?? null,
    models: [...models.values()], checkedAt: new Date().toISOString(), error: null };
}

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
function string(value: unknown): string | null { return typeof value === "string" && value.trim() ? value.trim() : null; }
