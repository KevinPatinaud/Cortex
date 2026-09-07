import { useEffect, useId, useState } from "react";
import { Mail } from "lucide-react";
import { requestJson } from "../../../services/apiClient.ts";
import type { AgentProject } from "../../../services/agentApi.ts";
import type { GmailStatus, GmailThreadSummary } from "../../../../shared/Gmail.ts";
import { useTranslation } from "../../../i18n.tsx";

export function GmailPanel({ project }: { project: AgentProject }) {
  const { language } = useTranslation();
  const say = (fr: string, en: string) => language === "fr" ? fr : en;
  const id = useId();
  const [status, setStatus] = useState<GmailStatus | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState("");
  const [threads, setThreads] = useState<GmailThreadSummary[]>([]);
  const [selected, setSelected] = useState("");
  const [eventKey, setEventKey] = useState("");
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [sendId, setSendId] = useState(() => crypto.randomUUID());
  const [sent, setSent] = useState(false);
  const activeWaits = project.workflowWaits?.filter(wait => wait.eventKey && !wait.wake) ?? [];
  const refresh = async () => setStatus(await requestJson<GmailStatus>(`/api/gmail/status?projectId=${encodeURIComponent(project.projectId)}`));
  useEffect(() => {
    let disposed = false;
    const load = () => requestJson<GmailStatus>(`/api/gmail/status?projectId=${encodeURIComponent(project.projectId)}`)
      .then(value => { if (!disposed) setStatus(value); }).catch(() => {});
    void load();
    const timer = setInterval(() => void load(), 30_000);
    return () => { disposed = true; clearInterval(timer); };
  }, [project.projectId]);
  const action = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError("");
    try { await work(); await refresh(); }
    catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)); }
    finally { setBusy(false); }
  };
  const post = <T,>(route: string, data: unknown = {}) => requestJson<T>(`/api/gmail/${route}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data)
  });
  if (!status) return null;
  return <details className="gmail-panel" open={undefined}>
    <summary><Mail size={18} aria-hidden="true" /> {say("Accès direct Gmail (optionnel)", "Direct Gmail access (optional)")} · {status.connected ? status.email : say("Non connecté", "Not connected")}</summary>
    <div className="gmail-panel__body">
      <p>{say("Si votre agent utilise déjà le plugin Gmail connecté dans Codex, il peut réutiliser cet accès. Ce panneau configure un accès distinct pour surveiller les fils sans appeler l’agent à chaque vérification.", "If your agent already uses a connected Gmail plugin in Codex, it can reuse that connection. This panel configures a separate connection to watch threads without calling the agent on each check.")}</p>
      <p>{say("Suivi des nouveaux mails toutes les 30 secondes, tant que le serveur Cortex est allumé. Seuls les fils associés ci-dessous réveillent ce workflow.", "New mail is checked every 30 seconds while the Cortex server is running. Only linked threads wake this workflow.")}</p>
      {!status.connected && <>
        {!status.configured && <>
          <p>{say("Dans Google Cloud, activez Gmail API, configurez l’écran de consentement avec votre adresse comme utilisateur de test, puis créez un client OAuth « Application de bureau » et téléchargez son fichier JSON.", "In Google Cloud, enable Gmail API, configure the consent screen with your email as a test user, then create a Desktop OAuth client and download its JSON file.")}</p>
          <a href="https://console.cloud.google.com/auth/clients" target="_blank" rel="noreferrer">Google Cloud · OAuth</a>
          <label htmlFor={`${id}-credentials`}>{say("Identifiants OAuth Google (.json)", "Google OAuth credentials (.json)")}</label>
          <input id={`${id}-credentials`} type="file" accept=".json,application/json" disabled={busy} onChange={event => {
            const file = event.target.files?.[0];
            if (file) void action(async () => { if (file.size > 20000) throw new Error(say("Fichier trop volumineux.", "File too large.")); await post("configure", JSON.parse(await file.text())); });
            event.target.value = "";
          }} />
        </>}
        <button disabled={busy || !status.configured} onClick={() => void action(async () => {
          const result = await post<{ url: string }>("connect", { projectId: project.projectId });
          window.location.assign(result.url);
        })}>{say("Connecter mon Gmail", "Connect Gmail")}</button>
        <p className="gmail-panel__hint">{say("Pour un client Web, URI de redirection : ", "For a Web client, redirect URI: ")}{status.redirectUri}</p>
      </>}
      {status.connected && <>
        <form onSubmit={event => { event.preventDefault(); void action(async () => { setThreads(await requestJson<GmailThreadSummary[]>(`/api/gmail/threads?q=${encodeURIComponent(query)}`)); }); }}>
          <label htmlFor={`${id}-query`}>{say("Rechercher un fil Gmail", "Find a Gmail thread")}</label>
          <input id={`${id}-query`} value={query} maxLength={500} placeholder="from:hotel@example.com" onChange={event => setQuery(event.target.value)} />
          <button disabled={busy}>{say("Rechercher", "Search")}</button>
        </form>
        {threads.length > 0 && <>
          <label htmlFor={`${id}-thread`}>{say("Fil à surveiller", "Thread to watch")}</label>
          <select id={`${id}-thread`} value={selected} onChange={event => setSelected(event.target.value)}>
            <option value="">{say("Sélectionner un fil", "Select a thread")}</option>
            {threads.map(thread => <option key={thread.id} value={thread.id}>{thread.subject || "(sans objet)"} · {thread.from}</option>)}
          </select>
        </>}
        {selected && <>
          <label htmlFor={`${id}-wait`}>{say("Attente à réveiller", "Wait to wake")}</label>
          <select id={`${id}-wait`} value={eventKey} onChange={event => setEventKey(event.target.value)}>
            <option value="">{say("Sélectionner une attente active", "Select an active wait")}</option>
            {activeWaits.map(wait => <option key={wait.id} value={wait.eventKey!}>{wait.agentName} · {wait.reason}</option>)}
          </select>
          <button disabled={busy || !activeWaits.some(wait => wait.eventKey === eventKey)} onClick={() => void action(async () => {
            await post("watches", { projectId: project.projectId, instanceId: project.workflowInstance?.id, eventKey, threadId: selected });
          })}>{say("Surveiller les prochaines réponses", "Watch for new replies")}</button>
          <p>{say("Les mails déjà présents ne sont pas transmis. Lancez d’abord le workflow pour disposer d’une attente active.", "Existing messages are not forwarded. Start the workflow first to create an active wait.")}</p>
        </>}
        {status.watches.map(watch => <article key={watch.id} className="gmail-panel__watch">
          <strong>{watch.subject || watch.threadId}</strong>
          <span>{watch.status === "active" ? say("Surveillance active", "Watching") : watch.status === "paused" ? say("En pause", "Paused") : say("Terminée", "Finished")}</span>
          {watch.lastCheckedAt && <small>{say("Dernière vérification : ", "Last checked: ")}{new Date(watch.lastCheckedAt).toLocaleString(language)}</small>}
          {watch.error && <p role="alert">{watch.error}</p>}
          <button disabled={busy} onClick={() => void action(async () => { await requestJson(`/api/gmail/watches/${watch.id}`, { method: "DELETE" }); })}>{say("Arrêter ce suivi", "Stop watching")}</button>
        </article>)}
        <details><summary>{say("Écrire un vrai mail", "Write a real email")}</summary>
          <form onSubmit={event => { event.preventDefault(); void action(async () => {
            const result = await post<{ threadId: string }>("send", { id: sendId, to, subject, body });
            setSelected(result.threadId); setSent(true);
          }); }}>
            <label htmlFor={`${id}-to`}>{say("Destinataire", "To")}</label>
            <input id={`${id}-to`} type="email" required value={to} disabled={busy || sent} onChange={event => setTo(event.target.value)} />
            <label htmlFor={`${id}-subject`}>{say("Objet", "Subject")}</label>
            <input id={`${id}-subject`} required maxLength={500} value={subject} disabled={busy || sent} onChange={event => setSubject(event.target.value)} />
            <label htmlFor={`${id}-body`}>Message</label>
            <textarea id={`${id}-body`} required maxLength={20000} value={body} disabled={busy || sent} onChange={event => setBody(event.target.value)} />
            <button disabled={busy || sent}>{say("Envoyer ce mail depuis Gmail", "Send this email with Gmail")}</button>
            {sent && <><p role="status">{say("Mail envoyé. Vous pouvez associer ce fil à une attente ci-dessus.", "Email sent. You can link this thread to a wait above.")}</p>
              <button type="button" onClick={() => { setTo(""); setSubject(""); setBody(""); setSent(false); setSendId(crypto.randomUUID()); }}>{say("Nouveau message", "New message")}</button></>}
          </form>
        </details>
        <button disabled={busy} onClick={() => void action(async () => { await post("disconnect"); setThreads([]); setSelected(""); })}>{say("Déconnecter Gmail et arrêter les suivis", "Disconnect Gmail and stop watches")}</button>
      </>}
      {error && <p role="alert">{error}</p>}
    </div>
  </details>;
}
