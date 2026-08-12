import assert from "node:assert/strict";
import test from "node:test";
import type { Tool } from "@github/copilot-sdk";
import { AgentToolRegistry } from "./AgentToolRegistry.ts";

function createTool(name: string): Tool {
  return { name };
}

test("résout uniquement les outils des capacités demandées", () => {
  const registry = new AgentToolRegistry()
    .register("github", () => createTool("list_pull_requests"))
    .register("jira", () => createTool("list_issues"));

  const tools = registry.resolve(["github"]);

  assert.deepEqual(tools.map((tool) => tool.name), ["list_pull_requests"]);
});

test("ne résout une capacité qu'une fois", () => {
  const registry = new AgentToolRegistry()
    .register("github", () => createTool("list_pull_requests"));

  const tools = registry.resolve(["github", "github"]);

  assert.deepEqual(tools.map((tool) => tool.name), ["list_pull_requests"]);
});

test("rejette les collisions de noms entre capacités", () => {
  const registry = new AgentToolRegistry()
    .register("github", () => createTool("search"))
    .register("jira", () => createTool("search"));

  assert.throws(
    () => registry.resolve(["github", "jira"]),
    /search est enregistré plusieurs fois/
  );
});