import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { readAgentProjectDefinition, readProjectTree } from "./ProjectContentReader.ts";

test("workflow definitions ignore large outputs, dependencies and unrelated configuration files", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cortex-definition-"));
  try {
    await mkdir(path.join(directory, ".codex", "agents"), { recursive: true });
    await mkdir(path.join(directory, "node_modules"));
    await writeFile(path.join(directory, "AGENTS.md"), "Instructions");
    await writeFile(path.join(directory, ".codex", "config.toml"), "# Registration");
    await writeFile(path.join(directory, ".codex", "agents", "first.toml"), 'name = "Agent"');
    await writeFile(path.join(directory, "large.bin"), Buffer.alloc(21 * 1024 * 1024));
    await writeFile(path.join(directory, "node_modules", "dependency.js"), "Generated output");
    const result = await readAgentProjectDefinition(directory);
    assert.deepEqual(result.children.map(entry => entry.name), ["AGENTS.md", ".codex"]);
    assert.ok(JSON.stringify(result).includes("first.toml"));
    assert.ok(!JSON.stringify(result).includes("large.bin"));
    await assert.rejects(readProjectTree(directory), /limite/);
    await writeFile(path.join(directory, ".codex", "agents", "first.toml"), "x".repeat(2 * 1024 * 1024 + 1));
    await assert.rejects(readAgentProjectDefinition(directory), /limite/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
