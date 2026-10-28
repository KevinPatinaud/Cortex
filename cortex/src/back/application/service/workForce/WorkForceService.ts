import { DEFAULT_WORK_FORCE_SETTINGS, WORK_FORCE_QUOTA_RETRY_MS, workForceAgentKey,
  type WorkForceAgent, type WorkForceAgentRef, type WorkForceCatalog, type WorkForceConfiguration,
  type WorkForceExecution, type WorkForceOverview, type WorkForceRuntime, type WorkForceSettings, type WorkForceStatus } from "../../../../shared/WorkForce.ts";
import type { CodexQuotaStatus } from "../../../../shared/CodexQuota.ts";
import { ValidationError } from "../../error/ValidationError.ts";
import { ExecutionWorkspaceBusyError } from "../executionWorkspace/ExecutionWorkspaceGuard.ts";
import { JsonConfigurationRepository } from "../configuration/JsonConfigurationRepository.ts";
import { quotaDenial } from "../iaService/CodexQuotaService.ts";
import { CodexQuotaBlockedError } from "../../error/CodexQuotaBlockedError.ts";
import type { AgentStartControl } from "../../usecase/AgentUseCase.ts";

export interface WorkForceRunner {
  run(control: AgentStartControl): Promise<{ answer: string; waiting: boolean }>;
  cancel(): void;
}
export interface WorkForceAgents {
  catalog(): Promise<WorkForceCatalog>;
  prepare(ref: WorkForceAgentRef): Promise<{ agent: WorkForceAgent; runner: WorkForceRunner }>;
}
interface StoredWorkForce {
  configuration: WorkForceConfiguration;
  settings: WorkForceSettings;
  runtime: WorkForceRuntime;
}
const emptyRuntime = (): WorkForceRuntime => ({ armed: false, phase: "stopped", cursor: 0,
  completedCycles: 0, nextCheckAt: null, reason: null, active: null, history: [] });

/** The persisted cursor advances only after completion. One in-flight promise
 * covers preparation, quota reading and execution, including manual commands. */
export class WorkForceService {
  private readonly repository: JsonConfigurationRepository;
  private state: StoredWorkForce = { configuration: { agents: [], startsAt: null, endsAt: null },
    settings: { ...DEFAULT_WORK_FORCE_SETTINGS }, runtime: emptyRuntime() };
  private initialized: Promise<void> | null = null;
  private timer: NodeJS.Timeout | null = null;
  private inFlight: Promise<void> | null = null;
  private runner: WorkForceRunner | null = null;
  private shuttingDown = false;
  private quotaStatus: CodexQuotaStatus | null = null;
  private commands: Promise<unknown> = Promise.resolve();

  constructor(configurationFile: string, private readonly agents: WorkForceAgents,
    private readonly quota: { getStatus(): Promise<CodexQuotaStatus> },
    private readonly now: () => number = Date.now, private readonly pollMs = 1000) {
    this.repository = new JsonConfigurationRepository(configurationFile);
  }

  private initialize(): Promise<void> {
    this.initialized ??= (async () => {
      const stored = (await this.repository.read()).workForce as StoredWorkForce | undefined;
      if (!stored) return;
      this.state = { configuration: validateConfiguration(stored.configuration),
        settings: validateSettings(stored.settings), runtime: { ...emptyRuntime(), ...stored.runtime } };
      if (this.state.runtime.active) {
        const interrupted = { ...this.state.runtime.active, finishedAt: new Date(this.now()).toISOString(),
          outcome: "interrupted" as const, error: "Le serveur a été arrêté pendant cet agent. Vérifiez son résultat avant de reprendre." };
        Object.assign(this.state.runtime, { armed: false, phase: "interrupted", active: null,
          reason: interrupted.error, nextCheckAt: null,
          history: [interrupted, ...this.state.runtime.history].slice(0, 20) });
        await this.persist();
      }
    })();
    return this.initialized;
  }
  private persist(): Promise<void> {
    const snapshot = structuredClone(this.state);
    return this.repository.update(stored => ({ ...stored, workForce: snapshot }));
  }
  private command<T>(action: () => Promise<T>): Promise<T> {
    const next = this.commands.then(action, action);
    this.commands = next.catch(() => {});
    return next;
  }
  async overview(): Promise<WorkForceOverview> {
    await this.initialize();
    return structuredClone({ ...this.state, quotaStatus: this.quotaStatus });
  }
  isActive(): boolean {
    const { configuration, runtime } = this.state;
    return Boolean(runtime.active) || (runtime.armed && !this.expired() &&
      (!configuration.startsAt || Date.parse(configuration.startsAt) <= this.now()));
  }
  async status(): Promise<WorkForceStatus> {
    await this.initialize();
    return { active: this.isActive(), armed: this.state.runtime.armed, phase: this.state.runtime.phase };
  }
  catalog(): Promise<WorkForceCatalog> { return this.agents.catalog(); }

  saveConfiguration(input: unknown): Promise<WorkForceOverview> {
    return this.command(async () => {
      await this.initialize();
      if (this.state.runtime.armed || this.inFlight) throw new ValidationError("Arrêtez Work Force avant de modifier sa liste ou ses horaires.");
      const configuration = validateConfiguration(input);
      const catalog = await this.catalog();
      const keys = new Set(catalog.agents.map(workForceAgentKey));
      if (configuration.agents.some(ref => !keys.has(workForceAgentKey(ref)))) throw new ValidationError("Un agent sélectionné n’existe plus. Actualisez la liste.");
      this.state.configuration = configuration;
      this.state.runtime = { ...emptyRuntime(), history: this.state.runtime.history };
      await this.persist();
      return this.overview();
    });
  }
  saveSettings(input: unknown): Promise<WorkForceOverview> {
    return this.command(async () => {
      await this.initialize();
      this.state.settings = validateSettings(input);
      await this.persist();
      return this.overview();
    });
  }
  arm(): Promise<WorkForceOverview> {
    return this.command(async () => {
      await this.initialize();
      const overview = await this.repository.runExclusive(async () => {
        if (this.state.runtime.armed) return this.overview();
        const light = (await this.repository.read()).workLight as { runtime?: { armed?: boolean; active?: unknown } } | undefined;
        if (light?.runtime?.armed || light?.runtime?.active) throw new ValidationError("Arrêtez Work Light avant d’activer Work Force.");
        if (this.shuttingDown || this.inFlight) throw new ValidationError("Un agent est encore en cours de terminaison.");
        if (!this.state.configuration.agents.length) throw new ValidationError("Sélectionnez au moins un agent.");
        const { startsAt, endsAt } = this.state.configuration;
        if (endsAt && Date.parse(endsAt) <= this.now()) throw new ValidationError("La fin planifiée doit être dans le futur.");
        const previous = structuredClone(this.state.runtime);
        Object.assign(this.state.runtime, { armed: true, phase: startsAt && Date.parse(startsAt) > this.now() ? "scheduled" : "running",
          nextCheckAt: null, reason: null });
        try { await this.persist(); } catch (error) { this.state.runtime = previous; throw error; }
        return this.overview();
      });
      this.kick();
      return overview;
    });
  }
  disarm(): Promise<WorkForceOverview> {
    return this.command(async () => {
      await this.initialize();
      Object.assign(this.state.runtime, { armed: false, phase: this.state.runtime.active ? "stopping" : "stopped",
        nextCheckAt: null, reason: null });
      if (!this.state.runtime.active) this.runner?.cancel();
      await this.persist();
      return this.overview();
    });
  }
  async start(): Promise<void> {
    await this.initialize();
    if (this.timer || this.shuttingDown) return;
    this.timer = setInterval(() => this.kick(), this.pollMs);
    this.timer.unref();
    this.kick();
  }
  async stop(): Promise<void> {
    this.shuttingDown = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.runner?.cancel();
    await this.inFlight;
  }
  private kick(): void {
    void this.tick().catch(error => console.error("Work Force:", error));
  }
  /** Resolves after a launch settles, while concurrent ticks only enforce the end deadline. */
  async tick(): Promise<void> {
    await this.initialize();
    if (this.shuttingDown) return;
    if (this.expired() && this.state.runtime.armed) {
      Object.assign(this.state.runtime, { armed: false, phase: this.state.runtime.active ? "stopping" : "stopped", nextCheckAt: null,
        reason: "La fin planifiée de Work Force est atteinte." });
      if (!this.state.runtime.active) this.runner?.cancel();
      await this.persist();
    }
    if (this.inFlight || !this.mayLaunch()) return;
    this.inFlight = this.executeNext();
    try { await this.inFlight; }
    finally {
      this.inFlight = null;
      this.runner = null;
      // Continue immediately after completion; a refused quota has its own deadline.
      if (!this.shuttingDown && this.mayLaunch()) setImmediate(() => this.kick());
    }
  }
  private expired(): boolean {
    return this.state.configuration.endsAt !== null && Date.parse(this.state.configuration.endsAt) <= this.now();
  }
  private mayLaunch(): boolean {
    const { configuration, runtime } = this.state;
    return runtime.armed && !this.expired() && (!configuration.startsAt || Date.parse(configuration.startsAt) <= this.now()) &&
      (!runtime.nextCheckAt || Date.parse(runtime.nextCheckAt) <= this.now());
  }
  private async executeNext(): Promise<void> {
    const runtime = this.state.runtime;
    try {
      const ref = this.state.configuration.agents[runtime.cursor];
      const { agent, runner } = await this.agents.prepare(ref);
      if (this.shuttingDown || !this.mayLaunch()) return;
      try { this.quotaStatus = await this.quota.getStatus(); }
      catch { this.quotaStatus = { available: false, checkedAt: new Date(this.now()).toISOString(), fiveHour: null, weekly: null,
        error: "Quotas Codex indisponibles. Nouvelle vérification dans cinq minutes." }; }
      if (this.shuttingDown || !this.mayLaunch()) return;
      const reason = quotaDenial({ enabled: true, ...this.state.settings }, this.quotaStatus);
      if (reason) {
        Object.assign(runtime, { phase: "waiting_quota", reason, nextCheckAt: new Date(this.now() + WORK_FORCE_QUOTA_RETRY_MS).toISOString() });
        await this.persist();
        return;
      }
      this.runner = runner;
      Object.assign(runtime, { phase: "queued", nextCheckAt: null, reason: null });
      await this.persist();
      if (this.shuttingDown || !runtime.armed || this.expired()) {
        runtime.active = null;
        if (!this.shuttingDown) Object.assign(runtime, { armed: false, phase: "stopped" });
        await this.persist();
        return;
      }
      const assertStillAllowed = () => {
        if (this.shuttingDown || !runtime.armed || this.expired()) throw new DOMException("Work Force a été arrêté avant le lancement.", "AbortError");
      };
      const result = await runner.run({
        beforeStart: async () => {
          assertStillAllowed();
          // A queue wait may be long: never launch with the earlier quota reading.
          this.quotaStatus = await this.quota.getStatus();
          assertStillAllowed();
          const denial = quotaDenial({ enabled: true, ...this.state.settings }, this.quotaStatus);
          if (denial) throw new CodexQuotaBlockedError(denial);
        },
        onStarted: async () => {
          assertStillAllowed();
          runtime.active = { agent, startedAt: new Date(this.now()).toISOString(), finishedAt: null, outcome: "running", error: null, answer: null };
          runtime.phase = "running";
          // Only a granted agent receives the durable marker for started effects.
          await this.persist();
        }
      });
      runtime.active!.answer = result.answer;
      if (result.waiting) throw new Error("Cet agent attend un événement externe. Consultez son résultat avant de reprendre Work Force.");
      runtime.history = [{ ...runtime.active!, finishedAt: new Date(this.now()).toISOString(), outcome: "succeeded",
        answer: result.answer } satisfies WorkForceExecution, ...runtime.history].slice(0, 20);
      runtime.active = null;
      runtime.cursor += 1;
      if (runtime.cursor >= this.state.configuration.agents.length) { runtime.cursor = 0; runtime.completedCycles += 1; }
      if (!runtime.armed || this.expired()) Object.assign(runtime, { armed: false, phase: "stopped", nextCheckAt: null });
      await this.persist();
    } catch (error) {
      if (!runtime.active && this.shuttingDown) {
        // A queued agent has produced no effects and can rejoin after restart.
      } else if (!runtime.active && (!runtime.armed || this.expired())) {
        Object.assign(runtime, { armed: false, phase: "stopped", nextCheckAt: null });
      } else if (error instanceof CodexQuotaBlockedError && !runtime.active) {
        Object.assign(runtime, { phase: "waiting_quota", reason: error.message, nextCheckAt: new Date(this.now() + WORK_FORCE_QUOTA_RETRY_MS).toISOString() });
      } else if (error instanceof ExecutionWorkspaceBusyError && runtime.armed && !this.shuttingDown) {
        Object.assign(runtime, { active: null, phase: "waiting_agent", reason: error.message, nextCheckAt: new Date(this.now() + 5000).toISOString() });
      } else {
        const reason = error instanceof Error ? error.message : "L’exécution de Work Force a échoué.";
        if (runtime.active) runtime.history = [{ ...runtime.active, finishedAt: new Date(this.now()).toISOString(),
          outcome: this.shuttingDown ? "interrupted" : "failed", error: reason } satisfies WorkForceExecution, ...runtime.history].slice(0, 20);
        Object.assign(runtime, { active: null, armed: false, phase: this.shuttingDown ? "interrupted" : "failed", reason, nextCheckAt: null });
      }
      await this.persist();
    }
  }
}

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new ValidationError("Configuration Work Force invalide.");
  return value as Record<string, unknown>;
}
export function validateSettings(input: unknown): WorkForceSettings {
  const value = object(input);
  for (const field of ["minimumFiveHourRemainingPercent", "minimumWeeklyRemainingPercent"]) {
    if (typeof value[field] !== "number" || !Number.isFinite(value[field]) || value[field] < 0 || value[field] > 100)
      throw new ValidationError("Les seuils Work Force doivent être compris entre 0 et 100 %.");
  }
  return { minimumFiveHourRemainingPercent: value.minimumFiveHourRemainingPercent as number,
    minimumWeeklyRemainingPercent: value.minimumWeeklyRemainingPercent as number };
}
export function validateConfiguration(input: unknown): WorkForceConfiguration {
  const value = object(input);
  if (!Array.isArray(value.agents) || value.agents.length > 500) throw new ValidationError("La liste des agents Work Force est invalide.");
  const agents = value.agents.map(item => {
    const ref = object(item);
    if (typeof ref.projectId !== "string" || !ref.projectId.trim() || typeof ref.agentId !== "string" || !ref.agentId.trim())
      throw new ValidationError("Chaque agent doit appartenir à un projet existant.");
    return { projectId: ref.projectId.trim(), agentId: ref.agentId.trim() };
  });
  if (new Set(agents.map(workForceAgentKey)).size !== agents.length) throw new ValidationError("Un agent ne peut être sélectionné qu’une seule fois.");
  const date = (field: string): string | null => {
    const raw = value[field];
    if (raw == null) return null;
    if (typeof raw !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d.*(?:Z|[+-]\d\d:\d\d)$/.test(raw) || !Number.isFinite(Date.parse(raw)))
      throw new ValidationError("Les horaires doivent être des dates valides avec leur fuseau horaire.");
    return new Date(raw).toISOString();
  };
  const startsAt = date("startsAt"), endsAt = date("endsAt");
  if (startsAt && endsAt && Date.parse(endsAt) <= Date.parse(startsAt)) throw new ValidationError("La fin doit être postérieure au début.");
  return { agents, startsAt, endsAt };
}
