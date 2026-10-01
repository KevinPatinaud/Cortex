import assert from "node:assert/strict";
import test from "node:test";
import { parseAgentResponse } from "./AgentResponse.ts";
import { parseWorkflowDispatchItem } from "./WorkflowAutomation.ts";

const response = (contents: unknown[]) => JSON.stringify({
  status: "success", items: contents.map(content => ({ content })),
  isMultiSelectionAllowed: true, isMultiSelectionThreaded: true,
  nextAgentIds: [], wait: null, notes: null
});

test("normalise trois objets de dossier sans perdre les guillemets ni les retours à la ligne", () => {
  const items = [1, 2, 3].map(index => ({ key: `agence:${index}`, title: `Bien ${index}`, payload: 'Analyse "documentée"\nSource et réserves.' }));
  const parsed = parseAgentResponse(response(items));
  assert.ok(parsed);
  assert.deepEqual(parsed.items.map(item => parseWorkflowDispatchItem(item.content)), items);
});

test("conserve les anciennes réponses textuelles et les dossiers encodés en chaînes", () => {
  const contents = ["Analyse existante", JSON.stringify({ key: "agence:1", title: "Bien", payload: "Analyse" })];
  assert.deepEqual(parseAgentResponse(response(contents))?.items.map(item => item.content), contents);
});

test("rejette les objets de dossier incomplets ou hors limites", () => {
  for (const content of [null, [], {}, { key: "x", title: "Bien" },
    { key: " ", title: "Bien", payload: "Analyse" },
    { key: "x".repeat(201), title: "Bien", payload: "Analyse" },
    { key: "x", title: "Bien", payload: "a".repeat(32001) }]) {
    assert.equal(parseAgentResponse(response([content])), null);
  }
});

test("rejette la fermeture manquante d'une chaîne JSON imbriquée observée en sélection", () => {
  const valid = response([JSON.stringify({ key: "agence:1", title: "Bien", payload: "Analyse" })]);
  const malformed = valid.replace('\\"}"}', '\\"}');
  assert.notEqual(malformed, valid);
  assert.equal(parseAgentResponse(malformed), null);
});
