import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";

test("execution policy is editable, survives reload, exposes the resolved profile and fits mobile", async ({ page, request }, info) => {
  const name = `Quality-${randomUUID().slice(0, 8)}`;
  const created = await request.post("/api/projects/create", { data: { name, engine: "codex", description: "Un agent de test." } });
  expect(created.status()).toBe(201);
  const { project } = await created.json();
  await page.goto(`/?project=${project.id}&view=instructions`);
  const panel = page.locator(".execution-quality");
  await panel.locator("summary").first().click();
  await expect(panel.getByRole("heading", { name: "Profils résolus sur le serveur" })).toBeVisible();
  await expect(panel.getByText(/gpt-server-sol \/ low/)).toBeVisible();
  await panel.getByRole("combobox", { name: "Effort de raisonnement par défaut", exact: true }).selectOption("high");
  await panel.getByRole("combobox", { name: "Recherche et revue déléguées", exact: true }).selectOption("bounded");
  await panel.getByLabel(/Critères d’acceptation/).fill("Parcours vérifié sur mobile\nLimites des contrôles indiquées");
  await panel.getByRole("button", { name: "Enregistrer le profil d’exécution" }).click();
  await expect(panel.getByRole("status")).toHaveText("Profil d’exécution enregistré.");
  const settings = await (await request.get(`/api/agents/projects/${project.id}/execution-policy`)).json();
  expect(settings.policy).toMatchObject({ defaultReasoningEffort: "high", delegation: "bounded", acceptanceCriteria: ["Parcours vérifié sur mobile", "Limites des contrôles indiquées"] });
  expect(settings.profiles[0].profile).toMatchObject({ model: "gpt-server-sol", reasoningEffort: "high", resolution: "pinned" });
  await page.reload(); await panel.locator("summary").first().click();
  await expect(panel.getByRole("combobox", { name: "Effort de raisonnement par défaut", exact: true })).toHaveValue("high");
  await expect(panel.getByLabel(/Critères d’acceptation/)).toHaveValue("Parcours vérifié sur mobile\nLimites des contrôles indiquées");
  expect(await panel.evaluate(e => e.scrollWidth <= e.clientWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).include(".execution-quality").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
  await panel.screenshot({ path: info.outputPath("execution-quality.png") });
});

test("partial delivery stays partial in audit and exposes its verification gaps", async ({ page, request }) => {
  const name = `Partial-${randomUUID().slice(0, 8)}`;
  const { project } = await (await request.post("/api/projects/create", { data: { name, engine: "codex", description: "Un agent de test." } })).json();
  const base = `/api/agents/projects/${project.id}`;
  const content = await (await request.get(base)).json();
  expect((await request.put(base, { data: { name, engine: "codex", instructions: content.instructions.content,
    agents: content.agents.map((a: any) => ({ ...a, prompt: "E2E_PARTIAL" })) } })).ok()).toBe(true);
  expect((await request.post(`${base}/workflow/run`, { data: {} })).ok()).toBe(true);
  const runs = await (await request.get(`${base}/audit/runs?scope=workflow`)).json();
  expect(runs.items[0].status).toBe("partial");
  const detail = await (await request.get(`${base}/audit/runs/${runs.items[0].id}`)).json();
  expect(detail.executions[0].profile).toMatchObject({ model: "gpt-server-sol", reasoningEffort: "low", cliVersion: "0.163.0-fixture" });
  await page.goto(`/?project=${project.id}&view=audit`);
  await expect(page.getByText("Résultat partiel · travail ou vérification restant", { exact: true })).toBeVisible();
  await expect(page.getByText("Du travail reste à effectuer.", { exact: true })).toBeVisible();
  await page.getByText("Afficher le détail technique", { exact: true }).click();
  await expect(page.getByText("0.163.0-fixture", { exact: true })).toBeVisible();
});
