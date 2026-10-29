/** Public engine messages and tool activity; never private reasoning events. */
export interface ExecutionTraceInput {
  kind: "message" | "tool" | "status";
  content: string;
  phase?: "mission" | "interpretation";
  truncated?: boolean;
}

export interface ExecutionTraceEntry extends ExecutionTraceInput {
  id: number;
  occurredAt: string;
}

export interface ExecutionTracePage {
  items: ExecutionTraceEntry[];
  nextAfterId: number | null;
}

/** Bound individual tool output without silently shortening the live journal. */
export function boundedExecutionTrace(entry: ExecutionTraceInput): ExecutionTraceInput {
  const limit = 64_000;
  return entry.content.length > limit
    ? { ...entry, content: entry.content.slice(0, limit), truncated: true }
    : entry;
}
