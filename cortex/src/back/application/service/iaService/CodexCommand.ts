import { existsSync } from "node:fs";
import path from "node:path";

export interface CodexCommand { command: string; args: string[] }

/** Shared by execution and discovery so both use the same installed CLI. */
export function resolveCodexCommand(): CodexCommand {
  const script = process.env.APPDATA
    ? path.join(process.env.APPDATA, "npm/node_modules/@openai/codex/bin/codex.js") : "";
  return process.platform === "win32" && script && existsSync(script)
    ? { command: process.execPath, args: [script] }
    : { command: "codex", args: [] };
}
