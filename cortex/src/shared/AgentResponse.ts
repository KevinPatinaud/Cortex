export type AgentResponseStatus = "success" | "partial" | "blocked" | "error";

export interface AgentResponsePayload {
  status: AgentResponseStatus;
  items: Array<{ content: string }>;
  isMultiSelectionAllowed: boolean | null;
  notes: string | null;
}

export function parseAgentResponse(
  content: string
): AgentResponsePayload | null {
  try {
    const parsedContent: unknown = JSON.parse(content);

    if (
      !isRecord(parsedContent) ||
      !isAgentResponseStatus(parsedContent.status) ||
      !Array.isArray(parsedContent.items) ||
      !parsedContent.items.every(
        (item) => isRecord(item) && typeof item.content === "string"
      ) ||
      !(
        typeof parsedContent.isMultiSelectionAllowed === "boolean" ||
        parsedContent.isMultiSelectionAllowed === null
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
      items: parsedContent.items as Array<{ content: string }>,
      isMultiSelectionAllowed: parsedContent.isMultiSelectionAllowed,
      notes: parsedContent.notes
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
    value === "partial" ||
    value === "blocked" ||
    value === "error";
}
