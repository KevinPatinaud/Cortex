# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: workflow-dossiers.spec.ts >> hourly scans create only new dossiers and imported projects infer the same internal branch without an activation step
- Location: tests\e2e\workflow-dossiers.spec.ts:108:1

# Error details

```
Error: expect(received).toBe(expected) // Object.is equality

Expected: 3
Received: 2

Call Log:
- Timeout 5000ms exceeded while waiting on the predicate
```

# Test source

```ts
  17  |   return (await (await request.get(`/api/agents/projects/${project.id}`)).json());
  18  | }
  19  | type Job = { id: string; key: string; status: string };
  20  | const jobs = async (request: APIRequestContext, id: string): Promise<Job[]> => (await (await request.get(`/api/automations/${id}/jobs`)).json()).jobs;
  21  | 
  22  | test("loading identifies the internal branch and the graph tracks independent agreement and refusal without an automation tab", async ({ page, request }, testInfo) => {
  23  |   const project = await create(request);
  24  |   const base = `/api/automations/${project.projectId}`;
  25  |   expect(project.dispatchRules).toHaveLength(1);
  26  |   expect(project.dispatchRules[0]).toMatchObject({ sourceAgentId: project.agents[1].id, targetAgentId: project.agents[2].id, targetProjectId: project.projectId, enabled: true, definitionManaged: true });
  27  |   expect(await jobs(request, project.projectId)).toHaveLength(0);
  28  |   // Existing bookmarks land on the unified workflow.
  29  |   await page.goto(`/?project=${project.projectId}&view=automations`);
  30  |   await expect(page.getByRole("tab", { name: "Automatisations", exact: true })).toHaveCount(0);
  31  |   await expect(page.getByRole("tab", { name: "Workflow (4 agents)" })).toHaveAttribute("aria-selected", "true");
  32  |   await expect(page.getByText("Workflow cible", { exact: true })).toHaveCount(0);
  33  |   await expect(page.getByText("Activer la règle", { exact: true })).toHaveCount(0);
  34  |   await expect(page.locator('[data-workflow-asynchronous="true"]')).toHaveCount(1);
  35  |   await expect(page.locator(".agent-card__async-badge")).toHaveCount(2);
  36  |   const dossiers = page.locator(".workflow-dossiers");
  37  |   await expect(dossiers).toContainText("Aucun dossier");
  38  |   await page.getByRole("tab", { name: "Workflow (4 agents)" }).focus();
  39  |   await page.keyboard.press("End");
  40  |   await expect(page.getByRole("tab", { name: "Historique", exact: true })).toBeFocused();
  41  |   await page.getByRole("tab", { name: "Workflow (4 agents)" }).click();
  42  |   const run = await request.post(`/api/agents/projects/${project.projectId}/workflow/run`, { data: {} });
  43  |   expect(run.ok()).toBe(true);
  44  |   expect((await run.json()).executedAgentIds).toEqual(project.agents.slice(0, 2).map((agent: { id: string }) => agent.id));
  45  |   await expect.poll(async () => (await jobs(request, project.projectId)).filter(job => job.status === "waiting").length).toBe(2);
  46  |   await expect(dossiers.getByRole("button", { name: /Bien A/ })).toBeVisible();
  47  |   await expect(dossiers).toContainText("Réponse de l’agence immobilière");
  48  |   await expect(dossiers.getByRole("button", { name: "2 En attente", exact: true })).toBeVisible();
  49  |   await expect(dossiers.getByRole("button", { name: /Bien A/ })).toContainText("Échéance");
  50  |   await expect(dossiers.getByRole("button", { name: "Continuer avec les résultats disponibles", exact: true })).toHaveCount(0);
  51  |   await dossiers.getByRole("button", { name: /Bien A/ }).click();
  52  |   const detail = dossiers.getByRole("region", { name: "Détail du dossier" });
  53  |   await expect(page.getByRole("dialog")).toBeVisible();
  54  |   await expect(detail.getByRole("button", { name: "Fermer le dossier" })).toBeFocused();
  55  |   await page.keyboard.press("Escape");
  56  |   await expect(page.getByRole("dialog")).toHaveCount(0);
  57  |   await expect(dossiers.getByRole("button", { name: /Bien A/ })).toBeFocused();
  58  |   await dossiers.getByRole("button", { name: /Bien A/ }).click();
  59  |   await expect(detail.getByText("Premier mail envoyé. Attente de la réponse.", { exact: true })).toBeVisible();
  60  |   await detail.getByRole("textbox", { name: "Réponse reçue pour ce dossier" }).fill("CONFIRMED : accord écrit.");
  61  |   await detail.getByRole("button", { name: "Transmettre la réponse" }).click();
  62  |   await expect.poll(async () => (await jobs(request, project.projectId)).find(job => job.key === "PROPERTY_A")?.status).toBe("completed");
  63  |   const all = await jobs(request, project.projectId);
  64  |   const a = all.find(job => job.key === "PROPERTY_A")!;
  65  |   const b = all.find(job => job.key === "PROPERTY_B")!;
  66  |   expect((await (await request.get(`${base}/jobs/${a.id}`)).json()).project.agents[1].hasSession).toBe(true);
  67  |   expect(b.status).toBe("waiting");
  68  |   await request.post(`${base}/jobs/${b.id}/events`, { data: { id: "refusal", key: "agency-reply", payload: "Refus de négocier." } });
  69  |   await expect.poll(async () => (await jobs(request, project.projectId)).find(job => job.id === b.id)?.status).toBe("completed");
  70  |   expect((await (await request.get(`${base}/jobs/${b.id}`)).json()).project.agents[1].hasSession).toBe(false);
  71  |   await page.reload();
  72  |   await expect(dossiers.getByRole("button", { name: /Bien A/ })).toContainText("Terminé");
  73  |   const main = await (await request.get(`/api/agents/projects/${project.projectId}`)).json();
  74  |   expect(main.agents.slice(2).every((agent: {hasSession: boolean}) => !agent.hasSession)).toBe(true);
  75  |   await page.screenshot({ path: testInfo.outputPath("unified-dossiers.png"), fullPage: true });
  76  |   expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  77  |   expect((await new AxeBuilder({ page }).include(".workflow-dossiers").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
  78  | });
  79  | 
  80  | test("filters span the complete dossier set and failed dossiers expose a readable diagnostic in the drawer", async ({ page, request }, testInfo) => {
  81  |   const project = await create(request, "E2E_FAIL");
  82  |   const base = `/api/automations/${project.projectId}/jobs`;
  83  |   await request.post(`/api/agents/projects/${project.projectId}/workflow/run`, { data: {} });
  84  |   await expect.poll(async () => (await jobs(request, project.projectId)).filter(job => job.status === "failed").length).toBe(2);
  85  |   const [first] = await jobs(request, project.projectId);
  86  |   await request.post(`${base}/${first.id}/cancel`);
  87  |   expect((await request.get(`${base}?filter=invalid`)).status()).toBe(400);
  88  |   await page.goto(`/?project=${project.projectId}&view=workflow`);
  89  |   const dossiers = page.locator(".workflow-dossiers");
  90  |   await dossiers.getByRole("button", { name: "1 À traiter", exact: true }).click();
  91  |   await expect(dossiers.locator(".automation-panel__jobs > li")).toHaveCount(1);
  92  |   await expect(dossiers.locator(".automation-panel__jobs")).toContainText("L’exécution a échoué. Consultez le diagnostic.");
  93  |   await expect(dossiers.getByRole("button", { name: "Continuer avec les résultats disponibles", exact: true })).toHaveCount(0);
  94  |   await dossiers.locator(".automation-panel__jobs button").click();
  95  |   const detail = page.getByRole("region", { name: "Détail du dossier" });
  96  |   await detail.getByText("Diagnostic technique", { exact: true }).click();
  97  |   await expect(detail).toContainText("Échec simulé du moteur.");
  98  |   await expect(detail.getByRole("button", { name: "Reprendre après vérification" })).toBeVisible();
  99  |   await page.screenshot({ path: testInfo.outputPath("failed-dossier-drawer.png"), fullPage: true });
  100 |   expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  101 |   expect((await new AxeBuilder({ page }).include(".workflow-dossiers").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
  102 |   await page.keyboard.press("Escape");
  103 |   await dossiers.getByRole("button", { name: "1 Arrêtés", exact: true }).click();
  104 |   await expect(dossiers.locator(".automation-panel__jobs > li")).toHaveCount(1);
  105 |   await expect(dossiers.locator(".automation-panel__jobs")).toContainText("Arrêté");
  106 | });
  107 | 
  108 | test("hourly scans create only new dossiers and imported projects infer the same internal branch without an activation step", async ({ request }) => {
  109 |   const project = await create(request);
  110 |   const id = project.projectId;
  111 |   await request.put(`/api/agents/projects/${id}/workflow/schedule`, { data: { cron: "0 * * * *", enabled: true, parameterValues: {} } });
  112 |   const at = new Date(); at.setMinutes(0, 0, 0); at.setHours(at.getHours() + 1);
  113 |   await request.post("/__test/scheduled-scan", { data: { at: at.toISOString() } });
  114 |   await expect.poll(async () => (await jobs(request, id)).filter(job => job.status === "waiting").length).toBe(2);
  115 |   at.setHours(at.getHours() + 1);
  116 |   await request.post("/__test/scheduled-scan", { data: { at: at.toISOString() } });
> 117 |   await expect.poll(async () => (await jobs(request, id)).filter(job => job.status === "waiting").length).toBe(3);
      |                                                                                                           ^ Error: expect(received).toBe(expected) // Object.is equality
  118 |   const archive = await request.get(`/api/projects/${id}/export`);
  119 |   expect(archive.ok()).toBe(true);
  120 |   const imported = await request.post("/api/projects/import-archive", { multipart: { archive: {
  121 |     name: `Imported-${randomUUID().slice(0, 6)}.ctx`, mimeType: "application/vnd.cortex.project+zip", buffer: await archive.body()
  122 |   } } });
  123 |   expect(imported.status()).toBe(201);
  124 |   const copyId = (await imported.json()).project.id;
  125 |   const copy = await (await request.get(`/api/agents/projects/${copyId}`)).json();
  126 |   expect(copy.dispatchRules).toHaveLength(1);
  127 |   expect(copy.dispatchRules[0]).toMatchObject({ targetProjectId: copyId, enabled: true, definitionManaged: true });
  128 |   expect(await jobs(request, copyId)).toHaveLength(0);
  129 |   expect(copy.agents.every((agent: {hasSession: boolean}) => !agent.hasSession)).toBe(true);
  130 |   expect((await request.post(`/api/agents/projects/${copyId}/workflow/run`, { data: {} })).ok()).toBe(true);
  131 |   await expect.poll(async () => (await jobs(request, copyId)).length).toBe(3);
  132 |   for (const projectId of [id, copyId]) for (const job of await jobs(request, projectId)) await request.post(`/api/automations/${projectId}/jobs/${job.id}/cancel`);
  133 | });
  134 | 
  135 | test("saved results can be continued directly in the graph without repeating the search", async ({ page, request }) => {
  136 |   const project = await create(request);
  137 |   await request.post("/__test/fail-next-dispatch");
  138 |   expect((await request.post(`/api/agents/projects/${project.projectId}/workflow/run`, { data: {} })).ok()).toBe(false);
  139 |   expect(await jobs(request, project.projectId)).toHaveLength(0);
  140 |   await page.goto(`/?project=${project.projectId}&view=workflow`);
  141 |   const selection = page.locator(".agent-card").filter({ has: page.getByRole("heading", { name: "2 Sélection", exact: true }) });
  142 |   await expect(selection.getByRole("heading", { name: "Bien A", exact: true })).toBeVisible();
  143 |   await expect(selection).not.toContainText('"payload"');
  144 |   await expect(selection).not.toContainText("Fin du workflow");
  145 |   await expect(selection.locator(".agent-card__conversation-response-choice")).toHaveCount(0);
  146 |   await page.getByRole("button", { name: "Continuer avec les résultats disponibles", exact: true }).click();
  147 |   await expect.poll(async () => (await jobs(request, project.projectId)).length).toBe(2);
  148 |   await expect(page.getByRole("button", { name: "Continuer avec les résultats disponibles", exact: true })).toHaveCount(0);
  149 |   const result = await (await request.get(`/api/agents/projects/${project.projectId}`)).json();
  150 |   expect(result.agents[0].conversation.filter((message: {role: string}) => message.role === "agent")).toHaveLength(1);
  151 |   for (const job of await jobs(request, project.projectId)) await request.post(`/api/automations/${project.projectId}/jobs/${job.id}/cancel`);
  152 | });
  153 | 
  154 | test("blocked negotiation requests clarification, resumes the same dossier and waits before the agreement agent", async ({ page, request }, testInfo) => {
  155 |   const project = await create(request, "E2E_BLOCKED");
  156 |   await request.post(`/api/agents/projects/${project.projectId}/workflow/run`, { data: {} });
  157 |   await expect.poll(async () => (await jobs(request, project.projectId)).filter(job => job.status === "blocked").length).toBe(2);
  158 |   await page.goto(`/?project=${project.projectId}&view=workflow`);
  159 |   await expect(page.locator(".workflow-dossiers").getByRole("button", { name: /Bien A/ })).toContainText("À préciser");
  160 |   await expect(page.locator(".workflow-dossiers").getByRole("button", { name: /Bien A/ })).toContainText("Le mandat doit être précisé.");
  161 |   await page.locator(".workflow-dossiers").getByRole("button", { name: /Bien A/ }).click();
  162 |   const detail = page.getByRole("region", { name: "Détail du dossier" });
  163 |   await expect(detail).toContainText("Le mandat doit être précisé.");
  164 |   await expect(detail.getByRole("button", { name: "Transmettre et reprendre" })).toBeDisabled();
  165 |   const first = (await jobs(request, project.projectId)).find(job => job.key === "PROPERTY_A")!;
  166 |   expect((await (await request.get(`/api/automations/${project.projectId}/jobs/${first.id}`)).json()).project.agents[1].hasSession).toBe(false);
  167 |   await detail.getByRole("textbox", { name: "Précisions pour reprendre ce dossier" }).fill("Demander les informations sans offre ni engagement.");
  168 |   await page.screenshot({ path: testInfo.outputPath("blocked-dossier-clarification.png"), fullPage: true });
  169 |   expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  170 |   expect((await new AxeBuilder({ page }).include(".workflow-dossiers").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
  171 |   await detail.getByRole("button", { name: "Transmettre et reprendre" }).click();
  172 |   await expect.poll(async () => (await jobs(request, project.projectId)).find(job => job.id === first.id)?.status).toBe("waiting");
  173 |   await expect(detail.getByRole("textbox", { name: "Réponse reçue pour ce dossier" })).toBeVisible();
  174 |   expect((await jobs(request, project.projectId)).find(job => job.key === "PROPERTY_B")?.status).toBe("blocked");
  175 |   const resumed = await (await request.get(`/api/automations/${project.projectId}/jobs/${first.id}`)).json();
  176 |   expect(resumed.project.agents[0].conversation.filter((message: {role: string}) => message.role === "agent")).toHaveLength(2);
  177 |   expect(resumed.project.agents[1].hasSession).toBe(false);
  178 |   expect(resumed.job.clarifications[0].content).toBe("Demander les informations sans offre ni engagement.");
  179 |   for (const job of await jobs(request, project.projectId)) await request.post(`/api/automations/${project.projectId}/jobs/${job.id}/cancel`);
  180 | });
  181 | 
  182 | test("a Gmail response wakes only the linked dossier in the unified project", async ({ request }) => {
  183 |   const project = await create(request);
  184 |   const id = project.projectId;
  185 |   await request.post(`/api/agents/projects/${id}/workflow/run`, { data: {} });
  186 |   await expect.poll(async () => (await jobs(request, id)).filter(job => job.status === "waiting").length).toBe(2);
  187 |   const [linked, other] = await jobs(request, id);
  188 |   const headers = { Origin: "http://127.0.0.1:4317" };
  189 |   await request.post("/api/gmail/configure", { headers, data: { installed: { client_id: "test.apps.googleusercontent.com", client_secret: "test" } } });
  190 |   const connection = await (await request.post("/api/gmail/connect", { headers, data: { projectId: id } })).json();
  191 |   const state = new URL(connection.url).searchParams.get("state")!;
  192 |   await request.get(`/api/gmail/callback?${new URLSearchParams({ code: "fake", state })}`);
  193 |   expect((await request.post("/api/gmail/watches", { headers, data: { projectId: id, instanceId: linked.id, eventKey: "agency-reply", threadId: "thread123" } })).status()).toBe(201);
  194 |   await request.post("/__test/gmail-reply");
  195 |   await expect.poll(async () => (await jobs(request, id)).find(job => job.id === linked.id)?.status).toBe("completed");
  196 |   expect((await jobs(request, id)).find(job => job.id === other.id)?.status).toBe("waiting");
  197 |   await request.post("/api/gmail/disconnect", { headers });
  198 |   await request.post(`/api/automations/${id}/jobs/${other.id}/cancel`);
  199 | });
  200 | 
  201 | test("editing the project updates inferred branches while old dossiers remain available in history", async ({ page, request }) => {
  202 |   const project = await create(request);
  203 |   const id = project.projectId;
  204 |   await request.post(`/api/agents/projects/${id}/workflow/run`, { data: {} });
  205 |   await expect.poll(async () => (await jobs(request, id)).filter(job => job.status === "waiting").length).toBe(2);
  206 |   const ruleId = project.dispatchRules[0].id;
  207 |   const draft = { name: project.directoryPath.split(/[\\/]/).at(-1), engine: project.engine, instructions: project.instructions.content,
  208 |     agents: project.agents.map((agent: { id: string; name: string; description: string; prompt: string }) => ({ id: agent.id, name: agent.name, description: agent.description, prompt: `${agent.prompt}\nInstructions révisées.` })) };
  209 |   expect((await request.put(`/api/agents/projects/${id}`, { data: draft })).ok()).toBe(true);
  210 |   expect((await (await request.get(`/api/agents/projects/${id}`)).json()).dispatchRules[0].id).toBe(ruleId);
  211 |   draft.agents[1].prompt = "Sélection simple sans suivi indépendant.";
  212 |   expect((await request.put(`/api/agents/projects/${id}`, { data: draft })).ok()).toBe(true);
  213 |   expect((await (await request.get(`/api/agents/projects/${id}`)).json()).dispatchRules).toHaveLength(0);
  214 |   await page.goto(`/?project=${id}&view=audit`);
  215 |   await expect(page.getByRole("heading", { name: "Historique des dossiers (2)" })).toBeVisible();
  216 |   await page.locator(".workflow-dossiers").getByRole("button", { name: /Bien A/ }).click();
  217 |   const detail = page.getByRole("region", { name: "Détail du dossier" });
```