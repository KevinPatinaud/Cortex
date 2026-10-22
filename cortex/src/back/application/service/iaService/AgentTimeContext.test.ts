import assert from "node:assert/strict";
import test from "node:test";
import { createAgentTimeContext, readAgentTimezone } from "./AgentTimeContext.ts";

test("agent clock gives Paris local time and UTC for the same instant, including DST", () => {
  for (const [utc, local] of [
    ["2026-10-22T04:00:07.213Z", "2026-10-22T06:00:07.213+02:00"],
    ["2026-10-26T04:00:07.213Z", "2026-10-26T05:00:07.213+01:00"],
    ["2026-10-25T00:30:00.000Z", "2026-10-25T02:30:00.000+02:00"],
    ["2026-10-25T01:30:00.000Z", "2026-10-25T02:30:00.000+01:00"]
  ]) {
    const context = createAgentTimeContext(new Date(utc), "Europe/Paris");
    assert.ok(context.includes(`Current local time (Europe/Paris): ${local}`));
    assert.ok(context.includes(`Current UTC time: ${utc}`));
    assert.equal(Date.parse(local), Date.parse(utc));
  }
});

test("agent clock supports local date rollover, fractional offsets and UTC", () => {
  const now = new Date("2026-10-22T20:30:00.000Z");
  assert.ok(createAgentTimeContext(now, "Asia/Kathmandu").includes("2026-10-23T02:15:00.000+05:45"));
  assert.ok(createAgentTimeContext(now, "UTC").includes("2026-10-22T20:30:00.000+00:00"));
  assert.equal(readAgentTimezone(" Europe/Paris "), "Europe/Paris");
  assert.throws(() => readAgentTimezone("Invalid/Timezone"));
});
