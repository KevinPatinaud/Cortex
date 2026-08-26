import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import test from "node:test";
import { writeCortexProjectArchive } from "./ProjectArchive.ts";
import { readCortexProjectArchive } from "./ProjectArchiveReader.ts";

test("relit une archive .ctx exportée par Cortex", async () => {
  const temporaryDirectory = await mkdtemp(
    path.join(os.tmpdir(), "cortex-project-import-")
  );
  const projectDirectory = path.join(temporaryDirectory, "Atlas");

  try {
    await mkdir(path.join(projectDirectory, ".codex", "agents"), {
      recursive: true
    });
    await mkdir(path.join(projectDirectory, "node_modules", "ignored"), {
      recursive: true
    });
    await writeFile(path.join(projectDirectory, "AGENTS.md"), "# Atlas");
    await writeFile(path.join(projectDirectory, ".env"), "SECRET=value");
    await writeFile(
      path.join(projectDirectory, ".codex", "agents", "analyse.toml"),
      "name = \"Analyse\""
    );
    await writeFile(
      path.join(projectDirectory, "node_modules", "ignored", "index.js"),
      "module.exports = {};"
    );

    const archive = await createArchive(projectDirectory);
    const imported = await readCortexProjectArchive("Atlas.ctx", archive);
    const importedUtf8Name = await readCortexProjectArchive(
      "Atlas Ã©ditorial.ctx",
      archive
    );

    assert.equal(imported.projectName, "Atlas");
    assert.equal(importedUtf8Name.projectName, "Atlas éditorial");
    assert.deepEqual(
      imported.files.map((file) => file.relativePath).sort(),
      [".codex/agents/analyse.toml", "AGENTS.md"]
    );
    assert.equal(
      imported.files.find((file) => file.relativePath === "AGENTS.md")
        ?.content.toString(),
      "# Atlas"
    );
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

test("refuse un fichier .ctx qui n'est pas une archive ZIP", async () => {
  await assert.rejects(
    readCortexProjectArchive("Atlas.ctx", Buffer.from("not a zip")),
    /not a valid Cortex archive/
  );
});

test("exige l'extension .ctx", async () => {
  await assert.rejects(
    readCortexProjectArchive("Atlas.zip", Buffer.alloc(0)),
    /must use the \.ctx extension/
  );
});

async function createArchive(directoryPath: string): Promise<Buffer> {
  const chunks: Buffer[] = [];
  const destination = new Writable({
    write(chunk: Buffer, _encoding, callback) {
      chunks.push(Buffer.from(chunk));
      callback();
    }
  });

  await writeCortexProjectArchive(directoryPath, destination);
  return Buffer.concat(chunks);
}
