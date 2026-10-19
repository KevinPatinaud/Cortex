import assert from "node:assert/strict";
import test from "node:test";
import { readCodexRateLimits } from "./CodexRateLimits.ts";

test("CLI quota reader initializes, waits, and reads limits without starting a thread or turn", async () => {
  const script = `
    const {createInterface} = require('node:readline');
    let initialized = false;
    const input = createInterface({input: process.stdin});
    input.on('line', line => {
      const m = JSON.parse(line);
      if (m.method === 'initialize') {
        if (!m.params.clientInfo.name) process.exit(2);
        console.log('non-JSON diagnostic'); console.log('null');
        const response = JSON.stringify({id:m.id, result:{serverInfo:{}}}) + '\\n';
        process.stdout.write(response.slice(0, 5));
        setTimeout(() => process.stdout.write(response.slice(5)), 5);
      } else if (m.method === 'initialized') initialized = true;
      else if (m.method === 'account/rateLimits/read' && initialized) {
        console.log(JSON.stringify({method:'account/updated',params:{}}));
        console.log(JSON.stringify({id:m.id,result:{rateLimits:{limitId:'codex'}}}));
      } else process.exit(3);
    });
  `;
  assert.deepEqual(await readCodexRateLimits(process.cwd(), {
    command: process.execPath, args: ["--eval", script, "--"]
  }), { rateLimits: { limitId: "codex" } });
});

test("CLI RPC failures, premature exits, missing executables and timeouts are bounded and sanitized", async () => {
  for (const script of ["process.exit(0)",
    `require('node:readline').createInterface({input:process.stdin}).on('line', () => console.log(JSON.stringify({id:1,error:{message:'sensitive'}})))`]) {
    await assert.rejects(readCodexRateLimits(process.cwd(), { command: process.execPath, args: ["--eval", script, "--"] }),
      error => error instanceof Error && !error.message.includes("sensitive"));
  }
  await assert.rejects(readCodexRateLimits(process.cwd(), { command: "cortex-nonexistent-codex-quota", args: [] }), /unavailable/);
  await assert.rejects(readCodexRateLimits(process.cwd(), {
    command: process.execPath, args: ["--eval", "setInterval(() => {}, 1000)", "--"]
  }, 100), /timed out/);
});
