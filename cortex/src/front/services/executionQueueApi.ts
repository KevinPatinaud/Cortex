import type { CortexExecutionQueueStatus, ExecutionConcurrencySettings } from "../../shared/ExecutionConcurrency.ts";
import { requestJson } from "./apiClient.ts";
export const getExecutionQueue = () => requestJson<CortexExecutionQueueStatus>("/api/execution-queue");
export const saveExecutionConcurrency = (settings: ExecutionConcurrencySettings) => requestJson<CortexExecutionQueueStatus>("/api/execution-queue/settings", {
  method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(settings)
});
