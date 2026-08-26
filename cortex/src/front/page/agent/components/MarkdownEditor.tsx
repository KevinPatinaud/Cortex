import {
  useId,
  useRef,
  useState,
  type KeyboardEvent
} from "react";
import {
  Bold,
  Code2,
  Eye,
  Heading2,
  Italic,
  Link,
  List,
  ListOrdered,
  PenLine,
  Quote,
  Underline
} from "lucide-react";
import { useTranslation } from "../../../i18n.tsx";
import { MarkdownContent } from "./MarkdownContent.tsx";

interface MarkdownEditorProps {
  value: string;
  onChange: (value: string) => void;
  label: string;
  placeholder?: string;
  help?: string;
  rows?: number;
  disabled?: boolean;
}

type SelectionUpdate = {
  value: string;
  selectionStart: number;
  selectionEnd: number;
};

export function MarkdownEditor({
  value,
  onChange,
  label,
  placeholder,
  help,
  rows = 12,
  disabled = false
}: MarkdownEditorProps) {
  const { t } = useTranslation();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const labelId = useId();
  const [mode, setMode] = useState<"write" | "preview">("write");

  function commit(update: SelectionUpdate): void {
    onChange(update.value);
    requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) {
        return;
      }

      textarea.focus();
      textarea.setSelectionRange(update.selectionStart, update.selectionEnd);
    });
  }

  function wrapSelection(
    before: string,
    after: string,
    fallback: string
  ): void {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }

    const { selectionStart, selectionEnd } = textarea;
    const selected = value.slice(selectionStart, selectionEnd);
    const inserted = selected || fallback;
    const nextValue = `${value.slice(0, selectionStart)}${before}${inserted}${after}${value.slice(selectionEnd)}`;
    const contentStart = selectionStart + before.length;

    commit({
      value: nextValue,
      selectionStart: contentStart,
      selectionEnd: contentStart + inserted.length
    });
  }

  function prefixLines(prefix: string, ordered = false): void {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }

    const lineStart = value.lastIndexOf("\n", textarea.selectionStart - 1) + 1;
    const nextLineBreak = value.indexOf("\n", textarea.selectionEnd);
    const lineEnd = nextLineBreak === -1 ? value.length : nextLineBreak;
    const selectedLines = value.slice(lineStart, lineEnd) || t("markdown.text");
    const formatted = selectedLines
      .split("\n")
      .map((line, index) => `${ordered ? `${index + 1}. ` : prefix}${line}`)
      .join("\n");

    commit({
      value: `${value.slice(0, lineStart)}${formatted}${value.slice(lineEnd)}`,
      selectionStart: lineStart,
      selectionEnd: lineStart + formatted.length
    });
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>): void {
    if (!(event.ctrlKey || event.metaKey)) {
      return;
    }

    if (event.key.toLowerCase() === "b") {
      event.preventDefault();
      wrapSelection("**", "**", t("markdown.text"));
    } else if (event.key.toLowerCase() === "i") {
      event.preventDefault();
      wrapSelection("*", "*", t("markdown.text"));
    } else if (event.key.toLowerCase() === "u") {
      event.preventDefault();
      wrapSelection("<u>", "</u>", t("markdown.text"));
    }
  }

  const toolbarActions = [
    {
      label: t("markdown.heading"),
      icon: Heading2,
      action: () => prefixLines("## ")
    },
    {
      label: t("markdown.bold"),
      icon: Bold,
      action: () => wrapSelection("**", "**", t("markdown.text"))
    },
    {
      label: t("markdown.italic"),
      icon: Italic,
      action: () => wrapSelection("*", "*", t("markdown.text"))
    },
    {
      label: t("markdown.underline"),
      icon: Underline,
      action: () => wrapSelection("<u>", "</u>", t("markdown.text"))
    },
    {
      label: t("markdown.bulletedList"),
      icon: List,
      action: () => prefixLines("- ")
    },
    {
      label: t("markdown.numberedList"),
      icon: ListOrdered,
      action: () => prefixLines("", true)
    },
    {
      label: t("markdown.quote"),
      icon: Quote,
      action: () => prefixLines("> ")
    },
    {
      label: t("markdown.link"),
      icon: Link,
      action: () => wrapSelection("[", "](https://)", t("markdown.linkText"))
    },
    {
      label: t("markdown.code"),
      icon: Code2,
      action: () => wrapSelection("`", "`", t("markdown.codeText"))
    }
  ];

  return (
    <div className="markdown-editor" aria-labelledby={labelId}>
      <div className="markdown-editor__heading">
        <span id={labelId}>{label}</span>
        <div className="markdown-editor__modes" role="tablist" aria-label={t("markdown.mode")}>
          <button
            className={mode === "write" ? "is-active" : undefined}
            type="button"
            role="tab"
            aria-selected={mode === "write"}
            onClick={() => setMode("write")}
          >
            <PenLine aria-hidden="true" size={14} />
            {t("markdown.write")}
          </button>
          <button
            className={mode === "preview" ? "is-active" : undefined}
            type="button"
            role="tab"
            aria-selected={mode === "preview"}
            onClick={() => setMode("preview")}
          >
            <Eye aria-hidden="true" size={14} />
            {t("markdown.preview")}
          </button>
        </div>
      </div>

      <div className="markdown-editor__surface">
        {mode === "write" ? (
          <>
            <div className="markdown-editor__toolbar" role="toolbar" aria-label={t("markdown.toolbar")}>
              {toolbarActions.map(({ label: actionLabel, icon: Icon, action }) => (
                <button
                  type="button"
                  title={actionLabel}
                  aria-label={actionLabel}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={action}
                  disabled={disabled}
                  key={actionLabel}
                >
                  <Icon aria-hidden="true" size={16} />
                </button>
              ))}
            </div>
            <textarea
              ref={textareaRef}
              value={value}
              onChange={(event) => onChange(event.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              rows={rows}
              disabled={disabled}
              aria-labelledby={labelId}
            />
          </>
        ) : (
          <div className="markdown-editor__preview" role="tabpanel">
            {value.trim() ? (
              <MarkdownContent content={value} />
            ) : (
              <p className="markdown-editor__empty">{t("markdown.empty")}</p>
            )}
          </div>
        )}
      </div>
      {help && <small>{help}</small>}
    </div>
  );
}
