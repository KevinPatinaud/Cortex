import { AsyncLocalStorage } from "node:async_hooks";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { JsonConfigurationRepository } from "../configuration/JsonConfigurationRepository.ts";

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
  status: "running" | "waiting" | "failed" | "completed";
  startedAt: string;
  updatedAt: string;
  attempts: number;
  error?: string;
}

interface Lease {
  projectId: string;
  workspace: ExecutionWorkspace;
  journal: JsonConfigurationRepository;
  previous?: Journal;
  started?: Journal;
  active: boolean;
  waiting: boolean;
  verified: boolean;
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
    private readonly verify: (workspace: ExecutionWorkspace, phase: "start" | "finish", recovery: boolean) => Promise<void> = verifyWorkspace) {
    this.configuration = new JsonConfigurationRepository(configurationFile);
  }

  private async workspace(projectId: string): Promise<ExecutionWorkspace | undefined> {
    const configuration = await this.configuration.read<{ executionWorkspaces?: ExecutionWorkspace[] }>();
    const matches = (configuration.executionWorkspaces ?? []).filter((item) => item.projectIds.includes(projectId));
    if (matches.length > 1) throw new Error(`Multiple execution workspaces configured for ${projectId}.`);
    if (!matches[0]) return undefined;
    return { ...matches[0], directory: await realpath(matches[0].directory) };
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
    const journal = await this.repository(workspace).read<Partial<Journal>>();
    // WAIT has its own wake scheduler. Never turn a future wait into an early retry.
    return journal.projectId && ["running", "failed"].includes(journal.status ?? "") ? journal.projectId : undefined;
  }

  recoveryInstructions(): string {
    const lease = this.context.getStore();
    if (!lease?.active || !lease.previous || lease.previous.status === "completed") return "";
    return `Reprise prioritaire d'une intervention déjà commencée dans ${lease.workspace.directory}. ` +
      "Lire les états et rapports existants, inspecter Git, la release active et les effets déjà produits. " +
      "Terminer uniquement cette intervention : validation, déploiement si nécessaire, commit et push, ou restauration sûre. " +
      "Ne pas commencer un nouveau sujet, ne pas répéter une action déjà accomplie et ne jamais effacer le travail d'autrui. " +
      `Incident précédent : ${lease.previous.error ?? "exécution interrompue ou en attente"}.`;
  }

  async run<T>(projectId: string, operation: () => Promise<T>): Promise<T> {
    const inherited = this.context.getStore();
    if (inherited?.active && inherited.projectId === projectId) return operation();
    const workspace = await this.workspace(projectId);
    if (!workspace) return operation();
    const key = this.key(workspace);
    const busy = this.active.get(key);
    if (busy) throw new ExecutionWorkspaceBusyError(`Le dépôt ${workspace.id} est utilisé par ${busy.projectId}. Créneau ignoré.`);
    const lease: Lease = { projectId, workspace, journal: this.repository(workspace), active: true, waiting: false, verified: false };
    this.active.set(key, lease);
    try {
      const previous = await lease.journal.read<Partial<Journal>>();
      if (previous.projectId && previous.status !== "completed") {
        if (previous.projectId !== projectId) throw new ExecutionWorkspaceBusyError(`Le dépôt ${workspace.id} attend la reprise de ${previous.projectId}.`);
        lease.previous = previous as Journal;
      }
      return await this.context.run(lease, async () => {
        try {
          const result = await operation();
          if (lease.started) {
            if (!lease.waiting && !lease.verified) await this.verifyBeforeSuccess();
            await this.save(lease, { ...lease.started, status: lease.waiting ? "waiting" : "completed" });
          }
          return result;
        } catch (error) {
          if (lease.started) await this.save(lease, { ...lease.started, status: "failed", error: error instanceof Error ? error.message : String(error) });
          throw error;
        }
      });
    } finally {
      lease.active = false;
      this.active.delete(key);
    }
  }

  /** Called only after the quota gate and input validation have passed. */
  async markStarted(): Promise<void> {
    const lease = this.context.getStore();
    if (!lease?.active || lease.started) return;
    await this.verify(lease.workspace, "start", !!lease.previous);
    const now = new Date().toISOString();
    const journal: Journal = { projectId: lease.projectId, status: "running", startedAt: lease.previous?.startedAt ?? now,
      updatedAt: now, attempts: (lease.previous?.attempts ?? 0) + 1 };
    await this.save(lease, journal);
    lease.started = journal;
  }

  markWaiting(): void {
    const lease = this.context.getStore();
    if (lease?.active) lease.waiting = true;
  }

  async verifyBeforeSuccess(): Promise<void> {
    const lease = this.context.getStore();
    if (!lease?.active || !lease.started) return;
    await this.verify(lease.workspace, "finish", !!lease.previous);
    lease.verified = true;
  }

  private async save(lease: Lease, journal: Journal): Promise<void> {
    await mkdir(this.journalDirectory, { recursive: true });
    await lease.journal.replace({ ...journal, updatedAt: new Date().toISOString() });
  }
}

async function git(directory: string, args: string[]): Promise<string> {
  const result = await execute("git", ["-C", directory, ...args], { timeout: 15_000, maxBuffer: 1024 * 1024, windowsHide: true });
  return result.stdout.trim();
}

export async function verifyWorkspace(workspace: ExecutionWorkspace, phase: "start" | "finish", recovery: boolean): Promise<void> {
  if (workspace.git) {
    const { branch, remote } = workspace.git;
    if (await git(workspace.directory, ["branch", "--show-current"]) !== branch) throw new Error(`Le dépôt doit être sur ${branch}.`);
    await git(workspace.directory, ["var", "GIT_AUTHOR_IDENT"]);
    if (phase === "finish" || !recovery) {
      if (await git(workspace.directory, ["status", "--porcelain", "--untracked-files=no"])) throw new Error("Le dépôt contient des modifications suivies non publiées. Vérifier et terminer l'intervention avant de poursuivre.");
      const head = await git(workspace.directory, ["rev-parse", "HEAD"]);
      const published = (await git(workspace.directory, ["ls-remote", "--exit-code", remote, `refs/heads/${branch}`])).split(/\s+/)[0];
      if (head !== published) throw new Error(`Le commit local ne correspond pas à ${remote}/${branch}. Le push et sa vérification sont obligatoires.`);
    }
  }
  if (phase === "finish") for (const url of workspace.healthChecks ?? []) {
    const response = await fetch(url, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`Contrôle de santé en échec : ${url} (${response.status}).`);
    const body = await response.json() as { status?: string };
    if (body.status !== "UP") throw new Error(`Contrôle de santé en échec : ${url} (${body.status ?? "statut absent"}).`);
  }
}
