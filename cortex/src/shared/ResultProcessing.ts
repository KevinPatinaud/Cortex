import type { ExecutionProfile } from "./ExecutionQuality.ts";

export interface ExecutionProcessing {
  mode: "separate";
  mission: {
    prompt: string;
    response: string;
    sessionId: string;
    workingDirectory: string;
    completedAt: string;
    profile?: ExecutionProfile;
  };
  interpretation: {
    status: "pending" | "running" | "succeeded" | "not_needed" | "failed";
    prompt?: string;
    response?: string;
    sessionId?: string;
    profile?: ExecutionProfile;
    error?: string;
  };
}

export function isExecutionProcessing(value: unknown): value is ExecutionProcessing {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, any>;
  return v.mode === "separate" && v.mission && typeof v.mission === "object" &&
    ["prompt", "response", "sessionId", "workingDirectory", "completedAt"].every(key => typeof v.mission[key] === "string") &&
    Boolean(v.mission.sessionId) && v.interpretation && typeof v.interpretation === "object" &&
    ["pending", "running", "succeeded", "not_needed", "failed"].includes(v.interpretation.status) &&
    ["prompt", "response", "sessionId", "error"].every(key => v.interpretation[key] === undefined || typeof v.interpretation[key] === "string");
}
