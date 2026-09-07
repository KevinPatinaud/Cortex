import { expect, test, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { mkdir } from "node:fs/promises";
import type { AgentDefinition, AgentProject } from "../../src/front/services/agentApi.ts";

async function fixture(page: Page, feedback: boolean | "self" = false) {
  const agent = (id: string, name: string, nextAgentIds: string[]): AgentDefinition => ({
    id, name, nextAgentIds, description: `Mission de ${name}.`, prompt: `Exécuter ${name}.`,
    inputMode: id === "summary" ? "aggregate" : "separate", hasSession: false,
    executionStatus: "idle", conversation: [], threads: []
  });
  const content: AgentProject = {
    projectId: "interface-design", directoryPath: "C:/tests/Veille et publication", engine: "codex",
    workflowResumable: false, workflowParameterValues: {}, parameters: [],
    instructions: { fileName: "AGENTS.md", content: "Rechercher, analyser puis publier une synthèse." },
    agents: [agent("source", "Collecte des sources", ["analysis", "writer", "publish"]),
      agent("analysis", "Analyse des tendances", ["summary"]), agent("writer", "Revue éditoriale", ["summary"]),
      agent("summary", "Synthèse", ["publish"]), agent("publish", "Publication", [])]
  };
  if (feedback === "self") content.agents = [agent("source", "Révision itérative", ["source"])];
  else if (feedback) content.agents.forEach((agent, index) => {
    agent.nextAgentIds = [content.agents[(index + 1) % content.agents.length].id];
  });
  await page.route("**/api/projects", (route) => route.fulfill({ json: { projects: [{ id: content.projectId, directoryPath: content.directoryPath }] } }));
  await page.route("**/api/agents/projects/actual", (route) => route.fulfill({ json: content }));
  await page.route(`**/api/agents/projects/${content.projectId}`, (route) => route.fulfill({ json: content }));
  await page.route(`**/api/agents/projects/${content.projectId}/workflow/schedule`, (route) => route.fulfill({ json: {
    cron: "0 9 * * *", enabled: false, timezone: "Europe/Paris", nextRunAt: null, running: false,
    lastRunAt: null, lastRunStatus: null, lastRunError: null, parameterValues: {}
  } }));
  await page.goto(`/?project=${content.projectId}`);
  await expect(page.locator(".agent-card")).toHaveCount(content.agents.length);
}

async function expectClearConnections(page: Page, expectedCount = 6) {
  const paths = page.locator(".agent-project__connections > path");
  await expect(paths).toHaveCount(expectedCount);
  await expect.poll(() => paths.evaluateAll((paths) => paths.every((p) => (p as SVGPathElement).getTotalLength() > 0))).toBe(true);
  // Sample actual rounded SVG curves, not just the router's orthogonal points.
  await expect.poll(() => page.evaluate(() => {
    const svg = document.querySelector<SVGSVGElement>(".agent-project__connections")!;
    const bounds = svg.getBoundingClientRect();
    const obstacles = [...document.querySelectorAll(".agent-card, .workflow-routing-summary")].map((card) => card.getBoundingClientRect());
    return [...svg.querySelectorAll<SVGPathElement>(":scope > path"),
      ...document.querySelectorAll<SVGPathElement>(".agent-project__feedback-grid-loop-path")].flatMap((path) => {
      const collisions: string[] = [];
      for (let length = 0; length <= path.getTotalLength(); length += 3) {
        const p = path.getPointAtLength(length), x = p.x + bounds.left, y = p.y + bounds.top;
        if (obstacles.some((r) => x > r.left + 1 && x < r.right - 1 && y > r.top + 1 && y < r.bottom - 1)) {
          collisions.push(`${path.dataset.workflowSource} → ${path.dataset.workflowTarget}`); break;
        }
      }
      return collisions;
    });
  })).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
}

test("branching, joins and skipped levels stay readable after resizing and expanding cards", async ({ page }, testInfo) => {
  await fixture(page);
  await expect(page.getByRole("list", { name: "Légende des liaisons" })).toBeVisible();
  await expectClearConnections(page);
  const sourcePorts = await page.locator('path[data-workflow-source="source"]').evaluateAll((paths) => paths.map((path) => (path as SVGPathElement).getPointAtLength(0).x));
  expect(new Set(sourcePorts).size).toBe(3);
  const originalWidth = page.viewportSize()!.width;
  await page.setViewportSize({ width: originalWidth > 800 ? 390 : 1440, height: 900 });
  await expectClearConnections(page);
  await page.setViewportSize({ width: originalWidth, height: 900 });
  const card = page.locator('[data-workflow-agent-id="analysis"] .agent-card');
  await card.locator("summary").click();
  // Simulate a longer response independently of the other card in the row.
  await card.evaluate((element) => { element.style.minHeight = "580px"; });
  await expectClearConnections(page);
  const activeCard = page.locator('[data-workflow-agent-id="source"] .agent-card');
  await activeCard.scrollIntoViewIfNeeded();
  const before = await activeCard.boundingBox();
  await activeCard.hover();
  expect((await activeCard.boundingBox())!.y).toBe(before!.y);
  await page.mouse.move(0, 0);
  await card.evaluate((element) => { element.style.minHeight = ""; });
  await expectClearConnections(page);
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(results.violations).toEqual([]);
  await page.evaluate(() => { (document.activeElement as HTMLElement)?.blur(); window.scrollTo(0, 0); });
  await mkdir("artifacts/interface-audit-2026-09-07/after", { recursive: true });
  await page.screenshot({ path: `artifacts/interface-audit-2026-09-07/after/graph-${testInfo.project.name}.png`, fullPage: true });
});

test("feedback loops and scheduling expose a consistent accessible interface", async ({ page }, testInfo) => {
  await fixture(page, true);
  await expect(page.getByRole("list", { name: "Légende des liaisons" })).toContainText("Boucle de retour");
  await expect(page.locator(".agent-project__feedback-grid-loop-path")).toHaveAttribute("d", /Q/);
  await expectClearConnections(page, 4);
  await mkdir("artifacts/interface-audit-2026-09-07/after", { recursive: true });
  await page.screenshot({ path: `artifacts/interface-audit-2026-09-07/after/feedback-${testInfo.project.name}.png`, fullPage: true });
  await page.getByRole("button", { name: "Planifier", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa"]).analyze();
  expect(results.violations).toEqual([]);
  await page.screenshot({ path: `artifacts/interface-audit-2026-09-07/after/schedule-${testInfo.project.name}.png` });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).not.toBeVisible();
  await expect(page.getByRole("button", { name: "Planifier", exact: true })).toBeFocused();
});

test("running connections respect reduced motion and the legend follows the language", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await fixture(page);
  const path = page.locator(".agent-project__connections > path").first();
  await path.evaluate((element) => element.classList.add("agent-project__connection--running"));
  await expect(path).toHaveCSS("animation-name", "none");
  await page.evaluate(() => localStorage.setItem("cortex.language.v1", "en"));
  await page.reload();
  await expect(page.getByRole("list", { name: "Connection legend" })).toContainText("Not selected");
});

test("an agent returning to itself retains a visible feedback connection", async ({ page }) => {
  await fixture(page, "self");
  await expect(page.locator(".agent-project__feedback-grid-loop-path")).toHaveAttribute("d", /Q/);
  await expect(page.getByRole("list", { name: "Légende des liaisons" })).toContainText("Boucle de retour");
  await expectClearConnections(page, 0);
});
