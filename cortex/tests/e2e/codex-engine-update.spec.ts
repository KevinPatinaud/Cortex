import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const status = (state: string, installedVersion = "0.147.0") => ({ state, installedVersion, latestVersion: "0.164.0", checkedAt: new Date().toISOString(), updatedAt: state === "updated" ? new Date().toISOString() : null, error: state === "error" ? "Simulated failure" : null });
test.beforeEach(async ({ request }) => {
  await request.post("/__test/codex-models", { data: { model: "old-catalog-model" } });
  await request.post("/__test/codex-engine-state", { data: status("installing") });
  await request.put("/api/prompt-queue/settings", { data: { defaults: { workingDirectory: "", model: "", reasoningEffort: "", autoStart: true } } });
});
test.afterEach(async ({ request }) => {
  await request.post("/__test/codex-engine-state", { data: { state: null } });
  await request.post("/__test/codex-models", { data: {} });
});
async function picker(page: Page) {
  await page.goto("/?mode=prompts");
  await page.getByRole("button", { name: "Choisir le modèle et le niveau de réflexion", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Modèle et réflexion", exact: true });
  await expect(dialog.getByRole("combobox", { name: "Modèle", exact: true })).toBeEnabled();
  return dialog;
}

test("the engine update is visible and the installed runtime's catalog refreshes automatically without silently replacing a draft selection", async ({ page, request }, info) => {
  const dialog = await picker(page);
  await expect(dialog.getByRole("status")).toContainText("Installation de Codex 0.164.0");
  await expect(dialog).toContainText("Codex 0.147.0");
  await request.post("/__test/codex-engine-state", { data: status("waiting") });
  await expect(dialog.getByRole("status")).toContainText("Activation après les exécutions");
  await request.post("/__test/codex-models", { data: { model: "new-catalog-model" } });
  await request.post("/__test/codex-engine-state", { data: status("updated", "0.164.0") });
  await expect(dialog).toContainText("Codex 0.164.0");
  await expect(dialog.getByRole("status")).toContainText("mis à jour automatiquement");
  await expect(dialog.getByRole("combobox", { name: "Modèle", exact: true }).locator('option[value="new-catalog-model"]')).toHaveCount(1);
  await expect(dialog.getByRole("combobox", { name: "Modèle", exact: true })).toHaveValue("old-catalog-model");
  await dialog.getByRole("combobox", { name: "Modèle", exact: true }).selectOption("new-catalog-model");
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
  await page.screenshot({ path: info.outputPath("updated-engine-catalog.png"), fullPage: true });
});

test("a failed update leaves the picker usable and its refresh action requests a new check", async ({ page, request }) => {
  await request.post("/__test/codex-engine-state", { data: status("error") });
  const dialog = await picker(page);
  await expect(dialog.getByRole("status")).toContainText("version précédente reste disponible");
  await expect(dialog.getByRole("combobox", { name: "Modèle", exact: true })).toHaveValue("old-catalog-model");
  const before = await (await request.post("/__test/codex-engine-state", { data: status("error") })).json();
  await dialog.getByRole("button", { name: "Actualiser les modèles", exact: true }).click();
  await expect(dialog.getByRole("status")).toContainText("Vérification de la version");
  const after = await (await request.post("/__test/codex-engine-state", { data: status("up_to_date", "0.164.0") })).json();
  expect(after.checks).toBe(before.checks + 1);
  await expect(dialog.getByRole("status")).toContainText("est à jour");
});

test("an initially unavailable CLI still shows installation progress and recovers automatically", async ({ page }) => {
  let unavailable = true;
  await page.route("**/api/prompt-queue/models", async route => {
    if (!unavailable) { await route.continue(); return; }
    await route.fulfill({ contentType: "application/json", body: JSON.stringify({ available: false, models: [], cliVersion: null, defaultModel: null,
      checkedAt: new Date().toISOString(), error: "Moteur temporairement indisponible", engineUpdate: status("installing") }) });
  });
  await page.goto("/?mode=prompts");
  await page.getByRole("button", { name: "Choisir le modèle et le niveau de réflexion", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Modèle et réflexion", exact: true });
  await expect(dialog.getByText("Installation de Codex 0.164.0 en arrière-plan…", { exact: true })).toBeVisible();
  unavailable = false;
  await expect(dialog.getByRole("combobox", { name: "Modèle", exact: true })).toBeEnabled();
});
