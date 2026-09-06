import { Cable, LoaderCircle, Save, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type FormEvent, type Ref } from "react";
import { useTranslation } from "../../../i18n.tsx";
import { trapDialogFocus } from "../../shared/dialogFocus.ts";
import {
  createMachineMcpConnection,
  getMachineMcpConnection,
  updateMachineMcpConnection,
  type McpConnectionEngine,
  type McpConnectionSummary,
  type McpMachineConnectionInput
} from "../../../services/agentApi.ts";

interface McpConnectionDialogProps {
  connection: McpConnectionSummary | null;
  isOpen: boolean;
  onClose: () => void;
  onSaved: () => void;
}

interface Draft {
  engine: McpConnectionEngine;
  name: string;
  transport: "stdio" | "http" | "sse";
  command: string;
  args: string;
  url: string;
  environment: string;
  headers: string;
}

const EMPTY_DRAFT: Draft = {
  engine: "codex",
  name: "",
  transport: "stdio",
  command: "",
  args: "",
  url: "",
  environment: "",
  headers: ""
};

export function McpConnectionDialog({
  connection,
  isOpen,
  onClose,
  onSaved
}: McpConnectionDialogProps) {
  const { t } = useTranslation();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const keyValueInputRef = useRef<HTMLTextAreaElement>(null);
  const titleId = useId();
  const descriptionId = useId();
  const nameHelpId = useId();
  const argumentsHelpId = useId();
  const errorId = useId();
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [preservedEnvironmentKeys, setPreservedEnvironmentKeys] = useState<string[]>([]);
  const [preservedHeaderNames, setPreservedHeaderNames] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [invalidKeyValueField, setInvalidKeyValueField] = useState<"environment" | "headers" | null>(null);
  const [error, setError] = useState("");
  const fieldsDisabled = isLoading || isSaving || !isReady;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen && !dialog.open) dialog.showModal();
    if (!isOpen && dialog.open) dialog.close();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    setError("");
    setInvalidKeyValueField(null);
    setIsReady(false);
    setDraft(EMPTY_DRAFT);
    setPreservedEnvironmentKeys([]);
    setPreservedHeaderNames([]);

    if (!connection) {
      setIsLoading(false);
      setIsReady(true);
      return;
    }

    let isMounted = true;
    setIsLoading(true);
    void getMachineMcpConnection(connection.source as McpConnectionEngine, connection.name)
      .then((detail) => {
        if (!isMounted) return;
        setPreservedEnvironmentKeys(detail.environmentKeys);
        setPreservedHeaderNames(detail.headerNames);
        setDraft({
          engine: detail.engine,
          name: detail.name,
          transport: detail.transport,
          command: detail.command,
          args: detail.args.join("\n"),
          url: detail.url,
          environment: detail.environmentKeys.map((key) => `${key}=`).join("\n"),
          headers: detail.headerNames.map((name) => `${name}=`).join("\n")
        });
        setIsReady(true);
      })
      .catch((caught) => {
        if (isMounted) {
          setError(caught instanceof Error ? caught.message : t("mcp.loadError"));
        }
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [connection, isOpen, loadAttempt]);

  useEffect(() => {
    if (!isOpen || isLoading || !isReady) return;
    const focusFrame = window.requestAnimationFrame(() => nameInputRef.current?.focus());
    return () => window.cancelAnimationFrame(focusFrame);
  }, [isOpen, isLoading, isReady]);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (fieldsDisabled) return;
    setError("");
    setInvalidKeyValueField(null);

    const keyValueField = draft.transport === "stdio" ? "environment" : "headers";
    let keyValues: Record<string, string | null>;
    try {
      keyValues = parseKeyValueLines(
        draft[keyValueField],
        keyValueField === "environment" ? preservedEnvironmentKeys : preservedHeaderNames,
        Boolean(connection),
        t("mcp.invalidKeyValue")
      );
    } catch (caught) {
      setInvalidKeyValueField(keyValueField);
      setError(caught instanceof Error ? caught.message : t("mcp.invalidKeyValue"));
      keyValueInputRef.current?.focus();
      return;
    }

    try {
      const input: McpMachineConnectionInput = {
        engine: draft.engine,
        name: draft.name.trim(),
        transport: draft.transport,
        command: draft.command.trim(),
        args: draft.args.split(/\r?\n/).map((value) => value.trim()).filter(Boolean),
        url: draft.url.trim(),
        environment: keyValueField === "environment" ? keyValues : {},
        headers: keyValueField === "headers" ? keyValues : {}
      };

      setIsSaving(true);
      if (connection) {
        await updateMachineMcpConnection(
          connection.source as McpConnectionEngine,
          connection.name,
          input
        );
      } else {
        await createMachineMcpConnection(input);
      }
      onSaved();
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : t("mcp.saveError"));
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="project-creation-dialog mcp-connection-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      aria-busy={isLoading || isSaving}
      onKeyDown={trapDialogFocus}
      onCancel={(event) => {
        event.preventDefault();
        if (!isSaving) onClose();
      }}
      onClose={() => {
        if (isOpen && !isSaving) onClose();
      }}
    >
      <form className="project-creation-dialog__form" onSubmit={(event) => void submit(event)}>
        <header className="project-creation-dialog__header">
          <span className="project-creation-dialog__icon" aria-hidden="true">
            <Cable size={22} />
          </span>
          <div>
            <span className="project-creation-dialog__eyebrow">{t("mcp.dialogEyebrow")}</span>
            <h2 id={titleId}>{connection ? t("mcp.editTitle") : t("mcp.createTitle")}</h2>
            <p id={descriptionId}>{t("mcp.dialogDescription")}</p>
          </div>
          <button
            type="button"
            className="project-creation-dialog__close"
            onClick={onClose}
            disabled={isSaving}
            aria-label={t("common.close")}
          >
            <X aria-hidden="true" size={18} />
          </button>
        </header>

        <div className="mcp-connection-dialog__fields">
          <div className="mcp-connection-dialog__row">
            <label className="editor-field">
              <span>{t("mcp.name")} <em>{t("form.required")}</em></span>
              <input
                required
                ref={nameInputRef}
                maxLength={80}
                pattern="[a-zA-Z0-9_\-]+"
                title={t("mcp.nameHelp")}
                aria-describedby={nameHelpId}
                value={draft.name}
                disabled={fieldsDisabled}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
              <small id={nameHelpId}>{t("mcp.nameHelp")}</small>
            </label>
            <label className="editor-field">
              <span>{t("mcp.engine")}</span>
              <select
                value={draft.engine}
                disabled={Boolean(connection) || fieldsDisabled}
                onChange={(event) => {
                  const engine = event.target.value as McpConnectionEngine;
                  setDraft({
                    ...draft,
                    engine,
                    transport: engine === "codex" && draft.transport === "sse"
                      ? "http"
                      : draft.transport
                  });
                }}
              >
                <option value="codex">Codex</option>
                <option value="claude">Claude</option>
                <option value="copilot">Copilot</option>
              </select>
            </label>
            <label className="editor-field">
              <span>{t("mcp.transport")}</span>
              <select
                value={draft.transport}
                disabled={fieldsDisabled}
                onChange={(event) => {
                  setInvalidKeyValueField(null);
                  setError("");
                  setDraft({ ...draft, transport: event.target.value as Draft["transport"] });
                }}
              >
                <option value="stdio">STDIO</option>
                <option value="http">HTTP</option>
                {draft.engine !== "codex" && <option value="sse">SSE</option>}
              </select>
            </label>
          </div>

          {draft.transport === "stdio" ? (
            <>
              <label className="editor-field">
                <span>{t("mcp.command")} <em>{t("form.required")}</em></span>
                <input
                  required
                  maxLength={4_096}
                  pattern=".*\S.*"
                  value={draft.command}
                  disabled={fieldsDisabled}
                  placeholder="npx"
                  onChange={(event) => setDraft({ ...draft, command: event.target.value })}
                />
              </label>
              <label className="editor-field">
                <span>{t("mcp.arguments")}</span>
                <textarea
                  value={draft.args}
                  disabled={fieldsDisabled}
                  aria-describedby={argumentsHelpId}
                  placeholder={"-y\n@upstash/context7-mcp"}
                  onChange={(event) => setDraft({ ...draft, args: event.target.value })}
                />
                <small id={argumentsHelpId}>{t("mcp.argumentsHelp")}</small>
              </label>
              <KeyValueField
                label={t("mcp.environment")}
                help={t("mcp.keyValueHelp")}
                value={draft.environment}
                disabled={fieldsDisabled}
                inputRef={keyValueInputRef}
                errorId={invalidKeyValueField === "environment" ? errorId : undefined}
                onChange={(environment) => {
                  setInvalidKeyValueField(null);
                  setError("");
                  setDraft({ ...draft, environment });
                }}
              />
            </>
          ) : (
            <>
              <label className="editor-field">
                <span>{t("mcp.url")} <em>{t("form.required")}</em></span>
                <input
                  required
                  type="url"
                  maxLength={8_192}
                  pattern="https?://.+"
                  value={draft.url}
                  disabled={fieldsDisabled}
                  placeholder="https://example.com/mcp"
                  onChange={(event) => setDraft({ ...draft, url: event.target.value })}
                />
              </label>
              <KeyValueField
                label={t("mcp.headers")}
                help={t("mcp.keyValueHelp")}
                value={draft.headers}
                disabled={fieldsDisabled}
                inputRef={keyValueInputRef}
                errorId={invalidKeyValueField === "headers" ? errorId : undefined}
                onChange={(headers) => {
                  setInvalidKeyValueField(null);
                  setError("");
                  setDraft({ ...draft, headers });
                }}
              />
            </>
          )}
        </div>

        {isLoading && <p role="status">{t("common.loading")}</p>}
        {error && <p id={errorId} className="project-creation-dialog__error" role="alert">{error}</p>}

        <footer className="project-creation-dialog__actions">
          <button type="button" onClick={onClose} disabled={isSaving}>
            {t("common.cancel")}
          </button>
          {!isReady && !isLoading && error && (
            <button type="button" onClick={() => setLoadAttempt((attempt) => attempt + 1)}>
              {t("project.retry")}
            </button>
          )}
          <button
            className="project-creation-dialog__submit"
            type="submit"
            disabled={fieldsDisabled}
          >
            {isSaving
              ? <LoaderCircle aria-hidden="true" className="spin" size={15} />
              : <Save aria-hidden="true" size={15} />}
            {isSaving
              ? t("common.saving")
              : connection
                ? t("mcp.update")
                : t("mcp.create")}
          </button>
        </footer>
      </form>
    </dialog>
  );
}

function KeyValueField({
  label,
  help,
  value,
  disabled,
  inputRef,
  errorId,
  onChange
}: {
  label: string;
  help: string;
  value: string;
  disabled: boolean;
  inputRef: Ref<HTMLTextAreaElement>;
  errorId?: string;
  onChange: (value: string) => void;
}) {
  const helpId = useId();
  return (
    <label className="editor-field">
      <span>{label}</span>
      <textarea
        ref={inputRef}
        value={value}
        disabled={disabled}
        placeholder="NAME=value"
        autoComplete="off"
        spellCheck={false}
        aria-invalid={Boolean(errorId) || undefined}
        aria-describedby={[helpId, errorId].filter(Boolean).join(" ")}
        onChange={(event) => onChange(event.target.value)}
      />
      <small id={helpId}>{help}</small>
    </label>
  );
}

function parseKeyValueLines(
  value: string,
  preservedKeys: string[],
  allowPreserve: boolean,
  errorMessage: string
): Record<string, string | null> {
  const entries: Array<[string, string | null]> = [];

  for (const rawLine of value.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const separator = line.indexOf("=");
    if (separator <= 0) {
      throw new Error(errorMessage);
    }

    const key = line.slice(0, separator).trim();
    const entryValue = line.slice(separator + 1);
    entries.push([
      key,
      allowPreserve && !entryValue && preservedKeys.includes(key)
        ? null
        : entryValue
    ]);
  }

  return Object.fromEntries(entries);
}
