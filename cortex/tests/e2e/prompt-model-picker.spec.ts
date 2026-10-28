import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const quotaDefaults = { enabled: false, minimumFiveHourRemainingPercent: 50, minimumWeeklyRemainingPercent: 10 };
test.beforeEach(async ({ request }) => {
  await request.post("/__test/codex-models", { data: { unavailable: false, model: "gpt-server-sol" } });
  await request.put("/api/agents/codex-quota", { data: quotaDefaults });
  await request.put("/api/prompt-queue/settings", { data: { maxConcurrentChats: 2, defaults: { workingDirectory: "", model: "", reasoningEffort: "", autoStart: true } } });
  await request.post("/__test/codex-quota", { data: { fiveHourUsed: 51, weeklyUsed: 0 } });
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
  await request.put("/api/agents/codex-quota", { data: quotaDefaults });
  await request.post("/__test/codex-quota", { data: {} });
});

async function openPicker(page: Page) {
  const button = page.getByRole("button", { name: "Choisir le modèle et le niveau de réflexion", exact: true });
  await expect(button).toBeEnabled();
  await button.click();
  const picker = page.getByRole("dialog", { name: "Modèle et réflexion", exact: true });
  await expect(picker).toBeVisible();
  await expect(picker.getByRole("combobox", { name: "Modèle", exact: true })).toBeEnabled();
  return picker;
}

test("composer exposes compatible model efforts and snapshots every queued turn's actual execution profile", async ({ page, request }, info) => {
  await page.goto("/?mode=prompts");
  let picker = await openPicker(page);
  await picker.getByRole("combobox", { name: "Niveau de réflexion", exact: true }).selectOption("ultra");
  await picker.getByRole("combobox", { name: "Modèle", exact: true }).selectOption("gpt-server-luna");
  await expect(picker.getByRole("combobox", { name: "Niveau de réflexion", exact: true })).toHaveValue("medium");
  await expect(picker.getByRole("combobox", { name: "Niveau de réflexion", exact: true }).getByRole("option", { name: "Ultra", exact: true })).toHaveCount(0);
  await picker.getByRole("combobox", { name: "Niveau de réflexion", exact: true }).selectOption("high");
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
  await page.screenshot({ path: info.outputPath("model-and-reasoning-picker.png"), fullPage: true });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Choisir le modèle et le niveau de réflexion", exact: true })).toBeFocused();
  await page.locator(".prompt-composer").screenshot({ path: info.outputPath("compact-model-selector.png") });
  await page.getByRole("textbox", { name: "Votre message", exact: true }).fill("QUEUE_E2E Selected Luna");
  await page.getByRole("button", { name: "Envoyer", exact: true }).click();
  await expect(page.getByRole("heading", { name: "QUEUE_E2E Selected Luna", exact: true })).toBeVisible();
  await page.getByRole("dialog", { name: "Prompt placé en file d’attente", exact: true }).getByRole("button", { name: "Garder en file d’attente", exact: true }).click();
  picker = await openPicker(page);
  await picker.getByRole("combobox", { name: "Modèle", exact: true }).selectOption("gpt-server-sol");
  await picker.getByRole("combobox", { name: "Niveau de réflexion", exact: true }).selectOption("ultra");
  await picker.getByRole("button", { name: "Fermer", exact: true }).click();
  await page.getByRole("textbox", { name: "Votre message", exact: true }).fill("QUEUE_E2E Selected Sol");
  await page.getByRole("button", { name: "Envoyer", exact: true }).click();
  await expect(page.getByRole("article", { name: "2 · En attente", exact: true })).toBeVisible();
  await page.getByRole("dialog", { name: "Prompt placé en file d’attente", exact: true }).getByRole("button", { name: "Garder en file d’attente", exact: true }).click();
  const id = new URL(page.url()).searchParams.get("chat");
  const detail = await (await request.get(`/api/prompt-queue/chats/${id}`)).json();
  expect(detail.prompts.map((prompt: any) => [prompt.model, prompt.reasoningEffort])).toEqual([["gpt-server-luna", "high"], ["gpt-server-sol", "ultra"]]);
  await page.reload();
  const button = page.getByRole("button", { name: "Choisir le modèle et le niveau de réflexion", exact: true });
  await expect(button).toContainText("Sol du serveur");
  await expect(button).toContainText("Ultra");
  await request.post("/__test/codex-quota", { data: { fiveHourUsed: 50, weeklyUsed: 90 } });
  await expect(page.getByRole("article", { name: "2 · Terminé", exact: true })).toBeVisible();
  expect(await (await request.post("/__test/last-codex-execution")).json()).toEqual({ model: "gpt-server-sol", reasoningEffort: "ultra" });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("the catalog updates on window focus, preserves removed choices visibly and recovers after discovery fails", async ({ page, request }) => {
  await page.goto("/?mode=prompts");
  const button = page.getByRole("button", { name: "Choisir le modèle et le niveau de réflexion", exact: true });
  await expect(button).toContainText("Sol du serveur");
  const initialPicker = await openPicker(page);
  await initialPicker.getByRole("combobox", { name: "Niveau de réflexion", exact: true }).selectOption("high");
  await page.keyboard.press("Escape");
  await request.post("/__test/codex-models", { data: { model: "gpt-newly-available-sol" } });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  const picker = await openPicker(page);
  await expect(picker.getByRole("combobox", { name: "Modèle", exact: true }).locator('option[value="gpt-newly-available-sol"]')).toHaveCount(1);
  await expect(picker.getByRole("alert")).toContainText("ne figure plus dans le catalogue");
  await expect(picker.getByRole("combobox", { name: "Modèle", exact: true })).toHaveValue("gpt-server-sol");
  await picker.getByRole("combobox", { name: "Modèle", exact: true }).selectOption("gpt-newly-available-sol");
  await expect(picker.getByRole("alert")).toHaveCount(0);
  await request.post("/__test/codex-models", { data: { unavailable: true } });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(picker.getByRole("status")).toContainText("Impossible de lire les modèles");
  await request.post("/__test/codex-models", { data: { model: "gpt-newly-available-sol", unavailable: false } });
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(picker.getByRole("status")).toHaveCount(0);
  await expect(picker.getByRole("combobox", { name: "Modèle", exact: true })).toHaveValue("gpt-newly-available-sol");
});

test("draft selections stay isolated when preparing several conversations", async ({ page, request }) => {
  const a = await (await request.post("/api/prompt-queue/chats", { data: { title: "Chat A", model: "gpt-server-sol", reasoningEffort: "ultra", paused: true } })).json();
  const b = await (await request.post("/api/prompt-queue/chats", { data: { title: "Chat B", model: "gpt-server-luna", reasoningEffort: "high", paused: true } })).json();
  await page.goto(`/?mode=prompts&chat=${a.id}`);
  let picker = await openPicker(page);
  await picker.getByRole("combobox", { name: "Niveau de réflexion", exact: true }).selectOption("low");
  await page.keyboard.press("Escape");
  const switchChat = async (title: string) => {
    const menu = page.getByRole("button", { name: "Afficher les chats", exact: true });
    if (await menu.isVisible()) await menu.click();
    await page.getByRole("button", { name: new RegExp(title) }).click();
    await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
  };
  await switchChat("Chat B");
  picker = await openPicker(page);
  await expect(picker.getByRole("combobox", { name: "Modèle", exact: true })).toHaveValue("gpt-server-luna");
  await expect(picker.getByRole("combobox", { name: "Niveau de réflexion", exact: true })).toHaveValue("high");
  await page.keyboard.press("Escape");
  await switchChat("Chat A");
  picker = await openPicker(page);
  await expect(picker.getByRole("combobox", { name: "Modèle", exact: true })).toHaveValue("gpt-server-sol");
  await expect(picker.getByRole("combobox", { name: "Niveau de réflexion", exact: true })).toHaveValue("low");
});
