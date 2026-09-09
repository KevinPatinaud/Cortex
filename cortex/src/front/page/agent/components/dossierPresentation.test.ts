import assert from "node:assert/strict";
import test from "node:test";
import type { WorkflowJob } from "../../../../shared/WorkflowAutomation.ts";
import { dossierNextEvent, dossierReason, dossierTitle } from "./dossierPresentation.ts";

const job: WorkflowJob = { id: "one", ruleId: "rule", sourceProjectId: "source", sourceAgentId: "scan", sourceInstanceId: null,
  targetProjectId: "target", key: "one", title: "Saint-André T2 - PRMI FDA7374", payload: "", status: "waiting", error: null,
  createdAt: "2026-09-07T20:08:47Z", updatedAt: "2026-09-07T20:09:00Z" };

test("generic dossier titles retain their words and unspaced hyphens", () => {
  assert.deepEqual(dossierTitle(job.title), { title: "Saint-André T2", subtitle: "PRMI FDA7374" });
  assert.deepEqual(dossierTitle("Rapport Saint-André"), { title: "Rapport Saint-André" });
});

test("waiting summaries never invent a reply or a deadline and ignore stale waits after completion", () => {
  assert.match(dossierReason(job, "fr"), /réponse ou d’une échéance/);
  assert.equal(dossierNextEvent(job), undefined);
  const waiting: WorkflowJob = { ...job, waits: [
    { reason: "Confirmation de l’agence", deadlineAt: "2026-09-10T10:00:00Z", wakeAt: "2026-09-10T09:00:00Z" },
    { reason: "Validation du mandat", deadlineAt: "2026-09-09T10:00:00Z", wakeAt: null }
  ] };
  assert.equal(dossierReason(waiting, "fr"), "Confirmation de l’agence");
  assert.deepEqual(dossierNextEvent(waiting), { kind: "deadline", at: "2026-09-09T10:00:00Z" });
  assert.equal(dossierNextEvent({ ...waiting, status: "completed" }), undefined);
});

test("technical failures have readable summaries while clarification requests keep their actual reason", () => {
  assert.equal(dossierReason({ ...job, status: "failed", error: "spawn codex ENOENT" }, "fr"), "L’agent n’a pas pu démarrer.");
  assert.doesNotMatch(dossierReason({ ...job, status: "failed", error: "stack trace" }, "en"), /stack trace/);
  assert.equal(dossierReason({ ...job, status: "blocked", error: "Précisez le mandat." }, "fr"), "Précisez le mandat.");
});
