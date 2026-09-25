import { useEffect, useRef, useState } from "react";
import { requestJson } from "../../../services/apiClient.ts";
import { getWorkflowSchedule, type AgentProject, type WorkflowSchedule } from "../../../services/agentApi.ts";
import type { WorkflowRuntime } from "../../../../shared/WorkflowRuntime.ts";

export function mergeWorkflowRuntime(project: AgentProject, runtime: WorkflowRuntime): AgentProject {
  if (runtime.projectId !== project.projectId) return project;
  return { ...project, ...runtime, workflowInstance: runtime.workflowInstance,
    workflowDefinitionError: runtime.workflowDefinitionError, agents: project.agents.map(agent => {
    const state = runtime.agents.find(state => state.id === agent.id);
    return state ? { ...agent, ...state, executionError: state.executionError,
      executionStartedAt: state.executionStartedAt, executionLastActivityAt: state.executionLastActivityAt,
      executionProgress: state.executionProgress } : agent;
  }) };
}

/** Poll runtime separately from file definitions; never overlap or apply a previous project's response. */
export function useWorkflowPolling(content: AgentProject | null, locallyRunning: boolean,
  onContentRefresh: (content: AgentProject) => void) {
  const [workflowSchedule, setWorkflowSchedule] = useState<WorkflowSchedule | null>(null);
  const latest = useRef(content);
  latest.current = content;
  const active = locallyRunning || !!content?.agents.some(agent => agent.executionStatus === "running");
  const waiting = !!content?.agents.some(agent => agent.executionStatus === "waiting");
  const interval = active ? 1000 : waiting ? 5000 : 15000;

  useEffect(() => {
    if (!content) return;
    const projectId = content.projectId;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    async function refresh() {
      const snapshot = latest.current;
      try {
        const state = await requestJson<WorkflowRuntime>(`/api/agents/projects/${encodeURIComponent(projectId)}/runtime`, { signal: controller.signal });
        if (alive && snapshot?.projectId === projectId && latest.current === snapshot) {
          onContentRefresh(mergeWorkflowRuntime(snapshot, state));
        }
      } catch { /* A transient polling failure must not erase the last known state. */ }
      finally { if (alive) timer = setTimeout(() => void refresh(), interval); }
    }
    void refresh();
    return () => { alive = false; controller.abort(); clearTimeout(timer); };
  }, [content?.projectId, interval, onContentRefresh]);

  useEffect(() => {
    setWorkflowSchedule(null);
    if (!content) return;
    const projectId = content.projectId;
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const schedule = await getWorkflowSchedule(projectId);
        if (alive) setWorkflowSchedule(schedule);
      } catch { /* Keep manual controls usable when scheduling is unavailable. */ }
      finally { if (alive) timer = setTimeout(() => void refresh(), 15000); }
    }
    void refresh();
    return () => { alive = false; clearTimeout(timer); };
  }, [content?.projectId]);
  return { workflowSchedule, setWorkflowSchedule };
}
