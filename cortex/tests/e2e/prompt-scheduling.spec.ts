import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

test.use({ timezoneId: "Europe/Paris" });
test.beforeEach(async ({ page, request }) => {
  const now = new Date();
  await page.clock.setFixedTime(now);
  await request.post("/__test/prompt-queue-clock", { data: { at: now.toISOString() } });
  await request.post("/__test/codex-models", { data: {} });
  await request.put("/api/agents/codex-quota", { data: { enabled: false, minimumFiveHourRemainingPercent: 50, minimumWeeklyRemainingPercent: 10 } });
  await request.put("/api/prompt-queue/settings", { data: { maxConcurrentChats: 2, defaults: { workingDirectory: "", model: "", reasoningEffort: "", autoStart: true } } });
  await request.post("/__test/codex-quota", { data: { fiveHourUsed: 50, weeklyUsed: 90 } });
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
  await request.post("/__test/prompt-queue-clock", { data: { at: null } });
});
async function dates(page: Page) {
  return page.evaluate(() => {
    const local = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); tomorrow.setHours(9, 40, 0, 0);
    const later = new Date(tomorrow); later.setHours(11, 5, 0, 0);
    const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
    const gap = new Date(new Date().getFullYear() + 1, 2, 31, 12); gap.setDate(gap.getDate() - gap.getDay());
    return { today: local(new Date()), tomorrow: local(tomorrow), first: tomorrow.toISOString(), later: later.toISOString(), yesterday: local(yesterday), gap: local(gap) };
  });
}
async function openClock(page: Page) {
  const trigger = page.getByRole("button", { name: "Programmer le prompt", exact: true });
  await expect(trigger).toBeEnabled(); await trigger.click();
  const dialog = page.getByRole("dialog", { name: "Programmer le prompt", exact: true });
  await expect(dialog).toBeVisible(); return dialog;
}

test("the clock defaults to today, persists a local date with attachments and starts queued messages only when due", async ({ page, request }, info) => {
  await page.goto("/?mode=prompts");
  const values = await dates(page);
  const dialog = await openClock(page);
  await expect(dialog.getByLabel("Date", { exact: true })).toHaveValue(values.today);
  await expect(dialog.getByLabel("Heure", { exact: true })).toBeFocused();
  await expect(dialog).toContainText("Europe/Paris");
  await dialog.getByLabel("Date", { exact: true }).fill(values.tomorrow);
  await dialog.getByLabel("Heure", { exact: true }).fill("09:40");
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
  await page.screenshot({ path: info.outputPath("schedule-dialog.png"), fullPage: true });
  await dialog.getByRole("button", { name: "Appliquer", exact: true }).click();
  await expect(page.getByRole("button", { name: "Programmer le prompt", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.locator('.prompt-composer input[type="file"]').setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("Document du prompt programmé") });
  await page.getByRole("textbox", { name: "Votre message", exact: true }).fill("QUEUE_E2E Demande programmée");
  await page.locator(".prompt-composer").screenshot({ path: info.outputPath("scheduled-composer.png") });
  await page.getByRole("button", { name: "Envoyer", exact: true }).click();
  const first = page.getByRole("article", { name: "1 · Programmé", exact: true });
  await expect(first).toBeVisible();
  const id = new URL(page.url()).searchParams.get("chat");
  let detail = await (await request.get(`/api/prompt-queue/chats/${id}`)).json();
  expect(detail.prompts[0].scheduledAt).toBe(values.first);
  expect(detail.prompts[0].attachments[0].name).toBe("notes.txt");
  expect(detail.prompts[0].attempts).toBe(0);
  await expect(page.getByRole("button", { name: "Programmer le prompt", exact: true })).toHaveAttribute("aria-pressed", "false");
  await page.getByRole("textbox", { name: "Votre message", exact: true }).fill("QUEUE_E2E Suite dans le même chat");
  await page.getByRole("button", { name: "Envoyer", exact: true }).click();
  await expect(page.getByRole("article", { name: "2 · En attente", exact: true })).toBeVisible();
  await page.reload(); await expect(first).toBeVisible();
  await first.getByRole("button", { name: "Modifier la programmation", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "Programmer le prompt", exact: true });
  await expect(editor.getByLabel("Date", { exact: true })).toHaveValue(values.tomorrow);
  await expect(editor.getByLabel("Heure", { exact: true })).toHaveValue("09:40");
  await editor.getByLabel("Heure", { exact: true }).fill("11:05");
  await editor.getByRole("button", { name: "Appliquer", exact: true }).click();
  await expect(first).toContainText("11:05");
  await request.post("/__test/prompt-queue-clock", { data: { at: new Date(Date.parse(values.later) - 1).toISOString() } });
  detail = await (await request.get(`/api/prompt-queue/chats/${id}`)).json();
  expect(detail.prompts.map((prompt: any) => prompt.attempts)).toEqual([0, 0]);
  await request.post("/__test/prompt-queue-clock", { data: { at: values.later } });
  await expect(page.getByRole("article", { name: "1 · Terminé", exact: true })).toBeVisible();
  await expect(page.getByRole("article", { name: "2 · Terminé", exact: true })).toContainText("Conversation reprise");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("past and nonexistent local times are rejected, and closing or clearing the clock keeps draft choices predictable", async ({ page, request }) => {
  const a = await (await request.post("/api/prompt-queue/chats", { data: { title: "Horloge A", paused: true } })).json();
  const b = await (await request.post("/api/prompt-queue/chats", { data: { title: "Horloge B", paused: true } })).json();
  await page.goto(`/?mode=prompts&chat=${a.id}`);
  const values = await dates(page);
  let dialog = await openClock(page);
  await dialog.getByLabel("Date", { exact: true }).fill(values.yesterday);
  await dialog.getByLabel("Heure", { exact: true }).fill("12:00");
  await dialog.getByRole("button", { name: "Appliquer", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("dans le futur");
  await dialog.getByLabel("Date", { exact: true }).fill(values.gap);
  await dialog.getByLabel("Heure", { exact: true }).fill("02:30");
  await dialog.getByRole("button", { name: "Appliquer", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("fuseau horaire");
  await dialog.getByLabel("Date", { exact: true }).fill(values.tomorrow);
  await dialog.getByLabel("Heure", { exact: true }).fill("09:40");
  await dialog.getByRole("button", { name: "Appliquer", exact: true }).click();
  const switchChat = async (name: string) => {
    const menu = page.getByRole("button", { name: "Afficher les chats", exact: true }); if (await menu.isVisible()) await menu.click();
    await page.getByRole("button", { name: new RegExp(name) }).click();
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  };
  await switchChat("Horloge B"); dialog = await openClock(page);
  await expect(dialog.getByLabel("Date", { exact: true })).toHaveValue(values.today);
  await expect(dialog.getByLabel("Heure", { exact: true })).toHaveValue("");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "Programmer le prompt", exact: true })).toBeFocused();
  await switchChat("Horloge A"); dialog = await openClock(page);
  await expect(dialog.getByLabel("Heure", { exact: true })).toHaveValue("09:40");
  await dialog.getByLabel("Heure", { exact: true }).fill("11:05"); await page.keyboard.press("Escape");
  await expect(page.locator(".prompt-schedule-summary")).toContainText("09:40");
  await page.getByRole("button", { name: "Retirer la programmation", exact: true }).click();
  await expect(page.locator(".prompt-schedule-summary")).toHaveCount(0);
});

test("a future schedule blocks forcing, but removing it leaves the quota decision available", async ({ page, request }) => {
  await request.post("/__test/codex-quota", { data: { fiveHourUsed: 80, weeklyUsed: 99 } });
  await page.goto("/?mode=prompts");
  const values = await dates(page);
  const dialog = await openClock(page);
  await dialog.getByLabel("Date", { exact: true }).fill(values.tomorrow);
  await dialog.getByLabel("Heure", { exact: true }).fill("09:40");
  await dialog.getByRole("button", { name: "Appliquer", exact: true }).click();
  await page.getByRole("textbox", { name: "Votre message", exact: true }).fill("QUEUE_E2E Garder heure et quotas");
  await page.getByRole("button", { name: "Envoyer", exact: true }).click();
  const quota = page.getByRole("dialog", { name: "Prompt placé en file d’attente", exact: true });
  await expect(quota.getByRole("button", { name: "Forcer l’exécution maintenant", exact: true })).toBeDisabled();
  await expect(quota).toContainText("Ce prompt est programmé pour");
  await quota.getByRole("button", { name: "Garder en file d’attente", exact: true }).click();
  const id = new URL(page.url()).searchParams.get("chat");
  const prompt = (await (await request.get(`/api/prompt-queue/chats/${id}`)).json()).prompts[0];
  expect((await request.post(`/api/prompt-queue/chats/${id}/prompts/${prompt.id}/force`)).status()).toBe(400);
  await page.getByRole("article", { name: "1 · Programmé", exact: true }).getByRole("button", { name: "Modifier la programmation", exact: true }).click();
  await page.getByRole("dialog", { name: "Programmer le prompt", exact: true }).getByRole("button", { name: "Sans programmation", exact: true }).click();
  const ready = page.getByRole("article", { name: "1 · En attente", exact: true });
  await ready.getByRole("button", { name: "Forcer l’exécution maintenant", exact: true }).click();
  await expect(quota.getByRole("button", { name: "Forcer l’exécution maintenant", exact: true })).toBeEnabled();
  await quota.getByRole("button", { name: "Forcer l’exécution maintenant", exact: true }).click();
  await expect(page.getByRole("article", { name: "1 · Terminé", exact: true })).toBeVisible();
});
