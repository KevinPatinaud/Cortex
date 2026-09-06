export interface WorkflowExecutionLimits {
  maxConcurrentInstances?: number;
  maxWorkflowExecutions?: number;
}

export function isExecutionCancelled(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}

export function cancelExecution(controller: AbortController): void {
  controller.abort(new DOMException("The execution was cancelled.", "AbortError"));
}

/** Keeps output order stable while limiting simultaneous provider sessions. */
export async function settleWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  execute: (item: T) => Promise<R>
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length);
  let nextIndex = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex++;
      try {
        results[index] = { status: "fulfilled", value: await execute(items[index]) };
      } catch (reason) {
        results[index] = { status: "rejected", reason };
      }
    }
  }));
  return results;
}
