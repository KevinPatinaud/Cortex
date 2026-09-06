import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import type { AgentConversationMessage, AgentProject, WorkflowSchedule } from "../../src/front/services/agentApi.ts";
import type { AgentResponsePayload } from "../../src/shared/AgentResponse.ts";

async function openResponseChoices(page: Page, multiple: boolean) {
  const response = (historical: boolean): AgentConversationMessage => ({
    role: "agent",
    content: JSON.stringify({
      status: "success",
      items: [
        { content: historical ? "Ancien résultat A" : "Premier résultat avec [une référence](https://example.test/reference)." },
        { content: historical ? "Ancien résultat B" : "Second résultat **à comparer**." }
      ],
      isMultiSelectionAllowed: multiple,
      isMultiSelectionThreaded: false,
      nextAgentIds: [],
      notes: null
    } satisfies AgentResponsePayload)
  });
  const conversation = [response(true), response(false)];
  const content: AgentProject = {
    projectId: "selection-audit",
    directoryPath: "C:/audit/Choix de résultats",
    engine: "codex",
    workflowResumable: false,
    workflowParameterValues: {},
    parameters: [],
    instructions: { fileName: "AGENTS.md", content: "Comparer les résultats proposés." },
    agents: [{
      id: "choices", name: "Comparateur", description: "Propose plusieurs résultats.",
      prompt: "Présente deux résultats.", nextAgentIds: [], inputMode: "aggregate",
      hasSession: true, executionStatus: "idle", conversation,
      threads: [{ id: "choices-thread", conversation }]
    }]
  };
  const schedule: WorkflowSchedule = {
    cron: "0 9 * * *", enabled: false, timezone: "Europe/Paris", nextRunAt: null,
    running: false, lastRunAt: null, lastRunStatus: null, lastRunError: null, parameterValues: {}
  };
  await page.route("**/api/projects", (route) => route.fulfill({ json: {
    projects: [{ id: content.projectId, directoryPath: content.directoryPath }]
  } }));
  await page.route("**/api/agents/projects/actual", (route) => route.fulfill({ json: content }));
  await page.route(`**/api/agents/projects/${content.projectId}`, (route) => route.fulfill({ json: content }));
  await page.route(`**/api/agents/projects/${content.projectId}/workflow/schedule`, (route) => route.fulfill({ json: schedule }));
  await page.goto(`/?project=${content.projectId}`);
  const card = page.locator(".agent-card");
  await expect(card.getByRole("heading", { name: "Comparateur", exact: true })).toBeVisible();
  const history = card.locator(".agent-card__conversation-message").first();
  await expect(history.getByText("Ancien résultat A", { exact: true })).toBeVisible();
  await expect(history.locator("button, input")).toHaveCount(0);
  const link = card.getByRole("link", { name: "une référence", exact: true });
  await expect(link).toHaveAttribute("href", "https://example.test/reference");
  expect(await link.evaluate((element) => element.closest("button, label"))).toBeNull();
  return card;
}

test("single response choices remain exclusive and Markdown links stay independent", async ({ page }) => {
  const card = await openResponseChoices(page, false);
  const choices = card.getByRole("radio");
  await expect(choices).toHaveCount(2);
  await expect(choices.first()).toBeChecked();
  await expect(choices.last()).not.toBeChecked();
  await choices.last().focus();
  await page.keyboard.press("Space");
  await expect(choices.last()).toBeChecked();
  await expect(choices.first()).not.toBeChecked();
  await page.keyboard.press("Space");
  await expect(choices.last()).toBeChecked();
  await page.keyboard.press("ArrowLeft");
  await expect(choices.first()).toBeChecked();
  await expect(choices.last()).not.toBeChecked();
  const accessibility = await new AxeBuilder({ page }).include(".agent-card")
    .withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(accessibility.violations).toEqual([]);
});

test("multiple response choices can be excluded and restored independently", async ({ page }) => {
  const card = await openResponseChoices(page, true);
  const choices = card.getByRole("checkbox");
  await expect(choices).toHaveCount(2);
  await expect(choices.first()).toBeChecked();
  await expect(choices.last()).toBeChecked();
  await choices.first().uncheck();
  await expect(choices.first()).not.toBeChecked();
  await expect(choices.last()).toBeChecked();
  await choices.last().uncheck();
  await expect(choices.first()).not.toBeChecked();
  await expect(choices.last()).not.toBeChecked();
  await choices.first().check();
  await expect(choices.first()).toBeChecked();
  await expect(choices.last()).not.toBeChecked();
});
