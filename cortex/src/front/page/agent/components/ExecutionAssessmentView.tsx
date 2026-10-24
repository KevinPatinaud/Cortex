import type { ExecutionAssessment } from "../../../../shared/ExecutionQuality.ts";
import { useTranslation } from "../../../i18n.tsx";

export function ExecutionAssessmentView({ assessment }: { assessment?: ExecutionAssessment }) {
  const { t } = useTranslation();
  if (!assessment) return null;
  return <aside className={`execution-assessment execution-assessment--${assessment.outcome}`} aria-label={t("quality.assessment")}>
    <strong>{t(`quality.outcome.${assessment.outcome}`)}</strong>
    {assessment.reasons.length > 0 && <ul>{assessment.reasons.map((reason, index) => <li key={index}>{reason}</li>)}</ul>}
    {assessment.checks.length > 0 && <ul>{assessment.checks.map((check, index) => <li key={index}>
      {check.passed ? "✓" : "✗"} {check.label} — {check.detail}
    </li>)}</ul>}
  </aside>;
}
