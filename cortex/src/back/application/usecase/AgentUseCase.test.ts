import assert from "node:assert/strict";
import test from "node:test";
import type {
  AgentExecutionOptions,
  AgentExecutionResult
} from "../service/iaService/AgentProvider.ts";
import type { AgentService } from "../service/iaService/AgentService.ts";
import type { AgentOrderConfiguration } from "../service/projectService/ProjectService.ts";
import type { ProjectContentOutput } from "./ProjectUseCase.ts";
import type { ProjectUseCase } from "./ProjectUseCase.ts";
import { AgentUseCase } from "./AgentUseCase.ts";

interface ExecutionCall {
  engine: string;
  prompt: string;
  options: AgentExecutionOptions;
}

function createProjectContent(agentCount = 2): ProjectContentOutput {
  const agentFiles = [
    {
      type: "file" as const,
      name: "implementation.md",
      relativePath: ".claude/agents/implementation.md",
      size: 128,
      encoding: "utf8" as const,
      content: `---
name: Implementation
description: Implémente la solution.
---
Implémente le changement demandé.`
    },
    {
      type: "file" as const,
      name: "analysis.md",
      relativePath: ".claude/agents/analysis.md",
      size: 128,
      encoding: "utf8" as const,
      content: `---
name: Analysis
description: Prépare le travail.
---
Analyse les dépendances avant l'implémentation.`
    }
  ].slice(0, agentCount);

  return {
    id: "project-id",
    directoryPath: "C:\\projects\\sample",
    root: {
      type: "directory",
      name: "sample",
      relativePath: "",
      children: [
        {
          type: "file",
          name: "CLAUDE.md",
          relativePath: "CLAUDE.md",
          size: 64,
          encoding: "utf8",
          content: "Toujours analyser avant d'implémenter."
        },
        {
          type: "directory",
          name: ".claude",
          relativePath: ".claude",
          children: [
            {
              type: "directory",
              name: "agents",
              relativePath: ".claude/agents",
              children: agentFiles
            }
          ]
        }
      ]
    }
  };
}

function createUseCase(
  answer: string,
  agentCount = 2
): { useCase: AgentUseCase; calls: ExecutionCall[] } {
  const calls: ExecutionCall[] = [];
  const storedAgentOrders = new Map<string, AgentOrderConfiguration>();
  const agentService = {
    async execute(
      engine: string,
      prompt: string,
      options: AgentExecutionOptions
    ): Promise<AgentExecutionResult> {
      calls.push({ engine, prompt, options });
      return { answer };
    }
  } as unknown as AgentService;
  const projectUseCase = {
    async getProjectContent(): Promise<ProjectContentOutput> {
      return createProjectContent(agentCount);
    },
    async getAgentOrder(
      projectId: string
    ): Promise<AgentOrderConfiguration | null> {
      return storedAgentOrders.get(projectId) ?? null;
    },
    async saveAgentOrder(
      projectId: string,
      agentOrder: AgentOrderConfiguration
    ): Promise<void> {
      storedAgentOrders.set(projectId, agentOrder);
    }
  } as unknown as ProjectUseCase;

  return {
    useCase: new AgentUseCase(agentService, projectUseCase),
    calls
  };
}

function createSequentialUseCase(
  results: AgentExecutionResult[]
): { useCase: AgentUseCase; calls: ExecutionCall[] } {
  const calls: ExecutionCall[] = [];
  const storedAgentOrders = new Map<string, AgentOrderConfiguration>();
  let resultIndex = 0;
  const agentService = {
    async execute(
      engine: string,
      prompt: string,
      options: AgentExecutionOptions
    ): Promise<AgentExecutionResult> {
      calls.push({ engine, prompt, options });
      const result = results[resultIndex];
      resultIndex += 1;

      if (!result) {
        throw new Error("Aucun résultat de moteur préparé pour ce test.");
      }

      return result;
    }
  } as unknown as AgentService;
  const projectUseCase = {
    async getProjectContent(): Promise<ProjectContentOutput> {
      return createProjectContent();
    },
    async getAgentOrder(
      projectId: string
    ): Promise<AgentOrderConfiguration | null> {
      return storedAgentOrders.get(projectId) ?? null;
    },
    async saveAgentOrder(
      projectId: string,
      agentOrder: AgentOrderConfiguration
    ): Promise<void> {
      storedAgentOrders.set(projectId, agentOrder);
    }
  } as unknown as ProjectUseCase;

  return {
    useCase: new AgentUseCase(agentService, projectUseCase),
    calls
  };
}

function createOrderingAnswer(): string {
  return JSON.stringify({
    agents: [
      { id: ".claude/agents/implementation.md", order: 1 },
      { id: ".claude/agents/analysis.md", order: 2 }
    ]
  });
}

function createAgentAnswer(
  items: string[],
  isMultiSelectionAllowed: boolean | null,
  notes = "NE_PAS_TRANSMETTRE"
): string {
  return JSON.stringify({
    status: "success",
    items: items.map((content) => ({ content })),
    isMultiSelectionAllowed,
    notes
  });
}

test("classe les agents selon la réponse du moteur local", async () => {
  const { useCase, calls } = createUseCase(JSON.stringify({
    agents: [
      { id: ".claude/agents/analysis.md", order: 1 },
      { id: ".claude/agents/implementation.md", order: 2 }
    ]
  }));

  const project = await useCase.loadProject("project-id");

  assert.deepEqual(
    project.agents.map((agent) => ({ id: agent.id, order: agent.order })),
    [
      { id: ".claude/agents/analysis.md", order: 1 },
      { id: ".claude/agents/implementation.md", order: 2 }
    ]
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0].engine, "claude");
  assert.deepEqual(calls[0].options, {
    persistSession: false,
    workingDirectory: "C:\\projects\\sample"
  });
  assert.match(calls[0].prompt, /Toujours analyser avant d'implémenter\./);
  assert.match(calls[0].prompt, /\.claude\/agents\/analysis\.md/);
  assert.match(calls[0].prompt, /Analyse les dépendances/);
});

test("réutilise le classement enregistré lorsque le hash est identique", async () => {
  const { useCase, calls } = createUseCase(JSON.stringify({
    agents: [
      { id: ".claude/agents/analysis.md", order: 1 },
      { id: ".claude/agents/implementation.md", order: 2 }
    ]
  }));

  const firstProject = await useCase.loadProject("project-id");
  const secondProject = await useCase.loadProject("project-id");

  assert.equal(calls.length, 1);
  assert.deepEqual(
    secondProject.agents.map((agent) => ({ id: agent.id, order: agent.order })),
    firstProject.agents.map((agent) => ({ id: agent.id, order: agent.order }))
  );
});

test("recalcule le classement lorsque le hash du projet change", async () => {
  const calls: ExecutionCall[] = [];
  const storedAgentOrders = new Map<string, AgentOrderConfiguration>();
  let projectContent = createProjectContent();
  const agentService = {
    async execute(
      engine: string,
      prompt: string,
      options: AgentExecutionOptions
    ): Promise<AgentExecutionResult> {
      calls.push({ engine, prompt, options });
      return { answer: createOrderingAnswer() };
    }
  } as unknown as AgentService;
  const projectUseCase = {
    async getProjectContent(): Promise<ProjectContentOutput> {
      return projectContent;
    },
    async getAgentOrder(
      projectId: string
    ): Promise<AgentOrderConfiguration | null> {
      return storedAgentOrders.get(projectId) ?? null;
    },
    async saveAgentOrder(
      projectId: string,
      agentOrder: AgentOrderConfiguration
    ): Promise<void> {
      storedAgentOrders.set(projectId, agentOrder);
    }
  } as unknown as ProjectUseCase;
  const useCase = new AgentUseCase(agentService, projectUseCase);

  await useCase.loadProject("project-id");
  projectContent = createProjectContent();
  const instructionsFile = projectContent.root.children[0];

  if (instructionsFile.type === "file") {
    instructionsFile.content = "Implémenter avant d'analyser.";
  }

  await useCase.loadProject("project-id");

  assert.equal(calls.length, 2);
});

test("conserve l'ordre des fichiers si le classement est invalide", async (t) => {
  t.mock.method(console, "warn", () => undefined);
  const { useCase } = createUseCase("réponse invalide");

  const project = await useCase.loadProject("project-id");

  assert.deepEqual(
    project.agents.map((agent) => ({ id: agent.id, order: agent.order })),
    [
      { id: ".claude/agents/implementation.md", order: 1 },
      { id: ".claude/agents/analysis.md", order: 2 }
    ]
  );
});

test("attribue directement l'ordre 1 à un agent unique", async () => {
  const { useCase, calls } = createUseCase("", 1);

  const project = await useCase.loadProject("project-id");

  assert.equal(project.agents[0].order, 1);
  assert.equal(calls.length, 0);
});

test("transmet automatiquement l'unique item sans les notes", async () => {
  const { useCase, calls } = createSequentialUseCase([
    { answer: createOrderingAnswer() },
    {
      answer: createAgentAnswer(["Marseille"], null),
      sessionId: "first-session"
    },
    {
      answer: createAgentAnswer(["Temps ensoleillé"], null),
      sessionId: "second-session"
    }
  ]);
  const project = await useCase.loadProject("project-id");
  const [firstAgent, secondAgent] = project.agents;

  await useCase.runAgent("project-id", { agentId: firstAgent.id });
  await useCase.runAgent("project-id", {
    agentId: secondAgent.id,
    previousAgentResult: {
      agentId: firstAgent.id,
      selectedItemIndexes: []
    }
  });

  assert.match(calls[2].prompt, /Marseille/);
  assert.doesNotMatch(calls[2].prompt, /NE_PAS_TRANSMETTRE/);
});

test("transmet uniquement les items sélectionnés sans les notes", async () => {
  const { useCase, calls } = createSequentialUseCase([
    { answer: createOrderingAnswer() },
    {
      answer: createAgentAnswer(
        ["CHOIX_ALPHA", "CHOIX_BETA", "CHOIX_GAMMA"],
        true
      ),
      sessionId: "first-session"
    },
    {
      answer: createAgentAnswer(["Résultat final"], null),
      sessionId: "second-session"
    }
  ]);
  const project = await useCase.loadProject("project-id");
  const [firstAgent, secondAgent] = project.agents;

  await useCase.runAgent("project-id", { agentId: firstAgent.id });
  await useCase.runAgent("project-id", {
    agentId: secondAgent.id,
    previousAgentResult: {
      agentId: firstAgent.id,
      selectedItemIndexes: [0, 2]
    }
  });

  assert.match(calls[2].prompt, /CHOIX_ALPHA/);
  assert.match(calls[2].prompt, /CHOIX_GAMMA/);
  assert.doesNotMatch(calls[2].prompt, /CHOIX_BETA/);
  assert.doesNotMatch(calls[2].prompt, /NE_PAS_TRANSMETTRE/);
});

test("conserve des exécutions indépendantes lors de la navigation entre projets", async () => {
  const calls: ExecutionCall[] = [];
  const resolvers: Array<(result: AgentExecutionResult) => void> = [];
  const agentService = {
    async execute(
      engine: string,
      prompt: string,
      options: AgentExecutionOptions
    ): Promise<AgentExecutionResult> {
      calls.push({ engine, prompt, options });

      return new Promise((resolve) => resolvers.push(resolve));
    }
  } as unknown as AgentService;
  const projectUseCase = {
    async getProjectContent(projectId: string): Promise<ProjectContentOutput> {
      const content = createProjectContent(1);
      content.id = projectId;
      content.directoryPath = `C:\\projects\\${projectId}`;
      return content;
    },
    async getAgentOrder(): Promise<null> {
      return null;
    },
    async saveAgentOrder(): Promise<void> {}
  } as unknown as ProjectUseCase;
  const useCase = new AgentUseCase(agentService, projectUseCase);
  const projectA = await useCase.loadProject("project-a");
  const agentId = projectA.agents[0].id;
  const runA = useCase.runAgent("project-a", { agentId });

  assert.equal(
    (await useCase.loadProject("project-a")).agents[0].executionStatus,
    "running"
  );

  await useCase.loadProject("project-b");
  const runB = useCase.runAgent("project-b", { agentId });

  assert.equal(
    (await useCase.loadProject("project-a")).agents[0].executionStatus,
    "running"
  );
  assert.equal(
    (await useCase.loadProject("project-b")).agents[0].executionStatus,
    "running"
  );
  assert.equal(calls[0].options.workingDirectory, "C:\\projects\\project-a");
  assert.equal(calls[1].options.workingDirectory, "C:\\projects\\project-b");

  resolvers[0]({
    answer: createAgentAnswer(["Résultat A"], null),
    sessionId: "session-a"
  });
  resolvers[1]({
    answer: createAgentAnswer(["Résultat B"], null),
    sessionId: "session-b"
  });
  await Promise.all([runA, runB]);

  assert.equal(
    (await useCase.loadProject("project-a")).agents[0].executionStatus,
    "idle"
  );
  assert.equal(
    (await useCase.loadProject("project-b")).agents[0].executionStatus,
    "idle"
  );
});

test("expose l'échec d'un agent après une erreur du moteur", async () => {
  const agentService = {
    async execute(): Promise<AgentExecutionResult> {
      throw new Error("Moteur indisponible");
    }
  } as unknown as AgentService;
  const projectUseCase = {
    async getProjectContent(): Promise<ProjectContentOutput> {
      return createProjectContent(1);
    },
    async getAgentOrder(): Promise<null> {
      return null;
    },
    async saveAgentOrder(): Promise<void> {}
  } as unknown as ProjectUseCase;
  const useCase = new AgentUseCase(agentService, projectUseCase);
  const project = await useCase.loadProject("project-id");

  await assert.rejects(
    useCase.runAgent("project-id", { agentId: project.agents[0].id }),
    /Moteur indisponible/
  );

  const refreshedProject = await useCase.loadProject("project-id");
  assert.equal(refreshedProject.agents[0].executionStatus, "failed");
  assert.equal(
    refreshedProject.agents[0].executionError,
    "Moteur indisponible"
  );
});

test("refuse de réinitialiser un workflow pendant son exécution", async () => {
  let resolveExecution: ((result: AgentExecutionResult) => void) | undefined;
  const agentService = {
    async execute(): Promise<AgentExecutionResult> {
      return new Promise((resolve) => {
        resolveExecution = resolve;
      });
    }
  } as unknown as AgentService;
  const projectUseCase = {
    async getProjectContent(): Promise<ProjectContentOutput> {
      return createProjectContent(1);
    },
    async getAgentOrder(): Promise<null> {
      return null;
    },
    async saveAgentOrder(): Promise<void> {}
  } as unknown as ProjectUseCase;
  const useCase = new AgentUseCase(agentService, projectUseCase);
  const project = await useCase.loadProject("project-id");
  const runningExecution = useCase.runAgent("project-id", {
    agentId: project.agents[0].id
  });

  assert.throws(
    () => useCase.resetWorkflow("project-id"),
    /pendant une exécution/
  );

  resolveExecution?.({
    answer: createAgentAnswer(["Terminé"], null),
    sessionId: "session-id"
  });
  await runningExecution;
});
