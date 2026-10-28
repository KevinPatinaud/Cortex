import { useEffect, useState } from "react";
import { FileText, X } from "lucide-react";
import type { PromptAttachment } from "../../../shared/PromptAttachment.ts";
import { promptFileType } from "../../../shared/PromptAttachment.ts";
import { promptAttachmentUrl } from "../../services/promptQueueApi.ts";
import { useTranslation } from "../../i18n.tsx";
import { fr, en } from "./messages.ts";

export interface DraftAttachment { id: string; file: File }

function Card({ name, size, imageUrl, href, remove, disabled }: { name: string; size: number; imageUrl?: string; href?: string; remove?: () => void; disabled?: boolean }) {
  const { language } = useTranslation();
  const copy = language === "fr" ? fr : en;
  const content = <>{imageUrl ? <img src={imageUrl} alt={name} /> : <FileText size={24} aria-hidden="true" />}<span><strong title={name}>{name}</strong><small>{new Intl.NumberFormat(language, { maximumFractionDigits: 1 }).format(size / 1024)} {copy.fileKilobytes}</small></span></>;
  return <li className="prompt-file-card">
    {href ? <a href={href} target="_blank" rel="noopener noreferrer">{content}</a> : <span className="prompt-file-content">{content}</span>}
    {remove && <button type="button" disabled={disabled} aria-label={copy.removeAttachment.replace("{name}", name)} title={copy.removeAttachment.replace("{name}", name)} onClick={remove}><X size={16} aria-hidden="true" /></button>}
  </li>;
}

function DraftCard({ item, onRemove, disabled }: { item: DraftAttachment; onRemove: () => void; disabled: boolean }) {
  const [preview, setPreview] = useState<string>();
  useEffect(() => {
    if (promptFileType(item.file.name)?.kind !== "image") return;
    const url = URL.createObjectURL(item.file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [item.file]);
  return <Card name={item.file.name} size={item.file.size} imageUrl={preview} remove={onRemove} disabled={disabled} />;
}

export function DraftAttachments({ files, onRemove, disabled }: { files: DraftAttachment[]; onRemove: (id: string) => void; disabled: boolean }) {
  const { language } = useTranslation();
  const copy = language === "fr" ? fr : en;
  return <div><ul className="prompt-attachments" aria-label={copy.attachments}>{files.map(item => <DraftCard key={item.id} item={item} onRemove={() => onRemove(item.id)} disabled={disabled} />)}</ul><p className="prompt-file-limits">{copy.attachmentLimits}</p></div>;
}

export function SavedAttachments({ files, chatId, promptId }: { files: PromptAttachment[]; chatId: string; promptId: string }) {
  const { language } = useTranslation();
  const copy = language === "fr" ? fr : en;
  return <ul className="prompt-attachments" aria-label={copy.attachments}>{files.map(file => {
    const url = promptAttachmentUrl(chatId, promptId, file.id);
    return <Card key={file.id} name={file.name} size={file.size} imageUrl={file.kind === "image" ? url : undefined} href={url} />;
  })}</ul>;
}
