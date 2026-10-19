import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";

const defaults = { enabled: false, minimumFiveHourRemainingPercent: 50, minimumWeeklyRemainingPercent: 10 };

test.beforeEach(async ({ request }) => {
  expect((await request.put("/api/agents/codex-quota", { data: defaults })).ok()).toBe(true);
  await request.post("/__test/codex-quota", { data: {} });
});
test.afterEach(async ({ request }) => {
  await request.put("/api/agents/codex-quota", { data: defaults });
  await request.post("/__test/codex-quota", { data: {} });
});

async function openSettings(page: Page) {
  const trigger = page.locator(".agent-engine-settings-trigger");
  if (!await trigger.isVisible()) await page.getByRole("button", { name: "Afficher la liste des projets", exact: true }).click();
  await trigger.click();
  await expect(page.locator(".codex-quota-panel input[type=checkbox]")).toBeEnabled();
  return page.locator(".codex-quota-panel");
}

test("quota settings persist, show real API readings, and gate manual launches at the configured boundary", async ({ page, request }, info) => {
  const created = await request.post("/api/projects/create", { data: { name: `quota-${randomUUID().slice(0, 8)}`, engine: "codex", description: "Un rédacteur de test." } });
  expect(created.status()).toBe(201);
  const { project } = await created.json();
  await page.goto(`/?project=${project.id}`);
  await expect(page.getByRole("button", { name: "Modifier le projet", exact: true })).toBeVisible();
  const panel = await openSettings(page);
  await expect(panel.getByRole("spinbutton", { name: "Minimum restant sur 5 h (%)", exact: true })).toHaveValue("50");
  await expect(panel.getByRole("checkbox")).not.toBeChecked();
  await panel.getByRole("spinbutton", { name: "Minimum restant sur 5 h (%)", exact: true }).fill("60");
  await panel.getByRole("spinbutton", { name: "Minimum restant sur la semaine (%)", exact: true }).fill("15");
  await panel.getByRole("button", { name: "Enregistrer les seuils" }).click();
  await expect(panel.getByText("Règle de quota enregistrée.")).toBeVisible();
  await panel.getByRole("checkbox").check();
  await expect(panel.getByRole("checkbox")).toBeChecked();
  await panel.getByRole("button", { name: "Vérifier les quotas du serveur" }).click();
  await expect(panel.getByText("50 % restants", { exact: true })).toBeVisible();
  await expect(panel.getByText("10 % restants", { exact: true })).toBeVisible();
  expect((await new AxeBuilder({ page }).include(".codex-quota-panel").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
  await panel.scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath("quota-settings.png") });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Lancer l’agent", exact: true }).click();
  await expect(page.getByText(/Lancement bloqué par les quotas Codex/).first()).toBeVisible();
  const blocked = await request.post(`/api/agents/projects/${project.id}/workflow/run`, { data: {} });
  expect(blocked.status()).toBe(400);
  const loaded = await (await request.get(`/api/agents/projects/${project.id}`)).json();
  expect(loaded.agents[0].hasSession).toBe(false);
  await page.reload();
  const persisted = await openSettings(page);
  await expect(persisted.getByRole("checkbox")).toBeChecked();
  await expect(persisted.getByRole("spinbutton", { name: "Minimum restant sur 5 h (%)", exact: true })).toHaveValue("60");
  await page.keyboard.press("Escape");
  await request.post("/__test/codex-quota", { data: { fiveHourUsed: 40, weeklyUsed: 85 } });
  await page.getByRole("button", { name: "Lancer l’agent", exact: true }).click();
  await expect(page.getByText("Résultat vérifié du moteur simulé.", { exact: true }).first()).toBeVisible();
});

test("weekly quota and unavailable readings block launches; disabling restores launches and invalid values are rejected", async ({ page, request }) => {
  const created = await request.post("/api/projects/create", { data: { name: `quota-errors-${randomUUID().slice(0, 8)}`, engine: "codex", description: "Un rédacteur de test." } });
  const { project } = await created.json();
  await page.goto(`/?project=${project.id}`);
  await request.put("/api/agents/codex-quota", { data: { ...defaults, enabled: true } });
  await request.post("/__test/codex-quota", { data: { fiveHourUsed: 0, weeklyUsed: 91 } });
  const workflowPath = `/api/agents/projects/${project.id}/workflow/run`;
  let blocked = await request.post(workflowPath, { data: {} });
  expect(blocked.status()).toBe(400);
  expect((await blocked.json()).error).toContain("semaine : 9 % restants");
  await request.post("/__test/codex-quota", { data: { unavailable: true } });
  blocked = await request.post(workflowPath, { data: {} });
  expect(blocked.status()).toBe(400);
  expect((await blocked.json()).error).toContain("indisponibles");
  const invalid = await request.put("/api/agents/codex-quota", { data: { ...defaults, minimumWeeklyRemainingPercent: 101 } });
  expect(invalid.status()).toBe(400);
  expect((await (await request.get("/api/agents/codex-quota")).json()).enabled).toBe(true);
  await page.reload();
  const panel = await openSettings(page);
  await panel.getByRole("button", { name: "Vérifier les quotas du serveur" }).click();
  await expect(panel.getByText(/Les deux quotas n’ont pas pu être vérifiés/)).toBeVisible();
  await panel.getByRole("spinbutton", { name: "Minimum restant sur 5 h (%)", exact: true }).fill("");
  await expect(panel.getByRole("button", { name: "Enregistrer les seuils" })).toBeDisabled();
  await panel.getByRole("checkbox").uncheck();
  await expect(panel.getByRole("checkbox")).not.toBeChecked();
  await page.keyboard.press("Escape");
  expect((await request.post(workflowPath, { data: {} })).ok()).toBe(true);
});

test("a failed save restores the actual toggle state and keeps unsaved threshold edits", async ({ page }) => {
  await page.goto("/");
  const panel = await openSettings(page);
  await panel.getByRole("spinbutton", { name: "Minimum restant sur 5 h (%)", exact: true }).fill("75");
  await page.route("**/api/agents/codex-quota", route => route.request().method() === "PUT"
    ? route.fulfill({ status: 503, json: { error: "Échec simulé de l’enregistrement." } }) : route.continue());
  await panel.getByRole("checkbox").click();
  await expect(panel.getByRole("alert")).toHaveText("Échec simulé de l’enregistrement.");
  await expect(panel.getByRole("checkbox")).not.toBeChecked();
  await expect(panel.getByRole("spinbutton", { name: "Minimum restant sur 5 h (%)", exact: true })).toHaveValue("75");
  await expect(panel.getByRole("button", { name: "Enregistrer les seuils" })).toBeEnabled();
});
