import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { resolveCodexCommand, type CodexCommand } from "./CodexCommand.ts";

export interface CodexAppServerSession {
  initialization: unknown;
  request(method: string, params: object): Promise<unknown>;
}

/** A short-lived, read-only RPC session. No thread or inference turn is started. */
export function withCodexAppServer<T>(
  workingDirectory: string,
  operation: (session: CodexAppServerSession) => Promise<T>,
  command: CodexCommand = resolveCodexCommand(),
  timeoutMs = 15_000
): Promise<T> {
  return new Promise((resolve, reject) => {
    const child = spawn(command.command, [...command.args, "app-server"], {
      cwd: workingDirectory, stdio: ["pipe", "pipe", "pipe"], windowsHide: true
    });
    const lines = createInterface({ input: child.stdout });
    const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
    let sequence = 0, settled = false;
    const finish = (error: Error | null, result?: T) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      lines.close();
      child.stdin.end();
      child.kill();
      for (const request of pending.values()) request.reject(error ?? new Error("Codex session closed."));
      pending.clear();
      if (error) reject(error);
      else resolve(result as T);
    };
    const timer = setTimeout(() => finish(new Error("Codex request timed out.")), timeoutMs);
    child.once("error", () => finish(new Error("Codex CLI is unavailable.")));
    child.once("exit", () => finish(new Error("Codex closed before completing the request.")));
    child.stdin.on("error", () => finish(new Error("Unable to query Codex.")));
    // Drain diagnostics without disclosing tokens, paths, or CLI stderr to clients.
    child.stderr.resume();
    const send = (message: object) => child.stdin.write(`${JSON.stringify(message)}\n`);
    const request = (method: string, params: object): Promise<unknown> => new Promise((resolve, reject) => {
      if (settled) { reject(new Error("Codex session closed.")); return; }
      const id = ++sequence;
      pending.set(id, { resolve, reject });
      send({ id, method, params });
    });
    lines.on("line", (line) => {
      let message: Record<string, unknown>;
      try { message = JSON.parse(line); } catch { return; }
      if (!message || typeof message !== "object" || typeof message.id !== "number") return;
      const response = pending.get(message.id);
      if (!response) return;
      pending.delete(message.id);
      if (message.error) response.reject(new Error("Codex rejected the request. Check the server's Codex connection and CLI version."));
      else response.resolve(message.result);
    });
    void (async () => {
      const initialization = await request("initialize", { clientInfo: { name: "cortex", title: "Cortex", version: "1.0.0" } });
      send({ method: "initialized", params: {} });
      return operation({ initialization, request });
    })().then(result => finish(null, result), error => finish(error instanceof Error ? error : new Error("Codex request failed.")));
  });
}
