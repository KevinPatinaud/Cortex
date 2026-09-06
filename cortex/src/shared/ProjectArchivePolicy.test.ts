import assert from "node:assert/strict";
import test from "node:test";
import { assertProjectFileManifest, isExcludedProjectPath, isPortableProjectPath } from "./ProjectArchivePolicy.ts";

test("enforces importable file counts and aggregate extracted size", () => {
  assert.throws(() => assertProjectFileManifest(Array.from({ length: 2_001 }, (_, index) => ({
    relativePath: index ? `file-${index}.txt` : "AGENTS.md", size: 1
  }))), /between 1 and 2000/);
  assert.throws(() => assertProjectFileManifest([
    { relativePath: "AGENTS.md", size: 1 },
    ...Array.from({ length: 5 }, (_, index) => ({ relativePath: `file-${index}.bin`, size: 20 * 1024 * 1024 }))
  ]), /100 MB limit/);
});

test("rejects file-directory collisions, case duplicates and nonportable paths", () => {
  for (const paths of [["AGENTS.md", "agents.MD"], ["AGENTS.md", "src", "src/index.ts"]]) {
    assert.throws(() => assertProjectFileManifest(paths.map((relativePath) => ({ relativePath, size: 1 }))),
      /duplicated|conflicts/);
  }
  for (const relativePath of ["../outside", "/absolute", "a\\b", "file:stream", "NUL.txt", "folder./file"]) {
    assert.equal(isPortableProjectPath(relativePath), false, relativePath);
  }
  assert.equal(isExcludedProjectPath("nested/.env.production"), true);
  assert.equal(isExcludedProjectPath("nested/.env.example"), false);
  assert.equal(isExcludedProjectPath(".codex/auth.json"), true);
});
