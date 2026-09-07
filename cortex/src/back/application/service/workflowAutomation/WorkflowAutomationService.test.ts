import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { AgentUseCase } from "../../usecase/AgentUseCase.ts";
import type { ProjectUseCase, ProjectContentOutput } from "../../usecase/ProjectUseCase.ts";
import type { AgentService } from "../iaService/AgentService.ts";
import type { AgentExecutionOptions } from "../iaService/AgentProvider.ts";
import { WorkflowAuditService } from "../workflowAudit/WorkflowAuditService.ts";
import { SqliteWorkflowAuditRepository } from "../../../infrastructure/audit/SqliteWorkflowAuditRepository.ts";
import { SqliteWorkflowAutomationRepository } from "../../../infrastructure/automation/SqliteWorkflowAutomationRepository.ts";
import { WorkflowAutomationService } from "./WorkflowAutomationService.ts";
import { readWorkflowCheckpoint } from "../workflowExecution/WorkflowCheckpoint.ts";

const agentId = (name: string) => `.claude/agents/${name}.md`;
const response = (items: string[], next: string[] = [], wait?: unknown) => ({
  sessionId: randomUUID(), answer: JSON.stringify({ status: wait ? "waiting" : "success", items: items.map(content => ({ content })),
    nextAgentIds: next, isMultiSelectionAllowed: true, isMultiSelectionThreaded: false, notes: null, ...(wait ? { wait } : {}) })
});

async function fixture(unified = false, inferBranches = false) {
  const directory = await mkdtemp(path.join(tmpdir(), "cortex-automation-"));
  let keys = ["one", "two"];
  let failNegotiation = false;
  let blockNegotiation = false;
  let stallNegotiation = false;
  let deadline = new Date(Date.now() + 3600000).toISOString();
  let wakeAfterSeconds: number | null = null;
  let changedTemplate = false;
  let branchEnabled = true;
  const calls: Array<{ prompt: string; sessionId?: string }> = [];
  const configurations = new Map();
  const content = (id: string): ProjectContentOutput => ({ id, directoryPath: directory, root: {
    type: "directory", name: id, relativePath: "", children: [
      { type: "file", name: "CLAUDE.md", relativePath: "CLAUDE.md", size: 10, encoding: "utf8", content: `Execute this workflow.${branchEnabled ? "" : " Independent follow-up removed."}` },
      { type: "directory", name: ".claude", relativePath: ".claude", children: [
        { type: "directory", name: "agents", relativePath: ".claude/agents", children:
          (id === "source" ? unified ? ["scan", "negotiate", "final"] : ["scan"] : ["negotiate", "final"]).map(name => ({ type: "file", name: `${name}.md`,
            relativePath: agentId(name), size: 20, encoding: "utf8", content: `---\nname: ${name}\ndescription: ${name}\n---\nTASK_${changedTemplate && name === "negotiate" ? "CHANGED" : name.toUpperCase()}` })) }
      ] }
    ]
  } });
  const projects = {
    getProjects: async () => ["source", "target"].map(id => ({ id, directoryPath: directory })),
    getProjectContent: async (id: string) => content(id),
    getAgentWorkflowConfiguration: async (id: string) => configurations.get(id) ?? null,
    saveAgentWorkflowConfiguration: async (id: string, value: unknown) => { configurations.set(id, value); }
  } as unknown as ProjectUseCase;
  const provider = { execute: async (_engine: string, prompt: string, options: AgentExecutionOptions) => {
    if (!options.persistSession) {
      const context = JSON.parse(prompt.split("Context to analyze:\n")[1]);
      return { answer: JSON.stringify({ agents: context.agents.map((agent: { id: string }) => ({ id: agent.id,
        nextAgentIds: agent.id === agentId("negotiate") ? [agentId("final")] : [], inputMode: "separate" })),
        ...(inferBranches ? { dossierBranches: branchEnabled && context.agents.some((agent: {id: string}) => agent.id === agentId("scan")) ? [{ sourceAgentId: agentId("scan"), targetAgentId: agentId("negotiate") }] : [] } : {}),
        parameters: unified ? [{ id: "criteria", label: "Criteria", description: "", required: true, inputType: "text", placeholder: "", options: [] }] : [] }) };
    }
    calls.push({ prompt, sessionId: options.sessionId });
    if (prompt.includes("TASK_SCAN")) return response(keys.map(key => JSON.stringify({ key, title: key, payload: `Dossier ${key}` })));
    if (prompt.includes("TASK_NEGOTIATE")) {
      if (stallNegotiation) await new Promise((_resolve, reject) => {
        options.signal?.throwIfAborted();
        options.signal?.addEventListener("abort", () => reject(options.signal?.reason), { once: true });
      });
      if (failNegotiation) throw new Error("Provider unavailable");
      if (blockNegotiation && !prompt.includes("USER_CLARIFICATION")) return { sessionId: options.sessionId ?? randomUUID(), answer: JSON.stringify({
        status: "blocked", items: [{ content: "Le compte expéditeur et le mandat doivent être précisés." }], notes: "Aucun mail envoyé.",
        nextAgentIds: [], isMultiSelectionAllowed: false, isMultiSelectionThreaded: false
      }) };
      if (prompt.includes("Cortex durable workflow wake")) return response(["Finished"], prompt.includes("ACCEPTED") ? [agentId("final")] : []);
      return response(["Sent once"], [], { reason: "Waiting for reply", eventKey: "reply", wakeAfterSeconds, deadlineAt: deadline, state: "Initial email already sent." });
    }
    return response(["Final agent completed"]);
  } } as unknown as AgentService;
  const open = () => {
    const auditStore = new SqliteWorkflowAuditRepository(path.join(directory, "audit.sqlite"));
    const audit = new WorkflowAuditService(auditStore);
    const store = new SqliteWorkflowAutomationRepository(path.join(directory, "jobs.sqlite"));
    const agents = new AgentUseCase(provider, projects, audit);
    const service = new WorkflowAutomationService(store, agents, projects, audit, 2);
    return { auditStore, audit, store, agents, service, close: async () => { await service.stop(); store.close(); auditStore.close(); } };
  };
  return { open, calls, setKeys: (value: string[]) => { keys = value; }, setFail: (value: boolean) => { failNegotiation = value; },
    setBlocked: (value: boolean) => { blockNegotiation = value; },
    changeTemplate: () => { changedTemplate = true; },
    setBranchEnabled: (enabled: boolean) => { branchEnabled = enabled; },
    setStall: (value: boolean) => { stallNegotiation = value; },
    setWait: (value: number | null, at: string) => { wakeAfterSeconds = value; deadline = at; },
    cleanup: async () => {
      const resolved = path.resolve(directory);
      assert.equal(path.dirname(resolved), path.resolve(tmpdir()));
      assert.ok(path.basename(resolved).startsWith("cortex-automation-"));
      await rm(resolved, { recursive: true, force: true });
    } };
}

async function settle(f: ReturnType<Awaited<ReturnType<typeof fixture>>["open"]>, predicate: () => boolean, now?: Date) {
  for (let attempt = 0; attempt < 500; attempt++) {
    await f.service.tick(now);
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  assert.fail(`Dossiers did not reach the expected state: ${JSON.stringify(f.store.list("source").jobs.map(job => [job.key, job.status, job.error]))}`);
}

test("reactivating a paused rule never dispatches paused results on restart, but new scans still dispatch", async () => {
  const state = await fixture();
  let f = state.open();
  try {
    const rule = await f.service.saveRule("source", { sourceAgentId: agentId("scan"), targetProjectId: "target", enabled: false });
    await f.agents.runWorkflow("source");
    await new Promise(resolve => setTimeout(resolve, 5));
    await f.service.saveRule("source", { ...rule, enabled: true });
    await f.close();
    f = state.open();
    await f.service.start();
    assert.equal(f.store.list("source").total, 0);
    await f.agents.runWorkflow("source");
    await settle(f, () => f.store.list("source").jobs.filter(job => job.status === "waiting").length === 2);
  } finally { await f.close(); await state.cleanup(); }
});

test("independent dossiers survive database reopen, resume only on their own event and keep source state isolated", async () => {
  const fixtureState = await fixture();
  let f = fixtureState.open();
  try {
    await f.service.start();
    await f.service.saveRule("source", { sourceAgentId: agentId("scan"), targetProjectId: "target", enabled: true });
    await f.agents.runWorkflow("source");
    await settle(f, () => f.store.list("source").jobs.filter(job => job.status === "waiting").length === 2);
    const initial = f.store.list("source").jobs;
    const one = initial.find(job => job.key === "one")!;
    const two = initial.find(job => job.key === "two")!;
    const original = await f.service.detail("target", one.id);
    assert.equal(original.project.agents.find(agent => agent.name === "final")!.hasSession, false);
    assert.ok(fixtureState.calls.some(call => call.prompt.includes("TASK_NEGOTIATE") && call.prompt.includes("Dossier one")));
    await f.close();
    f = fixtureState.open();
    await f.service.start();
    assert.equal(f.store.list("source").total, 2);
    fixtureState.setKeys(["one", "two", "three"]);
    await f.agents.runWorkflow("source");
    await settle(f, () => f.store.list("source").jobs.filter(job => job.status === "waiting").length === 3);
    assert.equal(f.store.list("source").total, 3);
    const input = { instanceId: one.id, id: "mail-1", key: "reply", payload: "ACCEPTED" };
    fixtureState.changeTemplate();
    await f.agents.loadProject("target");
    assert.deepEqual(await f.agents.receiveWorkflowEvent("target", input), { accepted: true });
    assert.deepEqual(await f.agents.receiveWorkflowEvent("target", input), { accepted: false });
    await assert.rejects(() => f.agents.receiveWorkflowEvent("source", input), /current workflow instance/);
    await settle(f, () => f.store.get(one.id)?.status === "completed");
    assert.equal(f.store.get(two.id)?.status, "waiting");
    const completed = await f.service.detail("target", one.id);
    assert.equal(completed.project.agents.find(agent => agent.name === "final")!.hasSession, true);
    assert.equal(fixtureState.calls.filter(call => call.prompt.includes("TASK_NEGOTIATE") && call.prompt.includes("Dossier one") && !call.prompt.includes("Cortex durable workflow wake")).length, 1);
    assert.equal((await f.agents.loadProject("target")).agents.some(agent => agent.hasSession), false);
    await f.service.cancel("source", two.id);
    await assert.rejects(() => f.service.event("target", two.id, { id: "late", key: "reply", payload: "ACCEPTED" }), /n’accepte plus/);
    await assert.rejects(() => f.service.detail("unrelated", one.id), /introuvable/);
  } finally { await f.close(); await fixtureState.cleanup(); }
});

test("a deadline ends one dossier without executing the agreement branch", async () => {
  const fixtureState = await fixture(); const f = fixtureState.open();
  try {
    fixtureState.setKeys(["one"]);
    fixtureState.setWait(null, new Date(Date.now() + 60000).toISOString());
    await f.service.start();
    await f.service.saveRule("source", { sourceAgentId: agentId("scan"), targetProjectId: "target", enabled: true });
    await f.agents.runWorkflow("source");
    await settle(f, () => f.store.list("source").jobs[0]?.status === "waiting");
    const job = f.store.list("source").jobs[0];
    await settle(f, () => f.store.get(job.id)?.status === "completed", new Date(Date.now() + 120000));
    const detail = await f.service.detail("target", job.id);
    assert.equal(detail.project.agents.find(agent => agent.name === "final")!.hasSession, false);
    assert.ok(fixtureState.calls.some(call => call.prompt.includes('"type":"deadline"')));
  } finally { await f.close(); await fixtureState.cleanup(); }
});

test("timer wakes resume only the saved dossier and empty scans do not dispatch", async () => {
  const fixtureState = await fixture(); const f = fixtureState.open();
  try {
    fixtureState.setKeys([]);
    await f.service.start();
    await f.service.saveRule("source", { sourceAgentId: agentId("scan"), targetProjectId: "target", enabled: true });
    await f.agents.runWorkflow("source");
    assert.equal(f.store.list("source").total, 0);
    fixtureState.setKeys(["one"]);
    fixtureState.setWait(60, new Date(Date.now() + 3600000).toISOString());
    await f.agents.runWorkflow("source");
    await settle(f, () => f.store.list("source").jobs[0]?.status === "waiting");
    const job = f.store.list("source").jobs[0];
    await settle(f, () => f.store.get(job.id)?.status === "completed", new Date(Date.now() + 120000));
    assert.ok(fixtureState.calls.some(call => call.prompt.includes('"type":"timer"')));
  } finally { await f.close(); await fixtureState.cleanup(); }
});

test("startup replays a saved source result after delivery failed without running the source again", async () => {
  const fixtureState = await fixture(); let f = fixtureState.open();
  try {
    fixtureState.setKeys(["one"]);
    await f.service.start();
    await f.service.saveRule("source", { sourceAgentId: agentId("scan"), targetProjectId: "target", enabled: true });
    f.store.enqueue = () => { throw new Error("Simulated crash before enqueue"); };
    await assert.rejects(() => f.agents.runWorkflow("source"), /Simulated crash/);
    assert.equal(f.store.list("source").total, 0);
    await f.close(); f = fixtureState.open();
    await f.service.start();
    await settle(f, () => f.store.list("source").jobs[0]?.status === "waiting");
    assert.equal(fixtureState.calls.filter(call => call.prompt.includes("TASK_SCAN")).length, 1);
    assert.equal(f.store.list("source").total, 1);
  } finally { await f.close(); await fixtureState.cleanup(); }
});

test("failed jobs require explicit resumption and completed jobs cannot be restarted", async () => {
  const fixtureState = await fixture(); const f = fixtureState.open();
  try {
    fixtureState.setKeys(["one"]); fixtureState.setFail(true);
    await f.service.start();
    await f.service.saveRule("source", { sourceAgentId: agentId("scan"), targetProjectId: "target", enabled: true });
    await f.agents.runWorkflow("source");
    await settle(f, () => f.store.list("source").jobs[0]?.status === "failed");
    const job = f.store.list("source").jobs[0];
    fixtureState.setFail(false);
    await f.service.tick(); assert.equal(f.store.get(job.id)?.status, "failed");
    await f.service.resume("target", job.id);
    await settle(f, () => f.store.get(job.id)?.status === "waiting");
    const checkpoint = readWorkflowCheckpoint(f.audit.forInstance(job.id).getCheckpoint("target")?.state);
    assert.equal(checkpoint?.instance?.id, job.id);
    await f.service.event("target", job.id, { id: "no", key: "reply", payload: "Refused" });
    await settle(f, () => f.store.get(job.id)?.status === "completed");
    await assert.rejects(() => f.service.resume("target", job.id), /ne peut pas/);
  } finally { await f.close(); await fixtureState.cleanup(); }
});

test("blocked dossiers expose actionable reasons and durably resume with explicit corrections in the original session", async () => {
  const state = await fixture(true, true); let f = state.open();
  try {
    state.setBlocked(true);
    await f.service.start();
    await f.agents.runWorkflow("source", { criteria: "Réunion" });
    await settle(f, () => f.store.list("source").jobs.filter(job => job.status === "blocked").length === 2);
    const [one, two] = f.store.list("source").jobs;
    const original = readWorkflowCheckpoint(f.audit.forInstance(one.id).getCheckpoint("source")?.state)!;
    const session = original.agents[0].threads[0].sessionId;
    assert.match(f.service.list("source", 0).jobs[0].error!, /compte expéditeur/);
    // Existing installations stored a business block as a failure. Correct the view, not the audit.
    f.store.update(one.id, "failed", one.error);
    assert.equal(f.service.list("source", 0).jobs[0].status, "blocked");
    assert.equal((await f.service.detail("source", one.id)).job.status, "blocked");
    assert.equal(f.store.get(one.id)?.status, "failed");
    await assert.rejects(() => f.service.resume("source", one.id), /Précisez/);
    await assert.rejects(() => f.service.resume("source", one.id, { clarification: 123 }), /texte/);
    await assert.rejects(() => f.service.resume("source", one.id, { clarification: "x".repeat(32001) }), /taille/);
    await assert.rejects(() => f.service.resume("unrelated", one.id, { clarification: "USER_CLARIFICATION" }), /introuvable/);
    await f.close(); f = state.open();
    const clarification = "USER_CLARIFICATION : Demander les informations sans offre ni engagement.";
    await f.service.resume("source", one.id, { clarification });
    await assert.rejects(() => f.service.resume("source", one.id, { clarification }), /ne peut pas/);
    await f.close(); f = state.open(); await f.service.start();
    await settle(f, () => f.store.get(one.id)?.status === "waiting");
    assert.equal(f.store.get(two.id)?.status, "blocked");
    assert.deepEqual(f.store.get(one.id)?.parameterValues, { criteria: "Réunion" });
    assert.equal(f.store.get(one.id)?.clarifications?.length, 1);
    const resumed = state.calls.find(call => call.prompt.includes(clarification));
    assert.equal(resumed?.sessionId, session);
    assert.equal(state.calls.filter(call => call.prompt.includes("TASK_SCAN")).length, 1);
    const detail = await f.service.detail("source", one.id);
    assert.ok(detail.project.agents[0].conversation.some(message => message.role === "user" && message.content.includes(clarification)));
    assert.equal(detail.project.agents[1].hasSession, false);
    await f.service.event("source", one.id, { id: "accepted", key: "reply", payload: "ACCEPTED" });
    await settle(f, () => f.store.get(one.id)?.status === "completed");
    assert.ok(state.calls.some(call => call.prompt.includes("TASK_FINAL") && call.prompt.includes(clarification)));
    assert.equal(f.store.list("source").total, 2);
    // A later provider failure remains a technical failure even when the saved response was blocked.
    state.setFail(true);
    await f.service.resume("source", two.id, { clarification });
    await settle(f, () => f.store.get(two.id)?.status === "failed");
    assert.equal((await f.service.detail("source", two.id)).job.status, "failed");
    assert.match(f.service.list("source", 0).jobs.find(job => job.id === two.id)!.error!, /Provider unavailable/);
  } finally { await f.close(); await state.cleanup(); }
});

test("one project keeps monitoring separate from its dossier branch, inherits inputs and restores independent replies", async () => {
  const state = await fixture(true); let f = state.open();
  try {
    await f.service.start();
    const input = { sourceAgentId: agentId("scan"), targetProjectId: "source", targetAgentId: agentId("negotiate"), enabled: false };
    const rule = await f.service.saveRule("source", input);
    let result = await f.agents.runWorkflow("source", { criteria: "Lyon 70 m²" });
    assert.deepEqual(result.executedAgentIds, [agentId("scan")]);
    assert.equal(f.store.list("source").total, 2);
    await assert.rejects(() => f.agents.runAgent("source", { agentId: agentId("negotiate") }), /dossier asynchrone/);
    assert.equal(f.service.rules("source")[0].definitionManaged, true);
    result = await f.agents.runWorkflow("source", { criteria: "Lyon 70 m²" });
    assert.deepEqual(result.executedAgentIds, [agentId("scan")]);
    await settle(f, () => f.store.list("source").jobs.filter(job => job.status === "waiting").length === 2);
    const [one, two] = f.store.list("source").jobs;
    const saved = f.store.get(one.id)!;
    assert.deepEqual(saved.snapshot.agents.map(agent => agent.id), [agentId("negotiate"), agentId("final")]);
    assert.equal(saved.parameterValues.criteria, "Lyon 70 m²");
    assert.ok(state.calls.some(call => call.prompt.includes("TASK_NEGOTIATE") && call.prompt.includes("Lyon 70 m²")));
    await f.close(); f = state.open(); await f.service.start();
    await f.agents.receiveWorkflowEvent("source", { instanceId: one.id, id: "reply-one", key: "reply", payload: "ACCEPTED" });
    await settle(f, () => f.store.get(one.id)?.status === "completed");
    assert.equal(f.store.get(two.id)?.status, "waiting");
    assert.equal((await f.service.detail("source", one.id)).project.agents.find(agent => agent.name === "final")!.hasSession, true);
    const main = await f.agents.loadProject("source");
    assert.equal(main.agents.find(agent => agent.name === "negotiate")!.hasSession, false);
    assert.equal(main.dispatchRules?.[0].targetAgentId, agentId("negotiate"));
    await f.agents.runWorkflow("source", { criteria: "Lyon 70 m²" });
    assert.equal(f.store.list("source").total, 2);
    await f.service.event("source", two.id, { id: "reply-two", key: "reply", payload: "REFUSED" });
    await settle(f, () => f.store.get(two.id)?.status === "completed");
    assert.equal((await f.service.detail("source", two.id)).project.agents.find(agent => agent.name === "final")!.hasSession, false);
  } finally { await f.close(); await state.cleanup(); }
});

test("loading infers internal dossiers without executing them; runs dispatch automatically and edits preserve existing dossiers", async () => {
  const state = await fixture(true, true); let f = state.open();
  try {
    await f.service.start();
    const project = await f.agents.loadProject("source");
    assert.equal(state.calls.length, 0);
    assert.equal(project.dispatchRules?.length, 1);
    const rule = project.dispatchRules![0];
    assert.equal(rule.enabled, true);
    assert.equal(rule.definitionManaged, true);
    assert.equal(f.store.list("source").total, 0);
    await f.agents.runWorkflow("source", { criteria: "Réunion" });
    await settle(f, () => f.store.list("source").jobs.every(job => job.status === "waiting"));
    const [one, two] = f.store.list("source").jobs;
    assert.equal(f.store.list("source").total, 2);
    await f.close(); f = state.open(); await f.service.start();
    assert.equal(f.service.rules("source")[0].id, rule.id);
    assert.equal(f.store.list("source").total, 2);
    state.setBranchEnabled(false);
    await f.agents.loadProject("source");
    assert.equal(f.service.rules("source").length, 0);
    assert.equal(f.store.get(two.id)?.status, "waiting");
    await f.service.event("source", one.id, { id: "agreement", key: "reply", payload: "ACCEPTED" });
    await settle(f, () => f.store.get(one.id)?.status === "completed");
    assert.equal((await f.service.detail("source", one.id)).project.agents.at(-1)?.hasSession, true);
    state.setBranchEnabled(true);
    await f.agents.loadProject("source");
    assert.equal(f.service.rules("source")[0].id, rule.id);
    await f.agents.runWorkflow("source", { criteria: "Réunion" });
    assert.equal(f.store.list("source").total, 2);
  } finally { await f.close(); await state.cleanup(); }
});

test("migrating saved results from a paused internal rule is read-only until the user continues", async () => {
  const state = await fixture(true); let f = state.open();
  try {
    await f.agents.loadProject("source");
    await f.agents.runAgent("source", { agentId: agentId("scan"), workflowParameterValues: { criteria: "Réunion" } });
    const legacy = await f.service.saveRule("source", { sourceAgentId: agentId("scan"), targetProjectId: "source", targetAgentId: agentId("negotiate"), enabled: false });
    await f.close();
    await new Promise(resolve => setTimeout(resolve, 5));
    f = state.open(); await f.service.start();
    const loaded = await f.agents.loadProject("source");
    assert.equal(loaded.dispatchRules?.[0].id, legacy.id);
    assert.equal(loaded.dispatchRules?.[0].enabled, true);
    assert.equal(loaded.agents.find(agent => agent.name === "scan")?.hasSession, true);
    assert.equal(f.store.list("source").total, 0);
    await f.close(); f = state.open(); await f.service.start();
    assert.equal(f.store.list("source").total, 0);
    await f.service.continueFromResults("source", agentId("scan"));
    await settle(f, () => f.store.list("source").jobs.filter(job => job.status === "waiting").length === 2);
    await f.service.continueFromResults("source", agentId("scan"));
    assert.equal(f.store.list("source").total, 2);
    assert.equal(state.calls.filter(call => call.prompt.includes("TASK_SCAN")).length, 1);
  } finally { await f.close(); await state.cleanup(); }
});

test("internal dispatch rejects missing entries, recursive branches and identity changes", async () => {
  const state = await fixture(true); const f = state.open();
  try {
    const input = { sourceAgentId: agentId("scan"), targetProjectId: "source", enabled: false };
    await assert.rejects(() => f.service.saveRule("source", input), /agent/);
    await assert.rejects(() => f.service.saveRule("source", { ...input, targetAgentId: agentId("scan") }), /revenir/);
    await assert.rejects(() => f.service.saveRule("source", { ...input, sourceAgentId: agentId("final"), targetAgentId: agentId("negotiate") }), /revenir/);
    const rule = await f.service.saveRule("source", { ...input, targetAgentId: agentId("negotiate") });
    await assert.rejects(() => f.service.saveRule("source", { ...rule, targetAgentId: agentId("final"), parameterValues: {} }), /nouvelle règle/);
  } finally { await f.close(); await state.cleanup(); }
});

test("shutdown interrupts an in-flight action and an explicit resume survives restart", async () => {
  const fixtureState = await fixture(); let f = fixtureState.open();
  try {
    fixtureState.setKeys(["one"]); fixtureState.setStall(true);
    await Promise.all([f.service.start(), f.service.start()]);
    await f.service.saveRule("source", { sourceAgentId: agentId("scan"), targetProjectId: "target", enabled: true });
    await f.agents.runWorkflow("source");
    await settle(f, () => fixtureState.calls.some(call => call.prompt.includes("TASK_NEGOTIATE")));
    const job = f.store.list("source").jobs[0];
    await f.close(); fixtureState.setStall(false); f = fixtureState.open();
    await f.service.start();
    assert.equal(f.store.get(job.id)?.status, "interrupted");
    await f.service.tick(); assert.equal(f.store.get(job.id)?.status, "interrupted");
    await f.service.resume("source", job.id);
    await settle(f, () => f.store.get(job.id)?.status === "waiting");
  } finally { await f.close(); await fixtureState.cleanup(); }
});
