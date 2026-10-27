import { test, expect, type APIRequestContext } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";

test.use({ timezoneId: "Europe/Paris" });
const overview = async (request: APIRequestContext) => (await request.get("/api/work-force")).json();
async function project(request: APIRequestContext, suffix: string, slow = false) {
  const name = `WorkForce-${suffix}-${randomUUID().slice(0, 6)}`;
  const created = await request.post("/api/projects/create", { data: { name, engine: "codex", generationMode: "empty", instructions: "Exécuter uniquement la mission de l’agent sélectionné." } });
  expect(created.status()).toBe(201);
  const { project } = await created.json();
  const saved = await request.put(`/api/agents/projects/${project.id}`, { data: {
    name, engine: "codex", instructions: "Exécuter uniquement la mission de l’agent sélectionné.", agents: [
      { name: `${suffix} Préparation`, description: "Agent non sélectionné", prompt: "Préparer le travail." },
      { name: `${suffix} Sélectionné`, description: "Agent Work Force", prompt: `${slow ? "E2E_WORK_FORCE_SLOW" : ""} Exécuter la mission.` }
    ]
  } });
  expect(saved.ok()).toBe(true);
  const content = await saved.json();
  const agent = content.agents.find((agent: any) => agent.name === `${suffix} Sélectionné`);
  return { projectId: project.id, agentId: agent.id, name: agent.name, projectName: name, directoryPath: project.directoryPath };
}
test.beforeEach(async ({ request }) => {
  await request.post("/api/work-force/stop", { data: {} });
  await expect.poll(async () => (await overview(request)).runtime.active).toBeNull();
  await request.post("/__test/work-force-clock", { data: { at: null } });
  await request.put("/api/work-force/configuration", { data: { agents: [], startsAt: null, endsAt: null } });
  await request.put("/api/work-force/settings", { data: { minimumFiveHourRemainingPercent: 30, minimumWeeklyRemainingPercent: 8 } });
  await request.put("/api/agents/codex-quota", { data: { enabled: false, minimumFiveHourRemainingPercent: 50, minimumWeeklyRemainingPercent: 10 } });
  await request.post("/__test/codex-quota", { data: { fiveHourUsed: 50, weeklyUsed: 90 } });
});
test.afterEach(async ({ request }) => {
  await request.post("/api/work-force/stop", { data: {} });
  await expect.poll(async () => (await overview(request)).runtime.active).toBeNull();
  await request.post("/__test/work-force-clock", { data: { at: null } });
  await request.put("/api/agents/codex-quota", { data: { enabled: false, minimumFiveHourRemainingPercent: 50, minimumWeeklyRemainingPercent: 10 } });
});

test("selects agents across projects, reorders, saves local start/end times and schedules the loop", async ({ page, request }, info) => {
  const a = await project(request, "Alpha"), b = await project(request, "Beta");
  await page.goto("/?mode=work-force");
  await expect(page.getByRole("heading", { name: "Work Force", exact: true })).toBeVisible();
  await page.getByRole("checkbox", { name: `${a.name} ${a.projectName} Agent Work Force`, exact: true }).check();
  await page.getByRole("checkbox", { name: `${b.name} ${b.projectName} Agent Work Force`, exact: true }).check();
  await expect(page.getByRole("button", { name: /^(Monter|Descendre) / })).toHaveCount(0);
  const rows = page.locator(".work-force__sequence li");
  await rows.filter({ hasText: b.name }).dragTo(rows.filter({ hasText: a.name }));
  await expect(page.locator(".work-force__sequence li").first()).toContainText(b.name);
  const date = new Date(Date.now() + 86_400_000); date.setHours(9, 30, 0, 0);
  const values = await page.evaluate(iso => {
    const start = new Date(iso), end = new Date(start.getTime() + 2 * 3_600_000);
    const local = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
    return { start: local(start), end: local(end), iso: start.toISOString(), endIso: end.toISOString() };
  }, date.toISOString());
  await page.getByLabel("Début planifié", { exact: true }).fill(values.start);
  await page.getByLabel("Fin planifiée", { exact: true }).fill(values.end);
  await page.getByRole("button", { name: "Enregistrer", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Configuration enregistrée." })).toBeVisible();
  expect((await overview(request)).configuration).toEqual({ agents: [{ projectId: b.projectId, agentId: b.agentId }, { projectId: a.projectId, agentId: a.agentId }], startsAt: values.iso, endsAt: values.endIso });
  await page.reload();
  await expect(page.getByLabel("Début planifié", { exact: true })).toHaveValue(values.start);
  await expect(page.locator(".work-force__sequence li").first()).toContainText(b.name);
  await page.getByRole("button", { name: "Programmer Work Force", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Début programmé" })).toBeVisible();
  await expect(page.getByLabel("Début planifié", { exact: true })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
  await page.screenshot({ path: info.outputPath("work-force-scheduled.png"), fullPage: true });
  await page.getByRole("button", { name: "Arrêter Work Force", exact: true }).click();
  await page.getByRole("button", { name: "Mode normal", exact: true }).click();
  await expect(page.getByRole("button", { name: "Work Force", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Work Force", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Work Force", exact: true })).toBeVisible();
});

test("quota waits last five minutes, normal-mode thresholds do not interfere, and planned end drains the active agent", async ({ page, request }) => {
  const a = await project(request, "Quota", true), b = await project(request, "Suite");
  const now = Date.now(), end = now + 10 * 60_000;
  await request.post("/__test/work-force-clock", { data: { at: new Date(now).toISOString() } });
  await request.put("/api/work-force/configuration", { data: { agents: [a, b].map(({ projectId, agentId }) => ({ projectId, agentId })), startsAt: null, endsAt: new Date(end).toISOString() } });
  await request.put("/api/agents/codex-quota", { data: { enabled: true, minimumFiveHourRemainingPercent: 99, minimumWeeklyRemainingPercent: 99 } });
  await request.post("/__test/codex-quota", { data: { fiveHourUsed: 71, weeklyUsed: 92 } });
  const historyCount = (await overview(request)).runtime.history.length;
  await page.goto("/?mode=work-force"); await page.getByRole("button", { name: "Démarrer Work Force", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "En attente des quotas" })).toBeVisible();
  await request.post("/__test/codex-quota", { data: { fiveHourUsed: 70, weeklyUsed: 92 } });
  await request.post("/__test/work-force-clock", { data: { at: new Date(now + 299_999).toISOString() } });
  expect((await overview(request)).runtime.active).toBeNull();
  expect((await overview(request)).runtime.history.length).toBe(historyCount);
  await request.post("/__test/work-force-clock", { data: { at: new Date(now + 300_000).toISOString() } });
  await expect.poll(async () => (await overview(request)).runtime.active?.agent.name).toBe(a.name);
  // The same configured agent cannot overlap, even when parallelism is allowed.
  const overlapping = request.post(`/api/agents/projects/${a.projectId}/agents/run`, { data: { agentId: a.agentId } });
  await expect.poll(async () => (await (await request.get("/api/execution-queue")).json()).waiting.length).toBe(1);
  await request.post("/__test/work-force-clock", { data: { at: new Date(end).toISOString() } });
  await expect.poll(async () => (await overview(request)).runtime.phase).toBe("stopping");
  await expect.poll(async () => (await overview(request)).runtime.phase).toBe("stopped");
  expect((await overlapping).status()).toBe(400); // Quotas are rechecked after the wait.
  const result = await overview(request);
  expect(result.runtime.history[0]).toMatchObject({ agent: { name: a.name }, outcome: "succeeded" });
  expect(result.runtime.cursor).toBe(1);
  expect(result.runtime.history.length).toBe(Math.min(20, historyCount + 1));
});

test("Work Force thresholds are editable in settings and invalid configurations are rejected", async ({ page, request }) => {
  await page.goto("/?mode=work-force");
  await page.locator("details").filter({ has: page.locator("summary", { hasText: "Paramètres Work Force" }) }).locator("summary").first().click();
  await expect(page.getByLabel("Réserve minimale sur 5 h (%)", { exact: true })).toHaveValue("30");
  await expect(page.getByLabel("Réserve minimale hebdomadaire (%)", { exact: true })).toHaveValue("8");
  await page.getByLabel("Réserve minimale sur 5 h (%)", { exact: true }).fill("35");
  await page.getByLabel("Réserve minimale hebdomadaire (%)", { exact: true }).fill("12");
  await page.getByRole("button", { name: "Enregistrer les seuils", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Seuils Work Force enregistrés." })).toBeVisible();
  expect((await overview(request)).settings).toEqual({ minimumFiveHourRemainingPercent: 35, minimumWeeklyRemainingPercent: 12 });
  expect((await request.put("/api/work-force/settings", { data: { minimumFiveHourRemainingPercent: -1, minimumWeeklyRemainingPercent: 8 } })).status()).toBe(400);
  expect((await request.put("/api/work-force/configuration", { data: { agents: [], startsAt: "2026-10-28T12:00:00Z", endsAt: "2026-10-28T11:00:00Z" } })).status()).toBe(400);
  expect((await request.put("/api/work-force/configuration", { data: { agents: [{ projectId: "missing", agentId: "missing" }], startsAt: null, endsAt: null } })).status()).toBe(400);
  await page.getByRole("button", { name: "Mode normal", exact: true }).click();
  const trigger = page.locator(".agent-engine-settings-trigger");
  if (!await trigger.isVisible()) await page.getByRole("button", { name: "Afficher la liste des projets", exact: true }).click();
  await trigger.click();
  await expect(page.getByLabel("Réserve minimale sur 5 h (%)", { exact: true })).toHaveValue("35");
  await expect(page.getByLabel("Réserve minimale hebdomadaire (%)", { exact: true })).toHaveValue("12");
  expect((await new AxeBuilder({ page }).include(".work-force-settings").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
});
