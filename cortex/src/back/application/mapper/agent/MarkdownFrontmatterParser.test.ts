import assert from "node:assert/strict";
import test from "node:test";
import { parseMarkdownFrontmatter } from "./MarkdownFrontmatterParser.ts";

test("décode les chaînes JSON utilisées par l'éditeur d'agents", () => {
  const parsed = parseMarkdownFrontmatter(`---
name: "L'agent \\"critique\\""
description: "Première ligne\\nSeconde ligne"
---
Analyse le livrable.`);

  assert.equal(parsed.attributes.name, `L'agent "critique"`);
  assert.equal(parsed.attributes.description, "Première ligne\nSeconde ligne");
  assert.equal(parsed.body, "Analyse le livrable.");
});
