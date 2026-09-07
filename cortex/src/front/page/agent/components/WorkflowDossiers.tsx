import { useEffect, useId, useState } from "react";
import { Play, RefreshCw, X } from "lucide-react";
import { useTranslation } from "../../../i18n.tsx";
import { requestJson } from "../../../services/apiClient.ts";
import type { AgentProject } from "../../../services/agentApi.ts";
import { parseWorkflowDispatchItem, type WorkflowDispatchRule, type WorkflowJob, type WorkflowJobStatus } from "../../../../shared/WorkflowAutomation.ts";
import type { WorkflowWaitingThread } from "../../../../shared/WorkflowWait.ts";
import { parseAgentResponse } from "../../../../shared/AgentResponse.ts";
import { AgentResultContent } from "./AgentResultContent.tsx";
import { MarkdownContent } from "./MarkdownContent.tsx";

const post = <T,>(url: string, body: unknown) => requestJson<T>(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
type JobDetail = { job: WorkflowJob; project: AgentProject };

/** Dossiers belong to their entry agent in the project's graph. Configuration comes from its instructions. */
export function WorkflowDossiers({ project, rule }: { project: AgentProject; rule?: WorkflowDispatchRule }) {
  const { language } = useTranslation();
  const say = (fr: string, en: string) => language === "fr" ? fr : en;
  const headingId = useId();
  const base = `/api/automations/${encodeURIComponent(project.projectId)}`;
  const [jobs, setJobs] = useState<WorkflowJob[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<JobDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [feedback, setFeedback] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [revision, setRevision] = useState(0);
  const source = project.agents.find(agent => agent.id === rule?.sourceAgentId);
  const resultKeys = (source?.threads.length ? source.threads : [{ conversation: source?.conversation ?? [] }]).flatMap(thread => {
    const last = [...thread.conversation].reverse().find(message => message.role === "agent");
    const response = last ? parseAgentResponse(last.content) : null;
    if (response?.status !== "success") return [];
    return response.items.flatMap(item => { try { return [parseWorkflowDispatchItem(item.content).key]; } catch { return []; } });
  });
  const hasPendingResults = resultKeys.some(key => !jobs.some(job => job.key === key));
  const status = (value: WorkflowJobStatus) => ({
    queued: say("En file d’attente", "Queued"), running: say("En cours", "Running"), waiting: say("En attente", "Waiting"),
    blocked: say("À préciser", "Needs input"),
    completed: say("Terminé", "Completed"), cancelled: say("Arrêté", "Cancelled"), failed: say("Échec", "Failed"), interrupted: say("Interrompu", "Interrupted")
  })[value];

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const [page, current] = await Promise.all([
          requestJson<{ jobs: WorkflowJob[]; total: number }>(`${base}/jobs?offset=${offset}${rule ? `&ruleId=${encodeURIComponent(rule.id)}` : ""}`),
          selected ? requestJson<JobDetail>(`${base}/jobs/${selected}`) : Promise.resolve(null)
        ]);
        if (alive) { setJobs(page.jobs); setTotal(page.total); setDetail(current); setLoaded(true); setLoadError(""); }
      } catch (cause) { if (alive) setLoadError(cause instanceof Error ? cause.message : String(cause)); }
      finally { if (alive) timer = setTimeout(() => void refresh(), 2000); }
    }
    void refresh();
    return () => { alive = false; clearTimeout(timer); };
  }, [base, rule?.id, offset, selected, revision]);

  async function action(operation: () => Promise<unknown>, message = "") {
    if (busy) return;
    setBusy(true); setError(""); setFeedback("");
    try { await operation(); setFeedback(message); setRevision(value => value + 1); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }

  if (!rule && loaded && !total && !loadError) return null;
  return <section className="automation-panel workflow-dossiers" aria-labelledby={headingId}>
    <h3 id={headingId}>{rule ? say("Dossiers", "Dossiers") : say("Historique des dossiers", "Dossier history")} ({total})</h3>
    {rule && <p>{say(`Chaque résultat retenu par ${source?.name ?? "l’agent précédent"} ouvre automatiquement un dossier indépendant.`, `Each qualifying result from ${source?.name ?? "the previous agent"} automatically opens an independent dossier.`)}</p>}
    {(error || loadError) && <p className="automation-panel__error" role="alert">{error || loadError}</p>}
    {feedback && <p role="status">{feedback}</p>}
    {!loaded ? <p role="status">{say("Chargement…", "Loading…")}</p> : !jobs.length && <p>{say("Aucun dossier pour le moment.", "No dossiers yet.")}</p>}
    {rule && loaded && hasPendingResults && <button type="button" disabled={busy || project.agents.some(agent => agent.executionStatus === "running")}
      onClick={() => void action(() => post(`${base}/continue`, { agentId: rule.sourceAgentId }), say("Résultats transmis. Les dossiers sont suivis ci-dessous.", "Results submitted. Track dossiers below."))}>
      <Play aria-hidden="true" size={16} />{say("Continuer avec les résultats disponibles", "Continue with available results")}
    </button>}
    <ul className="automation-panel__jobs">{jobs.map(job => <li key={job.id}>
      <button type="button" aria-pressed={selected === job.id} onClick={() => { setDetail(null); setSelected(job.id); }}>
        <span><strong>{job.title}</strong><small>{new Date(job.createdAt).toLocaleString(language)}</small>
          {job.error && <small className="workflow-dossiers__reason">{job.error}</small>}</span>
        <span className={`automation-panel__status automation-panel__status--${job.status}`}>{status(job.status)}</span>
      </button>
    </li>)}</ul>
    {total > 50 && <nav className="automation-panel__pagination" aria-label={say("Pages des dossiers", "Dossier pages")}>
      <button disabled={offset === 0} onClick={() => setOffset(value => Math.max(0, value - 50))}>{say("Précédent", "Previous")}</button>
      <span>{Math.floor(offset / 50) + 1} / {Math.ceil(total / 50)}</span>
      <button disabled={offset + 50 >= total} onClick={() => setOffset(value => value + 50)}>{say("Suivant", "Next")}</button>
    </nav>}
    {selected && <section className="automation-panel__section automation-panel__detail" aria-label={say("Détail du dossier", "Dossier details")}>
      <button className="automation-panel__close" type="button" aria-label={say("Fermer le dossier", "Close dossier")} onClick={() => { setSelected(null); setDetail(null); }}><X aria-hidden="true" size={18} /></button>
      {!detail ? <p role="status">{say("Chargement…", "Loading…")}</p> : <>
        <h4>{detail.job.title}</h4><p><strong>{status(detail.job.status)}</strong></p>
        <details><summary>{say("Résultat à l’origine du dossier", "Original result")}</summary><MarkdownContent content={detail.job.payload} /></details>
        {detail.job.error && <p className={detail.job.status === "blocked" ? "workflow-dossiers__blocker" : "automation-panel__error"}>{detail.job.error}</p>}
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
    </section>}
  </section>;
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
