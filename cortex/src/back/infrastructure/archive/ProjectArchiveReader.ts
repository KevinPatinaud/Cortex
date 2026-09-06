import path from "node:path";
import * as unzipper from "unzipper";
import { ValidationError } from "../../application/error/ValidationError.ts";
import type { UploadedProjectFile } from "../../application/service/projectService/ProjectService.ts";

import { assertPortableProjectName, assertProjectFileManifest, isExcludedProjectPath, isPortableProjectPath, maximumProjectFiles, maximumProjectBytes, maximumFileBytes } from "../../../shared/ProjectArchivePolicy.ts";

const encryptedFlag = 0x1;
const unixFileTypeMask = 0xf000;
const unixSymbolicLinkType = 0xa000;

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
  if (content.byteLength > maximumProjectBytes) {
    throw new ValidationError("The Cortex archive exceeds the 100 MB limit.");
  }
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
    .filter(({ relativePath }) => !isExcludedProjectPath(relativePath));

  archiveFiles.forEach(({ relativePath }) =>
    assertSafeArchivePath(relativePath)
  );

  try {
    assertProjectFileManifest(archiveFiles.map(({ relativePath, entry }) => ({
      relativePath, size: entry.uncompressedSize
    })));
  } catch (error) {
    throw new ValidationError((error as Error).message);
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

  try {
    assertPortableProjectName(projectName);
  } catch {
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

function assertSafeArchivePath(relativePath: string): void {
  if (!isPortableProjectPath(relativePath)) {
    throw new ValidationError(`The archived path "${relativePath}" is invalid.`);
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
