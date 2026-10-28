import { execFile, spawn } from "node:child_process";
import type { AgentExecutionOptions } from "./AgentProvider.ts";

/** Keep structured stdout available to the provider when the CLI exits in error. */
export class CliAgentProcessError extends Error {
  constructor(readonly output: string, diagnostics: string, code: number | string | null) {
    super(`The agent engine exited (${code}). ${diagnostics.trim()}`.trim());
    this.name = "CliAgentProcessError";
  }
}

export abstract class CliAgentProvider {
  constructor(protected readonly workingDirectory: string) {}

  protected async runCommand(
    command: string,
    args: string[],
    timeout?: number,
    workingDirectory = this.workingDirectory,
    input?: string,
    options: Pick<AgentExecutionOptions, "signal" | "onProgress"> = {}
  ): Promise<string> {
    options.signal?.throwIfAborted();
    return new Promise((resolve, reject) => {
      let interruption: Error | undefined;
      let forceKillTimer: NodeJS.Timeout | undefined;
      let output = "";
      let diagnostics = "";
      let outputBytes = 0;
      const child = spawn(command, args, {
        cwd: workingDirectory,
        detached: process.platform !== "win32",
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"]
      });
      const interrupt = (reason: Error): void => {
        if (interruption) return;
        interruption = reason;
        if (child.pid === undefined) return;
        // Stop tools launched by this CLI as well as the CLI itself.
        if (process.platform === "win32") {
          execFile("taskkill", ["/PID", String(child.pid), "/T", "/F"], {
            windowsHide: true
          }, () => { child.kill(); });
        } else {
          const processGroup = -child.pid;
          try { process.kill(processGroup, "SIGTERM"); } catch { child.kill(); }
          forceKillTimer = setTimeout(() => {
            try { process.kill(processGroup, "SIGKILL"); } catch { /* Already exited. */ }
          }, 1_000);
          // Keep escalation alive even if the CLI exits before its tools.
        }
      };
      const onAbort = (): void => interrupt(
        new DOMException("The execution was cancelled.", "AbortError")
      );
      // Agent runs have no deadline. Only short operational probes opt into one.
      const timer = timeout === undefined ? undefined : setTimeout(() => interrupt(new Error(
        `The agent engine timed out after ${Math.round(timeout / 1000)} seconds.`
      )), timeout);
      timer?.unref();
      options.signal?.addEventListener("abort", onAbort, { once: true });
      if (options.signal?.aborted) onAbort();
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        if (interruption) return;
        outputBytes += Buffer.byteLength(chunk);
        if (outputBytes > 10 * 1024 * 1024) {
          interrupt(new Error("The agent response exceeds the 10 MB limit."));
          return;
        }
        output += chunk;
        options.onProgress?.(chunk);
      });
      child.stderr.setEncoding("utf8");
      child.stderr.on("data", (chunk: string) => {
        diagnostics = (diagnostics + chunk).slice(-8_000);
      });
      child.once("error", (error) => { interruption ??= error; });
      child.once("close", (code, signal) => {
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", onAbort);
        if (interruption) reject(interruption);
        else if (code !== 0) reject(new CliAgentProcessError(output, diagnostics, code ?? signal));
        else resolve(output.trim());
      });
      child.stdin.on("error", () => { /* Process completion reports failures. */ });
      child.stdin.end(input);
    });
  }

  protected async commandSucceeds(command: string, args: string[]): Promise<boolean> {
    try {
      await this.runCommand(command, args, 10_000);
      return true;
    } catch {
      return false;
    }
  }
}
