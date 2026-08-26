import path from "node:path";
import * as unzipper from "unzipper";
import { ValidationError } from "../../application/error/ValidationError.ts";
import type { UploadedProjectFile } from "../../application/service/projectService/ProjectService.ts";

const maximumProjectFiles = 2_000;
const maximumProjectBytes = 100 * 1024 * 1024;
const maximumFileBytes = 20 * 1024 * 1024;
const encryptedFlag = 0x1;
const unixFileTypeMask = 0xf000;
const unixSymbolicLinkType = 0xa000;
const excludedDirectoryNames = new Set([
  ".git",
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".next"
]);

export interface ImportedCortexArchive {
  projectName: string;
  files: UploadedProjectFile[];
}

interface ArchiveFileEntry {
  entry: unzipper.File;
  relativePath: string;
}

export async function readCortexProjectArchive(
  archiveFileName: string,
  content: Buffer
): Promise<ImportedCortexArchive> {
  const projectName = getProjectName(archiveFileName);
  let directory: unzipper.CentralDirectory;

  try {
    directory = await unzipper.Open.buffer(content);
  } catch {
    throw new ValidationError(
      "The selected file is not a valid Cortex archive."
    );
  }

  if (directory.numberOfRecords > maximumProjectFiles * 2) {
    throw new ValidationError("The Cortex archive contains too many entries.");
  }

  const rawArchiveFiles = directory.files
    .filter((entry) => entry.type === "File")
    .map((entry) => ({ entry, relativePath: entry.path }));

  rawArchiveFiles.forEach(({ relativePath }) =>
    assertSafeArchivePath(relativePath)
  );

  const archiveFiles = removeOptionalRootDirectory(rawArchiveFiles)
    .filter(({ relativePath }) => !isExcludedImportPath(relativePath));

  archiveFiles.forEach(({ relativePath }) =>
    assertSafeArchivePath(relativePath)
  );

  if (archiveFiles.length === 0 || archiveFiles.length > maximumProjectFiles) {
    throw new ValidationError(
      `The Cortex archive must contain between 1 and ${maximumProjectFiles} files.`
    );
  }

  if (archiveFiles.reduce(
    (total, { entry }) => total + entry.uncompressedSize,
    0
  ) > maximumProjectBytes) {
    throw new ValidationError(
      "The Cortex archive exceeds the 100 MB extracted-size limit."
    );
  }

  let totalBytes = 0;
  const files: UploadedProjectFile[] = [];

  for (const archiveFile of archiveFiles) {
    assertSupportedArchiveEntry(archiveFile);
    const result = await readArchiveEntry(archiveFile, totalBytes);
    totalBytes = result.totalBytes;
    files.push({
      relativePath: archiveFile.relativePath,
      content: result.content
    });
  }

  return { projectName, files };
}

function getProjectName(archiveFileName: string): string {
  const decodedFileName = decodeMultipartFileName(archiveFileName);
  const fileName = path.basename(decodedFileName.replace(/\\/g, "/"));

  if (!fileName.toLowerCase().endsWith(".ctx")) {
    throw new ValidationError("The selected file must use the .ctx extension.");
  }

  const projectName = fileName.slice(0, -4).trim();

  if (!projectName) {
    throw new ValidationError("The Cortex archive name is invalid.");
  }

  return projectName;
}

function decodeMultipartFileName(fileName: string): string {
  if ([...fileName].some((character) => character.charCodeAt(0) > 0xff)) {
    return fileName;
  }

  const utf8Name = Buffer.from(fileName, "latin1").toString("utf8");
  return utf8Name.includes("\uFFFD") ? fileName : utf8Name;
}

function removeOptionalRootDirectory(
  files: ArchiveFileEntry[]
): ArchiveFileEntry[] {
  const lowerCasePaths = new Set(
    files.map(({ relativePath }) => relativePath.toLowerCase())
  );

  if (lowerCasePaths.has("agents.md") || lowerCasePaths.has("claude.md")) {
    return files;
  }

  const firstSegments = files.map(({ relativePath }) =>
    relativePath.split("/")[0] ?? ""
  );
  const commonRoot = firstSegments[0];

  if (
    !commonRoot ||
    firstSegments.some((segment) => segment !== commonRoot)
  ) {
    return files;
  }

  const prefix = `${commonRoot}/`;
  const strippedFiles = files.map(({ entry, relativePath }) => ({
    entry,
    relativePath: relativePath.startsWith(prefix)
      ? relativePath.slice(prefix.length)
      : relativePath
  }));
  const strippedPaths = new Set(
    strippedFiles.map(({ relativePath }) => relativePath.toLowerCase())
  );

  return strippedPaths.has("agents.md") || strippedPaths.has("claude.md")
    ? strippedFiles
    : files;
}

function isExcludedImportPath(relativePath: string): boolean {
  const segments = relativePath.replace(/\\/g, "/").split("/");
  const fileName = segments.at(-1)?.toLowerCase() ?? "";

  return segments
    .slice(0, -1)
    .some((segment) => excludedDirectoryNames.has(segment.toLowerCase())) ||
    ((fileName === ".env" || fileName.startsWith(".env.")) &&
      fileName !== ".env.example");
}

function assertSafeArchivePath(relativePath: string): void {
  const segments = relativePath.split("/");

  if (
    !relativePath ||
    relativePath.startsWith("/") ||
    relativePath.includes("\\") ||
    /[<>:"|?*\u0000-\u001F]/.test(relativePath) ||
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    throw new ValidationError(
      `The archived path "${relativePath}" is invalid.`
    );
  }
}

function assertSupportedArchiveEntry({
  entry,
  relativePath
}: ArchiveFileEntry): void {
  const unixFileType = (entry.externalFileAttributes >>> 16) & unixFileTypeMask;

  if (unixFileType === unixSymbolicLinkType) {
    throw new ValidationError(
      `The symbolic link "${relativePath}" cannot be imported.`
    );
  }

  if ((entry.flags & encryptedFlag) !== 0) {
    throw new ValidationError("Encrypted Cortex archives are not supported.");
  }

  if (entry.compressionMethod !== 0 && entry.compressionMethod !== 8) {
    throw new ValidationError(
      `The compression used by "${relativePath}" is not supported.`
    );
  }

  if (entry.uncompressedSize > maximumFileBytes) {
    throw new ValidationError(
      `The file "${relativePath}" exceeds the 20 MB limit.`
    );
  }
}

async function readArchiveEntry(
  archiveFile: ArchiveFileEntry,
  previousTotalBytes: number
): Promise<{ content: Buffer; totalBytes: number }> {
  const chunks: Buffer[] = [];
  let fileBytes = 0;
  let totalBytes = previousTotalBytes;

  try {
    for await (const chunk of archiveFile.entry.stream()) {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      fileBytes += buffer.byteLength;
      totalBytes += buffer.byteLength;

      if (fileBytes > maximumFileBytes) {
        throw new ValidationError(
          `The file "${archiveFile.relativePath}" exceeds the 20 MB limit.`
        );
      }

      if (totalBytes > maximumProjectBytes) {
        throw new ValidationError(
          "The Cortex archive exceeds the 100 MB extracted-size limit."
        );
      }

      chunks.push(buffer);
    }
  } catch (error) {
    if (error instanceof ValidationError) {
      throw error;
    }

    throw new ValidationError(
      `The file "${archiveFile.relativePath}" could not be extracted.`
    );
  }

  return { content: Buffer.concat(chunks, fileBytes), totalBytes };
}
