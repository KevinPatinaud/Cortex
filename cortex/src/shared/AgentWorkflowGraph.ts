export interface WorkflowAgentGraphNode {
  id: string;
  nextAgentIds: string[];
}

export function getWorkflowEdgeKey(
  sourceAgentId: string,
  targetAgentId: string
): string {
  return JSON.stringify([sourceAgentId, targetAgentId]);
}

export function orderWorkflowAgentIds(
  agentIds: string[],
  nextAgentIds: ReadonlyMap<string, readonly string[]>
): string[] {
  const sourcePositions = new Map(
    agentIds.map((agentId, index) => [agentId, index])
  );
  const components = getStronglyConnectedComponents(agentIds, nextAgentIds);
  const componentByAgentId = new Map<string, number>();

  components.forEach((component, componentIndex) => {
    for (const agentId of component) {
      componentByAgentId.set(agentId, componentIndex);
    }
  });

  const componentSuccessors = components.map(() => new Set<number>());
  const componentPredecessorCounts = components.map(() => 0);

  for (const sourceAgentId of agentIds) {
    const sourceComponent = componentByAgentId.get(sourceAgentId)!;

    for (const targetAgentId of nextAgentIds.get(sourceAgentId) ?? []) {
      const targetComponent = componentByAgentId.get(targetAgentId);

      if (
        targetComponent === undefined ||
        targetComponent === sourceComponent ||
        componentSuccessors[sourceComponent].has(targetComponent)
      ) {
        continue;
      }

      componentSuccessors[sourceComponent].add(targetComponent);
      componentPredecessorCounts[targetComponent] += 1;
    }
  }

  const componentPositions = components.map((component) =>
    Math.min(...component.map((agentId) => sourcePositions.get(agentId)!))
  );
  const availableComponents = components
    .map((_component, index) => index)
    .filter((index) => componentPredecessorCounts[index] === 0);
  const orderedComponentIndexes: number[] = [];

  while (availableComponents.length > 0) {
    availableComponents.sort(
      (firstIndex, secondIndex) =>
        componentPositions[firstIndex] - componentPositions[secondIndex]
    );
    const componentIndex = availableComponents.shift()!;
    orderedComponentIndexes.push(componentIndex);

    for (const successorIndex of componentSuccessors[componentIndex]) {
      componentPredecessorCounts[successorIndex] -= 1;

      if (componentPredecessorCounts[successorIndex] === 0) {
        availableComponents.push(successorIndex);
      }
    }
  }

  return orderedComponentIndexes.flatMap((componentIndex) =>
    orderComponentAgentIds(
      components[componentIndex],
      agentIds,
      nextAgentIds,
      componentByAgentId,
      componentIndex,
      sourcePositions
    )
  );
}

export function getCyclicAgentIds(
  agents: readonly WorkflowAgentGraphNode[]
): Set<string> {
  const agentIds = agents.map((agent) => agent.id);
  const nextAgentIds = new Map(
    agents.map((agent) => [agent.id, agent.nextAgentIds] as const)
  );
  const cyclicAgentIds = new Set<string>();

  for (const component of getStronglyConnectedComponents(
    agentIds,
    nextAgentIds
  )) {
    if (
      component.length > 1 ||
      (nextAgentIds.get(component[0]) ?? []).includes(component[0])
    ) {
      component.forEach((agentId) => cyclicAgentIds.add(agentId));
    }
  }

  return cyclicAgentIds;
}

export function getWorkflowFeedbackEdgeKeys(
  agents: readonly WorkflowAgentGraphNode[]
): Set<string> {
  const positions = new Map(
    agents.map((agent, index) => [agent.id, index])
  );
  const cyclicAgentIds = getCyclicAgentIds(agents);
  const feedbackEdgeKeys = new Set<string>();

  for (const agent of agents) {
    if (!cyclicAgentIds.has(agent.id)) {
      continue;
    }

    for (const nextAgentId of agent.nextAgentIds) {
      if (
        cyclicAgentIds.has(nextAgentId) &&
        (positions.get(nextAgentId) ?? Number.POSITIVE_INFINITY) <=
          (positions.get(agent.id) ?? Number.NEGATIVE_INFINITY)
      ) {
        feedbackEdgeKeys.add(getWorkflowEdgeKey(agent.id, nextAgentId));
      }
    }
  }

  return feedbackEdgeKeys;
}

function getStronglyConnectedComponents(
  agentIds: readonly string[],
  nextAgentIds: ReadonlyMap<string, readonly string[]>
): string[][] {
  const expectedAgentIds = new Set(agentIds);
  const indexes = new Map<string, number>();
  const lowLinks = new Map<string, number>();
  const stack: string[] = [];
  const stackedAgentIds = new Set<string>();
  const components: string[][] = [];
  let nextIndex = 0;

  const visit = (agentId: string): void => {
    indexes.set(agentId, nextIndex);
    lowLinks.set(agentId, nextIndex);
    nextIndex += 1;
    stack.push(agentId);
    stackedAgentIds.add(agentId);

    for (const successorId of nextAgentIds.get(agentId) ?? []) {
      if (!expectedAgentIds.has(successorId)) {
        continue;
      }

      if (!indexes.has(successorId)) {
        visit(successorId);
        lowLinks.set(
          agentId,
          Math.min(lowLinks.get(agentId)!, lowLinks.get(successorId)!)
        );
      } else if (stackedAgentIds.has(successorId)) {
        lowLinks.set(
          agentId,
          Math.min(lowLinks.get(agentId)!, indexes.get(successorId)!)
        );
      }
    }

    if (lowLinks.get(agentId) !== indexes.get(agentId)) {
      return;
    }

    const component: string[] = [];
    let componentAgentId: string;

    do {
      componentAgentId = stack.pop()!;
      stackedAgentIds.delete(componentAgentId);
      component.push(componentAgentId);
    } while (componentAgentId !== agentId);

    components.push(component);
  };

  for (const agentId of agentIds) {
    if (!indexes.has(agentId)) {
      visit(agentId);
    }
  }

  return components;
}

function orderComponentAgentIds(
  component: string[],
  agentIds: readonly string[],
  nextAgentIds: ReadonlyMap<string, readonly string[]>,
  componentByAgentId: ReadonlyMap<string, number>,
  componentIndex: number,
  sourcePositions: ReadonlyMap<string, number>
): string[] {
  if (component.length === 1) {
    return component;
  }

  const componentAgentIds = new Set(component);
  const entryAgentIds = component.filter((agentId) =>
    agentIds.some((sourceAgentId) =>
      componentByAgentId.get(sourceAgentId) !== componentIndex &&
      (nextAgentIds.get(sourceAgentId) ?? []).includes(agentId)
    )
  );
  const sortBySourcePosition = (
    firstAgentId: string,
    secondAgentId: string
  ): number =>
    sourcePositions.get(firstAgentId)! - sourcePositions.get(secondAgentId)!;
  const pendingAgentIds = [
    ...entryAgentIds.sort(sortBySourcePosition),
    ...component
      .filter((agentId) => !entryAgentIds.includes(agentId))
      .sort(sortBySourcePosition)
  ];
  const orderedAgentIds: string[] = [];
  const visitedAgentIds = new Set<string>();

  while (pendingAgentIds.length > 0) {
    const agentId = pendingAgentIds.shift()!;

    if (visitedAgentIds.has(agentId)) {
      continue;
    }

    visitedAgentIds.add(agentId);
    orderedAgentIds.push(agentId);
    const internalSuccessors = [...(nextAgentIds.get(agentId) ?? [])]
      .filter((successorId) =>
        componentAgentIds.has(successorId) &&
        !visitedAgentIds.has(successorId)
      )
      .sort(
        (firstAgentId, secondAgentId) =>
          sourcePositions.get(firstAgentId)! - sourcePositions.get(secondAgentId)!
      );
    pendingAgentIds.unshift(...internalSuccessors);
  }

  return orderedAgentIds;
}
