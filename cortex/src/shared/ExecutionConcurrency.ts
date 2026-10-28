export interface ExecutionConcurrencySettings { allowParallelExecutions: boolean }
export const DEFAULT_EXECUTION_CONCURRENCY: ExecutionConcurrencySettings = { allowParallelExecutions: false };
export type CortexExecutionSource = "normal" | "work-force" | "work-light" | "prompt" | "internal";
export interface CortexExecutionEntry {
  id: string;
  source: CortexExecutionSource;
  label: string;
  key?: string;
  projectId?: string;
  queuedAt: string;
  startedAt?: string;
}
export interface CortexExecutionQueueStatus {
  settings: ExecutionConcurrencySettings;
  active: CortexExecutionEntry[];
  waiting: CortexExecutionEntry[];
}
