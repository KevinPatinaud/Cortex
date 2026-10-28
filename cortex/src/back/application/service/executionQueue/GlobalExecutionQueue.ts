import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { DEFAULT_EXECUTION_CONCURRENCY, type CortexExecutionEntry, type CortexExecutionQueueStatus,
  type CortexExecutionSource, type ExecutionConcurrencySettings } from "../../../../shared/ExecutionConcurrency.ts";
import { JsonConfigurationRepository } from "../configuration/JsonConfigurationRepository.ts";
import { ValidationError } from "../../error/ValidationError.ts";

export class ExecutionSlotUnavailableError extends Error {}
export class ExecutionDeferredError extends Error {}
export interface ExecutionAdmission {
  source: CortexExecutionSource;
  label: string;
  key?: string;
  projectId?: string;
  signal?: AbortSignal;
  onQueued?: () => void;
  /** Refuse atomically when a reservation cannot start immediately. */
  waitForSlot?: boolean;
}
interface Lease { entry: CortexExecutionEntry; active: boolean; parallel: boolean }
interface Pending {
  entry: CortexExecutionEntry;
  signal?: AbortSignal;
  resolve(lease: Lease): void;
  reject(reason: unknown): void;
  cancel(): void;
}

/** One queue per Cortex process. Logical agent runs keep their reservation
 * through mission, interpretation and final checks. Provider calls inside that
 * reservation are reentrant; unrelated jobs always obtain their own turn. */
export class GlobalExecutionQueue {
  private readonly repository: JsonConfigurationRepository;
  private settings = { ...DEFAULT_EXECUTION_CONCURRENCY };
  private initialized: Promise<void> | null = null;
  private readonly context = new AsyncLocalStorage<Lease>();
  private readonly active = new Set<Lease>();
  private readonly waiting: Pending[] = [];
  private closed = false;
  private admissionGuard?: (entry: CortexExecutionEntry) => void;

  constructor(configurationFile: string) { this.repository = new JsonConfigurationRepository(configurationFile); }
  private initialize(): Promise<void> {
    this.initialized ??= (async () => {
      const stored = (await this.repository.read()).executionConcurrency;
      if (stored !== undefined) this.settings = validateSettings(stored);
    })();
    return this.initialized;
  }
  async status(): Promise<CortexExecutionQueueStatus> {
    await this.initialize();
    return structuredClone({ settings: this.settings,
      active: [...this.active].map(lease => lease.entry), waiting: this.waiting.map(item => item.entry) });
  }
  async saveSettings(input: unknown): Promise<CortexExecutionQueueStatus> {
    await this.initialize();
    const settings = validateSettings(input);
    await this.repository.update(stored => ({ ...stored, executionConcurrency: settings }));
    this.settings = settings;
    this.drain();
    return this.status();
  }
  allowsParallelExecutions(): boolean {
    const inherited = this.context.getStore();
    return inherited?.active ? inherited.parallel : this.settings.allowParallelExecutions;
  }
  isInsideExecution(): boolean { return this.context.getStore()?.active === true; }
  hasExecutions(): boolean { return this.active.size > 0 || this.waiting.length > 0; }
  setAdmissionGuard(guard: (entry: CortexExecutionEntry) => void): void { this.admissionGuard = guard; }

  async run<T>(options: ExecutionAdmission, operation: () => Promise<T>): Promise<T> {
    const parent = this.context.getStore();
    if (parent?.active && (!options.key || options.key === parent.entry.key)) {
      options.signal?.throwIfAborted();
      return operation();
    }
    await this.initialize();
    if (this.closed) throw new DOMException("Cortex s’arrête.", "AbortError");
    options.signal?.throwIfAborted();
    const entry: CortexExecutionEntry = { id: randomUUID(), source: options.source, label: options.label,
      ...(options.key ? { key: options.key } : {}), ...(options.projectId ? { projectId: options.projectId } : {}), queuedAt: new Date().toISOString() };
    this.admissionGuard?.(entry);
    if (options.waitForSlot === false && (this.waiting.length > 0 ||
      (!this.settings.allowParallelExecutions && this.active.size > 0) ||
      (entry.key && [...this.active].some(lease => lease.entry.key === entry.key))))
      throw new ExecutionSlotUnavailableError("Créneau ignoré : la file globale de Cortex est occupée.");
    const lease = await new Promise<Lease>((resolve, reject) => {
      const pending: Pending = { entry, signal: options.signal, resolve, reject, cancel: () => {
        const index = this.waiting.indexOf(pending);
        if (index < 0) return;
        this.waiting.splice(index, 1);
        pending.signal?.removeEventListener("abort", pending.cancel);
        reject(pending.signal?.reason ?? new DOMException("Exécution annulée.", "AbortError"));
        this.drain();
      } };
      this.waiting.push(pending);
      options.signal?.addEventListener("abort", pending.cancel, { once: true });
      try { options.onQueued?.(); } catch (error) {
        this.waiting.splice(this.waiting.indexOf(pending), 1);
        options.signal?.removeEventListener("abort", pending.cancel);
        reject(error); return;
      }
      this.drain();
    });
    try {
      options.signal?.throwIfAborted();
      this.admissionGuard?.(lease.entry);
      return await this.context.run(lease, operation);
    } finally {
      lease.active = false;
      this.active.delete(lease);
      this.drain();
    }
  }
  private drain(): void {
    if (this.closed) return;
    for (let index = 0; index < this.waiting.length;) {
      if (!this.settings.allowParallelExecutions && this.active.size > 0) break;
      const pending = this.waiting[index];
      if (pending.signal?.aborted) { pending.cancel(); continue; }
      if (pending.entry.key && [...this.active].some(lease => lease.entry.key === pending.entry.key)) { index++; continue; }
      this.waiting.splice(index, 1);
      pending.signal?.removeEventListener("abort", pending.cancel);
      const lease: Lease = { entry: { ...pending.entry, startedAt: new Date().toISOString() }, active: true,
        parallel: this.settings.allowParallelExecutions };
      this.active.add(lease);
      pending.resolve(lease);
    }
  }
  stop(): void {
    this.closed = true;
    for (const item of this.waiting.splice(0)) {
      item.signal?.removeEventListener("abort", item.cancel);
      item.reject(new DOMException("Cortex s’arrête.", "AbortError"));
    }
  }
}
function validateSettings(input: unknown): ExecutionConcurrencySettings {
  if (!input || typeof input !== "object" || Array.isArray(input) || typeof (input as ExecutionConcurrencySettings).allowParallelExecutions !== "boolean")
    throw new ValidationError("Indiquez si les exécutions simultanées sont autorisées.");
  return { allowParallelExecutions: (input as ExecutionConcurrencySettings).allowParallelExecutions };
}
