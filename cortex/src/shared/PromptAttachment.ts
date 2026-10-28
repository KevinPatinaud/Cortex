export const MAX_PROMPT_ATTACHMENTS = 10;
export const MAX_PROMPT_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_PROMPT_TOTAL_BYTES = 50 * 1024 * 1024;

const types: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif",
  pdf: "application/pdf", txt: "text/plain", md: "text/markdown", csv: "text/csv", json: "application/json",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  doc: "application/msword", xls: "application/vnd.ms-excel", ppt: "application/vnd.ms-powerpoint",
  odt: "application/vnd.oasis.opendocument.text", ods: "application/vnd.oasis.opendocument.spreadsheet", odp: "application/vnd.oasis.opendocument.presentation",
  rtf: "application/rtf", log: "text/plain", xml: "application/xml", yaml: "text/yaml", yml: "text/yaml", html: "text/html"
};
export const PROMPT_ATTACHMENT_ACCEPT = Object.keys(types).map(extension => `.${extension}`).join(",");

export interface PromptAttachment {
  id: string;
  name: string;
  mimeType: string;
  size: number;
  kind: "image" | "document";
}

export function promptFileType(name: string): { extension: string; mimeType: string; kind: "image" | "document" } | null {
  const extension = name.split(".").at(-1)?.toLowerCase() ?? "";
  const mimeType = types[extension];
  return mimeType ? { extension, mimeType, kind: mimeType.startsWith("image/") ? "image" : "document" } : null;
}
