import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { randomUUID } from "node:crypto";
import type {
  AgentProject,
  EditableAgentDefinition,
  EditableAgentProject,
  ProjectReview,
  ReviewProjectInput
} from "../../src/front/services/agentApi.ts";

const initialInstructions = "# Journal\n\nPréparer et publier les sujets du jour.";
const proposedInstructions = "# Journal hebdomadaire\n\nFaire valider les sources avant toute publication.";
const proposedMission = "Rédige une édition hebdomadaire documentée puis transmets-la au validateur.";
const newValidator = {
  name: "Validateur",
  description: "Vérifie les sources avant la publication.",
  prompt: "Contrôle chaque source et renvoie les corrections au rédacteur avant publication.",
  model: "",
  reasoningEffort: ""
};

async function openProject(page: Page, request: APIRequestContext) {
  const name = `review-proposal-${randomUUID().slice(0, 8)}`;
  const created = await request.post("/api/projects/create", {
    data: { name, engine: "codex", generationMode: "empty", instructions: initialInstructions }
  });
  expect(created.status()).toBe(201);
  const { project } = await created.json() as { project: { id: string; directoryPath: string } };
  const seeded = await request.put(`/api/agents/projects/${project.id}`, {
    data: {
      name,
      engine: "codex",
      instructions: initialInstructions,
      agents: [
        { name: "Rédacteur", description: "Rédige les sujets retenus.", prompt: "Rédige les sujets du jour.", model: "gpt-5.6-sol", reasoningEffort: "high" },
        { name: "Publication automatique", description: "Publie immédiatement.", prompt: "Publie le texte reçu.", model: "gpt-5.6-luna", reasoningEffort: "low" },
        { name: "Veille", description: "Recherche les sujets.", prompt: "Recherche les sujets et conserve leurs sources.", model: "gpt-5.6-terra", reasoningEffort: "medium" }
      ]
    } satisfies EditableAgentProject
  });
  expect(seeded.status()).toBe(200);
  const saved = await seeded.json() as AgentProject;
  await page.goto(`/?project=${project.id}`);
  await page.getByRole("button", { name: "Modifier le projet", exact: true }).click();
  await expect(page.getByRole("textbox", { name: /Mission/ })).toBeVisible();
  return { name, project, saved };
}

function dialogFor(page: Page) {
  return page.getByRole("dialog", { name: "Revue globale du projet", exact: true });
}

async function openReview(page: Page) {
  await page.getByRole("button", { name: "Revue du projet", exact: true }).click();
  const dialog = dialogFor(page);
  await expect(dialog).toBeVisible();
  return dialog;
}

async function sendMessage(page: Page, content: string) {
  const dialog = dialogFor(page);
  await dialog.getByRole("textbox", { name: "Votre message", exact: true }).fill(content);
  await dialog.getByRole("button", { name: "Envoyer", exact: true }).click();
}

function asEditable(agent: AgentProject["agents"][number]): EditableAgentDefinition {
  return {
    id: agent.id, name: agent.name, description: agent.description, prompt: agent.prompt,
    ...(agent.model ? { model: agent.model } : {}),
    ...(agent.reasoningEffort ? { reasoningEffort: agent.reasoningEffort } : {})
  };
}

function completeProposal(saved: AgentProject): ProjectReview {
  const writer = saved.agents.find((agent) => agent.name === "Rédacteur")!;
  const publisher = saved.agents.find((agent) => agent.name === "Publication automatique")!;
  return {
    assessment: "needs_attention",
    summary: "Je propose une édition hebdomadaire avec un contrôle des sources.",
    findings: [],
    proposal: {
      title: "Ajouter une validation éditoriale",
      description: "Adapter les instructions et remplacer la publication automatique par une validation.",
      changes: [
        { type: "update_instructions", instructions: proposedInstructions },
        { type: "update_agent", agentKey: writer.id, updates: { prompt: proposedMission, description: "Rédige l’édition hebdomadaire." } },
        { type: "add_agent", agentKey: "new:validator", agent: newValidator },
        { type: "remove_agent", agentKey: publisher.id }
      ]
    }
  };
}

function instructionsProposal(title: string, instructions = proposedInstructions): ProjectReview {
  return {
    assessment: "needs_attention",
    summary: `Évolution proposée : ${title}.`,
    findings: [],
    proposal: {
      title,
      description: "Préciser les instructions partagées du projet.",
      changes: [{ type: "update_instructions", instructions }]
    }
  };
}

async function readSaved(request: APIRequestContext, projectId: string) {
  const response = await request.get(`/api/agents/projects/${projectId}`);
  expect(response.status()).toBe(200);
  return await response.json() as AgentProject;
}

test("review proposals show exact changes and persist them only after explicit approval", async ({ page, request }, testInfo) => {
  const { name, project, saved } = await openProject(page, request);
  const proposal = completeProposal(saved);
  const reviewRequests: ReviewProjectInput[] = [];
  const saveRequests: EditableAgentProject[] = [];
  await page.route(`**/api/agents/projects/${project.id}`, async (route) => {
    if (route.request().method() === "PUT") saveRequests.push(route.request().postDataJSON());
    await route.fallback();
  });
  await page.route(`**/api/agents/projects/${project.id}/review`, async (route) => {
    reviewRequests.push(route.request().postDataJSON());
    await route.fulfill({ json: reviewRequests.length < 3 ? proposal : {
      assessment: "healthy", summary: "La validation des sources est maintenant configurée.", findings: []
    } });
  });
  const dialog = await openReview(page);
  await dialog.getByRole("button", { name: "Analyser le projet", exact: true }).click();
  await expect(dialog.getByRole("heading", { name: proposal.proposal!.title, exact: true })).toBeVisible();
  const approval = dialog.getByRole("button", { name: "Appliquer et enregistrer", exact: true });
  await expect(approval).toBeEnabled();
  const instructionChange = dialog.locator(".project-review__changes > li").filter({ hasText: "Instructions projet" });
  await instructionChange.locator("summary").click();
  await expect(instructionChange.getByText("Avant", { exact: true })).toBeVisible();
  await expect(instructionChange.getByText("Après", { exact: true })).toBeVisible();
  await expect(instructionChange.locator("pre").nth(0)).toHaveText(initialInstructions);
  await expect(instructionChange.locator("pre").nth(1)).toHaveText(proposedInstructions);
  expect(saveRequests).toEqual([]);
  expect((await readSaved(request, project.id)).agents).toEqual(saved.agents);
  expect((await readSaved(request, project.id)).instructions.content).toBe(initialInstructions);

  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await expect.poll(() => dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  const accessibility = await new AxeBuilder({ page }).include("dialog[open]").withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(accessibility.violations).toEqual([]);
  if (["chromium-390", "chromium-1440"].includes(testInfo.project.name)) {
    await instructionChange.scrollIntoViewIfNeeded();
    await testInfo.attach("proposal-before-approval", {
      body: await page.screenshot({ path: testInfo.outputPath("project-review-proposal.png") }), contentType: "image/png"
    });
    await instructionChange.locator("summary").click();
    await approval.scrollIntoViewIfNeeded();
    await expect(approval).toBeInViewport();
    await testInfo.attach("proposal-approval-actions", {
      body: await page.screenshot({ path: testInfo.outputPath("project-review-proposal-actions.png") }), contentType: "image/png"
    });
  }

  await sendMessage(page, "oui");
  await expect.poll(() => reviewRequests.length).toBe(2);
  await expect(dialog.getByRole("textbox", { name: "Votre message", exact: true })).toHaveValue("");
  expect(reviewRequests[1].currentProposal).toEqual(proposal.proposal);
  expect(saveRequests).toEqual([]);
  expect((await readSaved(request, project.id)).instructions.content).toBe(initialInstructions);
  await expect(approval).toHaveCount(1);
  await approval.click();
  await expect(dialog.getByText("Modifications appliquées et enregistrées.", { exact: true })).toBeVisible();
  await expect(dialog).toBeVisible();
  expect(saveRequests).toHaveLength(1);
  const writer = saved.agents.find((agent) => agent.name === "Rédacteur")!;
  const observer = saved.agents.find((agent) => agent.name === "Veille")!;
  expect(saveRequests[0]).toEqual({
    name, engine: "codex", instructions: proposedInstructions,
    agents: [
      ...saved.agents.filter((agent) => agent.name !== "Publication automatique").map((agent) => agent.id === writer.id
        ? { ...asEditable(writer), description: "Rédige l’édition hebdomadaire.", prompt: proposedMission }
        : asEditable(agent)),
      { name: newValidator.name, description: newValidator.description, prompt: newValidator.prompt }
    ]
  });
  const after = await readSaved(request, project.id);
  expect(after.instructions.content).toBe(proposedInstructions);
  expect(after.agents.map((agent) => agent.name).sort()).toEqual(["Rédacteur", "Validateur", "Veille"]);
  expect(after.agents.find((agent) => agent.id === writer.id)).toMatchObject({ prompt: proposedMission, model: writer.model, reasoningEffort: writer.reasoningEffort });
  expect(after.agents.find((agent) => agent.id === observer.id)).toMatchObject({ ...asEditable(observer) });
  expect(after.agents.some((agent) => agent.name === "Publication automatique")).toBe(false);

  await sendMessage(page, "Expliquez comment fonctionne cette validation.");
  await expect(dialog.getByText("La validation des sources est maintenant configurée.", { exact: true })).toBeVisible();
  const followup = reviewRequests[2];
  expect(followup.instructions).toBe(proposedInstructions);
  expect(followup.agents.map((agent) => agent.name).sort()).toEqual(["Rédacteur", "Validateur", "Veille"]);
  const history = JSON.stringify(followup.conversation);
  expect(history).toContain("applied");
  expect(history).not.toContain(proposedMission);
  expect(history).not.toContain(newValidator.prompt);
  expect(saveRequests).toHaveLength(1);
  await dialog.getByRole("button", { name: "Fermer", exact: true }).first().click();
  await expect(page.getByRole("button", { name: "Enregistrer et fermer", exact: true })).toBeDisabled();
  await page.reload();
  await page.getByRole("button", { name: "Modifier le projet", exact: true }).click();
  await expect(page.locator(".project-editor__recovery")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Enregistrer et fermer", exact: true })).toBeDisabled();
  await expect(page.locator(".agent-library__identity strong")).toHaveText(after.agents.map((agent) => agent.name));
  await page.getByRole("button", { name: "Instructions projet", exact: true }).click();
  await expect(page.locator(".instructions-editor textarea")).toHaveValue(proposedInstructions);
});

test("rejecting and refining proposals never saves and only the latest proposal remains actionable", async ({ page, request }) => {
  const { project, saved } = await openProject(page, request);
  const responses = [
    instructionsProposal("Passer au rythme hebdomadaire"),
    instructionsProposal("Conserver une validation manuelle"),
    instructionsProposal("Préparer une édition mensuelle", "Préparer une édition mensuelle après validation.")
  ];
  let reviewCount = 0;
  let saveCount = 0;
  await page.route(`**/api/agents/projects/${project.id}`, async (route) => {
    if (route.request().method() === "PUT") saveCount++;
    await route.fallback();
  });
  await page.route(`**/api/agents/projects/${project.id}/review`, (route) => route.fulfill({ json: responses[reviewCount++] }));
  const dialog = await openReview(page);
  await sendMessage(page, "Proposez une évolution du rythme.");
  await expect(dialog.getByRole("heading", { name: responses[0].proposal!.title, exact: true })).toBeVisible();
  await dialog.getByRole("button", { name: "Refuser la proposition", exact: true }).click();
  await expect(dialog.getByText(/Proposition refusée/)).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Appliquer et enregistrer", exact: true })).toHaveCount(0);
  await sendMessage(page, "Je préfère conserver le choix manuel.");
  await expect(dialog.getByRole("heading", { name: responses[1].proposal!.title, exact: true })).toBeVisible();
  await sendMessage(page, "Affinez cette proposition pour un rythme mensuel.");
  await expect(dialog.getByRole("heading", { name: responses[2].proposal!.title, exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Appliquer et enregistrer", exact: true })).toHaveCount(1);
  const latest = dialog.locator(".project-review__proposal").filter({ hasText: responses[2].proposal!.title });
  await expect(latest.getByRole("button", { name: "Appliquer et enregistrer", exact: true })).toBeEnabled();
  expect(saveCount).toBe(0);
  const after = await readSaved(request, project.id);
  expect(after.instructions).toEqual(saved.instructions);
  expect(after.agents).toEqual(saved.agents);
});

test("editing the draft makes a proposal stale until a new review uses the current draft", async ({ page, request }) => {
  const { project, saved } = await openProject(page, request);
  const requests: ReviewProjectInput[] = [];
  let saveCount = 0;
  await page.route(`**/api/agents/projects/${project.id}`, async (route) => {
    if (route.request().method() === "PUT") saveCount++;
    await route.fallback();
  });
  await page.route(`**/api/agents/projects/${project.id}/review`, async (route) => {
    requests.push(route.request().postDataJSON());
    await route.fulfill({ json: instructionsProposal(`Adapter les instructions ${requests.length}`) });
  });
  const dialog = await openReview(page);
  await sendMessage(page, "Proposez des instructions hebdomadaires.");
  await expect(dialog.getByRole("button", { name: "Appliquer et enregistrer", exact: true })).toBeEnabled();
  await dialog.getByRole("button", { name: "Fermer", exact: true }).first().click();
  const selectedPrompt = "Conserver cette mission personnalisée dans le brouillon.";
  await page.getByRole("textbox", { name: /Mission/ }).fill(selectedPrompt);
  await openReview(page);
  await expect(dialog.getByRole("button", { name: "Appliquer et enregistrer", exact: true })).toBeDisabled();
  await expect(dialog.getByText(/brouillon a évolué/).first()).toBeVisible();
  expect(saveCount).toBe(0);
  await sendMessage(page, "Tenez compte de ma dernière modification.");
  await expect(dialog.getByRole("heading", { name: "Adapter les instructions 2", exact: true })).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Appliquer et enregistrer", exact: true })).toBeEnabled();
  expect(requests[1].agents.some((agent) => agent.prompt === selectedPrompt)).toBe(true);
  expect(saveCount).toBe(0);
  expect((await readSaved(request, project.id)).agents).toEqual(saved.agents);
});

test("a failed approval preserves the proposal, composer and draft and can be retried", async ({ page, request }) => {
  const { project, saved } = await openProject(page, request);
  const proposal = completeProposal(saved);
  let saveCount = 0;
  let reviewCount = 0;
  const failure = "L’enregistrement a échoué. Réessayez sans perdre votre proposition.";
  await page.route(`**/api/agents/projects/${project.id}`, async (route) => {
    if (route.request().method() === "PUT" && ++saveCount === 1) {
      await route.fulfill({ status: 503, json: { error: failure } });
      return;
    }
    await route.fallback();
  });
  await page.route(`**/api/agents/projects/${project.id}/review`, async (route) => {
    reviewCount++;
    await route.fulfill({ json: proposal });
  });
  const initialPrompt = await page.getByRole("textbox", { name: /Mission/ }).inputValue();
  const dialog = await openReview(page);
  await sendMessage(page, "Ajoutez une validation avant publication.");
  const approval = dialog.getByRole("button", { name: "Appliquer et enregistrer", exact: true });
  await expect(approval).toBeEnabled();
  const unsentMessage = "Après cette évolution, précisez le rôle du validateur.";
  await dialog.getByRole("textbox", { name: "Votre message", exact: true }).fill(unsentMessage);
  await approval.click();
  await expect(dialog.getByRole("alert")).toContainText(failure);
  await expect(approval).toBeEnabled();
  await expect(dialog.getByRole("textbox", { name: "Votre message", exact: true })).toHaveValue(unsentMessage);
  expect(saveCount).toBe(1);
  expect(reviewCount).toBe(1);
  const failedSave = await readSaved(request, project.id);
  expect(failedSave.agents).toEqual(saved.agents);
  expect(failedSave.instructions).toEqual(saved.instructions);
  await dialog.getByRole("button", { name: "Fermer", exact: true }).first().click();
  await expect(page.getByRole("textbox", { name: /Mission/ })).toHaveValue(initialPrompt);
  await openReview(page);
  await expect(dialog.getByRole("heading", { name: proposal.proposal!.title, exact: true })).toBeVisible();
  await expect(dialog.getByRole("textbox", { name: "Votre message", exact: true })).toHaveValue(unsentMessage);
  await approval.click();
  await expect(dialog.getByText("Modifications appliquées et enregistrées.", { exact: true })).toBeVisible();
  await expect(dialog.getByRole("alert")).toHaveCount(0);
  await expect(dialog.getByRole("textbox", { name: "Votre message", exact: true })).toHaveValue(unsentMessage);
  expect(saveCount).toBe(2);
  expect(reviewCount).toBe(1);
  expect((await readSaved(request, project.id)).instructions.content).toBe(proposedInstructions);
});
