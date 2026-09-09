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
          - generic "9 projets" [ref=e11]: "9"
          - button "Réduire la barre des projets" [expanded] [ref=e12] [cursor=pointer]
    - generic [ref=e16]:
      - searchbox "Rechercher un projet" [ref=e21]
      - generic [ref=e22]:
        - button "Nouveau répertoire" [ref=e23] [cursor=pointer]
        - list [ref=e26]:
          - listitem "Réorganisez par glisser-déposer ou avec Alt + ↑ / ↓ sur le projet." [ref=e27] [cursor=pointer]:
            - button [ref=e36]:
              - strong [ref=e42]: Immobilier-3119a2
            - button "Supprimer Immobilier-3119a2" [ref=e43]
          - listitem "Réorganisez par glisser-déposer ou avec Alt + ↑ / ↓ sur le projet." [ref=e47] [cursor=pointer]:
            - button [ref=e56]:
              - strong [ref=e62]: Immobilier-cd57a6
            - button "Supprimer Immobilier-cd57a6" [ref=e63]
          - listitem "Réorganisez par glisser-déposer ou avec Alt + ↑ / ↓ sur le projet." [ref=e67] [cursor=pointer]:
            - button [ref=e76]:
              - strong [ref=e82]: Immobilier-2ce6f6
            - button "Supprimer Immobilier-2ce6f6" [ref=e83]
          - listitem "Réorganisez par glisser-déposer ou avec Alt + ↑ / ↓ sur le projet." [ref=e87] [cursor=pointer]:
            - button [ref=e96]:
              - strong [ref=e102]: Immobilier-d50b8e
            - button "Supprimer Immobilier-d50b8e" [ref=e103]
          - listitem "Réorganisez par glisser-déposer ou avec Alt + ↑ / ↓ sur le projet." [ref=e107] [cursor=pointer]:
            - button [ref=e116]:
              - strong [ref=e122]: Immobilier-b945b1
            - button "Supprimer Immobilier-b945b1" [ref=e123]
          - listitem "Réorganisez par glisser-déposer ou avec Alt + ↑ / ↓ sur le projet." [ref=e127] [cursor=pointer]:
            - button [ref=e136]:
              - strong [ref=e142]: Immobilier-faa4ba
            - button "Supprimer Immobilier-faa4ba" [ref=e143]
          - listitem "Réorganisez par glisser-déposer ou avec Alt + ↑ / ↓ sur le projet." [ref=e147] [cursor=pointer]:
            - button [ref=e156]:
              - strong [ref=e162]: Immobilier-7ed693
            - button "Supprimer Immobilier-7ed693" [ref=e163]
          - listitem "Réorganisez par glisser-déposer ou avec Alt + ↑ / ↓ sur le projet." [ref=e167] [cursor=pointer]:
            - button [ref=e176]:
              - strong [ref=e182]: Immobilier-bcd752
            - button "Supprimer Immobilier-bcd752" [ref=e183]
          - listitem "Réorganisez par glisser-déposer ou avec Alt + ↑ / ↓ sur le projet." [ref=e187] [cursor=pointer]:
            - button [ref=e196]:
              - strong [ref=e202]: Immobilier-c1c22e
            - button "Supprimer Immobilier-c1c22e" [ref=e203]
    - generic [ref=e207]:
      - button "Nouveau projet" [ref=e208] [cursor=pointer]
      - generic "Importer" [ref=e210]:
        - generic [ref=e212]:
          - button "Dossier" [ref=e213] [cursor=pointer]
          - button ".ctx" [ref=e217] [cursor=pointer]
      - button "Codex Paramètres" [ref=e223] [cursor=pointer]:
        - generic [ref=e227]:
          - strong [ref=e228]: Codex
          - generic [ref=e229]: Paramètres
  - main [ref=e232]:
    - generic [ref=e233]:
      - generic [ref=e234]:
        - generic [ref=e235]:
          - paragraph [ref=e236]: Projet codex
          - heading "Immobilier-c1c22e" [level=1] [ref=e237]
        - button "Exporter" [ref=e238] [cursor=pointer]
      - generic [ref=e242]:
        - tablist "Contenu du projet" [ref=e243]:
          - tab "Instructions projet" [ref=e244] [cursor=pointer]
          - tab "Workflow (4 agents)" [selected] [ref=e245] [cursor=pointer]
          - tab "Historique" [ref=e246] [cursor=pointer]
        - generic [ref=e247]:
          - checkbox "Manuel. Exécution automatique de tous les agents" [ref=e248] [cursor=pointer]:
            - generic [ref=e249]: Manuel
          - button "Planifier" [ref=e253] [cursor=pointer]
          - button "Réinitialiser" [ref=e258] [cursor=pointer]
          - button "Modifier le projet" [ref=e262] [cursor=pointer]
    - tabpanel "Workflow (4 agents)" [ref=e266]:
      - list "Légende des liaisons" [ref=e267]:
        - listitem [ref=e268]: Possible
        - listitem [ref=e271]: Retenue
        - listitem [ref=e274]: En cours
        - listitem [ref=e277]: Non retenue
        - listitem [ref=e280]: Dossier asynchrone
      - generic [ref=e283]:
        - region "Étape 1" [ref=e284]:
          - list [ref=e285]:
            - listitem [ref=e286]:
              - article "1 Recherche" [ref=e288]:
                - generic [ref=e289]:
                  - heading "1 Recherche" [level=2] [ref=e294]
                  - switch "Manuel. Exécution automatique de 1 Recherche" [ref=e296] [cursor=pointer]:
                    - generic [ref=e297]: Manuel
                - group [ref=e301]:
                  - generic "1 Recherche" [ref=e302] [cursor=pointer]
                - paragraph [ref=e307]: Cet agent est figé car un agent en aval a déjà été lancé.
                - region "Conversation avec 1 Recherche" [ref=e308]:
                  - generic [ref=e309]: Conversation
                  - log [ref=e310]:
                    - article [ref=e311]:
                      - text: Agent
                      - generic [ref=e312]:
                        - paragraph [ref=e315]: Résultat vérifié du moteur simulé.
                        - generic [ref=e316]:
                          - generic [ref=e317]: Branche sélectionnée
                          - list [ref=e318]:
                            - listitem [ref=e319]: 2 Sélection
                - generic [ref=e320]:
                  - generic [ref=e321]: Précisions
                  - textbox "Précisions" [disabled] [ref=e322]:
                    - /placeholder: Ajoutez une précision pour la prochaine relance...
                - button "Relancer l’agent" [disabled] [ref=e324]
        - region "Étape 2" [ref=e328]:
          - list [ref=e329]:
            - listitem [ref=e330]:
              - article "2 Sélection" [ref=e332]:
                - generic [ref=e333]:
                  - heading "2 Sélection" [level=2] [ref=e338]
                  - switch "Manuel. Exécution automatique de 2 Sélection" [ref=e340] [cursor=pointer]:
                    - generic [ref=e341]: Manuel
                - group [ref=e345]:
                  - generic "2 Sélection" [ref=e346] [cursor=pointer]
                - region "Conversation avec 2 Sélection" [ref=e350]:
                  - generic [ref=e351]: Conversation
                  - log [ref=e352]:
                    - article [ref=e353]:
                      - text: Agent
                      - generic [ref=e354]:
                        - list "Réponses proposées" [ref=e355]:
                          - listitem [ref=e356]:
                            - generic [ref=e359]:
                              - heading "Bien A" [level=3] [ref=e360]
                              - generic [ref=e361]:
                                - paragraph [ref=e362]: Négocier PROPERTY_A.
                                - paragraph [ref=e363]: Informations documentées.
                          - listitem [ref=e364]:
                            - generic [ref=e367]:
                              - heading "Bien B" [level=3] [ref=e368]
                              - generic [ref=e369]:
                                - paragraph [ref=e370]: Négocier PROPERTY_B.
                                - paragraph [ref=e371]: Informations documentées.
                        - paragraph [ref=e372]: Chaque résultat retenu démarre un dossier indépendant. Le suivi apparaît sous l’agent suivant ; les doublons sont ignorés.
                - generic [ref=e373]:
                  - generic [ref=e374]: Précisions
                  - textbox "Précisions" [ref=e375]:
                    - /placeholder: Ajoutez une précision pour la prochaine relance...
                - button "Relancer l’agent" [ref=e377] [cursor=pointer]
              - paragraph [ref=e381]: Dossiers indépendants → 3 Négociation
        - region "Étape 3" [ref=e382]:
          - list [ref=e383]:
            - listitem [ref=e384]:
              - generic [ref=e385]:
                - article "3 Négociation" [ref=e386]:
                  - generic [ref=e392]:
                    - heading "3 Négociation" [level=2] [ref=e393]
                    - generic "Cet agent s’exécute indépendamment dans chaque dossier." [ref=e394]: Asynchrone
                  - paragraph [ref=e395]: 3 Négociation
                  - group [ref=e396]:
                    - generic "Instructions et configuration" [ref=e397] [cursor=pointer]
                - region [ref=e398]:
                  - generic [ref=e399]:
                    - heading "Dossiers (2)" [level=3] [ref=e400]
                    - paragraph [ref=e403]: Depuis 2 Sélection · Un dossier par résultat retenu
                    - group "Filtrer les dossiers" [ref=e408]:
                      - button "Tous" [ref=e409] [cursor=pointer]
                      - button "1 À traiter" [pressed] [ref=e410] [cursor=pointer]
                      - button "1 Arrêtés" [ref=e413] [cursor=pointer]
                  - list [ref=e414]:
                    - listitem [ref=e415]:
                      - button "Bien A Échec L’exécution a échoué. Consultez le diagnostic. Mis à jour 9 sept., 19:10 Examiner l’erreur" [pressed] [ref=e416] [cursor=pointer]:
                        - generic [ref=e417]:
                          - strong [ref=e419]: Bien A
                          - generic [ref=e420]: Échec
                        - generic [ref=e423]: L’exécution a échoué. Consultez le diagnostic.
                        - generic [ref=e424]:
                          - generic [ref=e425]:
                            - text: Mis à jour
                            - time [ref=e426]: 9 sept., 19:10
                          - generic [ref=e427]: Examiner l’erreur
                  - dialog [ref=e430]:
                    - region "Détail du dossier" [ref=e431]:
                      - generic [ref=e432]:
                        - generic [ref=e433]:
                          - text: Dossier indépendant
                          - heading "Bien A" [level=3] [ref=e434]
                        - button "Fermer le dossier" [ref=e435] [cursor=pointer]
                      - generic [ref=e439]:
                        - generic [ref=e440]:
                          - generic [ref=e441]: Échec
                          - generic [ref=e444]: Créé le 9 sept., 19:10
                        - generic [ref=e445]:
                          - paragraph [ref=e446]: L’exécution a échoué. Consultez le diagnostic.
                          - group [ref=e447]:
                            - generic "Diagnostic technique" [active] [ref=e448] [cursor=pointer]
                            - generic [ref=e449]: Échec simulé du moteur.
                        - group [ref=e450]:
                          - generic "Résultat à l’origine du dossier" [ref=e451] [cursor=pointer]
                        - generic [ref=e452]:
                          - generic [ref=e453]: Précisions pour reprendre ce dossier
                          - paragraph [ref=e454]: Indiquez les informations manquantes ou ce que vous avez corrigé. Ces précisions seront transmises aux agents de ce dossier. La reprise peut déclencher les actions autorisées, dont l’envoi de mails.
                          - textbox "Précisions pour reprendre ce dossier" [ref=e455]
                          - button "Reprendre après vérification" [ref=e456] [cursor=pointer]
                        - button "Arrêter ce dossier" [ref=e463] [cursor=pointer]
                        - group [ref=e464]:
                          - generic "3 Négociation · Échec" [ref=e465] [cursor=pointer]
                        - group [ref=e466]:
                          - generic "4 Bilan · Non exécuté" [ref=e467] [cursor=pointer]
        - region "Étape 4" [ref=e468]:
          - list [ref=e469]:
            - listitem [ref=e470]:
              - article "4 Bilan" [ref=e472]:
                - generic [ref=e478]:
                  - heading "4 Bilan" [level=2] [ref=e479]
                  - generic "Cet agent s’exécute indépendamment dans chaque dossier." [ref=e480]: Asynchrone
                - paragraph [ref=e481]: 4 Bilan
                - group [ref=e482]:
                  - generic "Instructions et configuration" [ref=e483] [cursor=pointer]
              - generic [ref=e484]: Fin de la branche
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