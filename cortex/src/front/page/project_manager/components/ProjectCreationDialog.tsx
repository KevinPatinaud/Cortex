import { useEffect, useId, useRef, useState } from "react";
import {
  Bot,
  Check,
  Code2,
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

interface ProjectCreationDialogProps {
  defaultParentDirectory: string;
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
  defaultParentDirectory,
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
  const [name, setName] = useState("");
  const [parentDirectory, setParentDirectory] = useState(
    defaultParentDirectory
  );
  const [engine, setEngine] = useState<CreateProjectInput["engine"] | null>(null);
  const [isDetectingEngine, setIsDetectingEngine] = useState(true);
  const [projectDescription, setProjectDescription] = useState("");

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

        if (isMounted) {
          setEngine(status.engine ?? "codex");
        }
      } catch {
        if (isMounted) {
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

  return (
    <dialog
      className="project-creation-dialog"
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
        className="project-creation-dialog__form"
        onSubmit={(event) => {
          event.preventDefault();
          if (engine) {
            void onCreate({
              parentDirectory,
              name,
              engine,
              description: projectDescription
            });
          }
        }}
      >
        <header className="project-creation-dialog__header">
          <span className="project-creation-dialog__icon" aria-hidden="true">
            <Sparkles size={22} />
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
              <span>{t("creation.projectName")}</span>
              <input
                ref={nameInputRef}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Atlas"
                required
                disabled={isPending}
              />
            </label>

            <label className="editor-field">
              <span>{t("creation.parentDirectory")}</span>
              <input
                value={parentDirectory}
                onChange={(event) => setParentDirectory(event.target.value)}
                placeholder="C:\\dev\\projects"
                required
                disabled={isPending}
              />
              <small>{t("creation.parentHelp")}</small>
            </label>

            <fieldset
              className="engine-selector"
              disabled={isPending || isDetectingEngine}
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
                      onChange={() => setEngine(candidate.id)}
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
            </fieldset>

            <label className="editor-field editor-field--instructions">
              <span>{t("creation.projectDescription")}</span>
              <textarea
                value={projectDescription}
                onChange={(event) => setProjectDescription(event.target.value)}
                placeholder={t("creation.descriptionPlaceholder")}
                rows={5}
                maxLength={20_000}
                required
                disabled={isPending}
              />
              <small>{t("creation.descriptionHelp")}</small>
            </label>
          </div>

          <aside className="project-blueprint" aria-label={t("creation.previewAria")}>
            <span className="project-blueprint__label">{t("creation.generatedStructure")}</span>
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
                {selectedEngine?.root ?? ".codex"}/agents/*
              </li>
            </ul>
            <p>
              {t("creation.readyHelp")}
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
            disabled={
              isPending ||
              isDetectingEngine ||
              !engine ||
              !projectDescription.trim()
            }
          >
            {isPending ? (
              <LoaderCircle aria-hidden="true" className="spin" size={16} />
            ) : (
              <Sparkles aria-hidden="true" size={16} />
            )}
            {isPending ? t("creation.creating") : t("creation.create")}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
