export interface ExecutionPolicy {
  resultMode?: "separate" | "integrated";
  interpretationModel?: string;
  interpretationReasoningEffort?: string;
  workspaceDirectory: string;
  defaultModel: string;
  defaultReasoningEffort: string;
  delegation: "none" | "bounded";
  resumeUnfinished: boolean;
  acceptanceCriteria: string[];
  preflightChecks: Array<{ label: string; command: string; args: string[] }>;
  checks: Array<{ label: string; command: string; args: string[] }>;
}

export const DEFAULT_EXECUTION_POLICY: ExecutionPolicy = {
  resultMode: "separate", interpretationModel: "", interpretationReasoningEffort: "low",
  workspaceDirectory: "", defaultModel: "", defaultReasoningEffort: "",
  delegation: "none", resumeUnfinished: true, acceptanceCriteria: [], preflightChecks: [], checks: []
};

export interface AgentContinuity {
  summary: string;
  decisions: string[];
  evidence: string[];
  remainingWork: string[];
}

export interface AcceptanceEvidence { criterion: string; passed: boolean; evidence: string }
export interface ExecutionAssessment {
  outcome: "reported" | "partial" | "verified" | "failed" | "waiting";
  reasons: string[];
  checks: Array<{ label: string; passed: boolean; detail: string }>;
  assessedAt: string;
}

export interface ExecutionProfile {
  declaredApps?: string[];
  availableSkills?: string[];
  declaredMcpServers?: string[];
  model: string | null;
  reasoningEffort: string | null;
  cliVersion: string | null;
  workingDirectory: string;
  delegation: "none" | "bounded";
  /** Observed calls are not an inventory of all available capabilities. */
  observedCapabilities: string[];
  resolution: "pinned" | "unavailable";
}

export function isAgentContinuity(value: unknown): value is AgentContinuity {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.summary === "string" && v.summary.length <= 2000 &&
    ["decisions", "evidence", "remainingWork"].every(key => Array.isArray(v[key]) &&
      v[key].length <= 12 && v[key].every((s: unknown) => typeof s === "string" && s.length <= 1000));
}

export function isAcceptanceEvidence(value: unknown): value is AcceptanceEvidence[] {
  return Array.isArray(value) && value.length <= 30 && value.every(v => v && typeof v === "object" &&
    typeof v.criterion === "string" && v.criterion.length <= 1000 && typeof v.passed === "boolean" &&
    typeof v.evidence === "string" && v.evidence.length <= 2000);
}

export function isExecutionAssessment(value: unknown): value is ExecutionAssessment {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return ["reported", "partial", "verified", "failed", "waiting"].includes(String(v.outcome)) &&
    typeof v.assessedAt === "string" && Array.isArray(v.reasons) && v.reasons.every(s => typeof s === "string") &&
    Array.isArray(v.checks) && v.checks.every(c => c && typeof c === "object" && typeof c.label === "string" &&
      typeof c.passed === "boolean" && typeof c.detail === "string");
}
