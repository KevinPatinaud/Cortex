export interface ProjectReviewAgent {
  key: string;
  name: string;
  description: string;
  prompt: string;
  model: string;
  reasoningEffort: string;
}

export interface ProjectReviewDraft {
  projectName: string;
  instructions: string;
  agents: ProjectReviewAgent[];
}

type AgentConfiguration = Omit<ProjectReviewAgent, "key">;

export type ProjectReviewChange =
  | { type: "update_instructions"; instructions: string }
  | { type: "update_agent"; agentKey: string; updates: Partial<AgentConfiguration> }
  | { type: "add_agent"; agentKey: string; agent: AgentConfiguration }
  | { type: "remove_agent"; agentKey: string };

export interface ProjectReviewProposal {
  title: string;
  description: string;
  changes: ProjectReviewChange[];
}

const agentFields = ["name", "description", "prompt", "model", "reasoningEffort"] as const;

function invalid(reason: string): never {
  throw new Error(`Invalid project review proposal: ${reason}`);
}

function record(value: unknown, allowedKeys: readonly string[]): Record<string, unknown> {
  if (
    typeof value !== "object" || value === null || Array.isArray(value) ||
    Object.keys(value).some((key) => !allowedKeys.includes(key))
  ) {
    invalid("unexpected fields or object structure.");
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, allowEmpty = false, maxLength = 200_000): string {
  if (typeof value !== "string" || value.length > maxLength || (!allowEmpty && !value.trim())) {
    invalid("a text field is missing or invalid.");
  }
  return value.trim();
}

function existingKey(value: unknown, keys: Set<string>): string {
  if (typeof value !== "string" || !keys.has(value)) {
    invalid("an agent no longer exists in the current draft.");
  }
  return value;
}

function parseAgentConfiguration(value: unknown, partial: true): Partial<AgentConfiguration>;
function parseAgentConfiguration(value: unknown, partial: false): AgentConfiguration;
function parseAgentConfiguration(value: unknown, partial: boolean): Partial<AgentConfiguration> {
  const fields = record(value, agentFields);
  if (Object.keys(fields).length === 0) {
    invalid("an agent update must contain at least one field.");
  }
  const configuration: Partial<AgentConfiguration> = {};
  for (const field of agentFields) {
    if (!partial || Object.hasOwn(fields, field)) {
      configuration[field] = string(fields[field], field !== "name" && field !== "prompt");
    }
  }
  return configuration;
}

/** Validate the complete change set against its current draft before showing or applying it. */
export function parseProjectReviewProposal(
  value: unknown,
  draft: ProjectReviewDraft
): ProjectReviewProposal {
  const proposal = record(value, ["title", "description", "changes"]);
  const title = string(proposal.title, false, 240);
  const description = string(proposal.description, false, 12_000);
  if (!Array.isArray(proposal.changes) || proposal.changes.length === 0 || proposal.changes.length > 50) {
    invalid("provide between 1 and 50 changes.");
  }

  const keys = new Set(draft.agents.map(({ key }) => key));
  if (keys.size !== draft.agents.length || [...keys].some((key) => !key.trim())) {
    invalid("the draft has duplicate or missing agent keys.");
  }
  const targetedKeys = new Set<string>();
  let instructionsUpdated = false;
  const changes = proposal.changes.map<ProjectReviewChange>((value) => {
    const change = record(value, ["type", "instructions", "agentKey", "updates", "agent"]);
    if (change.type === "update_instructions") {
      record(change, ["type", "instructions"]);
      if (instructionsUpdated) invalid("project instructions are changed more than once.");
      instructionsUpdated = true;
      return { type: change.type, instructions: string(change.instructions, true) };
    }
    let parsedChange: ProjectReviewChange;
    if (change.type === "add_agent") {
      record(change, ["type", "agentKey", "agent"]);
      if (typeof change.agentKey !== "string" || !/^new:[a-z0-9_-]{1,80}$/.test(change.agentKey) ||
        keys.has(change.agentKey)) {
        invalid("a new agent needs a unique new:<slug> key.");
      }
      parsedChange = { type: change.type, agentKey: change.agentKey, agent: parseAgentConfiguration(change.agent, false) };
    } else if (change.type === "update_agent") {
      record(change, ["type", "agentKey", "updates"]);
      parsedChange = { type: change.type, agentKey: existingKey(change.agentKey, keys), updates: parseAgentConfiguration(change.updates, true) };
    } else if (change.type === "remove_agent") {
      record(change, ["type", "agentKey"]);
      parsedChange = { type: change.type, agentKey: existingKey(change.agentKey, keys) };
    } else {
      invalid("unsupported change type.");
    }
    if (targetedKeys.has(parsedChange.agentKey)) {
      invalid("an agent is targeted by conflicting or duplicate changes.");
    }
    targetedKeys.add(parsedChange.agentKey);
    return parsedChange;
  });

  const normalized = { title, description, changes };
  const projected = projectChanges(draft, normalized);
  if (projected.agents.length > 50 || projected.agents.some((agent) =>
    !agent.name.trim() || !agent.prompt.trim()
  )) {
    invalid("the resulting project must contain at most 50 agents with names and instructions.");
  }
  if (JSON.stringify(projected) === JSON.stringify(cloneDraft(draft))) {
    invalid("the proposal does not change the current draft.");
  }
  return normalized;
}

function cloneDraft(draft: ProjectReviewDraft): ProjectReviewDraft {
  return {
    projectName: draft.projectName,
    instructions: draft.instructions,
    agents: draft.agents.map(({ key, name, description, prompt, model, reasoningEffort }) => ({
      key, name, description, prompt, model, reasoningEffort
    }))
  };
}

function projectChanges(draft: ProjectReviewDraft, proposal: ProjectReviewProposal): ProjectReviewDraft {
  const result = cloneDraft(draft);
  for (const change of proposal.changes) {
    switch (change.type) {
      case "update_instructions":
        result.instructions = change.instructions;
        break;
      case "update_agent": {
        const agent = result.agents.find(({ key }) => key === change.agentKey)!;
        Object.assign(agent, change.updates);
        break;
      }
      case "add_agent":
        result.agents.push({ key: change.agentKey, ...change.agent });
        break;
      case "remove_agent":
        result.agents = result.agents.filter(({ key }) => key !== change.agentKey);
        break;
    }
  }
  return result;
}

/** Pure projection only: the caller owns approval and persistence. Revalidate against the draft. */
export function applyProjectReviewProposal(
  draft: ProjectReviewDraft,
  proposal: ProjectReviewProposal
): ProjectReviewDraft {
  return projectChanges(draft, parseProjectReviewProposal(proposal, draft));
}
