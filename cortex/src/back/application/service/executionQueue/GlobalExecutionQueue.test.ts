import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { GlobalExecutionQueue, ExecutionSlotUnavailableError } from "./GlobalExecutionQueue.ts";

const gate = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };
test("simultaneous strict-slot admissions reserve atomically and never join the waiting queue", async () => fixture(async queue => {
  const wait = gate(), starts: string[] = [];
  const first = queue.run({ source: "work-light", label: "A", key: "a", waitForSlot: false }, async () => { starts.push("A"); await wait.promise; });
  const second = queue.run({ source: "work-light", label: "B", key: "b", waitForSlot: false }, async () => { starts.push("B"); });
  await assert.rejects(second, ExecutionSlotUnavailableError); assert.deepEqual(starts, ["A"]);
  assert.equal((await queue.status()).waiting.length, 0); wait.resolve(); await first;
}));
async function until(check: () => boolean | Promise<boolean>) {
  for (let index = 0; index < 200; index++) { if (await check()) return; await delay(5); }
  assert.fail("Queue did not reach expected state");
}
async function fixture(run: (queue: GlobalExecutionQueue, file: string) => Promise<void>) {
  const directory = await mkdtemp(path.join(tmpdir(), "cortex-global-queue-")), file = path.join(directory, "config.json");
  const queue = new GlobalExecutionQueue(file);
  try { await run(queue, file); }
  finally { queue.stop(); assert.equal(path.dirname(path.resolve(directory)), path.resolve(tmpdir())); assert.ok(path.basename(directory).startsWith("cortex-global-queue-")); await rm(directory, { recursive:true, force:true }); }
}

test("one FIFO serves Work Force, normal agents and prompts without overlap", async () => fixture(async queue => {
  await queue.saveSettings({ allowParallelExecutions:false });
  const order: string[] = [], first = gate(), second = gate(); let active = 0, maximum = 0;
  const run = (name: string, source: "work-force" | "normal" | "prompt", wait?: Promise<void>) => queue.run({source,label:name},async () => {
    active++; maximum = Math.max(active,maximum); order.push(name);
    if (wait) await wait; active--;
  });
  const a = run("A","work-force",first.promise); await until(() => order.length === 1);
  const b = run("B","normal",second.promise), c = run("C","prompt");
  await until(async () => (await queue.status()).waiting.length === 2);
  assert.deepEqual(order,["A"]); first.resolve(); await a; await until(() => order.length === 2);
  assert.deepEqual(order,["A","B"]); second.resolve(); await Promise.all([b,c]);
  assert.deepEqual(order,["A","B","C"]); assert.equal(maximum,1);
  assert.equal(queue.hasExecutions(),false);
}));

test("admission is rechecked after waiting while an already admitted agent can finish its interpretation", async () => fixture(async queue => {
  let suspended = false;
  queue.setAdmissionGuard(entry => { if (suspended && entry.source === "normal") throw new Error("Work Force active"); });
  const wait = gate(), order: string[] = [];
  const first = queue.run({ source: "normal", label: "Started agent", key: "started" }, async () => {
    order.push("mission"); await wait.promise;
    await queue.run({ source: "internal", label: "Interpretation" }, async () => { order.push("interpretation"); });
  });
  await until(() => order.length === 1);
  const queued = queue.run({ source: "normal", label: "Queued agent" }, async () => assert.fail("Normal agent ran during Work Force"));
  const rejected = assert.rejects(queued, /Work Force active/);
  const selected = queue.run({ source: "work-force", label: "Selected agent" }, async () => { order.push("work-force"); });
  await until(async () => (await queue.status()).waiting.length === 2);
  suspended = true; wait.resolve();
  await Promise.all([first, rejected, selected]);
  assert.deepEqual(order, ["mission", "interpretation", "work-force"]);
  await queue.saveSettings({ allowParallelExecutions: true });
  await assert.rejects(queue.run({ source: "normal", label: "Parallel normal" }, async () => assert.fail()), /Work Force active/);
  suspended = false;
  await queue.run({ source: "normal", label: "After stop" }, async () => { order.push("normal-resumed"); });
  assert.equal(queue.hasExecutions(), false);
}));

test("mission and interpretation retain the same agent reservation; nested provider calls do not deadlock", async () => fixture(async queue => {
  await queue.saveSettings({allowParallelExecutions:false});
  const phases: string[] = [], mission = gate();
  const agent = queue.run({source:"normal",label:"Agent",key:"agent"},async () => {
    await queue.run({source:"internal",label:"Mission"},async () => { phases.push("mission"); await mission.promise; });
    await queue.run({source:"internal",label:"Interpretation"},async () => { phases.push("interpretation"); assert.equal((await queue.status()).active.length,1); });
    phases.push("checks");
  });
  await until(() => phases.length === 1);
  const prompt = queue.run({source:"prompt",label:"Prompt"},async () => { phases.push("prompt"); });
  mission.resolve(); await Promise.all([agent,prompt]);
  assert.deepEqual(phases,["mission","interpretation","checks","prompt"]);
}));

test("parallel mode runs different agents, serializes identical keys, and disabling drains active runs", async () => fixture(async queue => {
  await queue.saveSettings({allowParallelExecutions:false});
  const aGate=gate(), bGate=gate(), order:string[]=[];
  const a=queue.run({source:"normal",label:"A",key:"a"},async()=>{order.push("a");await aGate.promise;});
  await until(()=>order.length===1);
  const duplicate=queue.run({source:"work-force",label:"A again",key:"a"},async()=>{order.push("a2");});
  const b=queue.run({source:"prompt",label:"B",key:"b"},async()=>{order.push("b");await bGate.promise;});
  await queue.saveSettings({allowParallelExecutions:true}); await until(()=>order.includes("b"));
  assert.deepEqual(order,["a","b"]);
  await queue.saveSettings({allowParallelExecutions:false}); aGate.resolve(); await a;
  assert.deepEqual(order,["a","b"]); bGate.resolve(); await Promise.all([b,duplicate]);
  assert.deepEqual(order,["a","b","a2"]);
}));

test("cancellation removes pending requests and shutdown rejects the queue", async () => fixture(async queue => {
  await queue.saveSettings({allowParallelExecutions:false}); const blocker=gate(), started=gate(), controller=new AbortController();
  const active=queue.run({source:"normal",label:"Active"},async()=>{started.resolve();await blocker.promise;}); await started.promise;
  const cancelled=queue.run({source:"work-force",label:"Cancelled",signal:controller.signal},async()=>assert.fail("Cancelled job ran"));
  const refused=assert.rejects(cancelled,{name:"AbortError"}); controller.abort(); await refused;
  const waiting=queue.run({source:"prompt",label:"Waiting"},async()=>assert.fail("Stopped job ran"));
  const stopped=assert.rejects(waiting,{name:"AbortError"}); await until(async()=>(await queue.status()).waiting.length===1);
  queue.stop(); await stopped; blocker.resolve(); await active;
  assert.equal(queue.hasExecutions(),false);
}));

test("settings persist independently of project, quota and workflow configuration", async () => fixture(async (queue,file) => {
  await writeFile(file,JSON.stringify({projects:[{id:"retained"}],codexQuota:{enabled:true},workForce:{keep:true}}));
  await queue.saveSettings({allowParallelExecutions:false});
  const restored=new GlobalExecutionQueue(file);
  assert.equal((await restored.status()).settings.allowParallelExecutions,false);
  assert.deepEqual(JSON.parse(await readFile(file,"utf8")).projects,[{id:"retained"}]);
  for (const allowParallelExecutions of [null,1,"false",undefined]) await assert.rejects(queue.saveSettings({allowParallelExecutions}));
  restored.stop();
}));
