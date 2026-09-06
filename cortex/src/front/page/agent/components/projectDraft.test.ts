import assert from "node:assert/strict";
import test from "node:test";
import { readProjectDraft, removeProjectDraft, saveProjectDraft } from "./projectDraft.ts";

function createStorage() {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); }
  };
}

const value = {
  projectName: "Research",
  instructions: "Unsaved context",
  agents: [{ clientId: "draft-1", name: "Researcher", description: "", prompt: "Draft mission" }]
};

test("drafts retain new agents and the saved-project baseline independently by project", () => {
  const storage = createStorage();
  assert.equal(saveProjectDraft("one", "original", value, storage), true);
  assert.equal(saveProjectDraft("two", "other", { ...value, instructions: "Other" }, storage), true);
  assert.deepEqual(readProjectDraft("one", storage)?.value, value);
  assert.equal(readProjectDraft("one", storage)?.base, "original");
  removeProjectDraft("one", storage);
  assert.equal(readProjectDraft("one", storage), null);
  assert.equal(readProjectDraft("two", storage)?.value.instructions, "Other");
});

test("corrupt and incompatible stored drafts cannot enter the editor", () => {
  const storage = createStorage();
  for (const raw of ["{", "null", "[]", JSON.stringify({ version: 2, value }),
    JSON.stringify({ version: 1, savedAt: new Date().toISOString(), base: "", value: { ...value, agents: [null] } })]) {
    storage.setItem("cortex.project-draft.v1:one", raw);
    assert.equal(readProjectDraft("one", storage), null);
  }
});

test("storage restrictions report unavailable recovery without breaking editing", () => {
  const storage = {
    getItem: () => { throw new Error("denied"); },
    setItem: () => { throw new Error("quota"); },
    removeItem: () => { throw new Error("denied"); }
  };
  assert.equal(readProjectDraft("one", storage), null);
  assert.equal(saveProjectDraft("one", "", value, storage), false);
  assert.doesNotThrow(() => removeProjectDraft("one", storage));
});
