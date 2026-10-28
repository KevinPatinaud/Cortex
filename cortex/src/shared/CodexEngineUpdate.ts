export interface CodexEngineUpdateStatus {
  state: "idle" | "checking" | "installing" | "waiting" | "updated" | "up_to_date" | "error";
  installedVersion: string | null;
  latestVersion: string | null;
  checkedAt: string | null;
  updatedAt: string | null;
  error: string | null;
}
