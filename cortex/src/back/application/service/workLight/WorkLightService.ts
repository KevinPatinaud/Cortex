import { DEFAULT_WORK_FORCE_SETTINGS, workForceAgentKey, type WorkForceExecution, type WorkForceSettings } from "../../../../shared/WorkForce.ts";
import type { WorkLightConfiguration, WorkLightOverview, WorkLightRuntime, WorkLightStatus } from "../../../../shared/WorkLight.ts";
import type { CodexQuotaStatus } from "../../../../shared/CodexQuota.ts";
import { JsonConfigurationRepository } from "../configuration/JsonConfigurationRepository.ts";
import { ValidationError } from "../../error/ValidationError.ts";
import { ExecutionWorkspaceBusyError } from "../executionWorkspace/ExecutionWorkspaceGuard.ts";
import { ExecutionSlotUnavailableError } from "../executionQueue/GlobalExecutionQueue.ts";
import { CodexQuotaBlockedError } from "../../error/CodexQuotaBlockedError.ts";
import { quotaDenial } from "../iaService/CodexQuotaService.ts";
import { cronMatchesDate, getNextCronOccurrence, normalizeCronExpression, normalizeScheduleTimezone, serverTimezone } from "../workflowScheduler/CronExpression.ts";
import { validateConfiguration as validateAgents, validateSettings } from "../workForce/WorkForceService.ts";
import type { WorkForceAgents, WorkForceRunner } from "../workForce/WorkForceService.ts";

interface Stored { configuration: WorkLightConfiguration; settings: WorkForceSettings; runtime: WorkLightRuntime }
const emptyRuntime = (): WorkLightRuntime => ({ armed: false, phase: "stopped", cursor: 0, completedCycles: 0,
  lastEvaluatedMinute: -1, reason: null, active: null, history: [], occurrences: [] });

/** One durable claim per absolute UTC minute. Missed minutes are never replayed.
 * A claim precedes any effects; an unfinished execution pauses after restart. */
export class WorkLightService {
  private readonly repository: JsonConfigurationRepository;
  private state: Stored = { configuration: { agents: [], crons: ["0 12,20 * * *"], timezone: "Europe/Paris" },
    settings: { ...DEFAULT_WORK_FORCE_SETTINGS }, runtime: emptyRuntime() };
  private initialized: Promise<void> | null = null;
  private commands: Promise<unknown> = Promise.resolve();
  private timer: NodeJS.Timeout | null = null;
  private inFlight: Promise<void> | null = null;
  private runner: WorkForceRunner | null = null;
  private shuttingDown = false;
  private previewCache: { key: string; runs: string[] } | null = null;
  private quotaStatus: CodexQuotaStatus | null = null;

  constructor(configurationFile: string, private readonly agents: WorkForceAgents,
    private readonly quota: { getStatus(): Promise<CodexQuotaStatus> },
    private readonly now: () => number = Date.now, private readonly pollMs = 1000) {
    this.repository = new JsonConfigurationRepository(configurationFile);
  }
  private minute(): number { return Math.floor(this.now() / 60_000); }
  private initialize(): Promise<void> {
    this.initialized ??= (async () => {
      const stored = (await this.repository.read()).workLight as Stored | undefined;
      if (stored) this.state = { configuration: validateConfiguration(stored.configuration),
        settings: validateSettings(stored.settings), runtime: { ...emptyRuntime(), ...stored.runtime } };
      const runtime = this.state.runtime;
      // A process coming online partway through a minute must not replay its slot.
      runtime.lastEvaluatedMinute = Math.max(runtime.lastEvaluatedMinute, this.minute());
      if (runtime.active) {
        runtime.history = [{ ...runtime.active, finishedAt: new Date(this.now()).toISOString(), outcome: "interrupted",
          error: "Le serveur a été arrêté pendant cet agent. Vérifiez son résultat avant de reprendre." } satisfies WorkForceExecution, ...runtime.history].slice(0, 20);
        Object.assign(runtime, { armed: false, phase: "interrupted", active: null, reason: runtime.history[0].error });
      }
      if (stored) await this.persist();
    })();
    return this.initialized;
  }
  private persist(): Promise<void> {
    const snapshot = structuredClone(this.state);
    return this.repository.update(stored => ({ ...stored, workLight: snapshot }));
  }
  private command<T>(action: () => Promise<T>): Promise<T> {
    const next = this.commands.then(action, action); this.commands = next.catch(() => {}); return next;
  }
  isActive(): boolean { return this.state.runtime.armed || Boolean(this.state.runtime.active); }
  async status(): Promise<WorkLightStatus> {
    await this.initialize(); return { active: this.isActive(), armed: this.state.runtime.armed, phase: this.state.runtime.phase };
  }
  async overview(): Promise<WorkLightOverview> {
    await this.initialize();
    const after = Math.max(this.minute(), this.state.runtime.lastEvaluatedMinute), { crons, timezone } = this.state.configuration;
    const key = JSON.stringify([crons, timezone, after]);
    if (this.previewCache?.key !== key) this.previewCache = { key, runs: nextRuns(crons, timezone, new Date(after * 60_000)) };
    return structuredClone({ ...this.state, quotaStatus: this.quotaStatus, nextRuns: this.previewCache.runs });
  }
  catalog() { return this.agents.catalog(); }
  preview(input: unknown) {
    const value = object(input), cron = normalizeCronExpression(value.cron), timezone = normalizeScheduleTimezone(value.timezone);
    return { cron, timezone, now: new Date(this.now()).toISOString(), serverTimezone: serverTimezone(), nextRuns: nextRuns([cron], timezone, new Date(this.now())) };
  }
  saveConfiguration(input: unknown): Promise<WorkLightOverview> {
    return this.command(async () => {
      await this.initialize();
      if (this.isActive() || this.inFlight) throw new ValidationError("Arrêtez Work Light avant de modifier sa liste ou ses créneaux.");
      const configuration = validateConfiguration(input);
      const catalog = await this.catalog(), keys = new Set(catalog.agents.map(workForceAgentKey));
      if (configuration.agents.some(ref => !keys.has(workForceAgentKey(ref)))) throw new ValidationError("Un agent sélectionné n’existe plus. Actualisez la liste.");
      // Reordering or changing the schedule preserves the next agent when it remains selected.
      const next = this.state.configuration.agents[this.state.runtime.cursor];
      const index = next ? configuration.agents.findIndex(ref => workForceAgentKey(ref) === workForceAgentKey(next)) : -1;
      this.state.configuration = configuration;
      this.state.runtime.cursor = Math.max(0, index);
      await this.persist(); return this.overview();
    });
  }
  saveSettings(input: unknown): Promise<WorkLightOverview> {
    return this.command(async () => { await this.initialize(); this.state.settings = validateSettings(input);
      await this.persist(); return this.overview(); });
  }
  arm(): Promise<WorkLightOverview> {
    return this.command(async () => {
      await this.initialize();
      return this.repository.runExclusive(async () => {
        if (this.state.runtime.armed) return this.overview();
        const force = (await this.repository.read()).workForce as { runtime?: { armed?: boolean; active?: unknown } } | undefined;
        if (force?.runtime?.armed || force?.runtime?.active) throw new ValidationError("Arrêtez Work Force avant d’activer Work Light.");
        if (this.shuttingDown || this.inFlight) throw new ValidationError("Un agent est encore en cours de terminaison.");
        if (!this.state.configuration.agents.length) throw new ValidationError("Sélectionnez au moins un agent.");
        const previous = structuredClone(this.state.runtime);
        Object.assign(this.state.runtime, { armed: true, phase: "scheduled", reason: null,
          lastEvaluatedMinute: Math.max(this.state.runtime.lastEvaluatedMinute, this.minute()) });
        try { await this.persist(); } catch (error) { this.state.runtime = previous; throw error; } return this.overview();
      });
    });
  }
  disarm(): Promise<WorkLightOverview> {
    return this.command(async () => {
      await this.initialize(); Object.assign(this.state.runtime, { armed: false,
        phase: this.state.runtime.active ? "stopping" : "stopped", reason: null });
      if (!this.state.runtime.active) this.runner?.cancel();
      await this.persist(); return this.overview();
    });
  }
  async start(): Promise<void> {
    await this.initialize();
    if (this.timer || this.shuttingDown) return;
    this.timer = setInterval(() => { void this.tick().catch(error => console.error("Work Light:", error)); }, this.pollMs);
    this.timer.unref();
  }
  async stop(): Promise<void> {
    this.shuttingDown = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null; this.runner?.cancel();
    await this.commands; await this.inFlight;
  }
  async tick(): Promise<void> {
    let launched: Promise<void> | null = null;
    await this.command(async () => {
      await this.initialize();
      const runtime = this.state.runtime, minute = this.minute();
      if (this.shuttingDown || !runtime.armed || minute <= runtime.lastEvaluatedMinute) return;
      const matches = this.state.configuration.crons.some(cron => cronMatchesDate(cron, new Date(minute * 60_000), this.state.configuration.timezone));
      runtime.lastEvaluatedMinute = minute;
      if (!matches) return;
      if (this.inFlight) { this.occurrence(minute, "skipped", "Créneau ignoré : l’agent Work Light précédent est encore en cours."); await this.persist(); return; }
      this.occurrence(minute, "skipped", "Créneau réservé. Aucun rattrapage après redémarrage.");
      await this.persist(); // Never run an agent if the claim could not be written.
      this.inFlight = this.execute(minute).finally(() => { this.inFlight = null; this.runner = null; });
      launched = this.inFlight;
    });
    await launched;
  }
  private occurrence(minute: number, outcome: "started" | "skipped", reason: string | null): void {
    const at = new Date(minute * 60_000).toISOString(), runtime = this.state.runtime;
    runtime.occurrences = [{ at, outcome, reason }, ...runtime.occurrences.filter(item => item.at !== at)].slice(0, 40);
    if (!runtime.active) runtime.reason = reason;
  }
  private async execute(minute: number): Promise<void> {
    const runtime = this.state.runtime;
    const assertSlot = () => {
      if (this.shuttingDown || !runtime.armed || this.minute() !== minute)
        throw new ExecutionSlotUnavailableError("Créneau ignoré : lancement arrêté ou créneau dépassé.");
    };
    try {
      assertSlot();
      const { agent, runner } = await this.agents.prepare(this.state.configuration.agents[runtime.cursor]);
      this.runner = runner; assertSlot();
      await runner.run({ waitForSlot: false,
        beforeStart: async () => {
          assertSlot();
          try { this.quotaStatus = await this.quota.getStatus(); }
          catch { this.quotaStatus = { available: false, checkedAt: new Date(this.now()).toISOString(), fiveHour: null, weekly: null, error: "Quotas Codex indisponibles." }; }
          assertSlot();
          const reason = quotaDenial({ enabled: true, ...this.state.settings }, this.quotaStatus);
          if (reason) throw new CodexQuotaBlockedError(reason);
        },
        onStarted: async () => {
          assertSlot();
          runtime.active = { agent, startedAt: new Date(this.now()).toISOString(), finishedAt: null, outcome: "running", error: null, answer: null };
          runtime.phase = "running"; runtime.reason = null;
          this.occurrence(minute, "started", null); await this.persist();
        }
      }).then(result => {
        runtime.active!.answer = result.answer;
        if (result.waiting) throw new Error("Cet agent attend un événement externe. Consultez son résultat avant de reprendre Work Light.");
      });
      runtime.history = [{ ...runtime.active!, finishedAt: new Date(this.now()).toISOString(), outcome: "succeeded" } satisfies WorkForceExecution, ...runtime.history].slice(0, 20);
      runtime.active = null;
      runtime.cursor = (runtime.cursor + 1) % this.state.configuration.agents.length;
      if (!runtime.cursor) runtime.completedCycles++;
      runtime.phase = runtime.armed ? "scheduled" : "stopped";
      runtime.reason = null;
      await this.persist();
    } catch (error) {
      const reason = error instanceof Error ? error.message : "L’exécution de Work Light a échoué.";
      if (!runtime.active && (error instanceof CodexQuotaBlockedError || error instanceof ExecutionSlotUnavailableError || error instanceof ExecutionWorkspaceBusyError)) {
        this.occurrence(minute, "skipped", reason);
        runtime.phase = runtime.armed ? "scheduled" : "stopped";
      } else {
        if (runtime.active) runtime.history = [{ ...runtime.active, finishedAt: new Date(this.now()).toISOString(),
          outcome: this.shuttingDown ? "interrupted" : "failed", error: reason } satisfies WorkForceExecution, ...runtime.history].slice(0, 20);
        Object.assign(runtime, { active: null, armed: false, phase: this.shuttingDown ? "interrupted" : "failed", reason });
      }
      await this.persist();
    }
  }
}
function object(input: unknown): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input)) throw new ValidationError("Configuration Work Light invalide.");
  return input as Record<string, unknown>;
}
export function validateConfiguration(input: unknown): WorkLightConfiguration {
  const value = object(input), agents = validateAgents({ agents: value.agents }).agents;
  if (!Array.isArray(value.crons) || !value.crons.length || value.crons.length > 30) throw new ValidationError("Indiquez entre 1 et 30 créneaux cron.");
  const crons = [...new Set(value.crons.map(normalizeCronExpression))], timezone = normalizeScheduleTimezone(value.timezone);
  nextRuns(crons, timezone, new Date(), 1); // Reject impossible dates before arming.
  return { agents, crons, timezone };
}
function nextRuns(crons: string[], timezone: string, after: Date, count = 5): string[] {
  const runs: string[] = [];
  let candidates = crons.map(cron => getNextCronOccurrence(cron, after, timezone).getTime());
  for (let i = 0; i < count; i++) {
    const next = Math.min(...candidates); runs.push(new Date(next).toISOString());
    if (i + 1 < count) candidates = candidates.map((candidate, index) => candidate === next ? getNextCronOccurrence(crons[index], new Date(next), timezone).getTime() : candidate);
  }
  return runs;
}
