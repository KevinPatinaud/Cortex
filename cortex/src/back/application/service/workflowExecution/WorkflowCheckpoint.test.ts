import assert from "node:assert/strict";
import test from "node:test";
import { hasRecoverableInterpretation, readWorkflowCheckpoint, type WorkflowCheckpointState } from "./WorkflowCheckpoint.ts";

function pending(): WorkflowCheckpointState {
  return { parameterValues: {}, agents: [{ id: "agent", execution: { status: "failed" }, failedThreadIds: ["done"], threads: [{
    id: "done", sessionId: "session", conversation: [], upstreamItems: [], pendingInterpretation: {
      mode: "separate", mission: { prompt: "Publish", response: "Published once", sessionId: "session", workingDirectory: "/site", completedAt: "2026-10-25T19:00:00Z" },
      interpretation: { status: "pending" }
    }
  }] }] };
}

test("an unknown failed parallel branch prevents automatic recovery and workspace release", () => {
  const state = pending();
  assert.equal(hasRecoverableInterpretation(readWorkflowCheckpoint(state)), true);
  state.agents[0].failedThreadIds.push("unknown");
  assert.equal(hasRecoverableInterpretation(readWorkflowCheckpoint(state)), false);
  state.agents[0].failedThreadIds = ["done"];
  state.agents.push({ id: "other", execution: { status: "running" }, failedThreadIds: [], threads: [] });
  assert.equal(hasRecoverableInterpretation(readWorkflowCheckpoint(state)), false);
});

test("a failed mission without a saved final result cannot be retried as interpretation", () => {
  const state = pending();
  delete state.agents[0].threads[0].pendingInterpretation;
  assert.equal(hasRecoverableInterpretation(readWorkflowCheckpoint(state)), false);
});

test("retry checkpoints accept legacy state and reject invalid persisted retry schedules", () => {
  const state = pending();
  assert.ok(readWorkflowCheckpoint(state));
  state.interpretationRecovery = { attempts: 1, nextAttemptAt: "2026-10-26T08:00:00Z" };
  assert.ok(readWorkflowCheckpoint(state));
  for (const invalid of [{ attempts: 0, nextAttemptAt: "2026-10-26T08:00:00Z" }, { attempts: 2, nextAttemptAt: "not a date" }]) {
    state.interpretationRecovery = invalid;
    assert.equal(readWorkflowCheckpoint(state), null);
  }
});
