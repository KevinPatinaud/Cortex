import assert from "node:assert/strict";
import test from "node:test";
import { CodexModelService, readCodexModelCatalog } from "./CodexModelService.ts";
import { withCodexAppServer, type CodexAppServerSession } from "./CodexAppServer.ts";
import { AgentUseCase } from "../../usecase/AgentUseCase.ts";
import type { AgentService } from "./AgentService.ts";
import type { ProjectUseCase } from "../../usecase/ProjectUseCase.ts";

const model = (name: string, extra = {}) => ({ id: `id-${name}`, model: name, displayName: `Name ${name}`, hidden: false,
  supportedReasoningEfforts: [{ reasoningEffort: "low" }, { reasoningEffort: "ultra" }], defaultReasoningEffort: "low", ...extra });

test("reads every page, uses executable model identifiers, filters hidden/duplicate entries and keeps model-specific capabilities", async () => {
  const requests: Array<[string, object]> = [];
  const catalog = await readCodexModelCatalog({ initialization: { userAgent: "cortex/0.163.0 (Linux)" },
    async request(method, params) {
      requests.push([method, params]);
      if (method === "config/read") return { config: { model: "second" } };
      if (!("cursor" in params)) return { data: [model("first", { isDefault: true }), model("hidden", { hidden: true }), null, {}], nextCursor: "next" };
      return { data: [model("first"), model("second", { supportedReasoningEfforts: [{ reasoningEffort: "medium" }, { reasoningEffort: "max" }, { reasoningEffort: "future_effort" }] })], nextCursor: null };
    } });
  assert.deepEqual(catalog.models.map(value => value.model), ["first", "second"]);
  assert.deepEqual(catalog.models[1].reasoningEfforts, ["medium", "max", "future_effort"]);
  assert.equal(catalog.cliVersion, "0.163.0");
  assert.equal(catalog.defaultModel, "second");
  assert.deepEqual(requests, [["model/list", { limit: 100, includeHidden: false }],
    ["model/list", { limit: 100, includeHidden: false, cursor: "next" }], ["config/read", { includeLayers: false }]]);
});

test("older catalogs tolerate missing optional fields and an unsupported config/read", async () => {
  const catalog = await readCodexModelCatalog({ initialization: {}, async request(method) {
    if (method === "config/read") throw new Error("Unsupported");
    return { data: [{ model: "server-default", isDefault: true }] };
  } });
  assert.equal(catalog.available, true);
  assert.equal(catalog.defaultModel, "server-default");
  assert.equal(catalog.cliVersion, null);
  assert.deepEqual(catalog.models[0].reasoningEfforts, []);
});

test("the HTTP use case resolves registered project directories and rejects unknown projects before discovery", async () => {
  const directories: Array<string | undefined> = [];
  const service = { getCodexModels: async (directory?: string) => {
    directories.push(directory);
    return { available: true, models: [] };
  } } as unknown as AgentService;
  const projects = { getProject: async (id: string) => {
    if (id !== "registered") throw new Error("Unknown project");
    return { directoryPath: "/server/projects/registered" };
  } } as unknown as ProjectUseCase;
  const useCase = new AgentUseCase(service, projects);
  await useCase.getCodexModels("registered");
  await useCase.getCodexModels();
  await assert.rejects(useCase.getCodexModels("unknown"), /Unknown project/);
  assert.deepEqual(directories, ["/server/projects/registered", undefined]);
});

test("malformed, empty and looping paginated catalogs fail instead of fabricating model suggestions", async () => {
  for (const result of [null, {}, { data: [] }, { data: [model("hidden", { hidden: true })] },
    { data: [model("one")], nextCursor: "loop" }, { data: [model("one")], nextCursor: 1 }]) {
    await assert.rejects(readCodexModelCatalog({ initialization: {}, request: async () => result }));
  }
  let pages = 0;
  await assert.rejects(readCodexModelCatalog({ initialization: {}, request: async () => ({ data: [model(`model-${pages}`)], nextCursor: String(++pages) }) }), /page limit/);
  assert.equal(pages, 20);
});

test("discovery is scoped to the project, shares only pending requests, and refreshes after a CLI/catalog change", async () => {
  const directories: string[] = [];
  let generation = 1;
  const service = new CodexModelService("/server", async directory => {
    directories.push(directory);
    await new Promise(setImmediate);
    return readCodexModelCatalog({ initialization: {}, request: async method => method === "config/read"
      ? { config: {} } : { data: [model(`model-${generation}`)] } });
  });
  await Promise.all([service.getCatalog("/project-a"), service.getCatalog("/project-a"), service.getCatalog("/project-b")]);
  assert.deepEqual(directories.sort(), ["/project-a", "/project-b"]);
  generation++;
  assert.equal((await service.getCatalog()).models[0].model, "model-2");
  assert.equal(directories.at(-1), "/server");
});

test("CLI/auth failures return an empty unavailable catalog without exposing diagnostics and can be retried", async () => {
  let failed = true;
  const service = new CodexModelService("/server", async () => {
    if (failed) throw new Error("secret diagnostic");
    return readCodexModelCatalog({ initialization: {}, request: async () => ({ data: [model("recovered")] }) });
  });
  const unavailable = await service.getCatalog();
  assert.equal(unavailable.available, false);
  assert.deepEqual(unavailable.models, []);
  assert.ok(!JSON.stringify(unavailable).includes("secret"));
  failed = false;
  assert.equal((await service.getCatalog()).models[0].model, "recovered");
});

test("real RPC transport supports paginated discovery without any inference request", async () => {
  const script = `
    const input = require('node:readline').createInterface({input: process.stdin});
    let initialized = false;
    input.on('line', line => {
      const m = JSON.parse(line);
      const answer = result => console.log(JSON.stringify({id: m.id, result}));
      if (m.method === 'initialize') answer({userAgent:'cortex/0.163.0 (Linux)'});
      else if (m.method === 'initialized') initialized = true;
      else if (m.method === 'model/list' && initialized) {
        if (m.params.includeHidden !== false || m.params.limit !== 100) process.exit(3);
        answer({data:[{model:m.params.cursor ? 'second' : 'first'}],nextCursor:m.params.cursor ? null : 'page2'});
      } else if (m.method === 'config/read') answer({config:{model:'second'}});
      else process.exit(4);
    });
  `;
  const catalog = await withCodexAppServer(process.cwd(), readCodexModelCatalog,
    { command: process.execPath, args: ["--eval", script, "--"] });
  assert.equal(catalog.cliVersion, "0.163.0");
  assert.deepEqual(catalog.models.map(value => value.model), ["first", "second"]);
  assert.equal(catalog.defaultModel, "second");
});
