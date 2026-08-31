import { Cable, Save, X } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useTranslation } from "../../../i18n.tsx";
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
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [preservedEnvironmentKeys, setPreservedEnvironmentKeys] = useState<string[]>([]);
  const [preservedHeaderNames, setPreservedHeaderNames] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;

    if (isOpen && !dialog.open) dialog.showModal();
    if (!isOpen && dialog.open) dialog.close();
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    setError("");
    setPreservedEnvironmentKeys([]);
    setPreservedHeaderNames([]);

    if (!connection) {
      setDraft(EMPTY_DRAFT);
      setIsLoading(false);
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
  }, [connection, isOpen]);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError("");

    try {
      const input: McpMachineConnectionInput = {
        engine: draft.engine,
        name: draft.name.trim(),
        transport: draft.transport,
        command: draft.command.trim(),
        args: draft.args.split(/\r?\n/).map((value) => value.trim()).filter(Boolean),
        url: draft.url.trim(),
        environment: parseKeyValueLines(
          draft.environment,
          preservedEnvironmentKeys,
          Boolean(connection),
          t("mcp.invalidKeyValue")
        ),
        headers: parseKeyValueLines(
          draft.headers,
          preservedHeaderNames,
          Boolean(connection),
          t("mcp.invalidKeyValue")
        )
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
            <h2>{connection ? t("mcp.editTitle") : t("mcp.createTitle")}</h2>
            <p>{t("mcp.dialogDescription")}</p>
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
              <span>{t("mcp.name")}</span>
              <input
                required
                autoFocus={!connection}
                value={draft.name}
                disabled={isLoading || isSaving}
                onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              />
            </label>
            <label className="editor-field">
              <span>{t("mcp.engine")}</span>
              <select
                value={draft.engine}
                disabled={Boolean(connection) || isLoading || isSaving}
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
                disabled={isLoading || isSaving}
                onChange={(event) => setDraft({
                  ...draft,
                  transport: event.target.value as Draft["transport"]
                })}
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
                <span>{t("mcp.command")}</span>
                <input
                  required
                  value={draft.command}
                  disabled={isLoading || isSaving}
                  placeholder="npx"
                  onChange={(event) => setDraft({ ...draft, command: event.target.value })}
                />
              </label>
              <label className="editor-field">
                <span>{t("mcp.arguments")}</span>
                <textarea
                  value={draft.args}
                  disabled={isLoading || isSaving}
                  placeholder={"-y\n@upstash/context7-mcp"}
                  onChange={(event) => setDraft({ ...draft, args: event.target.value })}
                />
                <small>{t("mcp.argumentsHelp")}</small>
              </label>
              <KeyValueField
                label={t("mcp.environment")}
                help={t("mcp.keyValueHelp")}
                value={draft.environment}
                disabled={isLoading || isSaving}
                onChange={(environment) => setDraft({ ...draft, environment })}
              />
            </>
          ) : (
            <>
              <label className="editor-field">
                <span>{t("mcp.url")}</span>
                <input
                  required
                  type="url"
                  value={draft.url}
                  disabled={isLoading || isSaving}
                  placeholder="https://example.com/mcp"
                  onChange={(event) => setDraft({ ...draft, url: event.target.value })}
                />
              </label>
              <KeyValueField
                label={t("mcp.headers")}
                help={t("mcp.keyValueHelp")}
                value={draft.headers}
                disabled={isLoading || isSaving}
                onChange={(headers) => setDraft({ ...draft, headers })}
              />
            </>
          )}
        </div>

        {error && <p className="project-creation-dialog__error" role="alert">{error}</p>}

        <footer className="project-creation-dialog__actions">
          <button type="button" onClick={onClose} disabled={isSaving}>
            {t("common.cancel")}
          </button>
          <button
            className="project-creation-dialog__submit"
            type="submit"
            disabled={isLoading || isSaving}
          >
            <Save aria-hidden="true" size={15} />
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
  onChange
}: {
  label: string;
  help: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}) {
  return (
    <label className="editor-field">
      <span>{label}</span>
      <textarea
        value={value}
        disabled={disabled}
        placeholder="NAME=value"
        onChange={(event) => onChange(event.target.value)}
      />
      <small>{help}</small>
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
