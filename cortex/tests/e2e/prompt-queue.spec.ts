import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const quotaDefaults = { enabled: false, minimumFiveHourRemainingPercent: 50, minimumWeeklyRemainingPercent: 10 };
const chatDefaults = { workingDirectory: "", model: "", reasoningEffort: "", autoStart: true };

test.beforeEach(async ({ request }) => {
  await request.put("/api/agents/codex-quota", { data: quotaDefaults });
  await request.post("/__test/codex-quota", { data: { fiveHourUsed: 50, weeklyUsed: 90 } });
  await request.put("/api/prompt-queue/settings", { data: { maxConcurrentChats: 2, defaults: chatDefaults } });
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
  await request.put("/api/agents/codex-quota", { data: quotaDefaults });
  await request.put("/api/prompt-queue/settings", { data: { maxConcurrentChats: 2, defaults: chatDefaults } });
  await request.post("/__test/codex-quota", { data: {} });
});

async function navigation(page: Page) {
  await expect(page.locator(".prompt-workspace")).toBeVisible();
  const show = page.getByRole("button", { name: "Afficher les chats", exact: true });
  if (await show.isVisible()) await show.click();
}
async function settings(page: Page) {
  await navigation(page);
  await page.getByRole("button", { name: "Paramètres", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Paramètres", exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}
async function send(page: Page, content: string) {
  await page.getByRole("textbox", { name: "Votre message", exact: true }).fill(content);
  await page.getByRole("button", { name: "Envoyer", exact: true }).click();
  await expect(page.getByRole("article").getByText(content, { exact: true })).toBeVisible();
  const notice = page.getByRole("dialog", { name: "Prompt placé en file d’attente", exact: true });
  if (await notice.isVisible()) await notice.getByRole("button", { name: "Garder en file d’attente", exact: true }).click();
}

test("new chat needs only a prompt, then automatically waits for quotas and preserves its conversation", async ({ page, request }, info) => {
  await request.post("/__test/codex-quota", { data: { fiveHourUsed: 51, weeklyUsed: 0 } });
  await page.goto("/");
  await page.getByRole("button", { name: "Chats et prompts", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Que souhaitez-vous préparer ?", exact: true })).toBeVisible();
  await expect(page.getByRole("textbox")).toHaveCount(1);
  await expect(page.getByRole("combobox")).toHaveCount(0);
  await expect(page.getByRole("spinbutton")).toHaveCount(0);
  await page.screenshot({ path: info.outputPath("simple-new-chat.png"), fullPage: true });
  await send(page, "QUEUE_E2E First");
  await expect(page.getByRole("heading", { name: "QUEUE_E2E First", exact: true })).toBeVisible();
  await send(page, "QUEUE_E2E Second");
  await expect(page.getByRole("status").filter({ hasText: "5 h : 49 %" })).toBeVisible();
  const second = page.getByRole("article", { name: "2 · En attente", exact: true });
  await second.getByRole("button", { name: "Modifier", exact: true }).click();
  await second.getByRole("textbox").fill("QUEUE_E2E Second edited");
  await second.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(second.getByText("QUEUE_E2E Second edited", { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { name: "QUEUE_E2E First", exact: true })).toBeVisible();
  await expect(page.getByRole("article", { name: "2 · En attente", exact: true })).toBeVisible();
  await request.post("/__test/codex-quota", { data: { fiveHourUsed: 0, weeklyUsed: 91 } });
  await expect(page.getByRole("status").filter({ hasText: "semaine : 9 %" })).toBeVisible();
  await request.post("/__test/codex-quota", { data: { fiveHourUsed: 50, weeklyUsed: 90 } });
  await expect(page.getByRole("article", { name: "1 · Terminé", exact: true })).toBeVisible();
  await expect(page.getByRole("article", { name: "2 · Terminé", exact: true })).toBeVisible();
  await expect(page.getByText("Nouvelle conversation : QUEUE_E2E First", { exact: true })).toBeVisible();
  await expect(page.getByText("Conversation reprise : QUEUE_E2E Second edited", { exact: true })).toBeVisible();
  const id = new URL(page.url()).searchParams.get("chat");
  const detail = await (await request.get(`/api/prompt-queue/chats/${id}`)).json();
  expect(detail.workingDirectory).not.toBe(process.cwd());
  expect(detail.model).toBe("gpt-server-sol");
  expect(detail.paused).toBe(false);
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: info.outputPath("simple-conversation.png"), fullPage: true });
});

test("independent chats still run in parallel within the configured execution limit", async ({ page, request }, info) => {
  const ids: string[] = [];
  for (let index = 1; index <= 3; index++) {
    const result = await request.post("/api/prompt-queue/chats", { data: { title: `Parallèle ${index}`, workingDirectory: process.cwd(), paused: true } });
    const chat = await result.json(); ids.push(chat.id);
    await request.post(`/api/prompt-queue/chats/${chat.id}/prompts`, { data: { content: `QUEUE_E2E SLOW ${index}` } });
  }
  await page.goto(`/?mode=prompts&chat=${ids[0]}`);
  await expect(page.getByRole("heading", { name: "Parallèle 1", exact: true })).toBeVisible();
  for (const id of ids) await request.put(`/api/prompt-queue/chats/${id}/pause`, { data: { paused: false } });
  await expect.poll(async () => (await (await request.get("/api/prompt-queue")).json()).chats.map((chat: any) => chat.counts.running)).toEqual([1, 1, 0]);
  await navigation(page);
  await page.getByRole("button", { name: /Parallèle 2/ }).click();
  await expect(page.getByRole("heading", { name: "Parallèle 2", exact: true })).toBeVisible();
  await expect(page.getByRole("article", { name: "1 · En cours", exact: true })).toBeVisible();
  await page.screenshot({ path: info.outputPath("parallel-chats.png"), fullPage: true });
  await expect.poll(async () => (await (await request.get("/api/prompt-queue")).json()).chats.reduce((sum: number, chat: any) => sum + chat.counts.completed, 0), { timeout: 15_000 }).toBe(3);
  const details = await Promise.all(ids.map(async id => (await request.get(`/api/prompt-queue/chats/${id}`)).json()));
  expect(details.every(chat => chat.prompts[0].answer.startsWith("Nouvelle conversation"))).toBe(true);
});

test("dedicated settings persist defaults for future chats without changing existing conversations", async ({ page, request }, info) => {
  const existing = await (await request.post("/api/prompt-queue/chats", { data: { title: "Conversation existante", workingDirectory: process.cwd(), paused: true } })).json();
  await page.goto("/?mode=prompts");
  const dialog = await settings(page);
  await dialog.getByRole("textbox", { name: "Dossier de travail", exact: true }).fill(process.cwd());
  await expect(dialog.getByRole("combobox", { name: "Modèle", exact: true })).toBeEnabled();
  await dialog.getByRole("combobox", { name: "Modèle", exact: true }).selectOption("gpt-server-luna");
  await dialog.getByRole("combobox", { name: "Effort de raisonnement", exact: true }).selectOption("high");
  await dialog.getByRole("checkbox", { name: "Démarrer automatiquement après l’envoi", exact: true }).uncheck();
  await dialog.getByRole("spinbutton", { name: "Minimum restant sur 5 h (%)", exact: true }).fill("60");
  await dialog.getByRole("spinbutton", { name: "Minimum restant sur la semaine (%)", exact: true }).fill("15");
  await dialog.getByRole("spinbutton", { name: "Chats simultanés maximum", exact: true }).fill("1");
  await dialog.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(dialog.getByText("Paramètres enregistrés.", { exact: true })).toBeVisible();
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
  await page.screenshot({ path: info.outputPath("dedicated-settings.png"), fullPage: true });
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("spinbutton")).toHaveCount(0);
  await send(page, "QUEUE_E2E Cancel me");
  await send(page, "QUEUE_E2E Keep me");
  const id = new URL(page.url()).searchParams.get("chat");
  const detail = await (await request.get(`/api/prompt-queue/chats/${id}`)).json();
  expect([detail.model, detail.reasoningEffort, detail.workingDirectory, detail.paused]).toEqual(["gpt-server-luna", "high", process.cwd(), true]);
  const old = await (await request.get(`/api/prompt-queue/chats/${existing.id}`)).json();
  expect([old.model, old.reasoningEffort, old.paused]).toEqual([existing.model, existing.reasoningEffort, existing.paused]);
  await page.getByRole("article", { name: "1 · En attente", exact: true }).getByRole("button", { name: "Annuler", exact: true }).click();
  await expect(page.getByRole("article", { name: "1 · Annulé", exact: true })).toBeVisible();
  await request.post("/__test/codex-quota", { data: { unavailable: true } });
  await page.getByRole("button", { name: "Reprendre la file", exact: true }).first().click();
  await expect(page.getByRole("status").filter({ hasText: "Quotas Codex indisponibles" })).toBeVisible();
  await page.reload();
  const persisted = await settings(page);
  await expect(persisted.getByRole("spinbutton", { name: "Minimum restant sur 5 h (%)", exact: true })).toHaveValue("60");
  await expect(persisted.getByRole("spinbutton", { name: "Chats simultanés maximum", exact: true })).toHaveValue("1");
  await expect(persisted.getByRole("checkbox")).not.toBeChecked();
  await page.keyboard.press("Escape");
  await request.post("/__test/codex-quota", { data: { fiveHourUsed: 40, weeklyUsed: 85 } });
  await expect(page.getByRole("article", { name: "2 · Terminé", exact: true })).toBeVisible();
});

test("chat-specific options are available in their menu and sending with Enter needs no setup", async ({ page, request }) => {
  await request.post("/__test/codex-quota", { data: { fiveHourUsed: 60, weeklyUsed: 0 } });
  await page.goto("/?mode=prompts");
  await page.getByRole("textbox", { name: "Votre message", exact: true }).fill("QUEUE_E2E Keyboard");
  await page.getByRole("textbox", { name: "Votre message", exact: true }).press("Enter");
  await expect(page.getByRole("heading", { name: "QUEUE_E2E Keyboard", exact: true })).toBeVisible();
  await page.getByRole("dialog", { name: "Prompt placé en file d’attente", exact: true }).getByRole("button", { name: "Garder en file d’attente", exact: true }).click();
  await page.getByRole("button", { name: "Paramètres du chat", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Paramètres", exact: true });
  await expect(dialog.getByRole("tab", { name: "Ce chat", exact: true })).toHaveAttribute("aria-selected", "true");
  await dialog.getByRole("textbox", { name: "Nom du chat", exact: true }).fill("Mon chat renommé");
  await dialog.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(dialog.getByText("Paramètres enregistrés.", { exact: true })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("heading", { name: "Mon chat renommé", exact: true })).toBeVisible();
  await expect(page.getByRole("textbox")).toHaveCount(1);
  await expect(page.getByRole("combobox")).toHaveCount(0);
});
