import assert from "node:assert/strict";
import test from "node:test";
import { getWorkflowEdgeKey, getWorkflowFeedbackEdgeKeys } from "./AgentWorkflowGraph.ts";

test("edges between distinct cycles are never feedback edges", () => {
  const agents = [
    { id: "destination", nextAgentIds: ["destination-end"] },
    { id: "destination-end", nextAgentIds: ["destination"] },
    { id: "source", nextAgentIds: ["source-end"] },
    { id: "source-end", nextAgentIds: ["source", "destination"] }
  ];
  const feedback = getWorkflowFeedbackEdgeKeys(agents);
  assert.equal(feedback.has(getWorkflowEdgeKey("source-end", "destination")), false);
  assert.equal(feedback.size, 2);
});

test("cycles use their external entry point even in an unordered graph", () => {
  const feedback = getWorkflowFeedbackEdgeKeys([
    { id: "review", nextAgentIds: ["analysis"] },
    { id: "entry", nextAgentIds: ["analysis"] },
    { id: "analysis", nextAgentIds: ["review"] }
  ]);
  assert.deepEqual(feedback, new Set([getWorkflowEdgeKey("review", "analysis")]));
});
