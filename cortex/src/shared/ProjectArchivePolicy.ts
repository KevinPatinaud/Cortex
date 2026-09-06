export const maximumProjectFiles = 2_000;
export const maximumProjectBytes = 100 * 1024 * 1024;
export const maximumFileBytes = 20 * 1024 * 1024;

const excludedDirectories = new Set([
  ".git", "node_modules", "dist", "build", "coverage", ".next", ".ssh"
]);
const excludedFiles = new Set([
  "auth.json", "credentials.json", "credentials", "id_rsa", "id_ed25519",
  "cortex-audit.sqlite", "cortex-audit.sqlite-wal", "cortex-audit.sqlite-shm"
]);

export function isExcludedProjectPath(relativePath: string): boolean {
  const segments = relativePath.replace(/\\/g, "/").toLowerCase().split("/");
  const name = segments.at(-1) ?? "";
  return segments.some((segment) =>
    excludedDirectories.has(segment) || segment.startsWith(".cortex-")
  ) || excludedFiles.has(name) || /\.(?:pem|key|p12|pfx)$/.test(name) ||
    ((name === ".env" || name.startsWith(".env.")) && name !== ".env.example");
}

export function isPortableProjectPath(relativePath: string): boolean {
  return relativePath.length > 0 && !/[<>:"\\|?*\u0000-\u001F]/.test(relativePath) &&
    relativePath.split("/").every((segment) =>
      segment.length > 0 && segment !== "." && segment !== ".." &&
      !/[. ]$/.test(segment) &&
      !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(segment)
    );
}

export function assertPortableProjectName(name: string): void {
  if (name.length > 120 || name.includes("/") || !isPortableProjectPath(name)) {
    throw new TypeError("The project name contains invalid characters.");
  }
}

export function assertProjectFileManifest(
  files: Array<{ relativePath: string; size: number }>
): void {
  if (!files.length || files.length > maximumProjectFiles) {
    throw new TypeError(`The project must contain between 1 and ${maximumProjectFiles} files.`);
  }
  const paths = new Set<string>();
  let total = 0;
  for (const { relativePath, size } of files) {
    if (!isPortableProjectPath(relativePath)) {
      throw new TypeError(`The uploaded path "${relativePath}" is invalid.`);
    }
    if (isExcludedProjectPath(relativePath)) {
      throw new TypeError(`The sensitive or generated file "${relativePath}" cannot be imported.`);
    }
    const key = relativePath.toLowerCase();
    if (paths.has(key)) throw new TypeError(`The uploaded path "${relativePath}" is duplicated.`);
    if (!Number.isSafeInteger(size) || size < 0 || size > maximumFileBytes) {
      throw new TypeError(`The file "${relativePath}" exceeds the 20 MB limit.`);
    }
    paths.add(key);
    total += size;
  }
  for (const relativePath of paths) {
    const segments = relativePath.split("/");
    for (let index = 1; index < segments.length; index += 1) {
      if (paths.has(segments.slice(0, index).join("/"))) {
        throw new TypeError(`The uploaded path "${relativePath}" conflicts with another file.`);
      }
    }
  }
  if (total > maximumProjectBytes) throw new TypeError("The project exceeds the 100 MB limit.");
  if (!paths.has("agents.md") && !paths.has("claude.md")) {
    throw new TypeError("The selected folder must contain AGENTS.md or CLAUDE.md at its root.");
  }
}
