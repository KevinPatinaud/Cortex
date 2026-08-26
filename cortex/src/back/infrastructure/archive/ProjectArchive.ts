import { ZipArchive, type ArchiverError } from "archiver";
import type { Writable } from "node:stream";
import { pipeline } from "node:stream/promises";

export const cortexArchiveMimeType = "application/vnd.cortex.project+zip";

export function getCortexArchiveFileName(projectName: string): string {
  const portableName = projectName
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
    .replace(/[. ]+$/g, "")
    .trim();

  return `${portableName || "cortex-project"}.ctx`;
}

export async function writeCortexProjectArchive(
  directoryPath: string,
  destination: Writable
): Promise<void> {
  const archive = new ZipArchive({
    zlib: { level: 9 }
  });

  archive.on("warning", (error: ArchiverError) => {
    archive.destroy(error);
  });
  archive.directory(directoryPath, false);

  const streaming = pipeline(archive, destination);

  try {
    await Promise.all([archive.finalize(), streaming]);
  } catch (error) {
    archive.abort();
    throw error;
  }
}
