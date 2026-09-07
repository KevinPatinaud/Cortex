// Run from the repository root: node --import tsx artifacts/audit-bugs-2026-09-06/engine-probe.mts
// All inference traffic goes to a temporary loopback HTTP server. No auth file
// or user config is copied. The user's model cache is only read, never changed.
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { spawn } from "node:child_process";
import { CliAgentProvider } from "../../src/back/application/service/iaService/CliAgentProvider.ts";
import { AgentService } from "../../src/back/application/service/iaService/AgentService.ts";

class DiagnosticProbe extends CliAgentProvider {
  run(command: string, args: string[]) { return this.runCommand(command, args); }
}
try {
  await new DiagnosticProbe(process.cwd()).run(process.execPath, ["-e",
    "console.log(JSON.stringify({type:'turn.failed',error:{message:'ACTUAL_FAILURE_SENTINEL'}}));process.stderr.write('CACHE_WARNING_SENTINEL');process.exitCode=1"]);
} catch (error) {
  const message = (error as Error).message;
  console.log(JSON.stringify({ test: "lost-json-error", message,
    actualFailureRetained: message.includes("ACTUAL_FAILURE_SENTINEL") }));
}

let available = true;
let availabilityChecks = 0;
const provider = {
  engine: "codex" as const, label: "Codex",
  async isAvailable() { availabilityChecks++; return available; },
  async ask() { return { answer: "simulated" }; }
};
const service = new AgentService([provider], {} as never);
const initialStatus = await service.getStatus();
available = false;
const unavailableStatus = await service.getStatus();
console.log(JSON.stringify({ test: "cached-engine-status", initialStatus,
  unavailableStatus, availabilityChecks }));

if (process.platform !== "win32" || !process.env.APPDATA) {
  console.log("The remaining probe reproduces Cortex's Windows npm Codex selection.");
  process.exit(0);
}
const npmScript = path.join(process.env.APPDATA, "npm/node_modules/@openai/codex/bin/codex.js");
await fs.access(npmScript);
const cachePath = path.join(process.env.CODEX_HOME || path.join(os.homedir(), ".codex"), "models_cache.json");
const cacheText = await fs.readFile(cachePath, "utf8");
const cache = JSON.parse(cacheText);
const npmPackage = JSON.parse(await fs.readFile(path.resolve(npmScript, "../../package.json"), "utf8"));
console.log(JSON.stringify({ test: "installed-versions", npmVersion: npmPackage.version,
  cacheClientVersion: cache.client_version, models: cache.models.length,
  missingParallelToolCalls: cache.models.filter((model: object) => !("supports_parallel_tool_calls" in model)).length }));

const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "cortex-codex-audit-"));
const taskHome = path.join(temporaryRoot, "home");
const project = path.join(temporaryRoot, "project");
await fs.mkdir(taskHome);
await fs.mkdir(project);
let localRequests = 0;
const server = http.createServer((request, response) => {
  localRequests++;
  request.resume();
  response.writeHead(400, { "Content-Type": "application/json" });
  response.end(JSON.stringify({ error: {
    message: "AUDIT_LOCAL_SENTINEL: intentionally rejected by isolated local endpoint",
    type: "invalid_request_error", code: "audit_local_rejection"
  } }));
});
await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
const port = (server.address() as { port: number }).port;
await fs.writeFile(path.join(taskHome, "config.toml"), [
  'model = "audit-local"', 'model_provider = "audit_local"',
  'approval_policy = "never"', 'sandbox_mode = "read-only"',
  '[model_providers.audit_local]', 'name = "Audit Local"',
  `base_url = "http://127.0.0.1:${port}/v1"`, 'wire_api = "responses"',
  'requires_openai_auth = false', 'request_max_retries = 0', 'stream_max_retries = 0', ""
].join("\n"));
await fs.writeFile(path.join(taskHome, "models_cache.json"), cacheText);
async function run(label: string, extra: string[] = []) {
  const args = [npmScript, "exec", "--disable", "multi_agent", "--config",
    'sandbox_mode="read-only"', "--json", "--color", "never", "--ephemeral",
    "--cd", project, ...extra, "-"];
  const child = spawn(process.execPath, args, { cwd: project,
    env: { ...process.env, CODEX_HOME: taskHome, OPENAI_API_KEY: "", CODEX_API_KEY: "", RUST_LOG: "error" },
    windowsHide: true, stdio: "pipe" });
  let stdout = "", stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  child.stdin.end("Audit local, no real model.");
  const timer = setTimeout(() => child.kill(), 20_000);
  const code = await new Promise((resolve) => child.once("close", resolve));
  clearTimeout(timer);
  const result = { label, code, stdout, stderr, localRequests };
  console.log(JSON.stringify(result));
  return result;
}
try {
  const results = [await run("ordinary-folder"),
    await run("copied-cache-local-provider", ["--skip-git-repo-check"])];
  await fs.rename(path.join(taskHome, "models_cache.json"), path.join(taskHome, "cache-audit-backup.json"));
  results.push(await run("no-cache-local-provider", ["--skip-git-repo-check"]));
  await fs.writeFile(path.join(temporaryRoot, "results.json"), JSON.stringify(results, null, 2));
  console.log(JSON.stringify({ evidenceRoot: temporaryRoot }));
} finally {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
