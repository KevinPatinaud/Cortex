import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface CodexCommand { command: string; args: string[] }

/** Shared by execution and discovery so both use the same installed CLI. */
export function codexRuntimeDirectory(): string {
  return path.resolve(process.env.CORTEX_CODEX_RUNTIME_DIRECTORY || fileURLToPath(new URL("../../../../../data/codex-runtime/", import.meta.url)));
}
export function managedCodexCommand(root: string, version: string): CodexCommand {
  if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("Invalid stable Codex version.");
  return { command: process.execPath, args: [path.join(path.resolve(root), "versions", version, "node_modules", "@openai", "codex", "bin", "codex.js")] };
}
export function resolveCodexCommand(root = codexRuntimeDirectory()): CodexCommand {
  try {
    const { version } = JSON.parse(readFileSync(path.join(root, "current.json"), "utf8"));
    const command = managedCodexCommand(root, version);
    if (existsSync(command.args[0])) return command;
  } catch { /* An incomplete update must not prevent the existing CLI from running. */ }
  return resolveSystemCodexCommand();
}
export function resolveSystemCodexCommand(): CodexCommand {
  const script = process.env.APPDATA
    ? path.join(process.env.APPDATA, "npm/node_modules/@openai/codex/bin/codex.js") : "";
  return process.platform === "win32" && script && existsSync(script)
    ? { command: process.execPath, args: [script] }
    : { command: "codex", args: [] };
}
