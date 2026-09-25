import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DEFAULT_EXECUTION_POLICY, type ProjectExecutionPolicy, type ProjectExecutionUsage, type TokenUsage } from "../../../shared/ExecutionControl.ts";
import type { ExecutionCallContext, ExecutionControlRepository } from "../../application/service/executionControl/ExecutionControlService.ts";

export class SqliteExecutionControlRepository implements ExecutionControlRepository {
  private readonly db: Database.Database;
  constructor(file: string) {
    if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
    this.db = new Database(file);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("busy_timeout = 5000");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS project_execution_policy (project_id TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS provider_calls (
        id TEXT PRIMARY KEY, project_id TEXT, related_project_id TEXT, instance_id TEXT,
        engine TEXT NOT NULL, started_at TEXT NOT NULL, status TEXT NOT NULL,
        input_tokens INTEGER, output_tokens INTEGER, cached_input_tokens INTEGER
      );
      CREATE INDEX IF NOT EXISTS provider_calls_project_day ON provider_calls(project_id, started_at);
      CREATE INDEX IF NOT EXISTS provider_calls_related_day ON provider_calls(related_project_id, started_at);
      CREATE INDEX IF NOT EXISTS provider_calls_instance ON provider_calls(instance_id);
      UPDATE provider_calls SET status = 'interrupted' WHERE status = 'running';
    `);
  }
  close(): void { this.db.close(); }
  policy(projectId: string): ProjectExecutionPolicy {
    const row = this.db.prepare("SELECT value FROM project_execution_policy WHERE project_id=?").get(projectId) as {value: string} | undefined;
    return row ? { ...DEFAULT_EXECUTION_POLICY, ...JSON.parse(row.value) } : { ...DEFAULT_EXECUTION_POLICY };
  }
  savePolicy(projectId: string, policy: ProjectExecutionPolicy): void {
    this.db.prepare("INSERT INTO project_execution_policy VALUES (?, ?) ON CONFLICT(project_id) DO UPDATE SET value=excluded.value").run(projectId, JSON.stringify(policy));
  }
  usage(projectId: string, day: string): ProjectExecutionUsage {
    const start = `${day}T00:00:00.000Z`;
    const end = new Date(Date.parse(start) + 24 * 60 * 60 * 1000).toISOString();
    const row = this.db.prepare(`SELECT COUNT(*) AS calls,
      COUNT(input_tokens) AS measuredCalls, COALESCE(SUM(input_tokens),0) AS inputTokens,
      COALESCE(SUM(output_tokens),0) AS outputTokens, COALESCE(SUM(cached_input_tokens),0) AS cachedInputTokens,
      COALESCE(SUM(status='running'),0) AS activeCalls
      FROM provider_calls WHERE (project_id=? OR related_project_id=?) AND started_at >= ? AND started_at < ?`
    ).get(projectId, projectId, start, end) as Omit<ProjectExecutionUsage, "day">;
    return { day, ...row };
  }
  instanceCalls(instanceId: string): number {
    return (this.db.prepare("SELECT COUNT(*) AS count FROM provider_calls WHERE instance_id=?").get(instanceId) as { count: number }).count;
  }
  begin(context: ExecutionCallContext, engine: string, now: string): string {
    const id = randomUUID();
    this.db.prepare("INSERT INTO provider_calls (id,project_id,related_project_id,instance_id,engine,started_at,status) VALUES (?,?,?,?,?,?,'running')")
      .run(id, context.projectId ?? null, context.relatedProjectId ?? null, context.instanceId ?? null, engine, now);
    return id;
  }
  finish(id: string, usage: TokenUsage | undefined, failed: boolean): void {
    this.db.prepare("UPDATE provider_calls SET status=?,input_tokens=?,output_tokens=?,cached_input_tokens=? WHERE id=?")
      .run(failed ? "failed" : "completed", usage?.inputTokens ?? null, usage?.outputTokens ?? null, usage?.cachedInputTokens ?? null, id);
  }
}
