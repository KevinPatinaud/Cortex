import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { JsonConfigurationRepository } from "./JsonConfigurationRepository.ts";

test("serializes concurrent read-modify-write across repository instances", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cortex-config-lock-"));
  try {
    const file = path.join(directory, "config.json");
    const first = new JsonConfigurationRepository(file);
    const second = new JsonConfigurationRepository(path.join(directory, ".", "config.json"));
    await Promise.all(Array.from({ length: 30 }, (_, index) =>
      (index % 2 ? first : second).update<{ count?: number }>(async (configuration) => {
        // Yield between the read and write to expose a missing transaction lock.
        await new Promise<void>((resolve) => setImmediate(resolve));
        return { count: (configuration.count ?? 0) + 1 };
      })
    ));
    assert.deepEqual(await first.read(), { count: 30 });
    assert.deepEqual(await readdir(directory), ["config.json"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("keeps the last configuration intact on a failed mutation and releases the lock", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cortex-config-failure-"));
  try {
    const file = path.join(directory, "config.json");
    const original = '{"projects":[],"keep":"unchanged"}';
    await writeFile(file, original);
    const repository = new JsonConfigurationRepository(file);
    await assert.rejects(repository.update(() => { throw new Error("failed mutation"); }), /failed mutation/);
    assert.equal(await readFile(file, "utf8"), original);
    await repository.update((configuration) => ({ ...configuration, saved: true }));
    assert.equal((await repository.read()).saved, true);
    assert.deepEqual(await readdir(directory), ["config.json"]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("readers never observe truncated JSON while configurations are replaced", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cortex-config-atomic-"));
  try {
    const file = path.join(directory, "config.json");
    const repository = new JsonConfigurationRepository(file);
    await repository.replace({ revision: 0, content: "a".repeat(100_000) });
    const writer = (async () => {
      for (let revision = 1; revision <= 12; revision += 1) {
        await repository.replace({ revision, content: String(revision).repeat(100_000) });
      }
    })();
    const reader = (async () => {
      for (let index = 0; index < 60; index += 1) {
        const value = JSON.parse(await readFile(file, "utf8"));
        assert.ok(Number.isInteger(value.revision));
        assert.ok(value.content.length >= 100_000);
      }
    })();
    const results = await Promise.allSettled([writer, reader]);
    for (const result of results) {
      if (result.status === "rejected") throw result.reason;
    }
    assert.equal((await repository.read()).revision, 12);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
