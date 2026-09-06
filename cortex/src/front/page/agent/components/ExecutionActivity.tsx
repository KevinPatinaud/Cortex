import { useEffect, useState } from "react";
import { Clock3, LoaderCircle } from "lucide-react";
import { useTranslation } from "../../../i18n.tsx";
import { formatElapsedTime } from "./executionTime.ts";

export function ExecutionActivity({
  startedAt,
  lastActivityAt,
  progress
}: {
  startedAt?: string;
  lastActivityAt?: string;
  progress?: string;
}) {
  const { t } = useTranslation();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  return <section className="agent-card__activity" aria-label={t("execution.status.running")}>
    <div className="agent-card__activity-times">
      <span><Clock3 aria-hidden="true" size={14} />
        {t("execution.elapsed", { duration: formatElapsedTime(startedAt, now) })}
      </span>
      {lastActivityAt && <span>{t("execution.lastActivity", {
        duration: formatElapsedTime(lastActivityAt, now)
      })}</span>}
    </div>
    <p aria-live="polite" aria-atomic="true">
      <LoaderCircle className="spin" aria-hidden="true" size={14} />
      <span>{progress || t("execution.waiting")}</span>
    </p>
  </section>;
}
