import { useEffect, useId, useRef, useState } from "react";
import {
  ArrowUpRight, CircleAlert, Lightbulb, LoaderCircle, MessageSquare,
  ScanSearch, Send, ShieldCheck, TriangleAlert, X
} from "lucide-react";
import { useTranslation } from "../../../i18n.tsx";
import {
  reviewProject,
  type ProjectReview,
  type ProjectReviewFinding,
  type ProjectReviewMessage
} from "../../../services/agentApi.ts";
import { trapDialogFocus } from "../../shared/dialogFocus.ts";
import type { DraftAgent } from "./projectDraft.ts";

interface ProjectReviewDialogProps {
  projectId: string;
  projectName: string;
  instructions: string;
  agents: DraftAgent[];
  isOpen: boolean;
  onClose: () => void;
  onBusyChange: (busy: boolean) => void;
  onOpenFinding: (finding: ProjectReviewFinding) => void;
}

type ReviewTurn =
  | { role: "user"; content: string }
  | { role: "assistant"; review: ProjectReview };

export function ProjectReviewDialog({
  projectId, projectName, instructions, agents, isOpen,
  onClose, onBusyChange, onOpenFinding
}: ProjectReviewDialogProps) {
  const { t } = useTranslation();
  const titleId = useId();
  const helpId = useId();
  const messageId = useId();
  const messageHelpId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const conversationRef = useRef<HTMLDivElement>(null);
  const pendingRef = useRef(false);
  const [turns, setTurns] = useState<ReviewTurn[]>([]);
  const [message, setMessage] = useState("");
  const [isPending, setIsPending] = useState(false);
  const [pendingMessage, setPendingMessage] = useState("");
  const [error, setError] = useState("");
  const [reviewedDraft, setReviewedDraft] = useState<string | null>(null);
  const draft = {
    projectName: projectName.trim(),
    instructions,
    agents: agents.map((agent) => ({
      key: agent.clientId,
      name: agent.name,
      description: agent.description,
      prompt: agent.prompt,
      model: agent.model ?? "",
      reasoningEffort: agent.reasoningEffort ?? ""
    }))
  };
  const draftSnapshot = JSON.stringify(draft);
  const conversation: ProjectReviewMessage[] = turns.map((turn) => ({
    role: turn.role,
    content: turn.role === "user" ? turn.content : JSON.stringify(turn.review)
  }));
  const historyLimitReached = conversation.length > 40 ||
    conversation.some((turn) => turn.content.length > 20_000) ||
    conversation.reduce((length, turn) => length + turn.content.length, 0) > 120_000;
  const draftChanged = reviewedDraft !== null && reviewedDraft !== draftSnapshot;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!isOpen) {
      dialog?.close();
      return;
    }
    if (!dialog?.open) dialog?.showModal();
    const focusFrame = window.requestAnimationFrame(() => messageRef.current?.focus());
    return () => {
      window.cancelAnimationFrame(focusFrame);
      dialog?.close();
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const area = conversationRef.current;
    // Start at the latest exchange so the response can be read from its beginning.
    const latest = area?.querySelector<HTMLElement>(".project-review__turn:last-of-type");
    if (area) area.scrollTop = latest ? latest.offsetTop - area.offsetTop : 0;
  }, [isOpen, turns, isPending]);

  async function submitReview(includeMessage: boolean): Promise<void> {
    const requestMessage = includeMessage ? message.trim() : "";
    if (pendingRef.current || historyLimitReached || !draft.projectName ||
      (includeMessage && !requestMessage)) return;

    pendingRef.current = true;
    setIsPending(true);
    onBusyChange(true);
    setPendingMessage(requestMessage);
    setError("");
    try {
      const review = await reviewProject(projectId, {
        ...draft,
        ...(requestMessage ? { message: requestMessage } : {}),
        conversation
      });
      setTurns((current) => [
        ...current,
        ...(requestMessage ? [{ role: "user" as const, content: requestMessage }] : []),
        { role: "assistant", review }
      ]);
      setReviewedDraft(draftSnapshot);
      if (includeMessage) setMessage("");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : t("editor.reviewError"));
    } finally {
      pendingRef.current = false;
      setIsPending(false);
      setPendingMessage("");
      onBusyChange(false);
      if (dialogRef.current?.open) messageRef.current?.focus();
    }
  }

  function renderFindings(review: ProjectReview, isLatest: boolean) {
    if (!review.findings.length) return null;
    return (
      <details className="project-review__details" open={isLatest}>
        <summary tabIndex={0}>
          {t("editor.reviewFindings")} ({review.findings.length})
        </summary>
        <ol className="project-review__findings">
          {review.findings.map((finding, index) => {
            const targetAgent = agents.find((agent) => agent.clientId === finding.agentKey);
            const targetLabel = finding.scope === "agent"
              ? targetAgent?.name || t("editor.unnamedAgent")
              : finding.scope === "instructions"
                ? t("workspace.instructionsTab") : t("editor.reviewWholeProject");
            const canOpen = finding.scope === "instructions" ||
              (finding.scope === "agent" && Boolean(targetAgent));
            return (
              <li
                className={`project-review__finding project-review__finding--${finding.severity}`}
                key={index}
              >
                <span className="project-review__finding-icon" aria-hidden="true">
                  {finding.severity === "critical" && <CircleAlert size={18} />}
                  {finding.severity === "warning" && <TriangleAlert size={18} />}
                  {finding.severity === "suggestion" && <Lightbulb size={18} />}
                </span>
                <div>
                  <div className="project-review__finding-meta">
                    <span>{t(`editor.reviewSeverity.${finding.severity}`)}</span>
                    <em>{targetLabel}</em>
                  </div>
                  <h4>{finding.title}</h4>
                  <p>{finding.description}</p>
                  <aside>
                    <strong>{t("editor.reviewRecommendation")}</strong>
                    {finding.recommendation}
                  </aside>
                </div>
                {canOpen && (
                  <button type="button" disabled={isPending} onClick={() => onOpenFinding(finding)}>
                    {t("editor.reviewOpenTarget")}
                    <ArrowUpRight aria-hidden="true" size={14} />
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      </details>
    );
  }

  return (
    <dialog
      ref={dialogRef}
      className="project-review project-review--conversation"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={helpId}
      onKeyDown={trapDialogFocus}
      onCancel={(event) => { event.preventDefault(); onClose(); }}
    >
      <header>
        <span className="agent-improvement__icon" aria-hidden="true"><MessageSquare size={21} /></span>
        <div>
          <span>{t("editor.projectReviewEyebrow")}</span>
          <h2 id={titleId}>{t("editor.projectReviewTitle")}</h2>
          <p id={helpId}>{t("editor.projectReviewHelp")}</p>
        </div>
        <button className="agent-improvement__close" type="button" aria-label={t("common.close")} onClick={onClose}>
          <X aria-hidden="true" size={18} />
        </button>
      </header>

      <div className="project-review__conversation" ref={conversationRef} role="log" aria-label={t("editor.reviewConversation")} aria-live="polite" aria-relevant="additions text">
        {turns.length === 0 && !isPending && (
          <div className="project-review__welcome">
            <MessageSquare aria-hidden="true" size={28} />
            <h3>{t("editor.reviewWelcomeTitle")}</h3>
            <p>{t("editor.reviewWelcomeHelp")}</p>
          </div>
        )}
        {turns.map((turn, index) => (
          <article className={`project-review__turn project-review__turn--${turn.role}`} key={index}>
            <div className="project-review__turn-heading">
              <strong>{t(turn.role === "user" ? "editor.reviewUser" : "editor.reviewAssistant")}</strong>
              {turn.role === "assistant" && (
                <span className={`project-review__assessment project-review__assessment--${turn.review.assessment}`}>
                  {turn.review.assessment === "healthy" && <ShieldCheck aria-hidden="true" size={15} />}
                  {turn.review.assessment === "needs_attention" && <TriangleAlert aria-hidden="true" size={15} />}
                  {turn.review.assessment === "critical" && <CircleAlert aria-hidden="true" size={15} />}
                  {t(`editor.reviewAssessment.${turn.review.assessment}`)}
                </span>
              )}
            </div>
            <p className="project-review__message">{turn.role === "user" ? turn.content : turn.review.summary}</p>
            {turn.role === "assistant" && renderFindings(turn.review, index === turns.length - 1)}
          </article>
        ))}
        {isPending && pendingMessage && (
          <article className="project-review__turn project-review__turn--user">
            <div className="project-review__turn-heading"><strong>{t("editor.reviewUser")}</strong></div>
            <p className="project-review__message">{pendingMessage}</p>
          </article>
        )}
        {isPending && (
          <p className="project-review__pending" role="status">
            <LoaderCircle aria-hidden="true" className="spin" size={17} />
            {t("editor.reviewSending")}
          </p>
        )}
      </div>

      <form className="project-review__composer" onSubmit={(event) => { event.preventDefault(); void submitReview(true); }}>
        {draftChanged && <p className="project-review__notice" role="status">{t("editor.reviewDraftChanged")}</p>}
        {error && <p className="project-review__error" role="alert">{error}</p>}
        {historyLimitReached && (
          <p className="project-review__notice" role="status">{t("editor.reviewConversationLimit")}</p>
        )}
        <label htmlFor={messageId}>{t("editor.reviewMessage")}</label>
        <textarea
          ref={messageRef}
          id={messageId}
          value={message}
          rows={3}
          maxLength={12_000}
          readOnly={isPending}
          aria-describedby={messageHelpId}
          placeholder={t("editor.reviewMessagePlaceholder")}
          onChange={(event) => { setMessage(event.target.value); setError(""); }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && (event.ctrlKey || event.metaKey) && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void submitReview(true);
            }
          }}
        />
        <div className="project-review__composer-actions">
          <span id={messageHelpId}>{t("editor.reviewMessageHelp")}</span>
          {historyLimitReached && (
            <button type="button" className="project-review__analyze" disabled={isPending} onClick={() => {
              setTurns([]); setReviewedDraft(null); setError(""); messageRef.current?.focus();
            }}>{t("editor.reviewNewConversation")}</button>
          )}
          {turns.length === 0 && (
            <button type="button" className="project-review__analyze" disabled={isPending || !projectName.trim()} onClick={() => void submitReview(false)}>
              <ScanSearch aria-hidden="true" size={16} />{t("editor.reviewAnalyze")}
            </button>
          )}
          <button type="submit" className="project-review__send" disabled={isPending || historyLimitReached || !message.trim() || !projectName.trim()}>
            {isPending ? <LoaderCircle aria-hidden="true" className="spin" size={16} /> : <Send aria-hidden="true" size={16} />}
            {t("editor.reviewSend")}
          </button>
        </div>
      </form>
    </dialog>
  );
}
