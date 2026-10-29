import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";

for (const failed of [false, true]) test(`history preserves the execution journal, pagination and export after reload (${failed ? "failure" : "success"})`, async ({ page, request }, testInfo) => {
  const name = `Journal-${randomUUID().slice(0, 8)}`;
  const created = await request.post("/api/projects/create", { data: { name, engine: "codex", generationMode: "empty", instructions: "Trace regression" } });
  expect(created.status()).toBe(201);
  const { project } = await created.json();
  const base = `/api/agents/projects/${project.id}`;
  expect((await request.put(base, { data: { name, engine: "codex", instructions: "Trace regression",
    agents: [{ name: "Vérificateur", description: "Vérifie le journal", prompt: `E2E_EXECUTION_TRACE ${failed ? "E2E_FAIL" : ""}` }] } })).ok()).toBe(true);
  const execution = await request.post(`${base}/workflow/run`, { data: {} });
  expect(execution.ok()).toBe(!failed);
  const runs = await (await request.get(`${base}/audit/runs?scope=workflow`)).json();
  const run = runs.items[0];
  expect(run.status).toBe(failed ? "failed" : "succeeded");
  const detail = await (await request.get(`${base}/audit/runs/${run.id}`)).json();
  const traceUrl = `${base}/audit/runs/${run.id}/executions/${detail.executions[0].id}/trace`;
  expect((await request.get(`${traceUrl}?afterId=-1`)).status()).toBe(400);
  expect((await request.get(traceUrl.replace(project.id, "other-project"))).status()).toBe(404);
  const exported = await (await request.get(`${base}/audit/runs/${run.id}/export`)).json();
  const entries = exported.executions[0].trace;
  expect(entries.filter((entry: { phase: string }) => entry.phase === "mission")).toHaveLength(107);
  expect(entries.find((entry: { content: string }) => entry.content.includes("Vérification terminée"))).toBeTruthy();

  await page.goto(`/?project=${project.id}&view=audit`);
  const journal = page.locator(".workflow-audit__journal").first();
  await journal.locator(":scope > summary").click();
  await expect(journal).toContainText("Je commence par examiner les fichiers");
  await expect(journal.locator(".workflow-audit__trace-list > li")).toHaveCount(100);
  const tool = journal.locator(".workflow-audit__trace-list > li details").first();
  await tool.locator("summary").click();
  await expect(tool.locator("pre")).toContainText("Résultat du test 0 : OK");
  await journal.getByRole("button", { name: "Charger la suite du journal" }).click();
  await expect(journal.locator(".workflow-audit__trace-list > li")).toHaveCount(entries.length);
  await expect(journal).toContainText("Vérification terminée");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await journal.evaluate(element => window.scrollTo(0, window.scrollY + element.getBoundingClientRect().top - 240));
  await page.screenshot({ path: testInfo.outputPath("execution-journal.png") });
  await page.reload();
  await page.locator(".workflow-audit__journal").first().locator(":scope > summary").click();
  await expect(page.locator(".workflow-audit__journal").first()).toContainText("Je commence par examiner les fichiers");
});
