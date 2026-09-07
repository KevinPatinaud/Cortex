import type { ProjectReviewDraft } from "../../../../shared/ProjectReviewProposal.ts";
import type { DraftAgent } from "./projectDraft.ts";

export function toProjectReviewDraft(
  projectName: string,
  instructions: string,
  agents: DraftAgent[]
): ProjectReviewDraft {
  return {
    projectName: projectName.trim(),
    instructions,
    agents: agents.map((agent) => ({
      key: agent.clientId,
      name: agent.name,
      description: agent.description,
      prompt: agent.prompt,
      model: agent.model ?? "",
      reasoningEffort: agent.reasoningEffort ?? ""
    }))
  };
}
