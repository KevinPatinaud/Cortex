import type { CodexEngineUpdateStatus } from "../../shared/CodexEngineUpdate.ts";
import { requestJson } from "./apiClient.ts";

export const checkCodexEngineUpdate = (): Promise<CodexEngineUpdateStatus> => requestJson("/api/codex-engine/check", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: "{}"
});
