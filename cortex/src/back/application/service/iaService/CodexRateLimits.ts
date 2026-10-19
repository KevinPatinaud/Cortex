import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";

interface CodexCommand { command: string; args: string[] }

function codexCommand(): CodexCommand {
  const script = process.env.APPDATA
    ? path.join(process.env.APPDATA, "npm/node_modules/@openai/codex/bin/codex.js") : "";
  return process.platform === "win32" && script && existsSync(script)
    ? { command: process.execPath, args: [script] }
    : { command: "codex", args: [] };
}

/** Read the server's own Codex account. No inference turn or token file is read. */
export function readCodexRateLimits(
  workingDirectory: string,
  command: CodexCommand = codexCommand(),
  timeoutMs = 15_000
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const child = spawn(command.command, [...command.args, "app-server"], {
      cwd: workingDirectory, stdio: ["pipe", "pipe", "pipe"], windowsHide: true
    });
    const lines = createInterface({ input: child.stdout });
    let settled = false;
    const finish = (error?: Error, result?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      lines.close();
      child.stdin.end();
      child.kill();
      if (error) reject(error);
      else resolve(result);
    };
    const timer = setTimeout(() => finish(new Error("Codex quota request timed out.")), timeoutMs);
    child.once("error", () => finish(new Error("Codex CLI is unavailable.")));
    child.once("exit", () => finish(new Error("Codex closed before returning account quotas.")));
    child.stdin.on("error", () => finish(new Error("Unable to query Codex account quotas.")));
    // Drain diagnostics, but never return CLI output that could contain credentials.
    child.stderr.resume();
    const send = (message: object) => child.stdin.write(`${JSON.stringify(message)}\n`);
    lines.on("line", (line) => {
      let message: Record<string, unknown>;
      try { message = JSON.parse(line); } catch { return; }
      if (!message || typeof message !== "object") return;
      if (message.id !== 1 && message.id !== 2) return;
      if (message.error) {
        finish(new Error("Codex account quotas are unavailable. Check the server's Codex login and CLI version."));
      } else if (message.id === 1) {
        send({ method: "initialized", params: {} });
        send({ id: 2, method: "account/rateLimits/read", params: {} });
      } else {
        finish(undefined, message.result);
      }
    });
    send({ id: 1, method: "initialize", params: {
      clientInfo: { name: "cortex_quota", title: "Cortex", version: "1.0.0" }
    } });
  });
}
