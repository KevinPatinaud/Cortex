import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import type { AgentProject } from "../../application/usecase/AgentUseCase.ts";
import type { WorkflowDispatchItem, WorkflowDispatchRule, WorkflowJob, WorkflowJobStatus } from "../../../shared/WorkflowAutomation.ts";
import { WORKFLOW_JOB_FILTERS, type WorkflowJobFilter, type WorkflowJobPage } from "../../../shared/WorkflowAutomation.ts";

export interface StoredWorkflowJob extends WorkflowJob {
  snapshot: AgentProject;
  parameterValues: Record<string, string>;
}

/** Jobs and their deduplication keys are committed together before execution. */
export class SqliteWorkflowAutomationRepository {
  private readonly db: Database.Database;
  constructor(file: string) {
    if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
    this.db = new Database(file);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("busy_timeout = 5000");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS automation_rules (id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS automation_jobs (
        id TEXT PRIMARY KEY, rule_id TEXT NOT NULL, dedup_key TEXT NOT NULL,
        source_project_id TEXT NOT NULL, target_project_id TEXT NOT NULL,
        status TEXT NOT NULL, value TEXT NOT NULL, UNIQUE(rule_id, dedup_key)
      );
      CREATE INDEX IF NOT EXISTS automation_jobs_status ON automation_jobs(status);
      CREATE INDEX IF NOT EXISTS automation_jobs_target ON automation_jobs(target_project_id);
    `);
  }
  close(): void { this.db.close(); }
  rules(): WorkflowDispatchRule[] {
    return (this.db.prepare("SELECT value FROM automation_rules ORDER BY rowid").all() as { value: string }[]).map(row => JSON.parse(row.value));
  }
  saveRule(rule: WorkflowDispatchRule): void {
    this.db.prepare("INSERT INTO automation_rules VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET value=excluded.value").run(rule.id, JSON.stringify(rule));
  }
  get(id: string): StoredWorkflowJob | null {
    const row = this.db.prepare("SELECT value FROM automation_jobs WHERE id=?").get(id) as { value: string } | undefined;
    return row ? JSON.parse(row.value) : null;
  }
  list(projectId: string, offset = 0, ruleId?: string, filter?: WorkflowJobFilter): WorkflowJobPage {
    const where = "(source_project_id=? OR target_project_id=?) AND (? IS NULL OR rule_id=?)";
    const parameters = [projectId, projectId, ruleId ?? null, ruleId ?? null];
    const statuses = filter ? [...WORKFLOW_JOB_FILTERS[filter]] : [];
    const filteredWhere = `${where}${statuses.length ? ` AND status IN (${statuses.map(() => "?").join(",")})` : ""}`;
    const rows = this.db.prepare(`SELECT value FROM automation_jobs WHERE ${filteredWhere} ORDER BY rowid DESC LIMIT 50 OFFSET ?`).all(...parameters, ...statuses, offset) as { value: string }[];
    const grouped = this.db.prepare(`SELECT status, COUNT(*) AS count FROM automation_jobs WHERE ${where} GROUP BY status`).all(...parameters) as { status: WorkflowJobStatus; count: number }[];
    const counts = Object.fromEntries(Object.entries(WORKFLOW_JOB_FILTERS).map(([key, values]) =>
      [key, grouped.filter(row => (values as readonly WorkflowJobStatus[]).includes(row.status)).reduce((sum, row) => sum + row.count, 0)])) as WorkflowJobPage["counts"];
    const total = filter ? counts[filter] : Object.values(counts).reduce((sum, count) => sum + count, 0);
    const dispatchedKeys = ruleId ? (this.db.prepare(`SELECT dedup_key FROM automation_jobs WHERE ${where}`).all(...parameters) as { dedup_key: string }[]).map(row => row.dedup_key) : [];
    return { jobs: rows.map(row => { const { snapshot, parameterValues, ...job } = JSON.parse(row.value) as StoredWorkflowJob; return job; }), total, counts, dispatchedKeys };
  }
  pending(): StoredWorkflowJob[] {
    return (this.db.prepare("SELECT value FROM automation_jobs WHERE status IN ('queued','running','waiting') ORDER BY rowid").all() as { value: string }[]).map(row => JSON.parse(row.value));
  }
  enqueue(rule: WorkflowDispatchRule, sourceInstanceId: string | null, snapshot: AgentProject, items: WorkflowDispatchItem[]): string[] {
    return this.db.transaction(() => {
      const created: string[] = [];
      for (const item of items) {
        if (this.db.prepare("SELECT id FROM automation_jobs WHERE rule_id=? AND dedup_key=?").get(rule.id, item.key)) continue;
        const count = this.db.prepare("SELECT COUNT(*) AS count FROM automation_jobs WHERE status IN ('queued','running','waiting')").get() as { count: number };
        if (count.count >= 10000) throw new Error("La limite de 10 000 dossiers actifs est atteinte. Clôturez des dossiers avant de reprendre la veille.");
        const now = new Date().toISOString();
        const job: StoredWorkflowJob = { ...item, id: randomUUID(), ruleId: rule.id, sourceProjectId: rule.sourceProjectId,
          sourceAgentId: rule.sourceAgentId, sourceInstanceId, targetProjectId: rule.targetProjectId,
          status: "queued", createdAt: now, updatedAt: now, error: null, snapshot, parameterValues: rule.parameterValues };
        this.db.prepare("INSERT INTO automation_jobs VALUES (?, ?, ?, ?, ?, ?, ?)").run(job.id, rule.id, item.key, rule.sourceProjectId, rule.targetProjectId, job.status, JSON.stringify(job));
        created.push(job.id);
      }
      return created;
    })();
  }
  update(id: string, status: WorkflowJobStatus, error: string | null = null): void {
    const job = this.get(id);
    if (!job) return;
    job.status = status; job.error = error; job.updatedAt = new Date().toISOString();
    this.db.prepare("UPDATE automation_jobs SET status=?, value=? WHERE id=?").run(status, JSON.stringify(job), id);
  }

  queueResume(id: string, clarification: string): void {
    this.db.transaction(() => {
      const job = this.get(id);
      if (!job) throw new Error("Dossier introuvable.");
      if (!["failed", "blocked", "interrupted"].includes(job.status)) throw new Error("Ce dossier ne peut pas être repris maintenant.");
      if (clarification) job.clarifications = [...(job.clarifications ?? []), { content: clarification, createdAt: new Date().toISOString() }];
      job.status = "queued"; job.error = null; job.updatedAt = new Date().toISOString();
      this.db.prepare("UPDATE automation_jobs SET status=?, value=? WHERE id=?").run(job.status, JSON.stringify(job), id);
    })();
  }
}
