/** Real Codex/Cortex comparison on disposable repositories. Never runs an existing project workflow. */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import assert from "node:assert/strict";
import { CodexAgentProvider } from "../src/back/application/service/iaService/providers/CodexAgentProvider.ts";
import { AgentService } from "../src/back/application/service/iaService/AgentService.ts";
import { AgentConfigurationService } from "../src/back/application/service/iaService/AgentConfigurationService.ts";
import { CodexModelService } from "../src/back/application/service/iaService/CodexModelService.ts";
import { CodexQuotaService } from "../src/back/application/service/iaService/CodexQuotaService.ts";
import { readCodexRateLimits } from "../src/back/application/service/iaService/CodexRateLimits.ts";
import { ProjectService } from "../src/back/application/service/projectService/ProjectService.ts";
import { DirectoryPickerService } from "../src/back/application/service/projectService/DirectoryPickerService.ts";
import { ProjectUseCase } from "../src/back/application/usecase/ProjectUseCase.ts";
import { AgentUseCase } from "../src/back/application/usecase/AgentUseCase.ts";
import { ExecutionQualityService } from "../src/back/application/service/executionQuality/ExecutionQualityService.ts";
import { DEFAULT_EXECUTION_POLICY } from "../src/shared/ExecutionQuality.ts";
import type { AgentExecutionOptions } from "../src/back/application/service/iaService/AgentProvider.ts";
import { WorkflowAuditService } from "../src/back/application/service/workflowAudit/WorkflowAuditService.ts";
import { SqliteWorkflowAuditRepository } from "../src/back/infrastructure/audit/SqliteWorkflowAuditRepository.ts";

const execute = promisify(execFile);
const app = process.cwd();
const option = (name: string, fallback: string) => process.argv.includes(name) ? process.argv[process.argv.indexOf(name) + 1] : fallback;
const repeats = Number(option("--repeats", "2"));
if (!Number.isSafeInteger(repeats) || repeats < 1 || repeats > 5) throw new Error("--repeats must be between 1 and 5");
const root = await mkdtemp(path.join(os.tmpdir(), "cortex-quality-benchmark-"));
const output = path.resolve(option("--output", path.join(root, "results.json")));
const catalog = new CodexModelService(app);
const available = await catalog.getCatalog();
if (!available.available) throw new Error(available.error ?? "Codex unavailable");
const model = option("--model", available.defaultModel ?? "");
const effort = option("--effort", "xhigh");
const quota = new CodexQuotaService(path.join(app, "config.json"), () => readCodexRateLimits(app));
const boundary = "Benchmark fixture only. Work exclusively in this repository. No network, credentials, messages, deployment or edits outside it. Complete the requested result and verify it. Do not delegate. Preserve source data. Record any remaining work honestly.";

type Task = { id: string; files: Record<string, string>; prompt: string; verify: (directory: string) => Promise<void> };
const tasks: Task[] = [
  { id: "code", files: { "orders.mjs": "export function summarizeOrders(orders) { return { count: orders.length, totalCents: 0, meanCents: 0, ids: [] }; }\n" },
    prompt: "Fix summarizeOrders(orders) in orders.mjs. Ignore cancelled orders before deduplication. For active orders, id must be a non-empty string and amountCents a non-negative integer; invalid active orders throw TypeError. Deduplicate by exact id, keeping the first active record. Return {count,totalCents,meanCents,ids}; ids retains input order, meanCents is Math.round(totalCents/count), or 0 when empty. Do not mutate any inputs. Export the function and verify edge cases.",
    verify: async directory => {
      const { summarizeOrders: fn } = await import(pathToFileURL(path.join(directory, "orders.mjs")).href);
      assert.deepEqual(fn([]), { count: 0, totalCents: 0, meanCents: 0, ids: [] });
      const input = [{ id: "a", amountCents: 1, cancelled: true }, { id: "a", amountCents: 10 }, { id: "a", amountCents: 99 }, { id: "b", amountCents: 5 }, { id: "z", amountCents: -1, cancelled: true }];
      const before = JSON.stringify(input);
      assert.deepEqual(fn(input), { count: 2, totalCents: 15, meanCents: 8, ids: ["a", "b"] });
      assert.equal(JSON.stringify(input), before);
      assert.throws(() => fn([{ id: "", amountCents: 1 }]), TypeError);
      assert.throws(() => fn([{ id: "a", amountCents: -1 }]), TypeError);
      assert.throws(() => fn([{ id: "a", amountCents: 1.5 }]), TypeError);
    } },
  { id: "evidence", files: {
    "release.json": JSON.stringify({ active: { id: "r2", commit: "abc222" }, checks: { desktop: "passed", mobile: "not_run" } }),
    "old-report.md": "Release r1 at commit abc111 was fully verified last week. This is historical and does not establish checks on r2.\n",
    "request.md": "Deployment r2 is active. Read the authoritative current release state, distinguish history from current proof, and list remaining checks.\n"
  }, prompt: "Read release.json, request.md and old-report.md. Write decision.json with exactly {release,commit,ready,missingChecks,sources}. ready means all current desktop/mobile checks passed, not just deployed. missingChecks and sources are arrays of strings. Cite source filenames and preserve the input files. Do not infer an unperformed check from a prior release's report.",
    verify: async directory => {
      const r = JSON.parse(await readFile(path.join(directory, "decision.json"), "utf8"));
      assert.equal(r.release, "r2"); assert.equal(r.commit, "abc222"); assert.equal(r.ready, false);
      assert.deepEqual(r.missingChecks, ["mobile"]); assert.ok(r.sources.includes("release.json"));
      assert.deepEqual(JSON.parse(await readFile(path.join(directory, "release.json"), "utf8")).active, { id: "r2", commit: "abc222" });
    } }
];

class MeasuredProvider extends CodexAgentProvider {
  usage: Array<Record<string, unknown>> = [];
  protected override async runCommand(command: string, args: string[], timeout?: number, directory?: string,
    input?: string, options: Pick<AgentExecutionOptions, "signal" | "onProgress"> = {}): Promise<string> {
    const output = await super.runCommand(command, args, timeout, directory, input, options);
    for (const line of output.split(/\r?\n/)) {
      try { const event = JSON.parse(line); if (event.type === "turn.completed" && event.usage) this.usage.push(event.usage); } catch { /* diagnostics */ }
    }
    return output;
  }
}
const results: Array<Record<string, unknown>> = [];
const report = async () => {
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, JSON.stringify({ version: 1, createdAt: new Date().toISOString(), model, effort,
    cliVersion: available.cliVersion, repeats, fixtureRoot: root,
    limitations: "Small deterministic sample; functional correctness only, no visual or statistical quality claim. Both routes use identical fixture inputs, model and effort. Cortex adds its structured quality/continuity contract. Quota policy is preserved.", results }, null, 2), { mode: 0o600 });
};
for (let repetition = 0; repetition < repeats; repetition++) for (const task of tasks) {
  // Alternate route order to reduce a consistent ordering advantage.
  for (const route of repetition % 2 ? ["cortex", "direct"] : ["direct", "cortex"]) {
    await quota.assertMayStart();
    const directory = path.join(root, `${task.id}-${repetition + 1}-${route}`);
    const workspace = path.join(directory, "workspace");
    await mkdir(workspace, { recursive: true });
    for (const [file, content] of Object.entries({ ...task.files, "AGENTS.md": boundary })) await writeFile(path.join(workspace, file), content);
    await execute("git", ["init", "--quiet", workspace]);
    const config = path.join(directory, "config.json");
    const provider = new MeasuredProvider(workspace);
    const service = new AgentService([provider], new AgentConfigurationService(config), undefined, undefined, catalog);
    const started = Date.now(); let error: string | undefined; let profile: unknown;
    const storage = new SqliteWorkflowAuditRepository(path.join(directory, "audit.sqlite"));
    try {
      if (route === "direct") {
        const response = await service.execute("codex", task.prompt, { model, reasoningEffort: effort, persistSession: true, workingDirectory: workspace });
        profile = response.profile;
        await writeFile(path.join(directory, "answer.txt"), response.answer, { mode: 0o600 });
      } else {
        const projects = new ProjectService(config, path.join(directory, "projects"));
        const { project } = await projects.createProject({ parentDirectory: directory, name: "Fixture", engine: "codex", instructions: "",
          agents: [{ name: "Fixture worker", description: "Isolated quality fixture", prompt: task.prompt, model, reasoningEffort: effort }] });
        const quality = new ExecutionQualityService(config, path.join(directory, "quality"));
        await quality.savePolicy(project.id, { ...DEFAULT_EXECUTION_POLICY, workspaceDirectory: workspace, defaultModel: model, defaultReasoningEffort: effort });
        const runner = new AgentUseCase(service, new ProjectUseCase(projects, new DirectoryPickerService(), service),
          new WorkflowAuditService(storage), {}, undefined, quota, undefined, quality);
        await runner.runWorkflow(project.id);
        const id = storage.listRuns(project.id, 1, 0).items[0].id;
        profile = storage.getRun(project.id, id)?.executions[0].profile;
      }
      await task.verify(workspace);
    } catch (e) { error = e instanceof Error ? e.message : String(e); }
    finally { storage.close(); }
    const row = { task: task.id, repetition: repetition + 1, route, passed: !error, durationMs: Date.now() - started,
      usage: provider.usage, profile, ...(error ? { error } : {}) };
    results.push(row); await report();
    process.stdout.write(JSON.stringify(row) + "\n");
  }
}
process.stdout.write(`REPORT ${output}\n`);
if (results.some(row => !row.passed)) process.exitCode = 1;
