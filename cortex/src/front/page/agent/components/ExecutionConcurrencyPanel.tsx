import { useEffect, useId, useRef, useState } from "react";
import type { CortexExecutionQueueStatus } from "../../../../shared/ExecutionConcurrency.ts";
import { useTranslation } from "../../../i18n.tsx";
import { getExecutionQueue, saveExecutionConcurrency } from "../../../services/executionQueueApi.ts";
import "./executionConcurrency.css";

export function ExecutionConcurrencyPanel() {
  const { language } = useTranslation();
  const fr = language === "fr", id = useId();
  const [status, setStatus] = useState<CortexExecutionQueueStatus | null>(null);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const busyRef = useRef(false), version = useRef(0);
  useEffect(() => {
    let live = true, pending = false;
    const refresh = async () => {
      if (pending || busyRef.current) return;
      pending = true;
      const request = ++version.current;
      try { const value = await getExecutionQueue(); if (live && request === version.current && !busyRef.current) { setStatus(value); setError(""); } }
      catch (reason) { if (live) setError(reason instanceof Error ? reason.message : String(reason)); }
      finally { pending = false; }
    };
    void refresh(); const timer = setInterval(() => { void refresh(); }, 2000);
    return () => { live = false; clearInterval(timer); };
  }, [attempt]);
  const title = fr ? "Autoriser les exécutions simultanées" : "Allow simultaneous executions";
  return <section className="execution-concurrency-panel" aria-labelledby={id}>
    <label><span><strong id={id}>{title}</strong><small>
      {fr ? "Une file d’attente commune à tous les projets et modes : normal, Work Force, Work Light et prompts." : "One shared queue for every project and mode: normal, Work Force, Work Light and prompts."}
    </small></span><input type="checkbox" checked={status?.settings.allowParallelExecutions ?? false} disabled={!status || busy} aria-labelledby={id}
      onChange={event => {
        const value = event.target.checked;
        const previous = status;
        busyRef.current = true; version.current++;
        if (status) setStatus({ ...status, settings: { allowParallelExecutions: value } });
        setBusy(true); setError("");
        void saveExecutionConcurrency({ allowParallelExecutions: value }).then(setStatus)
          .catch(reason => { setStatus(previous); setError(reason.message); }).finally(() => { busyRef.current = false; setBusy(false); });
      }} /></label>
    <p>{status?.settings.allowParallelExecutions
      ? fr ? "Plusieurs agents différents peuvent travailler en parallèle. Chaque projet organise la coordination de ses ressources et de ses fichiers." : "Different agents can run in parallel. Each project coordinates its resources and files."
      : fr ? "Un seul agent ou prompt à la fois sur tout Cortex. Les autres attendent leur tour ; Work Light ignore les créneaux occupés." : "Only one agent or prompt runs across Cortex. Others wait their turn; Work Light skips busy slots."}</p>
    <p>{fr ? "La désactivation laisse les exécutions en cours terminer. Les attentes de quotas et les horaires futurs ne réservent pas de créneau." : "Disabling lets active executions finish. Quota waits and future schedules do not reserve a slot."}</p>
    {status && <div role="status"><p>{fr ? "En cours" : "Active"} : {status.active.length} · {fr ? "Dans la file globale" : "In the global queue"} : {status.waiting.length}</p>
      {status.waiting.length > 0 && <ol tabIndex={0} aria-label={fr ? "File d’attente globale" : "Global queue"}>{status.waiting.map(entry => <li key={entry.id}>{entry.label} <small>({entry.source})</small></li>)}</ol>}</div>}
    {error && <p role="alert">{error} {!status && <button type="button" onClick={() => setAttempt(value => value + 1)}>{fr ? "Réessayer" : "Retry"}</button>}</p>}
  </section>;
}
