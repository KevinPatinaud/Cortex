import { useEffect, useId, useRef, useState } from "react";
import { CalendarClock, LoaderCircle, Plus, Trash2, X } from "lucide-react";
import {
  saveWorkflowSchedule,
  previewWorkflowSchedule,
  type WorkflowSchedulePreview,
  type WorkflowParameterValues,
  type WorkflowSchedule
} from "../../../services/agentApi.ts";
import { useTranslation } from "../../../i18n.tsx";
import { describeCronExpression } from "./CronExpressionDescription.ts";
import { buildScheduleCron, readScheduleForm, type ScheduleFrequency } from "./ScheduleForm.ts";
import { trapDialogFocus } from "../../shared/dialogFocus.ts";

interface WorkflowScheduleDialogProps {
  projectId: string;
  previewSchedule?: (cron: string, timezone: string) => Promise<WorkflowSchedulePreview>;
  persistSchedule?: (input: { cron: string; crons: string[]; timezone: string; enabled: boolean; parameterValues: WorkflowParameterValues }) => Promise<WorkflowSchedule>;
  description?: string;
  scheduleOnly?: boolean;
  heading?: string;
  projectName: string;
  schedule: WorkflowSchedule;
  parameterValues: WorkflowParameterValues;
  onCancel: () => void;
  onSaved: (schedule: WorkflowSchedule) => void;
}

export function WorkflowScheduleDialog({
  projectId,
  projectName,
  schedule,
  parameterValues,
  onCancel,
  onSaved, previewSchedule, persistSchedule, description, scheduleOnly, heading
}: WorkflowScheduleDialogProps) {
  const { language, t } = useTranslation();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const frequencyRef = useRef<HTMLSelectElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const [entries, setEntries] = useState(() => (schedule.crons ?? [schedule.cron])
    .map((cron, id) => ({ id, cron, form: readScheduleForm(cron) })));
  const nextEntryId = useRef(entries.length);
  const [activeId, setActiveId] = useState(0);
  const activeIndex = Math.max(0, entries.findIndex((entry) => entry.id === activeId));
  const { cron, form } = entries[activeIndex];
  const [browserTimezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC");
  const serverTimezone = schedule.serverTimezone ?? schedule.timezone;
  const [timezone, setTimezone] = useState(schedule.configured === false ? browserTimezone : schedule.timezone);
  const [preview, setPreview] = useState<{ key: string; entries: Array<{ value?: WorkflowSchedulePreview; error?: string }> } | null>(null);
  const [refresh, setRefresh] = useState(0);
  const previewKey = JSON.stringify([entries.map((entry) => entry.cron), timezone, refresh]);
  const currentPreviews = preview?.key === previewKey ? preview.entries : null;
  const currentPreview = currentPreviews?.[activeIndex];
  const allCronsValid = entries.every((entry) => describeCronExpression(entry.cron, language) !== null);
  const canSave = allCronsValid && currentPreviews?.every((entry) => entry.value) === true;
  const zones = [...new Set([browserTimezone, serverTimezone, timezone, "UTC", ...Intl.supportedValuesOf("timeZone")])];

  function updateForm(next: typeof form) {
    setEntries((values) => values.map((entry) => entry.id === activeId
      ? { ...entry, form: next, cron: next.frequency === "custom" ? entry.cron : buildScheduleCron(next.frequency, next.time, next.day) }
      : entry));
  }

  function setCron(value: string) {
    setEntries((values) => values.map((entry) => entry.id === activeId ? { ...entry, cron: value } : entry));
  }

  function addEntry() {
    const id = nextEntryId.current++;
    const cron = "0 9 * * *";
    setEntries((values) => [...values, { id, cron, form: readScheduleForm(cron) }]);
    setActiveId(id);
  }

  function removeEntry(id: number) {
    const remaining = entries.filter((entry) => entry.id !== id);
    if (!remaining.length) return;
    setEntries(remaining);
    if (activeId === id) setActiveId(remaining[Math.max(0, activeIndex - 1)].id);
    window.requestAnimationFrame(() => frequencyRef.current?.focus());
  }

  useEffect(() => {
    const interval = window.setInterval(() => setRefresh((value) => value + 1), 60_000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      void Promise.all(entries.map(async (entry) => {
        if (!describeCronExpression(entry.cron, language)) return {};
        try { return { value: await (previewSchedule ? previewSchedule(entry.cron, timezone) : previewWorkflowSchedule(projectId, entry.cron, timezone)) }; }
        catch (error: unknown) { return { error: error instanceof Error ? error.message : t("common.unexpectedError") }; }
      })).then((values) => { if (active) setPreview({ key: previewKey, entries: values }); });
    }, 300);
    return () => { active = false; window.clearTimeout(timer); };
  }, [projectId, previewKey, language, t, previewSchedule]);
  const [enabled, setEnabled] = useState(schedule.enabled);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    frequencyRef.current?.focus();
  }, [activeId]);

  useEffect(() => {
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement : null;

    if (!dialog?.open) {
      dialog?.showModal();
    }

    const focusFrame = window.requestAnimationFrame(() => {
      frequencyRef.current?.focus();
    });

    return () => {
      window.cancelAnimationFrame(focusFrame);
      if (dialog?.open) dialog.close();
      if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    };
  }, []);

  async function handleSubmit(): Promise<void> {
    if (isSaving || !canSave) return;
    setIsSaving(true);
    setError("");

    try {
      const input = {
        cron: entries[0].cron,
        crons: entries.map((entry) => entry.cron),
        timezone,
        enabled,
        parameterValues
      };
      onSaved(await (persistSchedule ? persistSchedule(input) : saveWorkflowSchedule(projectId, input)));
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
    timeStyle: "short",
    timeZone: browserTimezone
  });
  const cronDescription = describeCronExpression(cron, language);
  const isCronValid = cron.trim().length > 0 && cronDescription !== null;
  const formatInZone = (date: string, zone: string) => new Intl.DateTimeFormat(language, {
    year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: zone, timeZoneName: "shortOffset"
  }).format(new Date(date));

  return (
    <dialog
      className="schedule-dialog"
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      aria-busy={isSaving}
      onKeyDown={trapDialogFocus}
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
            <h2 id={titleId}>{heading ?? t("schedule.title")}</h2>
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
        <fieldset className="schedule-dialog__fields" disabled={isSaving}>
          <p id={descriptionId}>{description ?? t("schedule.description")}</p>
          <div className="schedule-dialog__project">
            <span>{scheduleOnly ? "Cortex" : t("dialog.affectedProject")}</span>
            <strong>{projectName}</strong>
          </div>

          {!scheduleOnly && <label className="schedule-dialog__toggle">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
            />
            <span>
              <strong>{t("schedule.enabled")}</strong>
              <small>{t("schedule.enabledHelp")}</small>
            </span>
          </label>}

          <div className="schedule-dialog__entries-heading">
            <h3>{t("schedule.entries")}</h3>
            <button type="button" onClick={addEntry}><Plus size={16} aria-hidden="true" />{t("schedule.addEntry")}</button>
          </div>
          {!scheduleOnly && <p className="schedule-dialog__entries-help">{t("schedule.entriesHelp")}</p>}
          <div className="schedule-dialog__entries" role="group" aria-label={t("schedule.entries")}>
            {entries.map((entry, index) => {
              const invalid = !describeCronExpression(entry.cron, language) || currentPreviews?.[index]?.error;
              return <div className="schedule-dialog__entry" key={entry.id}>
                <button type="button" aria-pressed={entry.id === activeId} onClick={() => setActiveId(entry.id)}>
                  <strong>{t("schedule.entry", { number: String(index + 1) })}</strong>
                  <code>{entry.cron}</code>
                  <small>{invalid ? t("schedule.checkEntry") : describeCronExpression(entry.cron, language)}</small>
                </button>
                <button type="button" disabled={entries.length === 1} onClick={() => removeEntry(entry.id)}
                  aria-label={t("schedule.removeEntry", { number: String(index + 1) })}><Trash2 size={16} aria-hidden="true" /></button>
              </div>;
            })}
          </div>
          <div className="schedule-dialog__layout">
          <div className="schedule-dialog__editor">
            <div className="schedule-dialog__timing">
              <label className="schedule-dialog__field">
                <span id={`${descriptionId}-frequency-label`}>{t("schedule.frequency")}</span>
                <select ref={frequencyRef} aria-labelledby={`${descriptionId}-frequency-label`} value={form.frequency} onChange={(event) => updateForm({ ...form, frequency: event.target.value as ScheduleFrequency, day: "1" })}>
                  {(["daily", "weekdays", "weekly", "monthly", "hourly", "custom"] as const).map((frequency) => (
                    <option key={frequency} value={frequency}>{t(`schedule.frequency.${frequency}`)}</option>
                  ))}
                </select>
              </label>
              {form.frequency !== "custom" && form.frequency !== "hourly" && (
                <label className="schedule-dialog__field">
                  <span>{t("schedule.time")}</span>
                  <input type="time" value={form.time} required onChange={(event) => updateForm({ ...form, time: event.target.value })} />
                </label>
              )}
            </div>
            {form.frequency === "weekly" && <label className="schedule-dialog__field">
              <span id={`${descriptionId}-weekday-label`}>{t("schedule.weekday")}</span>
              <select aria-labelledby={`${descriptionId}-weekday-label`} value={form.day} onChange={(event) => updateForm({ ...form, day: event.target.value })}>
                {[1, 2, 3, 4, 5, 6, 0].map((day) => <option key={day} value={day}>{new Intl.DateTimeFormat(language, { weekday: "long", timeZone: "UTC" }).format(new Date(Date.UTC(2026, 5, 7 + day)))}</option>)}
              </select>
            </label>}
            {form.frequency === "monthly" && <label className="schedule-dialog__field">
              <span id={`${descriptionId}-month-day-label`}>{t("schedule.monthDay")}</span>
              <select aria-labelledby={`${descriptionId}-month-day-label`} value={form.day} onChange={(event) => updateForm({ ...form, day: event.target.value })}>
                {Array.from({ length: 31 }, (_, index) => <option key={index + 1} value={index + 1}>{index + 1}</option>)}
              </select>
              {Number(form.day) > 28 && <small>{t("schedule.shortMonths")}</small>}
            </label>}
            <label className="schedule-dialog__field">
              <span id={`${descriptionId}-zone-label`}>{t("schedule.zone")}</span>
              <select aria-labelledby={`${descriptionId}-zone-label`} value={timezone} onChange={(event) => setTimezone(event.target.value)} aria-describedby={`${descriptionId}-zone-help`}>
                {zones.map((zone) => <option key={zone} value={zone}>{zone}{zone === browserTimezone ? ` · ${t("schedule.yourZone")}` : zone === serverTimezone ? ` · ${t("schedule.serverZone")}` : ""}</option>)}
              </select>
              <small id={`${descriptionId}-zone-help`}>{t("schedule.zoneHelp")}</small>
            </label>
            <label className="schedule-dialog__field schedule-dialog__expression">
              <span id={`${descriptionId}-expression-label`}>{t("schedule.expression")}</span>
              <input type="text" value={cron} readOnly={form.frequency !== "custom"} onChange={(event) => setCron(event.target.value)}
                placeholder="0 9 * * 1-5" spellCheck={false} autoComplete="off" required
                aria-labelledby={`${descriptionId}-expression-label`}
                aria-invalid={!isCronValid} aria-describedby={`${descriptionId}-cron-help ${descriptionId}-cron-status`} />
              <small id={`${descriptionId}-cron-help`}>{t("schedule.expressionHelp")}</small>
            </label>
            <output id={`${descriptionId}-cron-status`} className={`schedule-dialog__cron-description${isCronValid ? "" : " schedule-dialog__cron-description--unavailable"}`} aria-live="polite">
              <span>{timezone}</span>
              <strong>{cronDescription ?? t("schedule.explanationUnavailable")}</strong>
            </output>
            <details className="schedule-dialog__dst">
              <summary>{t("schedule.dstTitle")}</summary>
              <p>{t("schedule.dstHelp")}</p>
            </details>
          </div>
          <section className="schedule-dialog__preview" aria-label={t("schedule.preview")}>
            <div className="schedule-dialog__preview-heading"><CalendarClock size={18} aria-hidden="true" /><h3>{t("schedule.preview")}</h3></div>
            <p className="schedule-dialog__zone-caption">{t("schedule.yourTime", { timezone: browserTimezone })}</p>
            <div aria-live="polite" aria-busy={isCronValid && !currentPreview}>
              {!isCronValid ? <p>{t("schedule.explanationUnavailable")}</p> : !currentPreview ? <p>{t("schedule.calculating")}</p> : currentPreview.error ? <p className="schedule-dialog__error" role="alert">{currentPreview.error}</p> : (
                <ol className="schedule-dialog__occurrences">
                  {currentPreview.value?.nextRuns.map((date, index) => <li key={date}>
                    <span className="schedule-dialog__occurrence-number" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
                    <div><time dateTime={date}>{formatInZone(date, browserTimezone)}</time>
                      {timezone !== browserTimezone && timezone !== serverTimezone && <small>{timezone} · {formatInZone(date, timezone)}</small>}
                      {serverTimezone !== browserTimezone && <small>{t("schedule.serverZone")} · {formatInZone(date, serverTimezone)}</small>}
                    </div>
                  </li>)}
                </ol>
              )}
            </div>
            <div className="schedule-dialog__clocks">
              <div><span>{t("schedule.yourZone")}</span><strong>{browserTimezone}</strong></div>
              <div><span>{t("schedule.serverZone")}</span><strong>{serverTimezone}</strong></div>
            </div>
            {!scheduleOnly && <p className="schedule-dialog__preview-note">{enabled ? t("schedule.previewHelp") : t("schedule.pausedHelp")}</p>}
          </section>
          </div>
          {schedule.lastRunAt && schedule.lastRunStatus && (
            <p className={`schedule-dialog__last-run schedule-dialog__last-run--${schedule.lastRunStatus}`}>
              {t(
                schedule.lastRunStatus === "waiting" ? "schedule.lastRunWaiting" : schedule.lastRunStatus === "succeeded"
                  ? "schedule.lastRunSucceeded"
                  : schedule.lastRunStatus === "failed"
                    ? "schedule.lastRunFailed"
                    : schedule.lastRunStatus === "cancelled"
                      ? "schedule.lastRunCancelled"
                      : schedule.lastRunStatus === "interrupted"
                        ? "schedule.lastRunInterrupted"
                        : "schedule.lastRunSkipped",
                { date: `${dateFormatter.format(new Date(schedule.lastRunAt))} (${browserTimezone})` }
              )}
            </p>
          )}
          {schedule.lastRunError && (
            <p className="schedule-dialog__error" role="status">
              {schedule.lastRunError}
            </p>
          )}
          {error && <p className="schedule-dialog__error" role="alert">{error}</p>}
        </fieldset>
        </div>

        <footer className="schedule-dialog__actions">
          <button type="button" onClick={onCancel} disabled={isSaving}>
            {t("common.cancel")}
          </button>
          <button
            className="schedule-dialog__save"
            type="submit"
            disabled={isSaving || !canSave}
          >
            {isSaving && <LoaderCircle aria-hidden="true" size={16} />}
            {isSaving ? t("common.saving") : t("common.save")}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
