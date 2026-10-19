import type { CodexQuotaConfiguration, CodexQuotaStatus } from "../../shared/CodexQuota.ts";
import { requestJson } from "./apiClient.ts";

export function getCodexQuotaConfiguration(): Promise<CodexQuotaConfiguration> {
  return requestJson("/api/agents/codex-quota");
}

export function saveCodexQuotaConfiguration(configuration: CodexQuotaConfiguration): Promise<CodexQuotaConfiguration> {
  return requestJson("/api/agents/codex-quota", {
    method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(configuration)
  });
}

export function getCodexQuotaStatus(): Promise<CodexQuotaStatus> {
  return requestJson("/api/agents/codex-quota/status");
}
