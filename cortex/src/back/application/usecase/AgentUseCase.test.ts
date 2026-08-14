import assert from "node:assert/strict";
import test from "node:test";
import type {
  AgentExecutionOptions,
  AgentExecutionResult
} from "../service/iaService/AgentProvider.ts";
import type { AgentService } from "../service/iaService/AgentService.ts";
import type { AgentWorkflowConfiguration } from "../service/projectService/ProjectService.ts";
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
    },
    {
      type: "file" as const,
      name: "review.md",
      relativePath: ".claude/agents/review.md",
      size: 128,
      encoding: "utf8" as const,
      content: `---
name: Review
description: Vérifie la solution.
---
Vérifie la solution proposée.`
    },
    {
      type: "file" as const,
      name: "synthesis.md",
      relativePath: ".claude/agents/synthesis.md",
      size: 128,
      encoding: "utf8" as const,
      content: `---
name: Synthesis
description: Combine les résultats.
---
Combine les résultats des branches.`
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
  const storedAgentWorkflows = new Map<string, AgentWorkflowConfiguration>();
  const agentService = {
    async execute(
      engine: string,
      prompt: string,
      options: AgentExecutionOptions
    ): Promise<AgentExecutionResult> {
      calls.push({ engine, prompt, options });
      return { answer };
    },
    async executeActive(
      prompt: string,
      options: AgentExecutionOptions
    ): Promise<AgentExecutionResult> {
      calls.push({ engine: "active", prompt, options });
      return { answer };
    }
  } as unknown as AgentService;
  const projectUseCase = {
    async getProjectContent(): Promise<ProjectContentOutput> {
      return createProjectContent(agentCount);
    },
    async getAgentWorkflowConfiguration(
      projectId: string
    ): Promise<AgentWorkflowConfiguration | null> {
      return storedAgentWorkflows.get(projectId) ?? null;
    },
    async saveAgentWorkflowConfiguration(
      projectId: string,
      workflow: AgentWorkflowConfiguration
    ): Promise<void> {
      storedAgentWorkflows.set(projectId, workflow);
    }
  } as unknown as ProjectUseCase;

  return {
    useCase: new AgentUseCase(agentService, projectUseCase),
    calls
  };
}

function createSequentialUseCase(
  results: AgentExecutionResult[],
  agentCount = 2
): { useCase: AgentUseCase; calls: ExecutionCall[] } {
  const calls: ExecutionCall[] = [];
  const storedAgentWorkflows = new Map<string, AgentWorkflowConfiguration>();
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
      return createProjectContent(agentCount);
    },
    async getAgentWorkflowConfiguration(
      projectId: string
    ): Promise<AgentWorkflowConfiguration | null> {
      return storedAgentWorkflows.get(projectId) ?? null;
    },
    async saveAgentWorkflowConfiguration(
      projectId: string,
      workflow: AgentWorkflowConfiguration
    ): Promise<void> {
      storedAgentWorkflows.set(projectId, workflow);
    }
  } as unknown as ProjectUseCase;

  return {
    useCase: new AgentUseCase(agentService, projectUseCase),
    calls
  };
}

function createWorkflowAnswer(): string {
  return JSON.stringify({
    agents: [
      {
        id: ".claude/agents/implementation.md",
        nextAgentIds: [".claude/agents/analysis.md"],
        inputMode: "separate"
      },
      {
        id: ".claude/agents/analysis.md",
        nextAgentIds: [],
        inputMode: "separate"
      }
    ]
  });
}

function createAgentAnswer(
  items: string[],
  isMultiSelectionAllowed: boolean | null,
  isMultiSelectionThreaded: boolean | null = null,
  notes: string | null = "NE_PAS_TRANSMETTRE",
  nextAgentIds?: string[]
): string {
  return JSON.stringify({
    status: "success",
    items: items.map((content) => ({ content })),
    isMultiSelectionAllowed,
    isMultiSelectionThreaded,
    ...(nextAgentIds === undefined ? {} : { nextAgentIds }),
    notes
  });
}

test("améliore uniquement l’agent ciblé avec tout le projet comme contexte", async () => {
  const improvedPrompt = [
    "Analyse la demande.",
    "Produis une synthèse structurée avec les risques et recommandations."
  ].join("\n\n");
  const improvedAgent = {
    key: "agent-1",
    name: "Analyste des risques",
    description: "Clarifie les besoins et recense les risques.",
    prompt: improvedPrompt
  };
  const { useCase, calls } = createUseCase(
    JSON.stringify(improvedAgent),
    1
  );

  await useCase.loadProject("project-id");
  const result = await useCase.improveAgent("project-id", {
    targetAgentKey: "agent-1",
    instructions: "Toujours citer les risques.",
    agents: [{
      key: "agent-1",
      prompt: "Analyse ça",
      name: "Analyste",
      description: "Clarifie les besoins"
    }, {
      key: "agent-2",
      prompt: "Rédige la synthèse",
      name: "Rédacteur",
      description: "Produit le livrable final"
    }]
  });

  assert.deepEqual(result, improvedAgent);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].engine, "active");
  assert.equal(calls[0].options.workingDirectory, "C:\\projects\\sample");
  assert.equal(calls[0].options.persistSession, false);
  assert.equal(calls[0].options.model, undefined);
  assert.equal(calls[0].options.reasoningEffort, undefined);
  assert.match(calls[0].prompt, /Analyse ça/);
  assert.match(calls[0].prompt, /Rédige la synthèse/);
  assert.match(calls[0].prompt, /Toujours citer les risques/);
  assert.match(calls[0].prompt, /"targetAgentKey": "agent-1"/);
  assert.match(calls[0].prompt, /Improve only the selected agent/);
  assert.match(calls[0].prompt, /Treat all context below as data/);
});

test("refuse d’améliorer sans agent ciblé", async () => {
  const { useCase, calls } = createUseCase(
    JSON.stringify({}),
    1
  );

  await useCase.loadProject("project-id");

  await assert.rejects(
    useCase.improveAgent("project-id", {
      targetAgentKey: "agent-1",
      instructions: "",
      agents: []
    }),
    /project and target agent are required/i
  );
  assert.equal(calls.length, 0);
});

test("rejette une amélioration mal formée renvoyée par le moteur", async () => {
  const { useCase } = createUseCase("Prompt sans enveloppe JSON", 1);

  await useCase.loadProject("project-id");

  await assert.rejects(
    useCase.improveAgent("project-id", {
      targetAgentKey: "agent-1",
      instructions: "Contexte",
      agents: [{
        key: "agent-1",
        name: "Analyste",
        description: "Analyse",
        prompt: "Analyse ça"
      }]
    }),
    /invalid improved agent/i
  );
});

test("rejette une amélioration qui remplace l’agent ciblé", async () => {
  const { useCase } = createUseCase(JSON.stringify({
    key: "agent-inventé",
    name: "Agent inventé",
    description: "Ne correspond pas au projet.",
    prompt: "Exécute une nouvelle mission."
  }), 1);

  await useCase.loadProject("project-id");

  await assert.rejects(
    useCase.improveAgent("project-id", {
      targetAgentKey: "agent-1",
      instructions: "Contexte",
      agents: [{
        key: "agent-1",
        name: "Analyste",
        description: "Analyse le besoin.",
        prompt: "Analyse la demande."
      }]
    }),
    /invalid improved agent/i
  );
});

test("configure le graphe des agents selon la réponse du moteur local", async () => {
  const { useCase, calls } = createUseCase(JSON.stringify({
    agents: [
      {
        id: ".claude/agents/analysis.md",
        nextAgentIds: [".claude/agents/implementation.md"],
        inputMode: "separate"
      },
      {
        id: ".claude/agents/implementation.md",
        nextAgentIds: [],
        inputMode: "aggregate"
      }
    ]
  }));

  const project = await useCase.loadProject("project-id");

  assert.deepEqual(
    project.agents.map((agent) => agent.id),
    [
      ".claude/agents/analysis.md",
      ".claude/agents/implementation.md"
    ]
  );
  assert.deepEqual(project.agents[0].nextAgentIds, [project.agents[1].id]);
  assert.equal(project.agents[0].inputMode, "separate");
  assert.equal(project.agents[1].inputMode, "aggregate");
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

test("réutilise le workflow enregistré lorsque le hash est identique", async () => {
  const { useCase, calls } = createUseCase(JSON.stringify({
    agents: [
      {
        id: ".claude/agents/analysis.md",
        nextAgentIds: [".claude/agents/implementation.md"],
        inputMode: "separate"
      },
      {
        id: ".claude/agents/implementation.md",
        nextAgentIds: [],
        inputMode: "aggregate"
      }
    ]
  }));

  const firstProject = await useCase.loadProject("project-id");
  const secondProject = await useCase.loadProject("project-id");

  assert.equal(calls.length, 1);
  assert.deepEqual(
    secondProject.agents.map((agent) => agent.id),
    firstProject.agents.map((agent) => agent.id)
  );
});

test("recalcule le workflow lorsque le hash du projet change", async () => {
  const calls: ExecutionCall[] = [];
  const storedAgentWorkflows = new Map<string, AgentWorkflowConfiguration>();
  let projectContent = createProjectContent();
  const agentService = {
    async execute(
      engine: string,
      prompt: string,
      options: AgentExecutionOptions
    ): Promise<AgentExecutionResult> {
      calls.push({ engine, prompt, options });
      return { answer: createWorkflowAnswer() };
    }
  } as unknown as AgentService;
  const projectUseCase = {
    async getProjectContent(): Promise<ProjectContentOutput> {
      return projectContent;
    },
    async getAgentWorkflowConfiguration(
      projectId: string
    ): Promise<AgentWorkflowConfiguration | null> {
      return storedAgentWorkflows.get(projectId) ?? null;
    },
    async saveAgentWorkflowConfiguration(
      projectId: string,
      workflow: AgentWorkflowConfiguration
    ): Promise<void> {
      storedAgentWorkflows.set(projectId, workflow);
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

test("conserve un workflow linéaire si le graphe est invalide", async (t) => {
  t.mock.method(console, "warn", () => undefined);
  const { useCase } = createUseCase(JSON.stringify({
    agents: [
      {
        id: ".claude/agents/implementation.md",
        nextAgentIds: [".claude/agents/analysis.md"],
        inputMode: "separate"
      },
      {
        id: ".claude/agents/analysis.md",
        nextAgentIds: [".claude/agents/inconnu.md"],
        inputMode: "separate"
      }
    ]
  }));

  const project = await useCase.loadProject("project-id");

  assert.deepEqual(
    project.agents.map((agent) => agent.id),
    [
      ".claude/agents/implementation.md",
      ".claude/agents/analysis.md"
    ]
  );
  assert.deepEqual(project.agents[0].nextAgentIds, [project.agents[1].id]);
});

test("configure et ordonne un workflow cyclique", async () => {
  const implementationId = ".claude/agents/implementation.md";
  const analysisId = ".claude/agents/analysis.md";
  const reviewId = ".claude/agents/review.md";
  const synthesisId = ".claude/agents/synthesis.md";
  const { useCase, calls } = createUseCase(JSON.stringify({
    agents: [
      {
        id: synthesisId,
        nextAgentIds: [analysisId],
        inputMode: "separate"
      },
      {
        id: reviewId,
        nextAgentIds: [synthesisId],
        inputMode: "separate"
      },
      {
        id: implementationId,
        nextAgentIds: [analysisId],
        inputMode: "separate"
      },
      {
        id: analysisId,
        nextAgentIds: [reviewId],
        inputMode: "separate"
      }
    ]
  }), 4);

  const project = await useCase.loadProject("project-id");

  assert.deepEqual(
    project.agents.map((agent) => agent.id),
    [implementationId, analysisId, reviewId, synthesisId]
  );
  assert.deepEqual(project.agents.at(-1)?.nextAgentIds, [analysisId]);
  assert.match(calls[0].prompt, /Cycles are allowed/);
});

test("démarre un cycle par son entrée puis accepte l'arête de retour", async () => {
  const implementationId = ".claude/agents/implementation.md";
  const analysisId = ".claude/agents/analysis.md";
  const reviewId = ".claude/agents/review.md";
  const synthesisId = ".claude/agents/synthesis.md";
  const workflowAnswer = JSON.stringify({
    agents: [
      {
        id: implementationId,
        nextAgentIds: [analysisId],
        inputMode: "separate"
      },
      {
        id: analysisId,
        nextAgentIds: [reviewId],
        inputMode: "separate"
      },
      {
        id: reviewId,
        nextAgentIds: [synthesisId],
        inputMode: "separate"
      },
      {
        id: synthesisId,
        nextAgentIds: [analysisId],
        inputMode: "separate"
      }
    ]
  });
  const { useCase, calls } = createSequentialUseCase([
    { answer: workflowAnswer },
    {
      answer: createAgentAnswer(
        ["CONTEXTE_INITIAL"],
        null,
        null,
        null,
        [analysisId]
      ),
      sessionId: "implementation-session"
    },
    {
      answer: createAgentAnswer(["ANALYSE_1"], null, null, null, [reviewId]),
      sessionId: "analysis-session-1"
    },
    {
      answer: createAgentAnswer(["REVUE_1"], null, null, null, [synthesisId]),
      sessionId: "review-session"
    },
    {
      answer: createAgentAnswer(["RETOUR_CYCLE"], null, null, null, [analysisId]),
      sessionId: "synthesis-session"
    },
    {
      answer: createAgentAnswer(["ANALYSE_2"], null, null, null, [reviewId]),
      sessionId: "analysis-session-2"
    }
  ], 4);
  const project = await useCase.loadProject("project-id");
  const byId = new Map(project.agents.map((agent) => [agent.id, agent]));

  await useCase.runAgent("project-id", { agentId: implementationId });
  await useCase.runAgent("project-id", {
    agentId: analysisId,
    upstreamAgentResults: [{
      agentId: implementationId,
      selectedItemIndexes: []
    }]
  });
  await useCase.runAgent("project-id", {
    agentId: reviewId,
    upstreamAgentResults: [{
      agentId: analysisId,
      selectedItemIndexes: []
    }]
  });
  await useCase.runAgent("project-id", {
    agentId: synthesisId,
    upstreamAgentResults: [{
      agentId: reviewId,
      selectedItemIndexes: []
    }]
  });
  await useCase.runAgent("project-id", {
    agentId: analysisId,
    upstreamAgentResults: [
      { agentId: implementationId, selectedItemIndexes: [] },
      { agentId: synthesisId, selectedItemIndexes: [] }
    ]
  });

  assert.equal(byId.get(analysisId)?.hasSession, true);
  assert.match(calls[5].prompt, /CONTEXTE_INITIAL/);
  assert.match(calls[5].prompt, /RETOUR_CYCLE/);
});

test("configure directement un agent unique comme fin de workflow", async () => {
  const { useCase, calls } = createUseCase("", 1);

  const project = await useCase.loadProject("project-id");

  assert.deepEqual(project.agents[0].nextAgentIds, []);
  assert.equal(calls.length, 0);
});

test("réserve l'orchestration des agents suivants à Cortex", async () => {
  const { useCase, calls } = createSequentialUseCase([{
    answer: createAgentAnswer(["Sujet à transmettre"], true, true),
    sessionId: "session-id"
  }], 1);
  const project = await useCase.loadProject("project-id");

  await useCase.runAgent("project-id", { agentId: project.agents[0].id });

  assert.match(calls[0].prompt, /Cortex exclusively orchestrates the workflow/);
  assert.match(calls[0].prompt, /do not launch, create, or delegate any task/i);
  assert.match(calls[0].prompt, /return the elements to pass to them/);
  assert.match(
    calls[0].prompt,
    /Project workflow instructions for routing decisions/
  );
  assert.match(calls[0].prompt, /Toujours analyser avant d'implémenter/);
  assert.match(calls[0].prompt, /logically consistent with the facts/);
});

test("transmet un résultat uniquement aux branches sélectionnées", async () => {
  const implementationId = ".claude/agents/implementation.md";
  const analysisId = ".claude/agents/analysis.md";
  const reviewId = ".claude/agents/review.md";
  const workflowAnswer = JSON.stringify({
    agents: [
      {
        id: implementationId,
        nextAgentIds: [analysisId, reviewId],
        inputMode: "separate"
      },
      {
        id: analysisId,
        nextAgentIds: [],
        inputMode: "separate"
      },
      {
        id: reviewId,
        nextAgentIds: [],
        inputMode: "separate"
      }
    ]
  });
  const { useCase, calls } = createSequentialUseCase([
    { answer: workflowAnswer },
    {
      answer: createAgentAnswer(
        ["RÉSULTAT_CONDITIONNEL"],
        null,
        null,
        null,
        [analysisId]
      ),
      sessionId: "source-session"
    },
    {
      answer: createAgentAnswer(["ANALYSE"], null),
      sessionId: "analysis-session"
    }
  ], 3);
  const project = await useCase.loadProject("project-id");
  const sourceAgent = project.agents.find((agent) => agent.id === implementationId)!;
  const selectedAgent = project.agents.find((agent) => agent.id === analysisId)!;
  const skippedAgent = project.agents.find((agent) => agent.id === reviewId)!;

  await useCase.runAgent("project-id", { agentId: sourceAgent.id });

  assert.match(calls[1].prompt, new RegExp(analysisId.replaceAll(".", "\\.")));
  assert.match(calls[1].prompt, new RegExp(reviewId.replaceAll(".", "\\.")));
  await assert.rejects(
    useCase.runAgent("project-id", {
      agentId: skippedAgent.id,
      upstreamAgentResults: [{
        agentId: sourceAgent.id,
        selectedItemIndexes: []
      }]
    }),
    /No previous agent selected/
  );
  await useCase.runAgent("project-id", {
    agentId: selectedAgent.id,
    upstreamAgentResults: [{
      agentId: sourceAgent.id,
      selectedItemIndexes: []
    }]
  });

  assert.equal(calls.length, 3);
  assert.match(calls[2].prompt, /RÉSULTAT_CONDITIONNEL/);
});

test("transmet automatiquement l'unique item sans les notes", async () => {
  const { useCase, calls } = createSequentialUseCase([
    { answer: createWorkflowAnswer() },
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
    upstreamAgentResults: [{
      agentId: firstAgent.id,
      selectedItemIndexes: []
    }]
  });

  assert.match(calls[2].prompt, /Marseille/);
  assert.doesNotMatch(calls[2].prompt, /NE_PAS_TRANSMETTRE/);
});

test("transmet uniquement les items sélectionnés sans les notes", async () => {
  const { useCase, calls } = createSequentialUseCase([
    { answer: createWorkflowAnswer() },
    {
      answer: createAgentAnswer(
        ["CHOIX_ALPHA", "CHOIX_BETA", "CHOIX_GAMMA"],
        true,
        false
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
    upstreamAgentResults: [{
      agentId: firstAgent.id,
      selectedItemIndexes: [0, 2]
    }]
  });

  assert.match(calls[2].prompt, /CHOIX_ALPHA/);
  assert.match(calls[2].prompt, /CHOIX_GAMMA/);
  assert.doesNotMatch(calls[2].prompt, /CHOIX_BETA/);
  assert.doesNotMatch(calls[2].prompt, /NE_PAS_TRANSMETTRE/);
});

test("exécute une instance suivante par item sélectionné en mode multithread", async () => {
  const { useCase, calls } = createSequentialUseCase([
    { answer: createWorkflowAnswer() },
    {
      answer: createAgentAnswer(
        ["CHOIX_ALPHA", "CHOIX_BETA", "CHOIX_GAMMA"],
        true,
        true
      ),
      sessionId: "first-session"
    },
    {
      answer: createAgentAnswer(["Résultat alpha"], null),
      sessionId: "alpha-session"
    },
    {
      answer: createAgentAnswer(["Résultat gamma"], null),
      sessionId: "gamma-session"
    },
    {
      answer: createAgentAnswer(["Résultat alpha corrigé"], null),
      sessionId: "alpha-session"
    }
  ]);
  const project = await useCase.loadProject("project-id");
  const [firstAgent, secondAgent] = project.agents;

  await useCase.runAgent("project-id", { agentId: firstAgent.id });
  const result = await useCase.runAgent("project-id", {
    agentId: secondAgent.id,
    upstreamAgentResults: [{
      agentId: firstAgent.id,
      selectedItemIndexes: [0, 2]
    }]
  });

  assert.equal(calls.length, 4);
  assert.match(calls[2].prompt, /CHOIX_ALPHA/);
  assert.doesNotMatch(calls[2].prompt, /CHOIX_GAMMA/);
  assert.match(calls[3].prompt, /CHOIX_GAMMA/);
  assert.doesNotMatch(calls[3].prompt, /CHOIX_ALPHA/);
  assert.equal(result.threads.length, 2);
  assert.deepEqual(
    result.threads.map((thread) => thread.conversation.at(-1)?.content),
    [createAgentAnswer(["Résultat alpha"], null), createAgentAnswer(["Résultat gamma"], null)]
  );

  const targetedResult = await useCase.runAgent("project-id", {
    agentId: secondAgent.id,
    threadId: result.threads[0].id,
    additionalInstructions: "Corrige uniquement cette branche.",
    upstreamAgentResults: [{
      agentId: firstAgent.id,
      selectedItemIndexes: [0, 2]
    }]
  });

  assert.equal(calls.length, 5);
  assert.equal(calls[4].options.sessionId, "alpha-session");
  assert.equal(
    targetedResult.threads[0].conversation.at(-1)?.content,
    createAgentAnswer(["Résultat alpha corrigé"], null)
  );
  assert.equal(
    targetedResult.threads[1].conversation.at(-1)?.content,
    createAgentAnswer(["Résultat gamma"], null)
  );
});

test("propage les instances parallèles à l'agent suivant", async () => {
  const workflowAnswer = JSON.stringify({
    agents: [
      {
        id: ".claude/agents/implementation.md",
        nextAgentIds: [".claude/agents/analysis.md"],
        inputMode: "separate"
      },
      {
        id: ".claude/agents/analysis.md",
        nextAgentIds: [".claude/agents/review.md"],
        inputMode: "separate"
      },
      {
        id: ".claude/agents/review.md",
        nextAgentIds: [],
        inputMode: "separate"
      }
    ]
  });
  const { useCase, calls } = createSequentialUseCase([
    { answer: workflowAnswer },
    {
      answer: createAgentAnswer(["BRANCHE_A", "BRANCHE_B"], true, true),
      sessionId: "source-session"
    },
    {
      answer: createAgentAnswer(["ANALYSE_A"], null),
      sessionId: "analysis-a-session"
    },
    {
      answer: createAgentAnswer(["ANALYSE_B"], null),
      sessionId: "analysis-b-session"
    },
    {
      answer: createAgentAnswer(["REVUE_A"], null),
      sessionId: "review-a-session"
    },
    {
      answer: createAgentAnswer(["REVUE_B"], null),
      sessionId: "review-b-session"
    }
  ], 3);
  const project = await useCase.loadProject("project-id");
  const [sourceAgent, analysisAgent, reviewAgent] = project.agents;

  await useCase.runAgent("project-id", { agentId: sourceAgent.id });
  await useCase.runAgent("project-id", {
    agentId: analysisAgent.id,
    upstreamAgentResults: [{
      agentId: sourceAgent.id,
      selectedItemIndexes: [0, 1]
    }]
  });
  const result = await useCase.runAgent("project-id", {
    agentId: reviewAgent.id,
    upstreamAgentResults: [{
      agentId: analysisAgent.id,
      selectedItemIndexes: []
    }]
  });

  assert.equal(result.threads.length, 2);
  assert.match(calls[4].prompt, /ANALYSE_A/);
  assert.doesNotMatch(calls[4].prompt, /ANALYSE_B/);
  assert.match(calls[5].prompt, /ANALYSE_B/);
  assert.doesNotMatch(calls[5].prompt, /ANALYSE_A/);
});

test("agrège les instances parallèles pour un agent de convergence", async () => {
  const workflowAnswer = JSON.stringify({
    agents: [
      {
        id: ".claude/agents/implementation.md",
        nextAgentIds: [".claude/agents/analysis.md"],
        inputMode: "separate"
      },
      {
        id: ".claude/agents/analysis.md",
        nextAgentIds: [".claude/agents/review.md"],
        inputMode: "separate"
      },
      {
        id: ".claude/agents/review.md",
        nextAgentIds: [],
        inputMode: "aggregate"
      }
    ]
  });
  const { useCase, calls } = createSequentialUseCase([
    { answer: workflowAnswer },
    {
      answer: createAgentAnswer(["SUJET_A", "SUJET_B"], true, true),
      sessionId: "source-session"
    },
    {
      answer: createAgentAnswer(["ARTICLE_A"], null),
      sessionId: "article-a-session"
    },
    {
      answer: createAgentAnswer(["ARTICLE_B"], null),
      sessionId: "article-b-session"
    },
    {
      answer: createAgentAnswer(["PUBLICATION_COMPLETE"], null),
      sessionId: "publisher-session"
    }
  ], 3);
  const project = await useCase.loadProject("project-id");
  const [sourceAgent, writerAgent, publisherAgent] = project.agents;

  await useCase.runAgent("project-id", { agentId: sourceAgent.id });
  await useCase.runAgent("project-id", {
    agentId: writerAgent.id,
    upstreamAgentResults: [{
      agentId: sourceAgent.id,
      selectedItemIndexes: [0, 1]
    }]
  });
  const result = await useCase.runAgent("project-id", {
    agentId: publisherAgent.id,
    upstreamAgentResults: [{
      agentId: writerAgent.id,
      selectedItemIndexes: []
    }]
  });

  assert.equal(publisherAgent.inputMode, "aggregate");
  assert.equal(result.threads.length, 1);
  assert.equal(calls.length, 5);
  assert.match(calls[4].prompt, /ARTICLE_A/);
  assert.match(calls[4].prompt, /ARTICLE_B/);
});

test("attend toutes les branches sélectionnées avant la convergence", async () => {
  const workflowAnswer = JSON.stringify({
    agents: [
      {
        id: ".claude/agents/analysis.md",
        nextAgentIds: [
          ".claude/agents/implementation.md",
          ".claude/agents/review.md"
        ],
        inputMode: "separate"
      },
      {
        id: ".claude/agents/implementation.md",
        nextAgentIds: [".claude/agents/synthesis.md"],
        inputMode: "separate"
      },
      {
        id: ".claude/agents/review.md",
        nextAgentIds: [".claude/agents/synthesis.md"],
        inputMode: "separate"
      },
      {
        id: ".claude/agents/synthesis.md",
        nextAgentIds: [],
        inputMode: "aggregate"
      }
    ]
  });
  const { useCase, calls } = createSequentialUseCase([
    { answer: workflowAnswer },
    {
      answer: createAgentAnswer(
        ["PLAN_PARTAGÉ"],
        null,
        null,
        "NE_PAS_TRANSMETTRE",
        [
          ".claude/agents/implementation.md",
          ".claude/agents/review.md"
        ]
      ),
      sessionId: "analysis-session"
    },
    {
      answer: createAgentAnswer(["Implémentation"], null),
      sessionId: "implementation-session"
    },
    {
      answer: createAgentAnswer(["Revue"], null),
      sessionId: "review-session"
    },
    {
      answer: createAgentAnswer(["Synthèse"], null),
      sessionId: "synthesis-session"
    }
  ], 4);
  const project = await useCase.loadProject("project-id");
  const [
    analysisAgent,
    implementationAgent,
    reviewAgent,
    synthesisAgent
  ] = project.agents;

  assert.deepEqual(analysisAgent.nextAgentIds, [
    implementationAgent.id,
    reviewAgent.id
  ]);

  await assert.rejects(
    useCase.runAgent("project-id", {
      agentId: synthesisAgent.id,
      upstreamAgentResults: []
    }),
    /All prerequisite agents/
  );

  await useCase.runAgent("project-id", { agentId: analysisAgent.id });
  const upstreamAgentResults = [{
    agentId: analysisAgent.id,
    selectedItemIndexes: []
  }];

  await useCase.runAgent("project-id", {
    agentId: implementationAgent.id,
    upstreamAgentResults
  });

  await assert.rejects(
    useCase.runAgent("project-id", {
      agentId: synthesisAgent.id,
      upstreamAgentResults: [{
        agentId: implementationAgent.id,
        selectedItemIndexes: []
      }]
    }),
    /All prerequisite agents/
  );

  await useCase.runAgent("project-id", {
    agentId: reviewAgent.id,
    upstreamAgentResults
  });
  await useCase.runAgent("project-id", {
    agentId: synthesisAgent.id,
    upstreamAgentResults: [
      {
        agentId: implementationAgent.id,
        selectedItemIndexes: []
      },
      {
        agentId: reviewAgent.id,
        selectedItemIndexes: []
      }
    ]
  });

  assert.match(calls[2].prompt, /PLAN_PARTAGÉ/);
  assert.match(calls[3].prompt, /PLAN_PARTAGÉ/);
  assert.match(calls[4].prompt, /Implémentation/);
  assert.match(calls[4].prompt, /Revue/);
});

test("ignore une branche conditionnelle non sélectionnée à la convergence", async () => {
  const workflowAnswer = JSON.stringify({
    agents: [
      {
        id: ".claude/agents/analysis.md",
        nextAgentIds: [
          ".claude/agents/implementation.md",
          ".claude/agents/review.md"
        ],
        inputMode: "separate"
      },
      {
        id: ".claude/agents/implementation.md",
        nextAgentIds: [".claude/agents/synthesis.md"],
        inputMode: "separate"
      },
      {
        id: ".claude/agents/review.md",
        nextAgentIds: [".claude/agents/synthesis.md"],
        inputMode: "separate"
      },
      {
        id: ".claude/agents/synthesis.md",
        nextAgentIds: [],
        inputMode: "aggregate"
      }
    ]
  });
  const { useCase, calls } = createSequentialUseCase([
    { answer: workflowAnswer },
    {
      answer: createAgentAnswer(
        ["PLAN_CIBLÉ"],
        null,
        null,
        null,
        [".claude/agents/implementation.md"]
      ),
      sessionId: "analysis-session"
    },
    {
      answer: createAgentAnswer(["Implémentation"], null),
      sessionId: "implementation-session"
    },
    {
      answer: createAgentAnswer(["Synthèse"], null),
      sessionId: "synthesis-session"
    }
  ], 4);
  const project = await useCase.loadProject("project-id");
  const [analysisAgent, implementationAgent, , synthesisAgent] = project.agents;

  await useCase.runAgent("project-id", { agentId: analysisAgent.id });
  await useCase.runAgent("project-id", {
    agentId: implementationAgent.id,
    upstreamAgentResults: [{
      agentId: analysisAgent.id,
      selectedItemIndexes: []
    }]
  });
  await useCase.runAgent("project-id", {
    agentId: synthesisAgent.id,
    upstreamAgentResults: [{
      agentId: implementationAgent.id,
      selectedItemIndexes: []
    }]
  });

  assert.equal(calls.length, 4);
  assert.match(calls[3].prompt, /Implémentation/);
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
    async getAgentWorkflowConfiguration(): Promise<null> {
      return null;
    },
    async saveAgentWorkflowConfiguration(): Promise<void> {}
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
    async getAgentWorkflowConfiguration(): Promise<null> {
      return null;
    },
    async saveAgentWorkflowConfiguration(): Promise<void> {}
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
    async getAgentWorkflowConfiguration(): Promise<null> {
      return null;
    },
    async saveAgentWorkflowConfiguration(): Promise<void> {}
  } as unknown as ProjectUseCase;
  const useCase = new AgentUseCase(agentService, projectUseCase);
  const project = await useCase.loadProject("project-id");
  const runningExecution = useCase.runAgent("project-id", {
    agentId: project.agents[0].id
  });

  assert.throws(
    () => useCase.resetWorkflow("project-id"),
    /cannot be reset while an agent is running/
  );

  resolveExecution?.({
    answer: createAgentAnswer(["Terminé"], null),
    sessionId: "session-id"
  });
  await runningExecution;
});

test("exécute automatiquement un workflow complet avec tous les résultats", async () => {
  const { useCase, calls } = createSequentialUseCase([
    { answer: createWorkflowAnswer() },
    {
      answer: createAgentAnswer(["Option A", "Option B"], true),
      sessionId: "session-source"
    },
    {
      answer: createAgentAnswer(["Synthèse"], false, null, null, []),
      sessionId: "session-target"
    }
  ]);

  const result = await useCase.runWorkflow("project-id");

  assert.deepEqual(result.executedAgentIds, [
    ".claude/agents/implementation.md",
    ".claude/agents/analysis.md"
  ]);
  assert.deepEqual(result.skippedAgentIds, []);
  assert.equal(calls.length, 3);
  assert.match(calls[2].prompt, /Option A/);
  assert.match(calls[2].prompt, /Option B/);
});
