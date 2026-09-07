import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";

test("Gmail thread binding and automatic workflow wake without a workspace banner", async ({ page, request }, testInfo) => {
  const name = `Gmail ${randomUUID().slice(0, 8)}`;
  const { project } = await (await request.post("/api/projects/create", { data: { name, engine: "codex", description: "Gmail test." } })).json();
  const base = `/api/agents/projects/${project.id}`;
  await request.put(base, { data: { name, engine: "codex", instructions: "Attendre puis conclure.", agents: [
    { name: "Suivi", description: "Attend.", prompt: "E2E_DURABLE_WAIT" }
  ] } });
  await request.post(`${base}/workflow/run`, { data: {} });
  // The fixture replaces Google traffic; no real mailbox is used.
  const headers = { Origin: "http://127.0.0.1:4317" };
  expect((await request.post("/api/gmail/configure", { headers, data: {
    installed: { client_id: "test.apps.googleusercontent.com", client_secret: "test" }
  } })).ok()).toBe(true);
  const connection = await request.post("/api/gmail/connect", { headers, data: { projectId: project.id } });
  expect(connection.ok()).toBe(true);
  const state = new URL((await connection.json()).url).searchParams.get("state")!;
  expect((await request.get(`/api/gmail/callback?${new URLSearchParams({ code: "fake", state })}`)).ok()).toBe(true);
  const content = await (await request.get(base)).json();
  expect((await request.post("/api/gmail/watches", { headers, data: {
    projectId: project.id, instanceId: content.workflowInstance.id, eventKey: "hotel:demo", threadId: "thread123"
  } })).status()).toBe(201);
  await page.goto(`/?project=${project.id}`);
  await expect(page.getByRole("button", { name: "Modifier le projet", exact: true })).toBeVisible();
  await expect(page.locator(".gmail-panel")).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await page.screenshot({ path: testInfo.outputPath("gmail.png"), fullPage: true });
  await request.post("/__test/gmail-reply");
  await expect.poll(async () => (await (await request.get(base)).json()).workflowInstance.status).toBe("completed");
  expect((await request.post("/api/gmail/disconnect", { headers })).ok()).toBe(true);
  expect((await (await request.get("/api/gmail/status")).json()).connected).toBe(false);
});

test("Gmail rejects cross-origin changes and does not expose OAuth secrets", async ({ request }) => {
  const result = await request.post("/api/gmail/configure", { headers: { Origin: "https://untrusted.example" }, data: {} });
  expect(result.status()).toBe(403);
  const status = await (await request.get("/api/gmail/status")).json();
  expect(JSON.stringify(status)).not.toMatch(/client_secret|access_token|refresh_token/);
});
