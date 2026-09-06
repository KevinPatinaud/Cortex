/** Keep live previews bounded; the final response is retained separately. */
export function createTextProgress(onProgress?: (text: string) => void) {
  let preview = "";
  return (chunk: string): void => {
    preview = (preview + chunk).slice(-4_000);
    onProgress?.(preview);
  };
}

/** Codex emits newline-delimited events, sometimes split across stdout chunks. */
export function createCodexProgress(onProgress?: (text: string) => void) {
  let pending = "";
  return (chunk: string): void => {
    pending += chunk;
    let newline: number;
    while ((newline = pending.indexOf("\n")) !== -1) {
      const line = pending.slice(0, newline);
      pending = pending.slice(newline + 1);
      try {
        const event = JSON.parse(line);
        const text = event.item?.type === "agent_message"
          ? event.item.text ?? event.item.content
          : "";
        onProgress?.(typeof text === "string" ? text.slice(-4_000) : "");
      } catch { /* CLI diagnostics are not response text. */ }
    }
    if (pending.length > 1024 * 1024) pending = "";
  };
}

export function createClaudeProgress(onProgress?: (text: string) => void) {
  let pending = "";
  const reportText = createTextProgress(onProgress);
  return (chunk: string): void => {
    pending += chunk;
    let newline: number;
    while ((newline = pending.indexOf("\n")) !== -1) {
      const line = pending.slice(0, newline);
      pending = pending.slice(newline + 1);
      try {
        const message = JSON.parse(line);
        if (message.type === "stream_event" && message.event?.delta?.type === "text_delta") {
          reportText(String(message.event.delta.text ?? ""));
        } else if (message.type === "result" && typeof message.result === "string") {
          onProgress?.(message.result.slice(-4_000));
        } else {
          onProgress?.("");
        }
      } catch { /* Ignore diagnostics mixed into the event stream. */ }
    }
    if (pending.length > 1024 * 1024) pending = "";
  };
}
