import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";

test.beforeEach(async ({ request }) => { await request.post("/__test/codex-models", { data: {} }); });
test.afterEach(async ({ request }) => { await request.post("/__test/codex-models", { data: {} }); });

async function openEditor(page: Page, request: APIRequestContext, engine = "codex") {
  const response = await request.post("/api/projects/create", { data: { name: `models-${randomUUID().slice(0, 8)}`, engine, description: "Un rédacteur de test." } });
  expect(response.status()).toBe(201);
  const { project } = await response.json();
  await page.goto(`/?project=${project.id}`);
  await page.getByRole("button", { name: "Modifier le projet", exact: true }).click();
  return project as { id: string };
}
const modelField = (page: Page) => page.getByRole("combobox", { name: /^Modèle/ });
const effortField = (page: Page) => page.getByRole("combobox", { name: /^Effort de raisonnement/ });

test("server models and supported efforts populate the editor, persist and reach actual execution options", async ({ page, request }, info) => {
  const project = await openEditor(page, request);
  const models = modelField(page), efforts = effortField(page);
  await expect(models).toBeEnabled();
  await expect(page.getByText("Catalogue du serveur · Codex 0.163.0-fixture")).toBeVisible();
  expect(await models.locator("option").evaluateAll(options => options.map(option => (option as HTMLOptionElement).value))).toEqual(["", "gpt-server-sol", "gpt-server-luna"]);
  await models.selectOption("gpt-server-sol");
  await efforts.selectOption("ultra");
  expect((await new AxeBuilder({ page }).include(".agent-model-fields").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
  await page.evaluate(() => { (document.activeElement as HTMLElement)?.blur(); });
  await page.locator(".agent-model-fields").scrollIntoViewIfNeeded();
  await page.screenshot({ path: info.outputPath("server-model-picker.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await models.selectOption("gpt-server-luna");
  await expect(efforts).toHaveValue("");
  await expect(efforts.locator('option[value="ultra"]')).toHaveCount(0);
  await efforts.selectOption("high");
  await page.getByRole("button", { name: /Enregistrer et fermer/ }).click();
  const saved = await (await request.get(`/api/agents/projects/${project.id}`)).json();
  expect(saved.agents[0]).toMatchObject({ model: "gpt-server-luna", reasoningEffort: "high" });
  await page.getByRole("button", { name: "Modifier le projet", exact: true }).click();
  await expect(models).toBeEnabled();
  await expect(models).toHaveValue("gpt-server-luna");
  await expect(efforts).toHaveValue("high");
  await expect(page.getByRole("button", { name: /Enregistrer et fermer/ })).toBeDisabled();
  await page.getByRole("button", { name: "Quitter l’édition", exact: true }).click();
  await page.getByRole("button", { name: "Lancer l’agent", exact: true }).click();
  await expect(page.getByText("Résultat vérifié du moteur simulé.", { exact: true }).first()).toBeVisible();
  expect(await (await request.post("/__test/last-codex-execution")).json()).toMatchObject({ model: "gpt-server-luna", reasoningEffort: "high" });
});

test("refresh picks up server upgrades and keeps existing model and effort values when a catalog changes or fails", async ({ page, request }) => {
  const project = await openEditor(page, request);
  const models = modelField(page), efforts = effortField(page);
  await expect(models).toBeEnabled();
  await models.selectOption("gpt-server-sol");
  await efforts.selectOption("max");
  await page.getByRole("button", { name: /Enregistrer et fermer/ }).click();
  await request.post("/__test/codex-models", { data: { model: "gpt-upgraded-server" } });
  await page.getByRole("button", { name: "Modifier le projet", exact: true }).click();
  await expect(models).toBeEnabled();
  await expect(models).toHaveValue("gpt-server-sol");
  await expect(efforts).toHaveValue("max");
  await expect(page.getByText(/Ce modèle enregistré ne figure pas/)).toBeVisible();
  await expect(models.locator('option[value="gpt-upgraded-server"]')).toHaveCount(1);
  await request.post("/__test/codex-models", { data: { unavailable: true } });
  await page.getByRole("button", { name: "Actualiser les modèles", exact: true }).click();
  await expect(page.getByText(/Liste des modèles indisponible/)).toBeVisible();
  await expect(models).toBeDisabled();
  await expect(models).toHaveValue("gpt-server-sol");
  await expect(efforts).toHaveValue("max");
  expect(await models.locator("option").evaluateAll(options => options.map(option => (option as HTMLOptionElement).value))).toEqual(["", "gpt-server-sol"]);
  const unchanged = await (await request.get(`/api/agents/projects/${project.id}`)).json();
  expect(unchanged.agents[0]).toMatchObject({ model: "gpt-server-sol", reasoningEffort: "max" });
  await request.post("/__test/codex-models", { data: { model: "gpt-upgraded-server" } });
  await page.getByRole("button", { name: "Actualiser les modèles", exact: true }).click();
  await expect(models).toBeEnabled();
  await models.selectOption("gpt-upgraded-server");
  await expect(efforts).toHaveValue("max");
  await expect(page.getByText(/Ce modèle enregistré ne figure pas/)).toHaveCount(0);
  await page.getByRole("button", { name: /Enregistrer et fermer/ }).click();
});

test("Claude keeps its existing model input and never queries the Codex catalog", async ({ page, request }) => {
  let requests = 0;
  page.on("request", request => { if (request.url().includes("/codex-models")) requests++; });
  await openEditor(page, request, "claude");
  const models = modelField(page);
  await expect(models).toBeEnabled();
  await expect(models).toHaveAttribute("list", /\S+/);
  await models.fill("sonnet");
  await expect(effortField(page)).toBeEnabled();
  await effortField(page).selectOption("high");
  expect(requests).toBe(0);
  await page.getByRole("button", { name: /Enregistrer et fermer/ }).click();
});
