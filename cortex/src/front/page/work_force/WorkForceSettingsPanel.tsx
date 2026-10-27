import { useEffect, useId, useState } from "react";
import { useTranslation } from "../../i18n.tsx";
import { getWorkForce, saveWorkForceSettings } from "../../services/workForceApi.ts";
import { fr, en } from "./messages.ts";
import "./workForceSettings.css";

export function WorkForceSettingsPanel() {
  const { language } = useTranslation();
  const copy = language === "fr" ? fr : en;
  const id = useId();
  const [fiveHour, setFiveHour] = useState(""), [weekly, setWeekly] = useState("");
  const [loaded, setLoaded] = useState(false), [busy, setBusy] = useState(false);
  const [error, setError] = useState(""), [message, setMessage] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let live = true;
    void getWorkForce().then(value => {
      if (!live) return;
      setFiveHour(String(value.settings.minimumFiveHourRemainingPercent));
      setWeekly(String(value.settings.minimumWeeklyRemainingPercent));
      setLoaded(true); setError("");
    }).catch(reason => { if (live) setError(String(reason.message)); });
    return () => { live = false; };
  }, [attempt]);
  const valid = [fiveHour, weekly].every(value => value.trim() !== "" && Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 100);
  return <section className="work-force-settings" aria-labelledby={id}>
    <h3 id={id}>{copy.settings}</h3><p>{copy.quotaHelp}</p><p>{copy.settingsIndependent}</p>
    <form onSubmit={event => {
      event.preventDefault();
      if (!loaded || !valid || busy) return;
      setBusy(true); setError(""); setMessage("");
      void saveWorkForceSettings({ minimumFiveHourRemainingPercent: Number(fiveHour), minimumWeeklyRemainingPercent: Number(weekly) })
        .then(() => setMessage(copy.settingsSaved)).catch(reason => setError(reason.message)).finally(() => setBusy(false));
    }}>
      <div className="codex-quota-panel__thresholds">
        <label><span>{copy.fiveHour}</span><input type="number" min="0" max="100" step="any" required value={fiveHour}
          disabled={!loaded || busy} onChange={event => { setFiveHour(event.target.value); setMessage(""); }} /></label>
        <label><span>{copy.weekly}</span><input type="number" min="0" max="100" step="any" required value={weekly}
          disabled={!loaded || busy} onChange={event => { setWeekly(event.target.value); setMessage(""); }} /></label>
      </div>
      <button type="submit" disabled={!loaded || !valid || busy}>{copy.saveSettings}</button>
    </form>
    {error && <p role="alert">{error} {!loaded && <button type="button" onClick={() => setAttempt(value => value + 1)}>{copy.retry}</button>}</p>}
    {message && <p role="status">{message}</p>}
  </section>;
}
