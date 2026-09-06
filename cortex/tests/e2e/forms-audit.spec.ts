import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

const mockConnection = {
  id: "codex:user:fixture:context7",
  name: "context7",
  transport: "stdio",
  endpoint: "npx",
  source: "codex",
  scope: "user",
  configurationFile: "fixture-only.toml",
  configuredFor: ["codex"],
  compatibleEngines: ["codex", "claude", "copilot"],
  hasAuthentication: false,
  manageable: true
};

async function openConnections(page: Page, connections: unknown[] = []) {
  // All machine integration endpoints are intercepted: these tests never alter user configuration.
  await page.route("**/api/agents/mcp-connections**", (route) => route.fulfill({
    json: { connections, issues: [] }
  }));
  await page.route("**/api/agents/codex-plugins", (route) => route.fulfill({
    json: { available: true, plugins: [], error: null }
  }));
  await page.goto("/");
  const trigger = page.locator(".agent-engine-settings-trigger");
  await expect(trigger).toBeAttached();
  if (!await trigger.isVisible()) {
    await page.getByRole("button", { name: "Afficher la liste des projets", exact: true }).click();
  }
  await trigger.click();
  await page.getByRole("dialog").getByRole("tab", { name: "Intégrations et MCP", exact: true }).click();
}

test("sign-in distinguishes network failures from invalid passwords and keeps correction focused", async ({ page }) => {
  await page.route("**/api/auth/session", (route) => route.fulfill({
    json: { authenticated: false, required: true }
  }));
  let attempts = 0;
  await page.route("**/api/auth/login", (route) => route.fulfill({
    status: ++attempts === 1 ? 503 : 401,
    json: { error: attempts === 1 ? "Service unavailable" : "Invalid password" }
  }));
  await page.goto("/");
  const password = page.getByLabel("Mot de passe", { exact: true });
  await expect(password).toBeFocused();
  await password.fill("fixture-password");
  await page.getByRole("button", { name: "Se connecter", exact: true }).click();
  await expect(page.getByRole("alert")).not.toHaveText("Le mot de passe est incorrect.");
  await expect(page.getByRole("alert")).toBeVisible();
  await expect(password).toHaveValue("fixture-password");
  await expect(password).toBeFocused();
  await expect(password).not.toHaveAttribute("aria-invalid", "true");
  await page.getByRole("button", { name: "Se connecter", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText("Le mot de passe est incorrect.");
  await expect(password).toHaveAttribute("aria-invalid", "true");
  await expect(password).toBeFocused();
  await expect.poll(() => password.evaluate((input: HTMLInputElement) =>
    input.selectionEnd! - input.selectionStart!
  )).toBe("fixture-password".length);
  await password.fill("corrected-password");
  await expect(page.getByRole("alert")).toHaveCount(0);
  await expect(password).not.toHaveAttribute("aria-invalid", "true");
});

test("Markdown tabs and formatting tools support keyboard navigation without losing the selection", async ({ page, request }) => {
  const response = await request.post("/api/projects/create", {
    data: { name: `keyboard-${randomUUID().slice(0, 8)}`, engine: "codex", description: "Un rédacteur de test." }
  });
  expect(response.status()).toBe(201);
  const { project } = await response.json();
  await page.goto(`/?project=${project.id}`);
  await page.getByRole("button", { name: "Modifier le projet", exact: true }).click();
  const editor = page.locator(".markdown-editor").and(page.getByLabel("Mission et instructions", { exact: true }));
  const mission = editor.locator("textarea");
  await mission.fill("Bonjour Cortex");
  await mission.press("ControlOrMeta+a");
  const write = editor.getByRole("tab", { name: "Écrire", exact: true });
  const preview = editor.getByRole("tab", { name: "Aperçu", exact: true });
  await write.focus();
  await write.press("ArrowRight");
  await expect(preview).toBeFocused();
  await expect(preview).toHaveAttribute("aria-selected", "true");
  await expect(editor.getByRole("tabpanel", { name: "Aperçu", exact: true })).toHaveText("Bonjour Cortex");
  await preview.press("Tab");
  await expect(editor.getByRole("tabpanel", { name: "Aperçu", exact: true })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await preview.press("Home");
  await expect(write).toBeFocused();
  await write.press("Tab");
  await expect(editor.getByRole("button", { name: "Titre", exact: true })).toBeFocused();
  await page.keyboard.press("ArrowRight");
  await expect(editor.getByRole("button", { name: "Gras (Ctrl+B)", exact: true })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(mission).toBeFocused();
  await expect(mission).toHaveValue("**Bonjour Cortex**");
  await page.keyboard.press("Shift+Tab");
  await page.keyboard.press("End");
  await expect(editor.getByRole("button", { name: "Code", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(mission).toBeFocused();
});

test("MCP editing blocks writes after a failed load and offers recovery with focus restored", async ({ page }) => {
  await openConnections(page, [mockConnection]);
  let loadAttempts = 0;
  let writeAttempts = 0;
  await page.route("**/api/agents/mcp-connections/codex/context7", (route) => {
    if (route.request().method() !== "GET") {
      writeAttempts++;
      return route.fulfill({ json: mockConnection });
    }
    if (++loadAttempts === 1) {
      return route.fulfill({ status: 503, json: { error: "Chargement temporairement indisponible." } });
    }
    return route.fulfill({ json: {
      engine: "codex", name: "context7", transport: "stdio", command: "npx",
      args: ["-y", "@upstash/context7-mcp"], url: "", environmentKeys: [], headerNames: []
    } });
  });
  const editButton = page.getByRole("button", { name: "Modifier la connexion context7", exact: true });
  await editButton.click();
  const dialog = page.locator(".mcp-connection-dialog");
  const name = dialog.getByRole("textbox", { name: /^Nom/ });
  const save = dialog.getByRole("button", { name: "Enregistrer la connexion", exact: true });
  await expect(dialog.getByRole("alert")).toHaveText("Chargement temporairement indisponible.");
  await expect(name).toBeDisabled();
  await expect(save).toBeDisabled();
  expect(writeAttempts).toBe(0);
  await dialog.getByRole("button", { name: "Réessayer", exact: true }).click();
  await expect(name).toHaveValue("context7");
  await expect(name).toBeFocused();
  await expect(save).toBeEnabled();
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await dialog.getByRole("button", { name: "Fermer", exact: true }).focus();
  await page.keyboard.press("Shift+Tab");
  await expect(save).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(editButton).toBeFocused();
  expect(writeAttempts).toBe(0);
});

test("MCP form explains invalid entries and does not validate fields hidden by transport changes", async ({ page }) => {
  await openConnections(page);
  const writes: Array<Record<string, unknown>> = [];
  await page.route("**/api/agents/mcp-connections", (route) => {
    if (route.request().method() === "POST") {
      writes.push(route.request().postDataJSON());
      return route.fulfill({ status: 201, json: mockConnection });
    }
    return route.fulfill({ json: { connections: [], issues: [] } });
  });
  await page.getByRole("button", { name: "Ajouter une connexion machine", exact: true }).click();
  const dialog = page.locator(".mcp-connection-dialog");
  const name = dialog.getByRole("textbox", { name: /^Nom/ });
  const save = dialog.getByRole("button", { name: "Ajouter la connexion", exact: true });
  await expect(name).toBeFocused();
  await name.fill("invalid name");
  await dialog.getByRole("textbox", { name: /^Commande/ }).fill("npx");
  await save.click();
  await expect(name).toBeFocused();
  expect(await name.evaluate((input: HTMLInputElement) => input.validity.patternMismatch)).toBe(true);
  expect(writes).toHaveLength(0);
  await name.fill("valid-name");
  const environment = dialog.getByRole("textbox", { name: /^Variables/ });
  await environment.fill("MISSING_EQUALS");
  await save.click();
  await expect(environment).toBeFocused();
  await expect(environment).toHaveAttribute("aria-invalid", "true");
  await expect(dialog.getByRole("alert")).toHaveText("Chaque entrée doit utiliser le format NOM=VALEUR.");
  await dialog.getByRole("combobox", { name: "Transport", exact: true }).selectOption("http");
  const url = dialog.getByRole("textbox", { name: /^URL/ });
  await url.fill("https://example.com/mcp");
  await save.click();
  await expect(dialog).not.toBeVisible();
  expect(writes).toHaveLength(1);
  expect(writes[0]).toMatchObject({ transport: "http", url: "https://example.com/mcp", headers: {}, environment: {} });
});

test("settings cannot overwrite unloaded values and report save failures in the active General tab", async ({ page }) => {
  let readAttempts = 0;
  let writeAttempts = 0;
  await page.route("**/api/agents/configuration", (route) => {
    if (route.request().method() !== "GET") {
      writeAttempts++;
      return route.fulfill({ status: 503, json: { error: "Enregistrement temporairement indisponible." } });
    }
    if (++readAttempts === 1) {
      return route.fulfill({ status: 503, json: { error: "Réglages temporairement indisponibles." } });
    }
    return route.fulfill({ json: { autopilot: false, allowAll: false } });
  });
  await openConnections(page);
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("tab", { name: "Général", exact: true }).click();
  const autopilot = dialog.getByRole("checkbox", { name: /^Autopilot/ });
  await expect(dialog.getByRole("alert")).toHaveText("Impossible de charger les réglages. Réessayez avant de les modifier.");
  await expect(autopilot).toBeDisabled();
  await expect(dialog.getByRole("textbox", { name: "Emplacement de stockage des projets", exact: true })).toBeDisabled();
  await expect(dialog.getByRole("combobox", { name: "Langue", exact: true })).toBeEnabled();
  expect(writeAttempts).toBe(0);
  await dialog.getByRole("button", { name: "Réessayer", exact: true }).click();
  await expect(autopilot).toBeEnabled();
  await expect(autopilot).not.toBeChecked();
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await autopilot.click();
  await expect(dialog.getByRole("alert")).toHaveText("Enregistrement temporairement indisponible.");
  await expect(autopilot).not.toBeChecked();
  expect(writeAttempts).toBe(1);
});
