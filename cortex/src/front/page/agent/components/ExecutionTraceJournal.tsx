import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { ExecutionTraceEntry } from "../../../../shared/ExecutionTrace.ts";
import { getWorkflowExecutionTrace } from "../../../services/agentApi.ts";
import { useTranslation } from "../../../i18n.tsx";

export function ExecutionTraceJournal({ projectId, runId, executionId, running, formatDate }: {
  projectId: string;
  runId: string;
  executionId: string;
  running: boolean;
  formatDate: (date: string) => string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<ExecutionTraceEntry[] | null>(null);
  const [afterId, setAfterId] = useState(0);
  const [nextAfterId, setNextAfterId] = useState<number | null>(null);
  const [revision, setRevision] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let cursor = afterId;
    async function load() {
      setBusy(true);
      try {
        const page = await getWorkflowExecutionTrace(projectId, runId, executionId, cursor, controller.signal);
        if (controller.signal.aborted) return;
        setItems(previous => [...new Map([...(previous ?? []), ...page.items].map(item => [item.id, item])).values()]);
        setNextAfterId(page.nextAfterId);
        setError("");
        if (running && page.nextAfterId === null) {
          cursor = page.items.at(-1)?.id ?? cursor;
          timer = setTimeout(() => void load(), 3_000);
        }
      } catch (cause) {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause));
      } finally {
        if (!controller.signal.aborted) setBusy(false);
      }
    }
    void load();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [open, projectId, runId, executionId, afterId, revision, running]);

  return <details className="workflow-audit__journal" onToggle={event => setOpen(event.currentTarget.open)}>
    <summary><span>{t("audit.trace.title")}</span><ChevronDown size={16} aria-hidden="true" /></summary>
    {open && <div className="workflow-audit__journal-body">
      <p>{t("audit.trace.description")}</p>
      {error && <p role="alert" className="workflow-audit__error">{error}</p>}
      {items === null && busy && <p role="status">{t("common.loading")}</p>}
      {items?.length === 0 && <p>{t("audit.trace.empty")}</p>}
      {Boolean(items?.length) && <ol className="workflow-audit__trace-list">{items!.map(entry => <li key={entry.id}>
        <div className="workflow-audit__trace-meta">
          <strong>{t(`audit.trace.${entry.kind}`)}</strong>
          {entry.phase === "interpretation" && <span>{t("audit.trace.interpretation")}</span>}
          <time dateTime={entry.occurredAt} title={entry.occurredAt}>{formatDate(entry.occurredAt)}</time>
        </div>
        {entry.kind === "tool" ? <details><summary><span>{entry.content.split("\n")[0].slice(0, 160)}</span><ChevronDown size={15} aria-hidden="true" /></summary><pre>{entry.content}</pre></details>
          : <pre>{entry.content}</pre>}
        {entry.truncated && <p className="workflow-audit__trace-truncated">{t("audit.trace.truncated")}</p>}
      </li>)}</ol>}
      <div className="workflow-audit__trace-actions">
        {nextAfterId !== null && <button className="workflow-audit__refresh" type="button" disabled={busy} onClick={() => setAfterId(nextAfterId)}>{t("audit.trace.more")}</button>}
        <button className="workflow-audit__refresh" type="button" disabled={busy} onClick={() => setRevision(value => value + 1)}>{t("audit.refresh")}</button>
      </div>
    </div>}
  </details>;
}
