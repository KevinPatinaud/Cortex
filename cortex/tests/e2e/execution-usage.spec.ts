import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";

for (const outcome of ["success", "failure", "unavailable"] as const) test(`history shows persistent token usage (${outcome})`, async ({ page, request }, testInfo) => {
  const name = `Tokens-${randomUUID().slice(0, 8)}`;
  const created = await request.post("/api/projects/create", { data: { name, engine: "codex", generationMode: "empty", instructions: "Token usage regression" } });
  expect(created.status()).toBe(201);
  const { project } = await created.json();
  const base = `/api/agents/projects/${project.id}`;
  expect((await request.put(base, { data: { name, engine: "codex", instructions: "Token usage regression",
    agents: [{ name: "Vérificateur", description: "Vérifie la consommation", prompt: `${outcome === "unavailable" ? "NO_USAGE" : "E2E_EXECUTION_USAGE"} ${outcome === "failure" ? "E2E_FAIL" : ""}` }] } })).ok()).toBe(true);
  expect((await request.post(`${base}/workflow/run`, { data: {} })).ok()).toBe(outcome !== "failure");
  const runs = await (await request.get(`${base}/audit/runs?scope=workflow`)).json();
  const run = runs.items[0];
  const exported = await (await request.get(`${base}/audit/runs/${run.id}/export`)).json();
  const usage = exported.executions[0].usage;
  if (outcome === "unavailable") expect(usage).toBeUndefined();
  else {
    expect(usage.mission.totalTokens).toBe(6800);
    expect(usage.total.totalTokens).toBe(outcome === "failure" ? 6800 : 7500);
    expect(usage.total.cachedInputTokens).toBe(4000);
    expect(usage.total.reasoningOutputTokens).toBe(300);
    if (outcome === "success") expect(usage.interpretation.totalTokens).toBe(700);
  }
  await page.goto(`/?project=${project.id}&view=audit`);
  const summary = page.getByRole("region", { name: "Consommation de tokens", exact: true });
  await expect(summary).toBeVisible();
  if (outcome === "unavailable") {
    await expect(summary).toContainText("Non disponible");
    await expect(summary.locator(".workflow-audit__tokens-total")).toHaveCount(0);
  } else {
    await expect(summary.locator(".workflow-audit__tokens-total")).toHaveText(outcome === "failure" ? /6\s*800 tokens mesurés/ : /7\s*500 tokens mesurés/);
    await expect(summary).toContainText("Cache lu");
    await expect(summary.locator(".workflow-audit__tokens-partial")).toHaveCount(outcome === "failure" ? 1 : 0);
    if (outcome === "success") await expect(summary).toContainText("Interprétation du résultat");
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await summary.screenshot({ path: testInfo.outputPath("token-usage.png") });
  await page.reload();
  await expect(page.getByRole("region", { name: "Consommation de tokens", exact: true })).toContainText(outcome === "unavailable" ? "Non disponible" : "tokens mesurés");
});
