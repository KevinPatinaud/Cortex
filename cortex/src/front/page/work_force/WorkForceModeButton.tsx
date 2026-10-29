import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { useTranslation } from "../../i18n.tsx";
import { getWorkLightStatus } from "../../services/workLightApi.ts";
import { getWorkForceStatus } from "../../services/workForceApi.ts";

/** Poll only lifecycle metadata; showing the mode never probes Codex quotas. */
export function WorkForceModeButton({ onClick, light = false }: { onClick(): void; light?: boolean }) {
  const { language } = useTranslation();
  const [active, setActive] = useState(false);
  useEffect(() => {
    let live = true, pending = false;
    const refresh = async () => {
      if (pending) return;
      pending = true;
      try { const status = await (light ? getWorkLightStatus() : getWorkForceStatus()); if (live) setActive(status.active); }
      catch { /* Keep the last confirmed state during a transient connection failure. */ }
      finally { pending = false; }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 2000);
    window.addEventListener("focus", refresh);
    return () => { live = false; clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, [light]);
  const name = light ? "Work Light" : "Work Force";
  const description = language === "fr"
    ? `${name} actif : les autres modes restent disponibles selon les règles de simultanéité et leurs quotas.`
    : `${name} is active: other modes remain available under the concurrency setting and their own quotas.`;
  return <button className={`prompt-mode-link${active ? " prompt-mode-link--work-force-active" : ""}`}
    type="button" onClick={onClick} aria-label={name} aria-pressed={active}
    title={active ? description : name}>
    <span>{name}{active && <small className="work-force-mode-active-label" aria-hidden="true">{language === "fr" ? "Actif" : "Active"}</small>}</span>
    <Plus size={16} aria-hidden="true" />
  </button>;
}
