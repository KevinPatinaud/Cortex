import { useEffect, useId, useRef, useState } from "react";
import { roundedWorkflowPath, routeWorkflowConnection, type Point, type WorkflowRect } from "./workflowGeometry.ts";
import { getWorkflowEdgeKey } from "../../../../shared/AgentWorkflowGraph.ts";

export const WORKFLOW_CONNECTION_STATUSES = ["pending", "selected", "running", "inactive"] as const;
export type WorkflowConnectionStatus = typeof WORKFLOW_CONNECTION_STATUSES[number];

export interface WorkflowConnection {
  asynchronous?: boolean;
  sourceAgentId: string;
  targetAgentId: string;
  status?: WorkflowConnectionStatus;
  /** Planned or actual sessions at the destination, when established by results. */
  instanceCount?: number;
}

/** Connections use measured cards so separate roots, joins and skipped levels
 * remain explicit when descriptions expand or the viewport stacks the cards. */
export function WorkflowConnections({ edges }: { edges: WorkflowConnection[] }) {
  const canvasRef = useRef<SVGSVGElement>(null);
  const markerId = useId();
  const [geometry, setGeometry] = useState({ width: 1, height: 1, paths: [] as { path: string; start: Point; end: Point }[] });
  const edgeSignature = JSON.stringify(edges.map(({ sourceAgentId, targetAgentId }) => ({
    sourceAgentId, targetAgentId
  })));

  useEffect(() => {
    const workflow = canvasRef.current?.closest<HTMLElement>(".agent-project__workflow");
    if (!workflow) return;
    const connections = JSON.parse(edgeSignature) as WorkflowConnection[];
    const steps = [...workflow.querySelectorAll<HTMLElement>("[data-workflow-agent-id]")];
    const update = (): void => {
      const bounds = workflow.getBoundingClientRect();
      const cards = new Map(steps.map((step) => {
        const card = step.querySelector<HTMLElement>(".agent-card")!.getBoundingClientRect();
        const footer = step.lastElementChild!.getBoundingClientRect();
        return [step.dataset.workflowAgentId!, {
          left: card.left - bounds.left, right: card.right - bounds.left,
          top: card.top - bounds.top, bottom: Math.max(card.bottom, footer.bottom) - bounds.top
        } satisfies WorkflowRect] as const;
      }));
      const obstacles = [...cards.values()];
      const port = (id: string, otherId: string, outgoing: boolean) => {
        const rect = cards.get(id)!;
        const peers = connections.filter((edge) => (outgoing ? edge.sourceAgentId : edge.targetAgentId) === id)
          .map((edge) => outgoing ? edge.targetAgentId : edge.sourceAgentId)
          .filter((peer) => cards.has(peer))
          .sort((a, b) => {
            const first = cards.get(a)!, second = cards.get(b)!;
            return (first.left + first.right) - (second.left + second.right) || a.localeCompare(b);
          });
        const spacing = Math.min(28, (rect.right - rect.left) / (peers.length + 1));
        return (rect.left + rect.right) / 2 + (peers.indexOf(otherId) - (peers.length - 1) / 2) * spacing;
      };
      const paths = connections.map(({ sourceAgentId, targetAgentId }, index) => {
        const source = cards.get(sourceAgentId), target = cards.get(targetAgentId);
        if (!source || !target) return { path: "", start: { x: 0, y: 0 }, end: { x: 0, y: 0 } };
        const start = { x: port(sourceAgentId, targetAgentId, true), y: source.bottom + 5 };
        const end = { x: port(targetAgentId, sourceAgentId, false), y: target.top - 7 };
        const lead = { x: start.x, y: start.y + 10 };
        const approach = { x: end.x, y: end.y - 10 };
        const route = routeWorkflowConnection(lead, approach, obstacles, bounds.width - 4, 12 + (index % 3) * 6);
        return { path: route.length ? roundedWorkflowPath([start, ...route, end]) : "", start, end };
      });
      setGeometry({ width: Math.max(1, bounds.width), height: Math.max(1, bounds.height), paths });
    };
    update();
    let frame = 0;
    const scheduleUpdate = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(update); };
    const observer = new ResizeObserver(scheduleUpdate);
    observer.observe(workflow);
    for (const step of steps) {
      observer.observe(step);
      observer.observe(step.querySelector<HTMLElement>(".agent-card")!);
    }
    window.addEventListener("resize", scheduleUpdate);
    return () => { observer.disconnect(); cancelAnimationFrame(frame); window.removeEventListener("resize", scheduleUpdate); };
  }, [edgeSignature]);

  return <svg ref={canvasRef} className="agent-project__connections" aria-hidden="true"
    viewBox={`0 0 ${geometry.width} ${geometry.height}`} preserveAspectRatio="none">
    <defs>{[...WORKFLOW_CONNECTION_STATUSES, "asynchronous"].map((status) =>
      <marker key={status} id={`${markerId}-${status}`} className={`agent-project__connection--${status}`}
        viewBox="0 0 12 12" refX="10" refY="6" markerUnits="userSpaceOnUse"
        markerWidth="12" markerHeight="12" orient="auto">
        <path d="M 2 2 L 10 6 L 2 10 Z" />
      </marker>
    )}</defs>
    {edges.map((edge, index) => {
      const status = edge.status ?? "pending";
      const hasMultipleInstances = Number.isFinite(edge.instanceCount) && (edge.instanceCount ?? 0) > 1;
      return <path key={getWorkflowEdgeKey(edge.sourceAgentId, edge.targetAgentId)}
        className={`agent-project__connection agent-project__connection--${status}${edge.asynchronous ? " agent-project__connection--asynchronous" : ""}`}
        data-workflow-source={edge.sourceAgentId} data-workflow-target={edge.targetAgentId}
        data-workflow-status={status}
        data-workflow-asynchronous={edge.asynchronous || undefined}
        data-workflow-instances={hasMultipleInstances ? edge.instanceCount : undefined}
        d={geometry.paths[index]?.path ?? ""}
        markerEnd={`url(#${markerId}-${edge.asynchronous ? "asynchronous" : status})`} />;
    })}
    {edges.map((edge, index) => {
      const route = geometry.paths[index];
      if (!route?.path) return null;
      // A join has one destination count; put its badge beside the rightmost
      // incoming port instead of repeating overlapping badges on every edge.
      const multiple = Number.isFinite(edge.instanceCount) && (edge.instanceCount ?? 0) > 1 &&
        edge.status !== "inactive" && !edges.some((other, otherIndex) =>
          other.targetAgentId === edge.targetAgentId && other.status !== "inactive" &&
          (geometry.paths[otherIndex]?.end.x ?? -Infinity) > route.end.x);
      return <g key={`port-${getWorkflowEdgeKey(edge.sourceAgentId, edge.targetAgentId)}`}
        className={`agent-project__connection--${edge.asynchronous ? "asynchronous" : edge.status ?? "pending"}`}>
        <circle className="agent-project__connection-port" cx={route.start.x} cy={route.start.y} r="3" />
        {multiple && <g className="agent-project__connection-count"
          transform={`translate(${route.end.x + 14}, ${route.end.y - 16})`}>
          <rect x="-2" y="-10" width={Math.max(28, String(edge.instanceCount).length * 8 + 18)} height="20" rx="10" />
          <text x="6" y="0" dominantBaseline="central">×{edge.instanceCount}</text>
        </g>}
      </g>;
    })}
  </svg>;
}
