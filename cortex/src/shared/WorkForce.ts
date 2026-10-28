import type { CodexQuotaStatus } from "./CodexQuota.ts";

export interface WorkForceAgentRef { projectId: string; agentId: string }
export interface WorkForceAgent extends WorkForceAgentRef {
  projectName: string;
  name: string;
  description: string;
}
export interface WorkForceSettings {
  minimumFiveHourRemainingPercent: number;
  minimumWeeklyRemainingPercent: number;
}
export const DEFAULT_WORK_FORCE_SETTINGS: WorkForceSettings = {
  minimumFiveHourRemainingPercent: 30,
  minimumWeeklyRemainingPercent: 8
};
export const WORK_FORCE_QUOTA_RETRY_MS = 5 * 60 * 1000;
export const WORK_FORCE_NORMAL_SUSPENDED_REASON = "Work Force est actif. Les agents du mode normal sont suspendus jusqu’à son arrêt.";
export interface WorkForceConfiguration {
  agents: WorkForceAgentRef[];
  startsAt: string | null;
  endsAt: string | null;
}
export type WorkForcePhase = "stopped" | "scheduled" | "queued" | "running" | "waiting_quota" | "waiting_agent" | "stopping" | "failed" | "interrupted";
export interface WorkForceExecution {
  agent: WorkForceAgent;
  startedAt: string;
  finishedAt: string | null;
  outcome: "running" | "succeeded" | "failed" | "interrupted";
  error: string | null;
  answer: string | null;
}
export interface WorkForceRuntime {
  armed: boolean;
  phase: WorkForcePhase;
  cursor: number;
  completedCycles: number;
  nextCheckAt: string | null;
  reason: string | null;
  active: WorkForceExecution | null;
  history: WorkForceExecution[];
}
export interface WorkForceOverview {
  configuration: WorkForceConfiguration;
  settings: WorkForceSettings;
  runtime: WorkForceRuntime;
  quotaStatus: CodexQuotaStatus | null;
}
export interface WorkForceStatus {
  active: boolean;
  armed: boolean;
  phase: WorkForcePhase;
}
export interface WorkForceCatalog { agents: WorkForceAgent[]; errors: string[] }
export function workForceAgentKey(agent: WorkForceAgentRef): string {
  return JSON.stringify([agent.projectId, agent.agentId]);
}
