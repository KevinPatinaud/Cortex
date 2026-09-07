import { parseWorkflowDispatchItem } from "../../../../shared/WorkflowAutomation.ts";
import { MarkdownContent } from "./MarkdownContent.tsx";

/** Keep the stored response intact while presenting a dispatch envelope as a dossier. */
export function AgentResultContent({ content }: { content: string }) {
  try {
    const item = parseWorkflowDispatchItem(content);
    const payload = item.payload.includes("\n") ? item.payload : item.payload.replace(/\\r\\n|\\n/g, "\n");
    return <div className="agent-result-dossier"><h3>{item.title}</h3><MarkdownContent content={payload} /></div>;
  } catch {
    return <MarkdownContent content={content} />;
  }
}
