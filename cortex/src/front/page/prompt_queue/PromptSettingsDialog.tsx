import { useEffect, useId, useRef, useState } from "react";
import { RefreshCw, X } from "lucide-react";
import { useTranslation } from "../../i18n.tsx";
import type { PromptChatDetail, PromptQueueOverview } from "../../../shared/PromptQueue.ts";
import type { CodexModelCatalog } from "../../../shared/CodexModel.ts";
import { getSavedProjects, type Project } from "../../services/projectApi.ts";
import { saveCodexQuotaConfiguration } from "../../services/codexQuotaApi.ts";
import { checkPromptQueue, deletePromptChat, getPromptChatModels, getPromptDefaultModels, savePromptChat, savePromptQueueSettings } from "../../services/promptQueueApi.ts";
import { trapDialogFocus } from "../shared/dialogFocus.ts";
import { fr, en } from "./messages.ts";

interface Props {
  overview: PromptQueueOverview;
  chat: PromptChatDetail | null;
  initialTab: "defaults" | "chat";
  onClose: () => void;
  onSaved: () => Promise<void>;
  onDeleted: () => void;
}

export function PromptSettingsDialog({ overview, chat, initialTab, onClose, onSaved, onDeleted }: Props) {
  const { language, t } = useTranslation();
  const copy = language === "fr" ? fr : en;
  const titleId = useId(), panelId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [tab, setTab] = useState(initialTab);
  const [defaults, setDefaults] = useState(overview.defaults);
  const [fiveHour, setFiveHour] = useState(String(overview.quota.minimumFiveHourRemainingPercent));
  const [weekly, setWeekly] = useState(String(overview.quota.minimumWeeklyRemainingPercent));
  const [concurrency, setConcurrency] = useState(String(overview.maxConcurrentChats));
  const [chatName, setChatName] = useState(chat?.title ?? "");
  const [chatModel, setChatModel] = useState(chat?.model ?? "");
  const [chatEffort, setChatEffort] = useState(chat?.reasoningEffort ?? "");
  const [catalog, setCatalog] = useState<CodexModelCatalog | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [refreshModels, setRefreshModels] = useState(0);
  const initialFocus = useRef<HTMLButtonElement>(null);
  const running = Boolean(chat?.prompts.some(prompt => prompt.status === "running"));

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    initialFocus.current?.focus();
    return () => { if (dialog?.open) dialog.close(); };
  }, []);
  useEffect(() => {
    let active = true;
    void getSavedProjects().then(value => { if (active) setProjects(value); }).catch(() => {});
    return () => { active = false; };
  }, []);
  useEffect(() => {
    let active = true;
    setLoading(true); setCatalog(null);
    const request = tab === "chat" && chat ? getPromptChatModels(chat.id) : getPromptDefaultModels();
    void request.then(value => { if (active) setCatalog(value); }).catch(() => { if (active) setCatalog(null); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [tab, chat?.id, refreshModels]);

  async function action(operation: () => Promise<void>, notifySaved = false) {
    if (busy) return;
    setBusy(true); setError(""); setMessage("");
    try { await operation(); await onSaved(); if (notifySaved) setMessage(copy.saved); }
    catch (reason) { setError(reason instanceof Error ? reason.message : copy.error); }
    finally { setBusy(false); }
  }
  const model = tab === "defaults" ? defaults.model : chatModel;
  const effort = tab === "defaults" ? defaults.reasoningEffort : chatEffort;
  const models = catalog?.models ?? [];
  const automaticModel = models.find(candidate => candidate.model === catalog?.defaultModel) ?? models.find(candidate => candidate.isDefault) ?? models[0];
  const selectedModel = models.find(candidate => candidate.model === model) ?? (!model ? automaticModel : undefined);
  const modelMissing = Boolean(model && catalog?.available && !models.some(candidate => candidate.model === model));
  const valid = [fiveHour, weekly].every(value => value.trim() !== "" && Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 100)
    && Number.isInteger(Number(concurrency)) && Number(concurrency) >= 1 && Number(concurrency) <= 8;
  function changeModel(value: string) {
    if (tab === "defaults") setDefaults(current => ({ ...current, model: value, reasoningEffort: "" }));
    else { setChatModel(value); setChatEffort(""); }
  }
  const modelFields = <>
    <div className="prompt-settings-fields">
      <label>{copy.model}<select value={model} disabled={busy || loading || !catalog?.available || (tab === "chat" && running)} onChange={event => changeModel(event.target.value)}>
        <option value="">{copy.automatic}{automaticModel ? ` (${automaticModel.displayName})` : ""}</option>
        {modelMissing && <option value={model}>{model}</option>}
        {models.map(candidate => <option key={candidate.model} value={candidate.model}>{candidate.displayName}</option>)}
      </select></label>
      <label>{copy.effort}<select value={effort} disabled={busy || loading || !catalog?.available || (tab === "chat" && running)} onChange={event => {
        if (tab === "defaults") setDefaults(current => ({ ...current, reasoningEffort: event.target.value })); else setChatEffort(event.target.value);
      }}><option value="">{copy.default}</option>
        {effort && !selectedModel?.reasoningEfforts.includes(effort) && <option value={effort}>{effort}</option>}
        {selectedModel?.reasoningEfforts.map(value => <option key={value}>{value}</option>)}
      </select></label>
    </div>
    <div className="prompt-model-refresh"><small>{loading ? t("models.loading") : !catalog?.available ? copy.modelsError : modelMissing ? copy.savedModelUnavailable : ""}</small>
      <button type="button" disabled={busy || loading} onClick={() => setRefreshModels(value => value + 1)} aria-label={copy.loadModels} title={copy.loadModels}><RefreshCw size={15} aria-hidden="true" /></button></div>
  </>;

  return <dialog ref={dialogRef} className="prompt-settings-dialog" aria-labelledby={titleId} aria-modal="true" onKeyDown={trapDialogFocus}
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <header><h2 id={titleId}>{copy.settings}</h2><button type="button" ref={initialFocus} aria-label={copy.close} onClick={onClose} disabled={busy}><X aria-hidden="true" size={19} /></button></header>
    <div className="prompt-settings-tabs" role="tablist" aria-label={copy.settings} onKeyDown={event => {
      if (!chat || busy || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === "Home" ? "defaults" : event.key === "End" ? "chat" : tab === "chat" ? "defaults" : "chat";
      setTab(next); setError(""); setMessage("");
      const buttons = event.currentTarget.querySelectorAll<HTMLButtonElement>("button");
      buttons[next === "defaults" ? 0 : 1]?.focus();
    }}>
      <button role="tab" type="button" tabIndex={tab === "defaults" ? 0 : -1} disabled={busy} aria-selected={tab === "defaults"} aria-controls={panelId} id={`${panelId}-defaults`} onClick={() => { setTab("defaults"); setError(""); setMessage(""); }}>{copy.defaultsTab}</button>
      {chat && <button role="tab" type="button" tabIndex={tab === "chat" ? 0 : -1} disabled={busy} aria-selected={tab === "chat"} aria-controls={panelId} id={`${panelId}-chat`} onClick={() => { setTab("chat"); setError(""); setMessage(""); }}>{copy.chatTab}</button>}
    </div>
    <div className="prompt-settings-body" role="tabpanel" id={panelId} aria-labelledby={`${panelId}-${tab}`}>
      {error && <p className="prompt-settings-error" role="alert">{error}</p>}
      {message && <p className="prompt-settings-message" role="status">{message}</p>}
      {tab === "defaults" ? <form onSubmit={event => { event.preventDefault(); void action(async () => {
        await savePromptQueueSettings({ defaults, maxConcurrentChats: Number(concurrency) });
        await saveCodexQuotaConfiguration({ ...overview.quota, minimumFiveHourRemainingPercent: Number(fiveHour), minimumWeeklyRemainingPercent: Number(weekly) });
      }, true); }}>
        <p className="prompt-settings-help">{copy.defaultsHelp}</p>
        {modelFields}
        <label>{copy.project}<select value={projects.some(project => project.directoryPath === defaults.workingDirectory) ? defaults.workingDirectory : defaults.workingDirectory ? "__custom" : ""}
          disabled={busy} onChange={event => { if (event.target.value !== "__custom") setDefaults(current => ({ ...current, workingDirectory: event.target.value })); }}>
          <option value="">{copy.automaticDirectory}</option>{defaults.workingDirectory && !projects.some(project => project.directoryPath === defaults.workingDirectory) && <option value="__custom">{copy.custom}</option>}
          {projects.map(project => <option key={project.id} value={project.directoryPath}>{project.directoryPath.split(/[\\/]/).filter(Boolean).at(-1)}</option>)}
        </select></label>
        <label>{copy.directory}<input value={defaults.workingDirectory} disabled={busy} onChange={event => setDefaults(current => ({ ...current, workingDirectory: event.target.value }))} placeholder={copy.automaticDirectory} /></label>
        <p className="prompt-settings-help">{copy.directoryHelp}</p>
        <label className="prompt-settings-check"><input type="checkbox" checked={defaults.autoStart} disabled={busy} onChange={event => setDefaults(current => ({ ...current, autoStart: event.target.checked }))} />{copy.autoStart}</label>
        <p className="prompt-settings-help">{copy.autoStartHelp}</p>
        <h3>{copy.reserve}</h3><p className="prompt-settings-help">{copy.reserveHelp}</p>
        <div className="prompt-settings-fields"><label>{t("quota.fiveHour")}<input type="number" min="0" max="100" step="any" required value={fiveHour} disabled={busy} onChange={event => setFiveHour(event.target.value)} /></label>
          <label>{t("quota.weekly")}<input type="number" min="0" max="100" step="any" required value={weekly} disabled={busy} onChange={event => setWeekly(event.target.value)} /></label></div>
        <label>{copy.concurrency}<input type="number" min="1" max="8" required value={concurrency} disabled={busy} onChange={event => setConcurrency(event.target.value)} /></label>
        <section className="prompt-settings-quota" aria-label={copy.reserve}>
          <p>{t("quota.currentFiveHour")} : <strong>{overview.quotaStatus?.fiveHour ? `${Number(overview.quotaStatus.fiveHour.remainingPercent.toFixed(1))} ${copy.remaining}` : copy.unknown}</strong></p>
          <p>{t("quota.currentWeekly")} : <strong>{overview.quotaStatus?.weekly ? `${Number(overview.quotaStatus.weekly.remainingPercent.toFixed(1))} ${copy.remaining}` : copy.unknown}</strong></p>
          {overview.quotaStatus && <small>{copy.checkAt} : {new Date(overview.quotaStatus.checkedAt).toLocaleString(language)}</small>}
          <button type="button" disabled={busy} onClick={() => void action(async () => { await checkPromptQueue(); })}><RefreshCw size={15} aria-hidden="true" />{copy.check}</button>
        </section>
        <footer><small>{copy.defaultsScope}</small><button type="submit" className="prompt-primary" disabled={busy || !valid}>{copy.save}</button></footer>
      </form> : chat && <form onSubmit={event => { event.preventDefault(); void action(async () => {
        await savePromptChat(chat.id, { title: chatName, model: chatModel, reasoningEffort: chatEffort });
      }, true); }}>
        <label>{copy.name}<input required maxLength={160} value={chatName} disabled={busy || running} onChange={event => setChatName(event.target.value)} /></label>
        {modelFields}
        <label>{copy.directory}<input readOnly value={chat.workingDirectory} /></label>
        <footer><button type="button" className="prompt-danger" disabled={busy || running} onClick={() => {
          if (window.confirm(copy.deleteConfirm)) void action(async () => { await deletePromptChat(chat.id); onDeleted(); onClose(); });
        }}>{copy.delete}</button><button type="submit" className="prompt-primary" disabled={busy || running || !chatName.trim()}>{copy.save}</button></footer>
      </form>}
    </div>
  </dialog>;
}
