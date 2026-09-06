import { chmod, copyFile, lstat, mkdir, mkdtemp, rm, rmdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { isPortableProjectPath } from "../../../../shared/ProjectArchivePolicy.ts";
import { renameWithRetry } from "../configuration/renameWithRetry.ts";

export interface ProjectFileChange {
  relativePath: string;
  content: string | Buffer | null;
}

/** Removes only a direct, explicitly owned child of the expected parent. */
export async function removeOwnedDirectory(directory: string, parent: string): Promise<void> {
  const resolved = path.resolve(directory);
  if (path.dirname(resolved) !== path.resolve(parent)) {
    throw new Error("Refusing to remove a directory outside the transaction parent.");
  }
  await rm(resolved, { recursive: true, force: true });
}

/** Stages every change before touching project files. Backups and a manifest are
 * retained if rollback fails, or the process stops before the operation completes.
 */
export async function withProjectFileTransaction<T>(
  projectDirectory: string,
  changes: ProjectFileChange[],
  finish: (renameProject: (destination: string) => Promise<void>) => Promise<T>
): Promise<T> {
  const root = path.resolve(projectDirectory);
  const parent = path.dirname(root);
  const targets = new Set<string>();
  // Validate all destinations (including links in parent directories) first.
  for (const change of changes) {
    const key = change.relativePath.toLowerCase();
    if (!isPortableProjectPath(change.relativePath) || targets.has(key)) {
      throw new TypeError("The project edit contains an invalid or duplicate file path.");
    }
    targets.add(key);
    let current = root;
    const rootStats = await lstat(root);
    if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
      throw new TypeError("The project directory must not be a symbolic link.");
    }
    const segments = change.relativePath.split("/");
    for (let index = 0; index < segments.length; index += 1) {
      current = path.join(current, segments[index]);
      const stats = await lstat(current).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
      if (stats && (stats.isSymbolicLink() ||
        (index < segments.length - 1 ? !stats.isDirectory() : !stats.isFile()))) {
        throw new TypeError(`The edited path "${change.relativePath}" must be a regular file.`);
      }
    }
  }

  const staging = await mkdtemp(path.join(parent, ".cortex-edit-"));
  const backups: Array<{ relativePath: string; backup: string | null }> = [];
  const applied: number[] = [];
  const createdDirectories: string[] = [];
  let activeRoot = root;
  let mayCleanup = true;
  try {
    for (let index = 0; index < changes.length; index += 1) {
      const change = changes[index];
      const source = path.join(root, ...change.relativePath.split("/"));
      const backup = `backup-${index}`;
      let existed = true;
      await copyFile(source, path.join(staging, backup)).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") existed = false;
        else throw error;
      });
      backups.push({ relativePath: change.relativePath, backup: existed ? backup : null });
      if (change.content !== null) {
        await writeFile(path.join(staging, `next-${index}`), change.content);
        if (existed) {
          await chmod(path.join(staging, `next-${index}`), (await lstat(source)).mode);
        }
      }
    }
    await writeFile(path.join(staging, "recovery.json"), JSON.stringify({
      projectDirectory: root,
      files: backups,
      instructions: "Restore each backup to its relativePath; remove destinations whose backup is null."
    }, null, 2));

    for (let index = 0; index < changes.length; index += 1) {
      const change = changes[index];
      const destination = path.join(root, ...change.relativePath.split("/"));
      const missing: string[] = [];
      let directory = path.dirname(destination);
      while (directory !== root) {
        try { await lstat(directory); break; } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          missing.push(directory);
          directory = path.dirname(directory);
        }
      }
      for (const missingDirectory of missing.reverse()) {
        await mkdir(missingDirectory);
        createdDirectories.push(missingDirectory);
      }
      if (change.content === null) {
        await unlink(destination).catch((error: NodeJS.ErrnoException) => {
          if (error.code !== "ENOENT") throw error;
        });
      } else {
        await renameWithRetry(path.join(staging, `next-${index}`), destination);
      }
      applied.push(index);
    }

    return await finish(async (destination) => {
      if (path.dirname(path.resolve(destination)) !== parent) {
        throw new Error("The renamed project must stay in its current parent directory.");
      }
      await writeFile(path.join(staging, "recovery.json"), JSON.stringify({
        projectDirectory: root,
        renamedDirectory: destination,
        files: backups
      }, null, 2));
      await renameWithRetry(activeRoot, destination);
      activeRoot = destination;
    });
  } catch (error) {
    try {
      if (activeRoot !== root) await renameWithRetry(activeRoot, root);
      for (const index of applied.reverse()) {
        const backup = backups[index];
        const destination = path.join(root, ...backup.relativePath.split("/"));
        if (backup.backup) {
          await copyFile(path.join(staging, backup.backup), destination);
        } else {
          await unlink(destination).catch((failure: NodeJS.ErrnoException) => {
            if (failure.code !== "ENOENT") throw failure;
          });
        }
      }
      for (const directory of createdDirectories.reverse()) {
        // Empty-directory removal cannot recursively delete unrelated content.
        await rmdir(directory);
      }
    } catch (rollbackError) {
      mayCleanup = false;
      throw new AggregateError([error, rollbackError],
        `The project edit failed and needs recovery from ${staging}.`);
    }
    throw error;
  } finally {
    if (mayCleanup) await removeOwnedDirectory(staging, parent);
  }
}
