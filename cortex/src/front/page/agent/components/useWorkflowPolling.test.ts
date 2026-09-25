import assert from "node:assert/strict";
import test from "node:test";
import { mergeWorkflowRuntime } from "./useWorkflowPolling.ts";
import type { AgentProject } from "../../../services/agentApi.ts";
import type { WorkflowRuntime } from "../../../../shared/WorkflowRuntime.ts";

test("runtime refresh clears a remotely reset execution while preserving its definition", () => {
  const project = {
    projectId: "p", workflowDefinitionError: "Old graph error", workflowInstance: { id: "old" },
    agents: [{ id: "a", name: "Agent", prompt: "Keep instructions", nextAgentIds: ["b"],
      executionStatus: "failed", executionError: "Old error", executionProgress: "Old progress" }]
  } as unknown as AgentProject;
  const runtime: WorkflowRuntime = { projectId: "p", executionPaused: false, workflowResumable: false,
    workflowWaits: [], workflowParameterValues: {}, agents: [{ id: "a", executionStatus: "idle",
      hasSession: false, conversation: [], threads: [] }] };
  const refreshed = mergeWorkflowRuntime(project, runtime);
  assert.equal(refreshed.workflowInstance, undefined);
  assert.equal(refreshed.workflowDefinitionError, undefined);
  assert.equal(refreshed.agents[0].executionError, undefined);
  assert.equal(refreshed.agents[0].executionProgress, undefined);
  assert.equal(refreshed.agents[0].prompt, "Keep instructions");
  assert.deepEqual(refreshed.agents[0].nextAgentIds, ["b"]);
  assert.equal(mergeWorkflowRuntime(project, { ...runtime, projectId: "different" }), project);
});
