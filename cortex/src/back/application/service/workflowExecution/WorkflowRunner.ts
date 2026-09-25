import { ValidationError } from "../../error/ValidationError.ts";
import { ExecutionSuspendedError } from "../executionControl/ExecutionControlService.ts";
import { isExecutionCancelled } from "./WorkflowExecution.ts";

type WorkflowRunnerOptions<T extends { id: string }> = {
  signal: AbortSignal;
  maxConcurrentAgents: number;
  maxExecutions: number;
  executionCount: () => number;
  isComplete: () => boolean;
  assertActive: () => void;
  readyAgents: () => T[];
  canWait: () => boolean;
  executeAgent: (agent: T) => Promise<unknown>;
};

/** Advance independent branches immediately; drain started work before releasing a failed run. */
export async function runWorkflowBranches<T extends { id: string }>(options: WorkflowRunnerOptions<T>) {
  const active = new Map<string, Promise<string>>();
  const failures: unknown[] = [];
  const executedAgentIds: string[] = [];
  try {
    while (active.size || !options.isComplete()) {
      options.signal.throwIfAborted();
      if (failures.length) throw failures[0];
      options.assertActive();
      const remaining = options.maxExecutions - options.executionCount();
      const ready = options.readyAgents().filter(agent => !active.has(agent.id))
        .slice(0, Math.max(0, Math.min(options.maxConcurrentAgents - active.size, remaining)));
      for (const agent of ready) {
        executedAgentIds.push(agent.id);
        const execution = (async () => {
          options.signal.throwIfAborted();
          await options.executeAgent(agent);
        })().then(() => agent.id, (reason: unknown) => { failures.push(reason); return agent.id; });
        active.set(agent.id, execution);
      }
      if (!active.size) {
        if (options.executionCount() >= options.maxExecutions) {
          throw new ExecutionSuspendedError("The workflow reached its execution limit. Check the cycle exit conditions.");
        }
        if (options.canWait()) return { status: "waiting" as const, executedAgentIds };
        throw new ValidationError("The workflow cannot continue: no agent has completed prerequisites.");
      }
      active.delete(await Promise.race(active.values()));
      if (failures.length) throw failures[0];
    }
    options.signal.throwIfAborted();
    return { status: "completed" as const, executedAgentIds };
  } catch (error) {
    await Promise.all(active.values());
    throw options.signal.aborted ? options.signal.reason : error;
  }
}

/** A pause or exhausted budget is resumable; an explicit abort is cancelled. */
export function workflowFailureStatus(error: unknown, interruptedByShutdown: boolean): "interrupted" | "cancelled" | "failed" {
  return interruptedByShutdown || error instanceof ExecutionSuspendedError
    ? "interrupted" : isExecutionCancelled(error) ? "cancelled" : "failed";
}
