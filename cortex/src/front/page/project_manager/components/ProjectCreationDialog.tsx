import { useEffect, useId, useRef, useState } from "react";
import {
  Bot,
  Check,
  Code2,
  FileText,
  Folder,
  LoaderCircle,
  Sparkles,
  X
} from "lucide-react";
import type {
  CreateProjectInput,
  Project
} from "../../../services/projectApi.ts";
import {
  getAgentStatus,
  type AgentProject
} from "../../../services/agentApi.ts";
import { useTranslation } from "../../../i18n.tsx";
import { trapDialogFocus } from "../../shared/dialogFocus.ts";

interface ProjectCreationDialogProps {
  isPending: boolean;
  error?: string;
  onCancel: () => void;
  onCreate: (input: CreateProjectInput) => Promise<{
    project: Project;
    content: AgentProject;
  } | null>;
}

const engines: Array<{
  id: CreateProjectInput["engine"];
  label: string;
  detail: string;
  root: string;
}> = [
  { id: "codex", label: "Codex", detail: "Agents TOML", root: ".codex" },
  { id: "claude", label: "Claude", detail: "Agents Markdown", root: ".claude" },
  { id: "copilot", label: "Copilot", detail: "Agents GitHub", root: ".github" }
];

export function ProjectCreationDialog({
  isPending,
  error,
  onCancel,
  onCreate
}: ProjectCreationDialogProps) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const descriptionHelpId = useId();
  const [name, setName] = useState("");
  const [engine, setEngine] = useState<CreateProjectInput["engine"]>("codex");
  const hasSelectedEngine = useRef(false);
  const [isDetectingEngine, setIsDetectingEngine] = useState(true);
  const [generationMode, setGenerationMode] = useState<"ai" | "empty">("ai");
  const [projectDescription, setProjectDescription] = useState("");
  const [instructions, setInstructions] = useState("");

  useEffect(() => {
    const dialog = dialogRef.current;

    if (!dialog?.open) {
      dialog?.showModal();
    }

    const focusFrame = window.requestAnimationFrame(() => {
      nameInputRef.current?.focus();
    });

    return () => {
      window.cancelAnimationFrame(focusFrame);
      if (dialog?.open) {
        dialog.close();
      }
    };
  }, []);

  useEffect(() => {
    let isMounted = true;

    async function detectInstalledEngine(): Promise<void> {
      try {
        const status = await getAgentStatus();

        if (isMounted && !hasSelectedEngine.current) {
          setEngine(status.engine ?? "codex");
        }
      } catch {
        if (isMounted && !hasSelectedEngine.current) {
          setEngine("codex");
        }
      } finally {
        if (isMounted) {
          setIsDetectingEngine(false);
        }
      }
    }

    void detectInstalledEngine();

    return () => {
      isMounted = false;
    };
  }, []);

  const selectedEngine = engines.find((candidate) => candidate.id === engine);
  const previewName = name.trim() || t("creation.defaultName");
  const isAiGeneration = generationMode === "ai";
  const isWaitingForEngine = isAiGeneration && isDetectingEngine;
  const canCreate = !isPending && !isWaitingForEngine && Boolean(name.trim()) &&
    (!isAiGeneration || Boolean(projectDescription.trim()));

  return (
    <dialog
      className="project-creation-dialog"
      ref={dialogRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      aria-busy={isPending}
      onKeyDown={trapDialogFocus}
      onCancel={(event) => {
        event.preventDefault();
        if (!isPending) {
          onCancel();
        }
      }}
    >
      <form
        className="project-creation-dialog__form"
        onSubmit={(event) => {
          event.preventDefault();
          if (canCreate) {
            hasSelectedEngine.current = true;
            void onCreate(isAiGeneration ? {
              name: name.trim(),
              engine,
              generationMode: "ai",
              description: projectDescription.trim()
            } : {
              name: name.trim(),
              engine,
              generationMode: "empty",
              instructions
            });
          }
        }}
      >
        <header className="project-creation-dialog__header">
          <span className="project-creation-dialog__icon" aria-hidden="true">
            {isAiGeneration ? <Sparkles size={22} /> : <FileText size={22} />}
          </span>
          <div>
            <span className="project-creation-dialog__eyebrow">{t("creation.eyebrow")}</span>
            <h2 id={titleId}>{t("creation.title")}</h2>
            <p id={descriptionId}>
              {t("creation.description")}
            </p>
          </div>
          <button
            className="project-creation-dialog__close"
            type="button"
            aria-label={t("common.close")}
            onClick={onCancel}
            disabled={isPending}
          >
            <X aria-hidden="true" size={19} />
          </button>
        </header>

        <div className="project-creation-dialog__layout">
          <div className="project-creation-dialog__fields">
            <label className="editor-field">
              <span>{t("creation.projectName")} <em>{t("form.required")}</em></span>
              <input
                ref={nameInputRef}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Atlas"
                required
                disabled={isPending}
              />
            </label>

            <fieldset className="engine-selector creation-mode-selector" disabled={isPending}>
              <legend>{t("creation.mode")}</legend>
              <div className="engine-selector__options creation-mode-selector__options">
                {(["ai", "empty"] as const).map((mode) => (
                  <label
                    className={`engine-option creation-mode-option${
                      generationMode === mode ? " engine-option--selected" : ""
                    }`}
                    key={mode}
                  >
                    <input
                      type="radio"
                      name="project-generation-mode"
                      value={mode}
                      checked={generationMode === mode}
                      onChange={() => setGenerationMode(mode)}
                    />
                    {mode === "ai" ? <Sparkles aria-hidden="true" size={18} /> : <FileText aria-hidden="true" size={18} />}
                    <strong>{t(mode === "ai" ? "creation.modeAi" : "creation.modeEmpty")}</strong>
                    <small>{t(mode === "ai" ? "creation.modeAiHelp" : "creation.modeEmptyHelp")}</small>
                    {generationMode === mode && (
                      <Check aria-hidden="true" className="engine-option__check" size={14} />
                    )}
                  </label>
                ))}
              </div>
            </fieldset>

            <fieldset
              className="engine-selector"
              disabled={isPending || isWaitingForEngine}
              aria-busy={isWaitingForEngine}
            >
              <legend>{t("creation.engine")}</legend>
              <div className="engine-selector__options">
                {engines.map((candidate) => (
                  <label
                    className={`engine-option${
                      engine === candidate.id ? " engine-option--selected" : ""
                    }`}
                    key={candidate.id}
                  >
                    <input
                      type="radio"
                      name="project-engine"
                      value={candidate.id}
                      checked={engine === candidate.id}
                      onChange={() => {
                        hasSelectedEngine.current = true;
                        setEngine(candidate.id);
                      }}
                    />
                    <Bot aria-hidden="true" size={18} />
                    <strong>{candidate.label}</strong>
                    <small>{candidate.detail}</small>
                    {engine === candidate.id && (
                      <Check aria-hidden="true" className="engine-option__check" size={14} />
                    )}
                  </label>
                ))}
              </div>
              {isWaitingForEngine && <small role="status">{t("common.loading")}</small>}
            </fieldset>

            <label className="editor-field editor-field--instructions">
              <span>
                {t(isAiGeneration ? "creation.projectDescription" : "creation.instructions")} <em>{t(isAiGeneration ? "form.required" : "editor.optional")}</em>
              </span>
              <textarea
                value={isAiGeneration ? projectDescription : instructions}
                onChange={(event) => isAiGeneration
                  ? setProjectDescription(event.target.value)
                  : setInstructions(event.target.value)}
                placeholder={t(isAiGeneration ? "creation.descriptionPlaceholder" : "creation.instructionsPlaceholder")}
                rows={5}
                maxLength={20_000}
                aria-describedby={descriptionHelpId}
                required={isAiGeneration}
                disabled={isPending}
              />
              <small id={descriptionHelpId}>{t(isAiGeneration ? "creation.descriptionHelp" : "creation.instructionsHelp")}</small>
            </label>
          </div>

          <aside className="project-blueprint" aria-label={t("creation.previewAria")}>
            <span className="project-blueprint__label">{t(isAiGeneration ? "creation.generatedStructure" : "creation.emptyStructure")}</span>
            <div className="project-blueprint__title">
              <Folder aria-hidden="true" size={19} />
              <strong>{previewName}</strong>
            </div>
            <ul>
              <li>
                <Code2 aria-hidden="true" size={15} />
                {engine === "claude" ? "CLAUDE.md" : "AGENTS.md"}
              </li>
              <li>
                <Folder aria-hidden="true" size={15} />
                {selectedEngine?.root ?? ".codex"}/agents/{isAiGeneration ? "*" : ` (${t("creation.emptyFolder")})`}
              </li>
            </ul>
            <p>
              {t(isAiGeneration ? "creation.readyHelp" : "creation.emptyReadyHelp")}
            </p>
          </aside>
        </div>

        {error && (
          <p className="project-creation-dialog__error" role="alert">{error}</p>
        )}

        <footer className="project-creation-dialog__actions">
          <button type="button" onClick={onCancel} disabled={isPending}>
            {t("common.cancel")}
          </button>
          <button
            className="project-creation-dialog__submit"
            type="submit"
            disabled={!canCreate}
          >
            {isPending ? (
              <LoaderCircle aria-hidden="true" className="spin" size={16} />
            ) : isAiGeneration ? (
              <Sparkles aria-hidden="true" size={16} />
            ) : (
              <Folder aria-hidden="true" size={16} />
            )}
            {isPending
              ? t(isAiGeneration ? "creation.creating" : "creation.creatingEmpty")
              : t(isAiGeneration ? "creation.create" : "creation.createEmpty")}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
