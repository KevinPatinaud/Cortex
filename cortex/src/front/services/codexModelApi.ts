import type { CodexModelCatalog, ModelCatalogEngine } from "../../shared/CodexModel.ts";
import { requestJson } from "./apiClient.ts";

export function getCodexModelCatalog(
  projectId: string,
  engine?: ModelCatalogEngine
): Promise<CodexModelCatalog> {
  const params = new URLSearchParams({ projectId });
  if (engine && engine !== "codex") params.set("engine", engine);
  return requestJson(`/api/agents/codex-models?${params}`);
}
