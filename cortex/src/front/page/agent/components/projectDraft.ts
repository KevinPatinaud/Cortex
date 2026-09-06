import type { EditableAgentDefinition } from "../../../services/agentApi.ts";

export interface DraftAgent extends EditableAgentDefinition {
  clientId: string;
}

export interface ProjectDraft {
  projectName: string;
  instructions: string;
  agents: DraftAgent[];
}

export interface StoredProjectDraft {
  version: 1;
  savedAt: string;
  base: string;
  value: ProjectDraft;
}

type DraftStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const KEY_PREFIX = "cortex.project-draft.v1:";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDraftAgent(value: unknown): value is DraftAgent {
  return isRecord(value) &&
    ["clientId", "name", "description", "prompt"].every(
      (key) => typeof value[key] === "string"
    ) && ["id", "model", "reasoningEffort"].every(
      (key) => value[key] === undefined || typeof value[key] === "string"
    );
}

export function readProjectDraft(
  projectId: string,
  storage?: DraftStorage
): StoredProjectDraft | null {
  try {
    const raw = (storage ?? window.localStorage).getItem(KEY_PREFIX + projectId);
    if (!raw) return null;
    const draft: unknown = JSON.parse(raw);
    if (!isRecord(draft) || draft.version !== 1 ||
      typeof draft.savedAt !== "string" || !Number.isFinite(Date.parse(draft.savedAt)) ||
      typeof draft.base !== "string" || !isRecord(draft.value) ||
      typeof draft.value.projectName !== "string" ||
      typeof draft.value.instructions !== "string" ||
      !Array.isArray(draft.value.agents) || !draft.value.agents.every(isDraftAgent)) {
      return null;
    }
    return draft as unknown as StoredProjectDraft;
  } catch {
    return null;
  }
}

export function saveProjectDraft(
  projectId: string,
  base: string,
  value: ProjectDraft,
  storage?: DraftStorage
): boolean {
  try {
    (storage ?? window.localStorage).setItem(KEY_PREFIX + projectId, JSON.stringify({
      version: 1,
      savedAt: new Date().toISOString(),
      base,
      value
    } satisfies StoredProjectDraft));
    return true;
  } catch {
    return false;
  }
}

export function removeProjectDraft(projectId: string, storage?: DraftStorage): void {
  try {
    (storage ?? window.localStorage).removeItem(KEY_PREFIX + projectId);
  } catch {
    // Editing and explicit saving still work without browser storage.
  }
}
