# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: workflow-dossiers.spec.ts >> filters span the complete dossier set and failed dossiers expose a readable diagnostic in the drawer
- Location: tests\e2e\workflow-dossiers.spec.ts:80:1

# Error details

```
Error: expect(received).toEqual(expected) // deep equality

- Expected  -  1
+ Received  + 58

- Array []
+ Array [
+   Object {
+     "description": "Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds",
+     "help": "Elements must meet minimum color contrast ratio thresholds",
+     "helpUrl": "https://dequeuniversity.com/rules/axe/4.13/color-contrast?application=playwright",
+     "id": "color-contrast",
+     "impact": "serious",
+     "nodes": Array [
+       Object {
+         "all": Array [],
+         "any": Array [
+           Object {
+             "data": Object {
+               "bgColor": "#fff0f2",
+               "contrastRatio": 4.47,
+               "expectedContrastRatio": "4.5:1",
+               "fgColor": "#60718e",
+               "fontSize": "10.3pt (13.76px)",
+               "fontWeight": "normal",
+               "messageKey": null,
+             },
+             "id": "color-contrast",
+             "impact": "serious",
+             "message": "Element has insufficient color contrast of 4.47 (foreground color: #60718e, background color: #fff0f2, font size: 10.3pt (13.76px), font weight: normal). Expected contrast ratio of 4.5:1",
+             "relatedNodes": Array [
+               Object {
+                 "html": "<div class=\"automation-panel__error\"><p>L’exécution a échoué. Consultez le diagnostic.</p><details open=\"\"><summary>Diagnostic technique</summary><pre>Échec simulé du moteur.</pre></details></div>",
+                 "target": Array [
+                   ".automation-panel__error",
+                 ],
+               },
+             ],
+           },
+         ],
+         "failureSummary": "Fix any of the following:
+   Element has insufficient color contrast of 4.47 (foreground color: #60718e, background color: #fff0f2, font size: 10.3pt (13.76px), font weight: normal). Expected contrast ratio of 4.5:1",
+         "html": "<p>L’exécution a échoué. Consultez le diagnostic.</p>",
+         "impact": "serious",
+         "none": Array [],
+         "target": Array [
+           ".automation-panel__error > p",
+         ],
+       },
+     ],
+     "tags": Array [
+       "cat.color",
+       "wcag2aa",
+       "wcag143",
+       "TTv5",
+       "TT13.c",
+       "EN-301-549",
+       "EN-9.1.4.3",
+       "ACT",
+       "RGAAv4",
+       "RGAA-3.2.1",
+     ],
+   },
+ ]
```

# Page snapshot

```yaml
- generic [ref=e3]:
  - link "Aller au contenu principal" [ref=e4] [cursor=pointer]:
    - /url: "#main-content"
  - complementary "Gestion des projets" [ref=e5]:
    - generic [ref=e6]:
      - paragraph [ref=e7]: Espace de travail
      - generic [ref=e8]:
        - heading "Projets" [level=2] [ref=e9]
        - generic [ref=e10]:
          - generic "2 projets" [ref=e11]: "2"
          - button "Afficher la liste des projets" [ref=e12] [cursor=pointer]:
            - generic [ref=e13]: Changer
      - paragraph [ref=e16]:
        - text: Projet actif
        - strong [ref=e17]: Immobilier-cd57a6
  - main [ref=e18]:
    - generic [ref=e19]:
      - generic [ref=e20]:
        - generic [ref=e21]:
          - paragraph [ref=e22]: Projet codex
          - heading "Immobilier-cd57a6" [level=1] [ref=e23]
        - button "Exporter" [ref=e24] [cursor=pointer]
      - generic [ref=e28]:
        - tablist "Contenu du projet" [ref=e29]:
          - tab "Instructions projet" [ref=e30] [cursor=pointer]
          - tab "Workflow (4 agents)" [selected] [ref=e31] [cursor=pointer]
          - tab "Historique" [ref=e32] [cursor=pointer]
        - generic [ref=e33]:
          - checkbox "Manuel. Exécution automatique de tous les agents" [ref=e34] [cursor=pointer]:
            - generic [ref=e35]: Manuel
          - button "Planifier" [ref=e39] [cursor=pointer]
          - button "Réinitialiser" [ref=e44] [cursor=pointer]
          - button "Modifier le projet" [ref=e48] [cursor=pointer]
    - tabpanel "Workflow (4 agents)" [ref=e52]:
      - list "Légende des liaisons" [ref=e53]:
        - listitem [ref=e54]: Possible
        - listitem [ref=e57]: Retenue
        - listitem [ref=e60]: En cours
        - listitem [ref=e63]: Non retenue
        - listitem [ref=e66]: Dossier asynchrone
      - generic [ref=e69]:
        - region "Étape 1" [ref=e70]:
          - list [ref=e71]:
            - listitem [ref=e72]:
              - article "1 Recherche" [ref=e74]:
                - generic [ref=e75]:
                  - heading "1 Recherche" [level=2] [ref=e80]
                  - switch "Manuel. Exécution automatique de 1 Recherche" [ref=e82] [cursor=pointer]:
                    - generic [ref=e83]: Manuel
                - group [ref=e87]:
                  - generic "1 Recherche" [ref=e88] [cursor=pointer]
                - paragraph [ref=e93]: Cet agent est figé car un agent en aval a déjà été lancé.
                - region "Conversation avec 1 Recherche" [ref=e94]:
                  - generic [ref=e95]: Conversation
                  - log [ref=e96]:
                    - article [ref=e97]:
                      - text: Agent
                      - generic [ref=e98]:
                        - paragraph [ref=e101]: Résultat vérifié du moteur simulé.
                        - generic [ref=e102]:
                          - generic [ref=e103]: Branche sélectionnée
                          - list [ref=e104]:
                            - listitem [ref=e105]: 2 Sélection
                - generic [ref=e106]:
                  - generic [ref=e107]: Précisions
                  - textbox "Précisions" [disabled] [ref=e108]:
                    - /placeholder: Ajoutez une précision pour la prochaine relance...
                - button "Relancer l’agent" [disabled] [ref=e110]
        - region "Étape 2" [ref=e114]:
          - list [ref=e115]:
            - listitem [ref=e116]:
              - article "2 Sélection" [ref=e118]:
                - generic [ref=e119]:
                  - heading "2 Sélection" [level=2] [ref=e124]
                  - switch "Manuel. Exécution automatique de 2 Sélection" [ref=e126] [cursor=pointer]:
                    - generic [ref=e127]: Manuel
                - group [ref=e131]:
                  - generic "2 Sélection" [ref=e132] [cursor=pointer]
                - region "Conversation avec 2 Sélection" [ref=e136]:
                  - generic [ref=e137]: Conversation
                  - log [ref=e138]:
                    - article [ref=e139]:
                      - text: Agent
                      - generic [ref=e140]:
                        - list "Réponses proposées" [ref=e141]:
                          - listitem [ref=e142]:
                            - generic [ref=e145]:
                              - heading "Bien A" [level=3] [ref=e146]
                              - generic [ref=e147]:
                                - paragraph [ref=e148]: Négocier PROPERTY_A.
                                - paragraph [ref=e149]: Informations documentées.
                          - listitem [ref=e150]:
                            - generic [ref=e153]:
                              - heading "Bien B" [level=3] [ref=e154]
                              - generic [ref=e155]:
                                - paragraph [ref=e156]: Négocier PROPERTY_B.
                                - paragraph [ref=e157]: Informations documentées.
                        - paragraph [ref=e158]: Chaque résultat retenu démarre un dossier indépendant. Le suivi apparaît sous l’agent suivant ; les doublons sont ignorés.
                - generic [ref=e159]:
                  - generic [ref=e160]: Précisions
                  - textbox "Précisions" [ref=e161]:
                    - /placeholder: Ajoutez une précision pour la prochaine relance...
                - button "Relancer l’agent" [ref=e163] [cursor=pointer]
              - paragraph [ref=e167]: Dossiers indépendants → 3 Négociation
        - region "Étape 3" [ref=e168]:
          - list [ref=e169]:
            - listitem [ref=e170]:
              - generic [ref=e171]:
                - article "3 Négociation" [ref=e172]:
                  - generic [ref=e178]:
                    - heading "3 Négociation" [level=2] [ref=e179]
                    - generic "Cet agent s’exécute indépendamment dans chaque dossier." [ref=e180]: Asynchrone
                  - paragraph [ref=e181]: 3 Négociation
                  - group [ref=e182]:
                    - generic "Instructions et configuration" [ref=e183] [cursor=pointer]
                - region [ref=e184]:
                  - generic [ref=e185]:
                    - heading "Dossiers (2)" [level=3] [ref=e186]
                    - paragraph [ref=e189]: Depuis 2 Sélection · Un dossier par résultat retenu
                    - group "Filtrer les dossiers" [ref=e194]:
                      - button "Tous" [ref=e195] [cursor=pointer]
                      - button "1 À traiter" [pressed] [ref=e196] [cursor=pointer]
                      - button "1 Arrêtés" [ref=e199] [cursor=pointer]
                  - list [ref=e200]:
                    - listitem [ref=e201]:
                      - button "Bien A Échec L’exécution a échoué. Consultez le diagnostic. Mis à jour 9 sept., 19:08 Examiner l’erreur" [pressed] [ref=e202] [cursor=pointer]:
                        - generic [ref=e203]:
                          - strong [ref=e205]: Bien A
                          - generic [ref=e206]: Échec
                        - generic [ref=e209]: L’exécution a échoué. Consultez le diagnostic.
                        - generic [ref=e210]:
                          - generic [ref=e211]:
                            - text: Mis à jour
                            - time [ref=e212]: 9 sept., 19:08
                          - generic [ref=e213]: Examiner l’erreur
                  - dialog [ref=e216]:
                    - region "Détail du dossier" [ref=e217]:
                      - generic [ref=e218]:
                        - generic [ref=e219]:
                          - text: Dossier indépendant
                          - heading "Bien A" [level=3] [ref=e220]
                        - button "Fermer le dossier" [ref=e221] [cursor=pointer]
                      - generic [ref=e225]:
                        - generic [ref=e226]:
                          - generic [ref=e227]: Échec
                          - generic [ref=e230]: Créé le 9 sept., 19:08
                        - generic [ref=e231]:
                          - paragraph [ref=e232]: L’exécution a échoué. Consultez le diagnostic.
                          - group [ref=e233]:
                            - generic "Diagnostic technique" [active] [ref=e234] [cursor=pointer]
                            - generic [ref=e235]: Échec simulé du moteur.
                        - group [ref=e236]:
                          - generic "Résultat à l’origine du dossier" [ref=e237] [cursor=pointer]
                        - generic [ref=e238]:
                          - generic [ref=e239]: Précisions pour reprendre ce dossier
                          - paragraph [ref=e240]: Indiquez les informations manquantes ou ce que vous avez corrigé. Ces précisions seront transmises aux agents de ce dossier. La reprise peut déclencher les actions autorisées, dont l’envoi de mails.
                          - textbox "Précisions pour reprendre ce dossier" [ref=e241]
                          - button "Reprendre après vérification" [ref=e242] [cursor=pointer]
                        - button "Arrêter ce dossier" [ref=e249] [cursor=pointer]
                        - group [ref=e250]:
                          - generic "3 Négociation · Échec" [ref=e251] [cursor=pointer]
                        - group [ref=e252]:
                          - generic "4 Bilan · Non exécuté" [ref=e253] [cursor=pointer]
        - region "Étape 4" [ref=e254]:
          - list [ref=e255]:
            - listitem [ref=e256]:
              - article "4 Bilan" [ref=e258]:
                - generic [ref=e264]:
                  - heading "4 Bilan" [level=2] [ref=e265]
                  - generic "Cet agent s’exécute indépendamment dans chaque dossier." [ref=e266]: Asynchrone
                - paragraph [ref=e267]: 4 Bilan
                - group [ref=e268]:
                  - generic "Instructions et configuration" [ref=e269] [cursor=pointer]
              - generic [ref=e270]: Fin de la branche
```

# Test source

```ts
  1   | import { expect, test, type APIRequestContext } from "@playwright/test";
  2   | import { randomUUID } from "node:crypto";
  3   | import AxeBuilder from "@axe-core/playwright";
  4   | 
  5   | async function create(request: APIRequestContext, negotiation = "E2E_AUTOMATION_NEGOTIATE") {
  6   |   await request.post("/__test/automation-reset-scan");
  7   |   const name = `Immobilier-${randomUUID().slice(0, 6)}`;
  8   |   const created = await request.post("/api/projects/create", { data: { name, engine: "codex", generationMode: "empty", instructions: "Workflow de test." } });
  9   |   expect(created.status()).toBe(201);
  10  |   const { project } = await created.json();
  11  |   const saved = await request.put(`/api/agents/projects/${project.id}`, { data: { name, engine: "codex",
  12  |     instructions: "Rechercher les annonces, sélectionner les meilleures et ouvrir un dossier indépendant par bien pour négocier par mail. Un accord déclenche le bilan.",
  13  |     agents: [{ name: "1 Recherche", prompt: "Rechercher les annonces." }, { name: "2 Sélection", prompt: "E2E_AUTOMATION_SCAN E2E_SCAN_SLOW" },
  14  |       { name: "3 Négociation", prompt: negotiation }, { name: "4 Bilan", prompt: "Bilan après accord confirmé uniquement." }].map(agent => ({ ...agent, description: agent.name }))
  15  |   } });
  16  |   expect(saved.ok()).toBe(true);
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
> 101 |   expect((await new AxeBuilder({ page }).include(".workflow-dossiers").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
      |                                                                                                                                           ^ Error: expect(received).toEqual(expected) // deep equality
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
  117 |   await expect.poll(async () => (await jobs(request, id)).filter(job => job.status === "waiting").length).toBe(3);
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
```