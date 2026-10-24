import type { AgentContinuity } from "../../../../shared/ExecutionQuality.ts";

/** Only authored instructions and task data belong in the mission pass. */
export function createMissionPrompt(input: {
  prompt: string;
  projectInstructions?: string | null;
  additionalInstructions?: string;
  parameters?: Array<{ id: string; label: string; value: string }>;
  upstreamItems?: Array<{ agentName: string; content: string; continuity?: AgentContinuity }>;
  previousResult?: { workingDirectory: string; content: string };
  continuity?: AgentContinuity;
  wake?: unknown;
  dossier?: string;
}): string {
  return [input.prompt, input.projectInstructions, input.additionalInstructions,
    input.parameters?.length ? `Paramètres du projet :\n${JSON.stringify(input.parameters)}` : "",
    input.upstreamItems?.length ? `Résultats précédents :\n${JSON.stringify(input.upstreamItems)}` : "",
    input.previousResult ? `Résultat précédent :\n${JSON.stringify(input.previousResult)}` : "",
    input.continuity ? `Contexte précédent :\n${JSON.stringify(input.continuity)}` : "",
    input.wake ? `Événement reçu :\n${JSON.stringify(input.wake)}` : "",
    input.dossier ? `Dossier :\n${input.dossier}` : ""
  ].filter(value => typeof value === "string" && value.length > 0).join("\n\n");
}
