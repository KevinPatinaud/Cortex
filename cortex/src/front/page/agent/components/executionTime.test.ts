import assert from "node:assert/strict";
import test from "node:test";
import { formatElapsedTime } from "./executionTime.ts";

test("elapsed time crosses minute and hour boundaries without misleading rounding", () => {
  const start = "2026-09-06T10:00:00.000Z";
  const now = Date.parse(start);
  assert.equal(formatElapsedTime(start, now + 59_900), "59 s");
  assert.equal(formatElapsedTime(start, now + 60_000), "1 min 0 s");
  assert.equal(formatElapsedTime(start, now + 3_601_000), "1 h 0 min");
  assert.equal(formatElapsedTime(start, now - 5_000), "0 s");
  assert.equal(formatElapsedTime(undefined, now), "—");
  assert.equal(formatElapsedTime("invalid", now), "—");
});
