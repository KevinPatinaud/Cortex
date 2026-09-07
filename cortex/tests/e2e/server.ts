import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { randomUUID } from "node:crypto";
import { AgentService } from "../../src/back/application/service/iaService/AgentService.ts";
import { AgentConfigurationService } from "../../src/back/application/service/iaService/AgentConfigurationService.ts";
import type { AgentProvider } from "../../src/back/application/service/iaService/AgentProvider.ts";
import { ProjectService } from "../../src/back/application/service/projectService/ProjectService.ts";
import { DirectoryPickerService } from "../../src/back/application/service/projectService/DirectoryPickerService.ts";
import { AgentUseCase } from "../../src/back/application/usecase/AgentUseCase.ts";
import { ProjectUseCase } from "../../src/back/application/usecase/ProjectUseCase.ts";
import { WorkflowWaitScheduler } from "../../src/back/application/service/workflowScheduler/WorkflowWaitScheduler.ts";
import { WorkflowScheduler } from "../../src/back/application/service/workflowScheduler/WorkflowScheduler.ts";
import { WorkflowAuditService } from "../../src/back/application/service/workflowAudit/WorkflowAuditService.ts";
import { SqliteWorkflowAuditRepository } from "../../src/back/infrastructure/audit/SqliteWorkflowAuditRepository.ts";
import { createCortexApplication } from "../../src/back/infrastructure/web/controller/CortexApplication.ts";
import { GmailService } from "../../src/back/application/service/gmail/GmailService.ts";

// This fixture uses the real HTTP application and storage, exclusively inside
// its own temporary directory. It never discovers installed engines or tools.
const directory = await mkdtemp(path.join(tmpdir(), "cortex-e2e-"));
const configuration = new AgentConfigurationService(path.join(directory, "config.json"));
const simulatedProvider: AgentProvider = {
  engine: "codex",
  label: "Codex",
  async isAvailable() { return true; },
  async ask(prompt, options = {}) {
    if (prompt.includes("Turn the user's project description")) {
      return { answer: JSON.stringify({
        instructions: "Instructions du projet de test.",
        agents: [{ name: "Rédacteur", description: "Produit un résultat de test.", prompt: "Rédige un résultat utile." }]
      }) };
    }
    if (prompt.startsWith("Design the execution graph for a multi-agent workflow.")) {
      const context = JSON.parse(prompt.split("Context to analyze:\n")[1]) as {
        agents: Array<{ id: string }>;
      };
      return { answer: JSON.stringify({
        agents: context.agents.map((agent, index) => ({
          id: agent.id, nextAgentIds: context.agents[index + 1] ? [context.agents[index + 1].id] : [],
          inputMode: "separate"
        })),
        parameters: []
      }) };
    }
    if (prompt.includes("E2E_DURABLE_WAIT") && !prompt.includes("Cortex durable workflow wake")) {
      return { sessionId: options.sessionId ?? randomUUID(), answer: JSON.stringify({ status: "waiting",
        items: [{ content: "Demande envoyée à l’hôtel. Confirmation attendue." }], nextAgentIds: [],
        isMultiSelectionAllowed: null, isMultiSelectionThreaded: null, notes: null,
        wait: { reason: "En attente de la confirmation de l’hôtel", eventKey: "hotel:demo", wakeAfterSeconds: null,
          deadlineAt: new Date(Date.now() + 3600_000).toISOString(), state: "Demande initiale déjà envoyée." } }) };
    }
    if (prompt.includes("E2E_FAIL")) throw new Error("Échec simulé du moteur.");
    options.signal?.throwIfAborted();
    options.onProgress?.("Analyse des informations en cours…");
    await delay(prompt.includes("E2E_SLOW") ? 8_000 : 150, undefined, { signal: options.signal });
    const responseSchema = prompt.split("JSON Schema:\n").at(-1);
    const nextAgentIds: string[] = responseSchema && responseSchema !== prompt
      ? JSON.parse(responseSchema).properties.nextAgentIds.items.enum ?? []
      : [];
    return {
      sessionId: options.sessionId ?? randomUUID(),
      answer: JSON.stringify({ status: "success", items: [{ content: "Résultat vérifié du moteur simulé." }],
        isMultiSelectionAllowed: false, isMultiSelectionThreaded: null, nextAgentIds, notes: null })
    };
  }
};
const agentService = new AgentService([simulatedProvider], configuration);
const projectService = new ProjectService(path.join(directory, "config.json"), path.join(directory, "projects"));
const projectUseCase = new ProjectUseCase(projectService, new DirectoryPickerService(), agentService);
const repository = new SqliteWorkflowAuditRepository(path.join(directory, "audit.sqlite"));
const audit = new WorkflowAuditService(repository);
const agentUseCase = new AgentUseCase(agentService, projectUseCase, audit);
const workflowScheduler = new WorkflowScheduler(projectUseCase, agentUseCase, () => new Date(), audit);
const waitScheduler = new WorkflowWaitScheduler(agentUseCase, 100);
let gmailReply = false;
const gmail = new GmailService(path.join(directory, "gmail.sqlite"), "http://127.0.0.1:4317/api/gmail/callback", agentUseCase, (async (input) => {
  const url = String(input);
  if (url.endsWith("/token")) return Response.json({ access_token: "test", refresh_token: "test", expires_in: 3600,
    scope: "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send" });
  if (url.endsWith("/profile")) return Response.json({ emailAddress: "test@example.com" });
  if (url.endsWith("/revoke")) { gmailReply = false; return Response.json({}); }
  if (url.includes("threads?")) return Response.json({ threads: [{ id: "thread123" }] });
  if (url.includes("threads/thread123")) return Response.json({ id: "thread123", messages: ["old", ...(gmailReply ? ["reply"] : [])].map(id => ({
    id, threadId: "thread123", internalDate: "1000", labelIds: ["INBOX"], payload: { mimeType: "text/plain", body: { data: Buffer.from("Chambre confirmée.").toString("base64url") },
      headers: [{ name: "Subject", value: "Réservation test" }, { name: "From", value: "hotel@example.com" }] }
  })) });
  throw new Error("Unexpected fake Gmail URL");
}) as typeof fetch);
const app = createCortexApplication({ projectUseCase, agentUseCase, workflowScheduler,
  authentication: null, clientDirectory: path.resolve("dist"), gmail });
// Test-only endpoint outside /api, never registered by production.
app.post("/__test/gmail-reply", async (_request, response) => { gmailReply = true; await gmail.poll(); response.json({ ok: true }); });
const server = app.listen(4317, "127.0.0.1", () => {
  waitScheduler.start();
  console.log("Cortex test fixture ready on http://127.0.0.1:4317");
});
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  workflowScheduler.stop();
  waitScheduler.stop();
  agentUseCase.cancelAllExecutions();
  agentService.cancelAllExecutions();
  const expiresAt = Date.now() + 5_000;
  while ((agentUseCase.hasActiveExecutions() || agentService.hasActiveExecutions()) && Date.now() < expiresAt) await delay(25);
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await gmail.close();
  repository.close();
  const resolved = path.resolve(directory);
  if (path.dirname(resolved) !== path.resolve(tmpdir()) || !path.basename(resolved).startsWith("cortex-e2e-")) {
    throw new Error("Refusing to clean an unexpected test directory.");
  }
  await rm(resolved, { recursive: true, force: true });
  process.exit(0);
}
process.on("SIGINT", () => void close());
process.on("SIGTERM", () => void close());
