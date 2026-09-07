import { LoaderCircle, Sparkles } from "lucide-react";
import { useTranslation } from "../../../i18n.tsx";
import type {
  ProjectReviewAgent, ProjectReviewDraft, ProjectReviewProposal
} from "../../../../shared/ProjectReviewProposal.ts";

export type ReviewProposalStatus = "pending" | "applied" | "declined" | "superseded";

interface ProposalPreviewProps {
  proposal: ProjectReviewProposal;
  original: ProjectReviewDraft;
  status: ReviewProposalStatus;
  stale: boolean;
  busy: boolean;
  applying: boolean;
  onApply: () => void;
  onDecline: () => void;
}

const agentFieldLabels = {
  name: "editor.name",
  description: "editor.shortDescription",
  prompt: "editor.mission",
  model: "editor.defaultModel",
  reasoningEffort: "editor.reasoningEffort"
} as const;
type AgentField = keyof typeof agentFieldLabels;

export function ProjectReviewProposalPreview({
  proposal, original, status, stale, busy, applying, onApply, onDecline
}: ProposalPreviewProps) {
  const { t } = useTranslation();

  function fieldPreview(label: string, before: string, after: string) {
    return (
      <div className="project-review__field-change" key={label}>
        <h4>{label}</h4>
        <div className="project-review__comparison">
          <div>
            <strong>{t("editor.reviewBefore")}</strong>
            <pre tabIndex={0} aria-label={`${label} — ${t("editor.reviewBefore")}`}>{before || t("editor.reviewEmptyValue")}</pre>
          </div>
          <div>
            <strong>{t("editor.reviewAfter")}</strong>
            <pre tabIndex={0} aria-label={`${label} — ${t("editor.reviewAfter")}`}>{after || t("editor.reviewEmptyValue")}</pre>
          </div>
        </div>
      </div>
    );
  }

  function agentPreview(before: Partial<ProjectReviewAgent>, after: Partial<ProjectReviewAgent>, fields: AgentField[]) {
    return fields.map((field) => fieldPreview(t(agentFieldLabels[field]), before[field] ?? "", after[field] ?? ""));
  }

  return (
    <section className="project-review__proposal">
      <div className="project-review__proposal-heading">
        <Sparkles aria-hidden="true" size={19} />
        <h3>{proposal.title}</h3>
      </div>
      <p>{proposal.description}</p>
      <ul className="project-review__changes">
        {proposal.changes.map((change, index) => {
          const agent = "agentKey" in change ? original.agents.find(({ key }) => key === change.agentKey) : undefined;
          let label: string;
          let preview;
          switch (change.type) {
            case "update_instructions":
              label = t("editor.reviewUpdateInstructions");
              preview = fieldPreview(t("workspace.instructionsTab"), original.instructions, change.instructions);
              break;
            case "update_agent":
              label = t("editor.reviewUpdateAgent", { name: agent?.name || t("editor.unnamedAgent") });
              preview = agentPreview(agent ?? {}, change.updates, Object.keys(change.updates) as AgentField[]);
              break;
            case "add_agent":
              label = t("editor.reviewAddAgent", { name: change.agent.name });
              preview = agentPreview({}, change.agent, Object.keys(agentFieldLabels) as AgentField[]);
              break;
            case "remove_agent":
              label = t("editor.reviewRemoveAgent", { name: agent?.name || t("editor.unnamedAgent") });
              preview = agentPreview(agent ?? {}, {}, Object.keys(agentFieldLabels) as AgentField[]);
              break;
            default:
              return null;
          }
          return (
            <li key={index}>
              <strong>{label}</strong>
              <details className="project-review__change-preview">
                <summary tabIndex={0}>{t("editor.reviewPreviewChanges")}</summary>
                {preview}
              </details>
            </li>
          );
        })}
      </ul>
      <p className="project-review__notice" role="status">
        {t(status === "applied" ? "editor.reviewProposalApplied"
          : status === "declined" ? "editor.reviewProposalDeclined"
            : status === "superseded" ? "editor.reviewProposalSuperseded"
              : stale ? "editor.reviewProposalStale" : "editor.reviewProposalHelp")}
      </p>
      {status === "pending" && (
        <div className="project-review__proposal-actions">
          <button type="button" className="project-review__decline" disabled={busy} onClick={onDecline}>
            {t("editor.reviewDecline")}
          </button>
          <button type="button" className="project-review__apply" disabled={busy || stale} onClick={onApply}>
            {applying && <LoaderCircle aria-hidden="true" className="spin" size={16} />}
            {t(applying ? "editor.reviewApplying" : "editor.reviewApply")}
          </button>
        </div>
      )}
    </section>
  );
}
