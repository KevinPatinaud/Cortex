import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import type {
  WorkflowAuditAgentExecution,
  WorkflowAuditExecutionInput,
  WorkflowAuditRunDetail,
  WorkflowAuditRunPage,
  WorkflowAuditRunScope,
  WorkflowAuditRunStatus,
  WorkflowAuditRunSummary
} from "../../../shared/WorkflowAudit.ts";
import type {
  CompleteWorkflowAuditExecutionInput,
  CreateWorkflowAuditRunInput,
  StartWorkflowAuditExecutionInput,
  ScheduledOccurrence,
  WorkflowCheckpointRecord,
  WorkflowAuditRepository
} from "../../application/service/workflowAudit/WorkflowAuditService.ts";

interface RunRow {
  id: string;
  project_id: string;
  trigger: WorkflowAuditRunSummary["trigger"];
  scope: WorkflowAuditRunScope;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  status: WorkflowAuditRunStatus;
  parameters_json: string;
  workflow_snapshot_json: string | null;
  error: string | null;
  agent_execution_count: number;
}

interface ExecutionRow {
  id: string;
  run_id: string;
  agent_id: string;
  agent_name: string;
  thread_id: string;
  attempt: number;
  engine: WorkflowAuditAgentExecution["engine"];
  model: string | null;
  reasoning_effort: string | null;
  started_at: string;
  finished_at: string | null;
  duration_ms: number | null;
  status: WorkflowAuditAgentExecution["status"];
  input_json: string;
  prompt: string;
  response: string | null;
  next_agent_ids_json: string | null;
  session_id: string | null;
  error: string | null;
}

interface CountRow {
  count: number;
}

interface AttemptRow {
  attempt: number;
}

export class SqliteWorkflowAuditRepository implements WorkflowAuditRepository {
  private readonly database: Database.Database;

  constructor(
    databaseFile: string,
    private readonly now: () => Date = () => new Date()
  ) {
    mkdirSync(path.dirname(databaseFile), { recursive: true });
    this.database = new Database(databaseFile);
    this.database.pragma("journal_mode = WAL");
    this.database.pragma("foreign_keys = ON");
    this.database.pragma("busy_timeout = 5000");
    this.database.transaction(() => this.initializeSchema())();
    this.database.transaction(() => this.markInterruptedExecutions())();
  }

  close(): void {
    this.database.close();
  }

  createRun(input: CreateWorkflowAuditRunInput): string {
    const runId = randomUUID();
    const startedAt = this.now().toISOString();
    const transaction = this.database.transaction(() => {
      this.database.prepare(`
        INSERT INTO workflow_runs (
          id, project_id, trigger, scope, started_at, status,
          parameters_json, workflow_snapshot_json, sequence
        ) VALUES (?, ?, ?, ?, ?, 'running', ?, ?,
          (SELECT COALESCE(MAX(sequence), 0) + 1 FROM workflow_runs))
      `).run(
        runId,
        input.projectId,
        input.trigger,
        input.scope,
        startedAt,
        JSON.stringify(input.parameterValues),
        input.workflowSnapshot === null
          ? null
          : JSON.stringify(input.workflowSnapshot)
      );
      this.insertEvent(runId, null, "run.started", startedAt, {
        trigger: input.trigger,
        scope: input.scope
      });
    });
    transaction();
    return runId;
  }

  completeRun(
    runId: string,
    status: WorkflowAuditRunStatus,
    error?: string
  ): void {
    const finishedAt = this.now().toISOString();
    const transaction = this.database.transaction(() => {
      this.database.prepare(`
        UPDATE workflow_runs
        SET finished_at = ?,
            duration_ms = MAX(0, CAST(ROUND((julianday(?) - julianday(started_at)) * 86400000) AS INTEGER)),
            status = ?,
            error = ?
        WHERE id = ?
      `).run(finishedAt, finishedAt, status, error ?? null, runId);
      this.insertEvent(runId, null, `run.${status}`, finishedAt, {
        error: error ?? null
      });
    });
    transaction();
  }

  addEvent(
    runId: string,
    executionId: string | null,
    type: string,
    payload?: unknown
  ): void {
    this.insertEvent(
      runId,
      executionId,
      type,
      this.now().toISOString(),
      payload
    );
  }

  startExecution(input: StartWorkflowAuditExecutionInput): string {
    const executionId = randomUUID();
    const startedAt = this.now().toISOString();
    const transaction = this.database.transaction(() => {
      const row = this.database.prepare(`
        SELECT COALESCE(MAX(attempt), 0) + 1 AS attempt
        FROM agent_executions
        WHERE run_id = ? AND agent_id = ? AND thread_id = ?
      `).get(input.runId, input.agentId, input.threadId) as AttemptRow;

      this.database.prepare(`
        INSERT INTO agent_executions (
          id, run_id, agent_id, agent_name, thread_id, attempt,
          engine, model, reasoning_effort, started_at, status,
          input_json, prompt, sequence
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'running', ?, ?,
          (SELECT COALESCE(MAX(sequence), 0) + 1 FROM agent_executions))
      `).run(
        executionId,
        input.runId,
        input.agentId,
        input.agentName,
        input.threadId,
        row.attempt,
        input.engine,
        input.model ?? null,
        input.reasoningEffort ?? null,
        startedAt,
        JSON.stringify(input.input),
        input.prompt
      );
      this.insertEvent(input.runId, executionId, "agent.started", startedAt, {
        agentId: input.agentId,
        threadId: input.threadId,
        attempt: row.attempt
      });
      this.insertEvent(input.runId, executionId, "prompt.sent", startedAt, {
        characterCount: input.prompt.length
      });
    });
    transaction();
    return executionId;
  }

  completeExecution(
    executionId: string,
    input: CompleteWorkflowAuditExecutionInput
  ): void {
    const finishedAt = this.now().toISOString();
    const transaction = this.database.transaction(() => {
      const execution = this.database.prepare(`
        SELECT run_id FROM agent_executions WHERE id = ?
      `).get(executionId) as { run_id: string } | undefined;

      this.database.prepare(`
        UPDATE agent_executions
        SET finished_at = ?,
            duration_ms = MAX(0, CAST(ROUND((julianday(?) - julianday(started_at)) * 86400000) AS INTEGER)),
            status = 'succeeded',
            response = ?,
            next_agent_ids_json = ?,
            session_id = ?,
            error = NULL
        WHERE id = ?
      `).run(
        finishedAt,
        finishedAt,
        input.response,
        input.nextAgentIds === null ? null : JSON.stringify(input.nextAgentIds),
        input.sessionId ?? null,
        executionId
      );

      if (execution) {
        this.insertEvent(
          execution.run_id,
          executionId,
          "response.received",
          finishedAt,
          {
            characterCount: input.response.length,
            nextAgentIds: input.nextAgentIds
          }
        );
        this.insertEvent(
          execution.run_id,
          executionId,
          "agent.succeeded",
          finishedAt
        );
      }
    });
    transaction();
  }

  failExecution(
    executionId: string,
    error: string,
    response?: string,
    sessionId?: string,
    status: "failed" | "cancelled" = "failed"
  ): void {
    const finishedAt = this.now().toISOString();
    const transaction = this.database.transaction(() => {
      const execution = this.database.prepare(`
        SELECT run_id FROM agent_executions WHERE id = ?
      `).get(executionId) as { run_id: string } | undefined;

      this.database.prepare(`
        UPDATE agent_executions
        SET finished_at = ?,
            duration_ms = MAX(0, CAST(ROUND((julianday(?) - julianday(started_at)) * 86400000) AS INTEGER)),
            status = ?,
            response = COALESCE(?, response),
            session_id = COALESCE(?, session_id),
            error = ?
        WHERE id = ?
      `).run(
        finishedAt,
        finishedAt,
        status,
        response ?? null,
        sessionId ?? null,
        error,
        executionId
      );

      if (execution) {
        this.insertEvent(
          execution.run_id,
          executionId,
          `agent.${status}`,
          finishedAt,
          { error }
        );
      }
    });
    transaction();
  }

  listRuns(
    projectId: string,
    limit: number,
    offset: number,
    scope?: WorkflowAuditRunScope
  ): WorkflowAuditRunPage {
    const rows = this.database.prepare(`
      SELECT runs.*,
        COUNT(executions.id) AS agent_execution_count
      FROM workflow_runs AS runs
      LEFT JOIN agent_executions AS executions ON executions.run_id = runs.id
      WHERE runs.project_id = ? AND (? IS NULL OR runs.scope = ?)
      GROUP BY runs.id
      ORDER BY runs.sequence DESC
      LIMIT ? OFFSET ?
    `).all(projectId, scope ?? null, scope ?? null, limit, offset) as RunRow[];
    const countRow = this.database.prepare(`
      SELECT COUNT(*) AS count
      FROM workflow_runs
      WHERE project_id = ? AND (? IS NULL OR scope = ?)
    `).get(projectId, scope ?? null, scope ?? null) as CountRow;

    return {
      items: rows.map((row) => this.toRunSummary(row)),
      total: countRow.count,
      limit,
      offset
    };
  }

  getRun(projectId: string, runId: string): WorkflowAuditRunDetail | null {
    const row = this.database.prepare(`
      SELECT runs.*,
        COUNT(executions.id) AS agent_execution_count
      FROM workflow_runs AS runs
      LEFT JOIN agent_executions AS executions ON executions.run_id = runs.id
      WHERE runs.project_id = ? AND runs.id = ?
      GROUP BY runs.id
    `).get(projectId, runId) as RunRow | undefined;

    if (!row) {
      return null;
    }

    const executionRows = this.database.prepare(`
      SELECT * FROM agent_executions
      WHERE run_id = ?
      ORDER BY sequence ASC
    `).all(runId) as ExecutionRow[];

    return {
      ...this.toRunSummary(row),
      parameterValues: this.parseJson<Record<string, string>>(
        row.parameters_json,
        {}
      ),
      workflowSnapshot: row.workflow_snapshot_json === null
        ? null
        : this.parseJson(row.workflow_snapshot_json, null),
      executions: executionRows.map((execution) =>
        this.toAgentExecution(execution)
      )
    };
  }

  saveCheckpoint(projectId: string, fingerprint: string, state: unknown): void {
    this.database.prepare(`
      INSERT INTO workflow_checkpoints (project_id, fingerprint, state_json)
      VALUES (?, ?, ?)
      ON CONFLICT(project_id) DO UPDATE SET fingerprint = excluded.fingerprint, state_json = excluded.state_json
    `).run(projectId, fingerprint, JSON.stringify(state));
  }

  getCheckpoint(projectId: string): WorkflowCheckpointRecord | null {
    const row = this.database.prepare(`SELECT fingerprint, state_json FROM workflow_checkpoints WHERE project_id = ?`)
      .get(projectId) as { fingerprint: string; state_json: string } | undefined;
    return row ? { fingerprint: row.fingerprint, state: this.parseJson(row.state_json, null) } : null;
  }

  deleteCheckpoint(projectId: string): void {
    this.database.prepare("DELETE FROM workflow_checkpoints WHERE project_id = ?").run(projectId);
  }

  claimScheduledOccurrence(projectId: string, scheduledAt: string): boolean {
    return this.database.prepare(`
      INSERT OR IGNORE INTO scheduled_occurrences (project_id, scheduled_at, status)
      VALUES (?, ?, 'running')
    `).run(projectId, scheduledAt).changes === 1;
  }

  completeScheduledOccurrence(projectId: string, scheduledAt: string, status: ScheduledOccurrence["status"], error?: string): void {
    this.database.prepare(`
      UPDATE scheduled_occurrences SET status = ?, error = ?
      WHERE project_id = ? AND scheduled_at = ?
    `).run(status, error ?? null, projectId, scheduledAt);
  }

  getLatestScheduledOccurrence(projectId: string): ScheduledOccurrence | null {
    return (this.database.prepare(`
      SELECT scheduled_at AS scheduledAt, status, error
      FROM scheduled_occurrences WHERE project_id = ?
      ORDER BY scheduled_at DESC LIMIT 1
    `).get(projectId) as ScheduledOccurrence | undefined) ?? null;
  }

  private initializeSchema(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS workflow_runs (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        trigger TEXT NOT NULL CHECK (trigger IN ('manual', 'scheduled')),
        scope TEXT NOT NULL CHECK (scope IN ('workflow', 'agent')),
        started_at TEXT NOT NULL,
        finished_at TEXT,
        duration_ms INTEGER,
        status TEXT NOT NULL,
        parameters_json TEXT NOT NULL,
        workflow_snapshot_json TEXT,
        error TEXT
      );

      CREATE INDEX IF NOT EXISTS workflow_runs_project_started_idx
        ON workflow_runs(project_id, started_at DESC);

      CREATE TABLE IF NOT EXISTS agent_executions (
        id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
        agent_id TEXT NOT NULL,
        agent_name TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        attempt INTEGER NOT NULL,
        engine TEXT NOT NULL,
        model TEXT,
        reasoning_effort TEXT,
        started_at TEXT NOT NULL,
        finished_at TEXT,
        duration_ms INTEGER,
        status TEXT NOT NULL,
        input_json TEXT NOT NULL,
        prompt TEXT NOT NULL,
        response TEXT,
        next_agent_ids_json TEXT,
        session_id TEXT,
        error TEXT
      );

      CREATE INDEX IF NOT EXISTS agent_executions_run_started_idx
        ON agent_executions(run_id, started_at);

      CREATE TABLE IF NOT EXISTS audit_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL REFERENCES workflow_runs(id) ON DELETE CASCADE,
        execution_id TEXT REFERENCES agent_executions(id) ON DELETE CASCADE,
        occurred_at TEXT NOT NULL,
        type TEXT NOT NULL,
        payload_json TEXT
      );

      CREATE INDEX IF NOT EXISTS audit_events_run_occurred_idx
        ON audit_events(run_id, occurred_at, id);
    `);

    for (const table of ["workflow_runs", "agent_executions"]) {
      const columns = this.database.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
      if (!columns.some((column) => column.name === "sequence")) {
        this.database.exec(`ALTER TABLE ${table} ADD COLUMN sequence INTEGER;
          UPDATE ${table} SET sequence = rowid;`);
      }
      this.database.exec(`CREATE UNIQUE INDEX IF NOT EXISTS ${table}_sequence_idx ON ${table}(sequence);`);
    }
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS workflow_checkpoints (
        project_id TEXT PRIMARY KEY,
        fingerprint TEXT NOT NULL,
        state_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS scheduled_occurrences (
        project_id TEXT NOT NULL,
        scheduled_at TEXT NOT NULL,
        status TEXT NOT NULL,
        error TEXT,
        PRIMARY KEY (project_id, scheduled_at)
      );
    `);

    const runColumns = this.database.prepare(
      "PRAGMA table_info(workflow_runs)"
    ).all() as Array<{ name: string }>;

    if (!runColumns.some((column) => column.name === "scope")) {
      this.database.exec(`
        ALTER TABLE workflow_runs
          ADD COLUMN scope TEXT NOT NULL DEFAULT 'workflow'
          CHECK (scope IN ('workflow', 'agent'));

        UPDATE workflow_runs
        SET scope = 'agent'
        WHERE trigger = 'manual'
          AND (
            SELECT COUNT(*)
            FROM agent_executions
            WHERE agent_executions.run_id = workflow_runs.id
          ) <= 1;
      `);
    }

    this.database.exec(`
      CREATE INDEX IF NOT EXISTS workflow_runs_project_scope_started_idx
        ON workflow_runs(project_id, scope, started_at DESC);
    `);
  }

  private markInterruptedExecutions(): void {
    const interruptedAt = this.now().toISOString();
    this.database.prepare(`UPDATE scheduled_occurrences
      SET status = 'interrupted', error = 'Cortex stopped before the scheduled execution completed.'
      WHERE status = 'running'`).run();
    this.database.prepare(`
      UPDATE agent_executions
      SET status = 'interrupted',
          finished_at = ?,
          duration_ms = MAX(0, CAST(ROUND((julianday(?) - julianday(started_at)) * 86400000) AS INTEGER)),
          error = COALESCE(error, 'Cortex stopped before the execution completed.')
      WHERE status = 'running'
    `).run(interruptedAt, interruptedAt);
    this.database.prepare(`
      UPDATE workflow_runs
      SET status = 'interrupted',
          finished_at = ?,
          duration_ms = MAX(0, CAST(ROUND((julianday(?) - julianday(started_at)) * 86400000) AS INTEGER)),
          error = COALESCE(error, 'Cortex stopped before the workflow completed.')
      WHERE status = 'running'
    `).run(interruptedAt, interruptedAt);
  }

  private insertEvent(
    runId: string,
    executionId: string | null,
    type: string,
    occurredAt: string,
    payload?: unknown
  ): void {
    this.database.prepare(`
      INSERT INTO audit_events (
        run_id, execution_id, occurred_at, type, payload_json
      ) VALUES (?, ?, ?, ?, ?)
    `).run(
      runId,
      executionId,
      occurredAt,
      type,
      payload === undefined ? null : JSON.stringify(payload)
    );
  }

  private toRunSummary(row: RunRow): WorkflowAuditRunSummary {
    return {
      id: row.id,
      projectId: row.project_id,
      trigger: row.trigger,
      scope: row.scope,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      durationMs: row.duration_ms,
      status: row.status,
      error: row.error,
      agentExecutionCount: row.agent_execution_count
    };
  }

  private toAgentExecution(row: ExecutionRow): WorkflowAuditAgentExecution {
    return {
      id: row.id,
      runId: row.run_id,
      agentId: row.agent_id,
      agentName: row.agent_name,
      threadId: row.thread_id,
      attempt: row.attempt,
      engine: row.engine,
      model: row.model,
      reasoningEffort: row.reasoning_effort,
      startedAt: row.started_at,
      finishedAt: row.finished_at,
      durationMs: row.duration_ms,
      status: row.status,
      input: this.parseJson<WorkflowAuditExecutionInput>(row.input_json, {
        workflowParameterValues: {},
        additionalInstructions: "",
        upstreamItems: []
      }),
      prompt: row.prompt,
      response: row.response,
      nextAgentIds: row.next_agent_ids_json === null
        ? null
        : this.parseJson<string[]>(row.next_agent_ids_json, []),
      sessionId: row.session_id,
      error: row.error
    };
  }

  private parseJson<T>(value: string, fallback: T): T {
    try {
      return JSON.parse(value) as T;
    } catch {
      return fallback;
    }
  }
}
