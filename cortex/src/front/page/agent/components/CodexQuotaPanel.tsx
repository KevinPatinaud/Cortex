import { useEffect, useId, useState } from "react";
import { useTranslation } from "../../../i18n.tsx";
import { DEFAULT_CODEX_QUOTA_CONFIGURATION, type CodexQuotaStatus } from "../../../../shared/CodexQuota.ts";
import { getCodexQuotaConfiguration, getCodexQuotaStatus, saveCodexQuotaConfiguration } from "../../../services/codexQuotaApi.ts";

export function CodexQuotaPanel() {
  const { language, t } = useTranslation();
  const titleId = useId();
  const helpId = useId();
  const [configuration, setConfiguration] = useState(DEFAULT_CODEX_QUOTA_CONFIGURATION);
  const [fiveHour, setFiveHour] = useState("50");
  const [weekly, setWeekly] = useState("10");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<CodexQuotaStatus | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    setLoaded(false);
    setError("");
    void getCodexQuotaConfiguration().then((value) => {
      if (!active) return;
      setConfiguration(value);
      setFiveHour(String(value.minimumFiveHourRemainingPercent));
      setWeekly(String(value.minimumWeeklyRemainingPercent));
      setLoaded(true);
    }).catch((reason) => { if (active) setError(reason instanceof Error ? reason.message : t("quota.loadError")); });
    return () => { active = false; };
  }, [attempt]);

  async function refresh() {
    setRefreshing(true);
    setError("");
    try { setStatus(await getCodexQuotaStatus()); }
    catch (reason) { setError(reason instanceof Error ? reason.message : t("quota.loadError")); }
    finally { setRefreshing(false); }
  }

  const valid = [fiveHour, weekly].every(value => value.trim() !== "" && Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 100);
  const dirty = Number(fiveHour) !== configuration.minimumFiveHourRemainingPercent || Number(weekly) !== configuration.minimumWeeklyRemainingPercent;

  async function save(enabled: boolean, useDraft = true) {
    if (!loaded || saving || (useDraft && !valid)) return;
    const previous = configuration;
    const next = { enabled,
      minimumFiveHourRemainingPercent: useDraft ? Number(fiveHour) : configuration.minimumFiveHourRemainingPercent,
      minimumWeeklyRemainingPercent: useDraft ? Number(weekly) : configuration.minimumWeeklyRemainingPercent };
    setConfiguration(next);
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const saved = await saveCodexQuotaConfiguration(next);
      setConfiguration(saved);
      setMessage(t("quota.saved"));
    } catch (reason) {
      setConfiguration(previous);
      setError(reason instanceof Error ? reason.message : t("engine.saveError"));
    }
    finally { setSaving(false); }
  }

  function windowText(window: CodexQuotaStatus["fiveHour"]) {
    return window ? t("quota.remaining", { value: Number(window.remainingPercent.toFixed(2)) }) : t("quota.unknown");
  }

  return (
    <section className="codex-quota-panel" aria-labelledby={titleId}>
      <label className="codex-quota-panel__toggle">
        <span><strong id={titleId}>{t("quota.title")}</strong><small id={helpId}>{t("quota.help")}</small></span>
        <input type="checkbox" checked={configuration.enabled} disabled={!loaded || saving}
          aria-labelledby={titleId} aria-describedby={helpId} onChange={event => void save(event.target.checked, false)} />
      </label>
      <p>{t("quota.scope")}</p>
      <form onSubmit={event => { event.preventDefault(); void save(configuration.enabled); }}>
        <div className="codex-quota-panel__thresholds">
          <label><span>{t("quota.fiveHour")}</span><input type="number" min="0" max="100" step="any" required
            value={fiveHour} disabled={!loaded || saving} onChange={event => { setFiveHour(event.target.value); setMessage(""); }} /></label>
          <label><span>{t("quota.weekly")}</span><input type="number" min="0" max="100" step="any" required
            value={weekly} disabled={!loaded || saving} onChange={event => { setWeekly(event.target.value); setMessage(""); }} /></label>
        </div>
        {!valid && <p role="alert">{t("quota.validation")}</p>}
        <button type="submit" disabled={!loaded || saving || !valid || !dirty}>{saving ? t("engine.saving") : t("quota.save")}</button>
      </form>
      <button type="button" disabled={refreshing} onClick={() => void refresh()}>{refreshing ? t("quota.refreshing") : t("quota.refresh")}</button>
      {status && <div className="codex-quota-panel__status" role="status">
        <p>{t("quota.currentFiveHour")}: <strong>{windowText(status.fiveHour)}</strong></p>
        <p>{t("quota.currentWeekly")}: <strong>{windowText(status.weekly)}</strong></p>
        <small>{t("quota.checkedAt", { time: new Date(status.checkedAt).toLocaleString(language) })}</small>
        {!status.available && <p>{t("quota.unavailable")}</p>}
      </div>}
      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error}</p>}
      {!loaded && error && <button type="button" onClick={() => setAttempt(value => value + 1)}>{t("project.retry")}</button>}
    </section>
  );
}
