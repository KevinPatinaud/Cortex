import assert from "node:assert/strict";
import { test } from "node:test";
import { createCodexProgress } from "./ExecutionProgress.ts";

test("Codex session is reported from streamed events before a turn finishes, including split chunks", () => {
  const sessions: string[] = [], progress: string[] = [];
  const report = createCodexProgress(text => progress.push(text), id => sessions.push(id));
  report('{"type":"thread.started","thread_');
  report('id":"session-one"}\n');
  report('{"type":"item.completed","item":{"type":"agent_message","text":"Answer"}}\n');
  assert.deepEqual(sessions, ["session-one"]);
  assert.equal(progress.at(-1), "Answer");
});
