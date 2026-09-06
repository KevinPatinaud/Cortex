import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import type { ProjectReview, ReviewProjectAgent } from "../../src/front/services/agentApi.ts";

interface ReviewRequest {
  projectName: string;
  instructions: string;
  agents: ReviewProjectAgent[];
  message?: string;
  conversation?: Array<{ role: "user" | "assistant"; content: string }>;
}

const firstWish = "Je souhaite préparer une édition hebdomadaire avec une sélection des événements.";
const firstReview: ProjectReview = {
  assessment: "needs_attention",
  summary: "Une édition hebdomadaire peut réutiliser le rédacteur du projet.",
  findings: [{
    severity: "suggestion", scope: "instructions", agentKey: null,
    title: "Préciser le rythme de publication",
    description: "Les instructions actuelles ne définissent pas la période à couvrir.",
    recommendation: "Ajouter une période hebdomadaire et un choix explicite des événements."
  }]
};
const followupReview: ProjectReview = {
  assessment: "healthy",
  summary: "La sélection manuelle des événements reste compatible avec une édition hebdomadaire.",
  findings: []
};

async function openEditor(page: Page, request: APIRequestContext) {
  const response = await request.post("/api/projects/create", {
    data: {
      name: `review-${randomUUID().slice(0, 8)}`,
      engine: "codex",
      description: "Un rédacteur de test."
    }
  });
  expect(response.status()).toBe(201);
  const { project } = await response.json() as { project: { id: string; directoryPath: string } };
  const savedContent = await (await request.get(`/api/agents/projects/${project.id}`)).json();
  await page.goto(`/?project=${project.id}`);
  await page.getByRole("button", { name: "Modifier le projet", exact: true }).click();
  await expect(page.getByRole("textbox", { name: /Mission/ })).toBeVisible();
  return { project, savedContent };
}

function reviewDialog(page: Page) {
  return page.getByRole("dialog", { name: "Revue globale du projet", exact: true });
}

function reviewTrigger(page: Page) {
  return page.getByRole("button", { name: "Revue du projet", exact: true });
}

test("project review discusses wishes and follows up with completed history and the current unsaved draft", async ({ page, request }, testInfo) => {
  const { project, savedContent } = await openEditor(page, request);
  const requests: ReviewRequest[] = [];
  await page.route(`**/api/agents/projects/${project.id}/review`, (route) => {
    expect(route.request().method()).toBe("POST");
    requests.push(route.request().postDataJSON() as ReviewRequest);
    return route.fulfill({ json: requests.length === 1 ? firstReview : followupReview });
  });
  const mission = page.getByRole("textbox", { name: /Mission/ });
  const draftMission = "Prépare une édition hebdomadaire documentée.";
  await mission.fill(draftMission);
  await reviewTrigger(page).click();
  const dialog = reviewDialog(page);
  await expect(dialog).toBeVisible();
  const message = dialog.getByRole("textbox", { name: "Votre message", exact: true });
  const send = dialog.getByRole("button", { name: "Envoyer", exact: true });
  await expect(message).toBeFocused();
  await expect(send).toBeDisabled();
  if (["chromium-390", "chromium-1440"].includes(testInfo.project.name)) {
    await page.screenshot({ path: testInfo.outputPath("project-review-initial.png") });
  }
  await message.fill("   ");
  await expect(send).toBeDisabled();
  expect(requests).toHaveLength(0);
  await message.fill(firstWish);
  await send.click();
  await expect(dialog.getByText(firstReview.summary, { exact: true })).toBeVisible();
  await expect(dialog.getByRole("heading", { name: firstReview.findings[0].title, exact: true })).toBeVisible();
  await expect(dialog.getByText(firstReview.findings[0].recommendation, { exact: false })).toBeVisible();
  await expect(message).toHaveValue("");
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({
    message: firstWish,
    instructions: savedContent.instructions.content,
    agents: [{ key: savedContent.agents[0].id, prompt: draftMission }]
  });
  expect(requests[0].conversation ?? []).toEqual([]);

  await dialog.getByRole("button", { name: "Fermer", exact: true }).first().click();
  await expect(mission).toHaveValue(draftMission);
  const nextMission = "Prépare une édition hebdomadaire avec uniquement les événements sélectionnés.";
  await mission.fill(nextMission);
  await page.getByRole("textbox", { name: "Nom du projet", exact: true }).fill("Journal hebdomadaire");
  await page.getByRole("button", { name: "Instructions projet", exact: true }).click();
  const instructions = page.locator(".instructions-editor textarea");
  const nextInstructions = "# Journal hebdomadaire\n\nToujours conserver le choix manuel des événements.";
  await instructions.fill(nextInstructions);
  await reviewTrigger(page).click();
  await expect(dialog.getByText(firstWish, { exact: true })).toBeVisible();
  await expect(dialog.getByText(firstReview.summary, { exact: true })).toBeVisible();
  expect(requests).toHaveLength(1);
  const followup = "Je veux conserver la sélection manuelle des événements. Que faut-il adapter ?";
  await message.fill(followup);
  await send.click();
  await expect(dialog.getByText(followupReview.summary, { exact: true })).toBeVisible();
  expect(requests).toHaveLength(2);
  expect(requests[1]).toMatchObject({
    projectName: "Journal hebdomadaire", instructions: nextInstructions,
    agents: [{ key: savedContent.agents[0].id, prompt: nextMission }], message: followup
  });
  expect(requests[1].conversation).toEqual([
    { role: "user", content: firstWish },
    { role: "assistant", content: JSON.stringify(firstReview) }
  ]);
  await dialog.getByRole("button", { name: "Fermer", exact: true }).first().click();
  await expect(instructions).toHaveValue(nextInstructions);
  await expect(page.getByRole("textbox", { name: "Nom du projet", exact: true })).toHaveValue("Journal hebdomadaire");
  const afterReview = await (await request.get(`/api/agents/projects/${project.id}`)).json();
  expect(afterReview.instructions.content).toBe(savedContent.instructions.content);
  expect(afterReview.agents).toEqual(savedContent.agents);
  await reviewTrigger(page).click();
  await expect(dialog.getByText(firstWish, { exact: true })).toBeVisible();
  await expect(dialog.getByText(followup, { exact: true })).toBeVisible();
  await expect(dialog.getByText(followupReview.summary, { exact: true })).toBeVisible();
  expect(requests).toHaveLength(2);
  if (["chromium-390", "chromium-1440"].includes(testInfo.project.name)) {
    await page.screenshot({ path: testInfo.outputPath("project-review-conversation.png") });
  }
});

test("a pending review survives closing and a failed wish can be retried without duplicate turns", async ({ page, request }) => {
  const { project } = await openEditor(page, request);
  const requests: ReviewRequest[] = [];
  let release!: () => void;
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const failure = "La revue est temporairement indisponible. Réessayez.";
  const followup = "Comment ajouter aussi une synthèse mensuelle ?";
  await page.route(`**/api/agents/projects/${project.id}/review`, async (route) => {
    requests.push(route.request().postDataJSON() as ReviewRequest);
    if (requests.length === 1) {
      await route.fulfill({ json: firstReview });
    } else if (requests.length === 2) {
      await pending;
      await route.fulfill({ status: 503, json: { error: failure } });
    } else {
      await route.fulfill({ json: followupReview });
    }
  });
  try {
    await reviewTrigger(page).click();
    const dialog = reviewDialog(page);
    const message = dialog.getByRole("textbox", { name: "Votre message", exact: true });
    const send = dialog.getByRole("button", { name: "Envoyer", exact: true });
    await message.fill(firstWish);
    await send.click();
    await expect(dialog.getByText(firstReview.summary, { exact: true })).toBeVisible();
    await message.fill(followup);
    await send.click();
    await expect.poll(() => requests.length).toBe(2);
    await expect(send).toBeDisabled();
    await expect(message).toHaveAttribute("readonly", "");
    await message.press("ControlOrMeta+Enter");
    await dialog.getByRole("button", { name: "Fermer", exact: true }).first().click();
    await expect(dialog).not.toBeVisible();
    await expect(reviewTrigger(page)).toBeEnabled();
    await reviewTrigger(page).click();
    await expect(dialog).toBeVisible();
    await expect(send).toBeDisabled();
    await expect(dialog.getByText(firstReview.summary, { exact: true })).toBeVisible();
    expect(requests).toHaveLength(2);
    await dialog.getByRole("button", { name: "Fermer", exact: true }).first().click();
    const failedResponse = page.waitForResponse((response) => response.url().endsWith(`/api/agents/projects/${project.id}/review`));
    release();
    expect((await failedResponse).status()).toBe(503);
    await reviewTrigger(page).click();
    await expect(dialog.getByRole("alert")).toHaveText(failure);
    await expect(message).toHaveValue(followup);
    await expect(dialog.getByText(firstReview.summary, { exact: true })).toBeVisible();
    await expect(send).toBeEnabled();
    expect(requests).toHaveLength(2);
    await message.press("ControlOrMeta+Enter");
    await expect(dialog.getByText(followupReview.summary, { exact: true })).toBeVisible();
    await expect(dialog.getByRole("alert")).toHaveCount(0);
    await expect(dialog.getByText(firstWish, { exact: true })).toHaveCount(1);
    await expect(dialog.getByText(followup, { exact: true })).toHaveCount(1);
    expect(requests).toHaveLength(3);
    expect(requests[2]).toEqual(requests[1]);
    expect(requests[2].conversation).toEqual([
      { role: "user", content: firstWish },
      { role: "assistant", content: JSON.stringify(firstReview) }
    ]);
  } finally {
    release();
    await page.unrouteAll({ behavior: "wait" });
  }
});

test("general project analysis remains available before a conversation", async ({ page, request }) => {
  const { project } = await openEditor(page, request);
  const requests: ReviewRequest[] = [];
  await page.route(`**/api/agents/projects/${project.id}/review`, (route) => {
    requests.push(route.request().postDataJSON() as ReviewRequest);
    return route.fulfill({ json: followupReview });
  });
  await reviewTrigger(page).click();
  const dialog = reviewDialog(page);
  const analyze = dialog.getByRole("button", { name: "Analyser le projet", exact: true });
  await expect(analyze).toBeEnabled();
  expect(requests).toHaveLength(0);
  await analyze.click();
  await expect(dialog.getByText(followupReview.summary, { exact: true })).toBeVisible();
  expect(requests).toHaveLength(1);
  expect(requests[0].message).toBeUndefined();
  expect(requests[0].conversation ?? []).toEqual([]);
  await expect(dialog.getByRole("textbox", { name: "Votre message", exact: true })).toBeEnabled();
  await dialog.getByRole("textbox", { name: "Votre message", exact: true }).fill("Quels agents dois-je ajouter ?");
  await dialog.getByRole("button", { name: "Envoyer", exact: true }).click();
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1].message).toBe("Quels agents dois-je ajouter ?");
  expect(requests[1].conversation).toEqual([{ role: "assistant", content: JSON.stringify(followupReview) }]);
});

test("project review keeps its composer reachable with long results and supports keyboard dismissal", async ({ page, request }, testInfo) => {
  const { project } = await openEditor(page, request);
  const longReview: ProjectReview = {
    ...firstReview,
    summary: "Voici les évolutions à envisager pour votre journal. ".repeat(8),
    findings: Array.from({ length: 8 }, (_, index) => ({
      ...firstReview.findings[0],
      title: `Évolution ${index + 1} : préciser les responsabilités`,
      description: "Les agents ont besoin d’instructions précises pour prendre en compte cette évolution. ".repeat(3),
      recommendation: "Documenter les étapes attendues et les informations à transmettre aux autres agents. ".repeat(3)
    }))
  };
  await page.route(`**/api/agents/projects/${project.id}/review`, (route) => route.fulfill({ json: longReview }));
  await reviewTrigger(page).click();
  const dialog = reviewDialog(page);
  const message = dialog.getByRole("textbox", { name: "Votre message", exact: true });
  await expect(message).toBeFocused();
  await message.fill(firstWish);
  await dialog.getByRole("button", { name: "Envoyer", exact: true }).click();
  await expect(dialog.getByRole("heading", { name: longReview.findings[7].title, exact: true })).toBeAttached();
  await expect(message).toBeEnabled();
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect.poll(() => dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  await message.scrollIntoViewIfNeeded();
  await expect(message).toBeInViewport();
  await message.fill("Ajouter aussi un résumé mensuel.");
  const send = dialog.getByRole("button", { name: "Envoyer", exact: true });
  await send.scrollIntoViewIfNeeded();
  await expect(send).toBeInViewport();
  const accessibility = await new AxeBuilder({ page }).include("dialog[open]").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(accessibility.violations).toEqual([]);
  await testInfo.attach(`project-review-${testInfo.project.name}`, { body: await page.screenshot(), contentType: "image/png" });
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(reviewTrigger(page)).toBeFocused();
  await reviewTrigger(page).press("Enter");
  await expect(message).toBeFocused();
  await expect(message).toHaveValue("Ajouter aussi un résumé mensuel.");
});
