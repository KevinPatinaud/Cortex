import { AsyncLocalStorage } from "node:async_hooks";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { JsonConfigurationRepository } from "../configuration/JsonConfigurationRepository.ts";
import { readWorkflowCheckpoint } from "../workflowExecution/WorkflowCheckpoint.ts";

const execute = promisify(execFile);

export class ExecutionWorkspaceBusyError extends Error {}

export interface ExecutionWorkspace {
  id: string;
  directory: string;
  projectIds: string[];
  git?: { branch: string; remote: string };
  healthChecks?: string[];
}

interface Journal {
  projectId: string;
  status: "running" | "waiting" | "failed" | "interrupted" | "completed" | "released";
  startedAt: string;
  updatedAt: string;
  attempts: number;
  error?: string;
  checkpointId?: string;
  cleanupOnly?: boolean;
}

interface Lease {
  projectId: string;
  workspace: ExecutionWorkspace;
  journal: JsonConfigurationRepository;
  previous?: Journal;
  started?: Journal;
  active: boolean;
  waiting: boolean;
  interrupted: boolean;
  verified: boolean;
  checkpointId?: string;
}

/** One shared guard is injected into every runner of the single Cortex server.
 * The lease covers source edits, publication and final checks, including nested
 * agents. A journal survives process restarts; a skipped launch creates none.
 */
export class ExecutionWorkspaceGuard {
  private readonly active = new Map<string, Lease>();
  private readonly context = new AsyncLocalStorage<Lease>();
  private readonly configuration: JsonConfigurationRepository;

  isProjectHeldOutsideCurrentRun(projectId: string): boolean {
    const current = this.context.getStore();
    return [...this.active.values()].some(lease => lease.projectId === projectId && lease !== current);
  }

  hasActiveExecutions(): boolean { return this.active.size > 0; }

  constructor(configurationFile: string, private readonly journalDirectory: string,
    private readonly verify: (workspace: ExecutionWorkspace, phase: "start" | "finish", recovery: boolean) => Promise<void> = verifyWorkspace,
    private readonly readCheckpoint?: (checkpointId: string) => unknown) {
    this.configuration = new JsonConfigurationRepository(configurationFile);
  }

  private async workspace(projectId: string): Promise<ExecutionWorkspace | undefined> {
    const configuration = await this.configuration.read<{ executionWorkspaces?: ExecutionWorkspace[];
      executionPolicies?: Record<string, { workspaceDirectory?: string }> }>();
    const matches = (configuration.executionWorkspaces ?? []).filter((item) => item.projectIds.includes(projectId));
    if (matches.length > 1) throw new Error(`Multiple execution workspaces configured for ${projectId}.`);
    const selected = configuration.executionPolicies?.[projectId]?.workspaceDirectory;
    if (matches[0]) {
      const directory = await realpath(matches[0].directory);
      if (selected && this.key({ ...matches[0], directory: await realpath(selected) }) !== this.key({ ...matches[0], directory })) {
        throw new Error("Le dépôt du profil doit correspondre au dépôt partagé configuré pour ce projet.");
      }
      return { ...matches[0], directory };
    }
    if (!selected) return undefined;
    const directory = await realpath(selected);
    const projectIds = (await Promise.all(Object.entries(configuration.executionPolicies ?? {}).map(async ([id, policy]) => {
      if (!policy.workspaceDirectory) return [];
      const canonical = await realpath(policy.workspaceDirectory).catch(() => null);
      return canonical && this.key({ directory: canonical } as ExecutionWorkspace) === this.key({ directory } as ExecutionWorkspace) ? [id] : [];
    }))).flat();
    return { id: `profile-${createHash("sha256").update(directory).digest("hex").slice(0, 12)}`, directory, projectIds };
  }

  private key(workspace: ExecutionWorkspace): string {
    return process.platform === "win32" ? workspace.directory.toLowerCase() : workspace.directory;
  }

  private repository(workspace: ExecutionWorkspace): JsonConfigurationRepository {
    const key = createHash("sha256").update(this.key(workspace)).digest("hex");
    return new JsonConfigurationRepository(path.join(this.journalDirectory, `${key}.json`));
  }

  async recoveryProjectId(projectId: string): Promise<string | undefined> {
    const workspace = await this.workspace(projectId);
    if (!workspace || this.active.has(this.key(workspace))) return undefined;
    // A non-waiting probe lease prevents reconciliation racing with a new writer.
    const lease = this.acquire(projectId, workspace);
    try {
      const journal = await this.readJournal(lease);
      if (!journal.projectId || !["running", "failed", "interrupted"].includes(journal.status ?? "")) return undefined;
      return await this.ownerAvailable(journal.projectId, workspace) ? journal.projectId : projectId;
    } finally { this.release(lease); }
  }

  recoveryInstructions(): string {
    const lease = this.context.getStore();
    if (!lease?.active || !lease.previous || this.isReleased(lease.previous)) return "";
    return `Reprise prioritaire d'une intervention déjà commencée dans ${lease.workspace.directory}. ` +
      `Projet d'origine : ${lease.previous.projectId}. ` +
      "Lire les états et rapports existants, inspecter Git, la release active et les effets déjà produits. " +
      "Terminer uniquement cette intervention : validation, déploiement si nécessaire, commit et push, ou restauration sûre. " +
      (lease.previous.cleanupOnly ? "L'objectif précédent a été annulé ou son propriétaire n'est plus disponible : clore ou restaurer les effets existants sans poursuivre l'objectif annulé. " : "") +
      "Ne pas commencer un nouveau sujet, ne pas répéter une action déjà accomplie et ne jamais effacer le travail d'autrui. " +
      `Incident précédent : ${lease.previous.error ?? "exécution interrompue ou en attente"}.`;
  }

  async run<T>(projectId: string, operation: () => Promise<T>): Promise<T> {
    const inherited = this.context.getStore();
    if (inherited?.active && inherited.projectId === projectId) return operation();
    const workspace = await this.workspace(projectId);
    if (!workspace) return operation();
    const lease = this.acquire(projectId, workspace);
    try {
      const previous = await this.readJournal(lease);
      if (previous.projectId && !this.isReleased(previous)) {
        const available = await this.ownerAvailable(previous.projectId, workspace);
        if (previous.projectId !== projectId && available) throw new ExecutionWorkspaceBusyError(`Le dépôt ${workspace.id} attend la reprise de ${previous.projectId}.`);
        lease.previous = { ...previous, ...(!available ? { cleanupOnly: true } : {}) } as Journal;
      }
      return await this.context.run(lease, async () => {
        try {
          const result = await operation();
          if (lease.started) {
            if (!lease.waiting && !lease.interrupted && !lease.verified) await this.verifyBeforeSuccess();
            await this.save(lease, { ...lease.started,
              status: lease.interrupted ? "interrupted" : lease.waiting ? (lease.verified ? "released" : "waiting") : "completed",
              ...(lease.checkpointId ? { checkpointId: lease.checkpointId } : {}) });
          }
          return result;
        } catch (error) {
          if (lease.started) await this.save(lease, { ...lease.started, status: "failed", error: error instanceof Error ? error.message : String(error) });
          throw error;
        }
      });
    } finally {
      this.release(lease);
    }
  }

  /** Called only after the quota gate and input validation have passed. */
  async markStarted(): Promise<void> {
    const lease = this.context.getStore();
    if (!lease?.active || lease.started) return;
    await this.verify(lease.workspace, "start", !!lease.previous);
    const now = new Date().toISOString();
    const journal: Journal = { projectId: lease.projectId, status: "running", startedAt: lease.previous?.startedAt ?? now,
      updatedAt: now, attempts: (lease.previous?.attempts ?? 0) + 1,
      ...(lease.previous?.cleanupOnly ? { cleanupOnly: true } : {}) };
    await this.save(lease, journal);
    lease.started = journal;
  }

  markWaiting(checkpointId?: string): void {
    const lease = this.context.getStore();
    if (lease?.active) { lease.waiting = true; lease.checkpointId = checkpointId; }
  }

  async checkpointWaiting(checkpointId: string): Promise<void> {
    this.markWaiting(checkpointId);
    const lease = this.context.getStore();
    if (!lease?.active || !lease.started || !lease.workspace.git) return;
    try {
      // Keep the business WAIT in SQLite, but relinquish this resource once its
      // source changes are published and health checks pass. Never unlock a writer.
      await this.verifyBeforeSuccess();
    } catch (error) {
      lease.started.error = `Dépôt réservé pendant l'attente : ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  markInterrupted(): void {
    const lease = this.context.getStore();
    if (lease?.active) lease.interrupted = true;
  }

  async verifyBeforeSuccess(): Promise<void> {
    const lease = this.context.getStore();
    if (!lease?.active || !lease.started) return;
    lease.verified = false;
    await this.verify(lease.workspace, "finish", !!lease.previous);
    lease.verified = true;
  }

  private async save(lease: Lease, journal: Journal): Promise<void> {
    await mkdir(this.journalDirectory, { recursive: true });
    await lease.journal.replace({ ...journal, updatedAt: new Date().toISOString() });
  }

  private isReleased(journal: Partial<Journal>): boolean {
    return journal.status === "completed" || journal.status === "released";
  }

  private acquire(projectId: string, workspace: ExecutionWorkspace): Lease {
    const busy = this.active.get(this.key(workspace));
    if (busy) throw new ExecutionWorkspaceBusyError(`Le dépôt ${workspace.id} est utilisé par ${busy.projectId}. Créneau ignoré.`);
    const lease: Lease = { projectId, workspace, journal: this.repository(workspace), active: true,
      waiting: false, interrupted: false, verified: false };
    this.active.set(this.key(workspace), lease);
    return lease;
  }

  private release(lease: Lease): void {
    lease.active = false;
    if (this.active.get(this.key(lease.workspace)) === lease) this.active.delete(this.key(lease.workspace));
  }

  private async ownerAvailable(projectId: string, workspace: ExecutionWorkspace): Promise<boolean> {
    if (!workspace.projectIds.includes(projectId)) return false;
    const configuration = await this.configuration.read<{ projects?: { id: string }[] }>();
    return !configuration.projects || configuration.projects.some(project => project.id === projectId);
  }

  private async readJournal(lease: Lease): Promise<Partial<Journal>> {
    const journal = await lease.journal.read<Partial<Journal>>();
    if (!journal.projectId || journal.status !== "waiting" || !this.readCheckpoint) return journal;
    const checkpoint = readWorkflowCheckpoint(this.readCheckpoint(journal.checkpointId ?? journal.projectId));
    const waiting = checkpoint?.instance?.status === "waiting" && checkpoint.agents.some(agent => agent.threads.some(thread => thread.wait));
    // A legacy WAIT may retain a reservation after cancel/reset, or while the
    // checkout is already safely published. Reconcile only while owning a lease.
    let failure: unknown;
    let verified = false;
    try {
      if (!lease.workspace.git) throw new Error("Absence de contrôle Git permettant de libérer le dépôt.");
      await this.verify(lease.workspace, "finish", true);
      verified = true;
    } catch (error) { failure = error; }
    if (verified) {
      const released = { ...journal, status: "released" as const } as Journal;
      await this.save(lease, released);
      return released;
    }
    if (waiting && await this.ownerAvailable(journal.projectId, lease.workspace)) return journal;
    const failed = { ...journal, status: "failed" as const, cleanupOnly: true,
      error: `Attente terminée, annulée, réinitialisée ou sans propriétaire ; clore les effets existants. ${failure instanceof Error ? failure.message : String(failure)}` } as Journal;
    await this.save(lease, failed);
    return failed;
  }
}

async function git(directory: string, args: string[]): Promise<string> {
  const result = await execute("git", ["-C", directory, ...args], { timeout: 15_000, maxBuffer: 1024 * 1024, windowsHide: true });
  return result.stdout.trim();
}

async function isAncestor(directory: string, ancestor: string, descendant: string): Promise<boolean> {
  try {
    await git(directory, ["merge-base", "--is-ancestor", ancestor, descendant]);
    return true;
  } catch (error) {
    if ((error as { code?: unknown }).code === 1) return false;
    throw error;
  }
}

async function requireCleanBranch(workspace: ExecutionWorkspace): Promise<void> {
  if (await git(workspace.directory, ["branch", "--show-current"]) !== workspace.git!.branch) throw new Error(`Le dépôt doit être sur ${workspace.git!.branch}.`);
  if (await git(workspace.directory, ["status", "--porcelain", "--untracked-files=no"])) throw new Error("Le dépôt contient des modifications suivies non publiées. Vérifier et terminer l'intervention avant de poursuivre.");
}

export async function verifyWorkspace(workspace: ExecutionWorkspace, phase: "start" | "finish", recovery: boolean): Promise<void> {
  if (workspace.git) {
    const { branch, remote } = workspace.git;
    if (await git(workspace.directory, ["branch", "--show-current"]) !== branch) throw new Error(`Le dépôt doit être sur ${branch}.`);
    await git(workspace.directory, ["var", "GIT_AUTHOR_IDENT"]);
    if (phase === "finish" || !recovery) {
      await requireCleanBranch(workspace);
      let head = await git(workspace.directory, ["rev-parse", "HEAD"]);
      let published = (await git(workspace.directory, ["ls-remote", "--exit-code", remote, `refs/heads/${branch}`])).split(/\s+/)[0];
      if (phase === "start" && head !== published) {
        // The lease and quota gate are already held. Fetch the real branch,
        // rather than trusting a possibly stale remote-tracking ref. Only
        // fast-forward a clean checkout; never push, stash or discard work.
        await git(workspace.directory, ["fetch", "--no-tags", remote, `refs/heads/${branch}`]);
        const fetched = await git(workspace.directory, ["rev-parse", "FETCH_HEAD"]);
        await requireCleanBranch(workspace);
        head = await git(workspace.directory, ["rev-parse", "HEAD"]);
        if (!await isAncestor(workspace.directory, head, fetched)) {
          if (await isAncestor(workspace.directory, fetched, head)) throw new Error(`Le dépôt contient des commits locaux absents de ${remote}/${branch}. Vérifier le travail puis effectuer le push et sa vérification.`);
          throw new Error(`Les historiques local et ${remote}/${branch} ont divergé. Réconcilier le travail existant avant de poursuivre.`);
        }
        await git(workspace.directory, ["merge", "--ff-only", "--no-edit", "--no-autostash", "--no-overwrite-ignore", fetched]);
        await requireCleanBranch(workspace);
        head = await git(workspace.directory, ["rev-parse", "HEAD"]);
        published = (await git(workspace.directory, ["ls-remote", "--exit-code", remote, `refs/heads/${branch}`])).split(/\s+/)[0];
      }
      if (head !== published) throw new Error(phase === "start"
        ? `La branche ${remote}/${branch} a changé pendant la synchronisation. Relancer le contrôle avant de poursuivre.`
        : `Le commit local ne correspond pas à ${remote}/${branch}. Le push et sa vérification sont obligatoires.`);
    }
  }
  if (phase === "finish") for (const url of workspace.healthChecks ?? []) {
    const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`Contrôle de santé en échec : ${url} (${response.status}).`);
    const body = await response.json() as { status?: string };
    if (body.status !== "UP") throw new Error(`Contrôle de santé en échec : ${url} (${body.status ?? "statut absent"}).`);
  }
}
