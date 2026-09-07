import assert from "node:assert/strict";
import test from "node:test";
import { AgentUseCase } from "./AgentUseCase.ts";
import type { ProjectContentOutput, ProjectUseCase } from "./ProjectUseCase.ts";
import type { AgentService } from "../service/iaService/AgentService.ts";
import type { AgentWorkflowConfiguration } from "../service/projectService/ProjectService.ts";
import { createAgentWorkflowHash } from "../service/workflowExecution/WorkflowConfiguration.ts";
import type { AgentExecutionOptions } from "../service/iaService/AgentProvider.ts";

function fixture() {
  const file = (name: string, content: string, prefix = "") => ({
    type: "file" as const, name, relativePath: prefix + name,
    size: content.length, content, encoding: "utf8" as const
  });
  const instructions = file("CLAUDE.md", "Independent calendar and news flows.\nJoin their results.");
  const files = ["calendar", "news"].map((name) => file(`${name}.md`,
    `---\nname: ${name}\ndescription: ${name}\n---\nRead ${name}.\nReturn the results.`, ".claude/agents/"));
  const content: ProjectContentOutput = {
    id: "project", directoryPath: process.cwd(), root: {
      type: "directory", name: "project", relativePath: "", children: [instructions, {
        type: "directory", name: ".claude", relativePath: ".claude", children: [{
          type: "directory", name: "agents", relativePath: ".claude/agents", children: files
        }]
      }]
    }
  };
  let cached: AgentWorkflowConfiguration | null = null;
  let analyses = 0;
  let fail = false;
  const options: AgentExecutionOptions[] = [];
  const useCase = new AgentUseCase({
    execute: async (_engine: string, _prompt: string, input: AgentExecutionOptions) => {
      options.push(input);
      analyses++;
      await new Promise(setImmediate);
      if (fail) throw new Error("Engine unavailable");
      return { answer: JSON.stringify({ agents: files.map((agent) => ({
        id: agent.relativePath, nextAgentIds: [], inputMode: "separate"
      })), parameters: [] }) };
    }
  } as unknown as AgentService, {
    getProjectContent: async () => content,
    getAgentWorkflowConfiguration: async () => cached,
    saveAgentWorkflowConfiguration: async (_id: string, value: AgentWorkflowConfiguration) => { cached = value; }
  } as unknown as ProjectUseCase);
  return { useCase, instructions, files, options, count: () => analyses,
    setCache: (value: AgentWorkflowConfiguration) => { cached = value; },
    getCache: () => cached!, setFailure: (value: boolean) => { fail = value; } };
}

test("concurrent loads share one workflow analysis and a stable project instance", async () => {
  const f = fixture();
  const projects = await Promise.all([f.useCase.loadProject("project"), f.useCase.loadProject(" project "), f.useCase.loadProject("project", false)]);
  assert.equal(f.count(), 1);
  assert.ok(projects.every((project) => project === projects[0]));
  assert.ok(projects[0].agents.every((agent) => agent.nextAgentIds.length === 0));
});

test("graph analysis honors an explicitly configured project model regardless of file ordering", async () => {
  const f = fixture();
  f.files[0].content = f.files[0].content.replace("name: calendar", "name: calendar\nmodel: sonnet");
  f.files[1].content = f.files[1].content.replace("name: news", "name: news\nmodel: opus");
  f.files.reverse();
  await f.useCase.loadProject("project");
  assert.equal(f.options[0].model, "sonnet");
  assert.equal(f.options[0].readOnly, true);
  assert.equal(f.options[0].persistSession, false);
});

test("the same graph survives file ordering and Windows/Unix line endings", async () => {
  const f = fixture();
  const first = await f.useCase.loadProject("project");
  f.instructions.content = f.instructions.content.replace(/\n/g, "\r\n");
  f.files.reverse().forEach((file) => { file.content = file.content.replace(/\n/g, "\r\n"); });
  const second = await f.useCase.loadProject("project");
  assert.equal(f.count(), 1);
  assert.deepEqual(new Set(second.agents.map((agent) => agent.id)), new Set(first.agents.map((agent) => agent.id)));
});

test("legacy graph fingerprints remain readable without a new inference", async () => {
  const f = fixture();
  f.files.reverse();
  const project = await f.useCase.loadProject("project");
  const legacyHash = createAgentWorkflowHash(project.instructions, project.agents, true);
  assert.notEqual(legacyHash, f.getCache().hash);
  f.setCache({ ...f.getCache(), hash: legacyHash });
  await f.useCase.loadProject("project");
  assert.equal(f.count(), 1);
});

test("failed concurrent analysis is released for a retry without inventing a graph", async (t) => {
  t.mock.method(console, "warn", () => undefined);
  const f = fixture();
  f.setFailure(true);
  const loads = await Promise.allSettled([f.useCase.loadProject("project"), f.useCase.loadProject("project")]);
  assert.equal(f.count(), 1);
  assert.ok(loads.every((result) => result.status === "rejected" && /Unable to determine the agent workflow/.test(result.reason.message)));
  f.setFailure(false);
  assert.equal((await f.useCase.loadProject("project")).agents.length, 2);
  assert.equal(f.count(), 2);
});
