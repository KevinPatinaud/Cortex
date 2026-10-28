import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
import { useTranslation } from "../../i18n.tsx";
import { getWorkForceStatus } from "../../services/workForceApi.ts";

/** Poll only lifecycle metadata; showing the mode never probes Codex quotas. */
export function WorkForceModeButton({ onClick }: { onClick(): void }) {
  const { language } = useTranslation();
  const [active, setActive] = useState(false);
  useEffect(() => {
    let live = true, pending = false;
    const refresh = async () => {
      if (pending) return;
      pending = true;
      try { const status = await getWorkForceStatus(); if (live) setActive(status.active); }
      catch { /* Keep the last confirmed state during a transient connection failure. */ }
      finally { pending = false; }
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 2000);
    window.addEventListener("focus", refresh);
    return () => { live = false; clearInterval(timer); window.removeEventListener("focus", refresh); };
  }, []);
  const description = language === "fr"
    ? "Work Force actif : les agents du mode normal sont suspendus."
    : "Work Force is active: normal-mode agents are suspended.";
  return <button className={`prompt-mode-link${active ? " prompt-mode-link--work-force-active" : ""}`}
    type="button" onClick={onClick} aria-label="Work Force" aria-pressed={active}
    title={active ? description : "Work Force"}>
    <span>Work Force{active && <small className="work-force-mode-active-label" aria-hidden="true">{language === "fr" ? "Actif" : "Active"}</small>}</span>
    <Plus size={16} aria-hidden="true" />
  </button>;
}
