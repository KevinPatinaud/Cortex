import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jP1sAAAAASUVORK5CYII=", "base64");
const photo = { name: "capture été.png", mimeType: "image/png", buffer: png };
const pdfFile = { name: "Document de référence.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\nOriginal PDF bytes\n%%EOF") };
const table = { name: "Données.csv", mimeType: "text/csv", buffer: Buffer.from("produit,quantité\nLunaria,42") };
const picker = (page: Page) => page.locator('.prompt-composer input[type="file"]');
const notice = (page: Page) => page.getByRole("dialog", { name: "Prompt placé en file d’attente", exact: true });
test.beforeEach(async ({ request }) => {
  await request.post("/__test/codex-models", { data: {} });
  await request.put("/api/agents/codex-quota", { data: { enabled: false, minimumFiveHourRemainingPercent: 50, minimumWeeklyRemainingPercent: 10 } });
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

test("images and documents preview, persist in the queue and reach initial and resumed engine turns intact", async ({ page, request }, info) => {
  await page.goto("/?mode=prompts");
  await expect(page.getByRole("button", { name: "Joindre des images ou documents", exact: true })).toBeEnabled();
  await picker(page).setInputFiles([photo, pdfFile, table]);
  await expect(page.locator(".prompt-composer").getByRole("img", { name: photo.name, exact: true })).toBeVisible();
  expect(await page.locator(".prompt-composer img").evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true);
  await page.getByRole("button", { name: `Retirer ${table.name}`, exact: true }).click();
  await expect(page.locator(".prompt-composer .prompt-file-card")).toHaveCount(2);
  await page.getByRole("textbox", { name: "Votre message", exact: true }).fill("QUEUE_E2E Compare la capture au document joint");
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
  await page.screenshot({ path: info.outputPath("attachment-composer.png"), fullPage: true });
  await page.getByRole("button", { name: "Envoyer", exact: true }).click();
  await expect(notice(page)).toBeVisible();
  await notice(page).getByRole("button", { name: "Garder en file d’attente", exact: true }).click();
  await expect(page.locator(".prompt-composer .prompt-file-card")).toHaveCount(0);
  const id = new URL(page.url()).searchParams.get("chat");
  const detail = await (await request.get(`/api/prompt-queue/chats/${id}`)).json();
  expect(detail.prompts[0].status).toBe("queued");
  expect(detail.prompts[0].attachments.map((file: any) => file.name)).toEqual([photo.name, pdfFile.name]);
  await page.reload();
  const first = page.getByRole("article", { name: "1 · En attente", exact: true });
  await expect(first.getByRole("img", { name: photo.name, exact: true })).toBeVisible();
  expect(await first.getByRole("img", { name: photo.name, exact: true }).evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0)).toBe(true);
  const pdfLink = first.getByRole("link", { name: new RegExp(pdfFile.name) });
  const download = await request.get((await pdfLink.getAttribute("href"))!);
  expect(await download.body()).toEqual(pdfFile.buffer);
  expect(download.headers()["content-disposition"]).toMatch(/^attachment;/);
  await first.getByRole("button", { name: "Forcer l’exécution maintenant", exact: true }).click();
  await notice(page).getByRole("button", { name: "Forcer l’exécution maintenant", exact: true }).click();
  await expect(page.getByRole("article", { name: "1 · Terminé", exact: true })).toBeVisible();
  let actual = await (await request.post("/__test/last-attachment-execution")).json();
  expect(actual.images).toEqual([png.toString("base64")]);
  expect(actual.files).toEqual([{ name: photo.name, bytes: png.toString("base64") }, { name: pdfFile.name, bytes: pdfFile.buffer.toString("base64") }]);
  await picker(page).setInputFiles([photo, table]);
  await page.getByRole("textbox", { name: "Votre message", exact: true }).fill("QUEUE_E2E Suite avec de nouvelles pièces jointes");
  await page.getByRole("button", { name: "Envoyer", exact: true }).click();
  await notice(page).getByRole("button", { name: "Forcer l’exécution maintenant", exact: true }).click();
  await expect(page.getByRole("article", { name: "2 · Terminé", exact: true })).toContainText("Conversation reprise");
  actual = await (await request.post("/__test/last-attachment-execution")).json();
  expect(actual.images).toEqual([png.toString("base64")]);
  expect(actual.files[1]).toEqual({ name: table.name, bytes: table.buffer.toString("base64") });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test("pasting images and dropping documents support attachment-only messages and keep drafts separate by chat", async ({ page, request }) => {
  const a = await (await request.post("/api/prompt-queue/chats", { data: { title: "Fichiers A", paused: true } })).json();
  const b = await (await request.post("/api/prompt-queue/chats", { data: { title: "Fichiers B", paused: true } })).json();
  await page.goto(`/?mode=prompts&chat=${a.id}`);
  await expect(page.getByRole("textbox", { name: "Votre message", exact: true })).toBeEnabled();
  await page.locator("#queue-prompt").evaluate((element, base64) => {
    const bytes = Uint8Array.from(atob(base64), character => character.charCodeAt(0));
    const clipboard = new DataTransfer(); clipboard.items.add(new File([bytes], "collage.png", { type: "image/png" }));
    element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: clipboard, bubbles: true, cancelable: true }));
  }, png.toString("base64"));
  await expect(page.locator(".prompt-composer .prompt-file-card")).toHaveCount(1);
  const switchChat = async (name: string) => {
    const menu = page.getByRole("button", { name: "Afficher les chats", exact: true }); if (await menu.isVisible()) await menu.click();
    await page.getByRole("button", { name: new RegExp(name) }).click();
    await expect(page.getByRole("heading", { name, exact: true })).toBeVisible();
  };
  await switchChat("Fichiers B");
  await expect(page.locator(".prompt-composer .prompt-file-card")).toHaveCount(0);
  await page.locator(".prompt-composer").evaluate(element => {
    const transfer = new DataTransfer(); transfer.items.add(new File(["DOCUMENT_DROP"], "notes.txt", { type: "text/plain" }));
    element.dispatchEvent(new DragEvent("drop", { dataTransfer: transfer, bubbles: true, cancelable: true }));
  });
  await expect(page.locator(".prompt-composer").getByText("notes.txt", { exact: true })).toBeVisible();
  await switchChat("Fichiers A");
  await expect(page.locator(".prompt-composer").getByRole("img", { name: "collage.png", exact: true })).toBeVisible();
  await expect(page.locator(".prompt-composer").getByText("notes.txt", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Envoyer", exact: true }).click();
  await expect(notice(page)).toBeVisible();
  await notice(page).getByRole("button", { name: "Forcer l’exécution maintenant", exact: true }).click();
  await expect(page.getByRole("article", { name: "1 · Terminé", exact: true })).toBeVisible();
  expect((await (await request.get(`/api/prompt-queue/chats/${a.id}`)).json()).paused).toBe(true);
});

test("invalid selections are explained and a failed upload preserves text and files for retry", async ({ page }) => {
  await page.goto("/?mode=prompts");
  await expect(page.getByRole("button", { name: "Joindre des images ou documents", exact: true })).toBeEnabled();
  await picker(page).setInputFiles({ name: "program.exe", mimeType: "application/octet-stream", buffer: Buffer.from("MZ") });
  await expect(page.getByRole("alert")).toContainText("Format non pris en charge");
  await expect(page.locator(".prompt-composer .prompt-file-card")).toHaveCount(0);
  await picker(page).setInputFiles(Array.from({ length: 11 }, (_, index) => ({ name: `${index}.txt`, mimeType: "text/plain", buffer: Buffer.from("data") })));
  await expect(page.getByRole("alert")).toContainText("au maximum 10 fichiers");
  await picker(page).setInputFiles([photo, table]);
  await page.getByRole("textbox", { name: "Votre message", exact: true }).fill("QUEUE_E2E Retry the same documents");
  await page.route("**/api/prompt-queue/chats/*/prompts", route => route.fulfill({ status: 400, contentType: "application/json", body: JSON.stringify({ error: "Envoi interrompu pour le test" }) }));
  await page.getByRole("button", { name: "Envoyer", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("Envoi interrompu pour le test");
  await expect(page.getByRole("textbox", { name: "Votre message", exact: true })).toHaveValue("QUEUE_E2E Retry the same documents");
  await expect(page.locator(".prompt-composer .prompt-file-card")).toHaveCount(2);
  await page.unroute("**/api/prompt-queue/chats/*/prompts");
  await page.getByRole("button", { name: "Envoyer", exact: true }).click();
  await notice(page).getByRole("button", { name: "Garder en file d’attente", exact: true }).click();
  await expect(page.locator("article .prompt-file-card")).toHaveCount(2);
  await expect(page.getByRole("article")).toHaveCount(1);
  const menu = page.getByRole("button", { name: "Afficher les chats", exact: true }); if (await menu.isVisible()) await menu.click();
  await page.getByRole("button", { name: "Nouveau chat", exact: true }).click();
  await expect(page.locator(".prompt-composer .prompt-file-card")).toHaveCount(0);
  await expect(page.getByRole("textbox", { name: "Votre message", exact: true })).toHaveValue("");
});
