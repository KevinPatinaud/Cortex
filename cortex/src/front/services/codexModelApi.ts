import type { CodexModelCatalog } from "../../shared/CodexModel.ts";
import { requestJson } from "./apiClient.ts";

export function getCodexModelCatalog(projectId: string): Promise<CodexModelCatalog> {
  return requestJson(`/api/agents/codex-models?${new URLSearchParams({ projectId })}`);
}
