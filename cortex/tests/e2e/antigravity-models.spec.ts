import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";

const quotaDefaults = { enabled: false, minimumFiveHourRemainingPercent: 50, minimumWeeklyRemainingPercent: 10 };

test.beforeEach(async ({ request }) => {
  await request.post("/__test/codex-models", { data: { unavailable: false, model: "gpt-server-sol" } });
  await request.post("/__test/antigravity-models", { data: { available: false, resetLastExecution: true } });
  await request.put("/api/agents/codex-quota", { data: quotaDefaults });
  await request.put("/api/prompt-queue/settings", { data: { maxConcurrentChats: 2, defaults: { workingDirectory: "", model: "", reasoningEffort: "", autoStart: true } } });
  await request.post("/__test/codex-quota", { data: { fiveHourUsed: 10, weeklyUsed: 10 } });
});

test.afterEach(async ({ request }) => {
  const overview = await (await request.get("/api/prompt-queue")).json();
  for (const chat of overview.chats) {
    await request.put(`/api/prompt-queue/chats/${chat.id}/pause`, { data: { paused: true } });
    const detail = await (await request.get(`/api/prompt-queue/chats/${chat.id}`)).json();
    for (const prompt of detail.prompts) if (prompt.status === "running") await request.post(`/api/prompt-queue/chats/${chat.id}/prompts/${prompt.id}/cancel`);
    await expect.poll(async () => (await (await request.get(`/api/prompt-queue/chats/${chat.id}`)).json()).prompts.some((prompt: any) => prompt.status === "running")).toBe(false);
    await request.delete(`/api/prompt-queue/chats/${chat.id}`);
  }
  await request.post("/__test/codex-models", { data: { unavailable: false, model: "gpt-server-sol" } });
  await request.post("/__test/antigravity-models", { data: { available: false, resetLastExecution: true } });
  await request.put("/api/agents/codex-quota", { data: quotaDefaults });
  await request.post("/__test/codex-quota", { data: {} });
});

async function createProject(request: APIRequestContext, engine: "codex" | "gemini") {
  const response = await request.post("/api/projects/create", {
    data: { name: `agy-${engine}-${randomUUID().slice(0, 8)}`, engine, description: "Un rédacteur Antigravity de test." }
  });
  expect(response.status()).toBe(201);
  return (await response.json()).project as { id: string };
}

const modelField = (page: Page) => page.getByRole("combobox", { name: /^Modèle/ });
const effortField = (page: Page) => page.getByRole("combobox", { name: /^Effort de raisonnement/ });

test("Antigravity families appear in agent editor and execution policy dropdowns when available and resolve exact CLI slugs", async ({ page, request }) => {
  await request.post("/__test/antigravity-models", { data: { available: true, resetLastExecution: true } });
  const geminiProject = await createProject(request, "gemini");

  await page.goto(`/?project=${geminiProject.id}`);
  await page.getByRole("button", { name: "Modifier le projet", exact: true }).click();

  const models = modelField(page);
  const efforts = effortField(page);
  await expect(models).toBeEnabled();
  await expect(page.getByText("Catalogue du serveur · Antigravity 1.5.14-fixture · Codex 0.163.0-fixture")).toBeVisible();
  await expect(models.locator('optgroup[label="Antigravity"]')).toHaveCount(1);
  await expect(models.locator('optgroup[label="Codex"]')).toHaveCount(1);
  expect(await models.locator('optgroup[label="Antigravity"] option').evaluateAll(options => options.map(o => (o as HTMLOptionElement).value)))
    .toEqual(["gemini-4-neon", "gemini-pro-orchestrator-neon", "claude-opus-5-5"]);

  await models.selectOption("gemini-pro-orchestrator-neon");
  await expect(efforts).toBeDisabled();

  await models.selectOption("gemini-4-neon");
  await expect(efforts).toBeEnabled();
  expect(await efforts.locator("option").evaluateAll(options => options.map(o => (o as HTMLOptionElement).value)))
    .toEqual(["", "low", "medium", "high", "xhigh"]);
  await efforts.selectOption("xhigh");

  expect((await new AxeBuilder({ page }).include(".agent-model-fields").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
  await page.getByRole("button", { name: /Enregistrer et fermer/ }).click();

  const saved = await (await request.get(`/api/agents/projects/${geminiProject.id}`)).json();
  expect(saved.agents[0]).toMatchObject({ model: "gemini-4-neon", reasoningEffort: "xhigh" });

  await page.getByRole("button", { name: "Lancer l’agent", exact: true }).click();
  await expect(page.getByText("Résultat Antigravity vérifié (gemini-4-neon-xhigh).", { exact: true }).first()).toBeVisible();
  expect(await (await request.post("/__test/last-gemini-execution")).json()).toEqual({
    model: "gemini-4-neon-xhigh",
    reasoningEffort: "xhigh"
  });

  // Execution quality panel dropdowns also expose Antigravity models and resolved profiles for Gemini projects.
  await page.goto(`/?project=${geminiProject.id}&view=instructions`);
  const panel = page.locator(".execution-quality");
  await panel.locator("summary").first().click();
  await expect(panel.getByText(/gemini-4-neon \/ xhigh · CLI 1\.5\.14-fixture/)).toBeVisible();
  await expect(panel.getByRole("combobox", { name: "Modèle par défaut du projet", exact: true }).locator('optgroup[label="Antigravity"] option[value="claude-opus-5-5"]')).toHaveCount(1);
  await expect(panel.getByRole("combobox", { name: "Modèle d’interprétation", exact: true }).locator('optgroup[label="Antigravity"] option[value="gemini-4-neon"]')).toHaveCount(1);

  // Codex projects also include Antigravity models when available and route execution to Antigravity.
  const codexProject = await createProject(request, "codex");
  await page.goto(`/?project=${codexProject.id}`);
  await page.getByRole("button", { name: "Modifier le projet", exact: true }).click();
  await expect(models).toBeEnabled();
  await expect(page.getByText("Catalogue du serveur · Codex 0.163.0-fixture · Antigravity 1.5.14-fixture")).toBeVisible();
  await models.selectOption("claude-opus-5-5");
  await efforts.selectOption("high");
  await page.getByRole("button", { name: /Enregistrer et fermer/ }).click();
  await page.getByRole("button", { name: "Lancer l’agent", exact: true }).click();
  await expect(page.getByText("Résultat Antigravity vérifié (claude-opus-5-5-high).", { exact: true }).first()).toBeVisible();
  expect(await (await request.post("/__test/last-gemini-execution")).json()).toEqual({
    model: "claude-opus-5-5-high",
    reasoningEffort: "high"
  });
});

test("Prompt Queue picker and settings show Antigravity families, execute via Antigravity without Codex quota blocks, and work when Codex is offline", async ({ page, request }) => {
  await request.post("/__test/antigravity-models", { data: { available: true, resetLastExecution: true } });
  await request.post("/__test/codex-quota", { data: { fiveHourUsed: 95, weeklyUsed: 95 } });

  await page.goto("/?mode=prompts");
  const trigger = page.getByRole("button", { name: "Choisir le modèle et le niveau de réflexion", exact: true });
  await expect(trigger).toBeEnabled();
  await trigger.click();
  const picker = page.getByRole("dialog", { name: "Modèle et réflexion", exact: true });
  const pickerModels = picker.getByRole("combobox", { name: "Modèle", exact: true });
  const pickerEfforts = picker.getByRole("combobox", { name: "Niveau de réflexion", exact: true });
  await expect(pickerModels).toBeEnabled();
  await expect(picker).toContainText("Codex 0.163.0-fixture · Antigravity 1.5.14-fixture");
  await expect(pickerModels.locator('optgroup[label="Antigravity"] option[value="gemini-4-neon"]')).toHaveCount(1);

  await pickerEfforts.selectOption("ultra");
  await pickerModels.selectOption("gemini-4-neon");
  await expect(pickerEfforts).toHaveValue("medium");
  await pickerEfforts.selectOption("xhigh");
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
  await page.keyboard.press("Escape");

  await page.getByRole("textbox", { name: "Votre message", exact: true }).fill("QUEUE_E2E Antigravity prompt");
  await page.getByRole("button", { name: "Envoyer", exact: true }).click();
  await expect(page.getByRole("article", { name: "1 · Terminé", exact: true })).toBeVisible();
  await expect(page.getByText("Antigravity (gemini-4-neon-xhigh) : QUEUE_E2E Antigravity prompt")).toBeVisible();
  expect(await (await request.post("/__test/last-gemini-execution")).json()).toEqual({
    model: "gemini-4-neon-xhigh",
    reasoningEffort: "xhigh"
  });

  // Settings dialog also displays grouped Antigravity families and localized efforts.
  const menu = page.getByRole("button", { name: "Afficher les chats", exact: true });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole("button", { name: "Paramètres", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "Paramètres", exact: true });
  const settingsModel = settings.getByRole("combobox", { name: "Modèle", exact: true });
  await expect(settingsModel).toBeEnabled();
  await expect(settingsModel.locator('optgroup[label="Antigravity"] option[value="gemini-4-neon"]')).toHaveCount(1);
  await settings.getByRole("button", { name: "Fermer", exact: true }).click();

  // When Codex becomes unavailable, Antigravity models stay available on their own.
  await request.post("/__test/codex-models", { data: { unavailable: true } });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await trigger.click();
  await expect(picker).toContainText("Antigravity 1.5.14-fixture");
  await expect(pickerModels).toBeEnabled();
  await expect(pickerModels.locator('option[value="gemini-4-neon"]')).toHaveCount(1);
  await expect(pickerModels.locator('option[value="gpt-server-sol"]')).toHaveCount(0);
});
