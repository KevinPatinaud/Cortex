import type { WorkflowAuditAgentExecution } from "../../../../shared/WorkflowAudit.ts";
import { useTranslation } from "../../../i18n.tsx";

export function ExecutionTokenUsage({ execution }: { execution: WorkflowAuditAgentExecution }) {
  const { t, language } = useTranslation();
  const usage = execution.usage;
  const format = (value: number) => new Intl.NumberFormat(language).format(value);
  const previousMission = Boolean(execution.processing && !usage?.mission && execution.processing.mission.completedAt < execution.startedAt);
  const partial = Boolean(usage && (execution.status !== "succeeded" || (!usage.mission && !previousMission) ||
    (execution.processing?.interpretation.status === "succeeded" && !usage.interpretation)));

  return <section className="workflow-audit__tokens" aria-label={t("audit.tokens.title")}>
    <header><h4>{t("audit.tokens.title")}</h4>
      {usage && <strong className="workflow-audit__tokens-total">{format(usage.total.totalTokens)} {t("audit.tokens.unit")}</strong>}
    </header>
    {!usage ? <p>{t("audit.tokens.unavailable")}</p> : <>
      {partial && <p className="workflow-audit__tokens-partial">{t("audit.tokens.partial")}</p>}
      <dl className="workflow-audit__tokens-counts">
        <div><dt>{t("audit.tokens.input")}</dt><dd>{format(usage.total.inputTokens)}</dd></div>
        <div><dt>{t("audit.tokens.output")}</dt><dd>{format(usage.total.outputTokens)}</dd></div>
        {usage.total.cachedInputTokens !== undefined && <div><dt>{t("audit.tokens.cached")}</dt><dd>{format(usage.total.cachedInputTokens)}</dd></div>}
        {usage.total.cacheWriteInputTokens !== undefined && <div><dt>{t("audit.tokens.cacheWrite")}</dt><dd>{format(usage.total.cacheWriteInputTokens)}</dd></div>}
        {usage.total.reasoningOutputTokens !== undefined && <div><dt>{t("audit.tokens.reasoning")}</dt><dd>{format(usage.total.reasoningOutputTokens)}</dd></div>}
      </dl>
      <dl className="workflow-audit__tokens-phases">{(["mission", "interpretation"] as const).map(phase => usage[phase] && <div key={phase}>
        <dt>{t(`audit.tokens.${phase}`)}</dt><dd><strong>{format(usage[phase]!.totalTokens)} {t("audit.tokens.unit")}</strong>
          <span>{t("audit.tokens.breakdown", { input: format(usage[phase]!.inputTokens), output: format(usage[phase]!.outputTokens) })}</span></dd>
      </div>)}</dl>
      {previousMission && <p>{t("audit.tokens.previousMission")}</p>}
      <p className="workflow-audit__tokens-note">{t(execution.engine === "copilot" ? "audit.tokens.nativeNote" : "audit.tokens.note")}</p>
    </>}
  </section>;
}
