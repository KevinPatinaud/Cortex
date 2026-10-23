import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { ExecutionWorkspaceGuard, ExecutionWorkspaceBusyError, verifyWorkspace, type ExecutionWorkspace } from "./ExecutionWorkspaceGuard.ts";

const execute = promisify(execFile);

async function fixture(verify: ConstructorParameters<typeof ExecutionWorkspaceGuard>[2] = async () => {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cortex-workspace-"));
  const configuration = path.join(directory, "config.json");
  const journals = path.join(directory, "journals");
  await writeFile(configuration, JSON.stringify({ executionWorkspaces: [{ id: "site", directory, projectIds: ["a", "b"] }] }));
  return { directory, journals, guard: () => new ExecutionWorkspaceGuard(configuration, journals, verify),
    close: () => rm(directory, { recursive: true, force: true }) };
}

test("shared checkout is exclusive across projects and reentrant for nested agents; unrelated projects run", async () => {
  const f = await fixture();
  try {
    const guard = f.guard();
    let release!: () => void;
    let entered!: () => void;
    const ready = new Promise<void>(resolve => { entered = resolve; });
    const pending = new Promise<void>(resolve => { release = resolve; });
    const run = guard.run("a", async () => {
      await guard.markStarted();
      await guard.run("a", async () => assert.equal(guard.recoveryInstructions(), ""));
      entered();
      await pending;
    });
    await ready;
    await assert.rejects(guard.run("b", async () => {}), ExecutionWorkspaceBusyError);
    await guard.run("unrelated", async () => {});
    release();
    await run;
    await guard.run("b", async () => { await guard.markStarted(); });
    assert.equal(await guard.recoveryProjectId("a"), undefined);
  } finally { await f.close(); }
});

test("quota or validation rejection before start leaves no pending intervention", async () => {
  const f = await fixture();
  try {
    const guard = f.guard();
    await assert.rejects(guard.run("a", async () => { throw new Error("quota"); }), /quota/);
    assert.equal(await guard.recoveryProjectId("b"), undefined);
    await assert.rejects(readdir(f.journals), { code: "ENOENT" });
    await guard.run("b", async () => { await guard.markStarted(); });
  } finally { await f.close(); }
});

test("failed work survives restart, blocks another owner and is completed by recovery", async () => {
  const f = await fixture();
  try {
    const guard = f.guard();
    await assert.rejects(guard.run("a", async () => { await guard.markStarted(); throw new Error("push unavailable"); }), /push unavailable/);
    const restarted = f.guard();
    assert.equal(await restarted.recoveryProjectId("b"), "a");
    await assert.rejects(restarted.run("b", async () => {}), ExecutionWorkspaceBusyError);
    await restarted.run("a", async () => {
      assert.match(restarted.recoveryInstructions(), /push unavailable/);
      await restarted.markStarted();
      await restarted.verifyBeforeSuccess();
    });
    assert.equal(await restarted.recoveryProjectId("b"), undefined);
    const journal = JSON.parse(await readFile(path.join(f.journals, (await readdir(f.journals))[0]), "utf8"));
    assert.equal(journal.status, "completed");
    assert.equal(journal.attempts, 2);
  } finally { await f.close(); }
});

test("stale running work is recovered; explicit WAIT remains reserved for its normal wake", async () => {
  const f = await fixture();
  try {
    const guard = f.guard();
    await guard.run("a", async () => { await guard.markStarted(); guard.markWaiting(); });
    assert.equal(await f.guard().recoveryProjectId("b"), undefined);
    await assert.rejects(f.guard().run("b", async () => {}), ExecutionWorkspaceBusyError);
    const file = path.join(f.journals, (await readdir(f.journals))[0]);
    const journal = JSON.parse(await readFile(file, "utf8"));
    await writeFile(file, JSON.stringify({ ...journal, status: "running" }));
    assert.equal(await f.guard().recoveryProjectId("b"), "a");
  } finally { await f.close(); }
});

test("a failed final verification retains recovery instead of reporting completion", async () => {
  const f = await fixture(async (_workspace, phase) => { if (phase === "finish") throw new Error("unpublished commit"); });
  try {
    const guard = f.guard();
    await assert.rejects(guard.run("a", async () => { await guard.markStarted(); }), /unpublished commit/);
    assert.equal(await f.guard().recoveryProjectId("b"), "a");
  } finally { await f.close(); }
});

test("actual Git checks accept an unchanged published checkout, reject dirt, an unpushed commit and a wrong branch", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cortex-git-check-"));
  const remote = path.join(directory, "remote.git");
  const repository = path.join(directory, "site");
  const git = async (...args: string[]) => execute("git", args, { windowsHide: true });
  try {
    await git("init", "--bare", remote);
    await git("init", "-b", "main", repository);
    await git("-C", repository, "config", "user.name", "Test Agent");
    await git("-C", repository, "config", "user.email", "test@example.invalid");
    await writeFile(path.join(repository, "page.txt"), "first");
    await git("-C", repository, "add", "page.txt");
    await git("-C", repository, "commit", "-m", "initial");
    await git("-C", repository, "remote", "add", "origin", remote);
    await git("-C", repository, "push", "origin", "main");
    const workspace: ExecutionWorkspace = { id: "site", directory: repository, projectIds: ["a"], git: { branch: "main", remote: "origin" } };
    await verifyWorkspace(workspace, "start", false);
    await verifyWorkspace(workspace, "finish", false);
    await writeFile(path.join(repository, "page.txt"), "changed");
    await assert.rejects(verifyWorkspace(workspace, "start", false), /modifications/);
    await verifyWorkspace(workspace, "start", true);
    await git("-C", repository, "commit", "-am", "change");
    await assert.rejects(verifyWorkspace(workspace, "finish", true), /push/);
    await git("-C", repository, "push", "origin", "main");
    await verifyWorkspace(workspace, "finish", true);
    await git("-C", repository, "checkout", "-b", "other");
    await assert.rejects(verifyWorkspace(workspace, "finish", false), /main/);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
