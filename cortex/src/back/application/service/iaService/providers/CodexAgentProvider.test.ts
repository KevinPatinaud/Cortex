import assert from "node:assert/strict";
import test from "node:test";
import { access, readFile } from "node:fs/promises";
import { CodexAgentProvider } from "./CodexAgentProvider.ts";

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

test("désactive le multi-agent interne quand Cortex lance Codex", async () => {
  const provider = new CapturingCodexAgentProvider(process.cwd());

  await provider.ask("Execute la tache", { persistSession: true });

  const disableIndex = provider.capturedArgs.indexOf("--disable");

  assert.notEqual(disableIndex, -1);
  assert.equal(provider.capturedArgs[disableIndex + 1], "multi_agent");
});

test("laisse quinze minutes aux agents qui manipulent des fichiers ou un navigateur", async () => {
  const provider = new CapturingCodexAgentProvider(process.cwd());

  await provider.ask("Publie le journal", { persistSession: true });

  assert.equal(provider.capturedTimeout, 15 * 60 * 1000);
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
