import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

type Project = { id: string; directoryPath: string; name: string };

async function createProject(request: APIRequestContext): Promise<Project> {
  const name = `Suppression-${randomUUID().slice(0, 8)}`;
  const response = await request.post("/api/projects/create", {
    data: { name, engine: "codex", generationMode: "empty", instructions: "# Instructions à conserver" }
  });
  expect(response.status()).toBe(201);
  return { ...(await response.json()).project, name };
}

async function openProjects(page: Page, projects: Project[]) {
  await page.route("**/api/projects", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    await route.fulfill({ response, json: {
      ...data, projects: data.projects.filter((project: Project) => projects.some(({ id }) => id === project.id))
    } });
  });
  await page.goto(`/?project=${projects[0].id}`);
  await expect(page.getByRole("button", { name: "Modifier le projet", exact: true })).toBeVisible();
  if (!await page.getByRole("button", { name: "Nouveau répertoire", exact: true }).isVisible()) {
    await page.getByRole("button", { name: "Afficher la liste des projets", exact: true }).click();
  }
}

test("sidebar deletion warns, supports cancellation and retry, and preserves project files", async ({ page, request }, testInfo) => {
  const project = await createProject(request);
  const instructionsPath = path.join(project.directoryPath, "AGENTS.md");
  const instructions = await readFile(instructionsPath, "utf8");
  await openProjects(page, [project]);
  const remove = page.getByRole("button", { name: `Supprimer ${project.name}`, exact: true });
  await expect(remove).toBeInViewport();
  const bounds = (await remove.boundingBox())!;
  expect(bounds.width).toBeGreaterThanOrEqual(32);
  expect(bounds.height).toBeGreaterThanOrEqual(32);
  await remove.focus();
  await remove.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Supprimer ce projet ?", exact: true });
  await expect(dialog).toContainText(project.name);
  await expect(dialog.locator(".confirmation-dialog__warning")).toContainText("Les fichiers resteront présents sur le disque");
  await expect(dialog.getByRole("button", { name: "Annuler", exact: true })).toBeFocused();
  await testInfo.attach("project-deletion-warning", { body: await page.screenshot(), contentType: "image/png" });
  const accessibility = await new AxeBuilder({ page }).include(".confirmation-dialog").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(accessibility.violations).toEqual([]);
  await dialog.getByRole("button", { name: "Annuler", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(remove).toBeFocused();
  await remove.click();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(remove).toBeFocused();
  expect((await (await request.get("/api/projects")).json()).projects.some(({ id }: Project) => id === project.id)).toBe(true);

  await page.route("**/api/projects", async (route) => {
    if (route.request().method() === "DELETE") {
      await route.fulfill({ status: 503, json: { error: "Suppression temporairement indisponible." } });
    } else await route.fallback();
  });
  await remove.click();
  await dialog.getByRole("button", { name: "Supprimer", exact: true }).click();
  await expect(dialog.getByRole("alert")).toContainText("Suppression temporairement indisponible.");
  await expect(page).toHaveURL(new RegExp(`project=${project.id}`));
  await page.unroute("**/api/projects");
  await dialog.getByRole("button", { name: "Supprimer", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(remove).toHaveCount(0);
  await expect(page).not.toHaveURL(/project=/);
  await expect(page.locator(".project-sidebar__add-button")).toBeFocused();
  expect(await readFile(instructionsPath, "utf8")).toBe(instructions);
  expect((await (await request.get("/api/projects")).json()).projects.some(({ id }: Project) => id === project.id)).toBe(false);
});

test("deleting another project keeps the current project open and persists after reload", async ({ page, request }) => {
  const active = await createProject(request);
  const other = await createProject(request);
  await openProjects(page, [active, other]);
  await page.getByRole("button", { name: `Supprimer ${other.name}`, exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Supprimer ce projet ?", exact: true });
  await expect(dialog).toContainText(other.name);
  await dialog.getByRole("button", { name: "Supprimer", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: `Supprimer ${other.name}`, exact: true })).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`project=${active.id}`));
  await expect(page.getByRole("button", { name: "Modifier le projet", exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Modifier le projet", exact: true })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`project=${active.id}`));
  await expect(page.getByRole("button", { name: `Supprimer ${other.name}`, exact: true })).toHaveCount(0);
});
