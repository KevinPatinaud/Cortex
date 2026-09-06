import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { CliAgentProvider } from "./CliAgentProvider.ts";
import type { AgentExecutionOptions } from "./AgentProvider.ts";
import { createCodexProgress, createTextProgress } from "./ExecutionProgress.ts";

class LocalProcessProvider extends CliAgentProvider {
  run(script: string, options: AgentExecutionOptions = {}, timeout = 5_000) {
    return this.runCommand(process.execPath, ["-e", script], timeout, undefined, undefined, options);
  }
}

test("reports output before completion and stops a cancelled CLI", async () => {
  const provider = new LocalProcessProvider(process.cwd());
  const controller = new AbortController();
  const chunks: string[] = [];
  const result = provider.run("process.stdout.write('working'); setInterval(() => {}, 1000);", {
    signal: controller.signal,
    onProgress: (text) => { chunks.push(text); controller.abort(); }
  });
  await assert.rejects(result, { name: "AbortError" });
  assert.equal(chunks.join(""), "working");
});

test("does not start a process with an already cancelled signal", async () => {
  const provider = new LocalProcessProvider(process.cwd());
  await assert.rejects(provider.run("process.exit(0)", {
    signal: AbortSignal.abort()
  }), { name: "AbortError" });
});

test("enforces an execution timeout", async () => {
  const provider = new LocalProcessProvider(process.cwd());
  await assert.rejects(provider.run("setInterval(() => {}, 1000)", {}, 50), /timed out/);
});

test("kills a tool that ignores SIGTERM after its CLI has already exited", {
  skip: process.platform === "win32" ? "POSIX process-group escalation" : false,
  timeout: 8_000
}, async () => {
  const provider = new LocalProcessProvider(process.cwd());
  const controller = new AbortController();
  let cliPid: number | undefined;
  let toolPid: number | undefined;
  let output = "";
  // Only this fixture's child group is ever signalled. The tool also expires
  // on its own as a fallback if the test runner is stopped during the test.
  const toolScript = [
    "process.on('SIGTERM', () => {});",
    "process.send('ready');",
    "setInterval(() => {}, 1000);",
    "setTimeout(() => process.exit(0), 10000);"
  ].join("\n");
  const cliScript = [
    "const { spawn } = require('node:child_process');",
    "console.log('CLI:' + process.pid);",
    `const tool = spawn(process.execPath, ['-e', ${JSON.stringify(toolScript)}], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'] });`,
    "console.log('TOOL:' + tool.pid);",
    "tool.once('message', () => console.log('READY'));"
  ].join("\n");

  try {
    await assert.rejects(provider.run(cliScript, {
      signal: controller.signal,
      onProgress(chunk) {
        output += chunk;
        const cliMatch = /CLI:(\d+)/.exec(output);
        const toolMatch = /TOOL:(\d+)/.exec(output);
        if (cliMatch) cliPid = Number(cliMatch[1]);
        if (toolMatch) toolPid = Number(toolMatch[1]);
        if (output.includes("READY\n")) controller.abort();
      }
    }), { name: "AbortError" });
    assert.ok(cliPid && toolPid, "The fixture must report its own process IDs.");
    const deadline = Date.now() + 3_000;
    while (await isFixtureProcessRunning(toolPid) && Date.now() < deadline) {
      await delay(25);
    }
    assert.equal(await isFixtureProcessRunning(toolPid), false,
      "The tool must receive SIGKILL even after the CLI has closed its pipes.");
  } finally {
    controller.abort();
    if (cliPid && Number.isSafeInteger(cliPid) && cliPid > 1 && cliPid !== process.pid) {
      try { process.kill(-cliPid, "SIGKILL"); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
      }
    }
  }
});

async function isFixtureProcessRunning(pid: number): Promise<boolean> {
  try {
    process.kill(pid, 0);
    if (process.platform === "linux") {
      const state = await readFile(`/proc/${pid}/stat`, "utf8");
      // Minimal containers may defer reaping an orphan. A zombie has already
      // stopped executing and cannot keep modifying the user's files.
      if (state[state.lastIndexOf(")") + 2] === "Z") return false;
    }
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ESRCH" || code === "ENOENT") return false;
    throw error;
  }
}

test("decodes split Codex events without exposing raw events or tool output", () => {
  const updates: string[] = [];
  const report = createCodexProgress((text) => updates.push(text));
  const event = JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "Working" } });
  report(event.slice(0, 20));
  assert.deepEqual(updates, []);
  report(event.slice(20) + "\n");
  report(JSON.stringify({ type: "item.completed", item: { type: "command_execution", aggregated_output: "private tool output" } }) + "\n");
  assert.deepEqual(updates, ["Working", ""]);
});

test("bounds the live text preview", () => {
  let latest = "";
  const report = createTextProgress((text) => { latest = text; });
  report("x".repeat(5_000));
  report("end");
  assert.equal(latest.length, 4_000);
  assert.ok(latest.endsWith("end"));
});
