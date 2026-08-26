import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import test from "node:test";
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
