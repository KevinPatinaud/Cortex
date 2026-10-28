import { useState } from "react";
import type { PromptModelSelection } from "../../../shared/PromptQueue.ts";
import type { DraftAttachment } from "./PromptAttachments.tsx";

/** Owned by App so changing modes keeps unsent messages and File objects alive. */
export function usePromptDrafts() {
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [draftFiles, setDraftFiles] = useState<Record<string, DraftAttachment[]>>({});
  const [draftSchedules, setDraftSchedules] = useState<Record<string, string | null>>({});
  const [profiles, setProfiles] = useState<Record<string, PromptModelSelection>>({});
  return { drafts, setDrafts, draftFiles, setDraftFiles, draftSchedules, setDraftSchedules, profiles, setProfiles };
}
