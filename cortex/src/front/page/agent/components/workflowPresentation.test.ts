import assert from "node:assert/strict";
import test from "node:test";
import type { AgentDefinition } from "../../../services/agentApi.ts";
import type { AgentResponsePayload } from "../../../../shared/AgentResponse.ts";
import type { AgentResultStates } from "./workflowState.ts";
import {
  getWorkflowConnectionStatus,
  getWorkflowInstancePresentation,
  getWorkflowRoutingPresentation
} from "./workflowPresentation.ts";

function agent(id: string, nextAgentIds: string[] = [], overrides: Partial<AgentDefinition> = {}): AgentDefinition {
  return { id, name: id, description: "", prompt: "Mission", nextAgentIds,
    inputMode: "separate", hasSession: false, executionStatus: "idle", conversation: [], threads: [], ...overrides };
}

function response(nextAgentIds: string[] | null, overrides: Partial<AgentResponsePayload> = {}): AgentResponsePayload {
  return { status: "success", items: [{ content: "Result" }], nextAgentIds,
    isMultiSelectionAllowed: false, isMultiSelectionThreaded: false, notes: null, ...overrides };
}

function state(id: string, responses: AgentResponsePayload[], selectedItemIndexes: number[] = []): AgentResultStates {
  return { [id]: { responses, selectedItemIndexes, isInvalidated: false } };
}

test("unexecuted outgoing branches are possible choices, without assuming exclusive or parallel dispatch", () => {
  const source = agent("source", ["left", "right"]);
  assert.deepEqual(getWorkflowRoutingPresentation(source, {}), {
    kind: "conditional", selectedCount: 0, totalCount: 2
  });
  assert.equal(getWorkflowConnectionStatus(source, agent("left"), {}), "pending");
  assert.equal(getWorkflowRoutingPresentation(agent("one", ["next"]), {}).kind, "single");
  assert.equal(getWorkflowRoutingPresentation(agent("terminal"), {}).kind, "end");
});

test("one retained destination distinguishes the selected and omitted branches", () => {
  const source = agent("source", ["left", "right"], { hasSession: true });
  const states = state("source", [response(["left"])]);
  assert.deepEqual(getWorkflowRoutingPresentation(source, states), {
    kind: "selected-one", selectedCount: 1, totalCount: 2
  });
  assert.equal(getWorkflowConnectionStatus(source, agent("left"), states), "selected");
  assert.equal(getWorkflowConnectionStatus(source, agent("right"), states), "inactive");
  assert.equal(getWorkflowConnectionStatus(source, agent("left", [], { executionStatus: "running" }), states), "running");
});

test("parallel dispatch requires multiple destinations within the same result", () => {
  const source = agent("source", ["left", "right"], { hasSession: true });
  const states = state("source", [response(["left", "right"])]);
  assert.deepEqual(getWorkflowRoutingPresentation(source, states), {
    kind: "parallel", selectedCount: 2, totalCount: 2
  });
  assert.equal(getWorkflowConnectionStatus(source, agent("left"), states), "selected");
  assert.equal(getWorkflowConnectionStatus(source, agent("right"), states), "selected");
});

test("distinct routing decisions across instances are not presented as a shared parallel dispatch", () => {
  const source = agent("source", ["left", "right"], { hasSession: true });
  for (const responses of [
    [response(["left"]), response(["right"])],
    [response(["left", "right"]), response(["left"])],
    [response([]), response(["left"])],
  ]) {
    assert.equal(getWorkflowRoutingPresentation(source, state("source", responses)).kind, "per-instance");
  }
  // The ordering of the same destinations does not represent a routing change.
  assert.equal(getWorkflowRoutingPresentation(source, state("source", [
    response(["left", "right"]), response(["right", "left"])
  ])).kind, "parallel");
});

test("an explicit empty routing list means stop, while legacy routing remains unknown", () => {
  const source = agent("source", ["left", "right"], { hasSession: true });
  const stopped = state("source", [response([])]);
  assert.deepEqual(getWorkflowRoutingPresentation(source, stopped), {
    kind: "none", selectedCount: 0, totalCount: 2
  });
  assert.equal(getWorkflowConnectionStatus(source, agent("left"), stopped), "inactive");
  const legacy = state("source", [response(null)]);
  assert.equal(getWorkflowRoutingPresentation(source, legacy).kind, "legacy");
  assert.equal(getWorkflowConnectionStatus(source, agent("left"), legacy), "pending");
  const mixed = state("source", [response(null), response(["left"])]);
  assert.equal(getWorkflowRoutingPresentation(source, mixed).kind, "legacy");
  assert.equal(getWorkflowConnectionStatus(source, agent("left"), mixed), "selected");
  assert.equal(getWorkflowConnectionStatus(source, agent("right"), mixed), "pending");
});

test("unfinished or invalidated results cannot definitively select or omit a branch", () => {
  const states = state("source", [response(["left"])]);
  for (const executionStatus of ["running", "failed", "cancelled"] as const) {
    const source = agent("source", ["left", "right"], { hasSession: true, executionStatus });
    assert.equal(getWorkflowRoutingPresentation(source, states).kind, "conditional");
    assert.equal(getWorkflowConnectionStatus(source, agent("left"), states), "pending");
    assert.equal(getWorkflowConnectionStatus(source, agent("right"), states), "pending");
  }
  states.source.isInvalidated = true;
  const source = agent("source", ["left", "right"], { hasSession: true });
  assert.equal(getWorkflowRoutingPresentation(source, states).kind, "conditional");
  assert.equal(getWorkflowConnectionStatus(source, agent("right"), states), "pending");
});

test("routing presentation follows explicit destinations rather than interpreting response status", () => {
  const source = agent("source", ["left", "right"], { hasSession: true });
  for (const status of ["partial", "blocked", "error"] as const) {
    const states = state("source", [response(["left"], { status })]);
    assert.equal(getWorkflowRoutingPresentation(source, states).kind, "selected-one");
  }
});

test("a separate input mode does not promise an instance count before prerequisites and selections are ready", () => {
  const source = agent("source", ["target"]);
  const target = agent("target");
  const agents = [source, target];
  assert.deepEqual(getWorkflowInstancePresentation(target, agents, {}, new Set()), {
    mode: "separate", count: null, phase: "unknown", hasJoin: false
  });
  const states = state("source", [response(["target"], {
    items: [{ content: "First" }, { content: "Second" }],
    isMultiSelectionAllowed: true, isMultiSelectionThreaded: true
  })]);
  assert.equal(getWorkflowInstancePresentation(target, agents, states, new Set()).count, null);
  states.source.selectedItemIndexes = [0, 1];
  assert.deepEqual(getWorkflowInstancePresentation(target, agents, states, new Set()), {
    mode: "separate", count: 2, phase: "planned", hasJoin: false
  });
  states.source.selectedItemIndexes = [1];
  assert.equal(getWorkflowInstancePresentation(target, agents, states, new Set()).count, 1);
});

test("multiple selected items stay together when the response does not request separate instances", () => {
  const source = agent("source", ["target"]);
  const target = agent("target");
  const states = state("source", [response(["target"], {
    items: [{ content: "First" }, { content: "Second" }],
    isMultiSelectionAllowed: true, isMultiSelectionThreaded: false
  })], [0, 1]);
  assert.equal(getWorkflowInstancePresentation(target, [source, target], states, new Set()).count, 1);
});

test("multiple retained source instances propagate even without a new item fan-out", () => {
  const source = agent("source", ["target"]);
  const target = agent("target");
  const states = state("source", [response(["target"]), response(["target"])]);
  assert.equal(getWorkflowInstancePresentation(target, [source, target], states, new Set()).count, 2);
});

test("a join waits for both flows and aggregate mode consolidates their inputs into one instance", () => {
  const left = agent("left", ["summary"]);
  const right = agent("right", ["summary"]);
  const summary = agent("summary", [], { inputMode: "aggregate" });
  const agents = [left, right, summary];
  const states = state("left", [response(["summary"]), response(["summary"])]);
  assert.deepEqual(getWorkflowInstancePresentation(summary, agents, states, new Set()), {
    mode: "aggregate", count: 1, phase: "unknown", hasJoin: true
  });
  Object.assign(states, state("right", [response(["summary"])]));
  assert.deepEqual(getWorkflowInstancePresentation(summary, agents, states, new Set()), {
    mode: "aggregate", count: 1, phase: "planned", hasJoin: true
  });
});

test("a convergence remains ready when another completed branch explicitly declines it", () => {
  const left = agent("left", ["summary"]);
  const right = agent("right", ["summary"]);
  const summary = agent("summary", [], { inputMode: "aggregate" });
  const states = { ...state("left", [response(["summary"])]), ...state("right", [response([])]) };
  assert.deepEqual(getWorkflowInstancePresentation(summary, [left, right, summary], states, new Set()), {
    mode: "aggregate", count: 1, phase: "planned", hasJoin: true
  });
});

test("invalidated retained instances cannot appear as the next valid count", () => {
  const source = agent("source", ["target"]);
  const target = agent("target", [], {
    hasSession: true, threads: [{ id: "old-first", conversation: [] }, { id: "old-second", conversation: [] }]
  });
  const states = state("target", [response([]), response([])]);
  states.target.isInvalidated = true;
  assert.deepEqual(getWorkflowInstancePresentation(target, [source, target], states, new Set()), {
    mode: "separate", count: null, phase: "unknown", hasJoin: false
  });
});

test("old destinations outside the current graph do not inflate the selected branch count", () => {
  const source = agent("source", ["left", "right"]);
  assert.deepEqual(getWorkflowRoutingPresentation(source, state("source", [response(["left", "removed"])])), {
    kind: "selected-one", selectedCount: 1, totalCount: 2
  });
});

test("retained instances remain visible for a retry even when prerequisites cannot currently run", () => {
  const source = agent("source", ["target"], { executionStatus: "failed" });
  const target = agent("target", [], {
    hasSession: true, executionStatus: "failed", threads: [
      { id: "first", conversation: [] }, { id: "second", conversation: [] }
    ]
  });
  assert.deepEqual(getWorkflowInstancePresentation(target, [source, target], {}, new Set()), {
    mode: "separate", count: 2, phase: "retained", hasJoin: false
  });
});

test("independent roots each have one initial instance without assuming downstream fan-out", () => {
  const first = agent("first", ["worker"]);
  const second = agent("second", ["worker"]);
  const worker = agent("worker");
  const agents = [first, second, worker];
  assert.deepEqual(getWorkflowInstancePresentation(first, agents, {}, new Set()), {
    mode: "root", count: 1, phase: "planned", hasJoin: false
  });
  assert.deepEqual(getWorkflowInstancePresentation(second, agents, {}, new Set()), {
    mode: "root", count: 1, phase: "planned", hasJoin: false
  });
});

test("running retained sessions are not labeled as new planned work when only one thread may be rerun", () => {
  const source = agent("source", ["target"]);
  const target = agent("target", [], {
    hasSession: true, executionStatus: "running", threads: [
      { id: "first", conversation: [] }, { id: "second", conversation: [] }, { id: "third", conversation: [] }
    ]
  });
  const states = state("source", [response(["target"], {
    items: [{ content: "First" }, { content: "Second" }, { content: "Third" }],
    isMultiSelectionAllowed: true, isMultiSelectionThreaded: true
  })], [0, 1, 2]);
  assert.deepEqual(getWorkflowInstancePresentation(target, [source, target], states, new Set()), {
    mode: "separate", count: 3, phase: "retained", hasJoin: false
  });
});
