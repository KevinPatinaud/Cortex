import { useCallback, useEffect, useId, useRef, useState } from "react";
import { ChevronDown, RefreshCw, X } from "lucide-react";
import type { CodexModelCatalog } from "../../../shared/CodexModel.ts";
import type { PromptModelSelection } from "../../../shared/PromptQueue.ts";
import { getPromptChatModels, getPromptDefaultModels } from "../../services/promptQueueApi.ts";
import { checkCodexEngineUpdate } from "../../services/codexEngineApi.ts";
import { useTranslation } from "../../i18n.tsx";
import { fr, en } from "./messages.ts";

interface Props {
  chatId?: string;
  value?: PromptModelSelection;
  initial: PromptModelSelection;
  disabled: boolean;
  onChange: (value: PromptModelSelection) => void;
  onValidityChange: (valid: boolean) => void;
}

export function reasoningLabel(effort: string, language: "fr" | "en"): string {
  const labels: Record<string, [string, string]> = {
    none: ["Sans réflexion", "None"], minimal: ["Minimal", "Minimal"], low: ["Faible", "Low"], medium: ["Moyen", "Medium"],
    high: ["Élevé", "High"], xhigh: ["Très élevé", "Very high"], max: ["Maximum", "Maximum"], ultra: ["Ultra", "Ultra"]
  };
  return labels[effort]?.[language === "fr" ? 0 : 1] ?? effort;
}

export function PromptModelPicker({ chatId, value, initial, disabled, onChange, onValidityChange }: Props) {
  const { language } = useTranslation();
  const copy = language === "fr" ? fr : en;
  const [catalog, setCatalog] = useState<CodexModelCatalog | null>(null);
  const [loading, setLoading] = useState(true);
  const [issue, setIssue] = useState("");
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null), triggerRef = useRef<HTMLButtonElement>(null);
  const focusRef = useRef<HTMLSelectElement>(null);
  const callbacks = useRef({ onChange, onValidityChange });
  callbacks.current = { onChange, onValidityChange };
  const pending = useRef(false), observedAt = useRef(0);
  const generation = useRef(0), mounted = useRef(true);
  const popoverId = useId(), titleId = useId();

  const refresh = useCallback(async () => {
    if (pending.current) return;
    const revision = generation.current;
    pending.current = true;
    setLoading(true);
    try {
      const next = await (chatId ? getPromptChatModels(chatId) : getPromptDefaultModels());
      if (!mounted.current || revision !== generation.current) return;
      if (next.available) { setCatalog(next); setIssue(""); observedAt.current = Date.now(); }
      else {
        setIssue(next.error || copy.modelsError);
        if (next.engineUpdate) setCatalog(current => current ? { ...current, engineUpdate: next.engineUpdate } : next);
      }
    } catch { if (mounted.current && revision === generation.current) setIssue(copy.modelsError); }
    finally {
      if (revision === generation.current) { pending.current = false; if (mounted.current) setLoading(false); }
    }
  }, [chatId, copy.modelsError]);

  useEffect(() => {
    mounted.current = true;
    generation.current++; pending.current = false; observedAt.current = 0;
    setCatalog(null); setIssue("");
    void refresh();
    const update = () => { if (document.visibilityState === "visible") void refresh(); };
    const timer = setInterval(update, 60_000);
    window.addEventListener("focus", update);
    document.addEventListener("visibilitychange", update);
    return () => {
      mounted.current = false; generation.current++; clearInterval(timer);
      window.removeEventListener("focus", update); document.removeEventListener("visibilitychange", update);
    };
  }, [refresh]);

  const profile = value ?? initial;
  const models = catalog?.models ?? [];
  const defaultModel = models.find(entry => entry.model === catalog?.defaultModel) ?? models.find(entry => entry.isDefault) ?? models[0];
  const selectedModel = models.find(entry => entry.model === profile.model) ?? (!profile.model ? defaultModel : undefined);
  const currentEffort = profile.reasoningEffort || (selectedModel?.reasoningEfforts.includes(catalog?.configuredReasoningEffort ?? "")
    ? catalog!.configuredReasoningEffort! : selectedModel?.defaultReasoningEffort ?? "");
  const modelMissing = Boolean(profile.model && catalog?.available && !models.some(entry => entry.model === profile.model));
  const effortMissing = Boolean(currentEffort && selectedModel?.reasoningEfforts.length && !selectedModel.reasoningEfforts.includes(currentEffort));
  const engine = catalog?.engineUpdate;
  const updating = Boolean(engine && ["checking", "installing", "waiting"].includes(engine.state));
  const updateLabels = { idle: copy.engineIdle, checking: copy.engineChecking, installing: copy.engineInstalling, waiting: copy.engineWaiting,
    updated: copy.engineUpdated, up_to_date: copy.engineCurrent, error: copy.engineUpdateError };
  useEffect(() => {
    if (!updating) return;
    const timer = setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 3000);
    return () => clearInterval(timer);
  }, [updating, refresh]);

  useEffect(() => {
    if (!value && selectedModel && catalog?.available) callbacks.current.onChange({ model: selectedModel.model, reasoningEffort: currentEffort });
  }, [value, selectedModel?.model, currentEffort, catalog?.available]);
  useEffect(() => { callbacks.current.onValidityChange(!modelMissing && !effortMissing); }, [modelMissing, effortMissing]);

  useEffect(() => {
    if (!open) return;
    requestAnimationFrame(() => focusRef.current?.focus());
    const outside = (event: PointerEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  function close() { setOpen(false); triggerRef.current?.focus(); }
  const modelLabel = selectedModel?.displayName || profile.model || copy.automatic;
  return <div className="prompt-model-picker" ref={rootRef} onKeyDown={event => { if (event.key === "Escape" && open) { event.preventDefault(); event.stopPropagation(); close(); } }}>
    <button type="button" className={`prompt-model-trigger${modelMissing || effortMissing ? " prompt-model-trigger--warning" : ""}`} ref={triggerRef}
      disabled={disabled} aria-label={copy.chooseModel} aria-expanded={open} aria-haspopup="dialog" aria-controls={open ? popoverId : undefined}
      onClick={() => { const next = !open; setOpen(next); if (next && Date.now() - observedAt.current > 5000) void refresh(); }}>
      <strong>{modelLabel}</strong><span>{currentEffort ? reasoningLabel(currentEffort, language) : copy.default}</span><ChevronDown aria-hidden="true" size={14} />
    </button>
    {open && <div className="prompt-model-popover" id={popoverId} role="dialog" aria-labelledby={titleId}>
      <header><strong id={titleId}>{copy.modelAndReasoning}</strong><button type="button" aria-label={copy.close} onClick={close}><X size={16} aria-hidden="true" /></button></header>
      <label>{copy.model}<select ref={focusRef} value={selectedModel?.model ?? profile.model} disabled={loading || !catalog?.available} onChange={event => {
        const model = models.find(entry => entry.model === event.target.value);
        if (model) callbacks.current.onChange({ model: model.model, reasoningEffort: model.reasoningEfforts.includes(currentEffort) ? currentEffort : model.defaultReasoningEffort ?? model.reasoningEfforts[0] ?? "" });
      }}>
        {!selectedModel && <option value={profile.model}>{profile.model || copy.automatic}</option>}
        {models.map(model => <option key={model.model} value={model.model}>{model.displayName}</option>)}
      </select></label>
      <label>{copy.reasoning}<select value={currentEffort} disabled={loading || !selectedModel || !selectedModel.reasoningEfforts.length} onChange={event => {
        if (selectedModel) callbacks.current.onChange({ model: selectedModel.model, reasoningEffort: event.target.value });
      }}>
        {!currentEffort && <option value="">{copy.default}</option>}
        {effortMissing && <option value={currentEffort}>{reasoningLabel(currentEffort, language)}</option>}
        {selectedModel?.reasoningEfforts.map(effort => <option key={effort} value={effort}>{reasoningLabel(effort, language)}</option>)}
      </select></label>
      <p className="prompt-model-help">{copy.nextPromptsProfile}</p>
      {(modelMissing || effortMissing) && <p className="prompt-model-error" role="alert">{modelMissing ? copy.savedModelUnavailable : copy.savedEffortUnavailable}</p>}
      {issue && <p className="prompt-model-error" role="status">{issue}</p>}
      {engine && <p className={engine.state === "error" ? "prompt-model-error" : "prompt-model-help"} role="status">{updateLabels[engine.state].replace("{version}", engine.latestVersion ?? "")}</p>}
      <footer><small>{catalog?.cliVersion ? `Codex ${catalog.cliVersion} · ` : ""}{loading ? copy.loadingModels : copy.modelsAutoRefresh}</small><button type="button" aria-label={copy.loadModels} title={copy.loadModels} disabled={loading} onClick={() => {
        if (!engine) { void refresh(); return; }
        void checkCodexEngineUpdate().then(() => refresh()).catch(() => setIssue(copy.engineUpdateError));
      }}><RefreshCw size={15} aria-hidden="true" /></button></footer>
    </div>}
  </div>;
}
