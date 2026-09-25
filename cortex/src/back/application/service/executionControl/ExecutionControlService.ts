import { ValidationError } from "../../error/ValidationError.ts";
import { DEFAULT_EXECUTION_POLICY, type ProjectExecutionControl, type ProjectExecutionPolicy, type ProjectExecutionUsage, type TokenUsage } from "../../../../shared/ExecutionControl.ts";
import { WorkflowExecutionPool } from "../workflowExecution/WorkflowExecution.ts";

export interface ExecutionCallContext {
  projectId?: string;
  instanceId?: string;
  relatedProjectId?: string;
}

export interface ExecutionControlRepository {
  policy(projectId: string): ProjectExecutionPolicy;
  savePolicy(projectId: string, policy: ProjectExecutionPolicy): void;
  usage(projectId: string, day: string): ProjectExecutionUsage;
  instanceCalls(instanceId: string): number;
  begin(context: ExecutionCallContext, engine: string, now: string): string;
  finish(id: string, usage: TokenUsage | undefined, failed: boolean): void;
}

export class ExecutionSuspendedError extends ValidationError {}

/** One process-wide gateway; checks are repeated after queueing, immediately before a call. */
export class ExecutionControlService {
  private readonly pool: WorkflowExecutionPool;
  constructor(private readonly repository: ExecutionControlRepository,
    readonly maxConcurrentCalls = 4, private readonly now: () => Date = () => new Date()) {
    this.pool = new WorkflowExecutionPool(maxConcurrentCalls);
  }

  isPaused(projectId: string): boolean { return this.repository.policy(projectId).paused; }

  assertActive(context: ExecutionCallContext): void {
    for (const id of new Set([context.projectId, context.relatedProjectId].filter((id): id is string => !!id))) {
      if (this.isPaused(id)) throw new ExecutionSuspendedError("Ce projet est en pause. Les appels déjà commencés peuvent terminer ; aucun nouvel appel ne sera lancé.");
    }
  }

  status(projectId: string): ProjectExecutionControl {
    return { policy: this.repository.policy(projectId), usage: this.repository.usage(projectId, this.now().toISOString().slice(0, 10)),
      server: { activeCalls: this.pool.activeCount, queuedCalls: this.pool.queuedCount, maxConcurrentCalls: this.maxConcurrentCalls } };
  }

  update(projectId: string, input: unknown): ProjectExecutionControl {
    if (!input || typeof input !== "object" || Array.isArray(input)) throw new ValidationError("Réglages d’exécution invalides.");
    const record = input as Record<string, unknown>;
    if (Object.keys(record).some(key => !Object.hasOwn(DEFAULT_EXECUTION_POLICY, key))) throw new ValidationError("Réglage d’exécution inconnu.");
    const policy = { ...this.repository.policy(projectId) };
    if (record.paused !== undefined) {
      if (typeof record.paused !== "boolean") throw new ValidationError("L’état de pause doit être un booléen.");
      policy.paused = record.paused;
    }
    for (const key of ["maxCallsPerDay", "maxTokensPerDay", "maxCallsPerRun"] as const) {
      if (record[key] === undefined) continue;
      if (record[key] !== null && (!Number.isSafeInteger(record[key]) || Number(record[key]) < 1)) throw new ValidationError("Chaque plafond doit être un entier positif, ou vide pour ne pas fixer de plafond.");
      policy[key] = record[key] as number | null;
    }
    this.repository.savePolicy(projectId, policy);
    return this.status(projectId);
  }

  async execute<T extends { usage?: TokenUsage }>(context: ExecutionCallContext, engine: string,
    signal: AbortSignal, operation: () => Promise<T>, beforeStart?: () => void): Promise<T> {
    this.assertActive(context);
    return this.pool.execute(signal, async () => {
      this.assertActive(context);
      for (const id of new Set([context.projectId, context.relatedProjectId].filter((id): id is string => !!id))) {
        const { policy, usage } = this.status(id);
        if (policy.maxCallsPerDay !== null && usage.calls >= policy.maxCallsPerDay) throw new ExecutionSuspendedError("Le plafond quotidien d’appels IA de ce projet est atteint (journée UTC).");
        if (policy.maxTokensPerDay !== null) {
          // A token budget cannot be enforced if an earlier call has no measurement.
          if (usage.measuredCalls < usage.calls - usage.activeCalls) throw new ExecutionSuspendedError("Consommation inconnue : le plafond de tokens ne peut pas être vérifié. Retirez ce plafond ou utilisez un moteur qui fournit sa consommation.");
          if (usage.inputTokens + usage.outputTokens >= policy.maxTokensPerDay) throw new ExecutionSuspendedError("Le plafond quotidien de tokens observés de ce projet est atteint (journée UTC).");
        }
        if (context.instanceId && policy.maxCallsPerRun !== null && this.repository.instanceCalls(context.instanceId) >= policy.maxCallsPerRun) throw new ExecutionSuspendedError("Le plafond d’appels de cette exécution est atteint. Augmentez-le avant de reprendre.");
      }
      signal.throwIfAborted();
      beforeStart?.();
      const callId = this.repository.begin(context, engine, this.now().toISOString());
      try {
        const result = await operation();
        this.repository.finish(callId, result.usage, false);
        return result;
      } catch (error) {
        this.repository.finish(callId, undefined, true);
        throw error;
      }
    });
  }
}
