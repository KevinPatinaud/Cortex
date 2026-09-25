import { test, expect } from "@playwright/test";
import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";

test("project pause survives reload, retains replies and daily budgets gate actual calls", async ({ page, request }, testInfo) => {
  const name = `Pause ${randomUUID().slice(0, 8)}`;
  const created = await request.post("/api/projects/create", { data: { name, engine: "codex", generationMode: "empty" } });
  expect(created.status()).toBe(201);
  const { project } = await created.json();
  const base = `/api/agents/projects/${project.id}`;
  const control = `/api/projects/${project.id}/execution-control`;
  const edited = await request.put(base, { data: { name, engine: "codex", instructions: "Attend a reply.", agents: [
    { name: "Réservation", description: "Attente", prompt: "E2E_DURABLE_WAIT" }
  ] } });
  expect(edited.ok()).toBeTruthy();
  expect((await request.post(`${base}/workflow/run`, { data: {} })).ok()).toBeTruthy();
  await page.goto(`/?project=${project.id}`);
  await page.getByRole("button", { name: "Mettre le projet en pause" }).click();
  await expect(page.getByRole("button", { name: "Réactiver le projet" })).toBeEnabled();
  await page.reload();
  await expect(page.getByRole("button", { name: "Réactiver le projet" })).toBeEnabled();
  const before = await (await request.get(control)).json();
  const state = await (await request.get(`${base}/runtime`)).json();
  expect((await request.post(`${base}/workflow/events`, { data: { instanceId: state.workflowInstance.id, id: "reply", key: "hotel:demo", payload: "Confirmed" } })).status()).toBe(202);
  expect((await request.post(`${base}/workflow/resume`, { data: {} })).status()).toBe(400);
  await page.getByText("Consommation et limites", { exact: true }).click();
  await page.getByLabel("Appels par jour (UTC)", { exact: true }).fill(String(before.usage.calls));
  await page.getByRole("button", { name: "Enregistrer les limites" }).click();
  await expect(page.getByText("Réglages enregistrés.")).toBeVisible();
  expect((await (await request.get(control)).json()).usage.calls).toBe(before.usage.calls);
  expect((await (await request.get(`${base}/runtime`)).json()).workflowInstance.status).toBe("waiting");
  expect((await new AxeBuilder({ page }).include(".execution-controls").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
  await page.screenshot({ path: testInfo.outputPath("execution-controls.png"), fullPage: true });
  await page.getByLabel("Appels par jour (UTC)", { exact: true }).fill("");
  await page.getByRole("button", { name: "Enregistrer les limites" }).click();
  await expect(page.getByText("Réglages enregistrés.")).toBeVisible();
  await page.getByRole("button", { name: "Réactiver le projet" }).click();
  await expect.poll(async () => (await (await request.get(`${base}/runtime`)).json()).workflowInstance.status).toBe("completed");
  expect((await (await request.get(control)).json()).usage.calls).toBe(before.usage.calls + 1);
});

test("an exhausted budget still allows opening the project and correcting its limits", async ({ page, request }) => {
  const name = `Budget ${randomUUID().slice(0, 8)}`;
  const created = await request.post("/api/projects/create", { data: { name, engine: "codex", generationMode: "empty" } });
  const { project } = await created.json();
  const base = `/api/agents/projects/${project.id}`;
  const control = `/api/projects/${project.id}/execution-control`;
  const draft = { name, engine: "codex", instructions: "Prepare then review.", agents: [
    { name: "Prepare", description: "First", prompt: "Prepare the result." },
    { name: "Review", description: "Second", prompt: "Review the result." }
  ] };
  expect((await request.put(base, { data: draft })).ok()).toBeTruthy();
  expect((await request.get(base)).ok()).toBeTruthy();
  const before = await (await request.get(control)).json();
  expect(before.usage.calls).toBeGreaterThan(0);
  expect((await request.put(control, { data: { maxCallsPerDay: before.usage.calls } })).ok()).toBeTruthy();
  expect((await request.put(base, { data: { ...draft, instructions: "Prepare then review the revised specification." } })).ok()).toBeTruthy();
  await page.goto(`/?project=${project.id}`);
  await expect(page.getByRole("alert").filter({ hasText: "Graphe indisponible" })).toBeVisible();
  expect((await request.post(`${base}/workflow/run`, { data: {} })).status()).toBe(400);
  expect((await (await request.get(control)).json()).usage.calls).toBe(before.usage.calls);
  await page.getByText("Consommation et limites", { exact: true }).click();
  await page.getByLabel("Appels par jour (UTC)", { exact: true }).fill("");
  await page.getByRole("button", { name: "Enregistrer les limites" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Graphe indisponible" })).toHaveCount(0);
  await expect.poll(async () => (await (await request.get(control)).json()).usage.calls).toBe(before.usage.calls + 1);
});
