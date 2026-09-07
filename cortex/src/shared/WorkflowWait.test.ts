import assert from "node:assert/strict";
import test from "node:test";
import { parseAgentResponse } from "./AgentResponse.ts";
import { readWorkflowCheckpoint } from "../back/application/service/workflowExecution/WorkflowCheckpoint.ts";
import { selectWorkflowWake, type WorkflowWaitState } from "./WorkflowWait.ts";

const wait: WorkflowWaitState = { id: "wait", reason: "Hotel reply", eventKey: "hotel:123", wakeAfterSeconds: 60,
  createdAt: "2026-09-07T10:00:00.000Z", wakeAt: "2026-09-07T10:01:00.000Z", deadlineAt: "2026-09-07T11:00:00.000Z", state: "sent" };

test("an early reply survives downtime past the deadline; late replies do not override expiry", () => {
  const now = new Date("2026-09-07T12:00:00Z");
  const early = { id: "early", key: "hotel:123", payload: "confirmed", receivedAt: "2026-09-07T10:30:00Z" };
  const late = { ...early, id: "late", receivedAt: "2026-09-07T11:30:00Z" };
  assert.equal(selectWorkflowWake(wait, [early, late], new Set(), now)?.eventId, "early");
  assert.equal(selectWorkflowWake(wait, [early, late], new Set(["early"]), now)?.type, "deadline");
  assert.equal(selectWorkflowWake(wait, [{ ...early, key: "unrelated" }], new Set(), now)?.type, "deadline");
});

test("malformed waiting responses fail closed instead of completing or launching successors", () => {
  const response = { status: "waiting", items: [], nextAgentIds: [], isMultiSelectionAllowed: null, isMultiSelectionThreaded: null, notes: null, wait };
  assert.ok(parseAgentResponse(JSON.stringify(response)));
  for (const override of [{ wait: null }, { nextAgentIds: ["summary"] }, { status: "success" },
    { wait: { ...wait, wakeAfterSeconds: -1 } }, { wait: { ...wait, deadlineAt: "tomorrow" } },
    { wait: { ...wait, eventKey: null, wakeAfterSeconds: null } }]) {
    assert.equal(parseAgentResponse(JSON.stringify({ ...response, ...override })), null);
  }
});

test("corrupt durable checkpoints cannot partially restore waiting work", () => {
  const checkpoint = { parameterValues: {}, instance: { id: "instance", status: "waiting", startedAt: wait.createdAt, executionCount: 1, consumedEventIds: [] },
    agents: [{ id: "hotel", execution: { status: "waiting" }, failedThreadIds: [],
      threads: [{ id: "thread", sessionId: "session", conversation: [], upstreamItems: [], wait }] }] };
  assert.ok(readWorkflowCheckpoint(checkpoint));
  assert.equal(readWorkflowCheckpoint({ ...checkpoint, instance: { ...checkpoint.instance, consumedEventIds: [42] } }), null);
  assert.equal(readWorkflowCheckpoint({ ...checkpoint, agents: [{ ...checkpoint.agents[0], threads: [{ ...checkpoint.agents[0].threads[0], wait: { ...wait, wakeAt: "invalid" } }] }] }), null);
});
