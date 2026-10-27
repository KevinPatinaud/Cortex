import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { CodexUpdateService, compareCodexVersions, type CodexUpdateBackend } from "./CodexUpdateService.ts";
import { managedCodexCommand, resolveCodexCommand } from "./CodexCommand.ts";
import { CodexModelService } from "./CodexModelService.ts";

async function fixture(t: TestContext) {
  const root = await mkdtemp(path.join(tmpdir(), "cortex-codex-update-"));
  const versions = new Map<string, string>();
  let latest = "9.2.0", now = Date.now(), busy = false, failure = "", installed = "9.1.0";
  const counts = { registry: 0, installs: 0, verifies: 0 };
  const current = managedCodexCommand(root, installed);
  await mkdir(path.dirname(current.args[0]), { recursive: true }); await writeFile(current.args[0], "old engine");
  await writeFile(path.join(root, "current.json"), JSON.stringify({ version: installed }));
  versions.set(current.args[0], installed);
  const backend: CodexUpdateBackend = {
    async latest() { counts.registry++; if (failure === "registry") throw new Error("private registry diagnostics"); return latest; },
    async version(command) { return versions.get(command.args[0]) ?? null; },
    async install(version) {
      counts.installs++; if (failure === "install") throw new Error("private npm diagnostic");
      const file = managedCodexCommand(root, version).args[0]; await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, "new engine");
      versions.set(file, failure === "version" ? "9.0.0" : version);
    },
    async verify() { counts.verifies++; if (failure === "verify") throw new Error("private RPC diagnostics"); }
  };
  const service = new CodexUpdateService(root, () => busy, backend, () => now);
  t.after(async () => {
    service.stop(); assert.equal(path.dirname(root), path.resolve(tmpdir())); assert.ok(path.basename(root).startsWith("cortex-codex-update-"));
    await rm(root, { recursive: true, force: true });
  });
  return { root, service, backend, counts, current, versions, busy: (value: boolean) => { busy = value; }, fail: (value: string) => { failure = value; },
    latest: (value: string) => { latest = value; }, advance: (ms: number) => { now += ms; } };
}

test("a stable update switches a verified version-specific runtime atomically, deduplicates callers and throttles checks", async t => {
  const f = await fixture(t);
  const [a, b] = await Promise.all([f.service.check(), f.service.check(true)]);
  assert.equal(a.state, "updated"); assert.deepEqual(a, b);
  assert.equal(a.installedVersion, "9.2.0"); assert.deepEqual(f.counts, { registry: 1, installs: 1, verifies: 1 });
  assert.deepEqual(resolveCodexCommand(f.root), managedCodexCommand(f.root, "9.2.0"));
  assert.equal(await readFile(f.current.args[0], "utf8"), "old engine");
  await f.service.check(); assert.equal(f.counts.registry, 1);
  f.advance(6 * 60 * 60 * 1000); assert.equal((await f.service.check()).state, "up_to_date");
  assert.equal(f.counts.registry, 2); assert.equal(f.counts.installs, 1);
  assert.deepEqual((await readdir(f.root)).filter(name => name.startsWith("current-")), []);
});

test("downloads may finish while busy but activation waits, without reinstalling or modifying the running version", async t => {
  const f = await fixture(t); f.busy(true);
  assert.equal((await f.service.check()).state, "waiting");
  assert.deepEqual(resolveCodexCommand(f.root), f.current);
  f.busy(false); f.advance(30_000);
  assert.equal((await f.service.check()).state, "updated");
  assert.deepEqual(f.counts, { registry: 1, installs: 1, verifies: 1 });
});

test("network, installation, version and health-check failures preserve the previous runtime and never disclose diagnostics", async t => {
  for (const failure of ["registry", "install", "version", "verify"]) {
    const f = await fixture(t); f.fail(failure);
    const status = await f.service.check();
    assert.equal(status.state, "error"); assert.ok(!JSON.stringify(status).includes("private"));
    assert.deepEqual(resolveCodexCommand(f.root), f.current);
    f.fail(""); f.advance(5 * 60 * 1000);
    assert.equal((await f.service.check()).state, "updated");
  }
});

test("invalid release tags are rejected and newer installed versions are never downgraded", async t => {
  const f = await fixture(t);
  f.latest("9.3.0-alpha.1"); assert.equal((await f.service.check()).state, "error");
  f.latest("../bad"); assert.equal((await f.service.check(true)).state, "error");
  f.latest("8.9.0"); assert.equal((await f.service.check(true)).state, "up_to_date");
  assert.equal(f.counts.installs, 0); assert.deepEqual(resolveCodexCommand(f.root), f.current);
  assert.ok(compareCodexVersions("0.164.0", "0.99.0") > 0);
  assert.ok(compareCodexVersions("0.164.0-alpha.1", "0.164.0") < 0);
});

test("shutdown during installation prevents activation and corrupted pointers fall back to the existing installation", async t => {
  const f = await fixture(t);
  const original = f.backend.install;
  f.backend.install = async (...args) => { await original(...args); f.service.stop(); };
  await f.service.check(); assert.deepEqual(resolveCodexCommand(f.root), f.current);
  await writeFile(path.join(f.root, "current.json"), JSON.stringify({ version: "../../outside" }));
  assert.notDeepEqual(resolveCodexCommand(f.root), f.current);
});

test("model discovery stays available while an update is pending and uses the updated executable on its next read", async t => {
  const f = await fixture(t); f.busy(true);
  await f.service.check();
  const modelService = new CodexModelService("/unused", async () => ({ available: true, cliVersion: await f.backend.version(resolveCodexCommand(f.root)),
    models: [], defaultModel: null, checkedAt: new Date().toISOString(), error: null }), f.service);
  assert.equal((await modelService.getCatalog()).cliVersion, "9.1.0");
  assert.equal((await modelService.getCatalog()).engineUpdate!.state, "waiting");
  f.busy(false); f.advance(30_000); await f.service.check();
  assert.equal((await modelService.getCatalog()).cliVersion, "9.2.0");
});
