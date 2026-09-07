import { expect, test as base, type APIRequestContext, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import path from "node:path";

type Project = { id: string; directoryPath: string; name: string };
type Folder = { id: string; name: string };
type Organization = { folders: Folder[]; projectFolders: Record<string, string> };

const test = base.extend<{ folderIds: string[] }>({
  folderIds: async ({ request }, use) => {
    const ids: string[] = [];
    await use(ids);
    for (const id of ids) await request.delete(`/api/projects/folders/${id}`);
  }
});

async function createProject(request: APIRequestContext, prefix = "folder-project"): Promise<Project> {
  const name = `${prefix}-${randomUUID().slice(0, 8)}`;
  const response = await request.post("/api/projects/create", {
    data: { name, engine: "codex", generationMode: "empty", instructions: "# Instructions\n\nConserver le contenu du projet." }
  });
  expect(response.status()).toBe(201);
  return { ...(await response.json()).project, name };
}

async function organization(request: APIRequestContext): Promise<Organization> {
  const response = await request.get("/api/projects/folders");
  expect(response.ok()).toBe(true);
  return response.json();
}

async function createFolder(request: APIRequestContext, name: string, ids: string[]): Promise<Folder> {
  const response = await request.post("/api/projects/folders", { data: { name } });
  expect(response.ok()).toBe(true);
  const data = await response.json() as Organization;
  const folder = data.folders.find((candidate) => candidate.name === name)!;
  expect(folder).toBeDefined();
  ids.push(folder.id);
  return folder;
}

async function assign(request: APIRequestContext, project: Project, folder: Folder) {
  const response = await request.put(`/api/projects/${project.id}/folder`, { data: { folderId: folder.id } });
  expect(response.ok()).toBe(true);
}

function folderSection(page: Page, id: string | null) {
  return page.locator(`.project-folder[data-folder-id="${id ?? ""}"]`);
}

function projectRow(page: Page, project: Project) {
  return page.locator(".project-list__item").filter({ has: page.getByRole("button", { name: project.name, exact: true }) });
}

async function showSidebar(page: Page) {
  const create = page.getByRole("button", { name: "Nouveau répertoire", exact: true });
  if (!await create.isVisible()) {
    await page.getByRole("button", { name: "Afficher la liste des projets", exact: true }).click();
  }
  await expect(create).toBeVisible();
}

async function openProjects(page: Page, projects: Project[]) {
  // Isolate the sidebar from projects created by other fixture tests. Folder
  // mutations, persistence and project content still use the real HTTP server.
  const ids = new Set(projects.map((project) => project.id));
  await page.route("**/api/projects", async (route) => {
    const response = await route.fetch();
    const data = await response.json();
    await route.fulfill({ response, json: { ...data, projects: data.projects.filter((project: Project) => ids.has(project.id)) } });
  });
  await page.goto(`/?project=${projects[0].id}`);
  await expect(page.getByRole("button", { name: "Modifier le projet", exact: true })).toBeVisible();
  await showSidebar(page);
}

async function classify(page: Page, project: Project, folderId: string | null) {
  await page.getByRole("button", { name: `Ranger ${project.name}`, exact: true }).click();
  const select = page.getByRole("combobox", { name: `Répertoire de ${project.name}`, exact: true });
  const saved = page.waitForResponse((response) => response.url().endsWith(`/api/projects/${project.id}/folder`) && response.request().method() === "PUT");
  await select.selectOption(folderId ?? "");
  expect((await saved).ok()).toBe(true);
  await expect(folderSection(page, folderId).getByRole("button", { name: project.name, exact: true })).toBeVisible();
}

test("creating and classifying a project persists after reload without moving its directory", async ({ page, request, folderIds }) => {
  const project = await createProject(request);
  await openProjects(page, [project]);
  const sidebar = page.locator(".project-sidebar");
  const name = `Clients-${randomUUID().slice(0, 8)}`;
  const search = page.getByPlaceholder("Rechercher un projet", { exact: true });
  await search.fill("filtre-sans-correspondance");
  await sidebar.getByRole("button", { name: "Nouveau répertoire", exact: true }).click();
  const input = sidebar.getByRole("textbox", { name: "Nom du répertoire", exact: true });
  await expect(input).toBeFocused();
  await input.fill(name);
  const created = page.waitForResponse((response) => response.url().endsWith("/api/projects/folders") && response.request().method() === "POST");
  await sidebar.getByRole("button", { name: "Créer", exact: true }).click();
  const response = await created;
  expect(response.ok()).toBe(true);
  const folder = (await response.json() as Organization).folders.find((candidate) => candidate.name === name)!;
  expect(folder).toBeDefined();
  folderIds.push(folder.id);
  await expect(search).toHaveValue("");
  await expect(folderSection(page, folder.id)).toBeVisible();
  await classify(page, project, folder.id);
  expect((await organization(request)).projectFolders[project.id]).toBe(folder.id);

  await page.reload();
  await showSidebar(page);
  await expect(folderSection(page, folder.id).getByRole("button", { name: project.name, exact: true })).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`project=${project.id}`));
  const projects = (await (await request.get("/api/projects")).json()).projects as Project[];
  expect(projects.find((candidate) => candidate.id === project.id)?.directoryPath).toBe(project.directoryPath);
});

test("renaming and deleting a populated folder retains its projects and their content", async ({ page, request, folderIds }) => {
  const first = await createProject(request, "client-a");
  const second = await createProject(request, "client-b");
  const folder = await createFolder(request, `Archives-${randomUUID().slice(0, 8)}`, folderIds);
  await assign(request, first, folder);
  await assign(request, second, folder);
  const contentBefore = await (await request.get(`/api/agents/projects/${first.id}`)).json();
  await openProjects(page, [first, second]);
  const renamed = `Travail-${randomUUID().slice(0, 8)}`;
  await page.getByRole("button", { name: `Renommer le répertoire ${folder.name}`, exact: true }).click();
  await page.getByRole("textbox", { name: "Nom du répertoire", exact: true }).fill(renamed);
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.getByRole("button", { name: `Supprimer le répertoire ${renamed}`, exact: true })).toBeVisible();
  expect((await organization(request)).folders.find((candidate) => candidate.id === folder.id)?.name).toBe(renamed);

  await page.getByRole("button", { name: `Supprimer le répertoire ${renamed}`, exact: true }).click();
  await expect(folderSection(page, folder.id)).toHaveCount(0);
  for (const project of [first, second]) {
    await expect(page.locator(".project-sidebar").getByRole("button", { name: project.name, exact: true })).toBeVisible();
  }
  const state = await organization(request);
  expect(state.projectFolders[first.id]).toBeUndefined();
  expect(state.projectFolders[second.id]).toBeUndefined();
  await expect(page).toHaveURL(new RegExp(`project=${first.id}`));
  const contentAfter = await (await request.get(`/api/agents/projects/${first.id}`)).json();
  expect(contentAfter.instructions.content).toBe(contentBefore.instructions.content);
  expect(contentAfter.agents).toEqual(contentBefore.agents);
  await page.reload();
  await showSidebar(page);
  await expect(page.locator(".project-sidebar").getByRole("button", { name: second.name, exact: true })).toBeVisible();
});

test("dragging projects between folders and back to the root persists each move", async ({ page, request, folderIds }) => {
  const project = await createProject(request, "movable");
  const other = await createProject(request, "root-project");
  const first = await createFolder(request, `Premiers-${randomUUID().slice(0, 8)}`, folderIds);
  const second = await createFolder(request, `Seconds-${randomUUID().slice(0, 8)}`, folderIds);
  await openProjects(page, [project, other]);

  for (const folderId of [first.id, second.id, null]) {
    const source = projectRow(page, project);
    const destination = folderSection(page, folderId).locator(".project-folder__header");
    // Position the scrollable sidebar before mouse-down so the target does not
    // scroll the source away while Playwright is initiating the native drag.
    await destination.scrollIntoViewIfNeeded();
    await expect(source).toHaveAttribute("draggable", "true");
    await expect(source.getByRole("button", { name: project.name, exact: true })).toBeEnabled();
    await source.dragTo(destination);
    await expect.poll(async () => (await organization(request)).projectFolders[project.id] ?? null).toBe(folderId);
    await expect(folderSection(page, folderId).getByRole("button", { name: project.name, exact: true })).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`project=${project.id}`));
  }
  await expect(folderSection(page, null).getByRole("button", { name: other.name, exact: true })).toBeVisible();
});

test("folder creation and classification work with the keyboard and allow cancellation", async ({ page, request, folderIds }) => {
  const project = await createProject(request, "keyboard");
  await openProjects(page, [project]);
  const sidebar = page.locator(".project-sidebar");
  const create = sidebar.getByRole("button", { name: "Nouveau répertoire", exact: true });
  await create.focus();
  await create.press("Enter");
  const input = sidebar.getByRole("textbox", { name: "Nom du répertoire", exact: true });
  await expect(input).toBeFocused();
  await input.fill("   ");
  await expect(sidebar.getByRole("button", { name: "Créer", exact: true })).toBeDisabled();
  await sidebar.getByRole("button", { name: "Annuler", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(input).toHaveCount(0);

  await create.focus();
  await create.press("Enter");
  const name = `Clavier-${randomUUID().slice(0, 8)}`;
  await input.fill(name);
  const created = page.waitForResponse((response) => response.url().endsWith("/api/projects/folders") && response.request().method() === "POST");
  await input.press("Enter");
  const folder = (await (await created).json() as Organization).folders.find((candidate) => candidate.name === name)!;
  expect(folder).toBeDefined();
  folderIds.push(folder.id);

  for (const folderId of [folder.id, null]) {
    if (folderId === null) {
      const rootToggle = folderSection(page, null).getByRole("button", { name: /^Sans répertoire/ });
      await rootToggle.click();
      await expect(rootToggle).toHaveAttribute("aria-expanded", "false");
    }
    const arrange = page.getByRole("button", { name: `Ranger ${project.name}`, exact: true });
    await arrange.focus();
    await arrange.press("Enter");
    const select = page.getByRole("combobox", { name: `Répertoire de ${project.name}`, exact: true });
    await select.focus();
    await expect(select.getByRole("option", { name: "Sans répertoire", exact: true })).toHaveCount(1);
    await select.press(folderId ? "End" : "Home");
    await expect.poll(async () => (await organization(request)).projectFolders[project.id] ?? null).toBe(folderId);
    await expect(folderSection(page, folderId).getByRole("button", { name: project.name, exact: true })).toBeVisible();
  }
});

test("search finds a project inside a collapsed folder", async ({ page, request, folderIds }) => {
  const project = await createProject(request, "recherche");
  const unrelated = await createProject(request, "autre");
  const folder = await createFolder(request, `Documentation-${randomUUID().slice(0, 8)}`, folderIds);
  await assign(request, project, folder);
  await openProjects(page, [project, unrelated]);
  const section = folderSection(page, folder.id);
  const toggle = section.getByRole("button", { name: new RegExp(`^${folder.name}`) });
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(section.getByRole("button", { name: project.name, exact: true })).not.toBeVisible();
  await page.getByPlaceholder("Rechercher un projet", { exact: true }).fill(project.name);
  await expect(section.getByRole("button", { name: project.name, exact: true })).toBeVisible();
  await expect(page.locator(".project-sidebar").getByRole("button", { name: unrelated.name, exact: true })).toHaveCount(0);
  await page.getByPlaceholder("Rechercher un projet", { exact: true }).fill("aucun-projet-inexistant");
  await expect(page.getByText("Aucun projet ne correspond à cette recherche.", { exact: true })).toBeVisible();
});

test("keyboard reordering in one folder retains every project, classification and focus", async ({ page, request, folderIds }) => {
  const previous = (await (await request.get("/api/projects")).json()).projects as Project[];
  const first = await createProject(request, "premier");
  const separate = await createProject(request, "autre-repertoire");
  const second = await createProject(request, "deuxieme");
  const unfiled = await createProject(request, "sans-repertoire");
  const folder = await createFolder(request, `Ordre-${randomUUID().slice(0, 8)}`, folderIds);
  const otherFolder = await createFolder(request, `Autres-${randomUUID().slice(0, 8)}`, folderIds);
  await assign(request, first, folder);
  await assign(request, second, folder);
  await assign(request, separate, otherFolder);
  const previousIds = previous.map((project) => project.id);
  const originalOrder = [first.id, separate.id, second.id, unfiled.id, ...previousIds];
  expect((await request.put("/api/projects/order", { data: { projectIds: originalOrder } })).ok()).toBe(true);
  const classificationBefore = (await organization(request)).projectFolders;

  // The order endpoint requires every real project ID, so this scenario keeps
  // the complete fixture list and interleaves projects from different folders.
  await page.goto(`/?project=${first.id}`);
  await expect(page.getByRole("button", { name: "Modifier le projet", exact: true })).toBeVisible();
  await showSidebar(page);
  const section = folderSection(page, folder.id);
  const control = section.getByRole("button", { name: first.name, exact: true });
  await control.focus();
  const reordered = page.waitForResponse((response) => response.url().endsWith("/api/projects/order") && response.request().method() === "PUT");
  await control.press("Alt+ArrowDown");
  const response = await reordered;
  expect(response.ok()).toBe(true);
  const expectedOrder = [second.id, separate.id, first.id, unfiled.id, ...previousIds];
  expect(response.request().postDataJSON()).toEqual({ projectIds: expectedOrder });
  await expect(section.locator(".project-list__select-button")).toHaveText([second.name, first.name]);
  await expect(control).toBeFocused();
  expect((await organization(request)).projectFolders).toEqual(classificationBefore);
  await expect(folderSection(page, otherFolder.id).getByRole("button", { name: separate.name, exact: true })).toBeVisible();
  const persisted = (await (await request.get("/api/projects")).json()).projects as Project[];
  expect(persisted.map((project) => project.id)).toEqual(expectedOrder);
  await page.reload();
  await showSidebar(page);
  await expect(folderSection(page, folder.id).locator(".project-list__select-button")).toHaveText([second.name, first.name]);
});

test("failed folder loading can be retried and a failed move preserves the previous classification", async ({ page, request, folderIds }) => {
  const project = await createProject(request, "reprise");
  const folder = await createFolder(request, `Disponible-${randomUUID().slice(0, 8)}`, folderIds);
  await assign(request, project, folder);
  let failLoading = true;
  await page.route("**/api/projects/folders", async (route) => {
    if (failLoading && route.request().method() === "GET") {
      await route.fulfill({ status: 503, json: { error: "Service temporairement indisponible." } });
    } else {
      await route.continue();
    }
  });
  await openProjects(page, [project]);
  const sidebar = page.locator(".project-sidebar");
  await expect(sidebar.getByRole("alert")).toContainText("Impossible de charger les répertoires.");
  await expect(sidebar.getByRole("button", { name: "Nouveau répertoire", exact: true })).toBeDisabled();
  failLoading = false;
  await sidebar.getByRole("button", { name: "Réessayer", exact: true }).click();
  await expect(folderSection(page, folder.id).getByRole("button", { name: project.name, exact: true })).toBeVisible();
  await expect(sidebar.getByRole("alert")).toHaveCount(0);

  const moveEndpoint = `**/api/projects/${project.id}/folder`;
  await page.route(moveEndpoint, (route) => route.fulfill({ status: 503, json: { error: "Le classement est temporairement indisponible." } }));
  await sidebar.getByRole("button", { name: `Ranger ${project.name}`, exact: true }).click();
  const select = sidebar.getByRole("combobox", { name: `Répertoire de ${project.name}`, exact: true });
  await select.selectOption("");
  await expect(sidebar.getByRole("alert")).toContainText("Le classement est temporairement indisponible.");
  await expect(select).toHaveValue(folder.id);
  await expect(select).toBeFocused();
  await expect(folderSection(page, folder.id).getByRole("button", { name: project.name, exact: true })).toBeVisible();
  expect((await organization(request)).projectFolders[project.id]).toBe(folder.id);
  await page.unroute(moveEndpoint);
  await select.selectOption("");
  await expect(folderSection(page, null).getByRole("button", { name: project.name, exact: true })).toBeVisible();
  await expect(sidebar.getByRole("alert")).toHaveCount(0);
  expect((await organization(request)).projectFolders[project.id]).toBeUndefined();
});

test("folder controls fit the viewport and remain accessible with long names", async ({ page, request, folderIds }, testInfo) => {
  const project = await createProject(request, "Un-projet-avec-un-nom-particulierement-long");
  const other = await createProject(request, "Site-vitrine");
  const folder = await createFolder(request, `Un répertoire au nom particulièrement long pour les projets ${randomUUID().slice(0, 8)}`, folderIds);
  const otherFolder = await createFolder(request, `Clients-${randomUUID().slice(0, 8)}`, folderIds);
  await assign(request, project, folder);
  await assign(request, other, otherFolder);
  await openProjects(page, [project, other]);
  const sidebar = page.locator(".project-sidebar");
  if ([390, 1440].includes(page.viewportSize()!.width)) {
    const directory = path.resolve("artifacts", "project-folders");
    await mkdir(directory, { recursive: true });
    await page.screenshot({ path: path.join(directory, `${testInfo.project.name}.png`), fullPage: true });
  }
  for (const label of [`Renommer le répertoire ${folder.name}`, `Supprimer le répertoire ${folder.name}`, `Ranger ${project.name}`, "Nouveau répertoire"]) {
    const control = sidebar.getByRole("button", { name: label, exact: true });
    await control.scrollIntoViewIfNeeded();
    await expect(control).toBeInViewport();
    const bounds = (await control.boundingBox())!;
    expect(bounds.width).toBeGreaterThanOrEqual(24);
    expect(bounds.height).toBeGreaterThanOrEqual(24);
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  }
  await page.getByRole("button", { name: `Ranger ${project.name}`, exact: true }).click();
  await expect(page.getByRole("combobox", { name: `Répertoire de ${project.name}`, exact: true })).toBeVisible();
  await sidebar.getByRole("button", { name: "Nouveau répertoire", exact: true }).click();
  await expect(sidebar.getByRole("textbox", { name: "Nom du répertoire", exact: true })).toBeFocused();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect.poll(() => sidebar.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  const accessibility = await new AxeBuilder({ page }).include(".project-sidebar").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(accessibility.violations).toEqual([]);
  await testInfo.attach(`project-folders-${testInfo.project.name}`, { body: await page.screenshot({ fullPage: true }), contentType: "image/png" });
});
