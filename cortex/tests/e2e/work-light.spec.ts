import { test, expect, type APIRequestContext } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";

test.use({ timezoneId: "Europe/Paris" });
let baseDay = 0;
const slot = (day: number, hour: number, minute = 0) => new Date(baseDay + day * 86400000 + hour * 3600000 + minute * 60000).toISOString();
const overview = async (request: APIRequestContext) => (await request.get("/api/work-light")).json();
const clock = (request: APIRequestContext, at: string) => request.post("/__test/work-light-clock", { data: { at } });
async function project(request: APIRequestContext, slow = false) {
  const name = "WorkLight-" + randomUUID().slice(0, 8);
  const created = await request.post("/api/projects/create", { data: { name, engine: "codex", generationMode: "empty", instructions: "Exécuter la mission sélectionnée." } });
  expect(created.status()).toBe(201); const { project } = await created.json();
  const saved = await request.put(`/api/agents/projects/${project.id}`, { data: { name, engine: "codex", instructions: "Mission Work Light", agents: ["A", "B", "C"].map(letter => ({ name: name + " " + letter, description: "Mission sélectionnable", prompt: (slow ? "E2E_WORK_FORCE_SLOW " : "") + "Exécuter la mission " + letter })) } });
  expect(saved.ok()).toBe(true); const content = await saved.json();
  return { id: project.id, name, agents: content.agents, refs: content.agents.map((agent: any) => ({ projectId: project.id, agentId: agent.id })) };
}
async function configure(request: APIRequestContext, agents: any[], crons = ["0 12,20 * * *"]) {
  const response = await request.put("/api/work-light/configuration", { data: { agents, crons, timezone: "Europe/Paris" } }); expect(response.ok()).toBe(true);
}
test.beforeEach(async ({ request }) => {
  await request.post("/api/work-light/stop", { data: {} }); await request.post("/api/work-force/stop", { data: {} });
  await expect.poll(async () => (await overview(request)).runtime.active).toBeNull();
  const last = (await overview(request)).runtime.lastEvaluatedMinute;
  baseDay = Math.floor(Math.max(Date.parse("2026-11-01T00:00:00Z"), (last + 1) * 60000) / 86400000) * 86400000 + 86400000;
  await clock(request, slot(0, 10, 59));
  await configure(request, []);
  await request.put("/api/work-light/settings", { data: { minimumFiveHourRemainingPercent: 30, minimumWeeklyRemainingPercent: 8 } });
  await request.put("/api/execution-queue/settings", { data: { allowParallelExecutions: false } });
  await request.put("/api/agents/codex-quota", { data: { enabled: false, minimumFiveHourRemainingPercent: 50, minimumWeeklyRemainingPercent: 10 } });
  await request.post("/__test/codex-quota", { data: { fiveHourUsed: 70, weeklyUsed: 92 } });
});
test.afterEach(async ({ request }) => {
  await request.post("/api/work-light/stop", { data: {} }); await request.post("/api/work-force/stop", { data: {} });
  await expect.poll(async () => (await overview(request)).runtime.active).toBeNull();
  await request.put("/api/execution-queue/settings", { data: { allowParallelExecutions: true } });
});

test("select, drag, configure advanced multi-cron, persist, and show a red active sidebar button", async ({ page, request }, info) => {
  const p = await project(request); await page.goto("/?mode=work-light");
  await expect(page.getByRole("heading", { name: "Work Light", exact: true })).toBeVisible();
  for (const agent of p.agents) await page.getByRole("checkbox", { name: `${agent.name} ${p.name} Mission sélectionnable`, exact: true }).check();
  const rows = page.locator(".work-force__sequence li");
  const source = rows.filter({ hasText: p.agents[2].name }).locator(":scope > svg"), target = rows.filter({ hasText: p.agents[0].name }).locator(":scope > svg");
  await target.scrollIntoViewIfNeeded(); await source.scrollIntoViewIfNeeded();
  const from = (await source.boundingBox())!, to = (await target.boundingBox())!;
  await page.mouse.move(from.x + from.width/2, from.y + from.height/2); await page.mouse.down();
  await page.mouse.move(from.x + from.width/2, from.y - 8, { steps: 3 });
  await page.mouse.move(to.x + to.width/2, to.y + to.height/2, { steps: 10 });
  await page.mouse.move(to.x + to.width/2 + 1, to.y + to.height/2 + 1); await page.mouse.up(); await expect(rows.first()).toContainText(p.agents[2].name);
  await page.getByRole("button", { name: "Configurer les créneaux", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Fréquence", { exact: true }).selectOption("custom");
  await dialog.getByLabel("Expression cron", { exact: true }).fill("0 12 * * *");
  await dialog.getByRole("button", { name: "Ajouter un horaire", exact: true }).click();
  await dialog.getByLabel("Fréquence", { exact: true }).selectOption("custom");
  await dialog.getByLabel("Expression cron", { exact: true }).fill("0 20 * * *");
  await dialog.getByLabel("Fuseau de la planification", { exact: true }).selectOption("Europe/Paris");
  await expect(dialog.locator(".schedule-dialog__occurrences li")).toHaveCount(5);
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
  await dialog.getByRole("button", { name: "Enregistrer", exact: true }).click(); await expect(dialog).not.toBeVisible();
  const state = await overview(request); expect(state.configuration.crons).toEqual(["0 12 * * *", "0 20 * * *"]); expect(state.configuration.agents[0]).toEqual(p.refs[2]);
  await page.reload(); await expect(rows.first()).toContainText(p.agents[2].name);
  await page.getByRole("button", { name: "Activer Work Light", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "En attente du prochain créneau" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Configurer les créneaux", exact: true })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect((await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze()).violations).toEqual([]);
  await page.screenshot({ path: info.outputPath("work-light-active.png"), fullPage: true });
  await page.getByRole("button", { name: "Mode normal", exact: true }).click();
  const toggle = page.getByRole("button", { name: "Work Light", exact: true });
  if (!await toggle.isVisible()) await page.getByRole("button", { name: "Afficher la liste des projets", exact: true }).click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true"); await page.mouse.move(0, 0); await expect(toggle).toHaveCSS("background-color", "rgb(180, 35, 50)");
  await expect(toggle).toHaveAttribute("title", /autres modes restent disponibles/);
  await toggle.click(); await page.getByRole("button", { name: "Arrêter Work Light", exact: true }).click();
});
test("one selected agent per slot, independent quotas, duplicate rules and coexistence with both other modes", async ({ request }) => {
  const p = await project(request); await configure(request, p.refs, ["0 12,20 * * *", "0 12 * * *"]);
  await request.put("/api/agents/codex-quota", { data: { enabled: true, minimumFiveHourRemainingPercent: 99, minimumWeeklyRemainingPercent: 99 } });
  expect((await request.post("/api/work-light/start", { data: {} })).status()).toBe(202);
  await request.put("/api/work-force/configuration", { data: { agents: p.refs, startsAt: null, endsAt: null } });
  const force = await request.post("/api/work-force/start", { data: {} }); expect(force.status()).toBe(202);
  await request.post("/api/work-force/stop", { data: {} });
  const normal = await request.post(`/api/agents/projects/${p.id}/agents/run`, { data: { agentId: p.agents[0].id } });
  expect(normal.status()).toBe(400); expect(await normal.text()).toContain("quotas");
  const schedulePath = "/api/agents/projects/" + p.id + "/workflow/schedule";
  expect((await request.put(schedulePath, { data: { cron: "* * * * *", crons: ["* * * * *"], timezone: "Europe/Paris", enabled: true, parameterValues: {} } })).ok()).toBe(true);
  await request.post("/__test/scheduled-scan", { data: { at: slot(0, 11) } });
  await expect.poll(async () => (await (await request.get(schedulePath)).json()).lastRunStatus).toBe("skipped");
  expect((await (await request.get(schedulePath)).json()).lastRunError).toContain("quotas");
  await request.put(schedulePath, { data: { cron: "* * * * *", timezone: "Europe/Paris", enabled: false, parameterValues: {} } });
  const names: string[] = [];
  for (const at of [slot(0, 11), slot(0, 19), slot(1, 11), slot(1, 19)]) {
    await clock(request, at); await expect.poll(async () => (await overview(request)).runtime.phase).toBe("scheduled");
    await expect.poll(async () => (await overview(request)).runtime.history[0]?.startedAt).toBe(new Date(at).toISOString());
    names.push((await overview(request)).runtime.history[0].agent.name); await clock(request, at);
  }
  expect(names).toEqual([p.agents[0].name, p.agents[1].name, p.agents[2].name, p.agents[0].name]);
  expect((await overview(request)).runtime.completedCycles).toBeGreaterThanOrEqual(1);
});
test("quota-denied slots retain the next agent and overlapping slots enter the shared queue", async ({ request }) => {
  const p = await project(request, true); await configure(request, p.refs); await request.post("/api/work-light/start", { data: {} });
  await request.post("/__test/codex-quota", { data: { fiveHourUsed: 71, weeklyUsed: 92 } });
  await clock(request, slot(0, 11));
  await expect.poll(async () => (await overview(request)).runtime.occurrences[0]?.outcome).toBe("skipped");
  await expect.poll(async () => (await overview(request)).runtime.reason).toContain("quotas");
  expect((await overview(request)).runtime.cursor).toBe(0);
  await request.post("/__test/codex-quota", { data: { fiveHourUsed: 70, weeklyUsed: 92 } });
  await clock(request, slot(0, 11, 5)); expect((await overview(request)).runtime.active).toBeNull();
  await clock(request, slot(0, 19)); await expect.poll(async () => (await overview(request)).runtime.active?.agent.name).toBe(p.agents[0].name);
  await clock(request, slot(1, 11)); await expect.poll(async () => (await overview(request)).runtime.occurrences[0]?.outcome).toBe("queued");
  await expect.poll(async () => (await overview(request)).runtime.phase).toBe("scheduled"); expect((await overview(request)).runtime.cursor).toBe(2);
  await clock(request, slot(1, 11, 5)); expect((await overview(request)).runtime.active).toBeNull();
  await clock(request, slot(1, 19)); await expect.poll(async () => (await overview(request)).runtime.active?.agent.name).toBe(p.agents[2].name);
});
test("invalid rules are rejected and Light quota controls save separately", async ({ page, request }) => {
  await page.goto("/?mode=work-light");
  await page.locator("details").filter({ has: page.locator("summary", { hasText: "Paramètres Work Light" }) }).locator("summary").click();
  await page.getByLabel("Réserve minimale sur 5 h (%)", { exact: true }).fill("35");
  await page.getByRole("button", { name: "Enregistrer les seuils", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Seuils Work Light enregistrés." })).toBeVisible();
  expect((await overview(request)).settings.minimumFiveHourRemainingPercent).toBe(35);
  for (const crons of [[], ["0 25 * * *"], ["0 0 31 2 *"]]) expect((await request.put("/api/work-light/configuration", { data: { agents: [], crons, timezone: "Europe/Paris" } })).status()).toBe(400);
  expect((await request.post("/api/work-light/preview", { data: { cron: "0 12 * * *", timezone: "Invalid" } })).status()).toBe(400);
});

for (const sameAgent of [false, true]) test(`successive Light slots respect agent identity when parallelism is enabled (sameAgent=${sameAgent})`, async ({ request }) => {
  const p = await project(request, true);
  await configure(request, sameAgent ? [p.refs[0]] : p.refs);
  await request.put("/api/execution-queue/settings", { data: { allowParallelExecutions: true } });
  await request.post("/api/work-light/start", { data: {} });
  await clock(request, slot(0, 11));
  await expect.poll(async () => (await overview(request)).runtime.active?.agent.name).toBe(p.agents[0].name);
  await clock(request, slot(0, 19));
  if (sameAgent) {
    await expect.poll(async () => (await overview(request)).runtime.pending.length).toBe(1);
    expect((await overview(request)).runtime.activeExecutions.length).toBe(1);
  } else {
    await expect.poll(async () => (await overview(request)).runtime.activeExecutions.map((item: any) => item.agent.name)).toEqual([p.agents[0].name, p.agents[1].name]);
  }
  await expect.poll(async () => (await overview(request)).runtime.history.filter((item: any) => item.agent.projectId === p.id && item.outcome === "succeeded").length).toBe(2);
  expect((await overview(request)).runtime.activeExecutions).toEqual([]);
  expect((await overview(request)).runtime.pending).toEqual([]);
});
