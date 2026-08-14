import { useEffect, useId, useRef, useState } from "react";
import { CalendarClock, LoaderCircle, X } from "lucide-react";
import {
  saveWorkflowSchedule,
  type WorkflowSchedule
} from "../../../services/agentApi.ts";
import { useTranslation } from "../../../i18n.tsx";
import { describeCronExpression } from "./CronExpressionDescription.ts";

interface WorkflowScheduleDialogProps {
  projectId: string;
  projectName: string;
  schedule: WorkflowSchedule;
  onCancel: () => void;
  onSaved: (schedule: WorkflowSchedule) => void;
}

export function WorkflowScheduleDialog({
  projectId,
  projectName,
  schedule,
  onCancel,
  onSaved
}: WorkflowScheduleDialogProps) {
  const { language, t } = useTranslation();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cronInputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const [cron, setCron] = useState(schedule.cron);
  const [enabled, setEnabled] = useState(schedule.enabled);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const dialog = dialogRef.current;

    if (!dialog?.open) {
      dialog?.showModal();
    }

    const focusFrame = window.requestAnimationFrame(() => {
      cronInputRef.current?.focus();
    });

    return () => {
      window.cancelAnimationFrame(focusFrame);
      if (dialog?.open) dialog.close();
    };
  }, []);

  async function handleSubmit(): Promise<void> {
    setIsSaving(true);
    setError("");

    try {
      onSaved(await saveWorkflowSchedule(projectId, { cron, enabled }));
    } catch (requestError) {
      setError(requestError instanceof Error
        ? requestError.message
        : t("common.unexpectedError"));
    } finally {
      setIsSaving(false);
    }
  }

  const dateFormatter = new Intl.DateTimeFormat(language, {
    dateStyle: "medium",
    timeStyle: "short"
  });
  const cronDescription = describeCronExpression(cron, language);

  return (
    <dialog
      className="schedule-dialog"
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      aria-busy={isSaving}
      onCancel={(event) => {
        event.preventDefault();
        if (!isSaving) onCancel();
      }}
    >
      <form
        className="schedule-dialog__form"
        onSubmit={(event) => {
          event.preventDefault();
          void handleSubmit();
        }}
      >
        <header className="schedule-dialog__header">
          <span className="schedule-dialog__icon" aria-hidden="true">
            <CalendarClock size={22} strokeWidth={1.8} />
          </span>
          <div>
            <span className="schedule-dialog__eyebrow">
              {t("schedule.eyebrow")}
            </span>
            <h2 id={titleId}>{t("schedule.title")}</h2>
          </div>
          <button
            className="schedule-dialog__close"
            type="button"
            aria-label={t("common.close")}
            onClick={onCancel}
            disabled={isSaving}
          >
            <X aria-hidden="true" size={18} />
          </button>
        </header>

        <div className="schedule-dialog__body">
          <p id={descriptionId}>{t("schedule.description")}</p>
          <div className="schedule-dialog__project">
            <span>{t("dialog.affectedProject")}</span>
            <strong>{projectName}</strong>
          </div>

          <label className="schedule-dialog__toggle">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
            />
            <span>
              <strong>{t("schedule.enabled")}</strong>
              <small>{t("schedule.enabledHelp")}</small>
            </span>
          </label>

          <label className="schedule-dialog__field">
            <span>{t("schedule.expression")}</span>
            <input
              ref={cronInputRef}
              type="text"
              value={cron}
              onChange={(event) => setCron(event.target.value)}
              placeholder="0 9 * * 1-5"
              spellCheck={false}
              autoComplete="off"
              required
            />
            <small>{t("schedule.expressionHelp")}</small>
          </label>
          <output
            className={`schedule-dialog__cron-description${
              cronDescription
                ? ""
                : " schedule-dialog__cron-description--unavailable"
            }`}
            aria-live="polite"
          >
            <span>{t("schedule.explanation")}</span>
            <strong>
              {cronDescription ?? t("schedule.explanationUnavailable")}
            </strong>
          </output>

          <div className="schedule-dialog__examples">
            <span>{t("schedule.examples")}</span>
            <button type="button" onClick={() => setCron("0 9 * * 1-5")}>
              <code>0 9 * * 1-5</code> · {t("schedule.weekdays")}
            </button>
            <button type="button" onClick={() => setCron("0 */6 * * *")}>
              <code>0 */6 * * *</code> · {t("schedule.everySixHours")}
            </button>
          </div>

          <p className="schedule-dialog__timezone">
            {t("schedule.timezone", { timezone: schedule.timezone })}
          </p>
          {schedule.nextRunAt && schedule.enabled && (
            <p className="schedule-dialog__next-run">
              {t("schedule.nextRun", {
                date: dateFormatter.format(new Date(schedule.nextRunAt))
              })}
            </p>
          )}
          {schedule.lastRunAt && schedule.lastRunStatus && (
            <p className={`schedule-dialog__last-run schedule-dialog__last-run--${schedule.lastRunStatus}`}>
              {t(
                schedule.lastRunStatus === "succeeded"
                  ? "schedule.lastRunSucceeded"
                  : schedule.lastRunStatus === "failed"
                    ? "schedule.lastRunFailed"
                    : "schedule.lastRunSkipped",
                { date: dateFormatter.format(new Date(schedule.lastRunAt)) }
              )}
            </p>
          )}
          {schedule.lastRunError && (
            <p className="schedule-dialog__error" role="status">
              {schedule.lastRunError}
            </p>
          )}
          {error && <p className="schedule-dialog__error" role="alert">{error}</p>}
        </div>

        <footer className="schedule-dialog__actions">
          <button type="button" onClick={onCancel} disabled={isSaving}>
            {t("common.cancel")}
          </button>
          <button className="schedule-dialog__save" type="submit" disabled={isSaving}>
            {isSaving && <LoaderCircle aria-hidden="true" size={16} />}
            {isSaving ? t("common.saving") : t("common.save")}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
