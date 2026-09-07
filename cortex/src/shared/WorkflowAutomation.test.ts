import assert from "node:assert/strict";
import test from "node:test";
import { validateWorkflowDossierBranches } from "./WorkflowAutomation.ts";

const agents = [{ id: "search", nextAgentIds: ["select"] }, { id: "select", nextAgentIds: [] },
  { id: "negotiate", nextAgentIds: ["agreement", "refusal"] }, { id: "agreement", nextAgentIds: [] }, { id: "refusal", nextAgentIds: [] }];
const branch = { sourceAgentId: "select", targetAgentId: "negotiate" };
test("independent dossier branches preserve their internal conditional paths", () => {
  assert.deepEqual(validateWorkflowDossierBranches([branch], agents), [branch]);
  assert.deepEqual(validateWorkflowDossierBranches([], agents), []);
});
test("invalid and recursive dossier definitions fail before any agent can execute", () => {
  for (const value of [null, {}, [null], [{ ...branch, targetAgentId: "other-project" }], [branch, branch],
    [{ sourceAgentId: "agreement", targetAgentId: "negotiate" }],
    [branch, { sourceAgentId: "agreement", targetAgentId: "search" }]]) {
    assert.throws(() => validateWorkflowDossierBranches(value, agents));
  }
});
