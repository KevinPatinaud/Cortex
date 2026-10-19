import {
  DEFAULT_CODEX_QUOTA_CONFIGURATION,
  type CodexQuotaConfiguration, type CodexQuotaStatus, type CodexQuotaWindow
} from "../../../../shared/CodexQuota.ts";
import { CodexQuotaBlockedError } from "../../error/CodexQuotaBlockedError.ts";
import { ValidationError } from "../../error/ValidationError.ts";
import { JsonConfigurationRepository } from "../configuration/JsonConfigurationRepository.ts";
import { readCodexRateLimits } from "./CodexRateLimits.ts";

export class CodexQuotaService {
  private readonly repository: JsonConfigurationRepository;
  private pending: Promise<CodexQuotaStatus> | null = null;
  private deniedStatus: CodexQuotaStatus | null = null;

  constructor(
    configurationFile: string,
    private readonly readLimits: () => Promise<unknown> = () => readCodexRateLimits(process.cwd()),
    private readonly now: () => number = Date.now
  ) {
    this.repository = new JsonConfigurationRepository(configurationFile);
  }

  async getConfiguration(): Promise<CodexQuotaConfiguration> {
    const stored = (await this.repository.read()).codexQuota;
    return stored === undefined ? { ...DEFAULT_CODEX_QUOTA_CONFIGURATION } : validateConfiguration(stored);
  }

  async saveConfiguration(input: unknown): Promise<CodexQuotaConfiguration> {
    const configuration = validateConfiguration(input);
    await this.repository.update((stored) => ({ ...stored, codexQuota: configuration }));
    this.deniedStatus = null;
    return configuration;
  }

  async getStatus(): Promise<CodexQuotaStatus> {
    this.pending ??= this.readStatus();
    try { return await this.pending; }
    finally { this.pending = null; }
  }

  private async readStatus(): Promise<CodexQuotaStatus> {
    let status: CodexQuotaStatus;
    try { status = parseCodexQuota(await this.readLimits(), this.now()); }
    catch {
      status = { available: false, checkedAt: new Date(this.now()).toISOString(),
        fiveHour: null, weekly: null,
        error: "Quotas Codex indisponibles. Vérifiez la connexion Codex et la version du CLI sur le serveur Cortex." };
    }
    this.deniedStatus = null;
    return status;
  }

  async assertMayStart(): Promise<void> {
    const configuration = await this.getConfiguration();
    if (!configuration.enabled) return;
    // Reuse only refused readings to throttle retries. Every allowed launch uses a fresh read.
    let status = this.deniedStatus;
    if (!status || this.now() - Date.parse(status.checkedAt) >= 60_000 ||
      [status.fiveHour, status.weekly].some((window) => window?.resetsAt != null && window.resetsAt * 1000 <= this.now())) {
      status = await this.getStatus();
    } else if (!quotaDenial(configuration, status)) {
      status = await this.getStatus();
    }
    const reason = quotaDenial(configuration, status);
    if (reason) {
      this.deniedStatus = status;
      throw new CodexQuotaBlockedError(reason);
    }
  }
}

function validateConfiguration(input: unknown): CodexQuotaConfiguration {
  const value = record(input);
  const percentage = (field: string) => typeof value[field] === "number" &&
    Number.isFinite(value[field]) && value[field] >= 0 && value[field] <= 100;
  if (typeof value.enabled !== "boolean" || !percentage("minimumFiveHourRemainingPercent") || !percentage("minimumWeeklyRemainingPercent")) {
    throw new ValidationError("L’option de quota doit être activée ou désactivée et les seuils doivent être des nombres entre 0 et 100 %.");
  }
  return { enabled: value.enabled,
    minimumFiveHourRemainingPercent: value.minimumFiveHourRemainingPercent as number,
    minimumWeeklyRemainingPercent: value.minimumWeeklyRemainingPercent as number };
}

export function parseCodexQuota(input: unknown, now = Date.now()): CodexQuotaStatus {
  const result = record(input);
  const buckets = record(result.rateLimitsByLimitId);
  const bucket = record(result.rateLimitsByLimitId != null ? buckets.codex : result.rateLimits);
  const windows = bucket.limitId == null || bucket.limitId === "codex"
    ? [record(bucket.primary), record(bucket.secondary)] : [];
  const readWindow = (duration: number): CodexQuotaWindow | null => {
    const window = windows.find((value) => value.windowDurationMins === duration);
    if (!window || typeof window.usedPercent !== "number" || !Number.isFinite(window.usedPercent) ||
      window.usedPercent < 0 || window.usedPercent > 100) return null;
    if (window.resetsAt != null && (typeof window.resetsAt !== "number" || !Number.isFinite(window.resetsAt) || window.resetsAt * 1000 <= now)) return null;
    return { remainingPercent: 100 - window.usedPercent, resetsAt: typeof window.resetsAt === "number" ? window.resetsAt : null };
  };
  const fiveHour = readWindow(300), weekly = readWindow(10_080);
  return { available: fiveHour !== null && weekly !== null, checkedAt: new Date(now).toISOString(), fiveHour, weekly,
    error: fiveHour && weekly ? null : "Les deux quotas Codex (5 h et semaine) n’ont pas pu être vérifiés." };
}

function quotaDenial(configuration: CodexQuotaConfiguration, status: CodexQuotaStatus): string | null {
  if (!status.available || !status.fiveHour || !status.weekly) return `Lancement bloqué : ${status.error}`;
  const missing: string[] = [];
  if (status.fiveHour.remainingPercent < configuration.minimumFiveHourRemainingPercent) {
    missing.push(`5 h : ${format(status.fiveHour.remainingPercent)} % restants, minimum ${configuration.minimumFiveHourRemainingPercent} %`);
  }
  if (status.weekly.remainingPercent < configuration.minimumWeeklyRemainingPercent) {
    missing.push(`semaine : ${format(status.weekly.remainingPercent)} % restants, minimum ${configuration.minimumWeeklyRemainingPercent} %`);
  }
  return missing.length ? `Lancement bloqué par les quotas Codex (${missing.join(" ; ")}).` : null;
}

function format(value: number): string { return Number(value.toFixed(2)).toString(); }
function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
