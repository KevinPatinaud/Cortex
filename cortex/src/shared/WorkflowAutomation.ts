export interface WorkflowDispatchRule {
  /** Derived from the project's execution graph, with no separate activation control. */
  definitionManaged?: boolean;
  retired?: boolean;
  id: string;
  sourceProjectId: string;
  sourceAgentId: string;
  targetProjectId: string;
  /** Entry agent for an independent branch inside the same project. */
  targetAgentId?: string;
  enabled: boolean;
  createdAt: string;
  /** Only results completed since the latest activation can create new dossiers. */
  activatedAt?: string;
  parameterValues: Record<string, string>;
}

export interface WorkflowDossierBranch { sourceAgentId: string; targetAgentId: string }

export function validateWorkflowDossierBranches(value: unknown, agents: readonly { id: string; nextAgentIds: string[] }[]): WorkflowDossierBranch[] {
  if (!Array.isArray(value)) throw new TypeError("Les branches asynchrones doivent former une liste.");
  const ids = new Set(agents.map(agent => agent.id));
  const branches = value.map(item => {
    if (!item || typeof item !== "object" || Object.keys(item).some(key => !["sourceAgentId", "targetAgentId"].includes(key)) ||
      !ids.has(item.sourceAgentId) || !ids.has(item.targetAgentId)) throw new TypeError("Une branche asynchrone référence un agent inconnu.");
    return { sourceAgentId: item.sourceAgentId as string, targetAgentId: item.targetAgentId as string };
  });
  if (new Set(branches.map(branch => JSON.stringify(branch))).size !== branches.length || branches.some(branch => {
    const descendants = getWorkflowBranchAgentIds(agents, branch.targetAgentId);
    return branches.some(other => descendants.has(other.sourceAgentId));
  })) throw new TypeError("Une branche asynchrone ne peut pas revenir vers un agent déclencheur ni être dupliquée.");
  return branches;
}

export type WorkflowJobStatus = "queued" | "running" | "waiting" | "blocked" | "completed" | "failed" | "interrupted" | "cancelled";

export interface WorkflowJob {
  id: string;
  ruleId: string;
  sourceProjectId: string;
  sourceAgentId: string;
  sourceInstanceId: string | null;
  targetProjectId: string;
  key: string;
  title: string;
  payload: string;
  status: WorkflowJobStatus;
  createdAt: string;
  updatedAt: string;
  error: string | null;
  /** Explicit user clarifications, retained for this dossier and its future agents/wakes. */
  clarifications?: Array<{ content: string; createdAt: string }>;
}

export interface WorkflowDispatchItem { key: string; title: string; payload: string }

export function getWorkflowBranchAgentIds(agents: readonly { id: string; nextAgentIds: string[] }[], entryId: string): Set<string> {
  const byId = new Map(agents.map(agent => [agent.id, agent]));
  const result = new Set<string>();
  const pending = [entryId];
  while (pending.length) {
    const id = pending.pop()!;
    if (result.has(id) || !byId.has(id)) continue;
    result.add(id);
    pending.push(...byId.get(id)!.nextAgentIds);
  }
  return result;
}

export function getDossierAgentIds(project: { projectId: string; agents: readonly { id: string; nextAgentIds: string[] }[] }, rules: readonly WorkflowDispatchRule[]): Set<string> {
  return new Set(rules.filter(rule => rule.sourceProjectId === project.projectId && rule.targetProjectId === project.projectId && rule.targetAgentId)
    .flatMap(rule => [...getWorkflowBranchAgentIds(project.agents, rule.targetAgentId!)]));
}

export function parseWorkflowDispatchItem(content: string): WorkflowDispatchItem {
  let value: unknown;
  try { value = JSON.parse(content); } catch { throw new Error("Un résultat déclencheur doit contenir un objet JSON avec key, title et payload."); }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Résultat déclencheur invalide.");
  const item = value as Record<string, unknown>;
  for (const [field, limit] of [["key", 200], ["title", 200], ["payload", 32000]] as const) {
    if (typeof item[field] !== "string" || !item[field].trim() || item[field].length > limit) {
      throw new Error(`Le champ ${field} doit contenir entre 1 et ${limit} caractères.`);
    }
  }
  return { key: (item.key as string).trim(), title: (item.title as string).trim(), payload: item.payload as string };
}
