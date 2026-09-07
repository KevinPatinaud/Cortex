import { useEffect, useId, useRef, useState } from "react";
import { getWorkflowEdgeKey } from "../../../../shared/AgentWorkflowGraph.ts";

export const WORKFLOW_CONNECTION_STATUSES = ["pending", "selected", "running", "inactive"] as const;
export type WorkflowConnectionStatus = typeof WORKFLOW_CONNECTION_STATUSES[number];

export interface WorkflowConnection {
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
  const [geometry, setGeometry] = useState({ width: 1, height: 1, paths: [] as string[] });
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
      const cards = new Map(steps.map((step) => [step.dataset.workflowAgentId!,
        step.querySelector<HTMLElement>(".agent-card")!.getBoundingClientRect()]));
      const paths = connections.map(({ sourceAgentId, targetAgentId }, index) => {
        const source = cards.get(sourceAgentId);
        const target = cards.get(targetAgentId);
        if (!source || !target) return "";
        const sourceX = (source.left + source.right) / 2 - bounds.left;
        const sourceY = source.bottom - bounds.top + 3;
        const targetX = (target.left + target.right) / 2 - bounds.left;
        const targetY = target.top - bounds.top - 7;
        const middleY = (sourceY + targetY) / 2;
        const crossesCard = [...cards.entries()].some(([id, rect]) => {
          if (id === sourceAgentId || id === targetAgentId) return false;
          const left = rect.left - bounds.left - 5;
          const right = rect.right - bounds.left + 5;
          const top = rect.top - bounds.top - 5;
          const bottom = rect.bottom - bounds.top + 5;
          return (sourceX > left && sourceX < right && sourceY < bottom && middleY > top) ||
            (targetX > left && targetX < right && middleY < bottom && targetY > top) ||
            (middleY > top && middleY < bottom &&
              Math.min(sourceX, targetX) < right && Math.max(sourceX, targetX) > left);
        });
        if (crossesCard) {
          const railX = bounds.width - 4 - (index % 5) * 3;
          const sourceRight = source.right - bounds.left + 3;
          const targetRight = target.right - bounds.left + 7;
          const exitY = source.bottom - bounds.top - 18;
          const entryY = target.top - bounds.top + 24;
          return `M ${sourceRight} ${exitY} H ${railX} V ${entryY} H ${targetRight}`;
        }
        return `M ${sourceX} ${sourceY} V ${middleY} H ${targetX} V ${targetY}`;
      });
      setGeometry({ width: Math.max(1, bounds.width), height: Math.max(1, bounds.height), paths });
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(workflow);
    for (const step of steps) observer.observe(step);
    return () => observer.disconnect();
  }, [edgeSignature]);

  return <svg ref={canvasRef} className="agent-project__connections" aria-hidden="true"
    viewBox={`0 0 ${geometry.width} ${geometry.height}`} preserveAspectRatio="none">
    <defs>{WORKFLOW_CONNECTION_STATUSES.map((status) => <g key={status}>
      <marker id={`${markerId}-${status}`} className={`agent-project__connection--${status}`}
        viewBox="0 0 10 10" refX="8" refY="5" markerUnits="userSpaceOnUse"
        markerWidth="9" markerHeight="9" orient="auto-start-reverse">
        <path d="M 1 1 L 8 5 L 1 9" />
      </marker>
      <marker id={`${markerId}-${status}-multiple`} className={`agent-project__connection--${status}`}
        viewBox="0 0 16 16" refX="14" refY="8" markerUnits="userSpaceOnUse"
        markerWidth="19" markerHeight="19" orient="auto-start-reverse">
        <path d="M 1 8 H 5 M 5 8 L 9 3 H 14 M 12 1 L 14 3 L 12 5 M 5 8 H 14 M 12 6 L 14 8 L 12 10 M 5 8 L 9 13 H 14 M 12 11 L 14 13 L 12 15" />
      </marker>
    </g>)}</defs>
    {edges.map((edge, index) => {
      const status = edge.status ?? "pending";
      const hasMultipleInstances = Number.isFinite(edge.instanceCount) && (edge.instanceCount ?? 0) > 1;
      return <path key={getWorkflowEdgeKey(edge.sourceAgentId, edge.targetAgentId)}
        className={`agent-project__connection agent-project__connection--${status}`}
        data-workflow-source={edge.sourceAgentId} data-workflow-target={edge.targetAgentId}
        data-workflow-status={status}
        data-workflow-instances={hasMultipleInstances ? edge.instanceCount : undefined}
        d={geometry.paths[index] ?? ""}
        markerEnd={`url(#${markerId}-${status}${hasMultipleInstances ? "-multiple" : ""})`} />;
    })}
  </svg>;
}
