import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";
import type { CodexEngineUpdateStatus } from "../../../../shared/CodexEngineUpdate.ts";
import { codexRuntimeDirectory, managedCodexCommand, resolveCodexCommand, type CodexCommand } from "./CodexCommand.ts";
import { withCodexAppServer } from "./CodexAppServer.ts";

export interface CodexUpdateBackend {
  latest(): Promise<string>;
  version(command: CodexCommand): Promise<string | null>;
  install(version: string, prefix: string): Promise<void>;
  verify(command: CodexCommand): Promise<void>;
}
const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const RETRY_MS = 5 * 60 * 1000;

/** Versioned installs never overwrite binaries used by running Codex processes. */
export class CodexUpdateService {
  private value: CodexEngineUpdateStatus = { state: "idle", installedVersion: null, latestVersion: null, checkedAt: null, updatedAt: null, error: null };
  private pending: Promise<CodexEngineUpdateStatus> | null = null;
  private candidate: { version: string; command: CodexCommand } | null = null;
  private nextCheck = 0;
  private timer?: NodeJS.Timeout;
  private stopped = false;
  constructor(private readonly root = codexRuntimeDirectory(), private readonly isBusy: () => boolean = () => false,
    private readonly backend: CodexUpdateBackend = createCodexUpdateBackend(), private readonly now = Date.now) {}

  status(): CodexEngineUpdateStatus { return { ...this.value }; }
  start(): void {
    if (this.timer) return;
    this.stopped = false;
    this.timer = setInterval(() => { void this.check(); }, 30_000);
    this.timer.unref();
    void this.check();
  }
  stop(): void { this.stopped = true; clearInterval(this.timer); this.timer = undefined; }
  check(force = false): Promise<CodexEngineUpdateStatus> {
    if (this.pending) return this.pending;
    if (this.stopped || (!force && this.now() < this.nextCheck)) return Promise.resolve(this.status());
    this.pending = this.perform().catch(() => {
      this.value = { ...this.value, state: "error", error: "La mise à jour automatique de Codex a échoué. Le moteur précédent est conservé ; une nouvelle tentative aura lieu automatiquement." };
      this.nextCheck = this.now() + RETRY_MS;
      return this.status();
    }).finally(() => { this.pending = null; });
    return this.pending;
  }
  private async perform(): Promise<CodexEngineUpdateStatus> {
    if (!this.candidate) {
      this.value = { ...this.value, state: "checking", error: null };
      const latest = await this.backend.latest();
      if (!/^\d+\.\d+\.\d+$/.test(latest)) throw new Error("Invalid stable version.");
      const installed = await this.backend.version(resolveCodexCommand(this.root));
      this.value = { ...this.value, installedVersion: installed, latestVersion: latest, checkedAt: new Date(this.now()).toISOString() };
      this.nextCheck = this.now() + CHECK_INTERVAL_MS;
      if (installed && compareCodexVersions(installed, latest) >= 0) { this.value.state = "up_to_date"; return this.status(); }
      this.value.state = "installing";
      const command = managedCodexCommand(this.root, latest);
      // Reuse only a verified installation after a previous interrupted update.
      let valid = await this.backend.version(command) === latest;
      if (!valid) {
        await this.backend.install(latest, path.join(this.root, "versions", latest));
        valid = await this.backend.version(command) === latest;
      }
      if (!valid) throw new Error("Installed Codex version mismatch.");
      await this.backend.verify(command);
      this.candidate = { version: latest, command };
    }
    if (this.stopped) return this.status();
    if (this.isBusy()) {
      this.value.state = "waiting";
      this.nextCheck = this.now() + 30_000;
      return this.status();
    }
    // The pointer is the only shared mutation. A running invocation keeps its
    // captured version-specific path even if it began during this atomic swap.
    await mkdir(this.root, { recursive: true });
    const temporary = path.join(this.root, `current-${randomUUID()}.json`);
    try {
      await writeFile(temporary, JSON.stringify({ version: this.candidate!.version }), { mode: 0o600, flag: "wx" });
      if (this.stopped || this.isBusy()) { this.value.state = "waiting"; this.nextCheck = this.now() + 30_000; return this.status(); }
      await rename(temporary, path.join(this.root, "current.json"));
    } finally { await rm(temporary, { force: true }); }
    this.value = { ...this.value, state: "updated", installedVersion: this.candidate!.version, updatedAt: new Date(this.now()).toISOString(), error: null };
    this.candidate = null;
    this.nextCheck = this.now() + CHECK_INTERVAL_MS;
    return this.status();
  }
}

export function compareCodexVersions(left: string, right: string): number {
  const parse = (value: string) => value.match(/^(\d+)\.(\d+)\.(\d+)(-.+)?$/);
  const a = parse(left), b = parse(right);
  if (!a || !b) throw new Error("Invalid Codex version.");
  for (let index = 1; index <= 3; index++) { const difference = Number(a[index]) - Number(b[index]); if (difference) return difference; }
  return a[4] && !b[4] ? -1 : !a[4] && b[4] ? 1 : 0;
}

export function createCodexUpdateBackend(): CodexUpdateBackend {
  const run = (command: CodexCommand, args: string[], timeout: number) => new Promise<string>((resolve, reject) => {
    const child = execFile(command.command, [...command.args, ...args], { timeout, windowsHide: true, maxBuffer: 2 * 1024 * 1024, encoding: "utf8" }, (error, stdout) => {
      if (error) reject(new Error("Codex maintenance command failed.")); else resolve(stdout.trim());
    });
    child.stdin?.end();
  });
  return {
    async latest() {
      const response = await fetch("https://registry.npmjs.org/@openai%2fcodex/latest", { signal: AbortSignal.timeout(15_000), redirect: "error" });
      if (!response.ok) throw new Error("Codex registry unavailable.");
      const result = await response.json() as { version?: unknown };
      if (typeof result.version !== "string") throw new Error("Invalid registry response.");
      return result.version;
    },
    async version(command) { try { return (await run(command, ["--version"], 10_000)).match(/^codex-cli (\d+\.\d+\.\d+(?:-[\w.-]+)?)/)?.[1] ?? null; } catch { return null; } },
    async install(version, prefix) {
      const candidates = [path.join(path.dirname(process.execPath), "node_modules", "npm", "bin", "npm-cli.js"),
        path.resolve(path.dirname(process.execPath), "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"),
        ...(process.env.npm_execpath?.endsWith("npm-cli.js") ? [process.env.npm_execpath] : []),
        ...(process.env.APPDATA ? [path.join(process.env.APPDATA, "npm", "node_modules", "npm", "bin", "npm-cli.js")] : []),
        "/usr/share/nodejs/npm/bin/npm-cli.js", "/usr/local/lib/node_modules/npm/bin/npm-cli.js", "/usr/lib/node_modules/npm/bin/npm-cli.js"];
      const npm = candidates.find(file => existsSync(file));
      if (!npm) throw new Error("npm CLI unavailable.");
      await run({ command: process.execPath, args: [npm] }, ["install", "--prefix", prefix, "--no-audit", "--no-fund", "--package-lock=false", "--save-exact", "--registry=https://registry.npmjs.org", `@openai/codex@${version}`], 300_000);
    },
    async verify(command) {
      for (const args of [["exec", "--help"], ["exec", "resume", "--help"]]) {
        const help = await run(command, args, 10_000);
        if (["--json", "--model", "--image", "--output-schema", "--skip-git-repo-check"].some(flag => !help.includes(flag)) ||
          (args.length === 2 && (!help.includes("--approve-for-me") || !help.includes("--dangerously-bypass-approvals-and-sandbox")))) throw new Error("Updated Codex CLI is incompatible with Cortex.");
      }
      await withCodexAppServer(process.cwd(), async session => {
        const result = await session.request("model/list", { limit: 100, includeHidden: false }) as { data?: unknown };
        if (!Array.isArray(result?.data) || !result.data.length) throw new Error("Invalid updated Codex catalog.");
      }, command);
    }
  };
}
