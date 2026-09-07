import { CircleStop, GitBranch, GitFork } from "lucide-react";
import { useTranslation } from "../../../i18n.tsx";
import type { WorkflowRoutingPresentation } from "./workflowPresentation.ts";

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
