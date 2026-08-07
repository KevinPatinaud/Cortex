import { Bot } from "lucide-react";
import { useEffect, useState } from "react";
import { getAgentStatus, type AgentStatus } from "../../../services/agentApi.ts";

const EMPTY_STATUS: AgentStatus = {
  engine: null,
  label: null,
  error: null
};

export function AgentEngineStatus() {
  const [status, setStatus] = useState<AgentStatus>(EMPTY_STATUS);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    async function loadStatus(): Promise<void> {
      try {
        const agentStatus = await getAgentStatus();

        if (isMounted) {
          setStatus(agentStatus);
        }
      } catch (error) {
        if (isMounted) {
          setStatus({
            engine: null,
            label: null,
            error: error instanceof Error
              ? error.message
              : "Impossible de detecter le moteur IA."
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

  return (
    <section
      className={`agent-engine-status${hasError ? " agent-engine-status--error" : ""}`}
      aria-live="polite"
    >
      <Bot aria-hidden="true" size={18} strokeWidth={1.8} />
      <span className="agent-engine-status__content">
        <small>Moteur IA</small>
        <strong>
          {isLoading ? "Detection..." : status.label || "Non configure"}
        </strong>
        {hasError && <span className="agent-engine-status__error">{status.error}</span>}
      </span>
      <span className="agent-engine-status__indicator" aria-hidden="true" />
    </section>
  );
}
