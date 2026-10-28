import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { Clock3, X } from "lucide-react";
import { useTranslation } from "../../i18n.tsx";
import { trapDialogFocus } from "../shared/dialogFocus.ts";
import { fr, en } from "./messages.ts";

export function localDateInput(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function formatPromptSchedule(value: string, language: string): string {
  return new Intl.DateTimeFormat(language, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", timeZoneName: "short" }).format(new Date(value));
}

export function PromptScheduleDialog({ value, onClose, onApply }: { value: string | null; onClose: () => void; onApply: (value: string | null) => Promise<void> | void }) {
  const { language } = useTranslation();
  const copy = language === "fr" ? fr : en;
  const titleId = useId(), descriptionId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null), timeRef = useRef<HTMLInputElement>(null);
  const [date, setDate] = useState(() => localDateInput(value ? new Date(value) : new Date()));
  const [time, setTime] = useState(() => value ? `${String(new Date(value).getHours()).padStart(2, "0")}:${String(new Date(value).getMinutes()).padStart(2, "0")}` : "");
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const submitting = useRef(false);
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    timeRef.current?.focus();
    return () => { if (dialog?.open) dialog.close(); };
  }, []);
  async function apply(value: string | null) {
    if (submitting.current) return;
    submitting.current = true; setBusy(true); setError("");
    try { await onApply(value); }
    catch (reason) { setError(reason instanceof Error ? reason.message : copy.error); }
    finally { submitting.current = false; setBusy(false); }
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    const chosen = new Date(`${date}T${time}:00`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time) || !Number.isFinite(chosen.getTime())) { setError(copy.scheduleInvalid); return; }
    // Calendar normalization would silently move nonexistent daylight-saving
    // times. Require an exact round trip in the user's local timezone.
    if (localDateInput(chosen) !== date || `${String(chosen.getHours()).padStart(2, "0")}:${String(chosen.getMinutes()).padStart(2, "0")}` !== time) { setError(copy.scheduleInvalid); return; }
    if (chosen.getTime() <= Date.now()) { setError(copy.schedulePast); return; }
    void apply(chosen.toISOString());
  }
  return <dialog ref={dialogRef} className="prompt-settings-dialog prompt-schedule-dialog" aria-labelledby={titleId} aria-describedby={descriptionId} aria-modal="true" onKeyDown={trapDialogFocus}
    onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <header><h2 id={titleId}><Clock3 size={19} aria-hidden="true" />{copy.schedulePrompt}</h2><button type="button" aria-label={copy.close} disabled={busy} onClick={onClose}><X size={19} aria-hidden="true" /></button></header>
    <form className="prompt-schedule-body" noValidate onSubmit={submit}>
      <p id={descriptionId}>{copy.scheduleHelp}</p>
      <div className="prompt-settings-fields">
        <label>{copy.scheduleDate}<input type="date" value={date} disabled={busy} min={localDateInput(new Date())} required onChange={event => { setDate(event.target.value); setError(""); }} /></label>
        <label>{copy.scheduleTime}<input ref={timeRef} type="time" step={60} value={time} disabled={busy} required onChange={event => { setTime(event.target.value); setError(""); }} /></label>
      </div>
      <small className="prompt-schedule-zone">{copy.scheduleZone} {Intl.DateTimeFormat().resolvedOptions().timeZone}</small>
      {error && <p className="prompt-settings-error" role="alert">{error}</p>}
      <div className="prompt-schedule-actions"><button type="button" disabled={busy} onClick={() => void apply(null)}>{copy.noSchedule}</button><button type="submit" className="prompt-primary" disabled={busy}>{busy ? copy.sending : copy.applySchedule}</button></div>
    </form>
  </dialog>;
}
