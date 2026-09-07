import { createHash } from "node:crypto";

interface WorkflowInstructions {
  fileName: string;
  content: string | null;
}

interface WorkflowAgentContext {
  id: string;
  name: string;
  description: string;
  prompt: string;
}

/** A copied project keeps its graph across file ordering and line-ending changes. */
export function createAgentWorkflowHash(
  instructions: WorkflowInstructions,
  agents: readonly WorkflowAgentContext[],
  legacy = false
): string {
  const normalize = (value: string): string => legacy ? value : value.replace(/\r\n?/g, "\n");
  const contextAgents = agents.map((agent) => ({
    id: agent.id,
    name: normalize(agent.name),
    description: normalize(agent.description),
    prompt: normalize(agent.prompt)
  }));
  if (!legacy) contextAgents.sort((first, second) => first.id < second.id ? -1 : first.id > second.id ? 1 : 0);
  return createHash("sha256").update(JSON.stringify({
    schemaVersion: 6,
    context: {
      projectInstructions: {
        fileName: instructions.fileName,
        content: instructions.content === null ? null : normalize(instructions.content)
      },
      agents: contextAgents
    }
  })).digest("hex");
}
