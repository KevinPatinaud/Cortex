import type { WorkForceAgentRef, WorkForceExecution, WorkForceSettings, WorkForceStatus } from "./WorkForce.ts";
import type { CodexQuotaStatus } from "./CodexQuota.ts";

export interface WorkLightConfiguration { agents: WorkForceAgentRef[]; crons: string[]; timezone: string }
export type WorkLightPhase = "stopped" | "scheduled" | "running" | "stopping" | "failed" | "interrupted";
export interface WorkLightOccurrence { at: string; outcome: "started" | "skipped"; reason: string | null }
export interface WorkLightRuntime {
  armed: boolean;
  phase: WorkLightPhase;
  cursor: number;
  completedCycles: number;
  lastEvaluatedMinute: number;
  reason: string | null;
  active: WorkForceExecution | null;
  history: WorkForceExecution[];
  occurrences: WorkLightOccurrence[];
}
export interface WorkLightOverview {
  configuration: WorkLightConfiguration;
  settings: WorkForceSettings;
  runtime: WorkLightRuntime;
  quotaStatus: CodexQuotaStatus | null;
  nextRuns: string[];
}
export type WorkLightStatus = Omit<WorkForceStatus, "phase"> & { phase: WorkLightPhase };
export const WORK_LIGHT_NORMAL_SUSPENDED_REASON = "Work Light est actif. Les agents du mode normal sont suspendus jusqu’à son arrêt.";
