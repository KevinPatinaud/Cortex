import assert from "node:assert/strict";
import test from "node:test";
import { ResultInterpretationService } from "./ResultInterpretationService.ts";
import type { AgentService } from "../iaService/AgentService.ts";
import { parseAgentResponse } from "../../../../shared/AgentResponse.ts";
import { createAgentResponseSchema } from "../../../../shared/AgentResponseSchema.ts";
import { readWorkflowCheckpoint } from "../workflowExecution/WorkflowCheckpoint.ts";

const service = new ResultInterpretationService({} as AgentService);
const answer = (changes: Record<string, unknown> = {}) => JSON.stringify({ status: "success", items: [{ content: "Original" }],
  nextAgentIds: [], isMultiSelectionAllowed: null, isMultiSelectionThreaded: null, notes: null, wait: null,
  continuity: { summary: "Done", decisions: [], evidence: [], remainingWork: [] }, acceptance: [], ...changes });

test("the fast path requires the current contract and allowed routing, including dossier content", () => {
  const schema = createAgentResponseSchema(["next"], false, true);
  assert.ok(service.structuredResult(answer(), schema));
  assert.equal(service.structuredResult(answer({ nextAgentIds: ["unknown"] }), schema), undefined);
  const legacy = JSON.parse(answer()); delete legacy.continuity;
  assert.equal(service.structuredResult(JSON.stringify(legacy), schema), undefined);
  assert.equal(service.structuredResult(answer(), createAgentResponseSchema([], true, true)), undefined);
});

for (const status of ["blocked", "error", "partial", "waiting"]) test(`interpretation cannot upgrade explicit ${status} or rewrite its delivery`, () => {
  const wait = status === "waiting" ? { reason: "Reply", eventKey: "reply", wakeAfterSeconds: null,
    deadlineAt: "2027-01-01T12:00:00Z", state: "Mail already sent" } : null;
  const source = answer({ status, wait, items: [{ content: "Full source text" }], notes: "Original limits" });
  const interpreted = answer({ nextAgentIds: ["next"], items: [{ content: "A summary" }] });
  const preserved = parseAgentResponse(service.faithfulResult(source, interpreted, false))!;
  assert.equal(preserved.status, status); assert.equal(preserved.items[0].content, "Full source text");
  assert.equal(preserved.notes, "Original limits"); assert.deepEqual(preserved.wait, wait);
  if (status !== "partial") assert.deepEqual(preserved.nextAgentIds, []);
});

test("multi-item selections retain original content and cardinality", () => {
  const source = answer({ items: [{ content: "A" }, { content: "B" }], isMultiSelectionAllowed: true, isMultiSelectionThreaded: true });
  const converted = parseAgentResponse(service.faithfulResult(source, answer(), false))!;
  assert.deepEqual(converted.items, [{ content: "A" }, { content: "B" }]);
  assert.equal(converted.isMultiSelectionAllowed, true); assert.equal(converted.isMultiSelectionThreaded, true);
  assert.throws(() => service.faithfulResult(source, "not JSON", false), /malformed/);
});

test("corrupt pending interpretation is rejected as a whole checkpoint", () => {
  const checkpoint = { parameterValues: {}, agents: [{ id: "agent", execution: { status: "failed" }, failedThreadIds: [],
    threads: [{ id: "thread", sessionId: "business", conversation: [], upstreamItems: [], pendingInterpretation: { mode: "separate", mission: {} } }] }] };
  assert.equal(readWorkflowCheckpoint(checkpoint), null);
});
