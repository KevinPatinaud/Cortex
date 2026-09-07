import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";

test.use({ timezoneId: "America/New_York" });

test("schedule uses browser time, previews server conversions, and persists edits", async ({ page, request }, testInfo) => {
  const name = `Schedule-${randomUUID().slice(0, 8)}`;
  const created = await request.post("/api/projects/create", { data: { name, engine: "codex", generationMode: "empty", instructions: "Schedule test" } });
  expect(created.status()).toBe(201);
  const { project } = await created.json();
  const base = `/api/agents/projects/${project.id}/workflow/schedule`;
  await request.put(`/api/agents/projects/${project.id}`, { data: {
    name, engine: "codex", instructions: "Schedule test", agents: [{ name: "Review", description: "Review", prompt: "Review" }]
  } });
  const initial = await (await request.get(base)).json();
  expect(initial.configured).toBe(false);
  await page.goto(`/?project=${project.id}`);
  await page.getByRole("button", { name: "Planifier", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByLabel("Fuseau de la planification")).toHaveValue("America/New_York");
  await expect(dialog.locator("time")).toHaveCount(3);
  await expect(dialog.locator("time").first()).toContainText("09:00");
  await expect(dialog.locator(".schedule-dialog__occurrences")).toContainText("Serveur");
  await expect(dialog.getByRole("button", { name: "Enregistrer", exact: true })).toBeEnabled();
  expect((await new AxeBuilder({ page }).include(".schedule-dialog").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
  expect(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  await mkdir("artifacts/cron-dialog", { recursive: true });
  await page.screenshot({ path: `artifacts/cron-dialog/${testInfo.project.name}.png` });

  await dialog.getByLabel("À quelle heure ?").fill("18:45");
  await expect(dialog.getByLabel("Expression cron", { exact: true })).toHaveValue("45 18 * * 1-5");
  await expect(dialog.locator("time").first()).toContainText("18:45");
  await dialog.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const saved = await (await request.get(base)).json();
  expect(saved).toMatchObject({ cron: "45 18 * * 1-5", timezone: "America/New_York", enabled: false, configured: true });

  await page.getByRole("button", { name: "Planifier", exact: true }).click();
  await expect(dialog.getByLabel("À quelle heure ?")).toHaveValue("18:45");
  await dialog.getByLabel("Fréquence", { exact: true }).selectOption("custom");
  await dialog.getByLabel("Expression cron", { exact: true }).fill("0 9 * *");
  await expect(dialog.getByRole("button", { name: "Enregistrer", exact: true })).toBeDisabled();
  await expect(dialog.locator("time")).toHaveCount(0);
  await dialog.getByLabel("Expression cron", { exact: true }).fill("0 9 31 2 *");
  await expect(dialog.getByRole("alert")).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Enregistrer", exact: true })).toBeDisabled();
  await dialog.getByLabel("Expression cron", { exact: true }).fill("15 23 * * 1,3,5");
  await dialog.getByLabel("Fuseau de la planification").selectOption("UTC");
  await expect(dialog.locator("time")).toHaveCount(3);
  const submitted = page.waitForRequest((req) => req.method() === "PUT" && req.url().endsWith(base));
  await dialog.getByRole("button", { name: "Enregistrer", exact: true }).click();
  expect((await submitted).postDataJSON()).toMatchObject({ cron: "15 23 * * 1,3,5", timezone: "UTC" });
  await expect(dialog).not.toBeVisible();
  await page.getByRole("button", { name: "Planifier", exact: true }).click();
  await expect(dialog.getByLabel("Fréquence", { exact: true })).toHaveValue("custom");
  await expect(dialog.getByLabel("Fuseau de la planification")).toHaveValue("UTC");
  await dialog.getByRole("button", { name: "Annuler", exact: true }).click();
  await expect(page.getByRole("button", { name: "Planifier", exact: true })).toBeFocused();
  const invalid = await request.put(base, { data: { cron: "0 9 * * *", timezone: "Invalid/Zone", enabled: false } });
  expect(invalid.status()).toBe(400);
  expect(await (await request.get(base)).json()).toMatchObject({ cron: "15 23 * * 1,3,5", timezone: "UTC" });
});
