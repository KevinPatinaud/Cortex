import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ProjectService } from "./ProjectService.ts";

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
      enabled: true
    });

    assert.deepEqual(
      await service.getWorkflowScheduleConfiguration(project.id),
      { cron: "0 7 * * 1-5", enabled: true }
    );

    await service.deleteProject(project.directoryPath);
    assert.equal(
      await service.getWorkflowScheduleConfiguration(project.id),
      null
    );
  });
});
