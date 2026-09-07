import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AgentProject } from "../../usecase/AgentUseCase.ts";
import { GmailService, plainBody } from "./GmailService.ts";

const scopes = "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send";
function message(id: string, from = "hotel@example.com", labels = ["INBOX"]) {
  return { id, threadId: "abc123", internalDate: "1000", labelIds: labels, payload: { mimeType: "text/plain",
    headers: [{ name: "From", value: from }, { name: "Subject", value: "Réservation" }],
    body: { data: Buffer.from(`Chambre confirmée ${id}`).toString("base64url") } } };
}
async function fixture(expiringToken = false) {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cortex-gmail-"));
  let project = { workflowInstance: { id: "instance1", status: "waiting" }, workflowWaits: [{ eventKey: "hotel:test" }] } as AgentProject;
  let messages = [message("old")];
  const events = new Map<string, unknown>();
  let receives = 0, sends = 0, refreshes = 0, failSend = false, failDelivery = false;
  const fetcher = (async (input, init) => {
    const url = String(input);
    if (url.endsWith("/token")) {
      const isRefresh = String(init?.body).includes("grant_type=refresh_token");
      if (isRefresh) refreshes++;
      return Response.json({ access_token: "secret-access", refresh_token: "secret-refresh", expires_in: expiringToken && !isRefresh ? 1 : 3600, scope: scopes });
    }
    if (url.endsWith("/profile")) return Response.json({ emailAddress: "me@example.com" });
    if (url.includes("threads/")) return Response.json({ id: "abc123", messages });
    if (url.includes("threads?")) return Response.json({ threads: [{ id: "abc123" }] });
    if (url.endsWith("messages/send")) { sends++; if (failSend) throw new Error("network gone"); return Response.json({ id: "sent1", threadId: "abc123" }); }
    if (url.endsWith("revoke")) return Response.json({});
    throw new Error(`Unexpected URL ${url}`);
  }) as typeof fetch;
  const agents = {
    loadProject: async () => project,
    receiveWorkflowEvent: async (_projectId: string, input: unknown) => {
      receives++;
      const event = input as { id: string };
      const accepted = !events.has(event.id);
      events.set(event.id, input);
      if (failDelivery) { failDelivery = false; throw new Error("Crash after durable delivery"); }
      return { accepted };
    }
  };
  const file = path.join(directory, "gmail.sqlite");
  let service = new GmailService(file, "http://127.0.0.1:3000/api/gmail/callback", agents, fetcher);
  service.configure({ installed: { client_id: "test.apps.googleusercontent.com", client_secret: "secret-client" } });
  const connect = async () => { const auth = service.authorize("project"); await service.callback("code", auth.state, auth.state); };
  const watch = () => service.watch("project", { instanceId: "instance1", eventKey: "hotel:test", threadId: "abc123" });
  return { get service() { return service; }, connect, watch, events,
    setMessages(value: typeof messages) { messages = value; },
    status(value: string) { project = { ...project, workflowInstance: { ...project.workflowInstance!, status: value as "waiting" } }; },
    failSend() { failSend = true; }, failDelivery() { failDelivery = true; },
    counts: () => ({ receives, sends, refreshes }),
    async restart() { await service.close(); service = new GmailService(file, "http://127.0.0.1:3000/api/gmail/callback", agents, fetcher); },
    async cleanup() {
      await service.close();
      assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
      assert.ok(path.basename(directory).startsWith("cortex-gmail-"));
      await rm(directory, { recursive: true, force: true });
    }
  };
}

test("OAuth uses PKCE, rejects wrong browser state and never exposes tokens in status", async () => {
  const f = await fixture();
  try {
    const auth = f.service.authorize("project");
    const url = new URL(auth.url);
    assert.equal(url.searchParams.get("code_challenge_method"), "S256");
    assert.equal(url.searchParams.get("access_type"), "offline");
    await assert.rejects(f.service.callback("code", auth.state, "other"), /invalide/);
    assert.equal(f.service.status().connected, false);
    await f.service.callback("code", auth.state, auth.state);
    await assert.rejects(f.service.callback("code", auth.state, auth.state), /invalide/);
    assert.equal(f.service.status().email, "me@example.com");
    assert.doesNotMatch(JSON.stringify(f.service.status()), /secret-/);
  } finally { await f.cleanup(); }
});

test("Gmail waits persist across restart, exclude old/outgoing mails, and deliver each reply once", async () => {
  const f = await fixture();
  try {
    await f.connect();
    const watch = await f.watch();
    assert.equal((await f.watch()).id, watch.id);
    await f.restart();
    f.setMessages([message("old"), message("new"), message("sent", "me@example.com", ["SENT"]), message("draft", "me@example.com", ["DRAFT"])]);
    await f.service.poll(); await f.service.poll();
    assert.equal(f.events.size, 1); assert.equal(f.counts().receives, 1);
    const event = [...f.events.values()][0] as { key: string; payload: string; instanceId: string };
    assert.equal(event.key, "hotel:test"); assert.equal(event.instanceId, "instance1");
    assert.match(JSON.parse(event.payload).body, /Chambre confirmée new/);
    assert.ok(f.service.status().watches[0].lastCheckedAt);
  } finally { await f.cleanup(); }
});

test("Interrupted delivery retries the same deterministic event ID", async () => {
  const f = await fixture();
  try {
    await f.connect(); await f.watch(); f.setMessages([message("old"), message("new")]); f.failDelivery();
    await f.service.poll(); assert.ok(f.service.status().watches[0].error);
    await f.restart(); await f.service.poll();
    assert.equal(f.events.size, 1); assert.equal(f.counts().receives, 2);
  } finally { await f.cleanup(); }
});

test("Cancelled workflow stops watching and failed workflow pauses until recovery", async () => {
  const f = await fixture();
  try {
    await f.connect(); await f.watch(); f.setMessages([message("new")]);
    f.status("failed"); await f.service.poll();
    assert.equal(f.service.status().watches[0].status, "paused"); assert.equal(f.events.size, 0);
    f.status("waiting"); await f.service.poll(); assert.equal(f.events.size, 1);
    f.status("cancelled"); f.setMessages([message("later")]); await f.service.poll();
    assert.equal(f.service.status().watches[0].status, "finished"); assert.equal(f.events.size, 1);
  } finally { await f.cleanup(); }
});

test("Disconnect clears durable tokens and subscriptions", async () => {
  const f = await fixture();
  try {
    await f.connect(); await f.watch(); await f.service.disconnect(); await f.restart();
    assert.equal(f.service.status().connected, false); assert.deepEqual(f.service.status().watches, []);
    await assert.rejects(f.service.listThreads(), /Connectez Gmail/);
  } finally { await f.cleanup(); }
});

test("Successful sends are deduplicated across restart and reject conflicting content", async () => {
  const f = await fixture();
  try {
    await f.connect(); const mail = { id: "send-one", to: "hotel@example.com", subject: "Réservation", body: "Bonjour" };
    const result = await f.service.send(mail); await f.restart();
    assert.deepEqual(await f.service.send(mail), result); assert.equal(f.counts().sends, 1);
    await assert.rejects(f.service.send({ ...mail, body: "Autre" }), /autre message/);
    await assert.rejects(f.service.send({ ...mail, id: "injection", subject: "x\r\nBcc: evil@example.com" }), /valides/);
  } finally { await f.cleanup(); }
});

test("Ambiguous Gmail send is never retried automatically", async () => {
  const f = await fixture();
  try {
    await f.connect(); f.failSend();
    const mail = { id: "uncertain", to: "hotel@example.com", subject: "Réservation", body: "Bonjour" };
    await assert.rejects(f.service.send(mail), /non confirmé/); await f.restart();
    await assert.rejects(f.service.send(mail), /incertain/); assert.equal(f.counts().sends, 1);
  } finally { await f.cleanup(); }
});

test("MIME decoding reads nested UTF-8 plain text", () => {
  assert.equal(plainBody({ mimeType: "multipart/alternative", parts: [{ mimeType: "text/plain", body: { data: Buffer.from("Réservé ✓").toString("base64url") } }] }), "Réservé ✓");
});

test("Concurrent Gmail reads refresh an expired token only once", async () => {
  const f = await fixture(true);
  try {
    await f.connect();
    await Promise.all([f.service.listThreads(), f.service.listThreads()]);
    assert.equal(f.counts().refreshes, 1);
    await f.restart(); await f.service.listThreads();
    assert.equal(f.counts().refreshes, 1);
  } finally { await f.cleanup(); }
});
