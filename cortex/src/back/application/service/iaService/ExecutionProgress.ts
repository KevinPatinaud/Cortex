import { boundedExecutionTrace, type ExecutionTraceInput } from "../../../../shared/ExecutionTrace.ts";
import { codexTokenUsage, claudeTokenUsage, type TokenUsage } from "../../../../shared/TokenUsage.ts";
type TraceReporter = (entry: ExecutionTraceInput) => void;

/** Keep live previews bounded; the journal is retained separately. */
export function createTextProgress(onProgress?: (text: string) => void) {
  let preview = "";
  return (chunk: string): void => {
    preview = (preview + chunk).slice(-4_000);
    onProgress?.(preview);
  };
}

/** Codex emits newline-delimited events, sometimes split across stdout chunks. */
export function createCodexProgress(onProgress?: (text: string) => void, onSessionId?: (sessionId: string) => void, onTrace?: TraceReporter, onUsage?: (usage: TokenUsage) => void) {
  let pending = "";
  return (chunk: string): void => {
    pending += chunk;
    let newline: number;
    while ((newline = pending.indexOf("\n")) !== -1) {
      const line = pending.slice(0, newline);
      pending = pending.slice(newline + 1);
      try {
        const event = JSON.parse(line);
        if (event.type === "turn.completed" || event.type === "turn.failed") {
          const usage = codexTokenUsage(event.usage);
          if (usage) onUsage?.(usage);
        }
        const sessionId = event.thread_id ?? event.session_id;
        if (typeof sessionId === "string" && sessionId.trim()) onSessionId?.(sessionId);
        const text = event.item?.type === "agent_message"
          ? event.item.text ?? event.item.content
          : "";
        onProgress?.(typeof text === "string" ? text.slice(-4_000) : "");
        if (onTrace && event.type === "item.completed" && typeof text === "string" && text) {
          onTrace(boundedExecutionTrace({ kind: "message", content: text }));
        } else if (onTrace && ["item.started", "item.completed"].includes(event.type) &&
          ["command_execution", "file_change", "web_search", "mcp_tool_call", "collab_tool_call"].includes(event.item?.type)) {
          const item = event.item;
          const content = item.type === "command_execution"
            ? `$ ${item.command ?? ""}\n${item.status ?? event.type}${item.exit_code != null ? ` (exit ${item.exit_code})` : ""}${item.aggregated_output ? `\n${item.aggregated_output}` : ""}`
            : `${item.type} · ${item.status ?? event.type}\n${JSON.stringify(item, null, 2)}`;
          onTrace(boundedExecutionTrace({ kind: "tool", content }));
        } else if (onTrace && ["error", "turn.failed"].includes(event.type)) {
          const content = typeof event.error === "string" ? event.error : event.error?.message ?? event.message;
          if (typeof content === "string") onTrace(boundedExecutionTrace({ kind: "status", content }));
        }
      } catch { /* CLI diagnostics are not response text. */ }
    }
    // The CLI runner caps total stdout at 10 MiB. A single tool event can
    // exceed 1 MiB across chunks; let it finish before bounding its journal entry.
    if (pending.length > 10 * 1024 * 1024) pending = "";
  };
}

export function createClaudeProgress(onProgress?: (text: string) => void, onTrace?: TraceReporter, onUsage?: (usage: TokenUsage) => void) {
  let pending = "";
  let lastMessage = "";
  const reportText = createTextProgress(onProgress);
  return (chunk: string): void => {
    pending += chunk;
    let newline: number;
    while ((newline = pending.indexOf("\n")) !== -1) {
      const line = pending.slice(0, newline);
      pending = pending.slice(newline + 1);
      try {
        const message = JSON.parse(line);
        if (message.type === "result") {
          const usage = claudeTokenUsage(message.usage);
          if (usage) onUsage?.(usage);
        }
        if (onTrace && ["assistant", "user"].includes(message.type)) {
          for (const block of message.message?.content ?? []) {
            if (block.type === "text" && message.type === "assistant" && typeof block.text === "string") {
              lastMessage = block.text;
              onTrace(boundedExecutionTrace({ kind: "message", content: block.text }));
            } else if (block.type === "tool_use") {
              onTrace(boundedExecutionTrace({ kind: "tool", content: `${block.name}\n${JSON.stringify(block.input, null, 2)}` }));
            } else if (block.type === "tool_result") {
              const content = typeof block.content === "string" ? block.content : (block.content ?? [])
                .filter((part: { type: string }) => part.type === "text").map((part: { text: string }) => part.text).join("\n");
              onTrace(boundedExecutionTrace({ kind: "tool", content: `${block.tool_use_id}${block.is_error ? " · error" : ""}\n${content}` }));
            }
          }
        }
        if (message.type === "stream_event" && message.event?.delta?.type === "text_delta") {
          reportText(String(message.event.delta.text ?? ""));
        } else if (message.type === "result" && typeof message.result === "string") {
          onProgress?.(message.result.slice(-4_000));
          if (message.result !== lastMessage) onTrace?.(boundedExecutionTrace({ kind: "message", content: message.result }));
        } else {
          onProgress?.("");
        }
      } catch { /* Ignore diagnostics mixed into the event stream. */ }
    }
    if (pending.length > 10 * 1024 * 1024) pending = "";
  };
}
