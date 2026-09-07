import { CircleStop, GitBranch, GitFork } from "lucide-react";
import { useTranslation } from "../../../i18n.tsx";
import type { WorkflowRoutingPresentation } from "./workflowPresentation.ts";

export function WorkflowConnectionLegend({ hasFeedback, hasAsynchronous = false }: { hasFeedback: boolean; hasAsynchronous?: boolean }) {
  const { t, language } = useTranslation();
  return <ul className="workflow-connection-legend" aria-label={t("workflow.legend.title")}>
    {(["pending", "selected", "running", "inactive", ...(hasFeedback ? ["feedback" as const] : [])] as const).map((status) =>
      <li key={status}><svg width="32" height="14" viewBox="0 0 32 14" aria-hidden="true"
        className={`agent-project__connection--${status}`}><path d="M 2 7 H 28 M 23 3 L 28 7 L 23 11" /></svg>
        {t(`workflow.legend.${status}`)}</li>)}
    {hasAsynchronous && <li><svg width="32" height="14" viewBox="0 0 32 14" aria-hidden="true" className="agent-project__connection--asynchronous"><path d="M 2 7 H 28 M 23 3 L 28 7 L 23 11" /></svg>{language === "fr" ? "Dossier asynchrone" : "Asynchronous dossier"}</li>}
  </ul>;
}

export function WorkflowRoutingSummary({ presentation }: { presentation: WorkflowRoutingPresentation }) {
  const { t } = useTranslation();
  const { kind, selectedCount, totalCount } = presentation;
  if (kind === "single") return null;
  const Icon = kind === "parallel" ? GitFork : kind === "none" || kind === "end" ? CircleStop : GitBranch;
  const key = { conditional: "workflow.routing.conditional", "selected-one": "workflow.routing.selectedOne",
    parallel: "workflow.routing.parallel", "per-instance": "workflow.routing.perInstance", none: "workflow.routing.none",
    end: "workspace.branchEnd", legacy: "workflow.routing.legacy" } as const;
  return <div className={`workflow-routing-summary workflow-routing-summary--${kind}`} data-workflow-routing={kind}
    title={kind === "none" || kind === "end" || kind === "legacy" ? undefined :
      t(kind === "parallel" ? "workflow.routing.parallelHelp" : kind === "per-instance" ? "workflow.routing.perInstanceHelp" : "workflow.routing.conditionalHelp")}>
    <Icon aria-hidden="true" size={17} />
    <span>{t(key[kind], { count: selectedCount, total: totalCount })}</span>
  </div>;
}
