import { useId, useState } from "react";
import { Clock3 } from "lucide-react";
import { useTranslation } from "../../../i18n.tsx";
import { requestJson } from "../../../services/apiClient.ts";
import { loadAgentProject, type AgentProject } from "../../../services/agentApi.ts";
import type { WorkflowWaitingThread } from "../../../../shared/WorkflowWait.ts";

export function WorkflowWaitPanel({ project, onRefresh }: { project: AgentProject; onRefresh: (project: AgentProject) => void }) {
  const { t } = useTranslation();
  if (!project.workflowWaits?.length || !project.workflowInstance) return null;
  const active = ["running", "waiting"].includes(project.workflowInstance.status);
  return <section className="workflow-waits" aria-label={t("wait.title")}>
    <h3><Clock3 aria-hidden="true" size={18} />{t("wait.title")}</h3>
    <p>{t(active ? "wait.automatic" : "wait.paused")}</p>
    {project.workflowWaits.map((wait) => <WaitItem key={wait.id} wait={wait} project={project} active={active} onRefresh={onRefresh} />)}
  </section>;
}

function WaitItem({ wait, project, active, onRefresh }: {
  wait: WorkflowWaitingThread; project: AgentProject; active: boolean; onRefresh: (project: AgentProject) => void;
}) {
  const { t, language } = useTranslation();
  const fieldId = useId();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [eventId, setEventId] = useState(() => crypto.randomUUID());
  const formatDate = (date: string) => new Date(date).toLocaleString(language);
  return <article className="workflow-waits__item">
    <strong>{wait.agentName}</strong><p>{wait.reason}</p>
    <dl><div><dt>{t("wait.next")}</dt><dd>{wait.wakeAt ? formatDate(wait.wakeAt) : t("wait.event")}</dd></div>
      <div><dt>{t("wait.deadline")}</dt><dd>{formatDate(wait.deadlineAt)}</dd></div></dl>
    {wait.eventKey && active && !wait.wake && <details><summary>{t("wait.reply")}</summary>
      <form onSubmit={async (event) => {
        event.preventDefault();
        if (busy || !message.trim()) return;
        setBusy(true); setFeedback("");
        try {
          await requestJson(`/api/agents/projects/${encodeURIComponent(project.projectId)}/workflow/events`, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ instanceId: project.workflowInstance!.id, id: eventId, key: wait.eventKey, payload: message })
          });
          setMessage(""); setEventId(crypto.randomUUID()); setFeedback(t("wait.sent"));
          onRefresh(await loadAgentProject(project.projectId));
        } catch (error) { setFeedback(error instanceof Error ? error.message : t("wait.error")); }
        finally { setBusy(false); }
      }}>
        <label htmlFor={fieldId}>{t("wait.message")}</label>
        <textarea id={fieldId} value={message} maxLength={32000} required disabled={busy} onChange={(event) => { setMessage(event.target.value); setEventId(crypto.randomUUID()); }} />
        <button type="submit" disabled={busy || !message.trim()}>{t("wait.submit")}</button>
        <p role="status">{feedback}</p>
      </form>
    </details>}
  </article>;
}
