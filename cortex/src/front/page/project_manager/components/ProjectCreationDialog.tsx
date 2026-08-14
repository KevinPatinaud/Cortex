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
import type { AgentProject } from "../../../services/agentApi.ts";

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
  const dialogRef = useRef<HTMLDialogElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const [name, setName] = useState("");
  const [parentDirectory, setParentDirectory] = useState(
    defaultParentDirectory
  );
  const [engine, setEngine] = useState<CreateProjectInput["engine"]>("codex");
  const [instructions, setInstructions] = useState(
    "# Contexte du projet\n\nDécrivez ici les objectifs, contraintes et conventions à partager avec tous les agents."
  );

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

  const selectedEngine = engines.find((candidate) => candidate.id === engine)!;
  const previewName = name.trim() || "nouveau-projet";

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
          void onCreate({ parentDirectory, name, engine, instructions });
        }}
      >
        <header className="project-creation-dialog__header">
          <span className="project-creation-dialog__icon" aria-hidden="true">
            <Sparkles size={22} />
          </span>
          <div>
            <span className="project-creation-dialog__eyebrow">Nouveau workspace</span>
            <h2 id={titleId}>Créer un projet Cortex</h2>
            <p id={descriptionId}>
              Cortex prépare la structure et les fichiers du moteur choisi.
            </p>
          </div>
          <button
            className="project-creation-dialog__close"
            type="button"
            aria-label="Fermer"
            onClick={onCancel}
            disabled={isPending}
          >
            <X aria-hidden="true" size={19} />
          </button>
        </header>

        <div className="project-creation-dialog__layout">
          <div className="project-creation-dialog__fields">
            <label className="editor-field">
              <span>Nom du projet</span>
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
              <span>Dossier parent</span>
              <input
                value={parentDirectory}
                onChange={(event) => setParentDirectory(event.target.value)}
                placeholder="C:\\dev\\projects"
                required
                disabled={isPending}
              />
              <small>Le dossier du projet sera créé à cet emplacement.</small>
            </label>

            <fieldset className="engine-selector" disabled={isPending}>
              <legend>Moteur d’agents</legend>
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
              <span>Instructions partagées</span>
              <textarea
                value={instructions}
                onChange={(event) => setInstructions(event.target.value)}
                rows={5}
                disabled={isPending}
              />
            </label>
          </div>

          <aside className="project-blueprint" aria-label="Aperçu du projet">
            <span className="project-blueprint__label">Structure générée</span>
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
                {selectedEngine.root}/agents
              </li>
            </ul>
            <p>
              Vous pourrez créer et composer les agents dès l’ouverture du projet.
            </p>
          </aside>
        </div>

        {error && (
          <p className="project-creation-dialog__error" role="alert">{error}</p>
        )}

        <footer className="project-creation-dialog__actions">
          <button type="button" onClick={onCancel} disabled={isPending}>
            Annuler
          </button>
          <button
            className="project-creation-dialog__submit"
            type="submit"
            disabled={isPending}
          >
            {isPending ? (
              <LoaderCircle aria-hidden="true" className="spin" size={16} />
            ) : (
              <Sparkles aria-hidden="true" size={16} />
            )}
            {isPending ? "Création..." : "Créer le projet"}
          </button>
        </footer>
      </form>
    </dialog>
  );
}
