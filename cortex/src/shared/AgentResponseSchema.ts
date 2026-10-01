/** The prompt and the provider must use the same wire format. */
export function createAgentResponseSchema(nextAgentIds: readonly string[], dossierOutput = false): Record<string, unknown> {
  const content = dossierOutput
    ? {
      type: "object", additionalProperties: false, required: ["key", "title", "payload"],
      properties: {
        key: { type: "string", minLength: 1, maxLength: 200 },
        title: { type: "string", minLength: 1, maxLength: 200 },
        payload: { type: "string", minLength: 1, maxLength: 32000 }
      }
    }
    : { type: "string" };
  return {
    type: "object", additionalProperties: false,
    required: ["status", "items", "isMultiSelectionAllowed", "isMultiSelectionThreaded", "nextAgentIds", "wait", "notes"],
    properties: {
      status: { type: "string", enum: ["success", "partial", "blocked", "error", "waiting"] },
      items: { type: "array", items: {
        type: "object", additionalProperties: false, required: ["content"], properties: { content }
      } },
      isMultiSelectionAllowed: { type: ["boolean", "null"], description: "Whether multiple items may be selected. Null when selection does not apply or is unknown." },
      isMultiSelectionThreaded: { type: ["boolean", "null"], description: "Whether selected items require separate next-agent instances. Null when selection does not apply or is unknown." },
      nextAgentIds: nextAgentIds.length
        ? { type: "array", items: { type: "string", enum: [...nextAgentIds] } }
        : { type: "array", maxItems: 0, items: { type: "string" } },
      wait: { type: ["object", "null"], additionalProperties: false,
        required: ["reason", "eventKey", "wakeAfterSeconds", "deadlineAt", "state"],
        properties: {
          reason: { type: "string" }, eventKey: { type: ["string", "null"] },
          wakeAfterSeconds: { type: ["integer", "null"], minimum: 1, maximum: 31536000 },
          deadlineAt: { type: "string", description: "Absolute ISO 8601 deadline with timezone." },
          state: { type: "string", maxLength: 32000, description: "Durable business context including completed actions and remaining work." }
        }
      },
      notes: { type: ["string", "null"] }
    }
  };
}
