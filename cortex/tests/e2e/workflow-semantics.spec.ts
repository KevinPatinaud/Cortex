import { expect, test, type Page } from "@playwright/test";
import type { AgentDefinition, AgentProject, AgentRunResult, WorkflowSchedule } from "../../src/front/services/agentApi.ts";
import type { AgentResponsePayload } from "../../src/shared/AgentResponse.ts";

function definition(id: string, name: string, nextAgentIds: string[], inputMode: AgentDefinition["inputMode"] = "separate"): AgentDefinition {
  return { id, name, nextAgentIds, inputMode, description: `Mission de ${name}.`, prompt: `Exécuter ${name}.`,
    hasSession: false, executionStatus: "idle", conversation: [], threads: [] };
}

function response(nextAgentIds: string[], items = ["Résultat de la recherche"], threaded = false): AgentResponsePayload {
  return { status: "success", items: items.map((content) => ({ content })), nextAgentIds,
    isMultiSelectionAllowed: threaded, isMultiSelectionThreaded: threaded, notes: null };
}

function applyResponses(agent: AgentDefinition, responses: AgentResponsePayload[]): AgentRunResult {
  agent.threads = responses.map((answer, index) => ({ id: `${agent.id}-instance-${index + 1}`,
    conversation: [{ role: "agent", content: JSON.stringify(answer) }] }));
  agent.conversation = agent.threads[0]?.conversation ?? [];
  agent.hasSession = agent.threads.length > 0;
  agent.executionStatus = "idle";
  return { answer: agent.conversation.at(-1)?.content ?? "", hasSession: agent.hasSession,
    conversation: agent.conversation, threads: agent.threads };
}

async function openWorkflow(page: Page, agents: AgentDefinition[], answers: Record<string, AgentResponsePayload[]> = {}) {
  const content: AgentProject = {
    projectId: "workflow-semantics", directoryPath: "C:/tests/Sémantique du workflow", engine: "codex",
    workflowResumable: false, workflowParameterValues: {}, parameters: [],
    instructions: { fileName: "AGENTS.md", content: "Afficher les choix de branches et les instances réellement préparées." },
    agents
  };
  const schedule: WorkflowSchedule = { cron: "0 9 * * *", enabled: false, timezone: "Europe/Paris",
    nextRunAt: null, running: false, lastRunAt: null, lastRunStatus: null, lastRunError: null, parameterValues: {} };
  const launches: Array<{ agentId: string; upstreamAgentResults?: Array<{ agentId: string; selectedItemIndexes: number[] }> }> = [];
  await page.route("**/api/projects", (route) => route.fulfill({ json: {
    projects: [{ id: content.projectId, directoryPath: content.directoryPath }]
  } }));
  await page.route("**/api/agents/projects/actual", (route) => route.fulfill({ json: content }));
  await page.route(`**/api/agents/projects/${content.projectId}`, (route) => route.fulfill({ json: content }));
  await page.route(`**/api/agents/projects/${content.projectId}/workflow/schedule`, (route) => route.fulfill({ json: schedule }));
  await page.route(`**/api/agents/projects/${content.projectId}/agents/run`, async (route) => {
    const input = route.request().postDataJSON() as typeof launches[number];
    launches.push(input);
    const agent = content.agents.find(({ id }) => id === input.agentId)!;
    expect(answers[agent.id], "Every agent execution must have an explicit mock response").toBeDefined();
    await route.fulfill({ json: applyResponses(agent, answers[agent.id]) });
  });
  await page.goto(`/?project=${content.projectId}`);
  const step = (id: string) => page.locator(`[data-workflow-agent-id="${id}"]`);
  const card = (id: string) => step(id).locator(".agent-card");
  const routing = (id: string) => step(id).locator("[data-workflow-routing]");
  const edge = (source: string, target: string) => page.locator(
    `svg path[data-workflow-source="${source}"][data-workflow-target="${target}"]`
  );
  await expect(card(agents[0].id)).toBeVisible();
  return { content, card, routing, edge, launches };
}

function choices() {
  return [definition("source", "Sélecteur de branches", ["left", "right"]),
    definition("left", "Analyse agenda", []), definition("right", "Rédaction actualité", [])];
}

for (const selected of [["left"], ["left", "right"]]) {
  test(`conditional choices become ${selected.length === 1 ? "one selected branch" : "parallel branches"} and survive reload`, async ({ page }, testInfo) => {
    const { card, routing, edge, launches } = await openWorkflow(page, choices(), { source: [response(selected)] });
    await expect(routing("source")).toHaveAttribute("data-workflow-routing", "conditional");
    await expect(routing("source")).toContainText("Branches conditionnelles");
    for (const target of ["left", "right"]) await expect(edge("source", target)).toHaveAttribute("data-workflow-status", "pending");
    await card("source").locator(".agent-card__run-button").click();
    await expect.poll(() => launches.map(({ agentId }) => agentId)).toEqual(["source"]);
    for (const reload of [false, true]) {
      if (reload) await page.reload();
      await expect(routing("source")).toBeVisible();
      await expect(routing("source")).toHaveAttribute("data-workflow-routing", selected.length === 1 ? "selected-one" : "parallel");
      await expect(routing("source")).toContainText(selected.length === 1 ? "1 branche retenue sur 2" : "2 branches retenues ensemble");
      await expect(edge("source", "left")).toHaveAttribute("data-workflow-status", "selected");
      await expect(edge("source", "right")).toHaveAttribute("data-workflow-status", selected.length === 1 ? "inactive" : "selected");
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
    expect(launches).toHaveLength(1);
    await page.screenshot({ path: testInfo.outputPath(`workflow-${selected.length === 1 ? "conditional" : "parallel"}.png`), fullPage: true });
  });
}

test("disjoint routing from separate instances is not described as one parallel decision", async ({ page }) => {
  const agents = choices();
  applyResponses(agents[0], [response(["left"], ["Événement agenda"]), response(["right"], ["Sujet d’actualité"])]);
  const { routing, edge, launches } = await openWorkflow(page, agents);
  for (const reload of [false, true]) {
    if (reload) await page.reload();
    await expect(routing("source")).toHaveAttribute("data-workflow-routing", "per-instance");
    await expect(routing("source")).toContainText("Routage selon l’instance");
    await expect(routing("source")).not.toContainText("branches retenues ensemble");
    for (const target of ["left", "right"]) await expect(edge("source", target)).toHaveAttribute("data-workflow-status", "selected");
  }
  expect(launches).toHaveLength(0);
});

test("an explicit end of routing marks every unused branch as inactive", async ({ page }) => {
  const agents = choices();
  applyResponses(agents[0], [response([], ["Aucune suite applicable aujourd’hui"])]);
  const { routing, edge, launches } = await openWorkflow(page, agents);
  for (const reload of [false, true]) {
    if (reload) await page.reload();
    await expect(routing("source")).toHaveAttribute("data-workflow-routing", "none");
    await expect(routing("source")).toContainText("Aucune branche retenue");
    for (const target of ["left", "right"]) await expect(edge("source", target)).toHaveAttribute("data-workflow-status", "inactive");
  }
  expect(launches).toHaveLength(0);
});

test("selected threaded items update planned counts while completed instances and aggregation survive reload", async ({ page }, testInfo) => {
  const agents = [definition("source", "Détecteur d’événements", ["worker", "aggregate"]),
    definition("worker", "Analyse par événement", []), definition("aggregate", "Synthèse de tous les événements", [], "aggregate")];
  applyResponses(agents[0], [response(["worker", "aggregate"], ["Événement A", "Événement B", "Événement C"], true)]);
  const { card, edge, launches } = await openWorkflow(page, agents, {
    worker: [response([], ["Analyse de l’événement A"]), response([], ["Analyse de l’événement B"])],
    aggregate: [response([], ["Synthèse des événements A et B"])]
  });
  await expect(edge("source", "worker")).toHaveAttribute("data-workflow-instances", "3");
  await expect(edge("source", "aggregate")).not.toHaveAttribute("data-workflow-instances", /.+/);
  const selections = card("source").locator(".agent-card__conversation-response-choice");
  await expect(selections).toHaveCount(3);
  await expect(selections.nth(2)).toBeChecked();
  await selections.nth(2).uncheck();
  await expect(edge("source", "worker")).toHaveAttribute("data-workflow-instances", "2");
  await expect(edge("source", "aggregate")).not.toHaveAttribute("data-workflow-instances", /.+/);
  await card("source").getByRole("button", { name: "Continuer", exact: true }).click();
  await expect.poll(() => launches.map(({ agentId }) => agentId).sort()).toEqual(["aggregate", "worker"]);
  for (const launch of launches) {
    expect(launch.upstreamAgentResults).toEqual([{ agentId: "source", selectedItemIndexes: [0, 1] }]);
  }
  for (const reload of [false, true]) {
    if (reload) await page.reload();
    await expect(edge("source", "worker")).toHaveAttribute("data-workflow-instances", "2");
    await expect(edge("source", "aggregate")).not.toHaveAttribute("data-workflow-instances", /.+/);
    await expect(card("worker").locator(".agent-instance-card")).toHaveCount(2);
    await expect(card("worker").getByText("Analyse de l’événement A", { exact: true })).toBeVisible();
    await expect(card("worker").getByText("Analyse de l’événement B", { exact: true })).toBeVisible();
    await expect(card("aggregate").getByText("Synthèse des événements A et B", { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  expect(launches).toHaveLength(2);
  await page.screenshot({ path: testInfo.outputPath("workflow-instance-counts.png"), fullPage: true });
});

test("an active selected branch remains distinct from an unused conditional branch", async ({ page }) => {
  const agents = choices();
  applyResponses(agents[0], [response(["left"])]);
  agents[1].executionStatus = "running";
  agents[1].executionStartedAt = "2026-09-06T08:00:00.000Z";
  const { routing, edge, launches } = await openWorkflow(page, agents);
  await expect(routing("source")).toHaveAttribute("data-workflow-routing", "selected-one");
  await expect(edge("source", "left")).toHaveAttribute("data-workflow-status", "running");
  await expect(edge("source", "right")).toHaveAttribute("data-workflow-status", "inactive");
  expect(launches).toHaveLength(0);
});
