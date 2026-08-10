import { useEffect, useId, useRef } from "react";
import { RotateCcw, Trash2, X } from "lucide-react";

interface ConfirmationDialogProps {
  variant: "reset" | "delete";
  title: string;
  description: string;
  projectName: string;
  confirmLabel: string;
  pendingLabel: string;
  isPending: boolean;
  error?: string;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ConfirmationDialog({
  variant,
  title,
  description,
  projectName,
  confirmLabel,
  pendingLabel,
  isPending,
  error,
  onCancel,
  onConfirm
}: ConfirmationDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const Icon = variant === "delete" ? Trash2 : RotateCcw;

  useEffect(() => {
    const dialog = dialogRef.current;

    if (!dialog?.open) {
      dialog?.showModal();
    }

    return () => {
      if (dialog?.open) {
        dialog.close();
      }
    };
  }, []);

  return (
    <dialog
      className={`confirmation-dialog confirmation-dialog--${variant}`}
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      aria-busy={isPending}
      onCancel={(event) => {
        event.preventDefault();

        if (!isPending) {
          onCancel();
        }
      }}
    >
      <form
        className="confirmation-dialog__form"
        onSubmit={(event) => {
          event.preventDefault();
          onConfirm();
        }}
      >
        <header className="confirmation-dialog__header">
          <span className="confirmation-dialog__icon" aria-hidden="true">
            <Icon size={22} strokeWidth={1.8} />
          </span>
          <div>
            <span className="confirmation-dialog__eyebrow">Confirmation</span>
            <h2 id={titleId}>{title}</h2>
          </div>
          <button
            className="confirmation-dialog__close"
            type="button"
            aria-label="Fermer"
            title="Fermer"
            onClick={onCancel}
            disabled={isPending}
          >
            <X aria-hidden="true" size={18} />
          </button>
        </header>

        <div className="confirmation-dialog__body">
          <p id={descriptionId}>{description}</p>
          <div className="confirmation-dialog__project">
            <span>Projet concerne</span>
            <strong>{projectName}</strong>
          </div>
          {error && (
            <p className="confirmation-dialog__error" role="alert">
              {error}
            </p>
          )}
        </div>

        <footer className="confirmation-dialog__actions">
          <button
            className="confirmation-dialog__cancel"
            type="button"
            autoFocus
            onClick={onCancel}
            disabled={isPending}
          >
            Annuler
          </button>
          <button
            className="confirmation-dialog__confirm"
            type="submit"
            disabled={isPending}
          >
            <Icon
              aria-hidden="true"
              className={isPending ? "confirmation-dialog__pending-icon" : undefined}
              size={16}
            />
            {isPending ? pendingLabel : confirmLabel}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
