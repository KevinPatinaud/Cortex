import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";
import type { AgentProject } from "../../src/front/services/agentApi.ts";
import type { WorkflowAuditRunDetail, WorkflowAuditRunPage } from "../../src/shared/WorkflowAudit.ts";

async function createWorkflow(request: APIRequestContext): Promise<AgentProject> {
  const name = `continue-${randomUUID().slice(0, 8)}`;
  const created = await request.post("/api/projects/create", {
    data: { name, engine: "codex", description: "Un workflow de test." }
  });
  expect(created.status()).toBe(201);
  const { project } = await created.json();
  const saved = await request.put(`/api/agents/projects/${project.id}`, {
    data: {
      name,
      engine: "codex",
      instructions: "Le géologiste choisit un continent, puis la plante et enfin le botaniste utilisent le résultat précédent.",
      agents: [
        { name: "1 Géologiste", description: "Choisit un continent.", prompt: "Choisis un continent." },
        { name: "2 Choix plante", description: "Choisit une plante du continent.", prompt: "Choisis une plante du continent reçu." },
        { name: "3 Agent botaniste", description: "Décrit la plante.", prompt: "Décris la plante reçue." }
      ]
    }
  });
  expect(saved.status()).toBe(200);
  const workflow = await saved.json() as AgentProject;
  expect(workflow.agents.map((agent) => agent.nextAgentIds)).toEqual([
    [workflow.agents[1].id], [workflow.agents[2].id], []
  ]);
  return workflow;
}

function agentCard(page: Page, name: string) {
  return page.locator(".agent-card").filter({ has: page.getByRole("heading", { name, exact: true }) });
}

async function auditedExecutions(request: APIRequestContext, projectId: string) {
  const response = await request.get(`/api/agents/projects/${projectId}/audit/runs`);
  expect(response.status()).toBe(200);
  const runs = await response.json() as WorkflowAuditRunPage;
  const details = await Promise.all(runs.items.map(async (run) => {
    const detail = await request.get(`/api/agents/projects/${projectId}/audit/runs/${run.id}`);
    expect(detail.status()).toBe(200);
    return await detail.json() as WorkflowAuditRunDetail;
  }));
  return details.flatMap((run) => run.executions).map(({ agentId, status }) => ({ agentId, status }))
    .sort((left, right) => left.agentId.localeCompare(right.agentId));
}

test("automatic mode announces mixed agents and preserves manual instructions", async ({ page, request }) => {
  const workflow = await createWorkflow(request);
  await page.goto(`/?project=${workflow.projectId}`);
  const globalMode = page.getByRole("checkbox", { name: /Exécution automatique de tous les agents$/ });
  const sourceCard = agentCard(page, workflow.agents[0].name);
  const instructions = sourceCard.getByRole("textbox", { name: "Précisions", exact: true });
  const draft = "Conserver ces précisions après un passage en automatique.";
  await instructions.fill(draft);
  await sourceCard.getByRole("switch").click();
  await expect(globalMode).toHaveAttribute("aria-checked", "mixed");
  await sourceCard.getByRole("switch").click();
  await expect(instructions).toHaveValue(draft);
  await expect(globalMode).not.toBeChecked();
  await globalMode.click();
  await expect(globalMode).toBeChecked();
  for (const agent of workflow.agents) {
    await expect(agentCard(page, agent.name).getByRole("switch")).toBeChecked();
  }
  await globalMode.click();
  await expect(instructions).toHaveValue(draft);
});

for (const reloadBeforeContinue of [false, true]) {
  test(`Continue runs automatic successors exactly once ${reloadBeforeContinue ? "after reload" : "in the same session"}`, async ({ page, request }) => {
    const workflow = await createWorkflow(request);
    const [source, ...successors] = workflow.agents;
    const launchedAgentIds: string[] = [];
    page.on("request", (outgoing) => {
      if (outgoing.method() === "POST" && outgoing.url().endsWith(`/api/agents/projects/${workflow.projectId}/agents/run`)) {
        launchedAgentIds.push(outgoing.postDataJSON().agentId);
      }
    });
    await page.goto(`/?project=${workflow.projectId}`);
    await expect(agentCard(page, source.name)).toBeVisible();
    await page.locator(".agent-project__tab-actions").getByRole("checkbox").click();
    await agentCard(page, source.name).getByRole("switch").click();
    await agentCard(page, source.name).getByRole("button", { name: "Lancer l’agent", exact: true }).click();
    const continueButton = agentCard(page, source.name).getByRole("button", { name: "Continuer", exact: true });
    await expect(continueButton).toBeEnabled();
    const sourceContent = await (await request.get(`/api/agents/projects/${workflow.projectId}`)).json() as AgentProject;
    const originalConversation = sourceContent.agents.find((agent) => agent.id === source.id)!.conversation;
    expect(originalConversation.filter((message) => message.role === "agent")).toHaveLength(1);

    if (reloadBeforeContinue) {
      await page.reload();
      await expect(continueButton).toBeEnabled();
    }
    for (const successor of successors) {
      await expect(agentCard(page, successor.name).getByRole("switch")).toBeChecked();
    }
    // Give browser effects time to settle: neither source completion nor reopening
    // a saved workflow may release a manual handoff without clicking Continue.
    await page.waitForTimeout(500);
    expect(launchedAgentIds).toEqual([source.id]);
    expect(await auditedExecutions(request, workflow.projectId)).toEqual([{ agentId: source.id, status: "succeeded" }]);

    await continueButton.click();
    for (const successor of successors) {
      await expect(agentCard(page, successor.name).getByText("Résultat vérifié du moteur simulé.", { exact: true })).toBeVisible();
    }
    await expect(continueButton).toHaveCount(0);
    expect(launchedAgentIds).toEqual(workflow.agents.map((agent) => agent.id));
    await expect.poll(() => auditedExecutions(request, workflow.projectId)).toEqual(
      workflow.agents.map((agent) => ({ agentId: agent.id, status: "succeeded" }))
        .sort((left, right) => left.agentId.localeCompare(right.agentId))
    );
    const completed = await (await request.get(`/api/agents/projects/${workflow.projectId}`)).json() as AgentProject;
    expect(completed.agents.find((agent) => agent.id === source.id)!.conversation).toEqual(originalConversation);
  });

  test(`Continue runs the next manual agent from the completed card ${reloadBeforeContinue ? "after reload" : "in the same session"}`, async ({ page, request }) => {
    const workflow = await createWorkflow(request);
    const [source, successor, finalAgent] = workflow.agents;
    const launches: { agentId: string; additionalInstructions?: string }[] = [];
    page.on("request", (outgoing) => {
      if (outgoing.method() === "POST" && outgoing.url().endsWith(`/api/agents/projects/${workflow.projectId}/agents/run`)) {
        launches.push(outgoing.postDataJSON());
      }
    });
    await page.goto(`/?project=${workflow.projectId}`);
    const sourceCard = agentCard(page, source.name);
    const successorCard = agentCard(page, successor.name);
    const finalCard = agentCard(page, finalAgent.name);
    const continueButton = sourceCard.getByRole("button", { name: "Continuer", exact: true });
    await sourceCard.getByRole("button", { name: "Lancer l’agent", exact: true }).click();
    await expect(continueButton).toBeEnabled();
    const sourceContent = await (await request.get(`/api/agents/projects/${workflow.projectId}`)).json() as AgentProject;
    const originalConversation = sourceContent.agents.find((agent) => agent.id === source.id)!.conversation;
    expect(originalConversation.filter((message) => message.role === "agent")).toHaveLength(1);

    if (reloadBeforeContinue) {
      await page.reload();
      await expect(continueButton).toBeEnabled();
    }
    for (const agent of workflow.agents) {
      await expect(agentCard(page, agent.name).getByRole("switch")).not.toBeChecked();
    }
    await expect(successorCard.getByRole("button", { name: "Lancer l’agent", exact: true })).toHaveCount(0);
    const additionalInstructions = "Choisis une plante à fleurs jaunes.";
    await successorCard.getByRole("textbox", { name: "Précisions", exact: true }).fill(additionalInstructions);
    await sourceCard.getByRole("textbox", { name: "Précisions", exact: true }).fill("Précisions réservées à une relance du géologiste.");
    await page.waitForTimeout(500);
    expect(launches.map(({ agentId }) => agentId)).toEqual([source.id]);

    await continueButton.click();
    await expect(successorCard.getByText("Résultat vérifié du moteur simulé.", { exact: true })).toBeVisible();
    await expect(continueButton).toHaveCount(0);
    await expect(successorCard.getByRole("button", { name: "Continuer", exact: true })).toBeEnabled();
    await expect(finalCard.getByRole("button", { name: "Lancer l’agent", exact: true })).toHaveCount(0);
    // A manual continuation releases only the next step, even once its result is ready.
    await page.waitForTimeout(500);
    expect(launches.map(({ agentId }) => agentId)).toEqual([source.id, successor.id]);
    expect(launches[1].additionalInstructions).toBe(additionalInstructions);
    await expect.poll(() => auditedExecutions(request, workflow.projectId)).toEqual(
      [source, successor].map((agent) => ({ agentId: agent.id, status: "succeeded" }))
        .sort((left, right) => left.agentId.localeCompare(right.agentId))
    );
    const completed = await (await request.get(`/api/agents/projects/${workflow.projectId}`)).json() as AgentProject;
    expect(completed.agents.find((agent) => agent.id === source.id)!.conversation).toEqual(originalConversation);
    expect(completed.agents.find((agent) => agent.id === finalAgent.id)!.hasSession).toBe(false);
  });
}
