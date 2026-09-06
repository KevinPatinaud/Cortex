import { lazy, Suspense, useEffect, useState } from "react";
import { Bot, SlidersHorizontal } from "lucide-react";
import { getAgentStatus, type AgentStatus } from "../../../services/agentApi.ts";
import { useTranslation } from "../../../i18n.tsx";

const AgentEngineSettings = lazy(() => import("./AgentEngineSettings.tsx")
  .then((module) => ({ default: module.AgentEngineSettings })));

export function AgentEngineStatus({ projectId }: { projectId?: string }) {
  const { t } = useTranslation();
  const [status, setStatus] = useState<AgentStatus | null>(null);
  const [hasOpenedSettings, setHasOpenedSettings] = useState(false);

  useEffect(() => {
    let active = true;
    void getAgentStatus().then((value) => { if (active) setStatus(value); })
      .catch((error: unknown) => {
        if (active) setStatus({ engine: null, label: null, error: error instanceof Error ? error.message : t("engine.detectError") });
      });
    return () => { active = false; };
  }, [projectId]);

  const trigger = <div className="agent-engine-panel">
    <button className={`agent-engine-settings-trigger${status?.error ? " agent-engine-status--error" : ""}`}
      type="button" aria-haspopup="dialog" aria-expanded={false}
      aria-busy={hasOpenedSettings} onClick={() => setHasOpenedSettings(true)}>
      <Bot aria-hidden="true" size={18} strokeWidth={1.8} />
      <span className="agent-engine-status__content" aria-live="polite">
        <strong>{status === null ? t("engine.detecting") : status.label || t("engine.notConfigured")}</strong>
        <small>{hasOpenedSettings ? t("common.loading") : t("engine.settings")}</small>
        {status?.error && <span className="agent-engine-status__error">{status.error}</span>}
      </span>
      <span className="agent-engine-status__indicator" aria-hidden="true" />
      <SlidersHorizontal aria-hidden="true" size={15} strokeWidth={1.8} />
    </button>
  </div>;

  return hasOpenedSettings
    ? <Suspense fallback={trigger}><AgentEngineSettings projectId={projectId} /></Suspense>
    : trigger;
}
