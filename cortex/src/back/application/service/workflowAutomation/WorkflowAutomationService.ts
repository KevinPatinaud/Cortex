import { randomUUID } from "node:crypto";
import type { AgentUseCase, AgentProject, AgentDefinition } from "../../usecase/AgentUseCase.ts";
import type { ProjectUseCase } from "../../usecase/ProjectUseCase.ts";
import type { WorkflowAuditService } from "../workflowAudit/WorkflowAuditService.ts";
import { readWorkflowCheckpoint } from "../workflowExecution/WorkflowCheckpoint.ts";
import { isRecord, selectWorkflowWake } from "../../../../shared/WorkflowWait.ts";
import { parseAgentResponse } from "../../../../shared/AgentResponse.ts";
import { getWorkflowBranchAgentIds, parseWorkflowDispatchItem, type WorkflowDispatchRule, type WorkflowDossierBranch } from "../../../../shared/WorkflowAutomation.ts";
import { SqliteWorkflowAutomationRepository, type StoredWorkflowJob } from "../../../infrastructure/automation/SqliteWorkflowAutomationRepository.ts";
import { ValidationError } from "../../error/ValidationError.ts";
import { NotFoundError } from "../../error/NotFoundError.ts";
import { AgentBlockedError } from "../../error/AgentBlockedError.ts";
import type { WorkflowJob, WorkflowJobFilter } from "../../../../shared/WorkflowAutomation.ts";

export class WorkflowAutomationService {
  private readonly runners = new Map<string, AgentUseCase>();
  private readonly active = new Map<string, Promise<void>>();
  private timer: NodeJS.Timeout | null = null;
  private scanning = false;
  private stopped = true;
  private starting: Promise<void> | null = null;

  constructor(private readonly store: SqliteWorkflowAutomationRepository, private readonly agents: AgentUseCase,
    private readonly projects: ProjectUseCase, private readonly audit: WorkflowAuditService, private readonly concurrency = 4) {
    agents.setWorkflowDispatch((projectId, agentId) => this.instructions(projectId, agentId),
      (project, agent) => this.dispatch(project, agent), projectId => this.rules(projectId),
      (projectId, branches) => this.syncBranches(projectId, branches));
    agents.setInstanceResolver((projectId, instanceId) => {
      const job = store.get(instanceId);
      return job?.targetProjectId === projectId ? this.runner(job) : null;
    });
  }

  rules(projectId: string): WorkflowDispatchRule[] { return this.store.rules().filter(rule => rule.sourceProjectId === projectId && !rule.retired); }

  private syncBranches(projectId: string, branches: WorkflowDossierBranch[]): void {
    const existing = this.store.rules().filter(rule => rule.sourceProjectId === projectId && rule.targetProjectId === projectId);
    const retained = new Set<string>();
    for (const branch of branches) {
      const previous = existing.find(rule => rule.sourceAgentId === branch.sourceAgentId && rule.targetAgentId === branch.targetAgentId);
      const now = new Date().toISOString();
      const rule: WorkflowDispatchRule = { id: previous?.id ?? randomUUID(), sourceProjectId: projectId, targetProjectId: projectId,
        ...branch, definitionManaged: true, enabled: true, createdAt: previous?.createdAt ?? now,
        activatedAt: previous?.enabled && !previous.retired ? previous.activatedAt ?? previous.createdAt : now, parameterValues: {} };
      retained.add(rule.id);
      if (JSON.stringify(rule) !== JSON.stringify(previous)) this.store.saveRule(rule);
    }
    for (const rule of existing) if (!retained.has(rule.id) && !rule.retired) this.store.saveRule({ ...rule, enabled: false, retired: true });
  }

  async continueFromResults(projectId: string, agentId: string): Promise<void> {
    const project = await this.agents.loadProject(projectId, false);
    if (this.agents.isProjectRunning(projectId)) throw new ValidationError("Attendez la fin de l’exécution avant de poursuivre.");
    const agent = project.agents.find(item => item.id === agentId);
    if (!agent || !this.rules(projectId).some(rule => rule.definitionManaged && rule.sourceAgentId === agentId)) throw new ValidationError("Cet agent ne déclenche pas de dossiers dans ce projet.");
    const conversations = agent.threads.length ? agent.threads.map(thread => thread.conversation) : [agent.conversation];
    if (!conversations.some(conversation => {
      const last = [...conversation].reverse().find(message => message.role === "agent");
      const response = last ? parseAgentResponse(last.content) : null;
      return response?.status === "success" && response.items.length > 0;
    })) throw new ValidationError("Aucun résultat retenu à transmettre pour cet agent.");
    await this.dispatch(project, agent, undefined, true);
  }
  list(projectId: string, offset: number, ruleId?: string, filter?: WorkflowJobFilter) {
    const page = this.store.list(projectId, offset, ruleId, filter);
    return { ...page, jobs: page.jobs.map(job => {
      if (job.status !== "waiting") return this.withBlockedStatus(job);
      const state = readWorkflowCheckpoint(this.audit.forInstance(job.id).getCheckpoint(job.targetProjectId)?.state);
      const waits = state?.agents.flatMap(agent => agent.threads.flatMap(thread =>
        thread.wait && !thread.wait.wake ? [{ reason: thread.wait.reason, wakeAt: thread.wait.wakeAt, deadlineAt: thread.wait.deadlineAt }] : [])) ?? [];
      return { ...job, waits };
    }) };
  }
  target(projectId: string): Promise<AgentProject> { return this.agents.loadProject(projectId, false); }

  async restoreImportedBranches(projectId: string): Promise<void> {
    const workflow = await this.projects.getAgentWorkflowConfiguration(projectId);
    if (workflow?.dossierBranches) this.syncBranches(projectId, workflow.dossierBranches);
  }

  async saveRule(projectId: string, input: unknown): Promise<WorkflowDispatchRule> {
    if (!isRecord(input) || typeof input.sourceAgentId !== "string" || typeof input.targetProjectId !== "string" || typeof input.enabled !== "boolean") {
      throw new ValidationError("Choisissez un agent source, un workflow cible et un état d’activation.");
    }
    const previous = this.store.rules().find(rule => rule.id === input.id && rule.sourceProjectId === projectId);
    if (previous && input.enabled === false && input.parameterValues === undefined) {
      const paused = { ...previous, enabled: false };
      this.store.saveRule(paused);
      return paused;
    }
    const source = await this.agents.loadProject(projectId, false);
    if (!source.agents.some(agent => agent.id === input.sourceAgentId)) throw new ValidationError("L’agent source n’existe pas.");
    const target = await this.agents.loadProject(input.targetProjectId, false);
    const internal = projectId === target.projectId;
    const targetAgentId = typeof input.targetAgentId === "string" ? input.targetAgentId : undefined;
    if (internal && (!targetAgentId || !target.agents.some(agent => agent.id === targetAgentId))) {
      throw new ValidationError("Choisissez l’agent qui démarre le dossier dans ce projet.");
    }
    if (!internal && targetAgentId) throw new ValidationError("Un agent cible s’applique uniquement à une branche du même projet.");
    if (!target.agents.length) throw new ValidationError("Le workflow cible doit contenir au moins un agent.");
    const existing = this.store.rules().find(rule => rule.id === input.id);
    if (input.id !== undefined && (!existing || existing.sourceProjectId !== projectId)) throw new NotFoundError("Règle introuvable.");
    // A rule keeps its identity and deduplication history when paused or edited.
    if (existing && (existing.sourceAgentId !== input.sourceAgentId || existing.targetProjectId !== input.targetProjectId || existing.targetAgentId !== targetAgentId)) {
      throw new ValidationError("Créez une nouvelle règle pour changer l’agent ou le workflow cible.");
    }
    const rule: WorkflowDispatchRule = { id: existing?.id ?? randomUUID(), sourceProjectId: projectId, sourceAgentId: input.sourceAgentId,
      targetProjectId: input.targetProjectId, enabled: input.enabled,
      ...(targetAgentId ? { targetAgentId } : {}),
      createdAt: existing?.createdAt ?? new Date().toISOString(),
      activatedAt: input.enabled && !existing?.enabled ? new Date().toISOString() : existing?.activatedAt ?? existing?.createdAt,
      parameterValues: await this.agents.validateWorkflowParameterValues(target.projectId, input.parameterValues ?? {}, input.enabled && !internal) };
    const rules = this.store.rules().filter(candidate => candidate.id !== rule.id);
    if (rules.some(candidate => candidate.sourceProjectId === projectId && candidate.sourceAgentId === rule.sourceAgentId && candidate.targetProjectId === rule.targetProjectId && candidate.targetAgentId === rule.targetAgentId)) {
      throw new ValidationError("Cette règle existe déjà. Réactivez-la pour conserver la détection des doublons.");
    }
    if (internal) {
      const internalRules = [...rules, rule].filter(candidate => candidate.sourceProjectId === projectId && candidate.targetProjectId === projectId);
      for (const candidate of internalRules) {
        const branch = getWorkflowBranchAgentIds(source.agents, candidate.targetAgentId!);
        if (internalRules.some(other => branch.has(other.sourceAgentId))) {
          throw new ValidationError("Une branche asynchrone ne peut pas revenir vers un agent déclencheur. Séparez la veille de ses dossiers.");
        }
      }
      if (this.agents.isProjectRunning(projectId)) throw new ValidationError("Attendez la fin de la veille avant de modifier ses branches.");
    }
    const visited = new Set<string>();
    const visit = (id: string): boolean => {
      if (id === projectId) return true;
      if (visited.has(id)) return false;
      visited.add(id);
      return rules.filter(candidate => candidate.enabled && candidate.sourceProjectId === id && candidate.targetProjectId !== id).some(candidate => visit(candidate.targetProjectId));
    };
    if (rule.enabled && !internal && visit(rule.targetProjectId)) throw new ValidationError("Cette règle créerait une boucle de déclenchements entre projets.");
    this.store.saveRule(rule);
    return rule;
  }

  private instructions(projectId: string, agentId: string): string {
    if (!this.rules(projectId).some(rule => rule.enabled && rule.sourceAgentId === agentId)) return "";
    return `Cortex workflow trigger: the user configured this agent to launch independent downstream workflows for qualifying results. Apply the selection criteria in your task. On success, each items[].content MUST be a JSON-encoded object {"key":"stable external identifier or canonical URL","title":"short dossier title","payload":"all useful facts and source links for the downstream workflow"}. Use one item per distinct qualifying entity. Keep the same key for the same entity across scans, even if its price or description changes. Return items: [] if nothing qualifies; never emit a placeholder dossier. Non-success and waiting responses do not trigger dossiers. Cortex deduplicates keys and supplies payload to the configured target; do not launch workflows or background jobs yourself.`;
  }

  private async dispatch(project: AgentProject, agent: AgentDefinition, replayAt?: string, explicit = false): Promise<void> {
    const completedAt = replayAt ?? agent.executionLastActivityAt;
    const rules = this.rules(project.projectId).filter(rule => rule.enabled && rule.sourceAgentId === agent.id && (explicit || !completedAt || (rule.activatedAt ?? rule.createdAt) <= completedAt));
    if (!rules.length) return;
    const conversations = agent.threads.length ? agent.threads.map(thread => thread.conversation) : [agent.conversation];
    const items = conversations.flatMap(conversation => {
      const last = [...conversation].reverse().find(message => message.role === "agent");
      const response = last ? parseAgentResponse(last.content) : null;
      return response?.status === "success" ? response.items.map(item => parseWorkflowDispatchItem(item.content)) : [];
    });
    if (!items.length) return;
    if (items.length > 100) throw new ValidationError("Un agent peut déclencher au maximum 100 dossiers par résultat.");
    for (const rule of rules) {
      const target = structuredClone(await this.agents.loadProject(rule.targetProjectId, false));
      if (rule.targetAgentId) {
        const branch = getWorkflowBranchAgentIds(target.agents, rule.targetAgentId);
        if (!branch.size || branch.has(rule.sourceAgentId)) throw new ValidationError("La branche asynchrone a changé : vérifiez son agent d’entrée et ses liaisons.");
        target.agents = target.agents.filter(candidate => branch.has(candidate.id));
        for (const candidate of target.agents) candidate.nextAgentIds = candidate.nextAgentIds.filter(id => branch.has(id));
      }
      delete target.workflowInstance; delete target.workflowWaits;
      target.workflowParameterValues = {}; target.workflowResumable = false;
      for (const agent of target.agents) {
        agent.hasSession = false; agent.executionStatus = "idle"; agent.conversation = []; agent.threads = [];
        delete agent.executionError; delete agent.executionProgress; delete agent.executionStartedAt; delete agent.executionLastActivityAt;
      }
      const parameterValues = rule.targetAgentId ? { ...project.workflowParameterValues, ...rule.parameterValues } : rule.parameterValues;
      this.store.enqueue({ ...rule, parameterValues }, project.workflowInstance?.id ?? null, target, items);
    }
  }

  private runner(job: StoredWorkflowJob): AgentUseCase {
    let runner = this.runners.get(job.id);
    if (!runner) {
      runner = this.agents.createIsolatedWorkflow(job.snapshot, job.id, job.payload);
      this.runners.set(job.id, runner);
    }
    return runner;
  }

  async detail(projectId: string, id: string) {
    const job = this.requireJob(projectId, id);
    const runner = this.runners.get(id) ?? this.agents.createIsolatedWorkflow(job.snapshot, job.id, job.payload);
    return { job: this.publicJob(job), project: await runner.loadProject(job.targetProjectId, false) };
  }
  private publicJob({ snapshot, parameterValues, ...job }: StoredWorkflowJob) { return this.withBlockedStatus(job); }

  /** Display legacy blocked responses correctly without rewriting their historical audit/checkpoint. */
  private withBlockedStatus(job: WorkflowJob): WorkflowJob {
    if (!["failed", "blocked"].includes(job.status)) return job;
    const state = readWorkflowCheckpoint(this.audit.forInstance(job.id).getCheckpoint(job.targetProjectId)?.state);
    const failures = state?.agents.filter(agent => agent.execution.status === "failed") ?? [];
    const responses = failures.flatMap(agent => agent.threads.filter(thread => agent.failedThreadIds.includes(thread.id)).map(thread => {
      const last = [...thread.conversation].reverse().find(message => message.role === "agent");
      return last ? parseAgentResponse(last.content) : null;
    }));
    if (job.status !== "blocked" && (!failures.length || failures.some(agent => !agent.execution.error?.startsWith("Agent « ") || !agent.execution.error.includes(" » bloqué : ")) ||
        !responses.length || responses.some(response => response?.status !== "blocked"))) return job;
    const reasons = [...new Set(responses.filter(response => response?.status === "blocked").flatMap(response =>
      [response!.notes, ...response!.items.slice(0, 2).map(item => item.content)].filter((text): text is string => Boolean(text))))];
    return { ...job, status: "blocked", error: reasons.length ? reasons.join("\n\n") : job.error };
  }
  private requireJob(projectId: string, id: string): StoredWorkflowJob {
    const job = this.store.get(id);
    if (!job || (job.sourceProjectId !== projectId && job.targetProjectId !== projectId)) throw new NotFoundError("Dossier introuvable.");
    return job;
  }
  async cancel(projectId: string, id: string): Promise<void> {
    const job = this.requireJob(projectId, id);
    if (["completed", "cancelled"].includes(job.status)) return;
    const runner = this.runner(job);
    await runner.loadProject(job.targetProjectId, false);
    this.store.update(id, "cancelled");
    runner.cancelProjectExecution(job.targetProjectId);
    if (!this.active.has(id)) this.runners.delete(id);
  }
  async resume(projectId: string, id: string, input: unknown = {}): Promise<void> {
    const job = this.requireJob(projectId, id);
    if (!["failed", "blocked", "interrupted"].includes(job.status) || this.active.has(id)) throw new ValidationError("Ce dossier ne peut pas être repris maintenant.");
    if (!isRecord(input) || (input.clarification !== undefined && typeof input.clarification !== "string")) throw new ValidationError("Les précisions doivent être du texte.");
    const clarification = typeof input.clarification === "string" ? input.clarification.trim() : "";
    if (clarification.length > 32000 || (job.clarifications ?? []).reduce((total, item) => total + item.content.length, clarification.length) > 128000) throw new ValidationError("Les précisions dépassent la taille maximale autorisée.");
    if (this.withBlockedStatus(job).status === "blocked" && !clarification) throw new ValidationError("Précisez les informations manquantes ou ce qui a été corrigé avant de reprendre ce dossier.");
    this.store.queueResume(id, clarification);
  }
  async event(projectId: string, id: string, input: unknown) {
    const job = this.requireJob(projectId, id);
    if (!["running", "waiting"].includes(job.status)) throw new ValidationError("Ce dossier n’accepte plus de réponse.");
    if (!isRecord(input)) throw new ValidationError("Réponse invalide.");
    return this.runner(job).receiveWorkflowEvent(job.targetProjectId, { ...input, instanceId: id });
  }

  start(): Promise<void> {
    if (this.timer) return Promise.resolve();
    if (this.starting) return this.starting;
    this.stopped = false;
    this.starting = this.initialize().finally(() => { this.starting = null; });
    return this.starting;
  }
  private async initialize(): Promise<void> {
    const existingProjectIds = new Set((await this.projects.getProjects()).map(project => project.id));
    for (const projectId of existingProjectIds) await this.restoreImportedBranches(projectId);
    for (const rule of this.store.rules()) {
      if (rule.enabled && (!existingProjectIds.has(rule.sourceProjectId) || !existingProjectIds.has(rule.targetProjectId))) {
        this.store.saveRule({ ...rule, enabled: false });
      }
    }
    for (const job of this.store.pending().filter(job => job.status === "running")) {
      if (await this.runner(job).completeRestoredWorkflowIfDone(job.targetProjectId)) {
        this.store.update(job.id, "completed");
        this.runners.delete(job.id);
        continue;
      }
      const state = readWorkflowCheckpoint(this.audit.forInstance(job.id).getCheckpoint(job.targetProjectId)?.state);
      const status = state?.instance?.status;
      this.store.update(job.id, status === "waiting" || status === "completed" ? status : "interrupted",
        status === "waiting" || status === "completed" ? null : "Le serveur s’est arrêté pendant l’exécution. Vérifiez les dernières actions avant de reprendre.");
    }
    // Replay checkpointed results before allowing the next scheduled scan to
    // replace them. Enqueue is idempotent even after a crash between delivery
    // to two rules. Rules created after the result do not backfill old work.
    for (const projectId of new Set(this.store.rules().filter(rule => rule.enabled).map(rule => rule.sourceProjectId))) {
      const state = readWorkflowCheckpoint(this.audit.getCheckpoint(projectId)?.state);
      if (!state) continue;
      const project = await this.agents.loadProject(projectId, false);
      for (const agent of project.agents) {
        const completedAt = state.agents.find(item => item.id === agent.id)?.execution.lastActivityAt;
        if (completedAt && this.rules(projectId).some(rule => rule.enabled && rule.sourceAgentId === agent.id && (rule.activatedAt ?? rule.createdAt) <= completedAt)) {
          await this.dispatch(project, agent, completedAt);
        }
      }
    }
    if (this.stopped) return;
    this.timer = setInterval(() => { void this.tick().catch(error => console.error("Automation scan failed:", error)); }, 1000);
    this.timer.unref();
    void this.tick().catch(error => console.error("Automation scan failed:", error));
  }
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    for (const runner of this.runners.values()) runner.interruptAllExecutions();
    await this.starting?.catch(() => {});
    await Promise.all(this.active.values());
    this.runners.clear();
  }

  async tick(now = new Date()): Promise<void> {
    if (this.scanning || this.stopped) return;
    this.scanning = true;
    try {
      const projectIds = new Set((await this.projects.getProjects()).map(project => project.id));
      for (const job of this.store.pending()) {
        if (!projectIds.has(job.sourceProjectId) || !projectIds.has(job.targetProjectId)) {
          await this.cancel(job.targetProjectId, job.id); continue;
        }
        if (this.stopped || this.active.has(job.id) || this.active.size >= this.concurrency) continue;
        const state = readWorkflowCheckpoint(this.audit.forInstance(job.id).getCheckpoint(job.targetProjectId)?.state);
        const resume = Boolean(state?.instance);
        if (job.status === "waiting") {
          if (!state?.instance) { this.store.update(job.id, "failed", "L’état sauvegardé du dossier est introuvable."); continue; }
          const events = this.audit.listWorkflowEvents(state.instance.id);
          const consumed = new Set(state.instance.consumedEventIds);
          if (!state.agents.some(agent => agent.threads.some(thread => thread.wait && selectWorkflowWake(thread.wait, events, consumed, now)))) continue;
        } else if (job.status !== "queued") continue;
        const task = this.execute(job, resume, now).finally(() => { this.active.delete(job.id); this.runners.delete(job.id); });
        this.active.set(job.id, task);
      }
    } finally { this.scanning = false; }
  }
  private async execute(job: StoredWorkflowJob, resume: boolean, now: Date): Promise<void> {
    const runner = this.runner(job);
    this.store.update(job.id, "running");
    try {
      await runner.loadProject(job.targetProjectId, false);
      if (this.store.get(job.id)?.status === "cancelled" || this.stopped) return;
      const additionalInstructions = job.clarifications?.length
        ? `Précisions explicites de l’utilisateur pour ce dossier, dans l’ordre chronologique. Elles complètent ou corrigent les paramètres initiaux et restent applicables aux étapes suivantes. Ne déduisez aucune autorisation supplémentaire.\n\n${job.clarifications.map(item => `${item.createdAt}\n${item.content}`).join("\n\n")}` : undefined;
      const result = await runner.runWorkflow(job.targetProjectId, job.parameterValues, "scheduled", { resume, now, additionalInstructions });
      if (this.store.get(job.id)?.status !== "cancelled") this.store.update(job.id, result.status === "waiting" ? "waiting" : "completed");
    } catch (error) {
      if (this.store.get(job.id)?.status !== "cancelled") this.store.update(job.id, this.stopped ? "interrupted" : error instanceof AgentBlockedError ? "blocked" : "failed", error instanceof Error ? error.message : "Échec du dossier.");
    }
  }
}
