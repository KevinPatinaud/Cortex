import { randomUUID } from "node:crypto";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { rmSync } from "node:fs";
import path from "node:path";
import { ValidationError } from "../../application/error/ValidationError.ts";
import { NotFoundError } from "../../application/error/NotFoundError.ts";
import { MAX_PROMPT_ATTACHMENTS, MAX_PROMPT_FILE_BYTES, MAX_PROMPT_TOTAL_BYTES, promptFileType, type PromptAttachment } from "../../../shared/PromptAttachment.ts";

export interface PromptUpload { name: string; buffer: Buffer }

/** Only generated identifiers determine on-disk paths; uploaded names are display data. */
export class PromptAttachmentStore {
  private readonly root: string;
  constructor(root: string) { this.root = path.resolve(root); }

  async save(chatId: string, promptId: string, uploads: PromptUpload[]): Promise<PromptAttachment[]> {
    if (uploads.length > MAX_PROMPT_ATTACHMENTS) throw new ValidationError("Maximum : 10 pièces jointes par prompt.");
    if (uploads.reduce((sum, file) => sum + file.buffer.length, 0) > MAX_PROMPT_TOTAL_BYTES) throw new ValidationError("Maximum : 50 Mo de pièces jointes par prompt.");
    const attachments = uploads.map(file => {
      const type = promptFileType(file.name);
      if (!file.name.trim() || file.name.length > 200 || /[\x00-\x1f\x7f/\\]/.test(file.name) || !type) throw new ValidationError(`Format ou nom de fichier non pris en charge : ${file.name.slice(0, 200)}`);
      if (!file.buffer.length || file.buffer.length > MAX_PROMPT_FILE_BYTES) throw new ValidationError("Chaque pièce jointe doit contenir entre 1 octet et 20 Mo.");
      if (type.kind === "image" && !isImage(file.buffer, type.mimeType)) throw new ValidationError(`Image invalide : ${file.name}`);
      return { id: randomUUID(), name: file.name, mimeType: type.mimeType, kind: type.kind, size: file.buffer.length };
    });
    if (!attachments.length) return [];
    try {
      await mkdir(this.directory(chatId, promptId), { recursive: true });
      for (let index = 0; index < attachments.length; index++) {
        await writeFile(this.filePath(chatId, promptId, attachments[index]), uploads[index].buffer, { flag: "wx", mode: 0o600 });
      }
      return attachments;
    } catch (error) { await this.removePrompt(chatId, promptId); throw error; }
  }

  async resolve(chatId: string, promptId: string, attachment: PromptAttachment): Promise<string> {
    const file = this.filePath(chatId, promptId, attachment);
    const entry = await stat(file).catch(() => null);
    if (!entry?.isFile() || entry.size !== attachment.size) throw new NotFoundError(`Pièce jointe manquante ou modifiée : ${attachment.name}`);
    return file;
  }
  async removePrompt(chatId: string, promptId: string): Promise<void> { await rm(this.directory(chatId, promptId), { recursive: true, force: true }); }
  removeChat(chatId: string): void { rmSync(this.directory(chatId), { recursive: true, force: true }); }

  private directory(...ids: string[]): string {
    if (!ids.length || ids.some(id => !/^[a-f0-9-]{36}$/i.test(id))) throw new ValidationError("Identifiant de pièce jointe invalide.");
    const target = path.resolve(this.root, ...ids);
    const relative = path.relative(this.root, target);
    if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw new ValidationError("Chemin de pièce jointe invalide.");
    return target;
  }
  private filePath(chatId: string, promptId: string, attachment: PromptAttachment): string {
    const type = promptFileType(attachment.name);
    if (!type || !/^[a-f0-9-]{36}$/i.test(attachment.id)) throw new ValidationError("Pièce jointe invalide.");
    return path.join(this.directory(chatId, promptId), `${attachment.id}.${type.extension}`);
  }
}

function isImage(buffer: Buffer, mime: string): boolean {
  if (mime === "image/png") return buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  if (mime === "image/jpeg") return buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255;
  if (mime === "image/gif") return ["GIF87a", "GIF89a"].includes(buffer.subarray(0, 6).toString("ascii"));
  return mime === "image/webp" && buffer.subarray(0, 4).toString("ascii") === "RIFF" && buffer.subarray(8, 12).toString("ascii") === "WEBP";
}
