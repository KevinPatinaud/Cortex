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
