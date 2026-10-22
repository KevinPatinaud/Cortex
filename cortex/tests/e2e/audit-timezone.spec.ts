import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";

for (const clock of [
  { timezone: "Europe/Paris", utc: "2026-10-22T02:00:07.213Z", local: "04:00:07 UTC+2" },
  { timezone: "Europe/Paris", utc: "2026-10-26T02:00:07.213Z", local: "03:00:07 UTC+1" },
  { timezone: "UTC", utc: "2026-10-22T02:00:07.213Z", local: "02:00:07 UTC" }
]) {
  test.describe(clock.timezone + " " + clock.utc, () => {
    test.use({ timezoneId: clock.timezone });
    test("history identifies local timezone and preserves the original UTC instant", async ({ page, request }) => {
      const name = `Clock-${randomUUID().slice(0, 8)}`;
      const created = await request.post("/api/projects/create", { data: {
        name, engine: "codex", generationMode: "empty", instructions: "Clock regression"
      } });
      expect(created.status()).toBe(201);
      const { project } = await created.json();
      const base = `/api/agents/projects/${project.id}`;
      expect((await request.put(base, { data: {
        name, engine: "codex", instructions: "Clock regression",
        agents: [{ name: "Clock", description: "Clock", prompt: "Clock" }]
      } })).ok()).toBe(true);
      expect((await request.post(`${base}/workflow/run`, { data: {} })).ok()).toBe(true);
      const runs = await (await request.get(`${base}/audit/runs?scope=workflow`)).json();
      const run = { ...runs.items[0], startedAt: clock.utc, finishedAt: clock.utc };
      const detail = await (await request.get(`${base}/audit/runs/${run.id}`)).json();
      await page.route(`**${base}/audit/runs?*`, route => route.fulfill({ json: { ...runs, items: [run] } }));
      await page.route(`**${base}/audit/runs/${run.id}`, route => route.fulfill({ json: {
        ...detail, ...run, executions: detail.executions.map((execution: object) => ({ ...execution, startedAt: clock.utc }))
      } }));
      await page.goto(`/?project=${project.id}&view=audit`);
      const audit = page.locator(".workflow-audit");
      await expect(audit.locator(".workflow-audit__timezone")).toContainText(`Heure locale · ${clock.timezone}`);
      await expect(audit.locator(".workflow-audit__overview h2")).toContainText(clock.local);
      await expect(audit.locator("time")).toHaveCount(4);
      for (const time of await audit.locator("time").all()) {
        await expect(time).toContainText(clock.local);
        await expect(time).toHaveAttribute("datetime", clock.utc);
        await expect(time).toHaveAttribute("title", clock.utc);
      }
      expect(await audit.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      // The production storage/export contract remains an absolute UTC timestamp.
      expect((await (await request.get(`${base}/audit/runs/${run.id}`)).json()).startedAt).toMatch(/Z$/);
    });
  });
}
