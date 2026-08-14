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

test("utilise autopilot et allow all par défaut", async () => {
  await withConfigurationFile(null, async (service) => {
    assert.deepEqual(await service.getConfiguration(), {
      autopilot: true,
      allowAll: true
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

    assert.deepEqual(receivedOptions, {
      model: "test-model",
      configuration: { autopilot: false, allowAll: true }
    });
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
