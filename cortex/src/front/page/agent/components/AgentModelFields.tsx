import { useEffect, useId, useState } from "react";
import { RefreshCw } from "lucide-react";
import type { CodexModelCatalog } from "../../../../shared/CodexModel.ts";
import type { AgentEngine } from "../../../services/agentApi.ts";
import { getCodexModelCatalog } from "../../../services/codexModelApi.ts";
import { useTranslation } from "../../../i18n.tsx";

interface Props {
  engine: AgentEngine;
  projectId: string;
  model: string;
  reasoningEffort: string;
  disabled: boolean;
  onChange: (change: { model?: string; reasoningEffort?: string }) => void;
}

export function AgentModelFields({ engine, projectId, model, reasoningEffort, disabled, onChange }: Props) {
  const { t } = useTranslation();
  const listId = useId();
  const helpId = useId();
  const [catalog, setCatalog] = useState<CodexModelCatalog | null>(null);
  const [loading, setLoading] = useState(engine === "codex");
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (engine !== "codex") return;
    let active = true;
    setLoading(true);
    setCatalog(null);
    setError("");
    void getCodexModelCatalog(projectId).then(value => {
      if (!active) return;
      setCatalog(value);
      if (!value.available) setError(t("models.loadError"));
    }).catch(() => { if (active) setError(t("models.loadError")); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [engine, projectId, attempt]);

  const models = catalog?.models ?? [];
  const current = models.find(candidate => candidate.model === (model || catalog?.defaultModel));
  const modelMissing = Boolean(model && catalog?.available && !models.some(candidate => candidate.model === model));
  const efforts = engine === "codex" ? current?.reasoningEfforts ?? [] : ["low", "medium", "high", "xhigh"];
  const effortMissing = Boolean(reasoningEffort && !efforts.includes(reasoningEffort));
  function effortLabel(effort: string) {
    switch (effort) {
      case "low": return t("editor.low");
      case "medium": return t("editor.medium");
      case "high": return t("editor.high");
      case "xhigh": return t("editor.xhigh");
      case "max": return t("models.max");
      case "ultra": return t("models.ultra");
      default: return effort;
    }
  }

  return <div className="agent-inspector__row agent-inspector__row--compact agent-model-fields">
    <div className="agent-model-fields__model">
      <label className="editor-field">
        <span>{t("agent.model")} <em>{t("editor.optional")}</em></span>
        {engine === "codex" ? <select value={model} aria-describedby={helpId}
          disabled={disabled || loading || !catalog?.available}
          onChange={event => {
            const next = event.target.value;
            const selected = models.find(candidate => candidate.model === (next || catalog?.defaultModel));
            onChange({ model: next, ...(reasoningEffort && !selected?.reasoningEfforts.includes(reasoningEffort) ? { reasoningEffort: "" } : {}) });
          }}>
          <option value="">{t("editor.defaultModel")}{catalog?.defaultModel ? ` (${catalog.defaultModel})` : ""}</option>
          {model && !models.some(candidate => candidate.model === model) && <option value={model}>{model} — {t("models.savedValue")}</option>}
          {models.map(candidate => <option key={candidate.model} value={candidate.model}>
            {candidate.displayName === candidate.model ? candidate.model : `${candidate.displayName} (${candidate.model})`}
          </option>)}
        </select> : <>
          <input value={model} disabled={disabled} placeholder={t("editor.defaultModel")} list={listId}
            onChange={event => onChange({ model: event.target.value })} />
          {engine === "claude" && <datalist id={listId}>{["sonnet", "opus", "haiku"].map(value => <option value={value} key={value} />)}</datalist>}
        </>}
      </label>
      {engine === "codex" && <div className="agent-model-fields__catalog">
        <small id={helpId} role="status">{loading ? t("models.loading") : error || (catalog?.cliVersion
          ? t("models.serverVersion", { version: catalog.cliVersion }) : t("models.serverCatalog"))}</small>
        <button type="button" onClick={() => setAttempt(value => value + 1)} disabled={loading || disabled}
          aria-label={t("models.refresh")} title={t("models.refresh")}><RefreshCw aria-hidden="true" size={15} /></button>
        {modelMissing && <p role="status">{t("models.missingModel")}</p>}
      </div>}
    </div>
    <div>
      <label className="editor-field">
        <span>{t("editor.reasoningEffort")} <em>{t("editor.optional")}</em></span>
        <select value={reasoningEffort} disabled={disabled || (engine === "codex" && (loading || !catalog?.available || !current))}
          onChange={event => onChange({ reasoningEffort: event.target.value })}>
          <option value="">{t("editor.default")}</option>
          {effortMissing && <option value={reasoningEffort}>{reasoningEffort} — {t("models.savedValue")}</option>}
          {efforts.map(effort => <option value={effort} key={effort}>{effortLabel(effort)}</option>)}
        </select>
      </label>
      {engine === "codex" && catalog?.available && current && effortMissing && <small className="agent-model-fields__warning" role="status">{t("models.missingEffort")}</small>}
    </div>
  </div>;
}
