import { useEffect, useState } from "react";
import { DEFAULT_EXECUTION_POLICY, type ExecutionPolicy, type ExecutionProfile, type AgentContinuity } from "../../../../shared/ExecutionQuality.ts";
import { findCatalogModel, type CodexModelCatalog } from "../../../../shared/CodexModel.ts";
import { requestJson } from "../../../services/apiClient.ts";
import { useTranslation } from "../../../i18n.tsx";
import { ModelOptionGroups } from "../../shared/ModelOptionGroups.tsx";

interface QualitySettings {
  policy: ExecutionPolicy;
  catalog?: CodexModelCatalog;
  profiles: Array<{ name: string; profile?: ExecutionProfile; error?: string }>;
  memories: Array<{ name: string; record: { updatedAt: string; continuity: AgentContinuity } | null }>;
}

export function ExecutionQualityPanel({ projectId }: { projectId: string }) {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<QualitySettings | null>(null);
  const [draft, setDraft] = useState<ExecutionPolicy>({ ...DEFAULT_EXECUTION_POLICY });
  const [criteria, setCriteria] = useState("");
  const [checks, setChecks] = useState("[]");
  const [preflight, setPreflight] = useState("[]");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const endpoint = `/api/agents/projects/${encodeURIComponent(projectId)}/execution-policy`;
  useEffect(() => {
    let active = true;
    void requestJson<QualitySettings>(endpoint).then(value => {
      if (!active) return;
      setSettings(value); setDraft(value.policy); setCriteria(value.policy.acceptanceCriteria.join("\n"));
      setChecks(JSON.stringify(value.policy.checks, null, 2)); setPreflight(JSON.stringify(value.policy.preflightChecks, null, 2));
    }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [endpoint]);
  function change(value: Partial<ExecutionPolicy>) { setDraft(d => ({ ...d, ...value })); setDirty(true); setSaved(false); }
  async function save() {
    setSaving(true); setError(""); setSaved(false);
    try {
      const policy = { ...draft, acceptanceCriteria: criteria.split("\n").map(s => s.trim()).filter(Boolean),
        checks: JSON.parse(checks), preflightChecks: JSON.parse(preflight) };
      await requestJson(endpoint, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(policy) });
      const value = await requestJson<QualitySettings>(endpoint);
      setSettings(value); setDraft(value.policy); setDirty(false); setSaved(true);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setSaving(false); }
  }
  const catalogModels = settings?.catalog?.models ?? [];
  const defaultMatch = findCatalogModel(catalogModels, draft.defaultModel);
  const selectedModel = defaultMatch?.model ?? findCatalogModel(catalogModels, draft.defaultModel || settings?.catalog?.defaultModel)?.model;
  const interpretationMatch = findCatalogModel(catalogModels, draft.interpretationModel);
  const interpretationModel = interpretationMatch?.model ?? findCatalogModel(catalogModels, draft.interpretationModel || draft.defaultModel || settings?.catalog?.defaultModel)?.model;
  return <details className="execution-quality">
    <summary><strong>{t("quality.title")}</strong></summary>
    <p>{t("quality.description")}</p>
    {error && <p role="alert">{error}</p>}
    {!settings && !error && <p role="status">{t("common.loading")}</p>}
    {settings && <>
      <fieldset disabled={saving}>
        <label>{t("quality.workspace")}<input value={draft.workspaceDirectory} onChange={e => change({ workspaceDirectory: e.target.value })} /></label>
        <label>{t("quality.model")}<select value={defaultMatch ? defaultMatch.model.model : draft.defaultModel} onChange={e => {
          const next = e.target.value;
          const nextModel = findCatalogModel(catalogModels, next || settings.catalog?.defaultModel)?.model;
          change({
            defaultModel: next,
            ...(draft.defaultReasoningEffort && !nextModel?.reasoningEfforts.includes(draft.defaultReasoningEffort) ? { defaultReasoningEffort: "" } : {})
          });
        }}>
          <option value="">{t("quality.inherit")}</option>
          {draft.defaultModel && !defaultMatch && <option value={draft.defaultModel}>{draft.defaultModel}</option>}
          <ModelOptionGroups models={catalogModels} />
        </select></label>
        <label>{t("quality.reasoning")}<select value={draft.defaultReasoningEffort || defaultMatch?.matchedEffort || ""} onChange={e => change({
          ...(defaultMatch?.matchedEffort && defaultMatch.model.model !== draft.defaultModel ? { defaultModel: defaultMatch.model.model } : {}),
          defaultReasoningEffort: e.target.value
        })}>
          <option value="">{t("quality.inherit")}</option>
          {[...new Set([...(draft.defaultReasoningEffort || defaultMatch?.matchedEffort ? [draft.defaultReasoningEffort || defaultMatch!.matchedEffort!] : []), ...(selectedModel?.reasoningEfforts ?? [])])].map(effort => <option key={effort} value={effort}>{effort}</option>)}
        </select></label>
        <label>{t("quality.resultMode")}<select value={draft.resultMode ?? "separate"} onChange={e => change({ resultMode: e.target.value as ExecutionPolicy["resultMode"] })}>
          <option value="separate">{t("quality.separate")}</option><option value="integrated">{t("quality.integrated")}</option>
        </select></label>
        {draft.resultMode !== "integrated" && <>
          <p>{t("quality.interpretationHelp")}</p>
          <label>{t("quality.interpretationModel")}<select value={interpretationMatch ? interpretationMatch.model.model : (draft.interpretationModel ?? "")} onChange={e => {
            const next = e.target.value;
            const nextModel = findCatalogModel(catalogModels, next || draft.defaultModel || settings.catalog?.defaultModel)?.model;
            const currentEffort = draft.interpretationReasoningEffort ?? "low";
            const nextEffort = nextModel && nextModel.reasoningEfforts.length && !nextModel.reasoningEfforts.includes(currentEffort)
              ? (nextModel.reasoningEfforts.includes("low") ? "low" : nextModel.defaultReasoningEffort ?? nextModel.reasoningEfforts[0] ?? "")
              : currentEffort;
            change({ interpretationModel: next, interpretationReasoningEffort: nextEffort });
          }}>
            <option value="">{t("quality.sameModel")}</option>
            {draft.interpretationModel && !interpretationMatch && <option value={draft.interpretationModel}>{draft.interpretationModel}</option>}
            <ModelOptionGroups models={catalogModels} />
          </select></label>
          <label>{t("quality.interpretationReasoning")}<select value={draft.interpretationReasoningEffort ?? interpretationMatch?.matchedEffort ?? "low"} onChange={e => change({
            ...(interpretationMatch?.matchedEffort && interpretationMatch.model.model !== draft.interpretationModel ? { interpretationModel: interpretationMatch.model.model } : {}),
            interpretationReasoningEffort: e.target.value
          })}>
            {[...new Set([draft.interpretationReasoningEffort || interpretationMatch?.matchedEffort || "low", ...(interpretationModel?.reasoningEfforts ?? [])])].map(effort => <option key={effort} value={effort}>{effort}</option>)}
          </select></label>
        </>}
        <label>{t("quality.delegation")}<select value={draft.delegation} onChange={e => change({ delegation: e.target.value as ExecutionPolicy["delegation"] })}>
          <option value="none">{t("quality.none")}</option><option value="bounded">{t("quality.bounded")}</option>
        </select></label>
        <label className="execution-quality__checkbox"><input type="checkbox" checked={draft.resumeUnfinished} onChange={e => change({ resumeUnfinished: e.target.checked })} />{t("quality.continuity")}</label>
        <label>{t("quality.criteria")}<textarea rows={4} value={criteria} onChange={e => { setCriteria(e.target.value); change({}); }} /></label>
        <details><summary>{t("quality.advanced")}</summary>
          <p>{t("quality.commandsHelp")}</p>
          <label>{t("quality.preflight")}<textarea rows={5} value={preflight} onChange={e => { setPreflight(e.target.value); change({}); }} /></label>
          <label>{t("quality.checks")}<textarea rows={5} value={checks} onChange={e => { setChecks(e.target.value); change({}); }} /></label>
        </details>
        <button type="button" disabled={!dirty || saving} onClick={() => void save()}>{saving ? t("common.loading") : t("quality.save")}</button>
      </fieldset>
      {saved && <p role="status">{t("quality.saved")}</p>}
      <h3>{t("quality.effective")}</h3><p>{t("quality.precedence")}</p>
      {settings.profiles.map((entry, i) => <dl className="execution-quality__profile" key={i}>
        <dt>{entry.name}</dt><dd>{entry.error || `${entry.profile?.model ?? "?"} / ${entry.profile?.reasoningEffort ?? "?"} · CLI ${entry.profile?.cliVersion ?? "?"}`}</dd>
        {entry.profile && <><dt>{t("quality.workspace")}</dt><dd>{entry.profile.workingDirectory}</dd>
          <dt>{t("quality.resolution")}</dt><dd>{t(entry.profile.resolution === "pinned" ? "quality.pinned" : "quality.unavailable")}</dd></>}
      </dl>)}
      {settings.memories.some(m => m.record) && <details><summary>{t("quality.memory")}</summary>{settings.memories.filter(m => m.record).map((m, i) => <article key={i}>
        <h4>{m.name}</h4><time>{m.record!.updatedAt}</time><p>{m.record!.continuity.summary}</p>
        <pre>{JSON.stringify(m.record!.continuity, null, 2)}</pre>
      </article>)}</details>}
    </>}
  </details>;
}
