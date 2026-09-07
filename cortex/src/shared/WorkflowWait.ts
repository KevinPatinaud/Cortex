/** A durable suspension requested by an agent, independent of its provider session. */
export interface WorkflowWaitRequest {
  reason: string;
  eventKey: string | null;
  wakeAfterSeconds: number | null;
  deadlineAt: string;
  state: string;
}

export interface WorkflowWake {
  type: "event" | "timer" | "deadline";
  at: string;
  eventId?: string;
  payload?: string;
}

export interface WorkflowWaitState extends WorkflowWaitRequest {
  id: string;
  createdAt: string;
  wakeAt: string | null;
  wake?: WorkflowWake;
}

export interface WorkflowInstanceState {
  id: string;
  runId?: string;
  status: "running" | "waiting" | "interrupted" | "completed" | "cancelled" | "failed";
  startedAt: string;
  executionCount: number;
  automatic?: boolean;
  scheduledAt?: string;
  consumedEventIds: string[];
}

export interface WorkflowEvent {
  id: string;
  key: string;
  payload: string;
  receivedAt: string;
}

export interface WorkflowWaitingThread extends WorkflowWaitState {
  agentId: string;
  agentName: string;
  threadId: string;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isIsoDate(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d\d-\d\dT.*(?:Z|[+-]\d\d:\d\d)$/.test(value) && Number.isFinite(Date.parse(value));
}

export function isWorkflowWaitRequest(value: unknown): value is WorkflowWaitRequest {
  return isRecord(value) && typeof value.reason === "string" && value.reason.trim().length > 0 && value.reason.length <= 1000 &&
    (value.eventKey === null || (typeof value.eventKey === "string" && value.eventKey.trim().length > 0 && value.eventKey.length <= 200)) &&
    (value.wakeAfterSeconds === null || (Number.isSafeInteger(value.wakeAfterSeconds) && Number(value.wakeAfterSeconds) >= 1 && Number(value.wakeAfterSeconds) <= 31_536_000)) &&
    (value.eventKey !== null || value.wakeAfterSeconds !== null) && isIsoDate(value.deadlineAt) &&
    typeof value.state === "string" && value.state.length <= 32_000;
}

export function isWorkflowWaitState(value: unknown): value is WorkflowWaitState {
  return isWorkflowWaitRequest(value) && isRecord(value) && typeof value.id === "string" && isIsoDate(value.createdAt) &&
    (value.wakeAt === null || isIsoDate(value.wakeAt)) &&
    (value.wake === undefined || (isRecord(value.wake) && ["event", "timer", "deadline"].includes(String(value.wake.type)) &&
      isIsoDate(value.wake.at) && (value.wake.eventId === undefined || typeof value.wake.eventId === "string") &&
      (value.wake.payload === undefined || typeof value.wake.payload === "string")));
}

export function isWorkflowInstanceState(value: unknown): value is WorkflowInstanceState {
  return isRecord(value) && typeof value.id === "string" && (value.runId === undefined || typeof value.runId === "string") &&
    ["running", "waiting", "interrupted", "completed", "cancelled", "failed"].includes(String(value.status)) && isIsoDate(value.startedAt) &&
    (value.automatic === undefined || typeof value.automatic === "boolean") && (value.scheduledAt === undefined || isIsoDate(value.scheduledAt)) &&
    Number.isSafeInteger(value.executionCount) && Number(value.executionCount) >= 0 && Array.isArray(value.consumedEventIds) &&
    value.consumedEventIds.every((id) => typeof id === "string");
}

/** An event received before the deadline wins even if the server was offline at the deadline. */
export function selectWorkflowWake(wait: WorkflowWaitState, events: WorkflowEvent[], consumed: ReadonlySet<string>, now: Date): WorkflowWake | null {
  if (wait.wake) return wait.wake;
  const event = events.find((event) => event.key === wait.eventKey && !consumed.has(event.id) && Date.parse(event.receivedAt) <= Date.parse(wait.deadlineAt));
  if (event) return { type: "event", at: event.receivedAt, eventId: event.id, payload: event.payload };
  if (Date.parse(wait.deadlineAt) <= now.getTime()) return { type: "deadline", at: now.toISOString() };
  if (wait.wakeAt && Date.parse(wait.wakeAt) <= now.getTime()) return { type: "timer", at: now.toISOString() };
  return null;
}
