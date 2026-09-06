import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, readdir } from "node:fs/promises";
import path from "node:path";

function minimalInstructions(name: string) {
  return `# ${name}\n\n## Instructions globales\n\nÀ compléter.\n`;
}

async function openCreation(page: Page) {
  // Keep the starting screen independent of projects created by other tests.
  // Creation and all reads of the resulting project still use the real fixture.
  await page.route("**/api/projects", (route) => route.fulfill({ json: { projects: [] } }));
  await page.route("**/api/agents/projects/actual", (route) => route.fulfill({ json: null }));
  await page.goto("/");
  await page.getByRole("main").getByRole("button", { name: "Créer un projet", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("textbox", { name: /Nom du projet/ })).toBeFocused();
  await expect(dialog.getByRole("radio", { name: /Codex/ })).toBeEnabled();
  return dialog;
}

async function expectEmptyProject(
  request: APIRequestContext,
  project: { id: string; directoryPath: string },
  engine: "codex" | "claude" | "copilot",
  instructions: string
) {
  const response = await request.get(`/api/agents/projects/${project.id}`);
  expect(response.status()).toBe(200);
  const content = await response.json();
  expect(content.engine).toBe(engine);
  expect(content.agents).toEqual([]);
  expect(content.instructions.content).toBe(instructions);
  const instructionFile = engine === "claude" ? "CLAUDE.md" : "AGENTS.md";
  expect(await readFile(path.join(project.directoryPath, instructionFile), "utf8")).toBe(instructions);
  const files = await readdir(project.directoryPath, { recursive: true, withFileTypes: true });
  expect(files.filter((entry) => entry.isFile() && entry.name !== instructionFile && entry.name !== ".gitkeep")).toEqual([]);
}

test("creation modes preserve their fields and validate only the active mode", async ({ page }) => {
  const dialog = await openCreation(page);
  const ai = dialog.getByRole("radio", { name: /Avec IA/ });
  const empty = dialog.getByRole("radio", { name: /Sans IA/ });
  const description = dialog.getByRole("textbox", { name: /Description du projet/ });
  const instructions = dialog.getByRole("textbox", { name: /Instructions globales/ });
  await expect(ai).toBeChecked();
  await expect(description).toHaveAttribute("required", "");
  await expect(instructions).toHaveCount(0);
  await expect(dialog.getByRole("button", { name: "Générer le projet", exact: true })).toBeDisabled();
  await dialog.getByRole("textbox", { name: /Nom du projet/ }).fill("Mon projet");
  await expect(dialog.getByRole("button", { name: "Générer le projet", exact: true })).toBeDisabled();
  await description.fill("Une équipe pour préparer les publications.");
  await expect(dialog.getByRole("button", { name: "Générer le projet", exact: true })).toBeEnabled();

  await ai.focus();
  await ai.press("ArrowRight");
  await expect(empty).toBeChecked();
  await expect(empty).toBeFocused();
  await expect(description).toHaveCount(0);
  await expect(instructions).not.toHaveAttribute("required");
  await expect(dialog.getByRole("button", { name: "Créer le projet", exact: true })).toBeEnabled();
  await instructions.fill("# Instructions globales\n\nRépondre en français.");
  await empty.focus();
  await empty.press("ArrowLeft");
  await expect(ai).toBeChecked();
  await expect(ai).toBeFocused();
  await expect(description).toHaveValue("Une équipe pour préparer les publications.");
  await description.fill("   ");
  await expect(dialog.getByRole("button", { name: "Générer le projet", exact: true })).toBeDisabled();
  await dialog.getByText("Sans IA", { exact: true }).click();
  await expect(instructions).toHaveValue("# Instructions globales\n\nRépondre en français.");
  await expect(dialog.getByRole("button", { name: "Créer le projet", exact: true })).toBeEnabled();
});

for (const withInstructions of [true, false]) {
  test(`creation without AI persists ${withInstructions ? "global instructions" : "a minimal instruction template"} and no agents`, async ({ page, request }) => {
    const dialog = await openCreation(page);
    const name = `empty-${randomUUID().slice(0, 8)}`;
    const instructions = withInstructions ? "# Instructions globales\n\nRépondre en français et citer les sources." : "";
    await dialog.getByRole("textbox", { name: /Nom du projet/ }).fill(name);
    await dialog.getByText("Sans IA", { exact: true }).click();
    await dialog.getByRole("textbox", { name: /Instructions globales/ }).fill(instructions);
    const created = page.waitForResponse((response) => response.url().endsWith("/api/projects/create") && response.request().method() === "POST");
    await dialog.getByRole("button", { name: "Créer le projet", exact: true }).click();
    const response = await created;
    expect(response.status()).toBe(201);
    expect(response.request().postDataJSON()).toEqual({ name, engine: "codex", generationMode: "empty", instructions });
    const { project } = await response.json();
    await expect(dialog).toHaveCount(0);
    await expect(page).toHaveURL(new RegExp(`project=${project.id}`));
    await expectEmptyProject(request, project, "codex", withInstructions ? instructions : minimalInstructions(name));
  });
}

test("creation with AI sends the description and opens the generated project", async ({ page, request }) => {
  const dialog = await openCreation(page);
  const name = `generated-${randomUUID().slice(0, 8)}`;
  const description = "Un rédacteur qui prépare des publications en français.";
  await dialog.getByRole("textbox", { name: /Nom du projet/ }).fill(name);
  await dialog.getByRole("textbox", { name: /Description du projet/ }).fill(description);
  const created = page.waitForResponse((response) => response.url().endsWith("/api/projects/create") && response.request().method() === "POST");
  await dialog.getByRole("button", { name: "Générer le projet", exact: true }).click();
  const response = await created;
  expect(response.status()).toBe(201);
  expect(response.request().postDataJSON()).toEqual({ name, engine: "codex", generationMode: "ai", description });
  const { project } = await response.json();
  await expect(dialog).toHaveCount(0);
  await expect(page).toHaveURL(new RegExp(`project=${project.id}`));
  const content = await (await request.get(`/api/agents/projects/${project.id}`)).json();
  expect(content.instructions.content).toBe("Instructions du projet de test.");
  expect(content.agents).toHaveLength(1);
});

test("creation without AI remains available when engine detection fails", async ({ page, request }) => {
  await page.route("**/api/agents/status", (route) => route.fulfill({ status: 503, json: { error: "Détection indisponible." } }));
  const dialog = await openCreation(page);
  const name = `offline-${randomUUID().slice(0, 8)}`;
  await dialog.getByRole("textbox", { name: /Nom du projet/ }).fill(name);
  await dialog.getByText("Sans IA", { exact: true }).click();
  await dialog.getByText("Claude", { exact: true }).click();
  const created = page.waitForResponse((response) => response.url().endsWith("/api/projects/create") && response.request().method() === "POST");
  await dialog.getByRole("button", { name: "Créer le projet", exact: true }).click();
  const response = await created;
  expect(response.status()).toBe(201);
  await expectEmptyProject(request, (await response.json()).project, "claude", minimalInstructions(name));
});

test("creation without AI completes while engine detection is still pending", async ({ page, request }) => {
  let releaseDetection!: () => void;
  let detectionRequests = 0;
  let detectionResponses = 0;
  const detectionGate = new Promise<void>((resolve) => { releaseDetection = resolve; });
  await page.route("**/api/agents/status", async (route) => {
    detectionRequests++;
    await detectionGate;
    detectionResponses++;
    await route.fulfill({ json: { engine: "codex", label: "Codex", error: null } });
  });
  try {
    await page.route("**/api/projects", (route) => route.fulfill({ json: { projects: [] } }));
    await page.route("**/api/agents/projects/actual", (route) => route.fulfill({ json: null }));
    await page.goto("/");
    await page.getByRole("main").getByRole("button", { name: "Créer un projet", exact: true }).click();
    const dialog = page.getByRole("dialog");
    const name = `pending-${randomUUID().slice(0, 8)}`;
    await dialog.getByRole("textbox", { name: /Nom du projet/ }).fill(name);
    await dialog.getByRole("textbox", { name: /Description du projet/ }).fill("Une description complète.");
    await expect.poll(() => detectionRequests).toBeGreaterThan(0);
    await expect(dialog.getByRole("button", { name: "Générer le projet", exact: true })).toBeDisabled();
    await dialog.getByText("Sans IA", { exact: true }).click();
    await dialog.getByText("Copilot", { exact: true }).click();
    const create = dialog.getByRole("button", { name: "Créer le projet", exact: true });
    await expect(create).toBeEnabled();
    const created = page.waitForResponse((response) => response.url().endsWith("/api/projects/create") && response.request().method() === "POST");
    await create.click();
    const response = await created;
    expect(response.status()).toBe(201);
    expect(detectionResponses).toBe(0);
    await expectEmptyProject(request, (await response.json()).project, "copilot", minimalInstructions(name));
  } finally {
    releaseDetection();
    await page.unrouteAll({ behavior: "wait" });
  }
});

test("empty projects retain their selected engine for all three file formats", async ({ request }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium-1440", "API format coverage only needs one viewport.");
  for (const engine of ["codex", "claude", "copilot"] as const) {
    const instructions = `# Projet ${engine}\n\nConserver ces instructions.`;
    const response = await request.post("/api/projects/create", {
      data: { name: `format-${engine}-${randomUUID().slice(0, 8)}`, engine, generationMode: "empty", instructions }
    });
    expect(response.status()).toBe(201);
    await expectEmptyProject(request, (await response.json()).project, engine, instructions);
  }
});

test("both creation modes fit the viewport and expose accessible controls", async ({ page }, testInfo) => {
  const dialog = await openCreation(page);
  await dialog.getByRole("textbox", { name: /Nom du projet/ }).fill("Atlas");
  const directory = path.resolve("artifacts", "project-creation-modes");
  await mkdir(directory, { recursive: true });
  for (const mode of ["ai", "empty"] as const) {
    await dialog.getByText(mode === "ai" ? "Avec IA" : "Sans IA", { exact: true }).click();
    await dialog.getByRole("textbox", { name: mode === "ai" ? /Description du projet/ : /Instructions globales/ }).fill(
      mode === "ai" ? "Préparer des publications documentées pour notre équipe, de la recherche à la rédaction." : "# Instructions globales\n\nRépondre en français. Privilégier les sources officielles et des explications concises."
    );
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect.poll(() => dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    const accessibility = await new AxeBuilder({ page }).include(".project-creation-dialog").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect.soft(accessibility.violations).toEqual([]);
    await dialog.evaluate((element) => { element.scrollTop = 0; });
    const screenshot = await page.screenshot({ path: path.join(directory, `${mode}-${testInfo.project.name}.png`) });
    await testInfo.attach(`${mode}-${testInfo.project.name}`, { body: screenshot, contentType: "image/png" });
    const submit = dialog.getByRole("button", { name: mode === "ai" ? "Générer le projet" : "Créer le projet", exact: true });
    await submit.scrollIntoViewIfNeeded();
    await expect(submit).toBeInViewport();
    if ((page.viewportSize()?.width ?? 1440) <= 700) {
      await page.screenshot({ path: path.join(directory, `${mode}-${testInfo.project.name}-actions.png`) });
    }
  }
});
