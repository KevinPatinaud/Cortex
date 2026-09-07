import assert from "node:assert/strict";
import test from "node:test";
import type { AgentDefinition } from "../../../services/agentApi.ts";
import type { AgentResponsePayload } from "../../../../shared/AgentResponse.ts";
import { getWorkflowFeedbackEdgeKeys } from "../../../../shared/AgentWorkflowGraph.ts";
import {
  getAgentProgressState,
  getDefaultHandoffSelections,
  getPlannedThreadCount,
  getPrerequisiteMessage,
  getWorkflowLevels,
  getWorkflowLaneLayout,
  type AgentResultStates
} from "./workflowState.ts";

function agent(id: string, nextAgentIds: string[] = []): AgentDefinition {
  return { id, name: id, description: "", prompt: "Mission", nextAgentIds,
    inputMode: "separate", hasSession: false, executionStatus: "idle", conversation: [], threads: [] };
}

function response(nextAgentIds: string[] | null = null): AgentResponsePayload {
  return { status: "success", items: [{ content: "result" }], nextAgentIds,
    isMultiSelectionAllowed: false, isMultiSelectionThreaded: false, notes: null };
}

test("a partial failure or cancellation keeps downstream agents blocked despite preserved results", () => {
  for (const executionStatus of ["running", "failed", "cancelled"] as const) {
    const source = { ...agent("source", ["target"]), hasSession: true, executionStatus };
    const target = agent("target");
    const states: AgentResultStates = { source: { responses: [response()], selectedItemIndexes: [], isInvalidated: false } };
    assert.equal(getAgentProgressState(source, [source, target], states, new Set()), "pending");
    assert.equal(getPrerequisiteMessage([source], "target", states, [source, target], new Set(), (key) => key), "prerequisite.runFirst");
  }
});

test("conditional branches omitted by a completed agent do not count as work awaiting execution", () => {
  const source = agent("source", ["selected", "omitted"]);
  const selected = agent("selected");
  const omitted = agent("omitted");
  const states: AgentResultStates = { source: { responses: [response(["selected"])], selectedItemIndexes: [], isInvalidated: false } };
  const agents = [source, selected, omitted];
  assert.equal(getAgentProgressState(source, agents, states, new Set()), "completed");
  assert.equal(getAgentProgressState(selected, agents, states, new Set()), "pending");
  assert.equal(getAgentProgressState(omitted, agents, states, new Set()), "skipped");
});

test("recovered selections keep branch offsets and aggregate agents avoid redundant parallel sessions", () => {
  const source = agent("source", ["target"]);
  const target = agent("target");
  const responses = [response(), { ...response(), items: [{ content: "a" }, { content: "b" }], isMultiSelectionAllowed: true, isMultiSelectionThreaded: true }];
  const states: AgentResultStates = { source: { responses, selectedItemIndexes: [1, 2], isInvalidated: false } };
  assert.deepEqual(getDefaultHandoffSelections(states.source), [1, 2]);
  assert.equal(getPlannedThreadCount(target, [source], states), 3);
  assert.equal(getPlannedThreadCount({ ...target, inputMode: "aggregate" }, [source], states), 1);
});

test("feedback edges preserve finite levels for cyclic workflow rendering", () => {
  const agents = [agent("research", ["review"]), agent("review", ["research", "publish"]), agent("publish")];
  const feedback = getWorkflowFeedbackEdgeKeys(agents);
  assert.deepEqual(getWorkflowLevels(agents, feedback).map((level) => level.map(({ id }) => id)), [["research"], ["review"], ["publish"]]);
});

test("parallel entry points keep their branches aligned and their shared successor spans both", () => {
  const agents = [agent("publish"), agent("events", ["calendar"]),
    agent("calendar", ["summary"]), agent("summary", ["publish"]),
    agent("research", ["writer"]), agent("writer", ["summary"])];
  const levels = getWorkflowLevels(agents, new Set());
  assert.deepEqual(levels.map((level) => level.map(({ id }) => id)), [
    ["events", "research"], ["calendar", "writer"], ["summary"], ["publish"]
  ]);
  const { laneCount, placements } = getWorkflowLaneLayout(levels, new Set());
  assert.equal(laneCount, 2);
  assert.deepEqual(placements.get("events"), { start: 1, end: 2 });
  assert.deepEqual(placements.get("calendar"), placements.get("events"));
  assert.deepEqual(placements.get("writer"), placements.get("research"));
  assert.deepEqual(placements.get("summary"), { start: 1, end: 3 });
  assert.deepEqual(placements.get("publish"), placements.get("summary"));
});

test("a short independent branch does not shift or widen the other branch", () => {
  const agents = [agent("first", ["second"]), agent("short"), agent("second", ["third"]), agent("third")];
  const { placements } = getWorkflowLaneLayout(getWorkflowLevels(agents, new Set()), new Set());
  assert.deepEqual(placements.get("second"), placements.get("first"));
  assert.deepEqual(placements.get("third"), placements.get("first"));
  assert.notDeepEqual(placements.get("short"), placements.get("first"));
});

test("a split and join retain distinct slots alongside an unfinished sibling", () => {
  const agents = [agent("root", ["left", "right"]), agent("left", ["merge", "extra"]),
    agent("right", ["merge"]), agent("merge"), agent("extra")];
  const levels = getWorkflowLevels(agents, new Set());
  const { placements } = getWorkflowLaneLayout(levels, new Set());
  for (const level of levels) {
    for (let index = 1; index < level.length; index += 1) {
      const previous = placements.get(level[index - 1].id)!;
      const current = placements.get(level[index].id)!;
      assert.ok(previous.end <= current.start || current.end <= previous.start);
    }
  }
});
