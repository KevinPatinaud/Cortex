export interface CodexQuotaConfiguration {
  enabled: boolean;
  minimumFiveHourRemainingPercent: number;
  minimumWeeklyRemainingPercent: number;
}

export const DEFAULT_CODEX_QUOTA_CONFIGURATION: CodexQuotaConfiguration = {
  enabled: false,
  minimumFiveHourRemainingPercent: 50,
  minimumWeeklyRemainingPercent: 10
};

export interface CodexQuotaWindow {
  remainingPercent: number;
  resetsAt: number | null;
}

export interface CodexQuotaStatus {
  available: boolean;
  checkedAt: string;
  fiveHour: CodexQuotaWindow | null;
  weekly: CodexQuotaWindow | null;
  error: string | null;
}
