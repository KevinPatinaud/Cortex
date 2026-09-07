import { expect, test, type Page } from "@playwright/test";
import type { AgentDefinition, AgentProject, AgentRunResult, WorkflowSchedule } from "../../src/front/services/agentApi.ts";

async function openParallelWorkflow(page: Page) {
  const definition = (id: string, name: string, nextAgentIds: string[]): AgentDefinition => ({
    id, name, nextAgentIds, description: `Mission de ${name}.`, prompt: `Exécuter ${name}.`,
    inputMode: id === "summary" ? "aggregate" : "separate", hasSession: false,
    model: "gpt-5.6-terra", reasoningEffort: "medium",
    executionStatus: "idle", conversation: [], threads: []
  });
  const content: AgentProject = {
    projectId: "parallel-agenda", directoryPath: "C:/tests/Google Agenda parallèle", engine: "codex",
    workflowResumable: false, workflowParameterValues: {},
    instructions: { fileName: "AGENTS.md", content: "Deux sources indépendantes convergent vers une synthèse." },
    parameters: [{ id: "period", label: "Période", description: "Période commune aux deux branches.",
      required: true, inputType: "text", placeholder: "", options: [] }],
    // Deliberately shuffled: graph rendering must depend on edges, not API order.
    agents: [definition("publish", "Publieur", []),
      definition("events", "Chercheur événements", ["calendar"]),
      definition("calendar", "Analyse calendrier", ["summary"]),
      definition("summary", "Synthèse", ["publish"]),
      definition("research", "Enquêteur", ["writer"]),
      definition("writer", "Rédacteur journalistique", ["summary"])]
  };
  const schedule: WorkflowSchedule = { cron: "0 9 * * *", enabled: false, timezone: "Europe/Paris",
    nextRunAt: null, running: false, lastRunAt: null, lastRunStatus: null, lastRunError: null, parameterValues: {} };
  const launches: Array<{ agentId: string; additionalInstructions?: string;
    workflowParameterValues?: Record<string, string>; upstreamAgentResults?: Array<{ agentId: string }> }> = [];
  const completions = new Map<string, () => void>();
  await page.route("**/api/projects", (route) => route.fulfill({ json: {
    projects: [{ id: content.projectId, directoryPath: content.directoryPath }]
  } }));
  await page.route("**/api/agents/projects/actual", (route) => route.fulfill({ json: content }));
  await page.route(`**/api/agents/projects/${content.projectId}`, (route) => route.fulfill({ json: content }));
  await page.route(`**/api/agents/projects/${content.projectId}/workflow/schedule`, (route) => route.fulfill({ json: schedule }));
  await page.route(`**/api/agents/projects/${content.projectId}/agents/run`, async (route) => {
    const request = route.request().postDataJSON() as typeof launches[number];
    launches.push(request);
    const agent = content.agents.find(({ id }) => id === request.agentId)!;
    agent.executionStatus = "running";
    await new Promise<void>((resolve) => completions.set(agent.id, resolve));
    const answer = JSON.stringify({ status: "success", items: [{ content: `Résultat ${agent.name}` }],
      nextAgentIds: agent.nextAgentIds, isMultiSelectionAllowed: false, isMultiSelectionThreaded: false, notes: null });
    agent.hasSession = true;
    agent.executionStatus = "idle";
    agent.conversation = [{ role: "agent", content: answer }];
    agent.threads = [{ id: `${agent.id}-thread`, conversation: agent.conversation }];
    await route.fulfill({ json: { answer, hasSession: true, conversation: agent.conversation,
      threads: agent.threads } satisfies AgentRunResult });
  });
  await page.goto(`/?project=${content.projectId}`);
  const card = (id: string) => page.locator(`[data-workflow-agent-id="${id}"] .agent-card`);
  await expect(card("events")).toBeVisible();
  return { content, card, launches, finish: (id: string) => completions.get(id)!() };
}

test("parallel branches have exact connections, stable columns and a shared join after reload", async ({ page }, testInfo) => {
  await openParallelWorkflow(page);
  for (const reload of [false, true]) {
    if (reload) await page.reload();
    const levels = page.locator(".agent-project__workflow-level");
    await expect(levels).toHaveCount(4);
    await expect(levels.nth(0).locator("[data-workflow-agent-id]")).toHaveCount(2);
    await expect(levels.nth(1).locator("[data-workflow-agent-id]")).toHaveCount(2);
    await expect(levels.nth(2).locator("[data-workflow-agent-id]")).toHaveAttribute("data-workflow-agent-id", "summary");
    const paths = page.locator(".agent-project__connections > path");
    await expect(paths).toHaveCount(5);
    expect(await paths.evaluateAll((elements) => elements.map((element) => [
      element.getAttribute("data-workflow-source"), element.getAttribute("data-workflow-target")
    ]).sort())).toEqual([["calendar", "summary"], ["events", "calendar"], ["research", "writer"],
      ["summary", "publish"], ["writer", "summary"]]);
    await expect.poll(() => paths.evaluateAll((elements) => elements.every((element) => Boolean(element.getAttribute("d"))))).toBe(true);
    const geometry = await page.locator("[data-workflow-agent-id]").evaluateAll((elements) => Object.fromEntries(elements.map((element) => {
      const rect = element.getBoundingClientRect();
      return [element.getAttribute("data-workflow-agent-id"), { x: rect.x, y: rect.y, width: rect.width }];
    })));
    if (testInfo.project.use.viewport!.width > 800) {
      expect(geometry.events.y).toBe(geometry.research.y);
      expect(geometry.events.x).toBe(geometry.calendar.x);
      expect(geometry.research.x).toBe(geometry.writer.x);
      expect(geometry.summary.width).toBeGreaterThan(geometry.events.width * 1.9);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const researcher = page.locator('[data-workflow-agent-id="research"] .agent-card');
    const heading = await researcher.getByRole("heading", { name: "Enquêteur", exact: true }).boundingBox();
    expect(heading!.height).toBeLessThan(40);
    const model = await researcher.getByText("gpt-5.6-terra", { exact: true }).boundingBox();
    expect(model!.height).toBeLessThan(25);
  }
  await page.screenshot({ path: testInfo.outputPath("parallel-workflow.png"), fullPage: true });
});

test("start all roots preserves manual instructions and joins only after both branches finish", async ({ page }) => {
  const { card, launches, finish } = await openParallelWorkflow(page);
  const start = page.getByRole("button", { name: "Lancer les 2 points d’entrée", exact: true });
  await expect(start).toBeDisabled();
  await page.getByRole("textbox", { name: "Période", exact: true }).fill("2026-09-06");
  await card("events").getByRole("textbox", { name: "Précisions", exact: true }).fill("Agenda personnel");
  await card("research").getByRole("textbox", { name: "Précisions", exact: true }).fill("Sources locales");
  await start.click();
  await expect.poll(() => launches.map(({ agentId }) => agentId).sort()).toEqual(["events", "research"]);
  expect(launches.find(({ agentId }) => agentId === "events")!.additionalInstructions).toBe("Agenda personnel");
  expect(launches.find(({ agentId }) => agentId === "research")!.additionalInstructions).toBe("Sources locales");
  expect(launches.map(({ workflowParameterValues }) => workflowParameterValues)).toEqual([
    { period: "2026-09-06" }, { period: "2026-09-06" }
  ]);
  await expect(page.locator(".agent-project__tab-actions").getByRole("checkbox")).not.toBeChecked();
  finish("events");
  await card("events").getByRole("button", { name: "Continuer", exact: true }).click();
  await expect.poll(() => launches.map(({ agentId }) => agentId)).toContain("calendar");
  finish("calendar");
  const calendarContinue = card("calendar").getByRole("button", { name: "Continuer", exact: true });
  await expect(calendarContinue).toBeDisabled();
  expect(launches.some(({ agentId }) => agentId === "summary")).toBe(false);
  finish("research");
  await card("research").getByRole("button", { name: "Continuer", exact: true }).click();
  await expect.poll(() => launches.map(({ agentId }) => agentId)).toContain("writer");
  finish("writer");
  await expect(calendarContinue).toBeEnabled();
  await calendarContinue.click();
  await expect.poll(() => launches.filter(({ agentId }) => agentId === "summary").length).toBe(1);
  expect(launches.find(({ agentId }) => agentId === "summary")!.upstreamAgentResults?.map(({ agentId }) => agentId).sort())
    .toEqual(["calendar", "writer"]);
  finish("summary");
  await expect(card("summary").getByText("Résultat Synthèse", { exact: true })).toBeVisible();
  expect(launches.some(({ agentId }) => agentId === "publish")).toBe(false);
});
