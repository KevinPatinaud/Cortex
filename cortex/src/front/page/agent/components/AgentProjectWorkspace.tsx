import {
  lazy,
  Suspense,
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type CSSProperties
} from "react";
import { CalendarClock, Download, LoaderCircle, Pencil, Play, Plus, RotateCcw, Square } from "lucide-react";
import {
  loadAgentProject,
  getWorkflowSchedule,
  resetAgentProjectWorkflow,
  cancelProjectExecution,
  resumeWorkflow,
  type AgentDefinition,
  type AgentProject,
  type UpstreamAgentResult,
  type WorkflowParameterValues,
  type WorkflowSchedule
} from "../../../services/agentApi.ts";
import {
  exportProjectArchive,
  type Project
} from "../../../services/projectApi.ts";
import type { AgentResponsePayload } from "../../../../shared/AgentResponse.ts";
import {
  getCyclicAgentIds,
  getWorkflowEdgeKey,
  getWorkflowFeedbackEdgeKeys
} from "../../../../shared/AgentWorkflowGraph.ts";
import { useTranslation } from "../../../i18n.tsx";
import { ConfirmationDialog } from "../../project_manager/components/ConfirmationDialog.tsx";
import { MarkdownContent } from "./MarkdownContent.tsx";
import { AgentCard } from "./AgentCard.tsx";
import { HandoffToggle } from "./HandoffToggle.tsx";
import { WorkflowWaitPanel } from "./WorkflowWaitPanel.tsx";
import { WorkflowParametersPanel } from "./WorkflowParametersPanel.tsx";
import { WorkflowFeedbackLoop, type WorkflowFeedbackLoopPlacement } from "./WorkflowFeedbackLoop.tsx";
import { WorkflowConnections } from "./WorkflowConnections.tsx";
import { WorkflowConnectionLegend, WorkflowRoutingSummary } from "./WorkflowSemantics.tsx";
import { getWorkflowConnectionStatus, getWorkflowInstancePresentation, getWorkflowRoutingPresentation } from "./workflowPresentation.ts";
import {
  findLastAgentResponses,
  getAgentConversationThreads,
  getMissingWorkflowParameters,
  getDefaultHandoffSelections,
  haveSameIndexes,
  getPrerequisiteMessage,
  getApplicableUpstreamAgents,
  getTriggerUpstreamAgents,
  responseRoutesToAgent,
  getUpstreamAgentResult,
  getPlannedThreadCount,
  getWorkflowLevels,
  getWorkflowLaneLayout,
  type AgentResultState,
  type AgentResultStates
} from "./workflowState.ts";
import { updateBrowserUrl } from "../../shared/browserNavigation.ts";

const WorkflowScheduleDialog = lazy(() => import("./WorkflowScheduleDialog.tsx")
  .then((module) => ({ default: module.WorkflowScheduleDialog })));
const WorkflowAuditPanel = lazy(() => import("./WorkflowAuditPanel.tsx")
  .then((module) => ({ default: module.WorkflowAuditPanel })));

interface AgentProjectWorkspaceProps {
  project: Project | null;
  content: AgentProject | null;
  onEdit: () => void;
  onCreateProject: () => void;
  onContentRefresh: (content: AgentProject) => void;
  onRunStateChange: (
    projectId: string,
    status: "idle" | "running" | "completed"
  ) => void;
}

type HandoffEnabledAgentIdsByProject = Record<string, Set<string>>;
type AgentFlowKind = "standard" | "cycle" | "parallel";
type WorkspaceTab = "instructions" | "agents" | "audit";

const HANDOFF_PREFERENCES_STORAGE_KEY =
  "cortex.agent-workflow.handoff-preferences.v1";
const EMPTY_AGENT_ID_SET = new Set<string>();

function getWorkspaceTabFromUrl(): WorkspaceTab {
  const view = new URL(window.location.href).searchParams.get("view");
  return view === "instructions" || view === "audit" ? view : "agents";
}

function updateWorkspaceView(tab: WorkspaceTab, replace = false): void {
  const url = new URL(window.location.href);
  url.searchParams.set("view", tab === "agents" ? "workflow" : tab);
  updateBrowserUrl(url, replace);
}

function loadHandoffPreferences(): HandoffEnabledAgentIdsByProject {
  try {
    const storedPreferences = window.localStorage.getItem(
      HANDOFF_PREFERENCES_STORAGE_KEY
    );

    if (!storedPreferences) {
      return {};
    }

    const parsedPreferences = JSON.parse(storedPreferences) as unknown;

    if (
      typeof parsedPreferences !== "object" ||
      parsedPreferences === null ||
      Array.isArray(parsedPreferences)
    ) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(parsedPreferences)
        .filter(([, agentIds]) =>
          Array.isArray(agentIds) &&
          agentIds.every((agentId) => typeof agentId === "string")
        )
        .map(([projectId, agentIds]) => [
          projectId,
          new Set(agentIds as string[])
        ])
    );
  } catch {
    return {};
  }
}

function saveHandoffPreferences(
  preferences: HandoffEnabledAgentIdsByProject
): void {
  try {
    window.localStorage.setItem(
      HANDOFF_PREFERENCES_STORAGE_KEY,
      JSON.stringify(Object.fromEntries(
        Object.entries(preferences).map(([projectId, agentIds]) => [
          projectId,
          [...agentIds]
        ])
      ))
    );
  } catch {
    // The workflow remains usable when browser storage is unavailable.
  }
}

function getProjectName(directoryPath: string): string {
  const pathParts = directoryPath.split(/[\\/]/).filter(Boolean);
  return pathParts.at(-1) || directoryPath;
}

function getProjectArchiveFileName(projectName: string): string {
  const portableName = projectName
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "-")
    .replace(/[. ]+$/g, "")
    .trim();

  return `${portableName || "cortex-project"}.ctx`;
}

function getErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error
    ? error.message
    : fallback;
}

export function AgentProjectWorkspace({
  project,
  content,
  onEdit,
  onCreateProject,
  onContentRefresh,
  onRunStateChange
}: AgentProjectWorkspaceProps) {
  const { t } = useTranslation();
  const tabsId = useId();
  const instructionsTabRef = useRef<HTMLButtonElement>(null);
  const agentsTabRef = useRef<HTMLButtonElement>(null);
  const auditTabRef = useRef<HTMLButtonElement>(null);
  const [activeTab, setActiveTab] = useState<WorkspaceTab>(getWorkspaceTabFromUrl);
  const [agentResultStates, setAgentResultStates] = useState<AgentResultStates>(
    {}
  );
  const selectedItemIndexesByProject = useRef<
    Record<string, Record<string, number[]>>
  >({});
  const runningAgentIdsByProject = useRef<Record<string, Set<string>>>({});
  const [locallyRunningByProject, setLocallyRunningByProject] = useState<Record<string, Set<string>>>({});
  const [startedInBrowserByProject, setStartedInBrowserByProject] = useState<Record<string, boolean>>({});
  const locallyRunning = content ? locallyRunningByProject[content.projectId] ?? EMPTY_AGENT_ID_SET : EMPTY_AGENT_ID_SET;
  const isResuming = locallyRunning.has("__workflow__");
  const [isStopping, setIsStopping] = useState(false);
  const [executionControlError, setExecutionControlError] = useState("");
  const [launchedAgentIds, setLaunchedAgentIds] = useState<Set<string>>(
    () => new Set()
  );
  const [releasedAgentIds, setReleasedAgentIds] =
    useState<Set<string>>(() => new Set());
  const [isResetDialogOpen, setIsResetDialogOpen] = useState(false);
  const [isResetting, setIsResetting] = useState(false);
  const [resetError, setResetError] = useState("");
  const [isExporting, setIsExporting] = useState(false);
  const [exportError, setExportError] = useState("");
  const [workflowSchedule, setWorkflowSchedule] =
    useState<WorkflowSchedule | null>(null);
  const [workflowParameterValues, setWorkflowParameterValues] =
    useState<WorkflowParameterValues>({});
  const hydratedParameterProjectId = useRef<string | null>(null);
  const [isScheduleDialogOpen, setIsScheduleDialogOpen] = useState(false);
  const [handoffEnabledAgentIdsByProject, setHandoffEnabledAgentIdsByProject] =
    useState<HandoffEnabledAgentIdsByProject>(loadHandoffPreferences);
  const handoffEnabledAgentIds = content
    ? handoffEnabledAgentIdsByProject[content.projectId] ?? EMPTY_AGENT_ID_SET
    : EMPTY_AGENT_ID_SET;

  useEffect(() => {
    saveHandoffPreferences(handoffEnabledAgentIdsByProject);
  }, [handoffEnabledAgentIdsByProject]);

  useEffect(() => {
    setActiveTab(getWorkspaceTabFromUrl());
    setIsResetDialogOpen(false);
    setIsScheduleDialogOpen(false);
    setWorkflowSchedule(null);
    setWorkflowParameterValues({});
    hydratedParameterProjectId.current = null;
    setResetError("");
    setExportError("");
    setReleasedAgentIds(new Set());
    setExecutionControlError("");
    setIsStopping(false);
    if (content) setStartedInBrowserByProject((current) => ({ ...current, [content.projectId]: false }));
  }, [content?.projectId]);

  useEffect(() => {
    const handlePopState = (): void => setActiveTab(getWorkspaceTabFromUrl());
    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    if (
      !content ||
      hydratedParameterProjectId.current === content.projectId
    ) {
      return;
    }

    const hasExecution = content.agents.some((agent) => agent.hasSession || agent.executionStatus !== "idle");
    if (hasExecution) {
      hydratedParameterProjectId.current = content.projectId;
      setWorkflowParameterValues(content.workflowParameterValues ?? {});
    } else if (workflowSchedule) {
      hydratedParameterProjectId.current = content.projectId;
      setWorkflowParameterValues(workflowSchedule.parameterValues ?? {});
    }
  }, [content, workflowSchedule]);

  useEffect(() => {
    if (!content) {
      return;
    }

    let isActive = true;
    let isRefreshing = false;

    const refreshSchedule = async (): Promise<void> => {
      if (isRefreshing) return;
      isRefreshing = true;

      try {
        const schedule = await getWorkflowSchedule(content.projectId);

        if (isActive) {
          setWorkflowSchedule(schedule);

          if (schedule.running) {
            onContentRefresh(await loadAgentProject(content.projectId));
          }
        }
      } catch {
        // The scheduler remains unavailable without blocking manual execution.
      } finally {
        isRefreshing = false;
      }
    };

    void refreshSchedule();
    const refreshTimer = window.setInterval(() => {
      void refreshSchedule();
    }, 15_000);

    return () => {
      isActive = false;
      window.clearInterval(refreshTimer);
    };
  }, [content?.projectId, onContentRefresh]);

  useEffect(() => {
    if (!content) {
      return;
    }

    const availableAgentIds = new Set(content.agents.map((agent) => agent.id));

    setHandoffEnabledAgentIdsByProject((currentPreferences) => {
      const storedAgentIds = currentPreferences[content.projectId];

      if (!storedAgentIds) {
        return currentPreferences;
      }

      const validAgentIds = new Set(
        [...storedAgentIds].filter((agentId) => availableAgentIds.has(agentId))
      );

      if (
        validAgentIds.size === storedAgentIds.size &&
        [...validAgentIds].every((agentId) => storedAgentIds.has(agentId))
      ) {
        return currentPreferences;
      }

      return {
        ...currentPreferences,
        [content.projectId]: validAgentIds
      };
    });
  }, [content?.agents, content?.projectId]);

  useEffect(() => {
    if (!content) {
      setAgentResultStates({});
      setLaunchedAgentIds(new Set());
      return;
    }

    const restoredStates: AgentResultStates = {};
    const storedSelections = selectedItemIndexesByProject.current[
      content.projectId
    ] ?? {};

    for (const agent of content.agents) {
      const responses = findLastAgentResponses(
        getAgentConversationThreads(agent)
      );
      const restoredState: AgentResultState = {
        responses,
        selectedItemIndexes: [],
        isInvalidated: false
      };

      restoredState.selectedItemIndexes = responses.length === 0
        ? []
        : Object.prototype.hasOwnProperty.call(storedSelections, agent.id)
          ? [...storedSelections[agent.id]]
          : getDefaultHandoffSelections(restoredState);
      restoredStates[agent.id] = restoredState;
    }

    setAgentResultStates(restoredStates);
    runningAgentIdsByProject.current[content.projectId] = new Set(
      content.agents
        .filter((agent) => agent.executionStatus === "running")
        .map((agent) => agent.id)
    );
    setLaunchedAgentIds(new Set(
      content.agents
        .filter((agent) =>
          agent.hasSession || agent.executionStatus !== "idle" || locallyRunning.has(agent.id)
        )
        .map((agent) => agent.id)
    ));
  }, [content]);

  useEffect(() => {
    if (!content || (!locallyRunning.size && !content.agents.some(
      (agent) => agent.executionStatus === "running" || agent.executionStatus === "waiting"
    ))) {
      return;
    }

    let isActive = true;
    let isRefreshing = false;

    const refreshProject = async (): Promise<void> => {
      if (isRefreshing) {
        return;
      }

      isRefreshing = true;

      try {
        const refreshedContent = await loadAgentProject(content.projectId);

        if (isActive) {
          onContentRefresh(refreshedContent);
        }
      } catch {
        // The run request already displays execution errors.
      } finally {
        isRefreshing = false;
      }
    };
    void refreshProject();
    const refreshTimer = window.setInterval(() => {
      void refreshProject();
    }, 1_000);

    return () => {
      isActive = false;
      window.clearInterval(refreshTimer);
    };
  }, [content?.projectId, Boolean(locallyRunning.size || content?.agents.some((agent) => agent.executionStatus === "running" || agent.executionStatus === "waiting")), onContentRefresh]);

  useEffect(() => {
    if (!content) {
      return;
    }

    const upstreamAgentIds = new Set<string>();

    for (const agent of content.agents) {
      if (!handoffEnabledAgentIds.has(agent.id)) {
        continue;
      }

      for (const upstreamAgent of content.agents) {
        if (upstreamAgent.nextAgentIds.includes(agent.id)) {
          upstreamAgentIds.add(upstreamAgent.id);
        }
      }
    }

    let nextStates = agentResultStates;
    const storedSelections = {
      ...(selectedItemIndexesByProject.current[content.projectId] ?? {})
    };

    for (const upstreamAgentId of upstreamAgentIds) {
      const state = agentResultStates[upstreamAgentId];

      if (!state || state.responses.length === 0) {
        continue;
      }

      const automaticSelections = getDefaultHandoffSelections(state);

      if (haveSameIndexes(state.selectedItemIndexes, automaticSelections)) {
        continue;
      }

      if (nextStates === agentResultStates) {
        nextStates = { ...agentResultStates };
      }

      nextStates[upstreamAgentId] = {
        ...state,
        selectedItemIndexes: automaticSelections
      };
      storedSelections[upstreamAgentId] = automaticSelections;
    }

    if (nextStates !== agentResultStates) {
      selectedItemIndexesByProject.current[content.projectId] = storedSelections;
      setAgentResultStates(nextStates);
    }
  }, [content, handoffEnabledAgentIds, agentResultStates]);

  if (!project || !content) {
    return (
      <main className="workspace-content" id="main-content" tabIndex={-1}>
        <p className="eyebrow">Cortex workspace</p>
        <h1>Cortex.</h1>
        <p className="intro">
          {t("workspace.welcome")}
        </p>
        <p className="workspace-welcome__help">{t("workspace.welcomeHelp")}</p>
        <button type="button" className="workspace-welcome__create" onClick={onCreateProject}>
          <Plus aria-hidden="true" size={18} />{t("workspace.createProject")}
        </button>
      </main>
    );
  }

  const projectId = content.projectId;
  const projectName = getProjectName(project.directoryPath);
  const agentsTabLabel = t("workspace.workflowTab", {
    count: content.agents.length,
    agents: t(content.agents.length === 1
      ? "workspace.agentSingular"
      : "workspace.agentPlural")
  });
  const instructionsTabId = `${tabsId}-instructions-tab`;
  const instructionsPanelId = `${tabsId}-instructions-panel`;
  const agentsTabId = `${tabsId}-agents-tab`;
  const agentsPanelId = `${tabsId}-agents-panel`;
  const auditTabId = `${tabsId}-audit-tab`;
  const auditPanelId = `${tabsId}-audit-panel`;
  const workflowAgents = content.agents.map((agent) => locallyRunning.has(agent.id)
    ? { ...agent, executionStatus: "running" as const }
    : agent);
  const isAnyRunning = locallyRunning.size > 0 || workflowAgents.some((agent) => agent.executionStatus === "running");
  const workflowParameters = content.parameters ?? [];
  const missingWorkflowParameters = getMissingWorkflowParameters(
    workflowParameters,
    workflowParameterValues
  );
  const workflowParametersLocked = launchedAgentIds.size > 0 ||
    isAnyRunning;
  const agentsById = new Map(workflowAgents.map((agent) => [agent.id, agent]));
  const workflowFeedbackEdgeKeys = getWorkflowFeedbackEdgeKeys(workflowAgents);
  const workflowFeedbackEdges = workflowAgents.flatMap((agent) =>
    agent.nextAgentIds
      .filter((nextAgentId) => workflowFeedbackEdgeKeys.has(
        getWorkflowEdgeKey(agent.id, nextAgentId)
      ))
      .map((nextAgentId) => ({
        sourceAgentId: agent.id,
        targetAgentId: nextAgentId
      }))
  );
  const cyclicAgentIds = getCyclicAgentIds(workflowAgents);
  const workflowLevels = getWorkflowLevels(
    workflowAgents,
    workflowFeedbackEdgeKeys
  );
  const workflowLevelIndexesByAgentId = new Map(
    workflowLevels.flatMap((levelAgents, levelIndex) =>
      levelAgents.map((agent) => [agent.id, levelIndex] as const)
    )
  );
  const workflowLaneLayout = getWorkflowLaneLayout(workflowLevels, workflowFeedbackEdgeKeys);
  const workflowInstances = new Map(workflowAgents.map((agent) => [agent.id,
    getWorkflowInstancePresentation(agent, workflowAgents, agentResultStates, workflowFeedbackEdgeKeys)]));
  const workflowForwardEdges = workflowAgents.flatMap((agent) => agent.nextAgentIds
    .filter((id) => agentsById.has(id) && !workflowFeedbackEdgeKeys.has(getWorkflowEdgeKey(agent.id, id)))
    .map((id) => ({ sourceAgentId: agent.id, targetAgentId: id,
      status: getWorkflowConnectionStatus(agent, agentsById.get(id)!, agentResultStates),
      instanceCount: workflowInstances.get(id)?.count ?? undefined })));
  const rootAgentCount = workflowAgents.filter((agent) =>
    !workflowForwardEdges.some((edge) => edge.targetAgentId === agent.id)).length;
  const unstartedRootAgents = workflowAgents.filter((agent) =>
    !launchedAgentIds.has(agent.id) && !workflowForwardEdges.some((edge) => edge.targetAgentId === agent.id));
  const rawWorkflowFeedbackLoopPlacements = workflowFeedbackEdges.flatMap(
    ({ sourceAgentId, targetAgentId }) => {
      const sourceLevelIndex = workflowLevelIndexesByAgentId.get(sourceAgentId);
      const targetLevelIndex = workflowLevelIndexesByAgentId.get(targetAgentId);

      if (
        sourceLevelIndex === undefined ||
        targetLevelIndex === undefined ||
        sourceLevelIndex < targetLevelIndex
      ) {
        return [];
      }

      return [{
        key: getWorkflowEdgeKey(sourceAgentId, targetAgentId),
        sourceAgentId,
        targetAgentId,
        sourceLevelIndex,
        targetLevelIndex,
        railIndex: 0,
        railCount: 1
      } satisfies WorkflowFeedbackLoopPlacement];
    }
  );
  const workflowFeedbackLoopPlacements = [
    ...rawWorkflowFeedbackLoopPlacements
  ]
    .sort((firstPlacement, secondPlacement) =>
      (secondPlacement.sourceLevelIndex - secondPlacement.targetLevelIndex) -
      (firstPlacement.sourceLevelIndex - firstPlacement.targetLevelIndex)
    )
    .map((placement, railIndex, placements) => ({
        ...placement,
        railIndex,
        railCount: placements.length
      }));
  const isGlobalHandoffEnabled = workflowAgents.length > 0 && workflowAgents.every(
    (agent) => handoffEnabledAgentIds.has(agent.id)
  );
  const isGlobalHandoffMixed = !isGlobalHandoffEnabled && workflowAgents.some(
    (agent) => handoffEnabledAgentIds.has(agent.id)
  );

  function selectTab(tab: WorkspaceTab, updateHistory = true): void {
    if (tab === activeTab) return;
    setActiveTab(tab);
    if (updateHistory) updateWorkspaceView(tab);
  }

  function handleTabKeyDown(
    event: KeyboardEvent<HTMLButtonElement>
  ): void {
    const tabs = ["instructions", "agents", "audit"] as const;
    let nextTab: typeof tabs[number] | null = null;

    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      const direction = event.key === "ArrowRight" ? 1 : -1;
      const currentIndex = tabs.indexOf(activeTab);
      nextTab = tabs[(currentIndex + direction + tabs.length) % tabs.length];
    } else if (event.key === "Home") {
      nextTab = "instructions";
    } else if (event.key === "End") {
      nextTab = "audit";
    }

    if (!nextTab) {
      return;
    }

    event.preventDefault();
    selectTab(nextTab);
    const nextRef = nextTab === "instructions"
      ? instructionsTabRef
      : nextTab === "agents"
        ? agentsTabRef
        : auditTabRef;
    nextRef.current?.focus();
  }

  function handleGlobalHandoffChange(enabled: boolean): void {
    const nextAgentIds = enabled
      ? new Set(workflowAgents.map((agent) => agent.id))
      : new Set<string>();

    setHandoffEnabledAgentIdsByProject((currentPreferences) => ({
      ...currentPreferences,
      [projectId]: nextAgentIds
    }));
  }

  function handleAgentHandoffChange(agentId: string, enabled: boolean): void {
    setHandoffEnabledAgentIdsByProject((currentPreferences) => {
      const nextAgentIds = new Set(
        currentPreferences[projectId] ?? EMPTY_AGENT_ID_SET
      );

      if (enabled) {
        nextAgentIds.add(agentId);
      } else {
        nextAgentIds.delete(agentId);
      }

      return {
        ...currentPreferences,
        [projectId]: nextAgentIds
      };
    });
  }

  function getForwardDescendantAgentIds(sourceAgentId: string): Set<string> {
    const descendantIds = new Set<string>();
    const pendingIds = (agentsById.get(sourceAgentId)?.nextAgentIds ?? [])
      .filter((nextAgentId) =>
        !workflowFeedbackEdgeKeys.has(
          getWorkflowEdgeKey(sourceAgentId, nextAgentId)
        )
      );

    while (pendingIds.length > 0) {
      const agentId = pendingIds.shift()!;

      if (descendantIds.has(agentId)) {
        continue;
      }

      descendantIds.add(agentId);
      pendingIds.push(
        ...(agentsById.get(agentId)?.nextAgentIds ?? []).filter(
          (nextAgentId) =>
            !workflowFeedbackEdgeKeys.has(
              getWorkflowEdgeKey(agentId, nextAgentId)
            )
        )
      );
    }

    return descendantIds;
  }

  function getInvalidatedAgentIds(sourceAgentId: string): Set<string> {
    const invalidatedAgentIds = new Set<string>();
    const visitedAgentIds = new Set([sourceAgentId]);
    const pendingIds = [
      ...(agentsById.get(sourceAgentId)?.nextAgentIds ?? [])
    ];

    while (pendingIds.length > 0) {
      const agentId = pendingIds.shift()!;

      if (visitedAgentIds.has(agentId)) {
        continue;
      }

      visitedAgentIds.add(agentId);
      invalidatedAgentIds.add(agentId);
      pendingIds.push(
        ...(agentsById.get(agentId)?.nextAgentIds ?? []).filter(
          (nextAgentId) =>
            !workflowFeedbackEdgeKeys.has(
              getWorkflowEdgeKey(agentId, nextAgentId)
            )
        )
      );
    }

    return invalidatedAgentIds;
  }

  function clearInvalidatedAgentResults(
    states: AgentResultStates,
    invalidatedAgentIds: ReadonlySet<string>
  ): AgentResultStates {
    const nextStates = { ...states };

    for (const invalidatedAgentId of invalidatedAgentIds) {
      nextStates[invalidatedAgentId] = {
        responses: [],
        selectedItemIndexes: [],
        isInvalidated: true
      };
    }

    return nextStates;
  }

  function rearmInvalidatedAgents(
    sourceAgentId: string,
    invalidatedAgentIds: ReadonlySet<string>
  ): void {
    const hasFeedbackSuccessor = (agentsById.get(sourceAgentId)?.nextAgentIds ?? [])
      .some((nextAgentId) => workflowFeedbackEdgeKeys.has(
        getWorkflowEdgeKey(sourceAgentId, nextAgentId)
      ));

    setLaunchedAgentIds((currentAgentIds) => {
      const nextAgentIds = new Set(currentAgentIds);

      for (const invalidatedAgentId of invalidatedAgentIds) {
        nextAgentIds.delete(invalidatedAgentId);
      }

      if (hasFeedbackSuccessor) {
        nextAgentIds.delete(sourceAgentId);
      }

      return nextAgentIds;
    });
    setReleasedAgentIds((currentAgentIds) => {
      const nextAgentIds = new Set(currentAgentIds);

      for (const invalidatedAgentId of invalidatedAgentIds) {
        nextAgentIds.delete(invalidatedAgentId);
      }

      return nextAgentIds;
    });
  }

  function handleResponseChange(
    agentId: string,
    responses: AgentResponsePayload[]
  ): void {
    const invalidatedAgentIds = getInvalidatedAgentIds(agentId);
    const nextAgentState: AgentResultState = {
      responses,
      selectedItemIndexes: [],
      isInvalidated: false
    };
    nextAgentState.selectedItemIndexes = getDefaultHandoffSelections(nextAgentState);
    const storedSelections = {
      ...(selectedItemIndexesByProject.current[projectId] ?? {})
    };

    storedSelections[agentId] = [...nextAgentState.selectedItemIndexes];

    for (const invalidatedAgentId of invalidatedAgentIds) {
      storedSelections[invalidatedAgentId] = [];
    }

    selectedItemIndexesByProject.current[projectId] = storedSelections;
    rearmInvalidatedAgents(agentId, invalidatedAgentIds);
    setAgentResultStates((currentStates) => ({
      ...clearInvalidatedAgentResults(currentStates, invalidatedAgentIds),
      [agentId]: nextAgentState
    }));
  }

  function handleSelectedItemIndexesChange(
    agentId: string,
    selectedItemIndexes: number[]
  ): void {
    const invalidatedAgentIds = getInvalidatedAgentIds(agentId);
    const storedSelections = {
      ...(selectedItemIndexesByProject.current[projectId] ?? {}),
      [agentId]: [...selectedItemIndexes]
    };

    for (const invalidatedAgentId of invalidatedAgentIds) {
      storedSelections[invalidatedAgentId] = [];
    }

    selectedItemIndexesByProject.current[projectId] = storedSelections;
    rearmInvalidatedAgents(agentId, invalidatedAgentIds);
    setAgentResultStates((currentStates) => {
      const currentState = currentStates[agentId];

      if (!currentState) {
        return currentStates;
      }

      return {
        ...clearInvalidatedAgentResults(currentStates, invalidatedAgentIds),
        [agentId]: {
          ...currentState,
          selectedItemIndexes
        }
      };
    });
  }

  function handleRunStart(agentId: string): void {
    setStartedInBrowserByProject((current) => ({ ...current, [projectId]: true }));
    setLocallyRunningByProject((current) => ({
      ...current,
      [projectId]: new Set([...(current[projectId] ?? []), agentId])
    }));
    const runningAgentIds = runningAgentIdsByProject.current[projectId] ??
      new Set<string>();
    runningAgentIds.add(agentId);
    runningAgentIdsByProject.current[projectId] = runningAgentIds;
    setLaunchedAgentIds((currentAgentIds) => {
      const nextAgentIds = new Set(currentAgentIds);
      nextAgentIds.add(agentId);
      return nextAgentIds;
    });
    onRunStateChange(projectId, "running");
  }

  function handleRunEnd(agentId: string, succeeded: boolean): void {
    setLocallyRunningByProject((current) => {
      const next = new Set(current[projectId]);
      next.delete(agentId);
      return { ...current, [projectId]: next };
    });
    const runningAgentIds = runningAgentIdsByProject.current[projectId] ??
      new Set<string>();
    runningAgentIds.delete(agentId);
    runningAgentIdsByProject.current[projectId] = runningAgentIds;
    onRunStateChange(
      projectId,
      runningAgentIds.size > 0
        ? "running"
        : succeeded ? "completed" : "idle"
    );
    void loadAgentProject(projectId).then(onContentRefresh).catch(() => undefined);
  }

  async function handleStop(): Promise<void> {
    setIsStopping(true);
    setExecutionControlError("");
    setStartedInBrowserByProject((current) => ({ ...current, [projectId]: false }));
    handleGlobalHandoffChange(false);
    setReleasedAgentIds(new Set());
    try {
      await cancelProjectExecution(projectId);
      onContentRefresh(await loadAgentProject(projectId));
    } catch (error) {
      setExecutionControlError(getErrorMessage(error, t("execution.stopError")));
    } finally {
      setIsStopping(false);
    }
  }

  async function handleResume(): Promise<void> {
    handleRunStart("__workflow__");
    setExecutionControlError("");
    // The server owns the resumed chain; prevent browser handoffs from also launching it.
    handleGlobalHandoffChange(false);
    setReleasedAgentIds(new Set());
    try {
      await resumeWorkflow(projectId);
      handleRunEnd("__workflow__", true);
    } catch (error) {
      setExecutionControlError(getErrorMessage(error, t("common.unexpectedError")));
      handleRunEnd("__workflow__", false);
    }
  }

  async function handleResetWorkflow(): Promise<void> {
    setIsResetting(true);
    setResetError("");

    try {
      await resetAgentProjectWorkflow(projectId);
      const refreshedContent = await loadAgentProject(projectId);
      delete selectedItemIndexesByProject.current[projectId];
      delete runningAgentIdsByProject.current[projectId];
      setReleasedAgentIds(new Set());
      onContentRefresh(refreshedContent);
      onRunStateChange(projectId, "idle");
      setIsResetDialogOpen(false);
    } catch (requestError) {
      setResetError(getErrorMessage(requestError, t("common.unexpectedError")));
    } finally {
      setIsResetting(false);
    }
  }

  async function handleExportProject(): Promise<void> {
    setIsExporting(true);
    setExportError("");

    try {
      const archive = await exportProjectArchive(projectId);
      const downloadUrl = URL.createObjectURL(archive);
      const downloadLink = document.createElement("a");
      downloadLink.href = downloadUrl;
      downloadLink.download = getProjectArchiveFileName(projectName);
      document.body.append(downloadLink);
      downloadLink.click();
      downloadLink.remove();
      window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 0);
    } catch (requestError) {
      setExportError(getErrorMessage(requestError, t("project.exportError")));
    } finally {
      setIsExporting(false);
    }
  }

  return (
    <main className="workspace-content workspace-content--project" id="main-content" tabIndex={-1}>
      <header className="agent-project__header">
        <div className="agent-project__title-row">
          <div>
            <p className="eyebrow">{t("workspace.project", { engine: content.engine })}</p>
            <h1>{projectName}</h1>
          </div>
          <button
            className="agent-project__export-button"
            type="button"
            onClick={() => void handleExportProject()}
            disabled={isExporting}
            title={t("project.exportHelp")}
          >
            {isExporting ? (
              <LoaderCircle
                className="agent-project__export-loading"
                aria-hidden="true"
                size={15}
              />
            ) : (
              <Download aria-hidden="true" size={15} />
            )}
            {isExporting ? t("project.exporting") : t("project.export")}
          </button>
        </div>
        <div className="agent-project__tabs-row">
          <div className="agent-project__tabs" role="tablist" aria-label={t("workspace.contentAria")}>
            <button
              className={`agent-project__tab${
                activeTab === "instructions" ? " agent-project__tab--active" : ""
              }`}
              id={instructionsTabId}
              ref={instructionsTabRef}
              type="button"
              role="tab"
              aria-controls={instructionsPanelId}
              aria-selected={activeTab === "instructions"}
              tabIndex={activeTab === "instructions" ? 0 : -1}
              onClick={() => selectTab("instructions")}
              onKeyDown={handleTabKeyDown}
            >
              {t("workspace.instructionsTab")}
            </button>
            <button
              className={`agent-project__tab${
                activeTab === "agents" ? " agent-project__tab--active" : ""
              }`}
              id={agentsTabId}
              ref={agentsTabRef}
              type="button"
              role="tab"
              aria-controls={agentsPanelId}
              aria-selected={activeTab === "agents"}
              tabIndex={activeTab === "agents" ? 0 : -1}
              onClick={() => selectTab("agents")}
              onKeyDown={handleTabKeyDown}
            >
              {agentsTabLabel}
            </button>
            <button
              className={`agent-project__tab${
                activeTab === "audit" ? " agent-project__tab--active" : ""
              }`}
              id={auditTabId}
              ref={auditTabRef}
              type="button"
              role="tab"
              aria-controls={auditPanelId}
              aria-selected={activeTab === "audit"}
              tabIndex={activeTab === "audit" ? 0 : -1}
              onClick={() => selectTab("audit")}
              onKeyDown={handleTabKeyDown}
            >
              {t("workspace.auditTab")}
            </button>
          </div>
          <div className="agent-project__tab-actions">
            {activeTab === "agents" && unstartedRootAgents.length > 1 && (
              <button type="button" className="agent-project__resume-button"
                disabled={isAnyRunning || isStopping || isResetting || missingWorkflowParameters.length > 0 ||
                  unstartedRootAgents.some((agent) => !agent.prompt.trim())}
                title={t("workspace.startRootsHelp")}
                onClick={() => {
                  setStartedInBrowserByProject((current) => ({ ...current, [projectId]: true }));
                  setReleasedAgentIds((current) => new Set([
                    ...current, ...unstartedRootAgents.map((agent) => agent.id)
                  ]));
                }}>
                <Play aria-hidden="true" size={15} />
                {t("workspace.startRoots", { count: unstartedRootAgents.length })}
              </button>
            )}
            {(isAnyRunning || content.workflowInstance?.status === "waiting") && <button type="button" className="agent-project__stop-button"
              disabled={isStopping} aria-busy={isStopping}
              title={t("execution.stopHelp")} onClick={() => void handleStop()}>
              {isStopping ? <LoaderCircle aria-hidden="true" className="spin" size={15} /> : <Square aria-hidden="true" size={15} />}
              {t(isStopping ? "execution.stopping" : "execution.stop")}
            </button>}
            {(content.workflowResumable || isResuming) && <button type="button" className="agent-project__resume-button"
              disabled={isAnyRunning || isStopping || isResetting} aria-busy={isResuming}
              title={t("execution.resumeHelp")} onClick={() => void handleResume()}>
              <Play aria-hidden="true" size={15} />{t(isResuming ? "execution.resuming" : "execution.resumeWorkflow")}
            </button>}
            {activeTab === "agents" && content.agents.length > 0 && (
              <HandoffToggle
                checked={isGlobalHandoffEnabled}
                mixed={isGlobalHandoffMixed}
                label={t("workspace.handoffLabel")}
                disabled={isStopping || isResuming || isResetting}
                description={isGlobalHandoffEnabled
                  ? t("workspace.manualAll")
                  : t("workspace.autoAll")
                }
                variant="global"
                onChange={handleGlobalHandoffChange}
              />
            )}
            {activeTab === "agents" && content.agents.length > 0 && (
              <button
                className={`agent-project__schedule-button${
                  workflowSchedule?.enabled
                    ? " agent-project__schedule-button--active"
                    : ""
                }`}
                type="button"
                onClick={() => setIsScheduleDialogOpen(true)}
                disabled={!workflowSchedule || (
                  missingWorkflowParameters.length > 0 &&
                  !workflowSchedule.enabled
                )}
                title={workflowSchedule?.enabled
                  ? t("schedule.edit")
                  : t("schedule.configure")}
              >
                <CalendarClock aria-hidden="true" size={15} />
                {workflowSchedule?.running
                  ? t("schedule.running")
                  : workflowSchedule?.enabled
                    ? t("schedule.scheduled")
                  : t("schedule.button")}
              </button>
            )}
            {activeTab === "agents" && (
              <button
                className="agent-project__reset-button"
                type="button"
                onClick={() => {
                  setResetError("");
                  setIsResetDialogOpen(true);
                }}
                disabled={isResetting || isAnyRunning}
                title={t("project.resetAria", { name: projectName })}
              >
                <RotateCcw aria-hidden="true" size={15} />
                {t("project.reset")}
              </button>
            )}
            <button
              className="agent-project__edit-button"
              type="button"
              onClick={onEdit}
              disabled={isAnyRunning}
              title={isAnyRunning
                ? t("workspace.editUnavailable")
                : t("workspace.editTitle")}
            >
              <Pencil aria-hidden="true" size={15} />
              {t("workspace.edit")}
            </button>
          </div>
        </div>
      </header>

      {exportError && (
        <p className="agent-project__export-error" role="alert">
          {exportError}
        </p>
      )}
      {executionControlError && <p className="agent-project__export-error" role="alert">{executionControlError}</p>}

      {activeTab === "instructions" ? (
        <section
          className="project-instructions"
          id={instructionsPanelId}
          role="tabpanel"
          aria-labelledby={instructionsTabId}
          tabIndex={0}
        >
          <header className="project-instructions__header">
            <span>{t("workspace.instructionsFile")}</span>
            <h2>{content.instructions.fileName}</h2>
          </header>
          {content.instructions.content !== null ? (
            <pre>{content.instructions.content || t("workspace.emptyFile")}</pre>
          ) : (
            <p className="project-instructions__empty">
              {t("workspace.missingFile", { name: content.instructions.fileName })}
            </p>
          )}
        </section>
      ) : activeTab === "audit" ? (
        <div
          id={auditPanelId}
          role="tabpanel"
          aria-labelledby={auditTabId}
          tabIndex={0}
        >
          <Suspense fallback={<p role="status">{t("common.loading")}</p>}>
          <WorkflowAuditPanel
            projectId={projectId}
            onStartRun={() => selectTab("agents")}
          />
          </Suspense>
        </div>
      ) : (
        <section
          className="agent-project__agents-panel"
          id={agentsPanelId}
          role="tabpanel"
          aria-labelledby={agentsTabId}
          tabIndex={0}
        >
          {content.agents.length === 0 ? (
            <p className="agent-project__empty">
              {t("workspace.noAgents")}
            </p>
          ) : (
            <>
              <WorkflowWaitPanel key={projectId} project={content} onRefresh={onContentRefresh} />
              {workflowParameters.length > 0 && (
                <WorkflowParametersPanel
                  key={projectId}
                  parameters={workflowParameters}
                  values={workflowParameterValues}
                  locked={workflowParametersLocked}
                  onChange={(parameterId, value) => {
                    setWorkflowParameterValues((currentValues) => ({
                      ...currentValues,
                      [parameterId]: value
                    }));
                  }}
                />
              )}
              {rootAgentCount > 1 && <p className="workflow-roots-summary">
                {t("workflow.roots", { count: rootAgentCount })}
              </p>}
              {(workflowForwardEdges.length > 0 || workflowFeedbackLoopPlacements.length > 0) && <WorkflowConnectionLegend
                hasFeedback={workflowFeedbackLoopPlacements.length > 0} />}
              <div
                className={`agent-project__workflow agent-project__workflow--graph${
                  workflowFeedbackLoopPlacements.length > 0
                    ? " agent-project__workflow--has-feedback"
                    : ""
                }`}
                style={{ "--workflow-lane-count": workflowLaneLayout.laneCount } as CSSProperties}
              >
              <WorkflowConnections edges={workflowForwardEdges} />
              {workflowFeedbackLoopPlacements.map((placement) => (
                <WorkflowFeedbackLoop
                  key={placement.key}
                  placement={placement}
                />
              ))}
              {workflowLevels.map((levelAgents, levelIndex) => {
                return (
                  <section
                    className="agent-project__workflow-level"
                    aria-label={t("workspace.step", { number: levelIndex + 1 })}
                    key={levelIndex}
                    style={{ gridRow: levelIndex + 1 }}
                  >
                    <ol className="agent-project__workflow-cards agent-project__workflow-cards--graph">
                      {levelAgents.map((agent) => {
                        const flowKind: AgentFlowKind = cyclicAgentIds.has(
                          agent.id
                        )
                          ? "cycle"
                          : workflowLaneLayout.laneCount > 1
                            ? "parallel"
                            : "standard";
                        const upstreamAgents = workflowAgents.filter(
                          (candidate) => candidate.nextAgentIds.includes(agent.id)
                        );
                        const isRootAgent = !workflowForwardEdges.some((edge) => edge.targetAgentId === agent.id);
                        const prerequisiteMessage = getPrerequisiteMessage(
                          upstreamAgents,
                          agent.id,
                          agentResultStates,
                          workflowAgents,
                          workflowFeedbackEdgeKeys,
                          t
                        );
                        const applicableUpstreamAgents =
                          getApplicableUpstreamAgents(
                            upstreamAgents,
                            agent.id,
                            agentResultStates
                          );
                        const upstreamAgentResults = prerequisiteMessage
                          ? undefined
                          : applicableUpstreamAgents
                            .map((upstreamAgent) => getUpstreamAgentResult(
                              upstreamAgent,
                              agent.id,
                              agentResultStates
                            ))
                            .filter((result): result is UpstreamAgentResult =>
                              result !== null
                            );
                        const pendingSuccessorIds = agent.nextAgentIds
                          .filter((nextAgentId) =>
                            !launchedAgentIds.has(nextAgentId) &&
                            (agentResultStates[agent.id]?.responses ?? []).some(
                              (response) => responseRoutesToAgent(response, nextAgentId)
                            )
                          );
                        const readySuccessorIds =
                          pendingSuccessorIds.filter((nextAgentId) => {
                            const nextAgent = agentsById.get(nextAgentId);

                            if (!nextAgent?.prompt.trim()) {
                              return false;
                            }

                            const nextAgentUpstreamAgents = workflowAgents.filter(
                              (candidate) => candidate.nextAgentIds.includes(nextAgentId)
                            );
                            return getPrerequisiteMessage(
                              nextAgentUpstreamAgents,
                              nextAgentId,
                              agentResultStates,
                              workflowAgents,
                              workflowFeedbackEdgeKeys,
                              t
                            ) === null;
                          });
                        const hasManualUpstreamAgent = upstreamAgents.some(
                          (upstreamAgent) =>
                            !handoffEnabledAgentIds.has(upstreamAgent.id)
                        );

                        return (
                          <li
                            className={`agent-project__workflow-step agent-project__workflow-step--${flowKind}`}
                            data-workflow-agent-id={agent.id}
                            style={{
                              "--workflow-column-start": workflowLaneLayout.placements.get(agent.id)?.start,
                              "--workflow-column-end": workflowLaneLayout.placements.get(agent.id)?.end
                            } as CSSProperties}
                            id={`workflow-agent-${encodeURIComponent(agent.id)}`}
                            key={`${content.projectId}:${agent.id}`}
                          >
                            <AgentCard
                              agent={agent}
                              compactCompleted={workflowAgents.length > 8}
                              nextAgentNamesById={new Map(
                                agent.nextAgentIds.map((nextAgentId) => [
                                  nextAgentId,
                                  agentsById.get(nextAgentId)?.name ?? nextAgentId
                                ])
                              )}
                              handoffEnabled={handoffEnabledAgentIds.has(agent.id)}
                              launchFromPredecessor={getTriggerUpstreamAgents(
                                upstreamAgents,
                                agent.id,
                                agentResultStates,
                                workflowFeedbackEdgeKeys
                              ).length > 0}
                              shouldAutoRun={
                                !content.workflowInstance?.automatic && !isResuming && !isStopping && startedInBrowserByProject[projectId] === true &&
                                agent.executionStatus !== "failed" && agent.executionStatus !== "cancelled" &&
                                (upstreamAgents.length > 0 || releasedAgentIds.has(agent.id)) &&
                                !launchedAgentIds.has(agent.id) &&
                                (
                                  releasedAgentIds.has(agent.id) ||
                                  (handoffEnabledAgentIds.has(agent.id) && !hasManualUpstreamAgent)
                                ) &&
                                prerequisiteMessage === null
                              }
                              plannedThreadCount={getPlannedThreadCount(
                                agent,
                                applicableUpstreamAgents,
                                agentResultStates
                              )}
                              upstreamAgentResults={upstreamAgentResults}
                              isInvalidated={
                                agentResultStates[agent.id]?.isInvalidated ?? false
                              }
                              executionLockMessage={content.workflowInstance?.automatic && content.workflowInstance.status === "running"
                                ? t("execution.resuming") : isStopping
                                ? t("execution.stopping")
                                : isResuming ? t("execution.resuming")
                                : isResetting ? t("project.resetting") : null}
                              isFrozen={[
                                ...getForwardDescendantAgentIds(agent.id)
                              ].some((descendantId) =>
                                launchedAgentIds.has(descendantId)
                              )}
                              showContinueButton={
                                agent.executionStatus === "idle" &&
                                (agentResultStates[agent.id]?.responses.length ?? 0) > 0 &&
                                pendingSuccessorIds.length > 0
                              }
                              canContinue={!isStopping && !isResuming && readySuccessorIds.length > 0}
                              prerequisiteMessage={prerequisiteMessage}
                              missingWorkflowParameterLabels={
                                isRootAgent && !agent.hasSession
                                  ? missingWorkflowParameters.map(
                                    (parameter) => parameter.label
                                  )
                                  : []
                              }
                              workflowParameterValues={
                                isRootAgent && !agent.hasSession
                                  ? workflowParameterValues
                                  : undefined
                              }
                              projectId={content.projectId}
                              selectedItemIndexes={
                                agentResultStates[agent.id]?.selectedItemIndexes ?? []
                              }
                              onResponseChange={handleResponseChange}
                              onSelectedItemIndexesChange={
                                handleSelectedItemIndexesChange
                              }
                              onRunStart={handleRunStart}
                              onRunEnd={(succeeded) => handleRunEnd(
                                agent.id,
                                succeeded
                              )}
                              onContinue={() => {
                                setStartedInBrowserByProject((current) => ({
                                  ...current,
                                  [projectId]: true
                                }));
                                setReleasedAgentIds((currentAgentIds) =>
                                  new Set([
                                    ...currentAgentIds,
                                    ...readySuccessorIds
                                  ])
                                );
                              }}
                              onHandoffEnabledChange={handleAgentHandoffChange}
                            />
                            <WorkflowRoutingSummary presentation={getWorkflowRoutingPresentation(agent, agentResultStates)} />
                          </li>
                        );
                      })}
                    </ol>
                  </section>
                );
              })}
              </div>
            </>
          )}
        </section>
      )}

      {isResetDialogOpen && (
        <ConfirmationDialog
          variant="reset"
          title={t("project.resetTitle")}
          description={t("project.resetDescription")}
          projectName={projectName}
          confirmLabel={t("project.reset")}
          pendingLabel={t("project.resetting")}
          isPending={isResetting}
          error={resetError || undefined}
          onCancel={() => {
            if (!isResetting) {
              setResetError("");
              setIsResetDialogOpen(false);
            }
          }}
          onConfirm={() => void handleResetWorkflow()}
        />
      )}
      {isScheduleDialogOpen && workflowSchedule && (
        <Suspense fallback={<p role="status">{t("common.loading")}</p>}>
        <WorkflowScheduleDialog
          projectId={projectId}
          projectName={projectName}
          schedule={workflowSchedule}
          parameterValues={workflowParameterValues}
          onCancel={() => setIsScheduleDialogOpen(false)}
          onSaved={(schedule) => {
            setWorkflowSchedule(schedule);
            setIsScheduleDialogOpen(false);
          }}
        />
        </Suspense>
      )}
    </main>
  );
}
