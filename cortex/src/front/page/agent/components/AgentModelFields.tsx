import { useEffect, useId, useState } from "react";
import { RefreshCw } from "lucide-react";
import {
  findCatalogModel,
  formatCatalogVersions,
  type CodexModelCatalog
} from "../../../../shared/CodexModel.ts";
import type { AgentEngine } from "../../../services/agentApi.ts";
import { getCodexModelCatalog } from "../../../services/codexModelApi.ts";
import { useTranslation } from "../../../i18n.tsx";
import { ModelOptionGroups } from "../../shared/ModelOptionGroups.tsx";

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
  const usesServerCatalog = engine === "codex" || engine === "gemini";
  const [catalog, setCatalog] = useState<CodexModelCatalog | null>(null);
  const [loading, setLoading] = useState(usesServerCatalog);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!usesServerCatalog) return;
    let active = true;
    setLoading(true);
    setCatalog(null);
    setError("");
    void getCodexModelCatalog(projectId, engine).then(value => {
      if (!active) return;
      setCatalog(value);
      if (!value.available) setError(t("models.loadError"));
    }).catch(() => { if (active) setError(t("models.loadError")); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [engine, projectId, attempt, usesServerCatalog]);

  const models = catalog?.models ?? [];
  const matched = findCatalogModel(models, model);
  const selectModelValue = matched ? matched.model.model : model;
  const current = matched?.model ?? (!model ? findCatalogModel(models, catalog?.defaultModel)?.model : undefined);
  const modelMissing = Boolean(model && catalog?.available && !matched);
  const effectiveEffort = reasoningEffort || matched?.matchedEffort || "";
  const efforts = usesServerCatalog
    ? current?.reasoningEfforts ?? []
    : ["low", "medium", "high", "xhigh"];
  const effortMissing = Boolean(effectiveEffort && !efforts.includes(effectiveEffort));
  const versions = formatCatalogVersions(catalog);
  function effortLabel(effort: string) {
    switch (effort) {
      case "none": return t("models.none");
      case "minimal": return t("models.minimal");
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
        {usesServerCatalog ? <select value={selectModelValue} aria-describedby={helpId}
          disabled={disabled || loading || !catalog?.available}
          onChange={event => {
            const next = event.target.value;
            const selected = findCatalogModel(models, next || catalog?.defaultModel)?.model;
            onChange({
              model: next,
              ...(effectiveEffort && !selected?.reasoningEfforts.includes(effectiveEffort)
                ? { reasoningEffort: "" }
                : matched?.matchedEffort && !reasoningEffort && selected?.reasoningEfforts.includes(effectiveEffort)
                  ? { reasoningEffort: effectiveEffort }
                  : {})
            });
          }}>
          <option value="">{t("editor.defaultModel")}{catalog?.defaultModel ? ` (${catalog.defaultModel})` : ""}</option>
          {model && !matched && <option value={model}>{model} — {t("models.savedValue")}</option>}
          <ModelOptionGroups
            models={models}
            formatLabel={candidate => candidate.displayName === candidate.model ? candidate.model : `${candidate.displayName} (${candidate.model})`}
          />
        </select> : <>
          <input value={model} disabled={disabled} placeholder={t("editor.defaultModel")} list={listId}
            onChange={event => onChange({ model: event.target.value })} />
          {engine === "claude" && <datalist id={listId}>{["sonnet", "opus", "haiku"].map(value => <option value={value} key={value} />)}</datalist>}
        </>}
      </label>
      {usesServerCatalog && <div className="agent-model-fields__catalog">
        <small id={helpId} role="status">{loading ? t("models.loading") : error || (versions
          ? t("models.serverVersions", { versions }) : t("models.serverCatalog"))}</small>
        <button type="button" onClick={() => setAttempt(value => value + 1)} disabled={loading || disabled}
          aria-label={t("models.refresh")} title={t("models.refresh")}><RefreshCw aria-hidden="true" size={15} /></button>
        {modelMissing && <p role="status">{t("models.missingModel")}</p>}
      </div>}
    </div>
    <div>
      <label className="editor-field">
        <span>{t("editor.reasoningEffort")} <em>{t("editor.optional")}</em></span>
        <select value={effectiveEffort}
          disabled={disabled || (usesServerCatalog && (loading || !catalog?.available || !current || (!efforts.length && !effectiveEffort)))}
          onChange={event => onChange({
            ...(matched?.matchedEffort && matched.model.model !== model ? { model: matched.model.model } : {}),
            reasoningEffort: event.target.value
          })}>
          <option value="">{t("editor.default")}</option>
          {effortMissing && <option value={effectiveEffort}>{effectiveEffort} — {t("models.savedValue")}</option>}
          {efforts.map(effort => <option value={effort} key={effort}>{effortLabel(effort)}</option>)}
        </select>
      </label>
      {usesServerCatalog && catalog?.available && current && effortMissing && <small className="agent-model-fields__warning" role="status">{t("models.missingEffort")}</small>}
    </div>
  </div>;
}
