import { FastForward, Pause } from "lucide-react";
import { useTranslation } from "../../../i18n.tsx";

interface HandoffToggleProps {
  checked: boolean;
  mixed?: boolean;
  label: string;
  description: string;
  disabled?: boolean;
  variant?: "agent" | "global";
  onChange: (checked: boolean) => void;
}

export function HandoffToggle({
  checked,
  mixed = false,
  label,
  description,
  disabled = false,
  variant = "agent",
  onChange
}: HandoffToggleProps) {
  const { t } = useTranslation();
  const stateLabel = mixed
    ? t("handoff.mixed")
    : checked ? t("handoff.automatic") : t("handoff.manual");

  return (
    <button
      className={`handoff-toggle handoff-toggle--${variant}${
        checked ? " handoff-toggle--active" : mixed ? " handoff-toggle--mixed" : ""
      }`}
      type="button"
      role={variant === "global" ? "checkbox" : "switch"}
      aria-checked={mixed ? "mixed" : checked}
      aria-label={`${stateLabel}. ${label}`}
      aria-description={t("handoff.current", { state: stateLabel, description })}
      disabled={disabled}
      title={t("handoff.current", { state: stateLabel, description })}
      onClick={() => onChange(!checked)}
    >
      <span className="handoff-toggle__label">
        {checked ? (
          <FastForward
            aria-hidden="true"
            size={variant === "global" ? 16 : 14}
            strokeWidth={2}
          />
        ) : (
          <Pause
            aria-hidden="true"
            size={variant === "global" ? 16 : 14}
            strokeWidth={2}
          />
        )}
        {stateLabel}
      </span>
    </button>
  );
}

