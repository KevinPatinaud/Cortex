import type { CodexQuotaConfiguration, CodexQuotaStatus } from "./CodexQuota.ts";
import type { PromptAttachment } from "./PromptAttachment.ts";

export type QueuedPromptStatus = "queued" | "running" | "completed" | "failed" | "interrupted" | "cancelled";

export interface PromptModelSelection {
  model: string;
  reasoningEffort: string;
}

export interface QueuedPrompt {
  /** Earliest allowed launch, stored as an absolute UTC instant. */
  scheduledAt?: string | null;
  attachments?: PromptAttachment[];
  /** Audit of the last attempt; never an authorization to bypass future quota checks. */
  quotaOverrideUsed?: boolean;
  model?: string;
  reasoningEffort?: string;
  id: string;
  chatId: string;
  content: string;
  status: QueuedPromptStatus;
  answer: string | null;
  error: string | null;
  attempts: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

export interface PromptQuotaWarning {
  quota: CodexQuotaConfiguration;
  status: CodexQuotaStatus;
  reason: string;
}

export interface PromptSubmissionResult extends QueuedPrompt {
  quotaWarning: PromptQuotaWarning | null;
}

export interface PromptChat {
  id: string;
  title: string;
  workingDirectory: string;
  model: string;
  reasoningEffort: string;
  paused: boolean;
  blockedReason: string | null;
  createdAt: string;
}

export interface PromptChatSummary extends PromptChat {
  counts: Record<QueuedPromptStatus, number>;
  nextScheduledAt?: string | null;
}

export interface PromptChatDetail extends PromptChat {
  prompts: QueuedPrompt[];
  progress: string | null;
}

export interface PromptChatDefaults {
  workingDirectory: string;
  model: string;
  reasoningEffort: string;
  autoStart: boolean;
}

export const DEFAULT_PROMPT_CHAT_SETTINGS: PromptChatDefaults = {
  workingDirectory: "", model: "", reasoningEffort: "", autoStart: true
};

export interface PromptQueueSettings {
  maxConcurrentChats: number;
  defaults: PromptChatDefaults;
}

export interface PromptQueueOverview extends PromptQueueSettings {
  supportsPromptProfiles: boolean;
  supportsManualQuotaOverride: boolean;
  supportsAttachments: boolean;
  supportsScheduling: boolean;
  chats: PromptChatSummary[];
  quota: CodexQuotaConfiguration;
  quotaStatus: CodexQuotaStatus | null;
  checkIntervalSeconds: number;
}
