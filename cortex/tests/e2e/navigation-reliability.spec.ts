import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

async function showChats(page: Page) {
  await expect(page.locator(".prompt-workspace")).toBeVisible();
  const show = page.getByRole("button", { name: "Afficher les chats", exact: true });
  if (await show.isVisible()) await show.click();
}

test("chat selection follows browser back and forward", async ({ page, request }) => {
  const chats = [];
  for (const title of ["Navigation A", "Navigation B"]) {
    const response = await request.post("/api/prompt-queue/chats", { data: { title, paused: true } });
    expect(response.ok()).toBe(true);
    chats.push(await response.json());
  }
  try {
    await page.goto(`/?mode=prompts&chat=${chats[0].id}`);
    await expect(page.getByRole("heading", { name: "Navigation A", exact: true })).toBeVisible();
    await showChats(page);
    await page.getByRole("button", { name: /^Navigation B/ }).click();
    await expect(page.getByRole("heading", { name: "Navigation B", exact: true })).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(new RegExp(`chat=${chats[0].id}`));
    await expect(page.getByRole("heading", { name: "Navigation A", exact: true })).toBeVisible();
    await page.goForward();
    await expect(page.getByRole("heading", { name: "Navigation B", exact: true })).toBeVisible();
  } finally {
    for (const chat of chats) await request.delete(`/api/prompt-queue/chats/${chat.id}`);
  }
});

test("back to another mode protects an unsaved project and keeps forward navigation usable", async ({ page, request }) => {
  const response = await request.post("/api/projects/create", { data: {
    name: `navigation-${randomUUID().slice(0, 8)}`, engine: "codex", description: "Un rédacteur de test."
  } });
  const { project } = await response.json();
  await page.goto(`/?project=${project.id}&mode=prompts`);
  await showChats(page);
  await page.locator(".prompt-sidebar-footer button").first().click();
  await page.getByRole("button", { name: "Modifier le projet", exact: true }).click();
  const mission = page.getByRole("textbox", { name: /Mission/ });
  await mission.fill("Brouillon protégé entre les modes.");
  let confirmations = 0;
  page.once("dialog", dialog => { confirmations++; void dialog.dismiss(); });
  await page.goBack();
  await expect.poll(() => confirmations).toBe(1);
  await expect(page).not.toHaveURL(/mode=prompts/);
  await expect(mission).toHaveValue("Brouillon protégé entre les modes.");
  page.once("dialog", dialog => void dialog.accept());
  await page.goBack();
  await expect(page.locator(".prompt-workspace")).toBeVisible();
  await page.goForward();
  await expect(page.getByRole("button", { name: "Modifier le projet", exact: true })).toBeVisible();
});

for (const destination of ["chat", "workflows"] as const) test(`a pending chat creation respects navigation to ${destination}`, async ({ page, request }) => {
  const response = await request.post("/api/prompt-queue/chats", { data: { title: "Chat conservé", paused: true } });
  const existing = await response.json();
  let release!: () => void;
  let intercepted!: () => void;
  const pending = new Promise<void>(resolve => { release = resolve; });
  const arrived = new Promise<void>(resolve => { intercepted = resolve; });
  let createdId: string | undefined;
  await page.route("**/api/prompt-queue/chats", async route => {
    if (route.request().method() !== "POST") return route.continue();
    const result = await route.fetch();
    createdId = (await result.json()).id;
    // Pause this chat before returning it so the test never starts inference.
    await request.put(`/api/prompt-queue/chats/${createdId}/pause`, { data: { paused: true } });
    intercepted();
    await pending;
    await route.fulfill({ response: result });
  });
  try {
    await page.goto("/?mode=prompts");
    await page.getByRole("textbox", { name: "Votre message", exact: true }).fill("Demande du nouveau chat");
    await page.getByRole("button", { name: "Envoyer", exact: true }).click();
    await arrived;
    await showChats(page);
    if (destination === "chat") {
      await page.getByRole("button", { name: /^Chat conservé/ }).click();
      await expect(page.getByRole("heading", { name: "Chat conservé", exact: true })).toBeVisible();
    } else {
      await page.locator(".prompt-sidebar-footer button").first().click();
      await expect(page.locator(".prompt-workspace")).toHaveCount(0);
    }
    release();
    await expect.poll(async () => (await (await request.get(`/api/prompt-queue/chats/${createdId}`)).json()).prompts.length).toBe(1);
    if (destination === "chat") {
      await expect(page).toHaveURL(new RegExp(`chat=${existing.id}`));
      await expect(page.getByRole("heading", { name: "Chat conservé", exact: true })).toBeVisible();
    } else {
      await expect(page).not.toHaveURL(/chat=|mode=prompts/);
      await expect(page.locator(".prompt-workspace")).toHaveCount(0);
    }
  } finally {
    release();
    if (createdId) await request.delete(`/api/prompt-queue/chats/${createdId}`);
    await request.delete(`/api/prompt-queue/chats/${existing.id}`);
  }
});

test("an unsent message, attachment, schedule and model survive a round trip through workflows", async ({ page }, info) => {
  await page.goto("/?mode=prompts");
  const composer = page.getByRole("textbox", { name: "Votre message", exact: true });
  await composer.fill("Brouillon conservé pendant la consultation du workflow.");
  await page.locator('input[type="file"]').setInputFiles({
    name: "notes-du-brouillon.txt", mimeType: "text/plain", buffer: Buffer.from("Notes à conserver")
  });
  await expect(page.locator(".prompt-composer").getByText("notes-du-brouillon.txt", { exact: true })).toBeVisible();
  const model = page.getByRole("button", { name: "Choisir le modèle et le niveau de réflexion", exact: true });
  await model.click();
  await page.getByRole("combobox", { name: "Modèle", exact: true }).selectOption("gpt-server-luna");
  await page.keyboard.press("Escape");
  const schedule = page.getByRole("button", { name: "Programmer le prompt", exact: true });
  await schedule.click();
  const dialog = page.getByRole("dialog", { name: "Programmer le prompt", exact: true });
  const tomorrow = await page.evaluate(() => {
    const date = new Date(); date.setDate(date.getDate() + 1);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  });
  await dialog.getByLabel("Date", { exact: true }).fill(tomorrow);
  await dialog.getByLabel("Heure", { exact: true }).fill("14:30");
  await dialog.getByRole("button", { name: "Appliquer", exact: true }).click();
  await showChats(page);
  await page.locator(".prompt-sidebar-footer button").first().click();
  await page.goBack();
  await expect(composer).toHaveValue("Brouillon conservé pendant la consultation du workflow.");
  await expect(page.locator(".prompt-composer").getByText("notes-du-brouillon.txt", { exact: true })).toBeVisible();
  await expect(model).toContainText("Luna");
  await expect(schedule).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({ path: info.outputPath("restored-prompt-draft.png"), fullPage: true });
});
