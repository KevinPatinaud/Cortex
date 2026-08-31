import assert from "node:assert/strict";
import test from "node:test";
import { ValidationError } from "../../error/ValidationError.ts";
import {
  CodexPluginService,
  parsePluginCatalog
} from "./CodexPluginService.ts";

const CATALOG = JSON.stringify({
  installed: [{
    pluginId: "github@openai-curated",
    name: "github",
    marketplaceName: "openai-curated",
    version: "0.1.6",
    installed: true,
    enabled: true,
    installPolicy: "AVAILABLE",
    authPolicy: "ON_INSTALL"
  }],
  available: [{
    pluginId: "google-calendar@openai-curated",
    name: "google-calendar",
    marketplaceName: "openai-curated",
    version: "1.2.3",
    installed: false,
    enabled: false,
    installPolicy: "AVAILABLE",
    authPolicy: "ON_INSTALL"
  }]
});

test("normalise le catalogue JSON des plugins Codex", () => {
  assert.deepEqual(parsePluginCatalog(CATALOG), [
    {
      id: "github@openai-curated",
      name: "github",
      marketplace: "openai-curated",
      version: "0.1.6",
      installed: true,
      enabled: true,
      authPolicy: "ON_INSTALL",
      installPolicy: "AVAILABLE"
    },
    {
      id: "google-calendar@openai-curated",
      name: "google-calendar",
      marketplace: "openai-curated",
      version: "1.2.3",
      installed: false,
      enabled: false,
      authPolicy: "ON_INSTALL",
      installPolicy: "AVAILABLE"
    }
  ]);
});

test("installe un plugin puis recharge le catalogue", async () => {
  const calls: string[][] = [];
  const service = new CodexPluginService(async (args) => {
    calls.push(args);
    return args[1] === "add" ? "{}" : CATALOG;
  });

  const catalog = await service.install("google-calendar@openai-curated");

  assert.equal(catalog.available, true);
  assert.equal(catalog.plugins.length, 2);
  assert.deepEqual(calls, [
    ["plugin", "add", "google-calendar@openai-curated", "--json"],
    ["plugin", "list", "--available", "--json"]
  ]);
});

test("supprime un plugin avec un identifiant validé", async () => {
  const calls: string[][] = [];
  const service = new CodexPluginService(async (args) => {
    calls.push(args);
    return args[1] === "remove" ? "{}" : CATALOG;
  });

  await service.remove("github@openai-curated");

  assert.deepEqual(calls[0], [
    "plugin",
    "remove",
    "github@openai-curated",
    "--json"
  ]);
});

test("refuse un sélecteur susceptible d'injecter une commande", () => {
  const service = new CodexPluginService(async () => CATALOG);

  assert.throws(
    () => service.install("github@openai-curated; whoami"),
    ValidationError
  );
});

test("signale proprement une CLI Codex indisponible", async () => {
  const service = new CodexPluginService(async () => {
    throw new Error("codex: command not found");
  });

  assert.deepEqual(await service.getCatalog(), {
    available: false,
    plugins: [],
    error: "codex: command not found"
  });
});
