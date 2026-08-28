import assert from "node:assert/strict";
import test from "node:test";
import type { AgentService } from "../service/iaService/AgentService.ts";
import type { ProjectContentOutput, ProjectUseCase } from "./ProjectUseCase.ts";
import { AgentUseCase } from "./AgentUseCase.ts";

test("does not treat ordinary GitHub files as a Copilot configuration", async () => {
  const projectContent: ProjectContentOutput = {
    id: "project-id",
    directoryPath: "C:\\projects\\converted",
    root: {
      type: "directory",
      name: "converted",
      relativePath: "",
      children: [
        {
          type: "file",
          name: "AGENTS.md",
          relativePath: "AGENTS.md",
          size: 12,
          encoding: "utf8",
          content: "Instructions"
        },
        {
          type: "directory",
          name: ".codex",
          relativePath: ".codex",
          children: [{
            type: "directory",
            name: "agents",
            relativePath: ".codex/agents",
            children: [{
              type: "file",
              name: "review.toml",
              relativePath: ".codex/agents/review.toml",
              size: 128,
              encoding: "utf8",
              content: [
                'name = "Review"',
                'description = "Checks the result."',
                'developer_instructions = "Review the result."'
              ].join("\n")
            }]
          }]
        },
        {
          type: "directory",
          name: ".github",
          relativePath: ".github",
          children: [{
            type: "directory",
            name: "workflows",
            relativePath: ".github/workflows",
            children: []
          }]
        }
      ]
    }
  };
  const projectUseCase = {
    async getProjectContent() {
      return projectContent;
    }
  } as unknown as ProjectUseCase;
  const useCase = new AgentUseCase(
    {} as AgentService,
    projectUseCase
  );

  const project = await useCase.loadProject("project-id");

  assert.equal(project.engine, "codex");
  assert.equal(project.agents.length, 1);
  assert.equal(project.agents[0]?.name, "Review");
});
