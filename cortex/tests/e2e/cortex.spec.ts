import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";

async function createProject(request: APIRequestContext) {
  const name = `journey-${randomUUID().slice(0, 8)}`;
  const response = await request.post("/api/projects/create", {
    data: { name, engine: "codex", description: "Un rédacteur de test." }
  });
  expect(response.status()).toBe(201);
  return (await response.json()).project as { id: string; directoryPath: string };
}

async function openProject(page: Page, id: string) {
  await page.goto(`/?project=${id}`);
  await expect(page.getByRole("button", { name: "Modifier le projet", exact: true })).toBeVisible();
}

test("creation, editing, execution and audit use the real API", async ({ page, request }) => {
  const existing = await createProject(request);
  await openProject(page, existing.id);
  if (!await page.getByRole("button", { name: "Nouveau projet", exact: true }).isVisible()) {
    await page.getByRole("button", { name: "Afficher la liste des projets", exact: true }).click();
  }
  await page.getByRole("button", { name: "Nouveau projet", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: /Nom du projet/ }).fill(`created-${randomUUID().slice(0, 8)}`);
  await dialog.getByRole("textbox", { name: /Description du projet/ }).fill("Un rédacteur de test.");
  await dialog.getByRole("button", { name: "Générer le projet", exact: true }).click();
  const mission = page.getByRole("textbox", { name: /Mission/ });
  await expect(mission).toBeVisible();
  await mission.fill("Rédige un résultat validé.");
  await page.getByRole("button", { name: /Enregistrer et fermer/ }).click();
  await page.getByRole("button", { name: "Lancer l’agent", exact: true }).click();
  await expect(page.getByText("Résultat vérifié du moteur simulé.", { exact: true }).first()).toBeVisible();
  await page.getByRole("tab", { name: "Historique", exact: true }).click();
  await expect(page.getByText("Aucune exécution auditée pour ce projet.")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Historique des exécutions" })).toBeVisible();
  await expect(page.locator(".workflow-audit__run").first()).toBeVisible();
});

test("an unsaved draft survives reload and can be restored", async ({ page, request }) => {
  const project = await createProject(request);
  await openProject(page, project.id);
  await page.getByRole("button", { name: "Modifier le projet", exact: true }).click();
  await page.getByRole("textbox", { name: /Mission/ }).fill("Brouillon important à récupérer.");
  page.once("dialog", (dialog) => void dialog.accept());
  await page.reload();
  await page.getByRole("button", { name: "Modifier le projet", exact: true }).click();
  await page.getByRole("button", { name: "Restaurer le brouillon", exact: true }).click();
  await expect(page.getByRole("textbox", { name: /Mission/ })).toHaveValue("Brouillon important à récupérer.");
  await page.getByRole("button", { name: /Enregistrer et fermer/ }).click();
  const content = await (await request.get(`/api/agents/projects/${project.id}`)).json();
  expect(content.agents[0].prompt).toBe("Brouillon important à récupérer.");
});

test("back navigation can be cancelled without losing the draft or changing project", async ({ page, request }) => {
  const first = await createProject(request);
  const second = await createProject(request);
  await openProject(page, first.id);
  const secondName = second.directoryPath.split(/[\\/]/).at(-1)!;
  const secondButton = page.getByRole("button", { name: secondName, exact: true });
  if (!await secondButton.isVisible()) {
    await page.getByRole("button", { name: "Afficher la liste des projets", exact: true }).click();
  }
  await secondButton.click();
  await expect(page).toHaveURL(new RegExp(`project=${second.id}`));
  await page.getByRole("button", { name: "Modifier le projet", exact: true }).click();
  await page.getByRole("textbox", { name: /Mission/ }).fill("Brouillon conservé après retour annulé.");
  page.once("dialog", (dialog) => void dialog.dismiss());
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`project=${second.id}`));
  await expect(page.getByRole("textbox", { name: /Mission/ })).toHaveValue("Brouillon conservé après retour annulé.");
  page.once("dialog", (dialog) => void dialog.accept());
  await page.goBack();
  await expect(page).toHaveURL(new RegExp(`project=${first.id}`));
  await expect(page.getByRole("button", { name: "Modifier le projet", exact: true })).toBeVisible();
});

test("project creation dialogue supports keyboard dismissal", async ({ page, request }) => {
  const project = await createProject(request);
  await openProject(page, project.id);
  if (!await page.getByRole("button", { name: "Nouveau projet", exact: true }).isVisible()) {
    await page.getByRole("button", { name: "Afficher la liste des projets", exact: true }).click();
  }
  await page.getByRole("button", { name: "Nouveau projet", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("textbox", { name: /Nom du projet/ })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("a long execution reports progress and can be stopped then retried", async ({ page, request }) => {
  const project = await createProject(request);
  await openProject(page, project.id);
  const details = page.locator(".agent-card__additional-instructions textarea");
  await details.fill("E2E_SLOW");
  await page.getByRole("button", { name: "Lancer l’agent", exact: true }).click();
  await expect(page.getByText("Analyse des informations en cours…", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: /Arrêter/ }).first().click();
  await expect.poll(async () => {
    const content = await (await request.get(`/api/agents/projects/${project.id}`)).json();
    return content.agents[0].executionStatus;
  }).toBe("cancelled");
  await expect(details).toBeEnabled();
  await details.fill("");
  await page.getByRole("button", { name: /Lancer l’agent|Relancer|Reprendre/ }).last().click();
  await expect(page.getByText("Résultat vérifié du moteur simulé.", { exact: true }).first()).toBeVisible();
});

test("engine errors remain visible and allow a retry", async ({ page, request }) => {
  const project = await createProject(request);
  await openProject(page, project.id);
  const details = page.locator(".agent-card__additional-instructions textarea");
  await details.fill("E2E_FAIL");
  await page.getByRole("button", { name: "Lancer l’agent", exact: true }).click();
  await expect(page.getByText("Échec simulé du moteur.", { exact: true }).first()).toBeVisible();
  await details.fill("");
  await page.getByRole("button", { name: /Lancer l’agent|Relancer|Reprendre/ }).last().click();
  await expect(page.getByText("Résultat vérifié du moteur simulé.", { exact: true }).first()).toBeVisible();
});

test("exported archives can be imported through the UI", async ({ page, request }) => {
  const project = await createProject(request);
  const archive = await request.get(`/api/projects/${project.id}/export`);
  expect(archive.status()).toBe(200);
  await page.goto("/");
  await page.locator('input[type="file"][accept^=".ctx"]').setInputFiles({
    name: `imported-${randomUUID().slice(0, 8)}.ctx`,
    mimeType: "application/zip", buffer: await archive.body()
  });
  await expect(page.getByRole("button", { name: "Modifier le projet", exact: true })).toBeVisible();
  await expect(page).toHaveURL(/project=/);
});

test("workflow and editor fit the viewport and expose accessible controls", async ({ page, request }, testInfo) => {
  const project = await createProject(request);
  await openProject(page, project.id);
  for (const view of ["workflow", "editor"] as const) {
    if (view === "editor") {
      await page.getByRole("button", { name: "Modifier le projet", exact: true }).click();
      await expect(page.getByRole("textbox", { name: /Mission/ })).toBeVisible();
    } else {
      await expect(page.locator(".agent-card")).toBeVisible();
    }
    await expect(page.locator("main")).toHaveCount(1);
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
    expect(results.violations).toEqual([]);
    await testInfo.attach(`${view}-${testInfo.project.name}`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
  }
});
