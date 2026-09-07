import assert from "node:assert/strict";
import test from "node:test";
import {
  applyProjectReviewProposal,
  parseProjectReviewProposal,
  type ProjectReviewDraft,
  type ProjectReviewProposal
} from "./ProjectReviewProposal.ts";

function createDraft(): ProjectReviewDraft {
  return {
    projectName: "Journal",
    instructions: "Préparer puis publier le journal.",
    agents: [{
      key: ".codex/agents/redacteur.toml",
      name: "Rédacteur",
      description: "Prépare le journal.",
      prompt: "Rédiger puis publier.",
      model: "existing-model",
      reasoningEffort: "high"
    }, {
      key: "existing-publisher",
      name: "Publieur",
      description: "Publie le journal.",
      prompt: "Publier le journal.",
      model: "",
      reasoningEffort: ""
    }]
  };
}

function proposal(changes: unknown[]): unknown {
  return { title: "Validation éditoriale", description: "Demander un accord avant de publier.", changes };
}

test("projects a coherent approval proposal without mutating the draft, proposal or untouched settings", () => {
  const draft = createDraft();
  const source = proposal([{
    type: "update_instructions",
    instructions: "  Préparer, faire valider, puis publier.  "
  }, {
    type: "update_agent",
    agentKey: draft.agents[0].key,
    updates: { prompt: "  Rédiger puis demander une validation.  ", description: "" }
  }, {
    type: "remove_agent",
    agentKey: draft.agents[1].key
  }, {
    type: "add_agent",
    agentKey: "new:publication_validee",
    agent: {
      name: "Publication validée",
      description: "Publication après accord.",
      prompt: "Publier seulement après validation explicite.",
      model: "",
      reasoningEffort: ""
    }
  }]);
  const originalDraft = structuredClone(draft);
  const originalSource = structuredClone(source);
  Object.freeze(draft);
  Object.freeze(draft.agents);
  draft.agents.forEach(Object.freeze);

  const parsed = parseProjectReviewProposal(source, draft);
  const result = applyProjectReviewProposal(draft, parsed);
  assert.deepEqual(draft, originalDraft);
  assert.deepEqual(source, originalSource);
  assert.equal(result.projectName, draft.projectName);
  assert.equal(result.instructions, "Préparer, faire valider, puis publier.");
  assert.deepEqual(result.agents.map(({ key }) => key), [draft.agents[0].key, "new:publication_validee"]);
  assert.equal(result.agents[0].prompt, "Rédiger puis demander une validation.");
  assert.equal(result.agents[0].description, "");
  assert.equal(result.agents[0].model, "existing-model");
  assert.equal(result.agents[0].reasoningEffort, "high");
  assert.equal(result.agents[1].prompt, "Publier seulement après validation explicite.");

  result.agents[0].name = "Different";
  result.agents[1].prompt = "Different";
  assert.deepEqual(draft, originalDraft);
  assert.equal((parsed.changes[3] as Extract<ProjectReviewProposal["changes"][number], { type: "add_agent" }>).agent.prompt,
    "Publier seulement après validation explicite.");
});

test("rejects malformed changes, unsupported file edits, invented targets and ambiguous duplicate operations", async (t) => {
  const draft = createDraft();
  const update = { type: "update_agent", agentKey: draft.agents[0].key, updates: { prompt: "Mission révisée." } };
  const addition = {
    type: "add_agent", agentKey: "new:validation",
    agent: { name: "Validation", description: "", prompt: "Valider.", model: "", reasoningEffort: "" }
  };
  const cases: Array<[string, unknown]> = [
    ["null", null],
    ["missing fields", { changes: [update] }],
    ["unknown proposal keys", { ...proposal([update]) as object, command: "run" }],
    ["empty title", { ...proposal([update]) as object, title: " " }],
    ["no changes", proposal([])],
    ["too many changes", proposal(Array.from({ length: 51 }, () => update))],
    ["null change", proposal([null])],
    ["file edits", proposal([{ type: "write_file", path: "AGENTS.md", content: "Test" }])],
    ["unpersisted reordering", proposal([{ type: "reorder_agents", agentKeys: draft.agents.map(({ key }) => key) }])],
    ["unknown change properties", proposal([{ ...update, command: "run" }])],
    ["unknown update properties", proposal([{ ...update, updates: { id: "another-id" } }])],
    ["empty update", proposal([{ ...update, updates: {} }])],
    ["null optional field", proposal([{ ...update, updates: { model: null } }])],
    ["empty name", proposal([{ ...update, updates: { name: " " } }])],
    ["empty prompt", proposal([{ ...update, updates: { prompt: "" } }])],
    ["invented target", proposal([{ ...update, agentKey: "absent" }])],
    ["changed key whitespace", proposal([{ ...update, agentKey: ` ${draft.agents[0].key} ` }])],
    ["unknown removal target", proposal([{ type: "remove_agent", agentKey: "absent" }])],
    ["two updates", proposal([update, update])],
    ["update plus removal", proposal([update, { type: "remove_agent", agentKey: update.agentKey }])],
    ["duplicate instructions", proposal([{ type: "update_instructions", instructions: "A" }, { type: "update_instructions", instructions: "B" }])],
    ["invalid instructions type", proposal([{ type: "update_instructions", instructions: null }])],
    ["duplicate additions", proposal([addition, addition])],
    ["nonreserved addition key", proposal([{ ...addition, agentKey: "validator" }])],
    ["addition with existing key", proposal([{ ...addition, agentKey: draft.agents[0].key }])],
    ["path as addition key", proposal([{ ...addition, agentKey: "new:../../file" }])],
    ["missing addition fields", proposal([{ ...addition, agent: { name: "Validator", prompt: "Validate" } }])],
    ["extra addition fields", proposal([{ ...addition, agent: { ...addition.agent, tools: ["shell"] } }])],
    ["addition then update", proposal([addition, { ...update, agentKey: addition.agentKey }])],
    ["addition then removal", proposal([addition, { type: "remove_agent", agentKey: addition.agentKey }])]
  ];
  for (const [name, candidate] of cases) {
    await t.test(name, () => {
      const before = structuredClone(draft);
      assert.throws(() => parseProjectReviewProposal(candidate, draft), /invalid project review proposal/i);
      assert.deepEqual(draft, before);
    });
  }
});

test("rejects no-op proposals and revalidates targets at application time", () => {
  const draft = createDraft();
  assert.throws(() => parseProjectReviewProposal(proposal([{
    type: "update_agent", agentKey: draft.agents[0].key, updates: { prompt: draft.agents[0].prompt }
  }]), draft), /does not change/i);
  assert.throws(() => parseProjectReviewProposal(proposal([{
    type: "update_instructions", instructions: draft.instructions
  }]), draft), /does not change/i);

  const parsed = parseProjectReviewProposal(proposal([{
    type: "update_agent", agentKey: draft.agents[0].key, updates: { prompt: "Mission révisée." }
  }]), draft);
  draft.agents.shift();
  assert.throws(() => applyProjectReviewProposal(draft, parsed), /no longer exists/i);
});

test("requires all resulting agents to be saveable and allows repairing or removing incomplete agents", () => {
  const draft = createDraft();
  draft.agents[1].name = "";
  draft.agents[1].prompt = "";
  assert.throws(() => parseProjectReviewProposal(proposal([{
    type: "update_instructions", instructions: "Nouvelles instructions."
  }]), draft), /names and instructions/i);
  const fixed = parseProjectReviewProposal(proposal([{
    type: "update_agent", agentKey: draft.agents[1].key,
    updates: { name: "Publication validée", prompt: "Publier après accord." }
  }]), draft);
  assert.equal(applyProjectReviewProposal(draft, fixed).agents[1].prompt, "Publier après accord.");
  const removed = parseProjectReviewProposal(proposal([{
    type: "remove_agent", agentKey: draft.agents[1].key
  }]), draft);
  assert.equal(applyProjectReviewProposal(draft, removed).agents.length, 1);
});

test("enforces the save API's agent limit and accepts a complete 50-agent update", () => {
  const draft = createDraft();
  draft.agents = Array.from({ length: 50 }, (_, index) => ({ ...draft.agents[0], key: `agent-${index}` }));
  const updates = parseProjectReviewProposal(proposal(draft.agents.map(({ key }) => ({
    type: "update_agent", agentKey: key, updates: { prompt: "Mission révisée." }
  }))), draft);
  assert.equal(applyProjectReviewProposal(draft, updates).agents.length, 50);
  assert.throws(() => parseProjectReviewProposal(proposal([{
    type: "add_agent", agentKey: "new:extra",
    agent: { name: "Extra", description: "", prompt: "Vérifier.", model: "", reasoningEffort: "" }
  }]), draft), /at most 50/i);
});
