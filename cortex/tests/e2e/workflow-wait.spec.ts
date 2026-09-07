import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import AxeBuilder from "@axe-core/playwright";

test("a durable request survives reload and resumes automatically from a reply", async ({ page, request }, testInfo) => {
  const name = `Attente hôtel ${randomUUID().slice(0, 8)}`;
  const created = await request.post("/api/projects/create", { data: { name, engine: "codex", description: "Test d’attente." } });
  expect(created.status()).toBe(201);
  const { project } = await created.json();
  const base = `/api/agents/projects/${project.id}`;
  const edited = await request.put(base, { data: { name, engine: "codex", instructions: "Attendre puis produire une synthèse.", agents: [
    { name: "1 Réservation hôtel", description: "Attend la confirmation.", prompt: "E2E_DURABLE_WAIT" },
    { name: "2 Bilan", description: "Résume la réservation.", prompt: "Produire le bilan." }
  ] } });
  expect(edited.ok()).toBeTruthy();
  const started = await request.post(`${base}/workflow/run`, { data: {} });
  expect(started.ok()).toBeTruthy();
  const { auditRunId } = await started.json();
  await page.goto(`/?project=${project.id}`);
  await expect(page.getByRole("region", { name: "Attentes du workflow" })).toBeVisible();
  await page.reload();
  await expect(page.getByText("En attente de la confirmation de l’hôtel", { exact: true })).toBeVisible();
  const hotel = page.locator(".agent-card").filter({ has: page.getByRole("heading", { name: "1 Réservation hôtel", exact: true }) });
  const summary = page.locator(".agent-card").filter({ has: page.getByRole("heading", { name: "2 Bilan", exact: true }) });
  await expect(hotel).toHaveClass(/agent-card--async/);
  await expect(hotel.getByText("Asynchrone · En attente", { exact: true })).toBeVisible();
  await expect(summary.locator(".agent-card__async-badge")).toHaveCount(0);
  const accessibility = await new AxeBuilder({ page }).include(".agent-card__async-badge").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(accessibility.violations).toEqual([]);
  await expect(hotel.getByText("En attente d’une réponse ou d’une échéance", { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await mkdir("artifacts/durable-workflows", { recursive: true });
  await page.screenshot({ path: `artifacts/durable-workflows/wait-${testInfo.project.name}.png`, fullPage: true });
  await page.getByText("Apporter une réponse", { exact: true }).click();
  await page.getByRole("textbox", { name: "Réponse reçue", exact: true }).fill("Votre réservation est confirmée. Référence HOTEL-123.");
  await page.getByRole("button", { name: "Transmettre au workflow", exact: true }).click();
  await expect.poll(async () => (await (await request.get(base)).json()).workflowInstance?.status).toBe("completed");
  await expect(page.getByRole("region", { name: "Attentes du workflow" })).toHaveCount(0);
  await expect(hotel.getByText("Asynchrone", { exact: true })).toBeVisible();
  await expect(hotel).not.toHaveClass(/agent-card--waiting/);
  await page.reload();
  await expect(hotel.getByText("Asynchrone", { exact: true })).toBeVisible();
  await expect(summary.locator(".agent-card__async-badge")).toHaveCount(0);
  const audit = await (await request.get(`${base}/audit/runs/${auditRunId}`)).json();
  expect(audit.status).toBe("succeeded");
  expect(audit.executions).toHaveLength(3);
  expect(audit.executions.filter((execution: { agentName: string }) => execution.agentName === "1 Réservation hôtel")).toHaveLength(2);
});

test("the stop button cancels a suspended request", async ({ page, request }) => {
  const name = `Annulation attente ${randomUUID().slice(0, 8)}`;
  const created = await request.post("/api/projects/create", { data: { name, engine: "codex", description: "Test." } });
  const { project } = await created.json();
  const base = `/api/agents/projects/${project.id}`;
  await request.put(base, { data: { name, engine: "codex", instructions: "Attendre.", agents: [
    { name: "Réservation", description: "Attend.", prompt: "E2E_DURABLE_WAIT" }
  ] } });
  await request.post(`${base}/workflow/run`, { data: {} });
  await page.goto(`/?project=${project.id}`);
  await page.locator(".agent-project__stop-button").click();
  await expect.poll(async () => (await (await request.get(base)).json()).workflowInstance?.status).toBe("cancelled");
  await expect(page.getByText("Apporter une réponse", { exact: true })).toHaveCount(0);
});
