import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, GripVertical, Play, RefreshCw, Square, X } from "lucide-react";
import { useTranslation } from "../../i18n.tsx";
import { getWorkForce, getWorkForceAgents, saveWorkForce, startWorkForce, stopWorkForce } from "../../services/workForceApi.ts";
import { workForceAgentKey, type WorkForceAgentRef, type WorkForceCatalog, type WorkForceOverview } from "../../../shared/WorkForce.ts";
import { MarkdownContent } from "../agent/components/MarkdownContent.tsx";
import { WorkForceSettingsPanel } from "./WorkForceSettingsPanel.tsx";
import { fr, en } from "./messages.ts";
import "./workForce.css";

function localDate(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso), pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}
function instant(local: string): string | null {
  if (!local) return null;
  const date = new Date(local);
  if (!Number.isFinite(date.getTime()) || localDate(date.toISOString()).slice(0, local.length) !== local) throw new Error("invalid date");
  return date.toISOString();
}
export function WorkForceWorkspace({ onNormal, onPrompts, onWorkLight }: { onNormal(): void; onPrompts?: () => void; onWorkLight?: () => void }) {
  const { language, t } = useTranslation();
  const copy = language === "fr" ? fr : en;
  const [overview, setOverview] = useState<WorkForceOverview | null>(null);
  const [catalog, setCatalog] = useState<WorkForceCatalog>({ agents: [], errors: [] });
  const [selected, setSelected] = useState<WorkForceAgentRef[]>([]);
  const [startsAt, setStartsAt] = useState(""), [endsAt, setEndsAt] = useState("");
  const [search, setSearch] = useState(""), [busy, setBusy] = useState(false);
  const [error, setError] = useState(""), [message, setMessage] = useState("");
  const dirty = useRef(false), live = useRef(true), inFlight = useRef(false), busyRef = useRef(false), requestVersion = useRef(0), dragging = useRef<number | null>(null);
  const apply = useCallback((value: WorkForceOverview) => {
    if (!live.current) return;
    setOverview(value);
    if (!dirty.current) { setSelected(value.configuration.agents); setStartsAt(localDate(value.configuration.startsAt)); setEndsAt(localDate(value.configuration.endsAt)); }
  }, []);
  const refresh = useCallback(async () => {
    const version = ++requestVersion.current;
    const value = await getWorkForce();
    if (version === requestVersion.current && !busyRef.current) apply(value);
  }, [apply]);
  const refreshCatalog = useCallback(async () => { const value = await getWorkForceAgents(); if (live.current) setCatalog(value); }, []);
  useEffect(() => {
    live.current = true;
    void Promise.all([refresh(), refreshCatalog()]).catch(reason => { if (live.current) setError(reason.message); });
    const timer = setInterval(() => {
      if (inFlight.current || busyRef.current) return;
      inFlight.current = true;
      void refresh().catch(reason => { if (live.current) setError(reason.message); }).finally(() => { inFlight.current = false; });
    }, 2000);
    return () => { live.current = false; clearInterval(timer); };
  }, [refresh, refreshCatalog]);
  const locked = Boolean(overview?.runtime.armed || overview?.runtime.active);
  const agentInfo = (ref: WorkForceAgentRef) => catalog.agents.find(candidate => workForceAgentKey(candidate) === workForceAgentKey(ref));
  function edit(action: () => void) { if (locked || busy) return; dirty.current = true; setMessage(""); action(); }
  function move(from: number, to: number) {
    if (to < 0 || to >= selected.length || from === to) return;
    edit(() => setSelected(current => { const next = [...current]; const [item] = next.splice(from, 1); next.splice(to, 0, item); return next; }));
  }
  async function act(action: "save" | "start" | "stop") {
    if (busyRef.current) return;
    busyRef.current = true; requestVersion.current++;
    setBusy(true); setError(""); setMessage("");
    try {
      if (action === "stop") { apply(await stopWorkForce()); return; }
      if (dirty.current) {
        let start: string | null, end: string | null;
        try { start = instant(startsAt); end = instant(endsAt); } catch { throw new Error(copy.invalidDate); }
        const value = await saveWorkForce({ agents: selected, startsAt: start, endsAt: end });
        dirty.current = false; apply(value);
      }
      if (action === "start") apply(await startWorkForce()); else setMessage(copy.saved);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { busyRef.current = false; if (live.current) setBusy(false); }
  }
  const runtime = overview?.runtime;
  const next = overview?.configuration.agents[runtime?.cursor ?? 0];
  const nextInfo = next && agentInfo(next);
  const format = (date: string) => new Date(date).toLocaleString(language);
  const reserves = (value: number | undefined) => value === undefined ? copy.unknown : `${Number(value.toFixed(2))} %`;
  return <main className="work-force" id="main-content">
    <header className="work-force__header">
      <nav aria-label="Modes Cortex"><button type="button" onClick={onNormal}><ArrowLeft size={16} aria-hidden="true" />{copy.normal}</button>
        {onPrompts && <button type="button" onClick={onPrompts}>{copy.prompts}</button>}{onWorkLight && <button type="button" onClick={onWorkLight}>Work Light</button>}</nav>
      <div><p className="work-force__eyebrow">CORTEX</p><h1>Work Force</h1><p>{copy.description}</p></div>
      <div className="work-force__actions">
        {runtime?.armed ? <button type="button" disabled={busy} onClick={() => void act("stop")}><Square size={16} aria-hidden="true" />{copy.stop}</button>
          : <button className="work-force__primary" type="button" disabled={!overview || busy || Boolean(runtime?.active) || !selected.length} onClick={() => void act("start")}>
            <Play size={16} aria-hidden="true" />{startsAt && new Date(startsAt).getTime() > Date.now() ? copy.schedule : copy.start}</button>}
      </div>
    </header>
    {error && <p role="alert" className="work-force__error">{error}<button type="button" disabled={busy} onClick={() => { setError(""); void Promise.all([refresh(), refreshCatalog()]).catch(reason => setError(reason.message)); }}>{copy.retry}</button></p>}
    {message && <p role="status">{message}</p>}
    {!overview ? <p role="status">{t("common.loading")}</p> : <>
      <section className="work-force__status work-force__card" aria-label={copy.status}>
        <div><span className={`work-force__badge work-force__badge--${runtime!.phase}`} role="status">{copy.phases[runtime!.phase]}</span>
          {runtime!.reason && <p>{runtime!.reason}</p>}
          {runtime!.active && <p><strong>{copy.current} :</strong> {runtime!.active.agent.name} · {runtime!.active.agent.projectName}</p>}
          {!runtime!.active && next && <p><strong>{copy.next} :</strong> {nextInfo?.name ?? next.agentId} {nextInfo && `· ${nextInfo.projectName}`}</p>}
          {runtime!.nextCheckAt && <p>{runtime!.phase === "waiting_quota" ? copy.check : copy.nextAttempt} : {format(runtime!.nextCheckAt)}</p>}
          {runtime!.phase === "scheduled" && overview.configuration.startsAt && <p>{copy.startAt} : {format(overview.configuration.startsAt)}</p>}
          {overview.configuration.endsAt && <p>{copy.endAt} : {format(overview.configuration.endsAt)}</p>}
          {runtime!.phase === "stopping" && <p>{copy.stopping}</p>}
          <small>{copy.server}</small>
        </div>
        <dl><div><dt>{copy.cycles}</dt><dd>{runtime!.completedCycles}</dd></div>
          <div><dt>{copy.fiveRemaining}</dt><dd>{reserves(overview.quotaStatus?.fiveHour?.remainingPercent)}</dd></div>
          <div><dt>{copy.weekRemaining}</dt><dd>{reserves(overview.quotaStatus?.weekly?.remainingPercent)}</dd></div></dl>
      </section>
      <div className="work-force__columns">
        <section className="work-force__card" aria-labelledby="work-force-sequence">
          <h2 id="work-force-sequence">{copy.sequence} <small>({selected.length})</small></h2>
          {locked && <p>{copy.selectionLocked}</p>}
          {!selected.length && <p>{copy.empty}</p>}
          <ol className="work-force__sequence">
            {selected.map((ref, index) => {
              const agent = agentInfo(ref), name = agent?.name ?? ref.agentId;
              return <li key={workForceAgentKey(ref)} draggable={!locked && !busy}
                onDragStart={event => { dragging.current = index; event.dataTransfer.setData("text/plain", String(index)); event.dataTransfer.effectAllowed = "move"; }}
                onDragEnd={() => { dragging.current = null; }} onDragOver={event => { if (!locked) event.preventDefault(); }}
                onDrop={event => { event.preventDefault(); if (dragging.current !== null) move(dragging.current, index); dragging.current = null; }}>
                <GripVertical size={16} aria-hidden="true" /><span className="work-force__number">{index + 1}</span>
                <div className="work-force__agent-name"><strong>{name}</strong><small>{agent?.projectName ?? copy.unavailable}</small></div>
                <div className="work-force__row-actions">
                  <button type="button" disabled={locked || busy} aria-label={`${copy.remove} ${name}`} onClick={() => edit(() => setSelected(current => current.filter(item => workForceAgentKey(item) !== workForceAgentKey(ref))))}><X size={15} aria-hidden="true" /></button>
                </div>
              </li>;
            })}
          </ol>
          <form className="work-force__schedule" onSubmit={event => { event.preventDefault(); void act("save"); }}>
            <p>{copy.scheduleHelp}</p><p><small>{copy.zone} : {Intl.DateTimeFormat().resolvedOptions().timeZone}</small></p>
            <label>{copy.startAt}<input type="datetime-local" step="1" value={startsAt} disabled={locked || busy} onChange={event => edit(() => setStartsAt(event.target.value))} /></label>
            <label>{copy.endAt}<input type="datetime-local" step="1" value={endsAt} disabled={locked || busy} onChange={event => edit(() => setEndsAt(event.target.value))} /></label>
            <button type="submit" disabled={locked || busy || !dirty.current}>{copy.save}</button>
          </form>
        </section>
        <section className="work-force__card" aria-labelledby="work-force-available">
          <div className="work-force__section-header"><h2 id="work-force-available">{copy.available}</h2>
            <button type="button" aria-label={copy.refresh} onClick={() => void refreshCatalog().catch(reason => setError(reason.message))}><RefreshCw size={16} aria-hidden="true" /></button></div>
          <input type="search" aria-label={copy.search} placeholder={copy.search} value={search} onChange={event => setSearch(event.target.value)} />
          {catalog.errors.map(message => <p key={message} className="work-force__error">{message}</p>)}
          {!catalog.agents.length && <p>{copy.noAgents}</p>}
          <div className="work-force__catalog" tabIndex={0} role="region" aria-label={copy.available}>
            {catalog.agents.filter(agent => `${agent.name} ${agent.projectName}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())).map(agent => {
              const checked = selected.some(ref => workForceAgentKey(ref) === workForceAgentKey(agent));
              return <label key={workForceAgentKey(agent)}><input type="checkbox" checked={checked} disabled={locked || busy}
                onChange={() => edit(() => setSelected(current => checked ? current.filter(ref => workForceAgentKey(ref) !== workForceAgentKey(agent)) : [...current, { projectId: agent.projectId, agentId: agent.agentId }]))} />
                <span><strong>{agent.name}</strong><small>{agent.projectName}</small>{agent.description && <small>{agent.description}</small>}</span></label>;
            })}
          </div>
        </section>
      </div>
      <details className="work-force__card"><summary>{copy.settings}</summary><WorkForceSettingsPanel /></details>
      {runtime!.history.length > 0 && <section className="work-force__card" aria-labelledby="work-force-history"><h2 id="work-force-history">{copy.history}</h2>
        <ol className="work-force__history">{runtime!.history.map((execution, index) => <li key={`${execution.startedAt}-${index}`}>
          <strong>{execution.agent.name}</strong> · {execution.agent.projectName}<span>{execution.outcome === "succeeded" ? copy.succeeded : execution.outcome === "interrupted" ? copy.interrupted : copy.failed} · {format(execution.startedAt)}</span>
          {execution.error && <p>{execution.error}</p>}{execution.answer && <details><summary>{copy.result}</summary><MarkdownContent content={execution.answer} /></details>}
        </li>)}</ol>
      </section>}
    </>}
  </main>;
}
