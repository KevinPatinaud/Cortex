import { lstat, open, readdir, readlink } from "node:fs/promises";
import path from "node:path";
import { ValidationError } from "../../error/ValidationError.ts";
import type { ProjectDirectoryContent, ProjectFileContent } from "./ProjectService.ts";

const ignoredDirectories = new Set([".git", "node_modules", "dist", "build", "coverage", "playwright-report", "test-results"]);
type Budget = { files: number; bytes: number; maxBytes: number; maxFileBytes: number };

function directory(root: string, relativePath: string): ProjectDirectoryContent {
  return { type: "directory", name: path.basename(relativePath || root), relativePath, children: [] };
}

async function file(root: string, relativePath: string, budget: Budget): Promise<ProjectFileContent> {
  const location = path.join(root, relativePath);
  const size = (await lstat(location)).size;
  if (++budget.files > 2000 || size > budget.maxFileBytes || budget.bytes + size > budget.maxBytes) {
    throw new ValidationError("Le contenu du projet dépasse la limite de lecture (2 000 fichiers et taille bornée). Utilisez un dossier de projet plus ciblé.");
  }
  // Bound the read itself as well as the initial stat, including concurrently growing files.
  const handle = await open(location, "r");
  let buffer: Buffer;
  try {
    const limit = Math.min(budget.maxFileBytes, budget.maxBytes - budget.bytes);
    const chunks: Buffer[] = [];
    let read = 0;
    while (true) {
      const chunk = Buffer.alloc(Math.min(64 * 1024, limit + 1 - read));
      const { bytesRead } = await handle.read(chunk);
      if (!bytesRead) break;
      read += bytesRead;
      if (read > limit) throw new ValidationError("Un fichier du projet dépasse la limite de lecture.");
      chunks.push(chunk.subarray(0, bytesRead));
    }
    buffer = Buffer.concat(chunks);
  } finally { await handle.close(); }
  budget.bytes += buffer.byteLength;
  const sample = buffer.subarray(0, 8000);
  let controls = 0;
  for (const byte of sample) if (byte === 0 || (byte < 32 && byte !== 9 && byte !== 10 && byte !== 13)) controls++;
  const encoding = sample.includes(0) || controls / Math.max(1, sample.length) > 0.1 ? "base64" : "utf8";
  return { type: "file", name: path.basename(relativePath), relativePath, size: buffer.byteLength, encoding, content: buffer.toString(encoding) };
}

async function optionalStat(location: string) {
  try { return await lstat(location); }
  catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error; }
}

/** Read only native agent definitions; never traverse project outputs or dependencies. */
export async function readAgentProjectDefinition(root: string): Promise<ProjectDirectoryContent> {
  const result = directory(root, "");
  const budget: Budget = { files: 0, bytes: 0, maxBytes: 8 * 1024 * 1024, maxFileBytes: 2 * 1024 * 1024 };
  for (const name of ["AGENTS.md", "CLAUDE.md"]) {
    if ((await optionalStat(path.join(root, name)))?.isFile()) result.children.push(await file(root, name, budget));
  }
  for (const name of [".codex", ".claude", ".github"]) {
    if (!(await optionalStat(path.join(root, name)))?.isDirectory()) continue;
    const config = directory(root, name);
    result.children.push(config);
    if (name === ".codex" && (await optionalStat(path.join(root, name, "config.toml")))?.isFile()) {
      config.children.push(await file(root, `${name}/config.toml`, budget));
    }
    const agentsPath = `${name}/agents`;
    if (!(await optionalStat(path.join(root, agentsPath)))?.isDirectory()) continue;
    const agents = directory(root, agentsPath);
    config.children.push(agents);
    const entries = await readdir(path.join(root, agentsPath), { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const extension = name === ".codex" ? /\.toml$/i : name === ".github" ? /\.agent\.md$/i : /\.md$/i;
      if (entry.isFile() && extension.test(entry.name)) agents.children.push(await file(root, `${agentsPath}/${entry.name}`, budget));
    }
  }
  return result;
}

/** Explicit file inspection is bounded and excludes generated dependency/build trees. */
export async function readProjectTree(root: string): Promise<ProjectDirectoryContent> {
  const budget: Budget = { files: 0, bytes: 0, maxBytes: 100 * 1024 * 1024, maxFileBytes: 20 * 1024 * 1024 };
  let entries = 0;
  async function read(relativePath: string, depth: number): Promise<ProjectDirectoryContent> {
    if (depth > 32) throw new ValidationError("L’arborescence du projet est trop profonde.");
    const result = directory(root, relativePath);
    for (const entry of (await readdir(path.join(root, relativePath), { withFileTypes: true })).sort((a,b) => a.name.localeCompare(b.name))) {
      if (++entries > 4000) throw new ValidationError("L’arborescence du projet contient trop d’éléments.");
      const child = relativePath ? `${relativePath}/${entry.name}` : entry.name;
      if (entry.isDirectory() && !ignoredDirectories.has(entry.name)) result.children.push(await read(child, depth + 1));
      else if (entry.isFile()) result.children.push(await file(root, child, budget));
      else if (entry.isSymbolicLink()) result.children.push({ type: "symbolicLink", name: entry.name, relativePath: child, target: await readlink(path.join(root, child)) });
    }
    return result;
  }
  return read("", 0);
}
