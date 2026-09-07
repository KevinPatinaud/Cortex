import { ZipArchive, type ArchiverError } from "archiver";
import { constants } from "node:fs";
import { lstat, open, readdir } from "node:fs/promises";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { ValidationError } from "../../application/error/ValidationError.ts";
import type { AgentWorkflowConfiguration } from "../../application/service/projectService/ProjectService.ts";
import { canonicalizeArchivedWorkflow, projectWorkflowArchivePath } from "../../application/service/projectService/ProjectWorkflowArchive.ts";
import {
  assertProjectFileManifest, isExcludedProjectPath, isPortableProjectPath,
  maximumFileBytes, maximumProjectBytes, maximumProjectFiles
} from "../../../shared/ProjectArchivePolicy.ts";

export const cortexArchiveMimeType = "application/vnd.cortex.project+zip";

export function getCortexArchiveFileName(projectName: string): string {
  const portableName = projectName
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
    .slice(0, 120)
    .replace(/[. ]+$/g, "")
    .trim();

  return `${isPortableProjectPath(portableName) ? portableName : "cortex-project"}.ctx`;
}

export async function writeCortexProjectArchive(
  directoryPath: string,
  destination: Writable,
  workflow?: AgentWorkflowConfiguration | null
): Promise<void> {
  const files: Array<{ relativePath: string; content: Buffer }> = [];
  const directories: string[] = [];
  let totalBytes = 0;
  let entryCount = 0;
  const root = path.resolve(directoryPath);
  if (!(await lstat(root)).isDirectory()) {
    throw new ValidationError("The exported project must be a regular directory.");
  }

  async function snapshot(directory: string, prefix = ""): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    entries.sort((first, second) => first.name.localeCompare(second.name));
    for (const entry of entries) {
      const relativePath = prefix + entry.name;
      if (relativePath.toLowerCase() === projectWorkflowArchivePath && workflow !== undefined) continue;
      if (isExcludedProjectPath(relativePath)) continue;
      if (!isPortableProjectPath(relativePath)) {
        throw new ValidationError(`The exported path "${relativePath}" is not portable.`);
      }
      const fullPath = path.join(directory, entry.name);
      const stats = await lstat(fullPath);
      if (stats.isSymbolicLink() || (!stats.isDirectory() && !stats.isFile())) {
        throw new ValidationError(`The exported path "${relativePath}" must not be a symbolic link or special file.`);
      }
      entryCount += 1;
      if (entryCount > maximumProjectFiles * 2) {
        throw new ValidationError("The project contains too many archive entries.");
      }
      if (stats.isDirectory()) {
        directories.push(`${relativePath}/`);
        await snapshot(fullPath, `${relativePath}/`);
        continue;
      }
      if (files.length >= maximumProjectFiles) {
        throw new ValidationError("The project exceeds the 2,000-file limit.");
      }
      if (stats.size > maximumFileBytes) {
        throw new ValidationError(`The file "${relativePath}" exceeds the 20 MB limit.`);
      }
      if (totalBytes + stats.size > maximumProjectBytes) {
        throw new ValidationError("The project exceeds the 100 MB limit.");
      }
      const handle = await open(fullPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      const chunks: Buffer[] = [];
      let fileBytes = 0;
      try {
        if (!(await handle.stat()).isFile()) {
          throw new ValidationError(`The exported path "${relativePath}" must be a regular file.`);
        }
        for await (const chunk of handle.createReadStream({ autoClose: false })) {
          const content = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
          fileBytes += content.byteLength;
          totalBytes += content.byteLength;
          if (fileBytes > maximumFileBytes || totalBytes > maximumProjectBytes) {
            throw new ValidationError("The project grew beyond its export size limit.");
          }
          chunks.push(content);
        }
      } finally {
        await handle.close();
      }
      files.push({ relativePath, content: Buffer.concat(chunks, fileBytes) });
    }
  }

  await snapshot(root);
  if (workflow) {
    const portableWorkflow = canonicalizeArchivedWorkflow(files, workflow);
    if (portableWorkflow) files.push({ relativePath: projectWorkflowArchivePath,
      content: Buffer.from(JSON.stringify({ version: 1, workflow: portableWorkflow }), "utf8") });
  }
  try {
    assertProjectFileManifest(files.map((file) => ({
      relativePath: file.relativePath, size: file.content.byteLength
    })));
  } catch (error) {
    throw new ValidationError((error as Error).message);
  }

  // Complete and validate the ZIP before emitting HTTP bytes. Compressed-size
  // errors therefore remain ordinary API errors instead of partial downloads.
  const archive = new ZipArchive({ zlib: { level: 9 } });
  archive.on("warning", (error: ArchiverError) => archive.destroy(error));
  for (const directory of directories) archive.append("", { name: directory });
  for (const file of files) archive.append(file.content, { name: file.relativePath });
  const chunks: Buffer[] = [];
  let archiveBytes = 0;
  const bufferDestination = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      archiveBytes += chunk.byteLength;
      if (archiveBytes > maximumProjectBytes) {
        callback(new ValidationError("The Cortex archive exceeds the 100 MB compressed-size limit."));
        return;
      }
      chunks.push(Buffer.from(chunk));
      callback();
    }
  });
  try {
    await Promise.all([pipeline(archive, bufferDestination), archive.finalize()]);
  } catch (error) {
    archive.abort();
    throw error;
  }
  await pipeline(Readable.from(chunks), destination);
}
