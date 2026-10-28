import assert from "node:assert/strict";
import test from "node:test";
import { access, readFile } from "node:fs/promises";
import { CodexAgentProvider } from "./CodexAgentProvider.ts";
import type { ExecutionProfile } from "../../../../../shared/ExecutionQuality.ts";
import type { AgentExecutionOptions } from "../AgentProvider.ts";
import { CliAgentProcessError } from "../CliAgentProvider.ts";

class CapturingCodexAgentProvider extends CodexAgentProvider {
  capturedArgs: string[] = [];
  capturedTimeout: number | undefined;
  capturedInput: string | undefined;
  capturedSchemaFile: string | undefined;
  capturedSchema: unknown;
  commandError: Error | undefined;

  protected override async runCommand(
    _command: string,
    args: string[],
    timeout?: number,
    _workingDirectory?: string,
    input?: string
  ): Promise<string> {
    this.capturedArgs = [...args];
    this.capturedTimeout = timeout;
    this.capturedInput = input;
    const schemaIndex = args.indexOf("--output-schema");
    if (schemaIndex >= 0) {
      this.capturedSchemaFile = args[schemaIndex + 1];
      this.capturedSchema = JSON.parse(await readFile(this.capturedSchemaFile!, "utf8"));
    }
    if (this.commandError) throw this.commandError;

    return [
      JSON.stringify({ type: "thread.started", thread_id: "session-id" }),
      JSON.stringify({
        type: "item.completed",
        item: { type: "agent_message", text: "reponse" }
      })
    ].join("\n");
  }
}

const capacityOutput = [
  { type: "thread.started", thread_id: "durable-session" },
  { type: "item.completed", item: { type: "command_execution", aggregated_output: "Selected model is at capacity. PRIVATE TOOL OUTPUT" } },
  { type: "error", message: "Selected model is at capacity. Please try a different model." },
  { type: "turn.failed", error: { message: "Selected model is at capacity. Please try a different model.", codex_error_info: "server_overloaded" } }
].map(event => JSON.stringify(event)).join("\n");

class RecoveringCodexProvider extends CodexAgentProvider {
  calls: { args: string[]; prompt?: string }[] = [];
  waits: number[] = [];
  outputs: (string | Error)[] = [];
  onWait?: () => void;
  protected override async runCommand(_command: string, args: string[], _timeout?: number, _cwd?: string,
    input?: string, options?: AgentExecutionOptions): Promise<string> {
    this.calls.push({ args: [...args], prompt: input });
    const output = this.outputs.shift()!;
    options?.onProgress?.((output instanceof CliAgentProcessError ? output.output : typeof output === "string" ? output : "") + "\n");
    if (output instanceof Error) throw output;
    return output;
  }
  protected override async waitForCapacity(milliseconds: number, signal?: AbortSignal) {
    this.waits.push(milliseconds);
    this.onWait?.();
    signal?.throwIfAborted();
  }
}

const completedOutput = [
  { type: "thread.started", thread_id: "durable-session" },
  { type: "item.completed", item: { type: "agent_message", text: "Completed remaining work" } },
  { type: "turn.completed" }
].map(event => JSON.stringify(event)).join("\n");

test("capacity resumes the same durable thread with the same model and schema instead of replaying the mission", async () => {
  const provider = new RecoveringCodexProvider(process.cwd());
  provider.outputs = [new CliAgentProcessError(capacityOutput, "Old apply_patch failure; rollout thread not found", 1), completedOutput];
  const sessions: string[] = [], progress: string[] = [];
  const result = await provider.ask("Original mission", { persistSession: true, model: "selected-model", reasoningEffort: "xhigh",
    outputSchema: { type: "object" }, onSessionId: id => sessions.push(id), onProgress: text => progress.push(text) });
  assert.equal(result.answer, "Completed remaining work");
  assert.deepEqual(provider.waits, [5000]);
  assert.deepEqual(provider.calls[1].args.slice(-2), ["durable-session", "-"]);
  assert.ok(provider.calls[1].args.includes("resume"));
  assert.ok(provider.calls[1].args.includes("selected-model"));
  assert.ok(provider.calls[1].args.includes("--output-schema"));
  assert.match(provider.calls[1].prompt!, /only the unfinished work/);
  assert.notEqual(provider.calls[1].prompt, "Original mission");
  assert.ok(sessions.includes("durable-session"));
  assert.ok(progress.some(text => text.includes("Reprise 1/2")));
  assert.ok(!progress.some(text => /PRIVATE TOOL|apply_patch|rollout/.test(text)));
});

test("capacity retries are bounded and the terminal error supersedes stale stderr", async () => {
  const provider = new RecoveringCodexProvider(process.cwd());
  provider.outputs = Array.from({ length: 3 }, () => new CliAgentProcessError(capacityOutput, "Old patch error", 1));
  await assert.rejects(provider.ask("Mission", { persistSession: true }), error => {
    assert.match((error as Error).message, /temporairement saturé/);
    assert.doesNotMatch((error as Error).message, /Old patch/);
    return true;
  });
  assert.deepEqual(provider.waits, [5000, 15000]);
  assert.equal(provider.calls.length, 3);
});

test("cancelling a capacity wait prevents a new process", async () => {
  const provider = new RecoveringCodexProvider(process.cwd());
  const controller = new AbortController();
  provider.outputs = [new CliAgentProcessError(capacityOutput, "", 1)];
  provider.onWait = () => controller.abort();
  await assert.rejects(provider.ask("Mission", { persistSession: true, signal: controller.signal }), { name: "AbortError" });
  assert.equal(provider.calls.length, 1);
});

test("never retries a non-capacity failure or replays an ephemeral business mission", async () => {
  for (const output of [capacityOutput, JSON.stringify({ type: "turn.failed", error: { message: "Invalid credentials" } })]) {
    const provider = new RecoveringCodexProvider(process.cwd());
    provider.outputs = [new CliAgentProcessError(output, "Old stderr", 1)];
    await assert.rejects(provider.ask("Mission"), /saturé|Invalid credentials/);
    assert.deepEqual(provider.waits, []);
    assert.equal(provider.calls.length, 1);
  }
});

test("a failed turn is not accepted as a successful commentary response even when the process exits zero", async () => {
  const provider = new RecoveringCodexProvider(process.cwd());
  provider.outputs = [completedOutput + '\n' + JSON.stringify({ type: "turn.failed", error: { message: "Terminal failure" } })];
  await assert.rejects(provider.ask("Mission"), /Terminal failure/);
});

test("a recovered error and tool diagnostics do not make a completed turn fail", async () => {
  const provider = new RecoveringCodexProvider(process.cwd());
  provider.outputs = [capacityOutput + '\n' + completedOutput];
  assert.equal((await provider.ask("Mission")).answer, "Completed remaining work");
  assert.deepEqual(provider.waits, []);
});

test("désactive le multi-agent interne quand Cortex lance Codex", async () => {
  const provider = new CapturingCodexAgentProvider(process.cwd());

  await provider.ask("Execute la tache", { persistSession: true });

  const disableIndex = provider.capturedArgs.indexOf("--disable");

  assert.notEqual(disableIndex, -1);
  assert.equal(provider.capturedArgs[disableIndex + 1], "multi_agent");
});

test("an existing provider resolves the active runtime for each new turn after an engine update", async () => {
  let active = "version-one.js";
  const provider = new CapturingCodexAgentProvider(process.cwd(), () => ({ command: process.execPath, args: [active] }));
  await provider.ask("First"); assert.equal(provider.capturedArgs[0], "version-one.js");
  active = "version-two.js";
  await provider.ask("Second", { sessionId: "session-id" }); assert.equal(provider.capturedArgs[0], "version-two.js");
});

test("enables bounded research/review only on explicit project policy", async () => {
  const provider = new CapturingCodexAgentProvider(process.cwd());
  await provider.ask("Review this task", { persistSession: true, delegation: "bounded" });
  assert.equal(provider.capturedArgs[provider.capturedArgs.indexOf("--enable") + 1], "multi_agent");
  assert.ok(provider.capturedArgs.includes("agents.max_threads=2"));
  assert.ok(!provider.capturedArgs.includes("--disable"));
  assert.equal(provider.capturedTimeout, undefined);
});

test("interpretation forces an ephemeral read-only session and disables shell, web, apps, MCP and delegation", async () => {
  const provider = new CapturingCodexAgentProvider(process.cwd());
  await provider.ask("Interpret only", { purpose: "interpretation", delegation: "bounded",
    configuration: { autopilot: true, allowAll: true }, profile: { declaredMcpServers: ["mail-server"], declaredApps: ["app-mail"] } as ExecutionProfile });
  const args = provider.capturedArgs;
  for (const required of ["--ephemeral", "--skip-git-repo-check", 'sandbox_mode="read-only"', "features.shell_tool=false",
    'web_search="disabled"', "apps._default.enabled=false", 'mcp_servers."mail-server".enabled=false', 'apps."app-mail".enabled=false']) assert.ok(args.includes(required), required);
  assert.ok(!args.includes("--dangerously-bypass-approvals-and-sandbox")); assert.ok(!args.includes("--enable"));
  for (const name of ["apps", "plugins", "hooks", "multi_agent_v2"]) assert.ok(args.some((arg, i) => arg === "--disable" && args[i + 1] === name));
  assert.equal(provider.capturedTimeout, undefined);
  await assert.rejects(provider.ask("Interpret", { purpose: "interpretation", sessionId: "business" }), /own session/);
});

test("passes dynamically selected model identifiers and newer reasoning efforts directly to the deployed CLI", async () => {
  const provider = new CapturingCodexAgentProvider(process.cwd());
  await provider.ask("Execute", { model: "server-discovered-model", reasoningEffort: "ultra" });
  assert.equal(provider.capturedArgs[provider.capturedArgs.indexOf("--model") + 1], "server-discovered-model");
  assert.ok(provider.capturedArgs.includes('model_reasoning_effort="ultra"'));
});

test("lance les agents sans limite de durée", async () => {
  const provider = new CapturingCodexAgentProvider(process.cwd());

  await provider.ask("Publie le journal", { persistSession: true });

  assert.equal(provider.capturedTimeout, undefined);
});

test("transmet les prompts volumineux par stdin au lieu d'un argument", async () => {
  const provider = new CapturingCodexAgentProvider(process.cwd());
  const prompt = "Article de presse.\n".repeat(20_000);

  await provider.ask(prompt, { persistSession: true });

  assert.equal(provider.capturedArgs.at(-1), "-");
  assert.equal(provider.capturedArgs.includes(prompt), false);
  assert.equal(provider.capturedInput, prompt);
});

test("transmet aussi par stdin le prompt d'une session reprise", async () => {
  const provider = new CapturingCodexAgentProvider(process.cwd());

  await provider.ask("Compile la suite du journal", {
    sessionId: "session-id"
  });

  assert.deepEqual(provider.capturedArgs.slice(-2), ["session-id", "-"]);
  assert.equal(provider.capturedInput, "Compile la suite du journal");
});

test("queued chats keep a durable session and allow initial and resumed turns outside Git", async () => {
  const provider = new CapturingCodexAgentProvider(process.cwd());
  for (const sessionId of [undefined, "chat-session"]) {
    await provider.ask("Queued chat turn", { persistSession: true, skipGitRepoCheck: true, sessionId });
    assert.ok(provider.capturedArgs.includes("--skip-git-repo-check"));
    assert.ok(!provider.capturedArgs.includes("--ephemeral"));
    assert.equal(provider.capturedArgs.includes("resume"), Boolean(sessionId));
  }
});

test("images are attached natively to both new and resumed Codex turns without modifying the user's prompt", async () => {
  const provider = new CapturingCodexAgentProvider(process.cwd());
  const images = ["C:\\Pièces jointes\\photo.png", "C:\\Pièces jointes\\deuxième image.jpg"];
  for (const sessionId of [undefined, "chat-session"]) {
    await provider.ask("Compare les images", { persistSession: true, sessionId, imagePaths: images });
    assert.deepEqual(provider.capturedArgs.flatMap((arg, index) => arg === "--image" ? [provider.capturedArgs[index + 1]] : []), images);
    assert.equal(provider.capturedInput, "Compare les images");
    assert.equal(provider.capturedArgs.at(-1), "-");
  }
});

test("contraint la réponse finale avec un fichier de schéma nettoyé après l'appel", async () => {
  const provider = new CapturingCodexAgentProvider(process.cwd());
  const outputSchema = { type: "object", required: ["status"], properties: { status: { type: "string" } }, additionalProperties: false };
  await provider.ask("Sélectionne les biens", { outputSchema });
  assert.deepEqual(provider.capturedSchema, outputSchema);
  assert.equal(provider.capturedArgs.at(-1), "-");
  await assert.rejects(access(provider.capturedSchemaFile!));
});

test("impose aussi le schéma aux sessions reprises", async () => {
  const provider = new CapturingCodexAgentProvider(process.cwd());
  const outputSchema = { type: "object", properties: {}, additionalProperties: false };
  await provider.ask("Reprends le dossier", { sessionId: "session-id", outputSchema });
  assert.deepEqual(provider.capturedSchema, outputSchema);
  assert.ok(provider.capturedArgs.includes("resume"));
  assert.deepEqual(provider.capturedArgs.slice(-2), ["session-id", "-"]);
  await assert.rejects(access(provider.capturedSchemaFile!));
});

test("isole les schémas concurrents et les nettoie même si le moteur échoue", async () => {
  const first = new CapturingCodexAgentProvider(process.cwd());
  const second = new CapturingCodexAgentProvider(process.cwd());
  second.commandError = new Error("moteur indisponible");
  const schemas = [{ type: "string" }, { type: "boolean" }];
  const results = await Promise.allSettled([
    first.ask("Première instance", { outputSchema: schemas[0] }),
    second.ask("Deuxième instance", { outputSchema: schemas[1] })
  ]);
  assert.equal(results[0].status, "fulfilled");
  assert.equal(results[1].status, "rejected");
  assert.notEqual(first.capturedSchemaFile, second.capturedSchemaFile);
  assert.deepEqual(first.capturedSchema, schemas[0]);
  assert.deepEqual(second.capturedSchema, schemas[1]);
  await assert.rejects(access(first.capturedSchemaFile!));
  await assert.rejects(access(second.capturedSchemaFile!));
});
