import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { AgentConfigurationService } from "./AgentConfigurationService.ts";
import type {
  AgentExecutionOptions,
  AgentProvider
} from "./AgentProvider.ts";
import { AgentService } from "./AgentService.ts";

async function withConfigurationFile(
  content: Record<string, unknown> | null,
  assertion: (
    service: AgentConfigurationService,
    configurationFile: string
  ) => Promise<void>
): Promise<void> {
  const temporaryDirectory = await mkdtemp(
    path.join(os.tmpdir(), "cortex-agent-configuration-")
  );
  const configurationFile = path.join(temporaryDirectory, "config.json");

  try {
    if (content) {
      await writeFile(
        configurationFile,
        JSON.stringify(content),
        "utf8"
      );
    }

    await assertion(
      new AgentConfigurationService(configurationFile),
      configurationFile
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
}

test("utilise autopilot sans désactiver les protections par défaut", async () => {
  await withConfigurationFile(null, async (service) => {
    assert.deepEqual(await service.getConfiguration(), {
      autopilot: true,
      allowAll: false
    });
  });
});

test("enregistre la configuration sans écraser les autres données", async () => {
  await withConfigurationFile({
    projects: [{ id: "project-id", directoryPath: "C:\\project" }]
  }, async (service, configurationFile) => {
    await service.saveConfiguration({ autopilot: false, allowAll: false });

    assert.deepEqual(
      JSON.parse(await readFile(configurationFile, "utf8")),
      {
        projects: [{ id: "project-id", directoryPath: "C:\\project" }],
        agentConfiguration: { autopilot: false, allowAll: false }
      }
    );
  });
});

test("injecte la même configuration dans tous les providers", async () => {
  await withConfigurationFile({
    agentConfiguration: { autopilot: false, allowAll: true }
  }, async (configurationService) => {
    let receivedOptions: AgentExecutionOptions | undefined;
    const provider: AgentProvider = {
      engine: "codex",
      label: "Test",
      async isAvailable() {
        return true;
      },
      async ask(_prompt, options) {
        receivedOptions = options;
        return { answer: "ok" };
      }
    };
    const service = new AgentService([provider], configurationService);

    await service.execute("codex", "Test", { model: "test-model" });

    assert.ok(receivedOptions?.signal instanceof AbortSignal);
    assert.deepEqual({ ...receivedOptions, signal: undefined }, {
      signal: undefined,
      model: "test-model",
      timeoutMs: 900_000,
      configuration: { autopilot: false, allowAll: true }
    });
  });
});

test("restricts review generation without changing global permissions or subsequent executions", async () => {
  const storedConfiguration = { autopilot: true, allowAll: true };
  await withConfigurationFile({
    agentConfiguration: storedConfiguration,
    projects: [{ id: "project-id", directoryPath: "C:\\project" }]
  }, async (configurationService, configurationFile) => {
    const originalFile = await readFile(configurationFile, "utf8");
    const calls: AgentExecutionOptions[] = [];
    const provider: AgentProvider = {
      engine: "codex",
      label: "Test",
      async isAvailable() { return true; },
      async ask(_prompt, options) {
        calls.push(options!);
        return { answer: "ok" };
      }
    };
    const service = new AgentService([provider], configurationService);

    await service.executeActive("Prepare a proposal", {
      persistSession: false,
      readOnly: true,
      configuration: { autopilot: true, allowAll: true }
    });
    assert.deepEqual(calls[0].configuration, { autopilot: false, allowAll: false });
    assert.equal(calls[0].persistSession, false);
    assert.deepEqual(await service.getConfiguration(), storedConfiguration);
    assert.equal(await readFile(configurationFile, "utf8"), originalFile);

    await service.execute("codex", "Analyze the workflow graph", {
      persistSession: false,
      readOnly: true,
      configuration: { autopilot: true, allowAll: true }
    });
    assert.deepEqual(calls[1].configuration, { autopilot: false, allowAll: false });

    await service.executeActive("Perform an authorized task", {});
    await service.executeActive("Perform another authorized task", { readOnly: false });
    await service.execute("codex", "Execute a workflow agent", {});
    assert.deepEqual(calls.slice(2).map(({ configuration }) => configuration), [
      storedConfiguration, storedConfiguration, storedConfiguration
    ]);
    assert.equal(await readFile(configurationFile, "utf8"), originalFile);
  });
});

test("shutdown cancels internal generation requests and prevents new engine work", async () => {
  await withConfigurationFile({}, async (configurationService) => {
    let notifyStarted!: () => void;
    const started = new Promise<void>((resolve) => { notifyStarted = resolve; });
    const provider: AgentProvider = {
      engine: "codex", label: "Test",
      async isAvailable() { return true; },
      ask(_prompt, options) {
        return new Promise((_resolve, reject) => {
          options?.signal?.addEventListener("abort", () => reject(options.signal?.reason), { once: true });
          notifyStarted();
        });
      }
    };
    const service = new AgentService([provider], configurationService);
    const generation = service.executeActive("Generate a project", {});
    await started;
    assert.equal(service.hasActiveExecutions(), true);
    service.cancelAllExecutions();
    await assert.rejects(generation, { name: "AbortError" });
    assert.equal(service.hasActiveExecutions(), false);
    await assert.rejects(service.executeActive("Another project", {}), { name: "AbortError" });
  });
});

test("exécute les tâches internes avec le moteur actif", async () => {
  await withConfigurationFile({}, async (configurationService) => {
    const calls: string[] = [];
    const unavailableProvider: AgentProvider = {
      engine: "claude",
      label: "Claude",
      async isAvailable() {
        return false;
      },
      async ask() {
        throw new Error("Ce provider ne doit pas être utilisé.");
      }
    };
    const activeProvider: AgentProvider = {
      engine: "codex",
      label: "Codex",
      async isAvailable() {
        return true;
      },
      async ask(prompt) {
        calls.push(prompt);
        return { answer: "ok" };
      }
    };
    const service = new AgentService(
      [unavailableProvider, activeProvider],
      configurationService
    );

    const result = await service.executeActive("Améliore ce prompt", {
      persistSession: false
    });

    assert.equal(result.answer, "ok");
    assert.deepEqual(calls, ["Améliore ce prompt"]);
  });
});
