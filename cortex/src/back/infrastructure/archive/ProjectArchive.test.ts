import assert from "node:assert/strict";
import { mkdir, mkdtemp, open, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import test from "node:test";
import * as unzipper from "unzipper";
import { readCortexProjectArchive } from "./ProjectArchiveReader.ts";
import { ProjectService } from "../../application/service/projectService/ProjectService.ts";
import {
  getCortexArchiveFileName,
  writeCortexProjectArchive
} from "./ProjectArchive.ts";

test("produit un nom de fichier .ctx portable", () => {
  assert.equal(getCortexArchiveFileName("Mon projet"), "Mon projet.ctx");
  assert.equal(
    getCortexArchiveFileName("Projet: analyse?. "),
    "Projet- analyse-.ctx"
  );
  assert.equal(getCortexArchiveFileName("..."), "cortex-project.ctx");
  assert.equal(getCortexArchiveFileName("CON"), "cortex-project.ctx");
  assert.equal(getCortexArchiveFileName("a".repeat(150)), `${"a".repeat(120)}.ctx`);
});

test("excludes generated files and common credential files before a complete export-import round trip", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cortex-archive-roundtrip-"));
  const projectDirectory = path.join(directory, "Original");
  try {
    const sourceFiles = {
      "AGENTS.md": "project instructions",
      ".codex/agents/review.toml": 'name = "Review"\ndeveloper_instructions = "Review the project"',
      ".env.example": "TOKEN=replace-me",
      "src/index.ts": "export const answer = 42;",
      ".env": "TOKEN=secret",
      ".env.production": "TOKEN=secret",
      ".git/config": "secret remote URL",
      "node_modules/ignored/index.js": "generated",
      "dist/compiled.js": "generated",
      ".codex/auth.json": "secret authentication",
      ".ssh/id_ed25519": "private key",
      "server.key": "private key",
      "data/audit/cortex-audit.sqlite": "audit prompts",
      ".cortex-edit-test/recovery.json": "backup metadata"
    };
    for (const [relativePath, content] of Object.entries(sourceFiles)) {
      const destination = path.join(projectDirectory, ...relativePath.split("/"));
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, content);
    }
    const chunks: Buffer[] = [];
    await writeCortexProjectArchive(projectDirectory, new Writable({
      write(chunk: Buffer, _encoding, callback) { chunks.push(Buffer.from(chunk)); callback(); }
    }));
    const archive = Buffer.concat(chunks);
    const rawEntries = await unzipper.Open.buffer(archive);
    const expected = [".codex/agents/review.toml", ".env.example", "AGENTS.md", "src/index.ts"].sort();
    assert.deepEqual(rawEntries.files.filter((entry) => entry.type === "File").map((entry) => entry.path).sort(), expected);
    const imported = await readCortexProjectArchive("Restored.ctx", archive);
    const service = new ProjectService(path.join(directory, "config.json"));
    const result = await service.importProject(imported.projectName, imported.files);
    assert.deepEqual(imported.files.map((file) => file.relativePath).sort(), expected);
    for (const relativePath of expected) {
      assert.equal(await readFile(path.join(result.project.directoryPath, ...relativePath.split("/")), "utf8"),
        sourceFiles[relativePath as keyof typeof sourceFiles]);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("rejects an oversized file before sending archive bytes", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cortex-archive-limit-"));
  try {
    await writeFile(path.join(directory, "AGENTS.md"), "instructions");
    const file = await open(path.join(directory, "oversized.bin"), "w");
    await file.truncate(20 * 1024 * 1024 + 1);
    await file.close();
    let sentBytes = 0;
    const destination = new Writable({
      write(chunk: Buffer, _encoding, callback) { sentBytes += chunk.byteLength; callback(); }
    });
    await assert.rejects(writeCortexProjectArchive(directory, destination), /20 MB limit/);
    assert.equal(sentBytes, 0);
    assert.equal(destination.destroyed, false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("archive les fichiers du projet à la racine, y compris les fichiers cachés", async () => {
  const temporaryDirectory = await mkdtemp(
    path.join(os.tmpdir(), "cortex-project-archive-")
  );
  const projectDirectory = path.join(temporaryDirectory, "Atlas");

  try {
    await mkdir(path.join(projectDirectory, ".codex", "agents"), {
      recursive: true
    });
    await mkdir(path.join(projectDirectory, "empty"));
    await writeFile(path.join(projectDirectory, "AGENTS.md"), "# Atlas");
    await writeFile(
      path.join(projectDirectory, ".codex", "agents", "analyse.toml"),
      "name = \"Analyse\""
    );

    const chunks: Buffer[] = [];
    const destination = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        chunks.push(Buffer.from(chunk));
        callback();
      }
    });

    await writeCortexProjectArchive(projectDirectory, destination);

    const archive = Buffer.concat(chunks);
    const entryNames = readCentralDirectoryEntryNames(archive);

    assert.equal(archive.readUInt32LE(0), 0x04034b50);
    assert.ok(entryNames.includes("AGENTS.md"));
    assert.ok(entryNames.includes(".codex/agents/analyse.toml"));
    assert.ok(entryNames.includes("empty/"));
    assert.equal(entryNames.some((name) => name.startsWith("Atlas/")), false);
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true });
  }
});

function readCentralDirectoryEntryNames(archive: Buffer): string[] {
  const names: string[] = [];

  for (let offset = 0; offset <= archive.length - 46;) {
    if (archive.readUInt32LE(offset) !== 0x02014b50) {
      offset += 1;
      continue;
    }

    const nameLength = archive.readUInt16LE(offset + 28);
    const extraLength = archive.readUInt16LE(offset + 30);
    const commentLength = archive.readUInt16LE(offset + 32);
    const nameStart = offset + 46;
    names.push(archive.subarray(nameStart, nameStart + nameLength).toString());
    offset = nameStart + nameLength + extraLength + commentLength;
  }

  return names;
}
