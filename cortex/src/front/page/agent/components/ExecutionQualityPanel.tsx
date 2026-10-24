import { useEffect, useState } from "react";
import { DEFAULT_EXECUTION_POLICY, type ExecutionPolicy, type ExecutionProfile, type AgentContinuity } from "../../../../shared/ExecutionQuality.ts";
import type { CodexModelCatalog } from "../../../../shared/CodexModel.ts";
import { requestJson } from "../../../services/apiClient.ts";
import { useTranslation } from "../../../i18n.tsx";

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
  const selectedModel = settings?.catalog?.models.find(m => m.model === (draft.defaultModel || settings.catalog?.defaultModel));
  return <details className="execution-quality">
    <summary><strong>{t("quality.title")}</strong></summary>
    <p>{t("quality.description")}</p>
    {error && <p role="alert">{error}</p>}
    {!settings && !error && <p role="status">{t("common.loading")}</p>}
    {settings && <>
      <fieldset disabled={saving}>
        <label>{t("quality.workspace")}<input value={draft.workspaceDirectory} onChange={e => change({ workspaceDirectory: e.target.value })} /></label>
        <label>{t("quality.model")}<select value={draft.defaultModel} onChange={e => change({ defaultModel: e.target.value })}>
          <option value="">{t("quality.inherit")}</option>
          {draft.defaultModel && !settings.catalog?.models.some(m => m.model === draft.defaultModel) && <option value={draft.defaultModel}>{draft.defaultModel}</option>}
          {settings.catalog?.models.map(model => <option key={model.model} value={model.model}>{model.displayName}</option>)}
        </select></label>
        <label>{t("quality.reasoning")}<select value={draft.defaultReasoningEffort} onChange={e => change({ defaultReasoningEffort: e.target.value })}>
          <option value="">{t("quality.inherit")}</option>
          {[...new Set([...(draft.defaultReasoningEffort ? [draft.defaultReasoningEffort] : []), ...(selectedModel?.reasoningEfforts ?? [])])].map(effort => <option key={effort} value={effort}>{effort}</option>)}
        </select></label>
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
