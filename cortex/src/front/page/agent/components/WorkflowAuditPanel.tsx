import { useEffect, useState } from "react";
import {
  Activity,
  AlertCircle,
  ArrowDown,
  ArrowRight,
  Bot,
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  CircleStop,
  Clipboard,
  ClipboardCheck,
  Clock3,
  Download,
  Gauge,
  GitBranch,
  Hash,
  LoaderCircle,
  MessageSquareText,
  RefreshCw,
  Route,
  Timer,
  UsersRound
} from "lucide-react";
import { parseAgentResponse } from "../../../../shared/AgentResponse.ts";
import {
  exportWorkflowAuditRun,
  getWorkflowAuditRun,
  getWorkflowAuditRuns,
  type WorkflowAuditAgentExecution,
  type WorkflowAuditRunDetail,
  type WorkflowAuditRunScope,
  type WorkflowAuditRunStatus,
  type WorkflowAuditRunSummary
} from "../../../services/agentApi.ts";
import { useTranslation, type Translate } from "../../../i18n.tsx";

const PAGE_SIZE = 20;

export function WorkflowAuditPanel({
  projectId,
  onStartRun
}: {
  projectId: string;
  onStartRun: () => void;
}) {
  const { language, t } = useTranslation();
  const [runs, setRuns] = useState<WorkflowAuditRunSummary[]>([]);
  const [scope, setScope] = useState<WorkflowAuditRunScope>("workflow");
  const [total, setTotal] = useState(0);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [detail, setDetail] = useState<WorkflowAuditRunDetail | null>(null);
  const [detailRefreshVersion, setDetailRefreshVersion] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingDetail, setIsLoadingDetail] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [copiedRunId, setCopiedRunId] = useState<string | null>(null);
  const [error, setError] = useState("");

  async function loadRuns(showLoader = true): Promise<void> {
    if (showLoader) setIsLoading(true);
    setError("");

    try {
      const page = await getWorkflowAuditRuns(projectId, scope, PAGE_SIZE, 0);
      setRuns(page.items);
      setTotal(page.total);
      setDetailRefreshVersion((version) => version + 1);
      setSelectedRunId((currentId) =>
        currentId && page.items.some((run) => run.id === currentId)
          ? currentId
          : page.items[0]?.id ?? null
      );
    } catch (loadError) {
      setError(getErrorMessage(loadError, t("audit.loadError")));
    } finally {
      if (showLoader) setIsLoading(false);
    }
  }

  async function loadMore(): Promise<void> {
    setIsLoading(true);
    setError("");

    try {
      const page = await getWorkflowAuditRuns(
        projectId,
        scope,
        PAGE_SIZE,
        runs.length
      );
      setRuns((currentRuns) => [...currentRuns, ...page.items]);
      setTotal(page.total);
    } catch (loadError) {
      setError(getErrorMessage(loadError, t("audit.loadError")));
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    setRuns([]);
    setDetail(null);
    setSelectedRunId(null);
    void loadRuns();
  }, [projectId, scope]);

  useEffect(() => {
    if (!selectedRunId) {
      setDetail(null);
      return;
    }

    let active = true;
    setIsLoadingDetail(true);
    setError("");

    void getWorkflowAuditRun(projectId, selectedRunId)
      .then((run) => {
        if (active) setDetail(run);
      })
      .catch((loadError: unknown) => {
        if (active) setError(getErrorMessage(loadError, t("audit.detailError")));
      })
      .finally(() => {
        if (active) setIsLoadingDetail(false);
      });

    return () => {
      active = false;
    };
  }, [projectId, selectedRunId, detailRefreshVersion]);

  useEffect(() => {
    if (!runs.some((run) => run.status === "running")) return;
    const timer = window.setInterval(() => void loadRuns(false), 5_000);
    return () => window.clearInterval(timer);
  }, [projectId, runs, scope]);

  async function handleExport(): Promise<void> {
    if (!selectedRunId) return;
    setIsExporting(true);
    setError("");

    try {
      const blob = await exportWorkflowAuditRun(projectId, selectedRunId);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `cortex-audit-${selectedRunId}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    } catch (exportError) {
      setError(getErrorMessage(exportError, t("audit.exportError")));
    } finally {
      setIsExporting(false);
    }
  }

  async function handleCopyRunId(runId: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(runId);
      setCopiedRunId(runId);
      window.setTimeout(() => {
        setCopiedRunId((currentId) => currentId === runId ? null : currentId);
      }, 1_800);
    } catch {
      // The identifier remains selectable when clipboard access is unavailable.
    }
  }

  const formatDate = (value: string): string => new Intl.DateTimeFormat(
    language,
    { dateStyle: "medium", timeStyle: "medium" }
  ).format(new Date(value));
  const executionOccurrences = detail
    ? getExecutionOccurrences(detail.executions)
    : new Map<string, { number: number; total: number }>();

  return (
    <section className="workflow-audit">
      <header className="workflow-audit__header">
        <div>
          <p className="eyebrow">{t("audit.eyebrow")}</p>
          <h2>{t("audit.title")}</h2>
          <p>{t("audit.description")}</p>
        </div>
        <div className="workflow-audit__header-actions">
          {total > 0 && (
            <span className="workflow-audit__total">
              <Activity aria-hidden="true" size={15} />
              {t(
                total === 1 ? "audit.runCountOne" : "audit.runCountMany",
                { count: total }
              )}
            </span>
          )}
          <button
            className="workflow-audit__refresh"
            type="button"
            onClick={() => void loadRuns()}
            disabled={isLoading}
          >
            <RefreshCw
              className={isLoading ? "workflow-audit__spinner" : undefined}
              aria-hidden="true"
              size={15}
            />
            {t("audit.refresh")}
          </button>
        </div>
      </header>

      {error && (
        <p className="workflow-audit__error" role="alert">
          <AlertCircle aria-hidden="true" size={16} />
          {error}
        </p>
      )}

      {isLoading && runs.length === 0 ? (
        <p className="workflow-audit__empty">
          <LoaderCircle className="workflow-audit__spinner" aria-hidden="true" size={18} />
          {t("common.loading")}
        </p>
      ) : (
        <div className="workflow-audit__layout">
          <aside className="workflow-audit__runs" aria-label={t("audit.runsAria")}>
            <header className="workflow-audit__runs-header">
              <div>
                <span>{t("audit.runs")}</span>
                <small>{t("audit.latestFirst")}</small>
              </div>
              <strong>{total}</strong>
            </header>
            <div className="workflow-audit__scope-filter" role="group" aria-label={t("audit.scopeFilter")}>
              <button
                className={scope === "workflow" ? "workflow-audit__scope-filter--active" : ""}
                type="button"
                aria-pressed={scope === "workflow"}
                onClick={() => setScope("workflow")}
              >
                <GitBranch aria-hidden="true" size={14} />
                {t("audit.scope.workflowPlural")}
              </button>
              <button
                className={scope === "agent" ? "workflow-audit__scope-filter--active" : ""}
                type="button"
                aria-pressed={scope === "agent"}
                onClick={() => setScope("agent")}
              >
                <Bot aria-hidden="true" size={14} />
                {t("audit.scope.agentPlural")}
              </button>
            </div>
            <div className="workflow-audit__runs-list">
              {runs.map((run) => (
                <button
                  className={`workflow-audit__run${
                    selectedRunId === run.id ? " workflow-audit__run--selected" : ""
                  }`}
                  type="button"
                  key={run.id}
                  onClick={() => setSelectedRunId(run.id)}
                  aria-pressed={selectedRunId === run.id}
                >
                  <span className="workflow-audit__run-topline">
                    <span className={`workflow-audit__status workflow-audit__status--${run.status}`}>
                      {statusIcon(run.status)}
                      {t(`audit.status.${run.status}` as Parameters<typeof t>[0])}
                    </span>
                    {run.durationMs !== null && <small>{formatDuration(run.durationMs)}</small>}
                  </span>
                  <strong>{formatDate(run.startedAt)}</strong>
                  <span className="workflow-audit__run-meta">
                    <span>{t(`audit.trigger.${run.trigger}` as Parameters<typeof t>[0])}</span>
                    <span aria-hidden="true">•</span>
                    <span>{t(
                      run.agentExecutionCount === 1
                        ? "audit.executionCountOne"
                        : "audit.executionCountMany",
                      { count: run.agentExecutionCount }
                    )}</span>
                  </span>
                </button>
              ))}
              {runs.length < total && (
                <button
                  className="workflow-audit__more"
                  type="button"
                  onClick={() => void loadMore()}
                  disabled={isLoading}
                >
                  {t("audit.loadMore")}
                </button>
              )}
            </div>
          </aside>

          <div className="workflow-audit__detail">
            {!selectedRunId ? (
              <div className="workflow-audit__empty workflow-audit__empty--action">
                <p>{t(`audit.empty.${scope}` as Parameters<typeof t>[0])}</p>
                <button type="button" onClick={onStartRun}>
                  {t("audit.emptyAction")}
                </button>
              </div>
            ) : isLoadingDetail || !detail ? (
              <p className="workflow-audit__empty">
                <LoaderCircle className="workflow-audit__spinner" aria-hidden="true" size={18} />
                {t("common.loading")}
              </p>
            ) : (
              <>
                <section className="workflow-audit__overview">
                  <header className="workflow-audit__detail-header">
                    <div>
                      <span className="workflow-audit__detail-badges">
                        <span className={`workflow-audit__status workflow-audit__status--${detail.status}`}>
                          {statusIcon(detail.status)}
                          {t(`audit.status.${detail.status}` as Parameters<typeof t>[0])}
                        </span>
                        <span className="workflow-audit__scope-badge">
                          {(detail.scope ?? scope) === "workflow"
                            ? <GitBranch aria-hidden="true" size={13} />
                            : <Bot aria-hidden="true" size={13} />}
                          {t((detail.scope ?? scope) === "workflow"
                            ? "audit.scope.workflow"
                            : "audit.scope.agent"
                          )}
                        </span>
                      </span>
                      <h2>{formatDate(detail.startedAt)}</h2>
                      <p>{t(`audit.trigger.${detail.trigger}` as Parameters<typeof t>[0])}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleExport()}
                      disabled={isExporting}
                    >
                      {isExporting
                        ? <LoaderCircle className="workflow-audit__spinner" aria-hidden="true" size={15} />
                        : <Download aria-hidden="true" size={15} />}
                      {t("audit.export")}
                    </button>
                  </header>

                  <dl className="workflow-audit__summary">
                    <div>
                      <dt><Timer aria-hidden="true" size={15} />{t("audit.duration")}</dt>
                      <dd>{detail.durationMs !== null ? formatDuration(detail.durationMs) : "—"}</dd>
                    </div>
                    <div>
                      <dt><UsersRound aria-hidden="true" size={15} />{t("audit.agentsExecuted")}</dt>
                      <dd>{detail.agentExecutionCount}</dd>
                    </div>
                    <div>
                      <dt><CalendarDays aria-hidden="true" size={15} />{t("audit.finishedAt")}</dt>
                      <dd>{detail.finishedAt ? formatDate(detail.finishedAt) : t("audit.inProgress")}</dd>
                    </div>
                  </dl>

                  <div className="workflow-audit__run-id">
                    <Hash aria-hidden="true" size={15} />
                    <span>{t("audit.runId")}</span>
                    <code>{detail.id}</code>
                    <button
                      type="button"
                      onClick={() => void handleCopyRunId(detail.id)}
                      aria-label={copiedRunId === detail.id ? t("audit.copied") : t("audit.copyRunId")}
                      title={copiedRunId === detail.id ? t("audit.copied") : t("audit.copyRunId")}
                    >
                      {copiedRunId === detail.id
                        ? <ClipboardCheck aria-hidden="true" size={15} />
                        : <Clipboard aria-hidden="true" size={15} />}
                    </button>
                  </div>
                </section>

                {detail.error && (
                  <p className="workflow-audit__run-error">
                    {getAuditErrorMessage(detail.error, t)}
                  </p>
                )}

                <AuditJsonBlock
                  title={t("audit.parameters")}
                  value={detail.parameterValues}
                  emptyLabel={t("audit.noParameters")}
                />

                <section className="workflow-audit__timeline">
                  <header>
                    <div>
                      <p className="eyebrow">{t("audit.executionDetails")}</p>
                      <h3>{t("audit.timeline")}</h3>
                    </div>
                    <span>{t(
                      detail.executions.length === 1
                        ? "audit.executionCountOne"
                        : "audit.executionCountMany",
                      { count: detail.executions.length }
                    )}</span>
                  </header>
                  {detail.executions.length === 0 ? (
                    <p>{t("audit.noExecutions")}</p>
                  ) : (
                    <div className="workflow-audit__flow">
                      {detail.executions.map((execution, index) => {
                        const snapshotAgent = detail.workflowSnapshot?.agents.find(
                          (agent) => agent.id === execution.agentId
                        );
                        const selectedNextAgentIds = execution.nextAgentIds ?? [];
                        const unselectedNextAgentIds = snapshotAgent?.nextAgentIds.filter(
                          (agentId) => !selectedNextAgentIds.includes(agentId)
                        ) ?? [];
                        const nextExecution = detail.executions[index + 1];
                        const sourceWorkflowIndex = detail.workflowSnapshot?.agents.findIndex(
                          (agent) => agent.id === execution.agentId
                        ) ?? -1;
                        const targetWorkflowIndex = nextExecution
                          ? detail.workflowSnapshot?.agents.findIndex(
                            (agent) => agent.id === nextExecution.agentId
                          ) ?? -1
                          : -1;
                        const isLoop = nextExecution !== undefined &&
                          selectedNextAgentIds.includes(nextExecution.agentId) &&
                          sourceWorkflowIndex >= 0 &&
                          targetWorkflowIndex >= 0 &&
                          targetWorkflowIndex <= sourceWorkflowIndex;
                        const resolveAgentName = (agentId: string): string =>
                          detail.workflowSnapshot?.agents.find(
                            (agent) => agent.id === agentId
                          )?.name ?? detail.executions.find(
                            (candidate) => candidate.agentId === agentId
                          )?.agentName ?? agentId;

                        return (
                          <div className="workflow-audit__flow-step" key={execution.id}>
                            <AuditExecution
                              execution={execution}
                              index={index + 1}
                              occurrence={executionOccurrences.get(execution.id)}
                              description={snapshotAgent?.description}
                              selectedNextAgentNames={selectedNextAgentIds.map(resolveAgentName)}
                              unselectedNextAgentNames={unselectedNextAgentIds.map(resolveAgentName)}
                              formatDate={formatDate}
                            />
                            {nextExecution && (
                              <div
                                className={`workflow-audit__flow-connector${
                                  isLoop ? " workflow-audit__flow-connector--loop" : ""
                                }`}
                                aria-label={isLoop
                                  ? t("audit.loopContinues", {
                                    name: resolveAgentName(nextExecution.agentId)
                                  })
                                  : t("audit.flowContinues", {
                                    name: resolveAgentName(nextExecution.agentId)
                                  })
                                }
                              >
                                <span />
                                <small>
                                  {isLoop
                                    ? t("audit.loopBack", {
                                      name: resolveAgentName(nextExecution.agentId)
                                    })
                                    : t("audit.contextTransfer")
                                  }
                                </small>
                                <ArrowDown aria-hidden="true" size={17} strokeWidth={1.8} />
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>
              </>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function AuditExecution({
  execution,
  index,
  occurrence,
  description,
  selectedNextAgentNames,
  unselectedNextAgentNames,
  formatDate
}: {
  execution: WorkflowAuditAgentExecution;
  index: number;
  occurrence?: { number: number; total: number };
  description?: string;
  selectedNextAgentNames: string[];
  unselectedNextAgentNames: string[];
  formatDate: (value: string) => string;
}) {
  const { t } = useTranslation();
  const hasResponse = execution.response !== null && execution.response.trim() !== "";
  const parsedResponse = hasResponse
    ? parseAgentResponse(execution.response!)
    : null;
  const transmittedResponse = parsedResponse && parsedResponse.items.length > 0
    ? parsedResponse.items.map((item) => item.content).join("\n\n")
    : execution.response;

  return (
    <article className={`workflow-audit__execution workflow-audit__execution--${execution.status}`}>
      <header className="workflow-audit__execution-header">
        <span className={`workflow-audit__step workflow-audit__step--${execution.status}`}>
          {index}
        </span>
        <span className="workflow-audit__agent-icon">
          <Bot aria-hidden="true" size={19} strokeWidth={1.7} />
        </span>
        <span className="workflow-audit__execution-title">
          <strong>{execution.agentName}</strong>
          {description && <small>{description}</small>}
          {occurrence && occurrence.total > 1 && (
            <span className="workflow-audit__occurrence">
              {t("audit.occurrence", {
                number: occurrence.number,
                total: occurrence.total
              })}
            </span>
          )}
        </span>
        <span className="workflow-audit__execution-model">
          <Gauge aria-hidden="true" size={13} />
          {execution.engine}
          {execution.model ? ` / ${execution.model}` : ""}
        </span>
        <span className={`workflow-audit__status workflow-audit__status--${execution.status}`}>
          {statusIcon(execution.status)}
          {t(`audit.status.${execution.status}` as Parameters<typeof t>[0])}
        </span>
        <small className="workflow-audit__execution-time">
          {formatDate(execution.startedAt)}
          {execution.durationMs !== null && <span>{formatDuration(execution.durationMs)}</span>}
        </small>
      </header>

      <div className="workflow-audit__interactions">
        {execution.input.upstreamItems.length === 0 ? (
          <div className="workflow-audit__interaction workflow-audit__interaction--start">
            <span className="workflow-audit__interaction-icon">
              <Route aria-hidden="true" size={16} />
            </span>
            <div>
              <strong>{t("audit.workflowStart")}</strong>
              <p>{t("audit.noUpstreamContext")}</p>
            </div>
          </div>
        ) : execution.input.upstreamItems.map((item, itemIndex) => (
          <div
            className="workflow-audit__interaction workflow-audit__interaction--incoming"
            key={`${item.agentId}:${itemIndex}`}
          >
            <span className="workflow-audit__interaction-icon">
              <MessageSquareText aria-hidden="true" size={16} />
            </span>
            <div>
              <span className="workflow-audit__interaction-route">
                <strong>{item.agentName}</strong>
                <ArrowRight aria-hidden="true" size={14} />
                <span>{execution.agentName}</span>
              </span>
              <p>{item.content}</p>
            </div>
          </div>
        ))}

        <div className="workflow-audit__interaction workflow-audit__interaction--outgoing">
          <span className="workflow-audit__interaction-icon">
            <ArrowRight aria-hidden="true" size={16} />
          </span>
          <div>
            <span className="workflow-audit__interaction-route">
              <strong>{execution.agentName}</strong>
              <ArrowRight aria-hidden="true" size={14} />
              <span>
                {selectedNextAgentNames.length > 0
                  ? selectedNextAgentNames.join(", ")
                  : t("audit.workflowEnd")
                }
              </span>
            </span>
            <p>{transmittedResponse || t("audit.noResponse")}</p>
          </div>
        </div>
      </div>

      {(selectedNextAgentNames.length > 0 || unselectedNextAgentNames.length > 0) && (
        <div className="workflow-audit__routing">
          <Route aria-hidden="true" size={14} />
          <strong>{t("audit.routingDecision")}</strong>
          {selectedNextAgentNames.map((name) => (
            <span className="workflow-audit__route workflow-audit__route--selected" key={name}>
              <CheckCircle2 aria-hidden="true" size={12} />
              {name}
            </span>
          ))}
          {unselectedNextAgentNames.map((name) => (
            <span className="workflow-audit__route workflow-audit__route--unselected" key={name}>
              {t("audit.branchNotTaken", { name })}
            </span>
          ))}
        </div>
      )}

      <details className="workflow-audit__technical" open={execution.status === "failed"}>
        <summary>
          <span>{t("audit.technicalDetails")}</span>
          <ChevronDown className="workflow-audit__chevron" aria-hidden="true" size={16} />
        </summary>
        <div className="workflow-audit__execution-body">
        <dl className="workflow-audit__metadata">
          <div><dt>{t("audit.engine")}</dt><dd>{execution.engine}</dd></div>
          <div><dt>{t("audit.model")}</dt><dd>{execution.model ?? t("audit.default")}</dd></div>
          <div><dt>{t("audit.reasoning")}</dt><dd>{execution.reasoningEffort ?? t("audit.default")}</dd></div>
          <div><dt>{t("audit.attempt")}</dt><dd>{execution.attempt}</dd></div>
          <div><dt>{t("audit.session")}</dt><dd>{execution.sessionId ?? "—"}</dd></div>
          <div><dt>{t("audit.nextAgents")}</dt><dd>{selectedNextAgentNames.join(", ") || "—"}</dd></div>
        </dl>
        {execution.error && (
          <p className="workflow-audit__run-error">
            {getAuditErrorMessage(execution.error, t)}
          </p>
        )}
        <AuditJsonBlock title={t("audit.inputs")} value={execution.input} />
        <AuditTextBlock title={t("audit.prompt")} value={execution.prompt} />
        <AuditTextBlock
          title={t("audit.response")}
          value={execution.response ?? t("audit.noResponse")}
        />
        </div>
      </details>
    </article>
  );
}

function AuditJsonBlock({
  title,
  value,
  emptyLabel
}: {
  title: string;
  value: unknown;
  emptyLabel?: string;
}) {
  const isEmptyObject = typeof value === "object" && value !== null &&
    !Array.isArray(value) && Object.keys(value).length === 0;
  return (
    <section className="workflow-audit__block">
      <h3>{title}</h3>
      <pre>{isEmptyObject && emptyLabel ? emptyLabel : JSON.stringify(value, null, 2)}</pre>
    </section>
  );
}

function AuditTextBlock({ title, value }: { title: string; value: string }) {
  return (
    <section className="workflow-audit__block">
      <h3>{title}</h3>
      <pre>{value}</pre>
    </section>
  );
}

function statusIcon(status: WorkflowAuditRunStatus | WorkflowAuditAgentExecution["status"]) {
  if (status === "succeeded") {
    return <CheckCircle2 aria-hidden="true" size={14} />;
  }
  if (status === "running") {
    return <LoaderCircle className="workflow-audit__spinner" aria-hidden="true" size={14} />;
  }
  if (status === "failed" || status === "partial") {
    return <AlertCircle aria-hidden="true" size={14} />;
  }
  if (status === "cancelled" || status === "interrupted") {
    return <CircleStop aria-hidden="true" size={14} />;
  }
  return <Clock3 aria-hidden="true" size={14} />;
}

function formatDuration(durationMs: number): string {
  if (durationMs < 1000) return `${durationMs} ms`;
  if (durationMs < 60_000) return `${(durationMs / 1000).toFixed(1)} s`;
  const minutes = Math.floor(durationMs / 60_000);
  const seconds = Math.round((durationMs % 60_000) / 1000);
  return `${minutes} min ${seconds} s`;
}

function getExecutionOccurrences(
  executions: WorkflowAuditAgentExecution[]
): Map<string, { number: number; total: number }> {
  const totalsByAgentId = new Map<string, number>();
  const seenByAgentId = new Map<string, number>();

  for (const execution of executions) {
    totalsByAgentId.set(
      execution.agentId,
      (totalsByAgentId.get(execution.agentId) ?? 0) + 1
    );
  }

  return new Map(executions.map((execution) => {
    const number = (seenByAgentId.get(execution.agentId) ?? 0) + 1;
    seenByAgentId.set(execution.agentId, number);
    return [execution.id, {
      number,
      total: totalsByAgentId.get(execution.agentId) ?? 1
    }];
  }));
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

function getAuditErrorMessage(
  error: string,
  translate: Translate
): string {
  if (error === "Cortex stopped before the workflow completed.") {
    return translate("audit.interruptedWorkflow");
  }

  if (error === "Cortex stopped before the execution completed.") {
    return translate("audit.interruptedExecution");
  }

  return error;
}
