import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ProjectService } from "./ProjectService.ts";
import { AgentConfigurationService } from "../iaService/AgentConfigurationService.ts";
import { JsonConfigurationRepository } from "../configuration/JsonConfigurationRepository.ts";
import type { AgentService } from "../iaService/AgentService.ts";
import type { DirectoryPickerService } from "./DirectoryPickerService.ts";
import { AgentUseCase } from "../../usecase/AgentUseCase.ts";
import { ProjectUseCase } from "../../usecase/ProjectUseCase.ts";

async function withProjectService(
  assertion: (
    service: ProjectService,
    parentDirectory: string,
    temporaryDirectory: string
  ) => Promise<void>
): Promise<void> {
  const temporaryDirectory = await mkdtemp(
    path.join(os.tmpdir(), "cortex-project-editor-")
  );
  const parentDirectory = path.join(temporaryDirectory, "projects");
  await mkdir(parentDirectory);

  try {
    await assertion(
      new ProjectService(path.join(temporaryDirectory, "config.json")),
      parentDirectory,
      temporaryDirectory
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

test("preserves concurrent project, agent and workflow settings across service instances", async () => {
  await withProjectService(async (service, parentDirectory, directory) => {
    const file = path.join(directory, "config.json");
    const otherService = new ProjectService(file);
    const agentConfiguration = new AgentConfigurationService(file);
    await Promise.all([
      ...Array.from({ length: 12 }, (_, index) =>
        (index % 2 ? service : otherService).saveProject(path.join(parentDirectory, `project-${index}`))
      ),
      agentConfiguration.saveConfiguration({ autopilot: false, allowAll: true }),
      service.saveAgentWorkflowConfiguration("workflow-a", { hash: "a", agents: [], parameters: [] }),
      otherService.saveAgentWorkflowConfiguration("workflow-b", { hash: "b", agents: [], parameters: [] }),
      service.saveManagedProjectsDirectory(path.join(directory, "managed"))
    ]);
    assert.equal((await service.getProjects()).length, 12);
    assert.deepEqual(await otherService.getProjects(), await service.getProjects());
    assert.deepEqual(await agentConfiguration.getConfiguration(), { autopilot: false, allowAll: true });
    assert.equal((await service.getAgentWorkflowConfiguration("workflow-a"))?.hash, "a");
    assert.equal((await service.getAgentWorkflowConfiguration("workflow-b"))?.hash, "b");
    const projects = await service.getProjects();
    await Promise.all(projects.map((project, index) =>
      (index % 2 ? service : otherService).saveWorkflowScheduleConfiguration(project.id, {
        cron: "0 7 * * *", enabled: true, parameterValues: { index: String(index) }
      })
    ));
    const stored = JSON.parse(await readFile(file, "utf8"));
    assert.equal(Object.keys(stored.workflowSchedules).length, 12);
    assert.equal(stored.projectsDirectory, path.join(directory, "managed"));
  });
});

test("validates every edited agent before changing any project file", async () => {
  await withProjectService(async (service, parentDirectory) => {
    const { project } = await service.createProject({
      parentDirectory, name: "Stable", engine: "codex", instructions: "original",
      agents: [{ name: "Review", description: "original", prompt: "original" }]
    });
    const file = path.join(project.directoryPath, ".codex", "agents", "review.toml");
    const original = await readFile(file, "utf8");
    await assert.rejects(service.saveAgentProject(project.id, {
      name: "Stable", engine: "codex", instructions: "changed",
      agents: [
        { id: ".codex/agents/review.toml", name: "Review", description: "changed", prompt: "changed" },
        { id: ".codex/agents/missing.toml", name: "Missing", description: "", prompt: "" }
      ]
    }), /could not be found/);
    assert.equal(await readFile(file, "utf8"), original);
    assert.equal(await readFile(path.join(project.directoryPath, "AGENTS.md"), "utf8"), "original");
    assert.deepEqual(await readdir(parentDirectory), ["Stable"]);
  });
});

test("rolls back files, deleted agents and directory rename when config persistence fails", async (context) => {
  await withProjectService(async (service, parentDirectory, directory) => {
    const { project } = await service.createProject({
      parentDirectory, name: "Stable", engine: "codex", instructions: "original",
      agents: [{ name: "Review", description: "original", prompt: "original" }]
    });
    const file = path.join(project.directoryPath, ".codex", "agents", "review.toml");
    const original = await readFile(file, "utf8");
    const configFile = path.join(directory, "config.json");
    const configuration = await readFile(configFile, "utf8");
    context.mock.method(JsonConfigurationRepository.prototype, "replace", async () => {
      throw Object.assign(new Error("simulated disk full"), { code: "ENOSPC" });
    });
    await assert.rejects(service.saveAgentProject(project.id, {
      name: "Renamed", engine: "codex", instructions: "changed",
      agents: [{ name: "New", description: "changed", prompt: "changed" }]
    }), /simulated disk full/);
    assert.deepEqual(await readdir(parentDirectory), ["Stable"]);
    assert.deepEqual(await readdir(path.dirname(file)), ["review.toml"]);
    assert.equal(await readFile(file, "utf8"), original);
    assert.equal(await readFile(path.join(project.directoryPath, "AGENTS.md"), "utf8"), "original");
    assert.equal(await readFile(configFile, "utf8"), configuration);
  });
});

test("removes an unpublished creation or import when configuration cannot be committed", async (context) => {
  await withProjectService(async (service, parentDirectory) => {
    context.mock.method(JsonConfigurationRepository.prototype, "replace", async () => {
      throw new Error("simulated config failure");
    });
    await assert.rejects(service.createProject({
      parentDirectory, name: "Creation", engine: "codex", instructions: "instructions"
    }), /simulated config failure/);
    await assert.rejects(service.importProject("Import", [
      { relativePath: "AGENTS.md", content: Buffer.from("instructions") }
    ]), /simulated config failure/);
    assert.deepEqual(await readdir(parentDirectory), []);
  });
});

test("crée et enregistre un projet Cortex prêt à être édité", async () => {
  await withProjectService(async (service, parentDirectory) => {
    const result = await service.createProject({
      parentDirectory,
      name: "Atlas",
      engine: "codex",
      instructions: "# Projet Atlas",
      agents: [{
        name: "Architecte",
        description: "Conçoit la solution.",
        prompt: "Propose une architecture adaptée."
      }]
    });
    const projectDirectory = path.join(parentDirectory, "Atlas");

    assert.equal(result.project.directoryPath, projectDirectory);
    assert.equal(result.projects.length, 1);
    assert.equal(
      await readFile(path.join(projectDirectory, "AGENTS.md"), "utf8"),
      "# Projet Atlas"
    );
    assert.deepEqual(
      await readdir(path.join(projectDirectory, ".codex", "agents")),
      ["architecte.toml"]
    );
    assert.match(
      await readFile(
        path.join(projectDirectory, ".codex", "agents", "architecte.toml"),
        "utf8"
      ),
      /developer_instructions = "Propose une architecture adaptée\."/
    );
  });
});

for (const engine of ["codex", "claude", "copilot"] as const) {
  test(`creates, loads and edits an empty ${engine} project without any AI call`, async () => {
    await withProjectService(async (service, parentDirectory, temporaryDirectory) => {
      const agentServiceCalls: string[] = [];
      const agentService = new Proxy({} as AgentService, {
        get(_target, property) {
          agentServiceCalls.push(String(property));
          throw new Error("An empty project must not use the AI service.");
        }
      });
      const projectUseCase = new ProjectUseCase(
        service,
        {} as DirectoryPickerService,
        agentService
      );
      const agentUseCase = new AgentUseCase(agentService, projectUseCase);
      const { project, projects } = await projectUseCase.createProject({
        parentDirectory,
        name: "Empty",
        engine,
        generationMode: "empty",
        instructions: "# Global instructions\n\nWork in French."
      });
      const configurationDirectory = engine === "copilot" ? ".github" : `.${engine}`;
      const instructionsFileName = engine === "claude" ? "CLAUDE.md" : "AGENTS.md";

      assert.deepEqual(await readdir(parentDirectory), ["Empty"]);
      assert.deepEqual(
        (await readdir(project.directoryPath)).sort(),
        [configurationDirectory, instructionsFileName].sort()
      );
      assert.deepEqual(await readdir(path.join(project.directoryPath, configurationDirectory)), ["agents"]);
      assert.deepEqual(await readdir(path.join(project.directoryPath, configurationDirectory, "agents")), [".gitkeep"]);
      assert.equal(await readFile(path.join(project.directoryPath, configurationDirectory, "agents", ".gitkeep"), "utf8"), "");
      assert.equal(
        await readFile(path.join(project.directoryPath, instructionsFileName), "utf8"),
        "# Global instructions\n\nWork in French."
      );
      const reloadedService = new ProjectService(path.join(temporaryDirectory, "config.json"));
      assert.deepEqual(await reloadedService.getProjects(), projects);

      const loadedProject = await agentUseCase.loadProject(project.id);
      assert.equal(loadedProject.engine, engine);
      assert.equal(loadedProject.instructions.fileName, instructionsFileName);
      assert.equal(loadedProject.instructions.content, "# Global instructions\n\nWork in French.");
      assert.deepEqual(loadedProject.agents, []);
      assert.deepEqual(loadedProject.parameters, []);

      await projectUseCase.saveAgentProject(project.id, {
        name: "Empty", engine, instructions: "# Updated global instructions", agents: []
      });
      const editedProject = await agentUseCase.loadProject(project.id);
      assert.equal(editedProject.instructions.content, "# Updated global instructions");
      assert.deepEqual(editedProject.agents, []);
      assert.deepEqual(agentServiceCalls, []);
    });
  });
}

test("importe un dossier envoyé par le navigateur dans le stockage géré", async () => {
  await withProjectService(async (service, parentDirectory) => {
    const result = await service.importProject("Atlas importé", [
      {
        relativePath: "AGENTS.md",
        content: Buffer.from("# Atlas importé", "utf8")
      },
      {
        relativePath: "src/index.ts",
        content: Buffer.from("export const answer = 42;", "utf8")
      }
    ]);
    const projectDirectory = path.join(parentDirectory, "Atlas importé");

    assert.equal(result.project.directoryPath, projectDirectory);
    assert.equal(
      await readFile(path.join(projectDirectory, "AGENTS.md"), "utf8"),
      "# Atlas importé"
    );
    assert.equal(
      await readFile(path.join(projectDirectory, "src", "index.ts"), "utf8"),
      "export const answer = 42;"
    );
  });
});

test("enregistre l’emplacement technique des nouveaux projets", async () => {
  await withProjectService(async (service, parentDirectory, temporaryDirectory) => {
    const customDirectory = path.join(temporaryDirectory, "stockage-personnalise");

    assert.equal(await service.getManagedProjectsDirectory(), parentDirectory);
    assert.equal(
      await service.saveManagedProjectsDirectory(customDirectory),
      customDirectory
    );
    assert.deepEqual(await readdir(customDirectory), []);

    const restoredService = new ProjectService(
      path.join(temporaryDirectory, "config.json")
    );
    assert.equal(
      await restoredService.getManagedProjectsDirectory(),
      customDirectory
    );
  });
});

test("réorganise les projets et conserve leur ordre", async () => {
  await withProjectService(async (service, parentDirectory, temporaryDirectory) => {
    const firstDirectory = path.join(parentDirectory, "Premier");
    const secondDirectory = path.join(parentDirectory, "Second");
    await mkdir(firstDirectory);
    await mkdir(secondDirectory);

    const firstOrder = await service.saveProject(firstDirectory);
    const secondOrder = await service.saveProject(secondDirectory);
    const reordered = await service.reorderProjects([
      secondOrder[1].id,
      firstOrder[0].id
    ]);

    assert.deepEqual(
      reordered.map((project) => project.directoryPath),
      [secondDirectory, firstDirectory]
    );

    const restoredService = new ProjectService(
      path.join(temporaryDirectory, "config.json")
    );
    assert.deepEqual(
      (await restoredService.getProjects()).map((project) => project.directoryPath),
      [secondDirectory, firstDirectory]
    );
    await assert.rejects(
      service.reorderProjects([firstOrder[0].id, firstOrder[0].id]),
      /every project exactly once/
    );
  });
});

test("refuse les chemins dangereux lors d'un import", async () => {
  await withProjectService(async (service, parentDirectory) => {
    await assert.rejects(
      service.importProject("Projet", [
        { relativePath: "AGENTS.md", content: Buffer.from("instructions") },
        { relativePath: "../secret.txt", content: Buffer.from("secret") }
      ]),
      /uploaded path/
    );
    assert.deepEqual(await readdir(parentDirectory), []);
  });
});

test("exige un fichier d'instructions à la racine lors d'un import", async () => {
  await withProjectService(async (service, parentDirectory) => {
    await assert.rejects(
      service.importProject("Projet", [
        { relativePath: "src/index.ts", content: Buffer.from("export {}") }
      ]),
      /AGENTS\.md or CLAUDE\.md/
    );
    assert.deepEqual(await readdir(parentDirectory), []);
  });
});

test("crée, modifie et supprime les fichiers agents d'un projet", async () => {
  await withProjectService(async (service, parentDirectory) => {
    const { project } = await service.createProject({
      parentDirectory,
      name: "Workflow",
      engine: "codex",
      instructions: "Instructions initiales"
    });

    await service.saveAgentProject(project.id, {
      name: "Workflow",
      engine: "codex",
      instructions: "Instructions mises à jour",
      agents: [
        {
          name: "Recherche marché",
          description: "Explore les tendances.",
          prompt: "Trouve les tendances importantes.",
          model: "gpt-5.6-luna"
        },
        {
          name: "Revue",
          description: "Vérifie les résultats.",
          prompt: "Contrôle chaque affirmation."
        }
      ]
    });

    const agentsDirectory = path.join(
      project.directoryPath,
      ".codex",
      "agents"
    );
    assert.deepEqual(
      (await readdir(agentsDirectory)).sort(),
      ["recherche-marche.toml", "revue.toml"]
    );

    await service.saveAgentProject(project.id, {
      name: "Workflow-renamed",
      engine: "codex",
      instructions: "Instructions finales",
      agents: [
        {
          id: ".codex/agents/revue.toml",
          name: "Revue finale",
          description: "Valide le livrable.",
          prompt: "Relis et valide le livrable.",
          reasoningEffort: "high"
        }
      ]
    });

    const renamedAgentsDirectory = path.join(
      parentDirectory,
      "Workflow-renamed",
      ".codex",
      "agents"
    );
    assert.deepEqual(await readdir(renamedAgentsDirectory), ["revue.toml"]);
    const savedAgent = await readFile(
      path.join(renamedAgentsDirectory, "revue.toml"),
      "utf8"
    );
    assert.match(savedAgent, /name = "Revue finale"/);
    assert.match(savedAgent, /model_reasoning_effort = "high"/);
    assert.equal(
      await readFile(
        path.join(parentDirectory, "Workflow-renamed", "AGENTS.md"),
        "utf8"
      ),
      "Instructions finales"
    );
    assert.equal(
      (await service.getProjects())[0]?.directoryPath,
      path.join(parentDirectory, "Workflow-renamed")
    );
  });
});

test("sérialise les agents Claude au format Markdown", async () => {
  await withProjectService(async (service, parentDirectory) => {
    const { project } = await service.createProject({
      parentDirectory,
      name: "Claude project",
      engine: "claude",
      instructions: "Contexte"
    });

    await service.saveAgentProject(project.id, {
      name: "Claude project",
      engine: "claude",
      instructions: "Contexte",
      agents: [{
        name: "L'analyste",
        description: "Analyse : risques et opportunités",
        prompt: "Analyse le dossier.\nPuis synthétise.",
        model: "sonnet",
        reasoningEffort: "high"
      }]
    });

    const content = await readFile(
      path.join(project.directoryPath, ".claude", "agents", "l-analyste.md"),
      "utf8"
    );
    assert.match(content, /^---\nname: "L'analyste"/);
    assert.match(content, /effort: "high"/);
    assert.match(content, /Analyse le dossier\.\nPuis synthétise\./);
  });
});

test("persiste la planification cron d'un workflow", async () => {
  await withProjectService(async (service, parentDirectory) => {
    const { project } = await service.createProject({
      parentDirectory,
      name: "Scheduled",
      engine: "codex",
      instructions: "Contexte"
    });

    await service.saveWorkflowScheduleConfiguration(project.id, {
      cron: "0 7 * * 1-5",
      enabled: true,
      parameterValues: { target: "20" }
    });

    assert.deepEqual(
      await service.getWorkflowScheduleConfiguration(project.id),
      {
        cron: "0 7 * * 1-5",
        enabled: true,
        parameterValues: { target: "20" }
      }
    );

    await service.deleteProject(project.directoryPath);
    assert.equal(
      await service.getWorkflowScheduleConfiguration(project.id),
      null
    );
  });
});

test("converts a Codex project to Copilot during import", async () => {
  await withProjectService(async (service, parentDirectory) => {
    const result = await service.importProject("Atlas Copilot", [
      {
        relativePath: "AGENTS.md",
        content: Buffer.from("# Shared instructions", "utf8")
      },
      {
        relativePath: ".codex/agents/analysis.toml",
        content: Buffer.from([
          'name = "Analysis"',
          'description = "Analyzes data."',
          'model = "gpt-5.6-sol"',
          'model_reasoning_effort = "high"',
          'developer_instructions = "Produce a reliable summary."'
        ].join("\n"), "utf8")
      },
      {
        relativePath: ".github/workflows/quality.yml",
        content: Buffer.from("name: Quality", "utf8")
      },
      {
        relativePath: "src/index.ts",
        content: Buffer.from("export const answer = 42;", "utf8")
      }
    ], "copilot");
    const projectDirectory = path.join(parentDirectory, "Atlas Copilot");
    const convertedAgent = await readFile(
      path.join(projectDirectory, ".github", "agents", "analysis.agent.md"),
      "utf8"
    );

    assert.deepEqual(result.conversion, {
      sourceEngine: "codex",
      targetEngine: "copilot"
    });
    assert.match(convertedAgent, /^---\nname: "Analysis"/);
    assert.match(convertedAgent, /Produce a reliable summary\./);
    assert.doesNotMatch(convertedAgent, /gpt-5\.6-sol|reasoning-effort/);
    assert.equal(
      await readFile(
        path.join(projectDirectory, ".github", "workflows", "quality.yml"),
        "utf8"
      ),
      "name: Quality"
    );
    await assert.rejects(
      readFile(path.join(projectDirectory, ".codex", "agents", "analysis.toml")),
      { code: "ENOENT" }
    );
  });
});

test("converts Claude instructions and agents to Codex", async () => {
  await withProjectService(async (service, parentDirectory) => {
    const result = await service.importProject("Atlas Codex", [
      {
        relativePath: "CLAUDE.md",
        content: Buffer.from("# Claude context", "utf8")
      },
      {
        relativePath: ".claude/agents/review.md",
        content: Buffer.from([
          "---",
          'name: "Review"',
          'description: "Checks the deliverable."',
          'model: "sonnet"',
          "---",
          "Check every claim."
        ].join("\n"), "utf8")
      }
    ], "codex");
    const projectDirectory = path.join(parentDirectory, "Atlas Codex");

    assert.deepEqual(result.conversion, {
      sourceEngine: "claude",
      targetEngine: "codex"
    });
    assert.equal(
      await readFile(path.join(projectDirectory, "AGENTS.md"), "utf8"),
      "# Claude context"
    );
    assert.match(
      await readFile(
        path.join(projectDirectory, ".codex", "agents", "review.toml"),
        "utf8"
      ),
      /developer_instructions = "Check every claim\."/
    );
    await assert.rejects(
      readFile(path.join(projectDirectory, "CLAUDE.md")),
      { code: "ENOENT" }
    );
  });
});
