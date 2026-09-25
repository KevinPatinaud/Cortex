import { useEffect, useId, useState } from "react";
import { Pause, Play } from "lucide-react";
import { requestJson } from "../../../services/apiClient.ts";
import type { ProjectExecutionControl, ProjectExecutionPolicy } from "../../../../shared/ExecutionControl.ts";

export function ProjectExecutionControls({ projectId, onChange }: {
  projectId: string;
  onChange: (paused: boolean) => void;
}) {
  const id = useId();
  const [status, setStatus] = useState<ProjectExecutionControl | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [limits, setLimits] = useState({ maxCallsPerDay: "", maxTokensPerDay: "", maxCallsPerRun: "" });
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const endpoint = `/api/projects/${encodeURIComponent(projectId)}/execution-control`;
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function refresh() {
      try {
        const value = await requestJson<ProjectExecutionControl>(endpoint, { signal: controller.signal });
        if (alive) { setStatus(value); setError(""); }
      } catch (error) { if (alive) setError(error instanceof Error ? error.message : "Contrôles indisponibles."); }
      finally { if (alive) timer = setTimeout(() => void refresh(), 5000); }
    }
    setStatus(null); setEditing(false); setSaved(false);
    void refresh();
    return () => { alive = false; controller.abort(); clearTimeout(timer); };
  }, [endpoint]);
  useEffect(() => {
    if (!status || editing) return;
    setLimits({ maxCallsPerDay: status.policy.maxCallsPerDay?.toString() ?? "", maxTokensPerDay: status.policy.maxTokensPerDay?.toString() ?? "", maxCallsPerRun: status.policy.maxCallsPerRun?.toString() ?? "" });
  }, [status, editing]);

  async function save(policy: Partial<ProjectExecutionPolicy>) {
    setSaving(true); setError(""); setSaved(false);
    try {
      const value = await requestJson<ProjectExecutionControl>(endpoint, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(policy) });
      setStatus(value); setEditing(false); setSaved(true); onChange(value.policy.paused);
    } catch (error) { setError(error instanceof Error ? error.message : "Enregistrement impossible."); }
    finally { setSaving(false); }
  }

  return <section className="execution-controls" aria-label="Contrôle des exécutions">
    <div className="execution-controls__summary">
      <button type="button" disabled={!status || saving} onClick={() => void save({ paused: !status?.policy.paused })}>
        {status?.policy.paused ? <Play size={16} aria-hidden="true" /> : <Pause size={16} aria-hidden="true" />}
        {status?.policy.paused ? "Réactiver le projet" : "Mettre le projet en pause"}
      </button>
      <span role="status">{!status ? "Chargement des contrôles…" : status.policy.paused ? "Projet en pause" : "Projet actif"}</span>
    </div>
    {status?.policy.paused && <p>Les appels déjà commencés peuvent terminer. Les nouveaux appels, plannings et réveils sont suspendus. Après réactivation, reprenez explicitement les exécutions interrompues ; les attentes restées en sommeil reprendront automatiquement.</p>}
    <details>
      <summary>Consommation et limites</summary>
      {status && <p>{status.usage.calls} appels aujourd’hui (UTC) · {status.usage.measuredCalls === status.usage.calls && status.usage.calls > 0
        ? `${(status.usage.inputTokens + status.usage.outputTokens).toLocaleString("fr-FR")} tokens mesurés`
        : status.usage.measuredCalls > 0 ? `${(status.usage.inputTokens + status.usage.outputTokens).toLocaleString("fr-FR")} tokens connus sur ${status.usage.measuredCalls}/${status.usage.calls} appels` : "Tokens indisponibles"}.
        {" "}{status.server.activeCalls}/{status.server.maxConcurrentCalls} appels actifs sur le serveur, {status.server.queuedCalls} en file.</p>}
      <form onSubmit={event => { event.preventDefault(); void save(Object.fromEntries(Object.entries(limits).map(([key, value]) => [key, value === "" ? null : Number(value)]))); }}>
        {([ ["maxCallsPerDay", "Appels par jour (UTC)"], ["maxTokensPerDay", "Tokens observés par jour (UTC)"], ["maxCallsPerRun", "Appels par exécution ou dossier"] ] as const).map(([key, label]) => <label key={key} htmlFor={`${id}-${key}`}>
          {label}<input id={`${id}-${key}`} type="number" min="1" step="1" value={limits[key]} placeholder="Sans plafond" onChange={event => { setEditing(true); setSaved(false); setLimits(current => ({ ...current, [key]: event.target.value })); }} />
        </label>)}
        <p>Un plafond de tokens bloque les prochains appels après réception de la consommation. Les appels en cours peuvent le dépasser. Si une mesure manque, ce plafond bloque les appels suivants. Ces chiffres ne représentent pas votre quota d’abonnement.</p>
        <button type="submit" disabled={!status || saving}>{saving ? "Enregistrement…" : "Enregistrer les limites"}</button>
      </form>
    </details>
    {saved && <p role="status">Réglages enregistrés.</p>}
    {error && <p role="alert">{error}</p>}
  </section>;
}
