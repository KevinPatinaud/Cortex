import { expect, test, type APIRequestContext } from "@playwright/test";
import { randomUUID } from "node:crypto";
import AxeBuilder from "@axe-core/playwright";

async function create(request: APIRequestContext, negotiation = "E2E_AUTOMATION_NEGOTIATE") {
  await request.post("/__test/automation-reset-scan");
  const name = `Immobilier-${randomUUID().slice(0, 6)}`;
  const created = await request.post("/api/projects/create", { data: { name, engine: "codex", generationMode: "empty", instructions: "Workflow de test." } });
  expect(created.status()).toBe(201);
  const { project } = await created.json();
  const saved = await request.put(`/api/agents/projects/${project.id}`, { data: { name, engine: "codex",
    instructions: "Rechercher les annonces, sélectionner les meilleures et ouvrir un dossier indépendant par bien pour négocier par mail. Un accord déclenche le bilan.",
    agents: [{ name: "1 Recherche", prompt: "Rechercher les annonces." }, { name: "2 Sélection", prompt: "E2E_AUTOMATION_SCAN E2E_SCAN_SLOW" },
      { name: "3 Négociation", prompt: negotiation }, { name: "4 Bilan", prompt: "Bilan après accord confirmé uniquement." }].map(agent => ({ ...agent, description: agent.name }))
  } });
  expect(saved.ok()).toBe(true);
  return (await (await request.get(`/api/agents/projects/${project.id}`)).json());
}
type Job = { id: string; key: string; status: string };
const jobs = async (request: APIRequestContext, id: string): Promise<Job[]> => (await (await request.get(`/api/automations/${id}/jobs`)).json()).jobs;

test("loading identifies the internal branch and the graph tracks independent agreement and refusal without an automation tab", async ({ page, request }, testInfo) => {
  const project = await create(request);
  const base = `/api/automations/${project.projectId}`;
  expect(project.dispatchRules).toHaveLength(1);
  expect(project.dispatchRules[0]).toMatchObject({ sourceAgentId: project.agents[1].id, targetAgentId: project.agents[2].id, targetProjectId: project.projectId, enabled: true, definitionManaged: true });
  expect(await jobs(request, project.projectId)).toHaveLength(0);
  // Existing bookmarks land on the unified workflow.
  await page.goto(`/?project=${project.projectId}&view=automations`);
  await expect(page.getByRole("tab", { name: "Automatisations", exact: true })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Workflow (4 agents)" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByText("Workflow cible", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Activer la règle", { exact: true })).toHaveCount(0);
  await expect(page.locator('[data-workflow-asynchronous="true"]')).toHaveCount(1);
  await expect(page.locator(".agent-card__async-badge")).toHaveCount(2);
  const dossiers = page.locator(".workflow-dossiers");
  await expect(dossiers).toContainText("Aucun dossier");
  await page.getByRole("tab", { name: "Workflow (4 agents)" }).focus();
  await page.keyboard.press("End");
  await expect(page.getByRole("tab", { name: "Historique", exact: true })).toBeFocused();
  await page.getByRole("tab", { name: "Workflow (4 agents)" }).click();
  const run = await request.post(`/api/agents/projects/${project.projectId}/workflow/run`, { data: {} });
  expect(run.ok()).toBe(true);
  expect((await run.json()).executedAgentIds).toEqual(project.agents.slice(0, 2).map((agent: { id: string }) => agent.id));
  await expect.poll(async () => (await jobs(request, project.projectId)).filter(job => job.status === "waiting").length).toBe(2);
  await expect(dossiers.getByRole("button", { name: /Bien A/ })).toBeVisible();
  await dossiers.getByRole("button", { name: /Bien A/ }).click();
  const detail = dossiers.getByRole("region", { name: "Détail du dossier" });
  await expect(detail.getByText("Premier mail envoyé. Attente de la réponse.", { exact: true })).toBeVisible();
  await detail.getByRole("textbox", { name: "Réponse reçue pour ce dossier" }).fill("CONFIRMED : accord écrit.");
  await detail.getByRole("button", { name: "Transmettre la réponse" }).click();
  await expect.poll(async () => (await jobs(request, project.projectId)).find(job => job.key === "PROPERTY_A")?.status).toBe("completed");
  const all = await jobs(request, project.projectId);
  const a = all.find(job => job.key === "PROPERTY_A")!;
  const b = all.find(job => job.key === "PROPERTY_B")!;
  expect((await (await request.get(`${base}/jobs/${a.id}`)).json()).project.agents[1].hasSession).toBe(true);
  expect(b.status).toBe("waiting");
  await request.post(`${base}/jobs/${b.id}/events`, { data: { id: "refusal", key: "agency-reply", payload: "Refus de négocier." } });
  await expect.poll(async () => (await jobs(request, project.projectId)).find(job => job.id === b.id)?.status).toBe("completed");
  expect((await (await request.get(`${base}/jobs/${b.id}`)).json()).project.agents[1].hasSession).toBe(false);
  await page.reload();
  await expect(dossiers.getByRole("button", { name: /Bien A/ })).toContainText("Terminé");
  const main = await (await request.get(`/api/agents/projects/${project.projectId}`)).json();
  expect(main.agents.slice(2).every((agent: {hasSession: boolean}) => !agent.hasSession)).toBe(true);
  await page.screenshot({ path: testInfo.outputPath("unified-dossiers.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).include(".workflow-dossiers").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
});

test("hourly scans create only new dossiers and imported projects infer the same internal branch without an activation step", async ({ request }) => {
  const project = await create(request);
  const id = project.projectId;
  await request.put(`/api/agents/projects/${id}/workflow/schedule`, { data: { cron: "0 * * * *", enabled: true, parameterValues: {} } });
  const at = new Date(); at.setMinutes(0, 0, 0); at.setHours(at.getHours() + 1);
  await request.post("/__test/scheduled-scan", { data: { at: at.toISOString() } });
  await expect.poll(async () => (await jobs(request, id)).filter(job => job.status === "waiting").length).toBe(2);
  at.setHours(at.getHours() + 1);
  await request.post("/__test/scheduled-scan", { data: { at: at.toISOString() } });
  await expect.poll(async () => (await jobs(request, id)).filter(job => job.status === "waiting").length).toBe(3);
  const archive = await request.get(`/api/projects/${id}/export`);
  expect(archive.ok()).toBe(true);
  const imported = await request.post("/api/projects/import-archive", { multipart: { archive: {
    name: `Imported-${randomUUID().slice(0, 6)}.ctx`, mimeType: "application/vnd.cortex.project+zip", buffer: await archive.body()
  } } });
  expect(imported.status()).toBe(201);
  const copyId = (await imported.json()).project.id;
  const copy = await (await request.get(`/api/agents/projects/${copyId}`)).json();
  expect(copy.dispatchRules).toHaveLength(1);
  expect(copy.dispatchRules[0]).toMatchObject({ targetProjectId: copyId, enabled: true, definitionManaged: true });
  expect(await jobs(request, copyId)).toHaveLength(0);
  expect(copy.agents.every((agent: {hasSession: boolean}) => !agent.hasSession)).toBe(true);
  expect((await request.post(`/api/agents/projects/${copyId}/workflow/run`, { data: {} })).ok()).toBe(true);
  await expect.poll(async () => (await jobs(request, copyId)).length).toBe(3);
  for (const projectId of [id, copyId]) for (const job of await jobs(request, projectId)) await request.post(`/api/automations/${projectId}/jobs/${job.id}/cancel`);
});

test("saved results can be continued directly in the graph without repeating the search", async ({ page, request }) => {
  const project = await create(request);
  await request.post("/__test/fail-next-dispatch");
  expect((await request.post(`/api/agents/projects/${project.projectId}/workflow/run`, { data: {} })).ok()).toBe(false);
  expect(await jobs(request, project.projectId)).toHaveLength(0);
  await page.goto(`/?project=${project.projectId}&view=workflow`);
  const selection = page.locator(".agent-card").filter({ has: page.getByRole("heading", { name: "2 Sélection", exact: true }) });
  await expect(selection.getByRole("heading", { name: "Bien A", exact: true })).toBeVisible();
  await expect(selection).not.toContainText('"payload"');
  await expect(selection).not.toContainText("Fin du workflow");
  await expect(selection.locator(".agent-card__conversation-response-choice")).toHaveCount(0);
  await page.getByRole("button", { name: "Continuer avec les résultats disponibles", exact: true }).click();
  await expect.poll(async () => (await jobs(request, project.projectId)).length).toBe(2);
  await expect(page.getByRole("button", { name: "Continuer avec les résultats disponibles", exact: true })).toHaveCount(0);
  const result = await (await request.get(`/api/agents/projects/${project.projectId}`)).json();
  expect(result.agents[0].conversation.filter((message: {role: string}) => message.role === "agent")).toHaveLength(1);
  for (const job of await jobs(request, project.projectId)) await request.post(`/api/automations/${project.projectId}/jobs/${job.id}/cancel`);
});

test("blocked negotiation requests clarification, resumes the same dossier and waits before the agreement agent", async ({ page, request }, testInfo) => {
  const project = await create(request, "E2E_BLOCKED");
  await request.post(`/api/agents/projects/${project.projectId}/workflow/run`, { data: {} });
  await expect.poll(async () => (await jobs(request, project.projectId)).filter(job => job.status === "blocked").length).toBe(2);
  await page.goto(`/?project=${project.projectId}&view=workflow`);
  await expect(page.locator(".workflow-dossiers").getByRole("button", { name: /Bien A/ })).toContainText("À préciser");
  await expect(page.locator(".workflow-dossiers").getByRole("button", { name: /Bien A/ })).toContainText("Le mandat doit être précisé.");
  await page.locator(".workflow-dossiers").getByRole("button", { name: /Bien A/ }).click();
  const detail = page.getByRole("region", { name: "Détail du dossier" });
  await expect(detail).toContainText("Le mandat doit être précisé.");
  await expect(detail.getByRole("button", { name: "Transmettre et reprendre" })).toBeDisabled();
  const first = (await jobs(request, project.projectId)).find(job => job.key === "PROPERTY_A")!;
  expect((await (await request.get(`/api/automations/${project.projectId}/jobs/${first.id}`)).json()).project.agents[1].hasSession).toBe(false);
  await detail.getByRole("textbox", { name: "Précisions pour reprendre ce dossier" }).fill("Demander les informations sans offre ni engagement.");
  await page.screenshot({ path: testInfo.outputPath("blocked-dossier-clarification.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).include(".workflow-dossiers").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
  await detail.getByRole("button", { name: "Transmettre et reprendre" }).click();
  await expect.poll(async () => (await jobs(request, project.projectId)).find(job => job.id === first.id)?.status).toBe("waiting");
  await expect(detail.getByRole("textbox", { name: "Réponse reçue pour ce dossier" })).toBeVisible();
  expect((await jobs(request, project.projectId)).find(job => job.key === "PROPERTY_B")?.status).toBe("blocked");
  const resumed = await (await request.get(`/api/automations/${project.projectId}/jobs/${first.id}`)).json();
  expect(resumed.project.agents[0].conversation.filter((message: {role: string}) => message.role === "agent")).toHaveLength(2);
  expect(resumed.project.agents[1].hasSession).toBe(false);
  expect(resumed.job.clarifications[0].content).toBe("Demander les informations sans offre ni engagement.");
  for (const job of await jobs(request, project.projectId)) await request.post(`/api/automations/${project.projectId}/jobs/${job.id}/cancel`);
});

test("a Gmail response wakes only the linked dossier in the unified project", async ({ request }) => {
  const project = await create(request);
  const id = project.projectId;
  await request.post(`/api/agents/projects/${id}/workflow/run`, { data: {} });
  await expect.poll(async () => (await jobs(request, id)).filter(job => job.status === "waiting").length).toBe(2);
  const [linked, other] = await jobs(request, id);
  const headers = { Origin: "http://127.0.0.1:4317" };
  await request.post("/api/gmail/configure", { headers, data: { installed: { client_id: "test.apps.googleusercontent.com", client_secret: "test" } } });
  const connection = await (await request.post("/api/gmail/connect", { headers, data: { projectId: id } })).json();
  const state = new URL(connection.url).searchParams.get("state")!;
  await request.get(`/api/gmail/callback?${new URLSearchParams({ code: "fake", state })}`);
  expect((await request.post("/api/gmail/watches", { headers, data: { projectId: id, instanceId: linked.id, eventKey: "agency-reply", threadId: "thread123" } })).status()).toBe(201);
  await request.post("/__test/gmail-reply");
  await expect.poll(async () => (await jobs(request, id)).find(job => job.id === linked.id)?.status).toBe("completed");
  expect((await jobs(request, id)).find(job => job.id === other.id)?.status).toBe("waiting");
  await request.post("/api/gmail/disconnect", { headers });
  await request.post(`/api/automations/${id}/jobs/${other.id}/cancel`);
});

test("editing the project updates inferred branches while old dossiers remain available in history", async ({ page, request }) => {
  const project = await create(request);
  const id = project.projectId;
  await request.post(`/api/agents/projects/${id}/workflow/run`, { data: {} });
  await expect.poll(async () => (await jobs(request, id)).filter(job => job.status === "waiting").length).toBe(2);
  const ruleId = project.dispatchRules[0].id;
  const draft = { name: project.directoryPath.split(/[\\/]/).at(-1), engine: project.engine, instructions: project.instructions.content,
    agents: project.agents.map((agent: { id: string; name: string; description: string; prompt: string }) => ({ id: agent.id, name: agent.name, description: agent.description, prompt: `${agent.prompt}\nInstructions révisées.` })) };
  expect((await request.put(`/api/agents/projects/${id}`, { data: draft })).ok()).toBe(true);
  expect((await (await request.get(`/api/agents/projects/${id}`)).json()).dispatchRules[0].id).toBe(ruleId);
  draft.agents[1].prompt = "Sélection simple sans suivi indépendant.";
  expect((await request.put(`/api/agents/projects/${id}`, { data: draft })).ok()).toBe(true);
  expect((await (await request.get(`/api/agents/projects/${id}`)).json()).dispatchRules).toHaveLength(0);
  await page.goto(`/?project=${id}&view=audit`);
  await expect(page.getByRole("heading", { name: "Historique des dossiers (2)" })).toBeVisible();
  await page.locator(".workflow-dossiers").getByRole("button", { name: /Bien A/ }).click();
  const detail = page.getByRole("region", { name: "Détail du dossier" });
  await expect(detail.getByRole("textbox", { name: "Réponse reçue pour ce dossier" })).toBeVisible();
  const [first, second] = await jobs(request, id);
  expect((await (await request.get(`/api/automations/${id}/jobs/${first.id}`)).json()).project.agents[0].prompt).not.toContain("Instructions révisées");
  for (const job of [first, second]) await request.post(`/api/automations/${id}/jobs/${job.id}/cancel`);
});
