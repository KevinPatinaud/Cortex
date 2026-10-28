import type { PromptChat, PromptChatDetail, PromptModelSelection, PromptQueueOverview, PromptQueueSettings, PromptSubmissionResult } from "../../shared/PromptQueue.ts";
import type { CodexModelCatalog } from "../../shared/CodexModel.ts";
import { requestJson } from "./apiClient.ts";

const root = "/api/prompt-queue";
function send<T>(path: string, method: string, body?: unknown): Promise<T> {
  return requestJson(`${root}${path}`, { method, headers: { "Content-Type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
export async function getPromptQueue(): Promise<PromptQueueOverview> {
  const value = await requestJson<PromptQueueOverview>(root);
  if (!value.defaults || value.supportsPromptProfiles !== true || value.supportsManualQuotaOverride !== true || value.supportsAttachments !== true || value.supportsScheduling !== true) throw new Error("Le serveur Cortex doit être redémarré pour charger la nouvelle interface.");
  return value;
}
export const checkPromptQueue = (): Promise<PromptQueueOverview> => send("/check", "POST");
export const getPromptChat = (id: string): Promise<PromptChatDetail> => requestJson(`${root}/chats/${encodeURIComponent(id)}`);
export const createPromptChat = (input: Partial<Pick<PromptChat, "title" | "workingDirectory" | "paused" | "model" | "reasoningEffort">> = {}): Promise<PromptChat> => send("/chats", "POST", input);
export const savePromptChat = (id: string, input: Pick<PromptChat, "title" | "model" | "reasoningEffort">): Promise<PromptChatDetail> => send(`/chats/${encodeURIComponent(id)}`, "PATCH", input);
export const deletePromptChat = (id: string) => send(`/chats/${encodeURIComponent(id)}`, "DELETE");
export const setPromptChatPaused = (id: string, paused: boolean) => send(`/chats/${encodeURIComponent(id)}/pause`, "PUT", { paused });
export const enqueuePrompt = (id: string, content: string, selection?: PromptModelSelection, files: File[] = [], scheduledAt: string | null = null): Promise<PromptSubmissionResult> => {
  const path = `/chats/${encodeURIComponent(id)}/prompts`;
  if (!files.length) return send(path, "POST", { content, ...selection, scheduledAt });
  const body = new FormData();
  body.append("message", JSON.stringify({ content, ...selection, scheduledAt, fileNames: files.map(file => file.name) }));
  for (const file of files) body.append("files", file);
  return requestJson(`${root}${path}`, { method: "POST", body });
};
export const promptAttachmentUrl = (chatId: string, promptId: string, attachmentId: string) => `${root}/chats/${encodeURIComponent(chatId)}/prompts/${encodeURIComponent(promptId)}/attachments/${encodeURIComponent(attachmentId)}`;
export const forceQueuedPrompt = (id: string, promptId: string): Promise<PromptChatDetail> => send(`/chats/${encodeURIComponent(id)}/prompts/${encodeURIComponent(promptId)}/force`, "POST");
export const editQueuedPrompt = (id: string, promptId: string, content: string) => send(`/chats/${encodeURIComponent(id)}/prompts/${encodeURIComponent(promptId)}`, "PATCH", { content });
export const scheduleQueuedPrompt = (id: string, promptId: string, scheduledAt: string | null) => send(`/chats/${encodeURIComponent(id)}/prompts/${encodeURIComponent(promptId)}`, "PATCH", { scheduledAt });
export const actOnQueuedPrompt = (id: string, promptId: string, action: "cancel" | "retry") => send(`/chats/${encodeURIComponent(id)}/prompts/${encodeURIComponent(promptId)}/${action}`, "POST");
export const savePromptQueueConcurrency = (maxConcurrentChats: number) => send("/settings", "PUT", { maxConcurrentChats });
export const savePromptQueueSettings = (settings: PromptQueueSettings): Promise<PromptQueueSettings> => send("/settings", "PUT", settings);
export const getPromptDefaultModels = (): Promise<CodexModelCatalog> => requestJson(`${root}/models`);
export const getPromptChatModels = (id: string): Promise<CodexModelCatalog> => requestJson(`${root}/chats/${encodeURIComponent(id)}/models`);
