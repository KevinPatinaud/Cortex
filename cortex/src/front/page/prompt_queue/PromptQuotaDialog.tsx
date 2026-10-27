import { useEffect, useId, useRef, useState } from "react";
import { Clock3 } from "lucide-react";
import type { PromptQuotaWarning } from "../../../shared/PromptQueue.ts";
import { useTranslation } from "../../i18n.tsx";
import { trapDialogFocus } from "../shared/dialogFocus.ts";
import { fr, en } from "./messages.ts";

interface Props {
  warning: PromptQuotaWarning;
  unavailableReason: string;
  onKeep: () => void;
  onForce: () => Promise<void>;
}

export function PromptQuotaDialog({ warning, unavailableReason, onKeep, onForce }: Props) {
  const { language } = useTranslation();
  const copy = language === "fr" ? fr : en;
  const titleId = useId(), descriptionId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null), keepRef = useRef<HTMLButtonElement>(null);
  const submitting = useRef(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) dialog.showModal();
    keepRef.current?.focus();
    return () => { if (dialog?.open) dialog.close(); };
  }, []);
  const percentage = (value: number | undefined) => value === undefined ? copy.unknown : `${new Intl.NumberFormat(language, { maximumFractionDigits: 2 }).format(value)} %`;
  async function force() {
    if (submitting.current || unavailableReason) return;
    submitting.current = true; setBusy(true); setError("");
    try { await onForce(); }
    catch (reason) { setError(reason instanceof Error ? reason.message : copy.error); }
    finally { submitting.current = false; setBusy(false); }
  }
  return <dialog ref={dialogRef} className="prompt-settings-dialog prompt-quota-dialog" aria-labelledby={titleId} aria-describedby={descriptionId} aria-modal="true"
    onKeyDown={trapDialogFocus} onCancel={event => { event.preventDefault(); if (!busy) onKeep(); }}>
    <div className="prompt-quota-content">
      <span className="prompt-quota-icon"><Clock3 size={24} aria-hidden="true" /></span>
      <h2 id={titleId}>{copy.quotaNoticeTitle}</h2>
      <p id={descriptionId}>{warning.status.available ? copy.quotaNoticeHelp : copy.quotaUnknownHelp}</p>
      <table className="prompt-quota-table">
        <thead><tr><th scope="col">{copy.quotaWindow}</th><th scope="col">{copy.quotaAvailable}</th><th scope="col">{copy.quotaMinimum}</th></tr></thead>
        <tbody>
          <tr><th scope="row">{copy.fiveHourWindow}</th><td>{percentage(warning.status.fiveHour?.remainingPercent)}</td><td>{percentage(warning.quota.minimumFiveHourRemainingPercent)}</td></tr>
          <tr><th scope="row">{copy.weeklyWindow}</th><td>{percentage(warning.status.weekly?.remainingPercent)}</td><td>{percentage(warning.quota.minimumWeeklyRemainingPercent)}</td></tr>
        </tbody>
      </table>
      <p className="prompt-quota-scope">{copy.forceQuotaScope}</p>
      {unavailableReason && <p className="prompt-quota-scope" role="status">{unavailableReason}</p>}
      {error && <p className="prompt-settings-error" role="alert">{error}</p>}
      <div className="prompt-quota-actions">
        <button type="button" ref={keepRef} disabled={busy} onClick={onKeep}>{copy.keepQueued}</button>
        <button type="button" className="prompt-primary" disabled={busy || Boolean(unavailableReason)} onClick={() => void force()}>{busy ? copy.forcingNow : copy.forceNow}</button>
      </div>
    </div>
  </dialog>;
}
