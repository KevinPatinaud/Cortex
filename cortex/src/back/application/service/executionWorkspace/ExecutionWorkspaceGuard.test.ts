import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { ExecutionWorkspaceGuard, ExecutionWorkspaceBusyError, verifyWorkspace, type ExecutionWorkspace } from "./ExecutionWorkspaceGuard.ts";

const execute = promisify(execFile);

async function fixture(verify: ConstructorParameters<typeof ExecutionWorkspaceGuard>[2] = async () => {},
  readCheckpoint?: (checkpointId: string) => unknown) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cortex-workspace-"));
  const configuration = path.join(directory, "config.json");
  const journals = path.join(directory, "journals");
  await writeFile(configuration, JSON.stringify({ projects: [{ id: "a" }, { id: "b" }],
    executionWorkspaces: [{ id: "site", directory, projectIds: ["a", "b"], git: { branch: "main", remote: "origin" } }] }));
  return { directory, configuration, journals, guard: () => new ExecutionWorkspaceGuard(configuration, journals, verify, readCheckpoint),
    close: () => rm(directory, { recursive: true, force: true }) };
}

function waitingCheckpoint() {
  const now = "2026-10-24T05:00:00.000Z";
  return { instance: { id: "request", status: "waiting", startedAt: now, executionCount: 1, consumedEventIds: [] },
    parameterValues: {}, agents: [{ id: "agent", execution: { status: "waiting" }, failedThreadIds: [], threads: [{
      id: "thread", sessionId: "session", conversation: [], upstreamItems: [], wait: { id: "wait", createdAt: now,
        wakeAt: null, reason: "pending reply", eventKey: "reply", wakeAfterSeconds: null,
        deadlineAt: "2026-10-25T05:00:00.000Z", state: "request sent once" }
    }] }] };
}

test("explicit project-managed parallelism allows different agents to share a repository without overwriting the shared journal", async () => {
  let verificationCalls = 0;
  const f = await fixture(async () => { verificationCalls++; });
  try {
    const guard = new ExecutionWorkspaceGuard(f.configuration, f.journals, async () => { verificationCalls++; }, undefined, () => true);
    let active = 0, maximum = 0;
    let release!: () => void;
    const wait = new Promise<void>(resolve => { release = resolve; });
    const first = guard.run("a", async () => { active++; maximum = Math.max(maximum, active); await guard.markStarted(); await wait; active--; });
    await guard.run("b", async () => { active++; maximum = Math.max(maximum, active); await guard.markStarted(); release(); active--; });
    await first;
    assert.equal(maximum, 2); assert.equal(verificationCalls, 0);
    assert.equal(await guard.recoveryProjectId("b"), undefined);
    assert.equal(guard.hasActiveExecutions(), false);
    await assert.rejects(readFile(f.journals), { code: "ENOENT" });
  } finally { await f.close(); }
});

test("projects selecting the same execution repository share a lease even without an explicit workspace mapping", async () => {
  const f = await fixture();
  try {
    await writeFile(f.configuration, JSON.stringify({ projects: [{ id: "a" }, { id: "b" }], executionPolicies: {
      a: { workspaceDirectory: f.directory }, b: { workspaceDirectory: f.directory }
    } }));
    const guard = f.guard();
    await guard.run("a", async () => {
      await guard.markStarted();
      await assert.rejects(guard.run("b", async () => assert.fail("concurrent writer")), ExecutionWorkspaceBusyError);
    });
    await guard.run("b", async () => { await guard.markStarted(); });
  } finally { await f.close(); }
});

test("a profile cannot bypass an existing shared repository's checks by selecting another directory", async () => {
  const f = await fixture();
  try {
    const c = JSON.parse(await readFile(f.configuration, "utf8"));
    c.executionPolicies = { a: { workspaceDirectory: path.dirname(f.directory) } };
    await writeFile(f.configuration, JSON.stringify(c));
    await assert.rejects(f.guard().run("a", async () => assert.fail("wrong checkout")), /doit correspondre/);
  } finally { await f.close(); }
});

test("a published WAIT relinquishes the resource while its business checkpoint remains waiting", async () => {
  const checkpoint = waitingCheckpoint();
  const f = await fixture(async () => {}, () => checkpoint);
  try {
    const guard = f.guard();
    await guard.run("a", async () => { await guard.markStarted(); await guard.checkpointWaiting("instance:request"); });
    assert.equal(checkpoint.instance.status, "waiting");
    assert.equal(await guard.recoveryProjectId("b"), undefined);
    await guard.run("b", async () => { await guard.markStarted(); });
  } finally { await f.close(); }
});

test("manual intermediate work is recoverable and never becomes an unwakeable WAIT", async () => {
  const f = await fixture();
  try {
    const guard = f.guard();
    await guard.run("a", async () => { await guard.markStarted(); guard.markInterrupted(); });
    assert.equal(await guard.recoveryProjectId("b"), "a");
    await guard.run("a", async () => { await guard.markStarted(); });
    await guard.run("b", async () => { await guard.markStarted(); });
  } finally { await f.close(); }
});

for (const ended of ["cancelled", "reset"] as const) test(`${ended} legacy WAIT cannot strand a dirty workspace; recovery only closes existing effects`, async () => {
  let checkpoint: ReturnType<typeof waitingCheckpoint> | null = waitingCheckpoint();
  let dirty = true;
  const f = await fixture(async (_workspace, phase) => { if (phase === "finish" && dirty) throw new Error("unpublished source"); },
    key => { assert.equal(key, "instance:request"); return checkpoint; });
  try {
    const guard = f.guard();
    await guard.run("a", async () => { await guard.markStarted(); await guard.checkpointWaiting("instance:request"); });
    assert.equal(await guard.recoveryProjectId("b"), undefined, "A legitimate dirty WAIT keeps its owner until wake or cancellation");
    if (ended === "reset") checkpoint = null;
    else checkpoint!.instance.status = "cancelled";
    const restarted = f.guard();
    assert.equal(await restarted.recoveryProjectId("b"), "a");
    await restarted.run("a", async () => {
      assert.match(restarted.recoveryInstructions(), /sans poursuivre l'objectif annulé/);
      await restarted.markStarted();
      dirty = false;
    });
    await restarted.run("b", async () => { await restarted.markStarted(); });
  } finally { await f.close(); }
});

test("a clean orphan WAIT is released after reset without starting a recovery task", async () => {
  const f = await fixture(async () => {}, () => null);
  try {
    const guard = f.guard();
    await guard.run("a", async () => { await guard.markStarted(); guard.markWaiting(); });
    assert.equal(await guard.recoveryProjectId("b"), undefined);
    await guard.run("b", async () => { await guard.markStarted(); });
  } finally { await f.close(); }
});

for (const removal of ["project", "mapping"] as const) test(`deleted ${removal} owner transfers cleanup responsibility without redirecting to a missing project`, async () => {
  const f = await fixture();
  try {
    const guard = f.guard();
    await assert.rejects(guard.run("a", async () => { await guard.markStarted(); throw new Error("unpublished changes"); }));
    const config = JSON.parse(await readFile(f.configuration, "utf8"));
    if (removal === "project") config.projects = [{ id: "b" }];
    else config.executionWorkspaces[0].projectIds = ["b"];
    await writeFile(f.configuration, JSON.stringify(config));
    const restarted = f.guard();
    assert.equal(await restarted.recoveryProjectId("b"), "b");
    await restarted.run("b", async () => {
      assert.match(restarted.recoveryInstructions(), /Projet d'origine : a/);
      assert.match(restarted.recoveryInstructions(), /sans poursuivre l'objectif annulé/);
      await restarted.markStarted();
    });
    assert.equal(await restarted.recoveryProjectId("b"), undefined);
  } finally { await f.close(); }
});

test("journal I/O errors release the in-memory lease and cannot poison subsequent runs", async () => {
  const f = await fixture();
  try {
    await writeFile(f.journals, "not a directory");
    const guard = f.guard();
    await assert.rejects(guard.run("a", async () => { await guard.markStarted(); }));
    assert.equal(guard.hasActiveExecutions(), false);
    await rm(f.journals);
    await guard.run("b", async () => { await guard.markStarted(); });
  } finally { await f.close(); }
});

test("a deleted waiting owner cannot leave a permanent reservation for a project that will never wake", async () => {
  const checkpoint = waitingCheckpoint();
  let dirty = true;
  const f = await fixture(async (_workspace, phase) => { if (phase === "finish" && dirty) throw new Error("unpublished source"); }, () => checkpoint);
  try {
    const guard = f.guard();
    await guard.run("a", async () => { await guard.markStarted(); await guard.checkpointWaiting("a"); });
    const config = JSON.parse(await readFile(f.configuration, "utf8"));
    config.projects = [{ id: "b" }];
    await writeFile(f.configuration, JSON.stringify(config));
    assert.equal(await guard.recoveryProjectId("b"), "b");
    await guard.run("b", async () => {
      assert.match(guard.recoveryInstructions(), /sans poursuivre l'objectif annulé/);
      await guard.markStarted();
      dirty = false;
    });
    assert.equal(await guard.recoveryProjectId("b"), undefined);
  } finally { await f.close(); }
});

test("opposing nested resource acquisitions fail immediately rather than forming a wait cycle", { timeout: 10_000 }, async () => {
  const f = await fixture();
  try {
    const second = path.join(f.directory, "second");
    await mkdir(second);
    await writeFile(f.configuration, JSON.stringify({ executionWorkspaces: [
      { id: "first", directory: f.directory, projectIds: ["a"] },
      { id: "second", directory: second, projectIds: ["b"] }
    ] }));
    const guard = f.guard();
    let entered = 0, attempted = 0, ready!: () => void, done!: () => void;
    const bothReady = new Promise<void>(resolve => { ready = resolve; });
    const bothDone = new Promise<void>(resolve => { done = resolve; });
    await Promise.all(["a", "b"].map(owner => guard.run(owner, async () => {
      if (++entered === 2) ready();
      await bothReady;
      await assert.rejects(guard.run(owner === "a" ? "b" : "a", async () => assert.fail("acquired conflicting resource")), ExecutionWorkspaceBusyError);
      if (++attempted === 2) done();
      await bothDone;
    })));
    assert.equal(guard.hasActiveExecutions(), false);
  } finally { await f.close(); }
});

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

test("a clean stale checkout fast-forwards under its lease; unsafe histories and untracked collisions preserve existing work", async (t) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cortex-git-sync-"));
  const remote = path.join(directory, "remote.git");
  const repository = path.join(directory, "site");
  const writer = path.join(directory, "writer");
  const configuration = path.join(directory, "config.json");
  const git = async (cwd: string, ...args: string[]) => (await execute("git", ["-C", cwd, ...args], { windowsHide: true })).stdout.trim();
  const workspace: ExecutionWorkspace = { id: "site", directory: repository, projectIds: ["a", "b"], git: { branch: "main", remote: "origin" } };
  try {
    await git(directory, "init", "--bare", remote);
    await git(directory, "init", "-b", "main", repository);
    await git(repository, "config", "user.name", "Test Agent");
    await git(repository, "config", "user.email", "test@example.invalid");
    await writeFile(path.join(repository, "page.txt"), "initial");
    await git(repository, "add", "page.txt");
    await git(repository, "commit", "-m", "initial");
    await git(repository, "remote", "add", "origin", remote);
    await git(repository, "push", "origin", "main");
    await git(directory, "clone", "--branch", "main", remote, writer);
    await git(writer, "config", "user.name", "External Author");
    await git(writer, "config", "user.email", "external@example.invalid");
    const publish = async (file: string, content: string) => {
      await writeFile(path.join(writer, file), content);
      await git(writer, "add", file);
      await git(writer, "commit", "-m", `external ${file}`);
      await git(writer, "push", "origin", "main");
      return git(writer, "rev-parse", "HEAD");
    };
    const initial = await git(repository, "rev-parse", "HEAD");
    const first = await publish("external.txt", "new on GitHub");
    await writeFile(path.join(repository, "AGENTS.md"), "private local instructions");
    await writeFile(configuration, JSON.stringify({ executionWorkspaces: [workspace] }));
    const guard = new ExecutionWorkspaceGuard(configuration, path.join(directory, "journals"));
    await t.test("stale tracking refs cannot hide remote changes; finish never pulls", async () => {
      assert.equal(await git(repository, "rev-parse", "origin/main"), initial);
      await assert.rejects(verifyWorkspace(workspace, "finish", false), /push/);
      assert.equal(await git(repository, "rev-parse", "HEAD"), initial);
      await guard.run("a", async () => {
        await guard.markStarted();
        assert.equal(await git(repository, "rev-parse", "HEAD"), first, "the mission starts on the published revision");
        assert.equal(await readFile(path.join(repository, "external.txt"), "utf8"), "new on GitHub");
      });
      assert.equal(await guard.recoveryProjectId("b"), undefined);
      assert.equal(await readFile(path.join(repository, "AGENTS.md"), "utf8"), "private local instructions");
    });
    const second = await publish("external.txt", "second update");
    await t.test("dirty work and recovery are never pulled over", async () => {
      await writeFile(path.join(repository, "page.txt"), "unfinished local work");
      await assert.rejects(verifyWorkspace(workspace, "start", false), /modifications/);
      await verifyWorkspace(workspace, "start", true);
      assert.equal(await git(repository, "rev-parse", "HEAD"), first);
      assert.equal(await readFile(path.join(repository, "page.txt"), "utf8"), "unfinished local work");
      await writeFile(path.join(repository, "page.txt"), "initial");
      await verifyWorkspace(workspace, "start", true);
      assert.equal(await git(repository, "rev-parse", "HEAD"), first, "recovery retains its original source revision");
      await verifyWorkspace(workspace, "start", false);
      assert.equal(await git(repository, "rev-parse", "HEAD"), second);
    });
    for (const name of ["collision.txt", "ignored-collision.txt"]) await t.test(`a newly tracked path never overwrites existing local data: ${name}`, async () => {
      await writeFile(path.join(repository, ".git", "info", "exclude"), "ignored-collision.txt\n");
      const before = await git(repository, "rev-parse", "HEAD");
      await writeFile(path.join(repository, name), "keep local data");
      await publish(name, "remote data");
      await assert.rejects(verifyWorkspace(workspace, "start", false));
      assert.equal(await git(repository, "rev-parse", "HEAD"), before);
      assert.equal(await readFile(path.join(repository, name), "utf8"), "keep local data");
      await rm(path.join(repository, name));
      await verifyWorkspace(workspace, "start", false);
    });
    await t.test("local-only and diverged commits are neither pushed nor rewritten", async () => {
      await writeFile(path.join(repository, "page.txt"), "committed local work");
      await git(repository, "commit", "-am", "local work");
      const local = await git(repository, "rev-parse", "HEAD");
      const before = await git(writer, "rev-parse", "HEAD");
      await assert.rejects(verifyWorkspace(workspace, "start", false), /commits locaux.*push/);
      assert.equal(await git(repository, "rev-parse", "HEAD"), local);
      assert.equal((await git(repository, "ls-remote", "origin", "refs/heads/main")).split(/\s+/)[0], before);
      const divergent = await publish("external.txt", "divergent update");
      await assert.rejects(verifyWorkspace(workspace, "start", false), /ont divergé/);
      assert.equal(await git(repository, "rev-parse", "HEAD"), local);
      assert.equal((await git(repository, "ls-remote", "origin", "refs/heads/main")).split(/\s+/)[0], divergent);
      assert.equal(await readFile(path.join(repository, "page.txt"), "utf8"), "committed local work");
      await git(repository, "remote", "set-url", "origin", path.join(directory, "missing.git"));
      await assert.rejects(verifyWorkspace(workspace, "start", false));
      assert.equal(await git(repository, "rev-parse", "HEAD"), local);
    });
  } finally { await rm(directory, { recursive: true, force: true }); }
});
