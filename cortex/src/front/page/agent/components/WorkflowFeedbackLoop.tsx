import { useEffect, useRef, useState } from "react";
import { roundedWorkflowPath } from "./workflowGeometry.ts";

export interface WorkflowFeedbackLoopEdge {
  sourceAgentId: string;
  targetAgentId: string;
}

export interface WorkflowFeedbackLoopPlacement {
  key: string;
  sourceAgentId: string;
  targetAgentId: string;
  sourceLevelIndex: number;
  targetLevelIndex: number;
  railIndex: number;
  railCount: number;
}

export interface WorkflowFeedbackLoopGeometry {
  width: number;
  height: number;
  sourceX: number;
  sourceY: number;
  targetX: number;
  targetY: number;
  railX: number;
  cornerRadius: number;
}

export function WorkflowFeedbackLoop({
  placement
}: {
  placement: WorkflowFeedbackLoopPlacement;
}) {
  const containerRef = useRef<HTMLSpanElement>(null);
  const [loopGeometry, setLoopGeometry] =
    useState<WorkflowFeedbackLoopGeometry | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    const workflow = container?.closest<HTMLElement>(
      ".agent-project__workflow"
    );

    if (!container || !workflow) {
      return;
    }

    const workflowSteps = [
      ...workflow.querySelectorAll<HTMLElement>("[data-workflow-agent-id]")
    ];
    const sourceCard = workflowSteps
      .find((step) =>
        step.dataset.workflowAgentId === placement.sourceAgentId
      )
      ?.querySelector<HTMLElement>(".agent-card");
    const targetCard = workflowSteps
      .find((step) =>
        step.dataset.workflowAgentId === placement.targetAgentId
      )
      ?.querySelector<HTMLElement>(".agent-card");

    if (!sourceCard || !targetCard) {
      return;
    }

    const updateLoopGeometry = (): void => {
      const workflowRect = workflow.getBoundingClientRect();
      const sourceRect = sourceCard.getBoundingClientRect();
      const targetRect = targetCard.getBoundingClientRect();
      const { width, height } = workflowRect;

      if (width <= 0 || height <= 0) {
        return;
      }

      const rootFontSize = Number.parseFloat(
        window.getComputedStyle(document.documentElement).fontSize
      );
      const rem = Number.isFinite(rootFontSize) ? rootFontSize : 16;
      const sourceLeft = sourceRect.left - workflowRect.left;
      const targetLeft = targetRect.left - workflowRect.left;
      const sourceX = sourceLeft - 7;
      const targetX = targetLeft - 7;
      const availableGutterWidth = Math.max(
        18,
        Math.min(sourceLeft, targetLeft)
      );
      const railPadding = 4;
      const railX = railPadding +
        (placement.railIndex + 1) /
        (placement.railCount + 1) *
        (availableGutterWidth - railPadding * 2);
      const sourceY = sourceRect.bottom - workflowRect.top - Math.min(
        rem * 2.5,
        sourceRect.height / 4
      );
      const targetY = targetRect.top - workflowRect.top + Math.min(
        rem * 2.9,
        targetRect.height / 3
      );
      const maximumHorizontalCornerRadius = Math.max(
        4,
        Math.min(sourceX - railX, targetX - railX) / 2
      );

      setLoopGeometry({
        width,
        height,
        sourceX,
        sourceY,
        targetX,
        targetY,
        railX,
        cornerRadius: Math.max(
          4,
          Math.min(
            13,
            Math.max(7, Math.abs(sourceY - targetY) / 5),
            maximumHorizontalCornerRadius
          )
        )
      });
    };

    updateLoopGeometry();
    const observer = new ResizeObserver(updateLoopGeometry);
    observer.observe(workflow);
    observer.observe(sourceCard);
    observer.observe(targetCard);

    return () => observer.disconnect();
  }, [
    placement.railCount,
    placement.railIndex,
    placement.sourceAgentId,
    placement.targetAgentId
  ]);

  const sourceCircleRadius = 3.25;
  const arrowWidth = 8;
  const arrowHeight = 4;
  const path = loopGeometry
    ? roundedWorkflowPath([
      { x: loopGeometry.sourceX, y: loopGeometry.sourceY },
      { x: loopGeometry.railX, y: loopGeometry.sourceY },
      { x: loopGeometry.railX, y: loopGeometry.targetY },
      { x: loopGeometry.targetX, y: loopGeometry.targetY }
    ], loopGeometry.cornerRadius)
    : "";

  return (
    <span
      aria-hidden="true"
      className="agent-project__feedback-grid-loop"
      data-feedback-rail={placement.railIndex}
      ref={containerRef}
    >
      {loopGeometry && (
        <svg
          className="agent-project__feedback-grid-loop-canvas"
          focusable="false"
          preserveAspectRatio="none"
          viewBox={`0 0 ${loopGeometry.width} ${loopGeometry.height}`}
        >
          <path
            className="agent-project__feedback-grid-loop-path"
            d={path}
          />
          <circle
            className="agent-project__feedback-grid-loop-source"
            cx={loopGeometry.sourceX}
            cy={loopGeometry.sourceY}
            r={sourceCircleRadius}
          />
          <path
            className="agent-project__feedback-grid-loop-arrow"
            d={`M ${loopGeometry.targetX - arrowWidth} ${loopGeometry.targetY - arrowHeight} L ${loopGeometry.targetX} ${loopGeometry.targetY} L ${loopGeometry.targetX - arrowWidth} ${loopGeometry.targetY + arrowHeight} Z`}
          />
        </svg>
      )}
    </span>
  );
}

