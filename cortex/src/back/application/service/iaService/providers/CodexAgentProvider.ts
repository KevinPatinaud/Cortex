
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type {
  AgentExecutionOptions,
  AgentExecutionResult,
  AgentProvider
} from "../AgentProvider.ts";
import { DEFAULT_AGENT_CONFIGURATION } from "../AgentProvider.ts";
import { CliAgentProcessError, CliAgentProvider } from "../CliAgentProvider.ts";
import { createCodexProgress } from "../ExecutionProgress.ts";
import { addTokenUsage, type TokenUsage } from "../../../../../shared/TokenUsage.ts";
import { resolveCodexCommand, type CodexCommand } from "../CodexCommand.ts";

export class CodexAgentProvider extends CliAgentProvider implements AgentProvider {
  readonly engine = "codex" as const;
  readonly label = "Codex";
  constructor(workingDirectory: string, private readonly resolveCommand: () => CodexCommand = resolveCodexCommand) {
    super(workingDirectory);
  }

  async isAvailable(): Promise<boolean> {
    const { command, args } = this.resolveCommand();
    return this.commandSucceeds(command, [
      ...args,
      "login",
      "status"
    ]);
  }

  async ask(
    prompt: string,
    options: AgentExecutionOptions = {}
  ): Promise<AgentExecutionResult> {
    let currentPrompt = prompt;
    let usage: TokenUsage | undefined;
    const trackedOptions = { ...options, onUsage: (delta: TokenUsage) => {
      usage = addTokenUsage(usage, delta);
      options.onUsage?.(delta);
    } };
    let currentOptions = trackedOptions;
    for (let attempt = 0; ; attempt++) {
      try {
        const result = await this.askOnce(currentPrompt, currentOptions);
        return { ...result, ...(usage ? { usage } : {}) };
      }
      catch (error) {
        options.signal?.throwIfAborted();
        const interpretation = options.purpose === "interpretation";
        // A business turn may already have effects. Continue its durable thread;
        // never replay its initial prompt in a new conversation.
        if (!(error instanceof CodexTurnError) || !error.atCapacity || attempt >= 2 ||
          (!interpretation && (!options.persistSession || !error.sessionId))) throw error;
        const milliseconds = [5_000, 15_000][attempt];
        options.onProgress?.(`Le modèle Codex est temporairement saturé. Reprise ${attempt + 1}/2 dans ${milliseconds / 1000} secondes, avec le même modèle.`);
        options.onTrace?.({ kind: "status", content: `Le modèle Codex est temporairement saturé. Reprise ${attempt + 1}/2 dans ${milliseconds / 1000} secondes, avec le même modèle.` });
        await this.waitForCapacity(milliseconds, options.signal);
        currentOptions = interpretation ? trackedOptions : { ...trackedOptions, sessionId: error.sessionId, imagePaths: undefined };
        currentPrompt = interpretation ? prompt : "The preceding turn stopped because the selected model was temporarily at capacity. Continue only the unfinished work in this same conversation. First reconcile the current files, running tools and any completed external actions with the saved mission state. Do not repeat completed actions or start a new subject. Finish the original requested task and its validation.";
      }
    }
  }

  protected async waitForCapacity(milliseconds: number, signal?: AbortSignal): Promise<void> {
    await delay(milliseconds, undefined, { signal });
  }

  private async askOnce(prompt: string, options: AgentExecutionOptions): Promise<AgentExecutionResult> {
    const selectedCommand = this.resolveCommand();
    const interpretation = options.purpose === "interpretation";
    if (interpretation && options.sessionId) throw new Error("An interpretation must use its own session.");
    const configuration = interpretation ? { autopilot: false, allowAll: false } : options.configuration ?? DEFAULT_AGENT_CONFIGURATION;
    // Cortex orchestrates workflow instances itself. Disabling Codex's
    // internal multi-agent mode prevents a business instruction that asks to
    // launch the next step from consuming Codex collaboration threads.
    const args = ["exec", !interpretation && options.delegation === "bounded" ? "--enable" : "--disable", "multi_agent"];
    if (!interpretation && options.skipGitRepoCheck) args.push("--skip-git-repo-check");
    if (!interpretation && options.delegation === "bounded") args.push("--config", "agents.max_threads=2");
    if (interpretation) {
      args.push("--skip-git-repo-check", "--disable", "apps", "--disable", "plugins", "--disable", "hooks", "--disable", "multi_agent_v2",
        "--config", "features.shell_tool=false", "--config", 'web_search="disabled"',
        "--config", "apps._default.enabled=false", "--config", 'approval_policy="never"');
      for (const name of options.profile?.declaredMcpServers ?? []) args.push("--config", `mcp_servers.${JSON.stringify(name)}.enabled=false`);
      for (const name of options.profile?.declaredApps ?? []) args.push("--config", `apps.${JSON.stringify(name)}.enabled=false`);
    }

    if (!configuration.autopilot) {
      args.push("--config", "sandbox_mode=\"read-only\"");
    } else if (configuration.allowAll) {
      args.push("--dangerously-bypass-approvals-and-sandbox");
    } else {
      args.push("--approve-for-me");
    }

    if (options.sessionId) {
      args.push("resume", "--json");
    } else {
      args.push("--json", "--color", "never");
    }

    if (!options.sessionId && !options.persistSession) {
      args.push("--ephemeral");
    }

    if (!options.sessionId && options.workingDirectory) {
      args.push("--cd", options.workingDirectory);
    }

    if (options.model) {
      args.push("--model", options.model);
    }

    if (options.reasoningEffort) {
      args.push(
        "--config",
        `model_reasoning_effort=${JSON.stringify(options.reasoningEffort)}`
      );
    }

    if (!interpretation) for (const image of options.imagePaths ?? []) args.push("--image", image);

    let schemaDirectory: string | undefined;
    try {
      if (options.outputSchema) {
        schemaDirectory = await mkdtemp(path.join(tmpdir(), "cortex-response-schema-"));
        const schemaFile = path.join(schemaDirectory, "response.json");
        await writeFile(schemaFile, JSON.stringify(options.outputSchema), { mode: 0o600 });
        // Supported by both exec and exec resume. JSONL alone only formats
        // the event stream; it does not constrain the model's final answer.
        args.push("--output-schema", schemaFile);
      }

      if (options.sessionId) args.push(options.sessionId);
      // Passing a large prompt as a process argument can exceed the operating
      // system's command-line limit (E2BIG). Codex accepts `-` as an explicit
      // instruction to read the prompt from stdin, including resumed sessions.
      args.push("-");
      let reportedUsage = false;
      const reportUsage = (usage: TokenUsage) => { reportedUsage = true; options.onUsage?.(usage); };
      const readUnreportedUsage = (raw: string) => {
        if (!reportedUsage) createCodexProgress(undefined, undefined, undefined, reportUsage)(raw + "\n");
      };
      let output: string;
      try { output = await this.runCommand(selectedCommand.command, [
        ...selectedCommand.args,
        ...args
      ], undefined, options.workingDirectory, prompt, {
        signal: options.signal,
        onProgress: createCodexProgress(options.onProgress, options.onSessionId, options.onTrace, reportUsage)
      }); } catch (error) {
        if (error instanceof CliAgentProcessError) {
          readUnreportedUsage(error.output);
          const failure = codexFailure(error.output, options.sessionId);
          if (failure) throw failure;
        }
        throw error;
      }
      readUnreportedUsage(output);
      const failure = codexFailure(output, options.sessionId);
      if (failure) throw failure;
      const result = parseCodexJsonOutput(output, options.sessionId);
      if (options.profile) result.profile = { ...options.profile, observedCapabilities: observedCapabilities(output) };

      if (!result.answer) {
        throw new Error("Codex did not return a response.");
      }

      if (!result.sessionId) {
        throw new Error("Codex did not return a session ID.");
      }

      return result;
    } finally {
      if (schemaDirectory) await rm(schemaDirectory, { recursive: true, force: true });
    }
  }
}

export class CodexTurnError extends Error {
  readonly atCapacity: boolean;
  constructor(message: string, readonly sessionId?: string, code?: string) {
    const atCapacity = code === "server_overloaded" || /selected model is at capacity/i.test(message);
    super(atCapacity ? `Le modèle Codex est temporairement saturé. ${message}` : `Codex : ${message}`);
    this.name = "CodexTurnError";
    this.atCapacity = atCapacity;
  }
}

function codexFailure(output: string, existingSessionId?: string): CodexTurnError | undefined {
  let sessionId = existingSessionId;
  let failure: { message: string; code?: string } | undefined;
  for (const line of output.split(/\r?\n/)) {
    try {
      const event = JSON.parse(line);
      sessionId = readString(event.thread_id) || readString(event.session_id) || sessionId;
      if (event.type === "turn.completed") failure = undefined;
      if (event.type !== "turn.failed" && event.type !== "error") continue;
      const detail = readRecord(event.error);
      const message = readString(detail.message) || readString(event.message) || readString(event.error);
      if (message) failure = { message, code: readString(detail.codex_error_info) || readString(detail.code) || undefined };
    } catch { /* Tool output and stderr are not terminal turn failures. */ }
  }
  return failure ? new CodexTurnError(failure.message, sessionId, failure.code) : undefined;
}

function observedCapabilities(output: string): string[] {
  const capabilities = new Set<string>();
  for (const line of output.split(/\r?\n/)) {
    try {
      const event = JSON.parse(line);
      const item = event.item;
      if (event.type === "item.completed" && item && ["command_execution", "web_search", "mcp_tool_call", "file_change", "collab_tool_call"].includes(item.type)) {
        capabilities.add(item.type);
      }
    } catch { /* Non-JSON diagnostics are not capabilities. */ }
  }
  return [...capabilities].sort();
}

function parseCodexJsonOutput(
  output: string,
  existingSessionId?: string
): AgentExecutionResult {
  let sessionId = existingSessionId;
  const messages: string[] = [];

  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }

    try {
      const event = JSON.parse(line) as Record<string, unknown>;
      const eventSessionId = readString(event.thread_id) ||
        readString(event.session_id);

      if (eventSessionId) {
        sessionId = eventSessionId;
      }

      const item = readRecord(event.item);

      if (
        event.type === "item.completed" &&
        item.type === "agent_message"
      ) {
        const message = readString(item.text) || readString(item.content);

        if (message) {
          messages.push(message);
        }
      }
    } catch {
      // Ignore any non-JSON lines in the CLI output.
    }
  }

  return {
    answer: messages.at(-1) || "",
    ...(sessionId ? { sessionId } : {})
  };
}

function readRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim()
    ? value.trim()
    : null;
}
