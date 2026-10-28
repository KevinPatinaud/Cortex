import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { ArrowLeft, ArrowUp, Clock3, Menu, MessageSquare, MoreHorizontal, Paperclip, Pause, Play, Settings2, SquarePen, X } from "lucide-react";
import { useTranslation } from "../../i18n.tsx";
import type { PromptChatDetail, PromptChatSummary, PromptModelSelection, PromptQueueOverview, PromptQuotaWarning, QueuedPrompt } from "../../../shared/PromptQueue.ts";
import { actOnQueuedPrompt, createPromptChat, editQueuedPrompt, enqueuePrompt, forceQueuedPrompt, getPromptChat, getPromptQueue, scheduleQueuedPrompt, setPromptChatPaused } from "../../services/promptQueueApi.ts";
import { MarkdownContent } from "../agent/components/MarkdownContent.tsx";
import { PromptSettingsDialog } from "./PromptSettingsDialog.tsx";
import { PromptModelPicker } from "./PromptModelPicker.tsx";
import { PromptQuotaDialog } from "./PromptQuotaDialog.tsx";
import { formatPromptSchedule, PromptScheduleDialog } from "./PromptScheduleDialog.tsx";
import { DraftAttachments, SavedAttachments } from "./PromptAttachments.tsx";
import { MAX_PROMPT_ATTACHMENTS, MAX_PROMPT_FILE_BYTES, MAX_PROMPT_TOTAL_BYTES, PROMPT_ATTACHMENT_ACCEPT, promptFileType } from "../../../shared/PromptAttachment.ts";
import { fr, en } from "./messages.ts";
import { updateBrowserUrl } from "../shared/browserNavigation.ts";
import type { usePromptDrafts } from "./usePromptDrafts.ts";

export function PromptQueueWorkspace({ onWorkflows, draftState }: { onWorkflows: () => void; draftState: ReturnType<typeof usePromptDrafts> }) {
  const { language, t } = useTranslation();
  const copy = language === "fr" ? fr : en;
  const [overview, setOverview] = useState<PromptQueueOverview | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(() => new URL(location.href).searchParams.get("chat"));
  const [chat, setChat] = useState<PromptChatDetail | null>(null);
  const { drafts, setDrafts, draftFiles, setDraftFiles, draftSchedules, setDraftSchedules, profiles, setProfiles } = draftState;
  const [scheduleTarget, setScheduleTarget] = useState<{ kind: "draft"; key: string } | { kind: "prompt"; prompt: QueuedPrompt } | null>(null);
  const scheduleOpener = useRef<HTMLElement | null>(null);
  const [profileValidity, setProfileValidity] = useState<Record<string, boolean>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");
  const [settings, setSettings] = useState<"defaults" | "chat" | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [quotaNotice, setQuotaNotice] = useState<{ chatId: string; promptId: string; warning: PromptQuotaWarning } | null>(null);
  const submittedPrompt = useRef<{ chatId: string; promptId: string } | null>(null);
  const selectedRef = useRef(selectedId);
  const selectionVersion = useRef(0);
  selectedRef.current = selectedId;
  const mounted = useRef(true), busyRef = useRef(false);
  const requestVersion = useRef(0);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const followTimeline = useRef(true);
  const serverProfiles = useRef<Record<string, PromptModelSelection>>({});
  const serverDefaults = useRef<PromptModelSelection | null>(null);

  const refresh = useCallback(async () => {
    const version = ++requestVersion.current;
    const value = await getPromptQueue();
    if (!mounted.current || version !== requestVersion.current) return;
    setOverview(value);
    const id = selectedRef.current;
    if (id && value.chats.some(candidate => candidate.id === id)) {
      const detail = await getPromptChat(id);
      if (mounted.current && version === requestVersion.current && selectedRef.current === id) setChat(detail);
    } else if (id && selectedRef.current === id) {
      selectedRef.current = null;
      selectionVersion.current++;
      setSelectedId(null); setChat(null);
      const url = new URL(location.href);
      url.searchParams.delete("chat");
      updateBrowserUrl(url, true);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    let inFlight = false;
    const timer = setInterval(() => {
      if (inFlight) return;
      inFlight = true;
      void refresh().catch(reason => { if (mounted.current) setError(reason instanceof Error ? reason.message : copy.error); }).finally(() => { inFlight = false; });
    }, 2000);
    return () => { mounted.current = false; clearInterval(timer); };
  }, [refresh]);

  useEffect(() => {
    setChat(null); setEditingId(null);
    void refresh().catch(reason => { if (mounted.current) setError(reason instanceof Error ? reason.message : copy.error); });
  }, [selectedId, refresh]);

  useEffect(() => {
    const sync = () => {
      const id = new URL(location.href).searchParams.get("chat");
      if (id === selectedRef.current) return;
      selectionVersion.current++;
      selectedRef.current = id;
      followTimeline.current = true;
      setSelectedId(id); setChat(null); setEditingId(null); setSidebarOpen(false);
      setError(""); setQuotaNotice(null); submittedPrompt.current = null;
    };
    window.addEventListener("popstate", sync);
    return () => window.removeEventListener("popstate", sync);
  }, []);

  useEffect(() => {
    const timeline = timelineRef.current;
    if (timeline && followTimeline.current) timeline.scrollTop = timeline.scrollHeight;
  }, [chat?.id, chat?.prompts.length, chat?.prompts.at(-1)?.status, chat?.progress]);

  useEffect(() => {
    if (!chat) return;
    const previous = serverProfiles.current[chat.id];
    serverProfiles.current[chat.id] = { model: chat.model, reasoningEffort: chat.reasoningEffort };
    if (previous && (previous.model !== chat.model || previous.reasoningEffort !== chat.reasoningEffort)) {
      setProfiles(current => { if (!current[chat.id]) return current; const next = { ...current }; delete next[chat.id]; return next; });
    }
  }, [chat?.id, chat?.model, chat?.reasoningEffort]);
  useEffect(() => {
    if (!overview) return;
    const previous = serverDefaults.current;
    serverDefaults.current = { model: overview.defaults.model, reasoningEffort: overview.defaults.reasoningEffort };
    if (previous && (previous.model !== overview.defaults.model || previous.reasoningEffort !== overview.defaults.reasoningEffort)) {
      setProfiles(current => { if (!current.new) return current; const next = { ...current }; delete next.new; return next; });
    }
  }, [overview?.defaults.model, overview?.defaults.reasoningEffort]);

  useEffect(() => {
    if (!chat) return;
    const pending = submittedPrompt.current;
    if (pending?.chatId === chat.id) {
      const prompt = chat.prompts.find(candidate => candidate.id === pending.promptId);
      if (prompt && prompt.status !== "queued") submittedPrompt.current = null;
      else if (prompt && chat.blockedReason && overview?.quotaStatus) {
        setQuotaNotice({ ...pending, warning: { quota: overview.quota, status: overview.quotaStatus, reason: chat.blockedReason } });
        submittedPrompt.current = null;
      }
    }
    if (quotaNotice?.chatId === chat.id) {
      const prompt = chat.prompts.find(candidate => candidate.id === quotaNotice.promptId);
      if (prompt && prompt.status !== "queued") setQuotaNotice(null);
    }
  }, [chat, overview, quotaNotice?.chatId, quotaNotice?.promptId]);

  async function action(operation: () => Promise<unknown>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true); setError("");
    try { await operation(); await refresh(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : copy.error); }
    finally { busyRef.current = false; setBusy(false); }
  }
  function choose(id: string | null) {
    selectionVersion.current++;
    followTimeline.current = true;
    selectedRef.current = id;
    setChat(null); setEditingId(null);
    setSelectedId(id); setSidebarOpen(false); setError("");
    submittedPrompt.current = null; setQuotaNotice(null);
    const url = new URL(location.href);
    if (id) url.searchParams.set("chat", id); else url.searchParams.delete("chat");
    if (url.href !== location.href) updateBrowserUrl(url);
    if (!id) {
      setProfiles(current => { const next = { ...current }; delete next.new; return next; });
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }
  function status(summary: PromptChatSummary) {
    if (summary.counts.running) return copy.running;
    if (summary.counts.failed || summary.counts.interrupted) return copy.attention;
    if (summary.paused) return copy.paused;
    if (summary.nextScheduledAt && Date.parse(summary.nextScheduledAt) > Date.now()) return copy.scheduled;
    if (summary.blockedReason && summary.counts.queued) return copy.waitingQuota;
    return summary.counts.queued ? copy.waitingSlot : copy.ready;
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    const key = selectedId ?? "new", content = drafts[key] ?? "";
    const files = draftFiles[key] ?? [];
    const scheduledAt = draftSchedules[key] ?? null;
    if ((!content.trim() && !files.length) || profileValidity[key] === false) return;
    const selection = profiles[key]?.model ? { ...profiles[key] } : undefined;
    const submittedSelection = selectionVersion.current;
    if (scheduledAt && Date.parse(scheduledAt) <= Date.now()) { setError(copy.schedulePast); return; }
    await action(async () => {
      followTimeline.current = true;
      let id = selectedRef.current;
      if (!id) {
        const created = await createPromptChat(selection);
        id = created.id;
        setDrafts(current => ({ ...current, new: "", [created.id]: content }));
        setDraftFiles(current => ({ ...current, new: [], [created.id]: files }));
        setDraftSchedules(current => ({ ...current, new: null, [created.id]: scheduledAt }));
        if (selection) setProfiles(current => ({ ...current, [created.id]: selection }));
        if (mounted.current && selectionVersion.current === submittedSelection) {
          selectedRef.current = id;
          setSelectedId(id);
          const url = new URL(location.href);
          url.searchParams.set("chat", id);
          updateBrowserUrl(url, true);
        }
      }
      const result = await enqueuePrompt(id, content, selection, files.map(item => item.file), scheduledAt);
      if (mounted.current && selectedRef.current === id) {
        if (result.quotaWarning) {
          submittedPrompt.current = null;
          setQuotaNotice({ chatId: id, promptId: result.id, warning: result.quotaWarning });
        } else submittedPrompt.current = { chatId: id, promptId: result.id };
      }
      setDrafts(current => ({ ...current, [id!]: "", ...(key === "new" ? { new: "" } : {}) }));
      setDraftFiles(current => ({ ...current, [id!]: [], ...(key === "new" ? { new: [] } : {}) }));
      setDraftSchedules(current => ({ ...current, [id!]: null, ...(key === "new" ? { new: null } : {}) }));
    });
    inputRef.current?.focus();
  }
  function promptAction(prompt: QueuedPrompt, kind: "cancel" | "retry") {
    if (kind === "retry" && !window.confirm(copy.retryConfirm)) return;
    if (prompt.status === "running" && !window.confirm(copy.stopConfirm)) return;
    void action(() => actOnQueuedPrompt(prompt.chatId, prompt.id, kind));
  }
  const currentSummary = overview?.chats.find(candidate => candidate.id === selectedId);
  const awaitingChat = Boolean(selectedId && chat?.id !== selectedId);
  const draftKey = selectedId ?? "new";
  const currentSchedule = draftSchedules[draftKey] ?? null;
  const currentFiles = draftFiles[draftKey] ?? [];
  function addFiles(incoming: File[]) {
    if (!incoming.length || busyRef.current || awaitingChat || !overview) return;
    const files = [...currentFiles.map(item => item.file), ...incoming];
    const unsupported = incoming.find(file => !promptFileType(file.name));
    if (unsupported) { setError(copy.unsupportedAttachment.replace("{name}", unsupported.name)); return; }
    if (files.length > MAX_PROMPT_ATTACHMENTS) { setError(copy.attachmentCountError); return; }
    if (files.some(file => !file.size || file.size > MAX_PROMPT_FILE_BYTES) || files.reduce((sum, file) => sum + file.size, 0) > MAX_PROMPT_TOTAL_BYTES) { setError(copy.attachmentSizeError); return; }
    setError("");
    setDraftFiles(current => ({ ...current, [draftKey]: [...(current[draftKey] ?? []), ...incoming.map(file => ({ id: crypto.randomUUID(), file }))] }));
  }
  const showWaiting = Boolean(chat && !chat.paused && currentSummary?.counts.queued && chat.blockedReason);
  const queueHead = chat?.prompts.find(prompt => !["completed", "cancelled"].includes(prompt.status));
  const headScheduled = Boolean(queueHead?.status === "queued" && queueHead.scheduledAt && Date.parse(queueHead.scheduledAt) > Date.now());
  const quotas = overview?.quotaStatus;
  const quotasBlocked = Boolean(quotas && (!quotas.available || (quotas.fiveHour && quotas.fiveHour.remainingPercent < overview!.quota.minimumFiveHourRemainingPercent)
    || (quotas.weekly && quotas.weekly.remainingPercent < overview!.quota.minimumWeeklyRemainingPercent)));
  const forceUnavailableReason = !quotaNotice || !chat || chat.id !== quotaNotice.chatId ? t("common.loading")
    : queueHead?.id !== quotaNotice.promptId || Boolean(currentSummary?.counts.running) ? copy.forcePrevious
    : headScheduled ? copy.forceScheduled.replace("{date}", formatPromptSchedule(queueHead!.scheduledAt!, language))
    : overview && overview.chats.filter(candidate => candidate.counts.running > 0).length >= overview.maxConcurrentChats ? copy.forceNoSlot : "";
  function closeSchedule() {
    setScheduleTarget(null);
    requestAnimationFrame(() => scheduleOpener.current?.isConnected ? scheduleOpener.current.focus() : inputRef.current?.focus());
  }
  function keepQueued() {
    setQuotaNotice(null);
    requestAnimationFrame(() => inputRef.current?.focus());
  }

  return <main id="main-content" className="prompt-workspace" tabIndex={-1}>
    {sidebarOpen && <button className="prompt-sidebar-scrim" type="button" aria-label={copy.hideChats} onClick={() => setSidebarOpen(false)} />}
    <aside className={`prompt-chat-list${sidebarOpen ? " prompt-chat-list--open" : ""}`} aria-label={copy.chats} id="prompt-chat-navigation">
      <div className="prompt-sidebar-brand"><MessageSquare size={21} aria-hidden="true" /><strong>Cortex</strong>
        <button type="button" className="prompt-mobile-nav" aria-label={copy.hideChats} onClick={() => setSidebarOpen(false)}><X aria-hidden="true" size={18} /></button></div>
      <button className="prompt-new-chat" type="button" onClick={() => choose(null)}><SquarePen size={18} aria-hidden="true" />{copy.newChat}</button>
      <h2 className="prompt-list-label">{copy.chats}</h2>
      <nav className="prompt-chat-links" aria-label={copy.chats}>
        {overview?.chats.map(summary => <button type="button" key={summary.id} className={`prompt-chat-link${selectedId === summary.id ? " is-selected" : ""}`}
          aria-current={selectedId === summary.id ? "page" : undefined} onClick={() => choose(summary.id)}>
          <strong>{summary.title}</strong>
          {(summary.counts.running || summary.counts.queued || summary.counts.failed || summary.counts.interrupted || summary.paused) ?
            <small>{status(summary)}{summary.counts.queued ? ` · ${summary.counts.queued} ${copy.promptCount}` : ""}</small> : null}
        </button>)}
      </nav>
      <footer className="prompt-sidebar-footer">
        <button type="button" onClick={onWorkflows}><ArrowLeft size={17} aria-hidden="true" />{copy.workflows}</button>
        <button type="button" disabled={!overview} onClick={() => { setSettings("defaults"); setSidebarOpen(false); }}><Settings2 size={17} aria-hidden="true" />{copy.settings}</button>
      </footer>
    </aside>
    <section className="prompt-conversation" aria-label={copy.title}>
      <header className="prompt-chat-header">
        <button type="button" className="prompt-mobile-nav" aria-label={copy.showChats} aria-controls="prompt-chat-navigation" aria-expanded={sidebarOpen} onClick={() => setSidebarOpen(true)}><Menu aria-hidden="true" size={21} /></button>
        <h1>{chat?.title ?? (awaitingChat ? t("common.loading") : "Cortex")}</h1>
        {chat && <div className="prompt-header-actions">
          <button type="button" disabled={busy} aria-label={chat.paused ? copy.activate : copy.pause} title={chat.paused ? copy.activate : copy.pause} onClick={() => void action(() => setPromptChatPaused(chat.id, !chat.paused))}>
            {chat.paused ? <Play size={17} aria-hidden="true" /> : <Pause size={17} aria-hidden="true" />}</button>
          <button type="button" aria-label={copy.chatSettings} title={copy.chatSettings} disabled={!overview} onClick={() => setSettings("chat")}><MoreHorizontal size={21} aria-hidden="true" /></button>
        </div>}
      </header>
      {error && <div className="prompt-feedback prompt-feedback--error" role="alert">{error}<button type="button" disabled={busy} onClick={() => void action(refresh)}>{copy.retryLoad}</button></div>}
      {chat?.paused && <div className="prompt-chat-state" role="status"><span>{copy.paused}</span><button type="button" disabled={busy} onClick={() => void action(() => setPromptChatPaused(chat.id, false))}>{copy.activate}</button></div>}
      {showWaiting && <p className="prompt-chat-state" role="status">{copy.waitingQuota} · {chat!.blockedReason}</p>}
      {headScheduled && !chat?.paused && <p className="prompt-chat-state" role="status"><Clock3 size={16} aria-hidden="true" />{copy.scheduledFor.replace("{date}", formatPromptSchedule(queueHead!.scheduledAt!, language))}</p>}
      <div className="prompt-timeline" ref={timelineRef} onScroll={event => { const node = event.currentTarget; followTimeline.current = node.scrollHeight - node.scrollTop - node.clientHeight < 160; }}>
        {!chat && !awaitingChat && <div className="prompt-welcome"><span className="prompt-welcome-icon"><MessageSquare size={30} aria-hidden="true" /></span><h2>{copy.welcome}</h2><p>{copy.welcomeHelp}</p></div>}
        {chat && !chat.prompts.length && <div className="prompt-welcome"><h2>{copy.noMessages}</h2><p>{copy.noMessagesHelp}</p></div>}
        {chat?.prompts.map((prompt, index) => <article className={`prompt-turn prompt-turn--${prompt.status}`} key={prompt.id} aria-label={`${index + 1} · ${prompt.status === "queued" && prompt.scheduledAt && Date.parse(prompt.scheduledAt) > Date.now() ? copy.scheduled : copy[prompt.status]}`}>
          <header><span className="prompt-badge">{prompt.status === "queued" && prompt.scheduledAt && Date.parse(prompt.scheduledAt) > Date.now() ? copy.scheduled : copy[prompt.status]}</span>{prompt.quotaOverrideUsed && <span>{copy.forcedExecution}</span>}<time dateTime={prompt.createdAt}>{new Date(prompt.createdAt).toLocaleTimeString(language, { hour: "2-digit", minute: "2-digit" })}</time></header>
          {prompt.scheduledAt && <p className="prompt-turn-schedule"><Clock3 size={15} aria-hidden="true" /><time dateTime={prompt.scheduledAt}>{copy.scheduledFor.replace("{date}", formatPromptSchedule(prompt.scheduledAt, language))}</time></p>}
          {editingId === prompt.id ? <form onSubmit={event => { event.preventDefault(); void action(async () => { await editQueuedPrompt(chat.id, prompt.id, editContent); setEditingId(null); }); }}>
            <label>{copy.compose}<textarea rows={4} required={!prompt.attachments?.length} disabled={busy} maxLength={100000} value={editContent} onChange={event => setEditContent(event.target.value)} /></label>
            <div className="prompt-actions"><button type="submit" disabled={busy || (!editContent.trim() && !prompt.attachments?.length)}>{copy.save}</button><button type="button" onClick={() => setEditingId(null)}>{copy.cancel}</button></div>
          </form> : prompt.content && <p className="prompt-turn__content">{prompt.content}</p>}
          {Boolean(prompt.attachments?.length) && <SavedAttachments files={prompt.attachments!} chatId={chat.id} promptId={prompt.id} />}
          {prompt.answer && <div className="prompt-answer"><strong>{prompt.status === "completed" ? copy.response : copy.partial}</strong><MarkdownContent content={prompt.answer} /></div>}
          {prompt.status === "running" && <p className="prompt-progress">{chat.progress || copy.progress}</p>}
          {prompt.error && <p className="prompt-turn__error">{prompt.error}</p>}
          <div className="prompt-actions">
            {prompt.status === "queued" && <button type="button" disabled={busy} onClick={() => { setEditingId(prompt.id); setEditContent(prompt.content); }}>{copy.edit}</button>}
            {prompt.status === "queued" && <button type="button" disabled={busy} onClick={event => { scheduleOpener.current = event.currentTarget; setScheduleTarget({ kind: "prompt", prompt }); }}><Clock3 size={14} aria-hidden="true" />{copy.changeSchedule}</button>}
            {prompt.status === "queued" && queueHead?.id === prompt.id && !headScheduled && (showWaiting || quotasBlocked) && overview?.quotaStatus && <button type="button" disabled={busy} onClick={() => setQuotaNotice({ chatId: chat.id, promptId: prompt.id,
              warning: { quota: overview.quota, status: overview.quotaStatus!, reason: chat.blockedReason ?? copy.waitingQuota } })}>{copy.forceNow}</button>}
            {["failed", "interrupted"].includes(prompt.status) && <button type="button" disabled={busy || Boolean(currentSummary?.counts.running)} onClick={() => promptAction(prompt, "retry")}>{copy.retry}</button>}
            {!["completed", "cancelled"].includes(prompt.status) && <button type="button" disabled={busy} onClick={() => promptAction(prompt, "cancel")}>{prompt.status === "running" ? copy.stop : copy.cancel}</button>}
          </div>
        </article>)}
      </div>
      <div className="prompt-composer-area">
        <form className="prompt-composer" onSubmit={event => void submit(event)} onDragOver={event => { if (event.dataTransfer.types.includes("Files")) event.preventDefault(); }} onDrop={event => { event.preventDefault(); addFiles(Array.from(event.dataTransfer.files)); }}>
          {Boolean(currentFiles.length) && <DraftAttachments files={currentFiles} disabled={busy} onRemove={id => setDraftFiles(current => ({ ...current, [draftKey]: (current[draftKey] ?? []).filter(file => file.id !== id) }))} />}
          {currentSchedule && <div className="prompt-schedule-summary" role="status"><Clock3 size={16} aria-hidden="true" /><span>{copy.scheduledFor.replace("{date}", formatPromptSchedule(currentSchedule, language))}</span><button type="button" disabled={busy} aria-label={copy.removeSchedule} title={copy.removeSchedule} onClick={() => setDraftSchedules(current => ({ ...current, [draftKey]: null }))}><X size={15} aria-hidden="true" /></button></div>}
          <textarea ref={inputRef} id="queue-prompt" aria-label={copy.compose} rows={3} maxLength={100000} required={!currentFiles.length} disabled={busy || awaitingChat || !overview} placeholder={copy.placeholder}
            value={drafts[draftKey] ?? ""} onChange={event => setDrafts(current => ({ ...current, [draftKey]: event.target.value }))}
            onPaste={event => { if (event.clipboardData.files.length) { if (!event.clipboardData.getData("text/plain")) event.preventDefault(); addFiles(Array.from(event.clipboardData.files)); } }}
            onKeyDown={event => { if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); if (!busy && !awaitingChat && overview) event.currentTarget.form?.requestSubmit(); } }} />
          <div className="prompt-composer-footer">
            <div className="prompt-composer-tools">
            <input ref={fileInputRef} type="file" hidden multiple accept={PROMPT_ATTACHMENT_ACCEPT} aria-label={copy.attachFiles} onChange={event => { addFiles(Array.from(event.currentTarget.files ?? [])); event.currentTarget.value = ""; }} />
            <button type="button" className="prompt-attach" aria-label={copy.attachFiles} title={copy.attachFiles} disabled={busy || awaitingChat || !overview} onClick={() => fileInputRef.current?.click()}><Paperclip size={19} aria-hidden="true" /></button>
            <button type="button" className="prompt-clock" aria-label={copy.schedulePrompt} title={copy.schedulePrompt} aria-pressed={Boolean(currentSchedule)} disabled={busy || awaitingChat || !overview} onClick={event => { scheduleOpener.current = event.currentTarget; setScheduleTarget({ kind: "draft", key: draftKey }); }}><Clock3 size={19} aria-hidden="true" /></button>
            </div>
            {!awaitingChat && overview && <PromptModelPicker key={draftKey} chatId={chat?.id} value={profiles[draftKey]} initial={{ model: chat?.model ?? overview.defaults.model, reasoningEffort: chat?.reasoningEffort ?? overview.defaults.reasoningEffort }}
              disabled={busy || awaitingChat || !overview} onChange={selection => {
                setProfiles(current => ({ ...current, [draftKey]: selection }));
              }} onValidityChange={valid => setProfileValidity(current => current[draftKey] === valid ? current : { ...current, [draftKey]: valid })} />}
            <button className="prompt-primary prompt-send" type="submit" aria-label={busy ? copy.sending : copy.send} title={copy.send} disabled={busy || awaitingChat || !overview || profileValidity[draftKey] === false || (!(drafts[draftKey] ?? "").trim() && !currentFiles.length)}><ArrowUp size={20} aria-hidden="true" /></button>
          </div>
        </form>
        <p className="prompt-composer-help">{chat?.paused ? copy.pausedHint : copy.queueHint}</p>
      </div>
    </section>
    {settings && overview && <PromptSettingsDialog overview={overview} chat={chat} initialTab={settings} onClose={() => setSettings(null)} onSaved={refresh}
      onDeleted={() => { choose(null); setChat(null); }} />}
    {scheduleTarget && <PromptScheduleDialog value={scheduleTarget.kind === "draft" ? draftSchedules[scheduleTarget.key] ?? null : scheduleTarget.prompt.scheduledAt ?? null} onClose={closeSchedule} onApply={async scheduledAt => {
      if (scheduleTarget.kind === "prompt") { await scheduleQueuedPrompt(scheduleTarget.prompt.chatId, scheduleTarget.prompt.id, scheduledAt); await refresh(); }
      else setDraftSchedules(current => ({ ...current, [scheduleTarget.key]: scheduledAt }));
      closeSchedule();
    }} />}
    {quotaNotice && <PromptQuotaDialog warning={quotaNotice.warning} unavailableReason={forceUnavailableReason} onKeep={keepQueued} onForce={async () => {
      const detail = await forceQueuedPrompt(quotaNotice.chatId, quotaNotice.promptId);
      if (selectedRef.current === detail.id) setChat(detail);
      setQuotaNotice(null); submittedPrompt.current = null;
      await refresh();
    }} />}
  </main>;
}
