import { isWorkflowWaitRequest, type WorkflowWaitRequest } from "./WorkflowWait.ts";
import { parseWorkflowDispatchItem } from "./WorkflowAutomation.ts";
export type AgentResponseStatus = "success" | "partial" | "blocked" | "error" | "waiting";

export interface AgentResponsePayload {
  status: AgentResponseStatus;
  items: Array<{ content: string }>;
  isMultiSelectionAllowed: boolean | null;
  isMultiSelectionThreaded: boolean | null;
  /** null identifies a response created before conditional routing was added. */
  nextAgentIds: string[] | null;
  notes: string | null;
  wait?: WorkflowWaitRequest | null;
}

export function parseAgentResponse(
  content: string
): AgentResponsePayload | null {
  try {
    const parsedContent: unknown = JSON.parse(content);

    if (
      !isRecord(parsedContent) ||
      !isAgentResponseStatus(parsedContent.status) ||
      (parsedContent.wait !== undefined && parsedContent.wait !== null && !isWorkflowWaitRequest(parsedContent.wait)) ||
      (parsedContent.status === "waiting" && (!isWorkflowWaitRequest(parsedContent.wait) || !Array.isArray(parsedContent.nextAgentIds) || parsedContent.nextAgentIds.length > 0)) ||
      (parsedContent.status !== "waiting" && parsedContent.wait != null) ||
      !Array.isArray(parsedContent.items) ||
      !parsedContent.items.every(
        (item) => isRecord(item) && (
          typeof item.content === "string" || isRecord(item.content)
        )
      ) ||
      !(
        typeof parsedContent.isMultiSelectionAllowed === "boolean" ||
        parsedContent.isMultiSelectionAllowed === null
      ) ||
      !(
        typeof parsedContent.isMultiSelectionThreaded === "boolean" ||
        parsedContent.isMultiSelectionThreaded === null
      ) ||
      !(
        parsedContent.nextAgentIds === undefined ||
        (
          Array.isArray(parsedContent.nextAgentIds) &&
          parsedContent.nextAgentIds.every(
            (agentId) => typeof agentId === "string"
          ) &&
          new Set(parsedContent.nextAgentIds).size ===
            parsedContent.nextAgentIds.length
        )
      ) ||
      !(
        typeof parsedContent.notes === "string" ||
        parsedContent.notes === null
      )
    ) {
      return null;
    }

    return {
      status: parsedContent.status,
      // Native structured output avoids manually escaping dossier JSON inside
      // a string. Keep the existing conversation and handoff contract intact.
      items: parsedContent.items.map((item) => ({ content: typeof item.content === "string"
        ? item.content
        : JSON.stringify(parseWorkflowDispatchItem(JSON.stringify(item.content))) })),
      isMultiSelectionAllowed: parsedContent.isMultiSelectionAllowed,
      isMultiSelectionThreaded: parsedContent.isMultiSelectionThreaded,
      nextAgentIds: parsedContent.nextAgentIds === undefined
        ? null
        : parsedContent.nextAgentIds as string[],
      notes: parsedContent.notes,
      ...(parsedContent.wait !== undefined ? { wait: parsedContent.wait as WorkflowWaitRequest | null } : {})
    };
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAgentResponseStatus(value: unknown): value is AgentResponseStatus {
  return value === "success" ||
    value === "waiting" ||
    value === "partial" ||
    value === "blocked" ||
    value === "error";
}
