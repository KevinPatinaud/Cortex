import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type {
  AgentExecutionOptions,
  AgentExecutionResult,
  AgentProvider
} from "../AgentProvider.ts";
import { DEFAULT_AGENT_CONFIGURATION } from "../AgentProvider.ts";
import { CliAgentProcessError, CliAgentProvider } from "../CliAgentProvider.ts";
import { createGeminiProgress } from "../ExecutionProgress.ts";
import { addTokenUsage, type TokenUsage } from "../../../../../shared/TokenUsage.ts";

const VALID_AGY_EFFORTS = new Set(["low", "medium", "high", "xhigh", "max"]);

export function resolveAgyBinary(): string {
  const configured = process.env.AGY_BIN?.trim();
  if (configured) {
    return configured;
  }

  if (process.platform === "win32") {
    const localAppData = process.env.LOCALAPPDATA?.trim() ||
      path.join(os.homedir(), "AppData", "Local");
    const windowsPath = path.join(localAppData, "agy", "bin", "agy.exe");
    if (existsSync(windowsPath)) {
      return windowsPath;
    }
    return "agy.exe";
  }

  const unixPath = path.join(os.homedir(), ".local", "bin", "agy");
  if (existsSync(unixPath)) {
    return unixPath;
  }

  return "agy";
}

export class GeminiAgentProvider extends CliAgentProvider implements AgentProvider {
  readonly engine = "gemini" as const;
  readonly label = "Gemini";

  async isAvailable(): Promise<boolean> {
    return this.commandSucceeds(resolveAgyBinary(), ["--version"]);
  }

  async ask(
    prompt: string,
    options: AgentExecutionOptions = {}
  ): Promise<AgentExecutionResult> {
    const configuration = options.configuration ?? DEFAULT_AGENT_CONFIGURATION;
    const args = [
      "--input-format=stream-json",
      "--output-format=stream-json",
      "--disable-slash-commands",
      "--print-timeout=0s"
    ];

    if (options.readOnly || !configuration.autopilot) {
      args.push("--mode=plan");
    } else if (configuration.allowAll) {
      args.push("--dangerously-skip-permissions");
    } else {
      args.push("--mode=auto");
    }

    if (options.sessionId) {
      args.push(`--conversation=${options.sessionId}`);
    }

    if (options.model) {
      args.push(`--model=${options.model}`);
    }

    if (options.reasoningEffort && VALID_AGY_EFFORTS.has(options.reasoningEffort)) {
      args.push(`--effort=${options.reasoningEffort}`);
    }

    let schemaFile: string | undefined;
    if (options.outputSchema) {
      const geminiSchema = adaptOutputSchemaForGemini(options.outputSchema);
      schemaFile = path.join(os.tmpdir(), `cortex-gemini-schema-${randomUUID()}.json`);
      await writeFile(schemaFile, JSON.stringify(geminiSchema), { encoding: "utf8", mode: 0o600 });
      args.push(`--json-schema=${schemaFile}`);
    }

    const effectivePrompt = options.imagePaths?.length
      ? `${prompt}\n\nAttached local image files:\n${options.imagePaths.map((imagePath) => `- ${imagePath}`).join("\n")}`
      : prompt;
    const stdinPayload = `${JSON.stringify({
      event: "user",
      message: { content: effectivePrompt }
    })}\n`;

    let usage: TokenUsage | undefined;
    let observedSessionId = options.sessionId;
    const reportUsage = (delta: TokenUsage) => {
      usage = addTokenUsage(usage, delta);
      options.onUsage?.(delta);
    };
    const reportSessionId = (sessionId: string) => {
      if (sessionId && sessionId !== observedSessionId) {
        observedSessionId = sessionId;
        options.onSessionId?.(sessionId);
      }
    };

    let output: string;
    try {
      output = await this.runCommand(
        resolveAgyBinary(),
        args,
        undefined,
        options.workingDirectory,
        stdinPayload,
        {
          signal: options.signal,
          onProgress: createGeminiProgress(options.onProgress, reportSessionId, options.onTrace, reportUsage)
        }
      );
    } catch (error) {
      if (!usage && error instanceof CliAgentProcessError) {
        createGeminiProgress(undefined, reportSessionId, undefined, reportUsage)(`${error.output}\n`);
      }
      if (error instanceof CliAgentProcessError) {
        const failedResult = parseFinalGeminiResult(error.output);
        if (typeof failedResult?.error === "string" && failedResult.error.trim()) {
          throw new Error(failedResult.error.trim());
        }
      }
      throw error;
    } finally {
      if (schemaFile) {
        await rm(schemaFile, { force: true }).catch(() => undefined);
      }
    }

    if (!usage) {
      createGeminiProgress(undefined, reportSessionId, undefined, reportUsage)(`${output}\n`);
    }

    const events = parseGeminiEvents(output);
    const result = events
      .filter((event) => event.event === "result" && event.result)
      .map((event) => event.result)
      .at(-1);
    const sessionId = readNonEmptyString(result?.conversation_id)
      ?? readNonEmptyString(events.find((event) => typeof event.conversation_id === "string")?.conversation_id)
      ?? observedSessionId;

    if (sessionId) {
      reportSessionId(sessionId);
    }

    const status = typeof result?.status === "string" ? result.status.toUpperCase() : "";
    if ((status && status !== "SUCCESS") || (typeof result?.error === "string" && result.error.trim())) {
      throw new Error(
        typeof result?.error === "string" && result.error.trim()
          ? result.error.trim()
          : "Gemini execution failed."
      );
    }

    let answer = "";
    if (options.outputSchema && result?.structured_output !== undefined) {
      answer = JSON.stringify(normalizeGeminiStructuredOutput(result.structured_output, options.outputSchema));
    } else if (typeof result?.response === "string") {
      answer = result.response.trim();
    } else {
      answer = events
        .filter((event) => event.event === "step_update" && event.step_update?.step_type === "agent_response")
        .map((event) => typeof event.step_update?.text_delta === "string" ? event.step_update.text_delta : "")
        .join("")
        .trim() || output.trim();
    }

    return {
      answer,
      ...(sessionId ? { sessionId } : {}),
      ...(usage ? { usage } : {})
    };
  }
}

function parseGeminiEvents(output: string): Array<Record<string, any>> {
  return output.split(/\r?\n/).flatMap((line) => {
    const trimmed = line.trim();
    if (!trimmed) return [];
    try {
      const value = JSON.parse(trimmed);
      return value && typeof value === "object" ? [value as Record<string, any>] : [];
    } catch {
      return [];
    }
  });
}

function parseFinalGeminiResult(output: string): Record<string, any> | undefined {
  return parseGeminiEvents(output)
    .filter((event) => event.event === "result" && event.result)
    .map((event) => event.result)
    .at(-1);
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNullableType(schema: unknown, targetType?: string): boolean {
  if (!isPlainObject(schema) || !Array.isArray(schema.type)) return false;
  return schema.type.includes("null") && (!targetType || schema.type.includes(targetType));
}

/**
 * Antigravity CLI converts --json-schema into Gemini tool parameters that only
 * support a single OpenAPI type. Marking nullable objects (such as `wait`) as
 * required causes Gemini to fabricate placeholder objects on non-waiting turns.
 */
export function adaptOutputSchemaForGemini(schema: Record<string, unknown>): Record<string, unknown> {
  return adaptSchemaNode(schema) as Record<string, unknown>;
}

function adaptSchemaNode(node: unknown): unknown {
  if (Array.isArray(node)) {
    return node.map(adaptSchemaNode);
  }
  if (!isPlainObject(node)) {
    return node;
  }

  const adapted: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (key === "properties" && isPlainObject(value)) {
      const nextProperties: Record<string, unknown> = {};
      for (const [propKey, propSchema] of Object.entries(value)) {
        nextProperties[propKey] = adaptSchemaNode(propSchema);
      }
      adapted[key] = nextProperties;
    } else if (key === "items") {
      adapted[key] = adaptSchemaNode(value);
    } else {
      adapted[key] = value;
    }
  }

  if (Array.isArray(adapted.required) && isPlainObject(node.properties)) {
    adapted.required = adapted.required.filter(
      (key) => typeof key !== "string" || !isNullableType(node.properties && (node.properties as Record<string, unknown>)[key], "object")
    );
  }

  return adapted;
}

export function normalizeGeminiStructuredOutput(
  value: unknown,
  schema: Record<string, unknown>
): unknown {
  if (!isPlainObject(value) || !isPlainObject(schema.properties)) {
    return value;
  }

  const normalized: Record<string, unknown> = { ...value };
  const properties = schema.properties;

  if (Array.isArray(schema.required)) {
    for (const key of schema.required) {
      if (typeof key === "string" && !(key in normalized) && isNullableType(properties[key])) {
        normalized[key] = null;
      }
    }
  }

  if (
    isNullableType(properties.wait, "object") &&
    typeof normalized.status === "string" &&
    normalized.status !== "waiting" &&
    isPlainObject(normalized.wait) &&
    normalized.wait.eventKey == null &&
    normalized.wait.wakeAfterSeconds == null &&
    (normalized.wait.state === "" || normalized.wait.state == null)
  ) {
    normalized.wait = null;
  }

  return normalized;
}
