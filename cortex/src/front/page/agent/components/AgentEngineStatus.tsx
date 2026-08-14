import { Bot, ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "../../../i18n.tsx";
import {
  getAgentConfiguration,
  getAgentStatus,
  saveAgentConfiguration,
  type AgentConfiguration,
  type AgentStatus
} from "../../../services/agentApi.ts";

const EMPTY_STATUS: AgentStatus = {
  engine: null,
  label: null,
  error: null
};

const DEFAULT_CONFIGURATION: AgentConfiguration = {
  autopilot: true,
  allowAll: true
};

export function AgentEngineStatus() {
  const { language, setLanguage, t } = useTranslation();
  const [status, setStatus] = useState<AgentStatus>(EMPTY_STATUS);
  const [configuration, setConfiguration] = useState(DEFAULT_CONFIGURATION);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [configurationError, setConfigurationError] = useState("");

  useEffect(() => {
    let isMounted = true;

    async function loadStatus(): Promise<void> {
      try {
        const [agentStatus, agentConfiguration] = await Promise.all([
          getAgentStatus(),
          getAgentConfiguration()
        ]);

        if (isMounted) {
          setStatus(agentStatus);
          setConfiguration(agentConfiguration);
        }
      } catch (error) {
        if (isMounted) {
          setStatus({
            engine: null,
            label: null,
            error: error instanceof Error
              ? error.message
              : t("engine.detectError")
          });
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    }

    void loadStatus();

    return () => {
      isMounted = false;
    };
  }, []);

  const hasError = !isLoading && Boolean(status.error);

  async function updateConfiguration(
    change: Partial<AgentConfiguration>
  ): Promise<void> {
    const nextConfiguration = { ...configuration, ...change };

    setIsSaving(true);
    setConfigurationError("");

    try {
      setConfiguration(await saveAgentConfiguration(nextConfiguration));
    } catch (error) {
      setConfigurationError(error instanceof Error
        ? error.message
        : t("engine.saveError")
      );
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="agent-engine-panel">
      <details
        className={`agent-engine-settings${hasError ? " agent-engine-status--error" : ""}`}
      >
        <summary aria-live="polite">
          <Bot aria-hidden="true" size={18} strokeWidth={1.8} />
          <span className="agent-engine-status__content">
            <strong>
              {isLoading ? t("engine.detecting") : status.label || t("engine.notConfigured")}
            </strong>
            <small>{t("engine.settings")}</small>
            {hasError && (
              <span className="agent-engine-status__error">{status.error}</span>
            )}
          </span>
          {isSaving && (
            <small className="agent-engine-settings__saving">
              {t("engine.saving")}
            </small>
          )}
          <span className="agent-engine-status__indicator" aria-hidden="true" />
          <ChevronDown
            className="agent-engine-settings__chevron"
            aria-hidden="true"
            size={15}
            strokeWidth={1.8}
          />
        </summary>
        <div className="agent-engine-settings__content">
          <label className="agent-engine-settings__language">
            <span>
              <strong>{t("language.label")}</strong>
              <small>{t("language.help")}</small>
            </span>
            <select
              value={language}
              onChange={(event) => setLanguage(event.target.value as "fr" | "en")}
              aria-label={t("language.label")}
            >
              <option value="fr">{t("language.fr")}</option>
              <option value="en">{t("language.en")}</option>
            </select>
          </label>
          <label>
            <span>
              <strong>Autopilot</strong>
              <small>{t("engine.autopilotHelp")}</small>
            </span>
            <input
              type="checkbox"
              checked={configuration.autopilot}
              disabled={isLoading || isSaving}
              onChange={(event) => void updateConfiguration({
                autopilot: event.target.checked
              })}
            />
          </label>
          <label>
            <span>
              <strong>Allow all</strong>
              <small>{t("engine.allowAllHelp")}</small>
            </span>
            <input
              type="checkbox"
              checked={configuration.allowAll}
              disabled={isLoading || isSaving}
              onChange={(event) => void updateConfiguration({
                allowAll: event.target.checked
              })}
            />
          </label>
          {configurationError && (
            <p className="agent-engine-settings__error" role="alert">
              {configurationError}
            </p>
          )}
        </div>
      </details>
    </div>
  );
}
