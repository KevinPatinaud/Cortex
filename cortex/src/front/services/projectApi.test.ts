import assert from "node:assert/strict";
import test from "node:test";
import { prepareProjectDirectoryUpload } from "./projectApi.ts";

function browserFile(relativePath: string, size = 12): File {
  return { name: relativePath.split("/").at(-1), webkitRelativePath: relativePath, size } as File;
}

test("browser uploads apply the same generated-file and credential exclusions as archives", () => {
  const result = prepareProjectDirectoryUpload([
    "Atlas/AGENTS.md", "Atlas/.env", "Atlas/.env.example", "Atlas/.codex/auth.json",
    "Atlas/.git/config", "Atlas/src/index.ts", "Atlas/server.key"
  ].map((relativePath) => browserFile(relativePath)));
  assert.equal(result.projectName, "Atlas");
  assert.deepEqual(result.files.map((entry) => entry.relativePath), ["AGENTS.md", ".env.example", "src/index.ts"]);
});

test("browser uploads reject files that exceed server transfer limits", () => {
  assert.throws(() => prepareProjectDirectoryUpload([
    browserFile("Atlas/AGENTS.md"), browserFile("Atlas/large.bin", 20 * 1024 * 1024 + 1)
  ]), /20 MB limit/);
});
