import { useEffect, useId, useRef, useState } from "react";
import { AlertCircle, ArrowRight, Check, CircleHelp, Clock3, FolderOpen, GitBranch, LoaderCircle, Pause, Play, RefreshCw, X } from "lucide-react";
import { useTranslation } from "../../../i18n.tsx";
import { requestJson } from "../../../services/apiClient.ts";
import type { AgentProject } from "../../../services/agentApi.ts";
import { parseWorkflowDispatchItem, type WorkflowDispatchRule, type WorkflowJob, type WorkflowJobStatus, type WorkflowJobPage, type WorkflowJobFilter } from "../../../../shared/WorkflowAutomation.ts";
import type { WorkflowWaitingThread } from "../../../../shared/WorkflowWait.ts";
import { parseAgentResponse } from "../../../../shared/AgentResponse.ts";
import { AgentResultContent } from "./AgentResultContent.tsx";
import { MarkdownContent } from "./MarkdownContent.tsx";
import { dossierNextEvent, dossierReason, dossierStatus, dossierTitle } from "./dossierPresentation.ts";

const post = <T,>(url: string, body: unknown) => requestJson<T>(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
type JobDetail = { job: WorkflowJob; project: AgentProject };

/** Dossiers belong to their entry agent in the project's graph. Configuration comes from its instructions. */
export function WorkflowDossiers({ project, rule }: { project: AgentProject; rule?: WorkflowDispatchRule }) {
  const { language } = useTranslation();
  const say = (fr: string, en: string) => language === "fr" ? fr : en;
  const headingId = useId();
  const base = `/api/automations/${encodeURIComponent(project.projectId)}`;
  const [page, setPage] = useState<WorkflowJobPage>({ jobs: [], total: 0, counts: { attention: 0, active: 0, waiting: 0, completed: 0, stopped: 0 }, dispatchedKeys: [] });
  const { jobs, total, counts } = page;
  const allTotal = Object.values(counts).reduce((sum, count) => sum + count, 0);
  const [filter, setFilter] = useState<WorkflowJobFilter | "all">("all");
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<JobDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [detailError, setDetailError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [revision, setRevision] = useState(0);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const filtersRef = useRef<HTMLDivElement>(null);
  const source = project.agents.find(agent => agent.id === rule?.sourceAgentId);
  const resultKeys = (source?.threads.length ? source.threads : [{ conversation: source?.conversation ?? [] }]).flatMap(thread => {
    const last = [...thread.conversation].reverse().find(message => message.role === "agent");
    const response = last ? parseAgentResponse(last.content) : null;
    if (response?.status !== "success") return [];
    return response.items.flatMap(item => { try { return [parseWorkflowDispatchItem(item.content).key]; } catch { return []; } });
  });
  const dispatchedKeys = new Set(page.dispatchedKeys);
  const hasPendingResults = resultKeys.some(key => !dispatchedKeys.has(key));
  const status = (value: WorkflowJobStatus) => dossierStatus(value, language);
  const date = (value: string) => new Date(value).toLocaleString(language, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const filterLabels: Record<WorkflowJobFilter, string> = {
    attention: say("À traiter", "Needs attention"), active: say("En activité", "Active"), waiting: say("En attente", "Waiting"),
    completed: say(counts.completed === 1 ? "Terminé" : "Terminés", "Completed"), stopped: say(counts.stopped === 1 ? "Arrêté" : "Arrêtés", "Stopped")
  };

  useEffect(() => { setLoaded(false); }, [base, rule?.id, offset, filter]);

  useEffect(() => {
    let alive = true;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const nextPage = await requestJson<WorkflowJobPage>(`${base}/jobs?offset=${offset}${rule ? `&ruleId=${encodeURIComponent(rule.id)}` : ""}${filter === "all" ? "" : `&filter=${filter}`}`, { signal: controller.signal });
        if (alive) {
          if (offset > 0 && offset >= nextPage.total) { setOffset(Math.max(0, Math.ceil(nextPage.total / 50) - 1) * 50); return; }
          setPage(nextPage); setLoaded(true); setLoadError("");
        }
      } catch (cause) { if (alive) setLoadError(cause instanceof Error ? cause.message : String(cause)); }
      finally { if (alive) timer = setTimeout(() => void refresh(), 2000); }
    }
    void refresh();
    return () => { alive = false; controller.abort(); clearTimeout(timer); };
  }, [base, rule?.id, offset, filter, revision]);

  useEffect(() => {
    if (!selected) return;
    let alive = true;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refreshDetail() {
      try {
        const current = await requestJson<JobDetail>(`${base}/jobs/${encodeURIComponent(selected!)}`, { signal: controller.signal });
        if (alive) { setDetail(current); setDetailError(""); }
      } catch (cause) { if (alive) setDetailError(cause instanceof Error ? cause.message : String(cause)); }
      finally { if (alive) timer = setTimeout(() => void refreshDetail(), 2000); }
    }
    void refreshDetail();
    return () => { alive = false; controller.abort(); clearTimeout(timer); };
  }, [base, selected, revision]);

  useEffect(() => {
    if (!selected) return;
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const previousOverflow = document.body.style.overflow;
    dialog?.showModal();
    document.body.style.overflow = "hidden";
    closeRef.current?.focus({ preventScroll: true });
    return () => {
      dialog?.close();
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
      else filtersRef.current?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]')?.focus({ preventScroll: true });
    };
  }, [selected]);

  function closeDetail() { setSelected(null); setDetail(null); setDetailError(""); setError(""); setFeedback(""); }

  async function action(operation: () => Promise<unknown>, message = "") {
    if (busy) return;
    setBusy(true); setError(""); setFeedback("");
    try { await operation(); setFeedback(message); setRevision(value => value + 1); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }

  if (!rule && loaded && !allTotal && !loadError) return null;
  return <section className="automation-panel workflow-dossiers" aria-labelledby={headingId}>
    <header className="workflow-dossiers__header">
      <h3 id={headingId}><FolderOpen size={18} aria-hidden="true" />{rule ? say("Dossiers", "Dossiers") : say("Historique des dossiers", "Dossier history")} ({allTotal})</h3>
      {rule && <p><GitBranch size={14} aria-hidden="true" />{say(`Depuis ${source?.name ?? "l’agent précédent"} · Un dossier par résultat retenu`, `From ${source?.name ?? "the previous agent"} · One dossier per qualifying result`)}</p>}
      {(allTotal > 0 || filter !== "all") && <div ref={filtersRef} className="workflow-dossiers__filters" role="group" aria-label={say("Filtrer les dossiers", "Filter dossiers")}>
        <button type="button" aria-pressed={filter === "all"} onClick={() => { setFilter("all"); setOffset(0); }}>{say("Tous", "All")}</button>
        {(Object.keys(counts) as WorkflowJobFilter[]).filter(key => counts[key] > 0 || filter === key).map(key => <button key={key} type="button" className={`workflow-dossiers__filter--${key}`} aria-pressed={filter === key} onClick={() => { setFilter(key); setOffset(0); }}>
          {key === "attention" && <AlertCircle size={14} aria-hidden="true" />}{counts[key]} {filterLabels[key]}
        </button>)}
      </div>}
    </header>
    {((error && !selected) || loadError) && <p className="automation-panel__error" role="alert">{(!selected && error) || loadError}</p>}
    {feedback && !selected && <p role="status">{feedback}</p>}
    {!loaded && !loadError && <p className="workflow-dossiers__empty" role="status">{say("Chargement…", "Loading…")}</p>}
    {loaded && !jobs.length && <p className="workflow-dossiers__empty">{filter === "all" ? say("Aucun dossier pour le moment. Les résultats retenus apparaîtront ici.", "No dossiers yet. Qualifying results will appear here.") : say("Aucun dossier dans cette catégorie.", "No dossiers in this category.")}</p>}
    {rule && loaded && hasPendingResults && <button type="button" disabled={busy || project.agents.some(agent => agent.executionStatus === "running")}
      onClick={() => void action(() => post(`${base}/continue`, { agentId: rule.sourceAgentId }), say("Résultats transmis. Les dossiers sont suivis ci-dessous.", "Results submitted. Track dossiers below."))}>
      <Play aria-hidden="true" size={16} />{say("Continuer avec les résultats disponibles", "Continue with available results")}
    </button>}
    {loaded && <ul className="automation-panel__jobs">{jobs.map(job => {
      const title = dossierTitle(job.title);
      const nextEvent = dossierNextEvent(job);
      return <li key={job.id}>
        <button type="button" aria-pressed={selected === job.id} aria-haspopup="dialog" onClick={() => { setDetail(null); setDetailError(""); setError(""); setFeedback(""); setSelected(job.id); }}>
          <span className="workflow-dossiers__row-heading"><span className="workflow-dossiers__identity"><strong>{title.title}</strong>{title.subtitle && <span className="workflow-dossiers__subtitle">{title.subtitle}</span>}</span><JobStatus status={job.status} label={status(job.status)} /></span>
          <span className="workflow-dossiers__reason">{dossierReason(job, language)}{(job.waits?.length ?? 0) > 1 && <span> · +{job.waits!.length - 1} {say("attente(s)", "wait(s)")}</span>}</span>
          <span className="workflow-dossiers__row-footer"><span className="workflow-dossiers__timing">
            {nextEvent ? <><Clock3 size={13} aria-hidden="true" />{nextEvent.kind === "wake" ? say("Vérification", "Check") : say("Échéance", "Deadline")} : <time dateTime={nextEvent.at} title={new Date(nextEvent.at).toLocaleString(language)}>{date(nextEvent.at)}</time></>
              : <>{say("Mis à jour", "Updated")} <time dateTime={job.updatedAt} title={new Date(job.updatedAt).toLocaleString(language)}>{date(job.updatedAt)}</time></>}
          </span><span className="workflow-dossiers__open">{["failed", "interrupted"].includes(job.status) ? say("Examiner l’erreur", "Review error") : job.status === "blocked" ? say("Apporter des précisions", "Provide details") : say("Ouvrir le dossier", "Open dossier")}<ArrowRight size={14} aria-hidden="true" /></span></span>
        </button>
      </li>;
    })}</ul>}
    {total > 50 && <nav className="automation-panel__pagination" aria-label={say("Pages des dossiers", "Dossier pages")}>
      <button disabled={offset === 0} onClick={() => setOffset(value => Math.max(0, value - 50))}>{say("Précédent", "Previous")}</button>
      <span>{Math.floor(offset / 50) + 1} / {Math.ceil(total / 50)}</span>
      <button disabled={offset + 50 >= total} onClick={() => setOffset(value => value + 50)}>{say("Suivant", "Next")}</button>
    </nav>}
    {selected && <dialog ref={dialogRef} className="workflow-dossier-drawer" aria-modal="true" aria-labelledby={`${headingId}-detail-title`} onCancel={event => { event.preventDefault(); closeDetail(); }}>
      <section className="automation-panel__detail" aria-label={say("Détail du dossier", "Dossier details")}>
      <header className="workflow-dossier-drawer__header"><div><span>{say("Dossier indépendant", "Independent dossier")}</span><h3 id={`${headingId}-detail-title`}>{detail?.job.title ?? jobs.find(job => job.id === selected)?.title ?? say("Détail du dossier", "Dossier details")}</h3></div>
        <button ref={closeRef} className="automation-panel__close" type="button" aria-label={say("Fermer le dossier", "Close dossier")} onClick={closeDetail}><X aria-hidden="true" size={20} /></button>
      </header>
      <div className="workflow-dossier-drawer__body">
      {(detailError || error) && <p className="automation-panel__error" role="alert">{detailError || error}</p>}
      {feedback && <p role="status">{feedback}</p>}
      {!detail ? !detailError && <p role="status">{say("Chargement…", "Loading…")}</p> : <>
        <div className="workflow-dossier-drawer__status"><JobStatus status={detail.job.status} label={status(detail.job.status)} /><span>{say("Créé le", "Created")} {date(detail.job.createdAt)}</span></div>
        {detail.job.error && <div className={detail.job.status === "blocked" ? "workflow-dossiers__blocker" : "automation-panel__error"}>
          <p>{dossierReason(detail.job, language)}</p>
          {detail.job.status !== "blocked" && <details><summary>{say("Diagnostic technique", "Technical diagnostic")}</summary><pre>{detail.job.error}</pre></details>}
        </div>}
        <details><summary>{say("Résultat à l’origine du dossier", "Original result")}</summary><MarkdownContent content={detail.job.payload} /></details>
        {["failed", "blocked", "interrupted"].includes(detail.job.status) && <JobResume key={detail.job.id} job={detail.job} base={`${base}/jobs/${selected}`} onResumed={() => setRevision(value => value + 1)} />}
        <div className="automation-panel__detail-actions">
          {!["completed", "cancelled"].includes(detail.job.status) && <button type="button" disabled={busy} onClick={() => void action(() => post(`${base}/jobs/${selected}/cancel`, {}))}>{say("Arrêter ce dossier", "Stop this dossier")}</button>}
        </div>
        {Boolean(detail.job.clarifications?.length) && <details><summary>{say("Précisions apportées à ce dossier", "Dossier clarifications")}</summary>
          {detail.job.clarifications!.map((item, index) => <div key={index}><small>{new Date(item.createdAt).toLocaleString(language)}</small><MarkdownContent content={item.content} /></div>)}
        </details>}
        {detail.project.workflowWaits?.map(wait => <JobReply key={wait.id} wait={wait} base={`${base}/jobs/${selected}`} active={detail.job.status === "waiting" || detail.job.status === "running"} />)}
        {detail.project.agents.map(agent => <details key={agent.id} className="automation-panel__agent" open={agent.executionStatus === "waiting" || agent.executionStatus === "failed"}>
          <summary>{agent.name} · {agent.executionStatus === "idle" ? agent.hasSession ? say("Exécuté", "Executed") : say("Non exécuté", "Not executed") : status(agent.executionStatus === "failed" && agent.executionError?.includes(" » bloqué : ") ? "blocked" : agent.executionStatus)}</summary>
          {(agent.threads.length ? agent.threads : [{ id: "main", conversation: agent.conversation }]).map(thread => <div key={thread.id}>
            {thread.conversation.map((message, index) => <div className="automation-panel__message" key={index}>
              <strong>{message.role === "agent" ? agent.name : message.role === "event" ? say("Réponse / réveil", "Reply / wake") : say("Contexte", "Context")}</strong>
              {message.role === "agent" && parseAgentResponse(message.content) ? parseAgentResponse(message.content)!.items.map((item, itemIndex) => <AgentResultContent key={itemIndex} content={item.content} />) : <MarkdownContent content={message.content} />}
            </div>)}
          </div>)}
        </details>)}
      </>}
      </div>
    </section></dialog>}
  </section>;
}

function JobStatus({ status, label }: { status: WorkflowJobStatus; label: string }) {
  const Icon = ({ queued: Clock3, running: LoaderCircle, waiting: Clock3, blocked: CircleHelp, completed: Check, cancelled: Pause, failed: AlertCircle, interrupted: AlertCircle })[status];
  return <span className={`automation-panel__status automation-panel__status--${status}`}><Icon size={14} aria-hidden="true" />{label}</span>;
}

function JobResume({ job, base, onResumed }: { job: WorkflowJob; base: string; onResumed: () => void }) {
  const { language } = useTranslation();
  const say = (fr: string, en: string) => language === "fr" ? fr : en;
  const id = useId();
  const [clarification, setClarification] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const blocked = job.status === "blocked";
  return <form className="automation-panel__wait" onSubmit={event => {
    event.preventDefault(); if (busy) return;
    setBusy(true); setError("");
    void post(`${base}/resume`, { clarification }).then(onResumed).catch(cause => setError(cause.message)).finally(() => setBusy(false));
  }}>
    <label htmlFor={id}>{say("Précisions pour reprendre ce dossier", "Clarifications to resume this dossier")}</label>
    <p id={`${id}-help`}>{say("Indiquez les informations manquantes ou ce que vous avez corrigé. Ces précisions seront transmises aux agents de ce dossier. La reprise peut déclencher les actions autorisées, dont l’envoi de mails.", "Provide the missing information or explain what you corrected. These clarifications will reach this dossier’s agents. Resuming may trigger authorized actions, including sending emails.")}</p>
    <textarea id={id} aria-describedby={`${id}-help`} value={clarification} onChange={event => setClarification(event.target.value)} required={blocked} maxLength={32000} disabled={busy} />
    {error && <p role="alert" className="automation-panel__error">{error}</p>}
    <button type="submit" disabled={busy || (blocked && !clarification.trim())}><RefreshCw aria-hidden="true" size={16} />
      {blocked ? say("Transmettre et reprendre", "Submit and resume") : say("Reprendre après vérification", "Resume after review")}</button>
  </form>;
}

function JobReply({ wait, base, active }: { wait: WorkflowWaitingThread; base: string; active: boolean }) {
  const { language } = useTranslation();
  const say = (fr: string, en: string) => language === "fr" ? fr : en;
  const id = useId();
  const [message, setMessage] = useState("");
  const [eventId, setEventId] = useState(() => crypto.randomUUID());
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  return <article className="automation-panel__wait"><strong>{wait.agentName}</strong><p>{wait.reason}</p>
    <p>{say("Échéance", "Deadline")} : {new Date(wait.deadlineAt).toLocaleString(language)}{wait.wakeAt && <> · {say("Prochain réveil", "Next wake")} : {new Date(wait.wakeAt).toLocaleString(language)}</>}</p>
    {active && wait.eventKey && !wait.wake && <form onSubmit={event => { event.preventDefault(); if (busy) return; setBusy(true); void post(`${base}/events`, { id: eventId, key: wait.eventKey, payload: message }).then(() => {
      setMessage(""); setEventId(crypto.randomUUID()); setFeedback(say("Réponse transmise. La reprise est automatique.", "Reply submitted. Resumption is automatic."));
    }).catch(cause => setFeedback(cause.message)).finally(() => setBusy(false)); }}>
      <label htmlFor={id}>{say("Réponse reçue pour ce dossier", "Reply for this dossier")}</label>
      <textarea id={id} value={message} maxLength={32000} required disabled={busy} onChange={event => setMessage(event.target.value)} />
      <button disabled={busy || !message.trim()}>{say("Transmettre la réponse", "Submit reply")}</button>
    </form>}
    {feedback && <p role="status">{feedback}</p>}
  </article>;
}
