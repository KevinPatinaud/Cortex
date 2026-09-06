import { expect, test, type Page, type TestInfo } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

async function capture(page: Page, testInfo: TestInfo, view: string) {
  const fullPage = await page.locator("dialog[open]").count() === 0;
  const screenshot = await page.screenshot({ fullPage });
  await testInfo.attach(`${view}-${testInfo.project.name}`, { body: screenshot, contentType: "image/png" });
  const phase = process.env.CORTEX_UX_CAPTURE_PHASE;
  if (phase === "before" || phase === "after") {
    const directory = path.resolve("artifacts", "ux-audit-2026-09-06", phase);
    await mkdir(directory, { recursive: true });
    await page.screenshot({ path: path.join(directory, `${view}-${testInfo.project.name}.png`), fullPage });
  }
}

async function expectAccessible(page: Page) {
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect.soft(results.violations).toEqual([]);
}

async function mockEmptyWorkspace(page: Page) {
  await page.route("**/api/projects", (route) => route.fulfill({ json: { projects: [] } }));
  await page.route("**/api/agents/projects/actual", (route) => route.fulfill({ json: null }));
}

test("a connection failure offers a retry without asking for a password", async ({ page }, testInfo) => {
  await mockEmptyWorkspace(page);
  let attempts = 0;
  await page.route("**/api/auth/session", (route) => {
    attempts += 1;
    return attempts === 1
      ? route.fulfill({ status: 503, json: { error: "Service unavailable" } })
      : route.fulfill({ json: { authenticated: true, required: false } });
  });
  await page.goto("/");
  await expect(page.getByRole("heading")).toBeVisible();
  await capture(page, testInfo, "connection-failure");
  await expect(page.getByLabel("Mot de passe", { exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Réessayer", exact: true }).click();
  await expect(page.getByRole("main").getByRole("button", { name: "Créer un projet", exact: true })).toBeVisible();
  expect(attempts).toBe(2);
  await expectAccessible(page);
});

test("a project list failure can be retried in place", async ({ page }) => {
  await mockEmptyWorkspace(page);
  let attempts = 0;
  await page.route("**/api/projects", (route) => {
    attempts += 1;
    return attempts === 1
      ? route.fulfill({ status: 503, json: { error: "Liste momentanément indisponible." } })
      : route.fulfill({ json: { projects: [{ id: "restored-project", directoryPath: "C:/audit/Projet retrouvé" }] } });
  });
  await page.goto("/");
  const sidebar = page.getByRole("complementary");
  await expect(sidebar.getByRole("alert")).toBeVisible();
  await sidebar.getByRole("button", { name: "Réessayer", exact: true }).click();
  await expect(sidebar.getByRole("button", { name: "Projet retrouvé", exact: true })).toBeVisible();
  await expect(sidebar.getByRole("alert")).toHaveCount(0);
  expect(attempts).toBe(2);
});

test("the empty mobile workspace is reachable and its project list can close", async ({ page }, testInfo) => {
  test.skip((testInfo.project.use.viewport?.width ?? 1440) > 700, "Mobile disclosure behavior");
  await mockEmptyWorkspace(page);
  await page.goto("/");
  const create = page.getByRole("main").getByRole("button", { name: "Créer un projet", exact: true });
  await expect(create).toBeVisible();
  await capture(page, testInfo, "welcome");
  await expect(create).toBeInViewport();
  const show = page.getByRole("button", { name: "Afficher la liste des projets", exact: true });
  await show.click();
  await expect(page.getByRole("searchbox")).toBeVisible();
  await page.setViewportSize({ width: page.viewportSize()!.width, height: 600 });
  await page.mouse.wheel(0, 500);
  await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(0);
  await page.getByRole("button", { name: "Masquer la liste des projets", exact: true }).click();
  await expect(page.getByRole("searchbox")).not.toBeVisible();
  await expect(create).toBeInViewport();
  await create.click();
  await expect(page.getByRole("dialog").getByRole("textbox", { name: /Nom du projet/ })).toBeFocused();
});

test("an invalid project link explains the problem instead of opening another project", async ({ page, request }) => {
  const response = await request.post("/api/projects/create", {
    data: { name: `valid-${randomUUID().slice(0, 8)}`, engine: "codex", description: "Un rédacteur de test." }
  });
  const { project } = await response.json();
  const content = await (await request.get(`/api/agents/projects/${project.id}`)).json();
  await page.route("**/api/agents/projects/actual", (route) => route.fulfill({ json: content }));
  await page.goto("/?project=unknown-project-id");
  await expect(page).not.toHaveURL(/project=/);
  await expect(page.getByRole("alert")).toContainText("Ce projet est introuvable.");
  await expect(page.getByRole("main").getByRole("button", { name: "Créer un projet", exact: true })).toBeVisible();
  await expect(page.locator(".agent-card")).toHaveCount(0);
});

test("projects can be reordered with keyboard shortcuts", async ({ page }) => {
  await mockEmptyWorkspace(page);
  let projects = [
    { id: "alpha", directoryPath: "C:/audit/Alpha" },
    { id: "beta", directoryPath: "C:/audit/Bêta" }
  ];
  await page.route("**/api/projects", (route) => route.fulfill({ json: { projects } }));
  await page.route("**/api/projects/order", async (route) => {
    const { projectIds } = route.request().postDataJSON() as { projectIds: string[] };
    projects = projectIds.map((id) => projects.find((project) => project.id === id)!);
    await route.fulfill({ json: { projects } });
  });
  await page.goto("/");
  await expect(page.locator(".project-list__select-button")).toHaveCount(2);
  if (!await page.getByRole("button", { name: "Alpha", exact: true }).isVisible()) {
    await page.getByRole("button", { name: "Afficher la liste des projets", exact: true }).click();
  }
  const alpha = page.getByRole("button", { name: "Alpha", exact: true });
  await expect(alpha).toBeEnabled();
  await alpha.focus();
  await page.keyboard.press("Alt+ArrowDown");
  await expect(page.locator(".project-list__select-button")).toHaveText(["Bêta", "Alpha"]);
  await expect(alpha).toBeEnabled();
  await expect(alpha).toBeFocused();
  await page.keyboard.press("Alt+ArrowUp");
  await expect(page.locator(".project-list__select-button")).toHaveText(["Alpha", "Bêta"]);
  await expect(alpha).toHaveAttribute("aria-keyshortcuts", "Alt+ArrowUp Alt+ArrowDown");
  await expect(alpha).toBeFocused();
  await page.getByRole("searchbox").fill("Alpha");
  await expect(alpha).not.toHaveAttribute("aria-keyshortcuts");
});

test("a late project response cannot replace a newer browser navigation", async ({ page, request }) => {
  const projects = [] as { id: string; directoryPath: string }[];
  for (const prefix of ["previous", "current", "slow"]) {
    const response = await request.post("/api/projects/create", {
      data: { name: `${prefix}-${randomUUID().slice(0, 8)}`, engine: "codex", description: "Un rédacteur de test." }
    });
    expect(response.status()).toBe(201);
    projects.push((await response.json()).project);
  }
  const [previous, current, slow] = projects;
  const name = (project: typeof previous) => project.directoryPath.split(/[\\/]/).at(-1)!;
  await page.goto(`/?project=${previous.id}`);
  await expect(page.getByRole("heading", { name: name(previous), exact: true })).toBeVisible();
  async function select(project: typeof previous) {
    const button = page.getByRole("button", { name: name(project), exact: true });
    if (!await button.isVisible()) {
      await page.getByRole("button", { name: "Afficher la liste des projets", exact: true }).click();
    }
    await button.click();
  }
  await select(current);
  await expect(page).toHaveURL(new RegExp(`project=${current.id}`));
  const slowContent = await (await request.get(`/api/agents/projects/${slow.id}`)).json();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await page.route(`**/api/agents/projects/${slow.id}`, async (route) => {
    await gate;
    await route.fulfill({ json: slowContent });
  });
  await select(slow);
  await expect(page.locator(".project-loading-overlay")).toBeVisible();
  await page.goBack();
  await expect(page.getByRole("heading", { name: name(previous), exact: true })).toBeVisible();
  const response = page.waitForResponse((incoming) => incoming.url().endsWith(`/api/agents/projects/${slow.id}`));
  release();
  await response;
  await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => resolve())));
  await expect(page).toHaveURL(new RegExp(`project=${previous.id}`));
  await expect(page.getByRole("heading", { name: name(previous), exact: true })).toBeVisible();
});

test("secondary views expose accessible creation, history and engine settings", async ({ page, request }, testInfo) => {
  // Settings discovery is mocked so this browser audit cannot read machine integrations.
  await page.route("**/api/agents/mcp-connections?*", (route) => route.fulfill({ json: { connections: [], issues: [] } }));
  await page.route("**/api/agents/codex-plugins", (route) => route.fulfill({ json: { available: true, plugins: [], error: null } }));
  const response = await request.post("/api/projects/create", {
    data: { name: `audit-${randomUUID().slice(0, 8)}`, engine: "codex", description: "Un rédacteur de test." }
  });
  expect(response.status()).toBe(201);
  const { project } = await response.json();
  await page.goto(`/?project=${project.id}`);
  await expect(page.locator(".agent-card")).toBeVisible();
  await capture(page, testInfo, "workflow");
  await page.getByRole("tab", { name: "Historique", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Historique des exécutions", exact: true })).toBeVisible();
  await capture(page, testInfo, "history-empty");
  await expectAccessible(page);
  if (!await page.getByRole("button", { name: "Nouveau projet", exact: true }).isVisible()) {
    await page.getByRole("button", { name: "Afficher la liste des projets", exact: true }).click();
  }
  await capture(page, testInfo, "project-list");
  await page.getByRole("button", { name: "Nouveau projet", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("textbox", { name: /Nom du projet/ })).toBeFocused();
  await capture(page, testInfo, "project-creation");
  await expectAccessible(page);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.locator(".agent-engine-settings-trigger").click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByRole("dialog").getByRole("tab", { name: "Général", exact: true })).toBeVisible();
  await expect(page.getByRole("dialog").getByRole("checkbox").first()).toBeEnabled();
  await capture(page, testInfo, "settings-general");
  await expectAccessible(page);
  await page.getByRole("dialog").getByRole("tab", { name: "Intégrations et MCP", exact: true }).click();
  await capture(page, testInfo, "settings-integrations");
  await expectAccessible(page);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.locator(".agent-engine-settings-trigger")).toBeFocused();
});
