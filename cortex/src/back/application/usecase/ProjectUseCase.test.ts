import assert from "node:assert/strict";
import test from "node:test";
import type { AgentService } from "../service/iaService/AgentService.ts";
import type { DirectoryPickerService } from "../service/projectService/DirectoryPickerService.ts";
import type {
  CreateProjectOptions,
  ProjectService
} from "../service/projectService/ProjectService.ts";
import { ProjectUseCase } from "./ProjectUseCase.ts";

function createUseCase(answer: string): {
  useCase: ProjectUseCase;
  executionCalls: Array<{ prompt: string; options: unknown }>;
  creationCalls: CreateProjectOptions[];
} {
  const executionCalls: Array<{ prompt: string; options: unknown }> = [];
  const creationCalls: CreateProjectOptions[] = [];
  const projectService = {
    async ensureManagedProjectsDirectory() {
      return "C:\\managed-projects";
    },
    async assertProjectCanBeCreated() {},
    async createProject(options: CreateProjectOptions) {
      creationCalls.push(options);
      const project = {
        id: "project-id",
        directoryPath: `${options.parentDirectory}/${options.name}`
      };
      return { project, projects: [project] };
    }
  } as unknown as ProjectService;
  const agentService = {
    async executeActive(prompt: string, options: unknown) {
      executionCalls.push({ prompt, options });
      return { answer };
    }
  } as unknown as AgentService;

  return {
    useCase: new ProjectUseCase(
      projectService,
      {} as DirectoryPickerService,
      agentService
    ),
    executionCalls,
    creationCalls
  };
}

test("utilise le stockage technique géré quand aucun emplacement n’est fourni", async () => {
  const { useCase, executionCalls, creationCalls } = createUseCase(
    JSON.stringify({
      instructions: "# Atlas",
      agents: [{
        name: "Coordination",
        description: "Coordonne le projet.",
        prompt: "Produis le résultat attendu."
      }]
    })
  );

  await useCase.createProject({
    name: "Atlas",
    engine: "codex",
    description: "Créer un projet géré par Cortex."
  });

  assert.deepEqual(executionCalls[0].options, {
    persistSession: false,
    workingDirectory: "C:\\managed-projects"
  });
  assert.equal(creationCalls[0].parentDirectory, "C:\\managed-projects");
});

test("génère les instructions et les agents à partir de la description", async () => {
  const generatedProject = {
    instructions: "# Atlas\n\nConstruire un observatoire fiable.",
    agents: [
      {
        name: "Collecte",
        description: "Rassemble les données utiles.",
        prompt: "Collecte les sources et livre un jeu de données documenté."
      },
      {
        name: "Analyse",
        description: "Analyse les données collectées.",
        prompt: "Analyse les données reçues et livre une synthèse argumentée."
      }
    ]
  };
  const { useCase, executionCalls, creationCalls } = createUseCase(
    JSON.stringify(generatedProject)
  );

  await useCase.createProject({
    parentDirectory: "C:\\projects",
    name: "Atlas",
    engine: "claude",
    generationMode: "ai",
    description: "Créer un observatoire des tendances du marché."
  });

  assert.equal(executionCalls.length, 1);
  assert.match(
    executionCalls[0].prompt,
    /Créer un observatoire des tendances du marché\./
  );
  assert.deepEqual(executionCalls[0].options, {
    persistSession: false,
    workingDirectory: "C:\\projects"
  });
  assert.deepEqual(creationCalls, [{
    parentDirectory: "C:\\projects",
    name: "Atlas",
    engine: "claude",
    ...generatedProject
  }]);
});

test("refuse une réponse IA invalide avant de créer le dossier", async () => {
  const { useCase, creationCalls } = createUseCase("pas du JSON");

  await assert.rejects(
    useCase.createProject({
      parentDirectory: "C:\\projects",
      name: "Atlas",
      engine: "codex",
      description: "Créer un projet."
    }),
    /active AI engine returned an invalid project/
  );
  assert.equal(creationCalls.length, 0);
});

test("preserves Markdown whitespace in custom instructions without calling AI", async () => {
  const { useCase, executionCalls, creationCalls } = createUseCase("invalid AI answer");

  await useCase.createProject({
    name: "Atlas",
    engine: "copilot",
    generationMode: "empty",
    instructions: "    const language = 'French';\n\nWrite in French.  \n"
  });

  assert.deepEqual(executionCalls, []);
  assert.deepEqual(creationCalls, [{
    parentDirectory: "C:\\managed-projects",
    name: "Atlas",
    engine: "copilot",
    instructions: "    const language = 'French';\n\nWrite in French.  \n",
    agents: []
  }]);
});

test("supplies minimal global instructions when empty-project instructions are omitted or blank", async () => {
  for (const instructions of [undefined, "", " \n\t "]) {
    const { useCase, executionCalls, creationCalls } = createUseCase("invalid AI answer");

    await useCase.createProject({
      name: " Atlas ",
      engine: "codex",
      generationMode: "empty",
      instructions
    });

    assert.deepEqual(executionCalls, []);
    assert.equal(creationCalls[0].instructions, "# Atlas\n\n## Instructions globales\n\nÀ compléter.\n");
    assert.deepEqual(creationCalls[0].agents, []);
  }
});

test("validates the creation mode before generating or saving a project", async () => {
  for (const generationMode of [null, true, "manual", ""]) {
    const { useCase, executionCalls, creationCalls } = createUseCase("invalid AI answer");

    await assert.rejects(useCase.createProject({
      name: "Atlas",
      engine: "codex",
      generationMode,
      description: "Create a project."
    }), /project generation mode is invalid/);

    assert.deepEqual(executionCalls, []);
    assert.deepEqual(creationCalls, []);
  }
});

test("validates custom instructions before saving an empty project", async () => {
  for (const instructions of [null, 42, {}, "x".repeat(20_001), ` ${"x".repeat(20_000)} `]) {
    const { useCase, executionCalls, creationCalls } = createUseCase("invalid AI answer");

    await assert.rejects(useCase.createProject({
      name: "Atlas",
      engine: "claude",
      generationMode: "empty",
      instructions
    }), /project instructions (are invalid|must not exceed 20,000 characters)/);

    assert.deepEqual(executionCalls, []);
    assert.deepEqual(creationCalls, []);
  }
});

test("accepts exactly 20,000 characters of custom instructions", async () => {
  const { useCase, executionCalls, creationCalls } = createUseCase("invalid AI answer");

  await useCase.createProject({
    name: "Atlas",
    engine: "codex",
    generationMode: "empty",
    instructions: "x".repeat(20_000)
  });

  assert.deepEqual(executionCalls, []);
  assert.equal(creationCalls[0].instructions.length, 20_000);
});

test("requires a bounded description for explicit and default AI generation", async () => {
  for (const generationMode of [undefined, "ai"]) {
    for (const description of [undefined, " \n ", "x".repeat(20_001)]) {
      const { useCase, executionCalls, creationCalls } = createUseCase("invalid AI answer");

      await assert.rejects(useCase.createProject({
        name: "Atlas",
        engine: "codex",
        generationMode,
        description
      }), /project description (is required|must not exceed 20,000 characters)/);

      assert.deepEqual(executionCalls, []);
      assert.deepEqual(creationCalls, []);
    }
  }
});

test("demande une architecture minimale et confie le fan-out a Cortex", async () => {
  const generatedProject = {
    instructions: "# Applications au demarrage",
    agents: [
      {
        name: "Inventaire",
        description: "Liste les applications lancees au demarrage.",
        prompt: "Retourne les applications sous forme d'elements selectionnables."
      },
      {
        name: "Desactivation",
        description: "Desactive une application selectionnee.",
        prompt: "Une instance traite exactement une application selectionnee."
      }
    ]
  };
  const { useCase, executionCalls, creationCalls } = createUseCase(
    JSON.stringify(generatedProject)
  );

  await useCase.createProject({
    parentDirectory: "C:\\projects",
    name: "Demarrage",
    engine: "codex",
    description: "Un agent liste les applications. Un second agent multithreade desactive chaque selection."
  });

  const prompt = executionCalls[0].prompt;
  assert.match(prompt, /prefer the smallest sufficient set of agents/);
  assert.match(prompt, /respect an explicit number or set of agents requested/);
  assert.match(prompt, /do not create agents for Cortex control-plane concerns/);
  assert.match(prompt, /one reusable downstream agent definition/);
  assert.match(prompt, /means exactly two agent definitions/);
  assert.equal(creationCalls[0].agents?.length, 2);
});

test("uses the active engine as the import conversion target", async () => {
  const importCalls: Array<{
    name: string;
    targetEngine: string | null | undefined;
  }> = [];
  const project = { id: "project-id", directoryPath: "C:\\projects\\Atlas" };
  const projectService = {
    async importProject(
      name: string,
      _files: unknown[],
      targetEngine: string | null | undefined
    ) {
      importCalls.push({ name, targetEngine });
      return { project, projects: [project] };
    }
  } as unknown as ProjectService;
  const agentService = {
    async getStatus() {
      return { engine: "copilot", label: "GitHub Copilot", error: null };
    }
  } as unknown as AgentService;
  const useCase = new ProjectUseCase(
    projectService,
    {} as DirectoryPickerService,
    agentService
  );

  await useCase.importProject("Atlas", [{
    relativePath: "AGENTS.md",
    content: Buffer.from("# Atlas")
  }]);

  assert.deepEqual(importCalls, [{ name: "Atlas", targetEngine: "copilot" }]);
});
