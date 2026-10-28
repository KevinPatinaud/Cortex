import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import type { AgentUseCase } from "../../usecase/AgentUseCase.ts";
import { WorkflowWaitScheduler } from "./WorkflowWaitScheduler.ts";

test("automatic workflow wakes stay paused during Work Force and resume afterwards", async () => {
  let suspended = true, wakes = 0;
  const agents = { wakeWaitingWorkflows: async () => { wakes++; } } as unknown as AgentUseCase;
  const scheduler = new WorkflowWaitScheduler(agents, 10, () => suspended);
  try {
    scheduler.start(); await delay(30); assert.equal(wakes, 0);
    suspended = false;
    for (let attempt = 0; attempt < 100 && wakes === 0; attempt++) await delay(5);
    assert.ok(wakes > 0);
    suspended = true; const before = wakes; await delay(30); assert.equal(wakes, before);
  } finally { scheduler.stop(); }
});
