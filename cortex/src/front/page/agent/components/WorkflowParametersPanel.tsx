import { useId, useState } from "react";
import { AlertCircle, CheckCircle2, LockKeyhole, SlidersHorizontal } from "lucide-react";
import type { WorkflowParameterDefinition, WorkflowParameterValues } from "../../../services/agentApi.ts";
import { useTranslation } from "../../../i18n.tsx";
import { getMissingWorkflowParameters } from "./workflowState.ts";

export function WorkflowParametersPanel({
  parameters,
  values,
  locked,
  onChange
}: {
  parameters: WorkflowParameterDefinition[];
  values: WorkflowParameterValues;
  locked: boolean;
  onChange: (parameterId: string, value: string) => void;
}) {
  const { t } = useTranslation();
  const panelId = useId();
  const [showMissing, setShowMissing] = useState(false);
  const missingParameters = getMissingWorkflowParameters(parameters, values);
  const requiredCount = parameters.filter((parameter) => parameter.required).length;
  const completedRequiredCount = requiredCount - missingParameters.length;
  const isReady = missingParameters.length === 0;

  return (
    <section
      className={`workflow-parameters${
        locked ? " workflow-parameters--locked" : ""
      }`}
      aria-labelledby={`${panelId}-title`}
    >
      <header className="workflow-parameters__header">
        <span className="workflow-parameters__icon" aria-hidden="true">
          <SlidersHorizontal size={21} strokeWidth={1.8} />
        </span>
        <div>
          <span className="workflow-parameters__eyebrow">
            {t("parameters.eyebrow")}
          </span>
          <h2 id={`${panelId}-title`}>{t("parameters.title")}</h2>
          <p>{t("parameters.description")}</p>
        </div>
        <div
          className={`workflow-parameters__status workflow-parameters__status--${
            isReady ? "ready" : "missing"
          }`}
          role="status"
        >
          {isReady ? (
            <CheckCircle2 aria-hidden="true" size={17} />
          ) : (
            <AlertCircle aria-hidden="true" size={17} />
          )}
          <span>
            {requiredCount > 0
              ? t("parameters.progress", {
                completed: completedRequiredCount,
                total: requiredCount
              })
              : t("parameters.ready")}
          </span>
        </div>
      </header>

      <div className="workflow-parameters__grid">
        {parameters.map((parameter) => {
          const inputId = `${panelId}-${parameter.id}`;
          const fieldValue = values[parameter.id] ?? "";
          const isMissing = showMissing && parameter.required && !fieldValue.trim();
          const helpIds = [
            parameter.description ? `${inputId}-description` : "",
            isMissing ? `${inputId}-error` : "",
            locked ? `${panelId}-status` : ""
          ].filter(Boolean).join(" ") || undefined;

          return (
            <label
              className={`workflow-parameters__field workflow-parameters__field--${parameter.inputType}`}
              htmlFor={inputId}
              key={parameter.id}
            >
              <span className="workflow-parameters__label">
                <strong id={`${inputId}-label`}>{parameter.label}</strong>
                <small className={parameter.required
                  ? "workflow-parameters__required"
                  : "workflow-parameters__optional"
                }>
                  {t(parameter.required
                    ? "parameters.required"
                    : "parameters.optional")}
                </small>
              </span>
              {parameter.inputType === "textarea" ? (
                <textarea
                  id={inputId}
                  aria-labelledby={`${inputId}-label`}
                  value={fieldValue}
                  onChange={(event) => onChange(parameter.id, event.target.value)}
                  placeholder={parameter.placeholder}
                  disabled={locked}
                  required={parameter.required}
                  aria-invalid={isMissing || undefined}
                  aria-describedby={helpIds}
                  rows={3}
                />
              ) : parameter.inputType === "select" ? (
                <select
                  id={inputId}
                  aria-labelledby={`${inputId}-label`}
                  value={fieldValue}
                  onChange={(event) => onChange(parameter.id, event.target.value)}
                  disabled={locked}
                  required={parameter.required}
                  aria-invalid={isMissing || undefined}
                  aria-describedby={helpIds}
                >
                  <option value="">{t("parameters.selectPlaceholder")}</option>
                  {parameter.options.map((option) => (
                    <option value={option} key={option}>{option}</option>
                  ))}
                </select>
              ) : (
                <input
                  id={inputId}
                  aria-labelledby={`${inputId}-label`}
                  type="text"
                  value={fieldValue}
                  onChange={(event) => onChange(parameter.id, event.target.value)}
                  placeholder={parameter.placeholder}
                  disabled={locked}
                  required={parameter.required}
                  aria-invalid={isMissing || undefined}
                  aria-describedby={helpIds}
                  autoComplete="off"
                />
              )}
              {parameter.description && <small id={`${inputId}-description`}>{parameter.description}</small>}
              {isMissing && <small className="workflow-parameters__error" id={`${inputId}-error`}>{t("parameters.required")}</small>}
            </label>
          );
        })}
      </div>

      <footer id={`${panelId}-status`} className={`workflow-parameters__footer workflow-parameters__footer--${
        locked ? "locked" : isReady ? "ready" : "missing"
      }`}>
        {locked ? (
          <><LockKeyhole aria-hidden="true" size={15} /> {t("parameters.locked")}</>
        ) : isReady ? (
          <><CheckCircle2 aria-hidden="true" size={15} /> {t("parameters.ready")}</>
        ) : (
          <><AlertCircle aria-hidden="true" size={15} /> {t("parameters.missing")}</>
        )}
        {!locked && !isReady && <button
          className="workflow-parameters__focus"
          type="button"
          onClick={() => {
            setShowMissing(true);
            document.getElementById(`${panelId}-${missingParameters[0].id}`)?.focus();
          }}
        >{t("parameters.focusMissing")}</button>}
      </footer>
    </section>
  );
}

