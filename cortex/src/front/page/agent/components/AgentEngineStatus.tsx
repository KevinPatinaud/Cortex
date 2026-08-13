import { Bot, ChevronDown } from "lucide-react";
import { useEffect, useState } from "react";
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
              : "Impossible de détecter le moteur IA."
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
        : "Impossible d'enregistrer la configuration des agents."
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
              {isLoading ? "Détection..." : status.label || "Non configuré"}
            </strong>
            <small>Paramètres</small>
            {hasError && (
              <span className="agent-engine-status__error">{status.error}</span>
            )}
          </span>
          {isSaving && (
            <small className="agent-engine-settings__saving">
              Enregistrement...
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
          <label>
            <span>
              <strong>Autopilot</strong>
              <small>Exécuter les tâches automatiquement</small>
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
              <small>Sans sandbox ni confirmation en autopilot</small>
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
