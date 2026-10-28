import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const defaults = { enabled: false, minimumFiveHourRemainingPercent: 50, minimumWeeklyRemainingPercent: 10 };
test.beforeEach(async ({ request }) => {
  await request.post("/__test/codex-models", { data: {} });
  await request.put("/api/agents/codex-quota", { data: defaults });
  await request.put("/api/prompt-queue/settings", { data: { maxConcurrentChats: 2, defaults: { workingDirectory: "", model: "", reasoningEffort: "", autoStart: true } } });
  await request.post("/__test/codex-quota", { data: { fiveHourUsed: 80, weeklyUsed: 99 } });
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
});
const notice = (page: Page) => page.getByRole("dialog", { name: "Prompt placé en file d’attente", exact: true });
async function send(page: Page, content: string) {
  await page.getByRole("textbox", { name: "Votre message", exact: true }).fill(content);
  await page.getByRole("button", { name: "Envoyer", exact: true }).click();
  await expect(notice(page)).toBeVisible();
  return notice(page);
}

test("low configured reserves open an accessible popup and keeping or dismissing it preserves the queue", async ({ page, request }, info) => {
  await request.put("/api/agents/codex-quota", { data: { ...defaults, minimumFiveHourRemainingPercent: 60, minimumWeeklyRemainingPercent: 15 } });
  await request.post("/__test/codex-quota", { data: { fiveHourUsed: 41, weeklyUsed: 0 } });
  await page.goto("/?mode=prompts");
  let dialog = await send(page, "QUEUE_E2E Waiting for reserves");
  await expect(dialog.getByRole("row", { name: "Sur 5 h 59 % 60 %", exact: true })).toBeVisible();
  await expect(dialog.getByRole("row", { name: "Hebdomadaire 100 % 15 %", exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Garder en file d’attente", exact: true })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(dialog.getByRole("button", { name: "Forcer l’exécution maintenant", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "Garder en file d’attente", exact: true })).toBeFocused();
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
  await page.screenshot({ path: info.outputPath("quota-warning-popup.png"), fullPage: true });
  await dialog.getByRole("button", { name: "Garder en file d’attente", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("textbox", { name: "Votre message", exact: true })).toBeFocused();
  const first = page.getByRole("article", { name: "1 · En attente", exact: true });
  await first.getByRole("button", { name: "Forcer l’exécution maintenant", exact: true }).click();
  await expect(notice(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(first).toBeVisible();
  // Either window alone blocks, using the saved thresholds rather than constants.
  await request.post("/__test/codex-quota", { data: { fiveHourUsed: 0, weeklyUsed: 86 } });
  dialog = await send(page, "QUEUE_E2E Second in order");
  await expect(dialog.getByRole("row", { name: "Hebdomadaire 14 % 15 %", exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Forcer l’exécution maintenant", exact: true })).toBeDisabled();
  await expect(dialog.getByRole("status")).toContainText("Un prompt précédent");
  await dialog.getByRole("button", { name: "Garder en file d’attente", exact: true }).click();
  const id = new URL(page.url()).searchParams.get("chat");
  const detail = await (await request.get(`/api/prompt-queue/chats/${id}`)).json();
  expect(detail.prompts.map((prompt: any) => [prompt.status, prompt.attempts])).toEqual([["queued", 0], ["queued", 0]]);
  await request.post("/__test/codex-quota", { data: { fiveHourUsed: 40, weeklyUsed: 85 } });
  await expect(page.getByRole("article", { name: "2 · Terminé", exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("forcing launches one prompt immediately while following prompts and other chats retain quota protection", async ({ page, request }) => {
  await page.goto("/?mode=prompts");
  const dialog = await send(page, "QUEUE_E2E SLOW Force this one");
  await expect(dialog.getByRole("button", { name: "Forcer l’exécution maintenant", exact: true })).toBeEnabled();
  await dialog.getByRole("button", { name: "Forcer l’exécution maintenant", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const secondNotice = await send(page, "QUEUE_E2E Keep the following one queued");
  await secondNotice.getByRole("button", { name: "Garder en file d’attente", exact: true }).click();
  await expect(page.getByRole("article", { name: "1 · Terminé", exact: true })).toContainText("Exécution forcée");
  await expect(page.getByRole("article", { name: "2 · En attente", exact: true })).toBeVisible();
  const id = new URL(page.url()).searchParams.get("chat");
  const detail = await (await request.get(`/api/prompt-queue/chats/${id}`)).json();
  expect(detail.prompts.map((prompt: any) => prompt.attempts)).toEqual([1, 0]);
  expect(await (await request.get("/api/agents/codex-quota")).json()).toEqual(defaults);
  const other = await (await request.post("/api/prompt-queue/chats", { data: {} })).json();
  const pending = await (await request.post(`/api/prompt-queue/chats/${other.id}/prompts`, { data: { content: "QUEUE_E2E Must still wait", force: true } })).json();
  expect(pending.quotaWarning).not.toBeNull();
  expect((await (await request.get(`/api/prompt-queue/chats/${other.id}`)).json()).prompts[0].status).toBe("queued");
  await page.reload();
  await expect(page.getByRole("article", { name: "1 · Terminé", exact: true })).toContainText("Exécution forcée");
  await request.post("/__test/codex-quota", { data: { fiveHourUsed: 50, weeklyUsed: 90 } });
  await expect(page.getByRole("article", { name: "2 · Terminé", exact: true })).toBeVisible();
});

test("manual override remains available when quota discovery fails", async ({ page, request }) => {
  await request.post("/__test/codex-quota", { data: { unavailable: true } });
  await page.goto("/?mode=prompts");
  const dialog = await send(page, "QUEUE_E2E Explicit offline override");
  await expect(dialog).toContainText("Les quotas ne peuvent pas être vérifiés");
  await dialog.getByRole("button", { name: "Forcer l’exécution maintenant", exact: true }).click();
  await expect(page.getByRole("article", { name: "1 · Terminé", exact: true })).toBeVisible();
});

test("a full execution limit disables forcing until a slot becomes available", async ({ page, request }) => {
  await request.put("/api/prompt-queue/settings", { data: { maxConcurrentChats: 1 } });
  const occupied = await (await request.post("/api/prompt-queue/chats", { data: { paused: true } })).json();
  const first = await (await request.post(`/api/prompt-queue/chats/${occupied.id}/prompts`, { data: { content: "QUEUE_E2E SLOW Occupied slot" } })).json();
  await page.goto("/?mode=prompts");
  const dialog = await send(page, "QUEUE_E2E Wait for execution slot");
  const id = new URL(page.url()).searchParams.get("chat");
  const pending = (await (await request.get(`/api/prompt-queue/chats/${id}`)).json()).prompts[0];
  await request.post(`/api/prompt-queue/chats/${occupied.id}/prompts/${first.id}/force`);
  await expect(dialog.getByRole("button", { name: "Forcer l’exécution maintenant", exact: true })).toBeDisabled();
  await expect(dialog.getByRole("status")).toContainText("Tous les créneaux sont occupés");
  expect((await request.post(`/api/prompt-queue/chats/${id}/prompts/${pending.id}/force`)).status()).toBe(400);
  await expect(dialog.getByRole("button", { name: "Forcer l’exécution maintenant", exact: true })).toBeEnabled();
  await dialog.getByRole("button", { name: "Forcer l’exécution maintenant", exact: true }).click();
  await expect(page.getByRole("article", { name: "1 · Terminé", exact: true })).toBeVisible();
});
