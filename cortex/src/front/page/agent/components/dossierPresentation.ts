import type { WorkflowJob, WorkflowJobStatus } from "../../../../shared/WorkflowAutomation.ts";
import type { Language } from "../../../i18n.tsx";

export function dossierStatus(status: WorkflowJobStatus, language: Language): string {
  const labels: Record<WorkflowJobStatus, [string, string]> = {
    queued: ["En file d’attente", "Queued"], running: ["En cours", "Running"], waiting: ["En attente", "Waiting"],
    blocked: ["À préciser", "Needs input"], completed: ["Terminé", "Completed"], cancelled: ["Arrêté", "Stopped"],
    failed: ["Échec", "Failed"], interrupted: ["Interrompu", "Interrupted"]
  };
  return labels[status][language === "fr" ? 0 : 1];
}

export function dossierReason(job: WorkflowJob, language: Language): string {
  const say = (fr: string, en: string) => language === "fr" ? fr : en;
  if (job.status === "blocked") return job.error || say("Des précisions sont nécessaires pour reprendre.", "More information is needed to resume.");
  if (job.status === "failed") return job.error && /\bspawn\b.*\bENOENT\b/i.test(job.error)
    ? say("L’agent n’a pas pu démarrer.", "The agent could not start.")
    : say("L’exécution a échoué. Consultez le diagnostic.", "Execution failed. Review the diagnostic.");
  if (job.status === "interrupted") return say("L’exécution a été interrompue. Vérifiez avant de reprendre.", "Execution was interrupted. Review before resuming.");
  if (job.status === "waiting") return job.waits?.[0]?.reason || say("En attente d’une réponse ou d’une échéance.", "Waiting for a reply or a deadline.");
  if (job.status === "queued") return say("Démarrera dès qu’une place sera disponible.", "Will start when capacity is available.");
  if (job.status === "running") return say("L’agent travaille dans ce dossier.", "The agent is working on this dossier.");
  if (job.status === "completed") return say("Le résultat est disponible dans le dossier.", "The result is available in the dossier.");
  return say("Le suivi de ce dossier est arrêté.", "Follow-up for this dossier has stopped.");
}

/** Keep arbitrary user titles intact; only split an explicit, spaced subtitle separator. */
export function dossierTitle(title: string): { title: string; subtitle?: string } {
  const match = /^(.*?)\s[-–—]\s(.+)$/.exec(title);
  return match ? { title: match[1], subtitle: match[2] } : { title };
}

export function dossierNextEvent(job: WorkflowJob): { at: string; kind: "wake" | "deadline" } | undefined {
  if (job.status !== "waiting") return undefined;
  return job.waits?.flatMap(wait => [
    { at: wait.deadlineAt, kind: "deadline" as const },
    ...(wait.wakeAt ? [{ at: wait.wakeAt, kind: "wake" as const }] : [])
  ]).filter(event => Number.isFinite(Date.parse(event.at))).sort((a, b) => Date.parse(a.at) - Date.parse(b.at))[0];
}
