export interface Point { x: number; y: number }
export interface WorkflowRect { left: number; right: number; top: number; bottom: number }

/** Round orthogonal corners without overshooting short segments. */
export function roundedWorkflowPath(points: Point[], radius = 12): string {
  const clean = points.filter((p, i) => !i || p.x !== points[i - 1].x || p.y !== points[i - 1].y);
  if (!clean.length) return "";
  let path = `M ${clean[0].x} ${clean[0].y}`;
  for (let i = 1; i < clean.length - 1; i++) {
    const previous = clean[i - 1], p = clean[i], next = clean[i + 1];
    const incoming = Math.hypot(p.x - previous.x, p.y - previous.y);
    const outgoing = Math.hypot(next.x - p.x, next.y - p.y);
    const r = Math.min(radius, incoming / 2, outgoing / 2);
    path += ` L ${p.x + (previous.x - p.x) * r / incoming} ${p.y + (previous.y - p.y) * r / incoming}`;
    path += ` Q ${p.x} ${p.y} ${p.x + (next.x - p.x) * r / outgoing} ${p.y + (next.y - p.y) * r / outgoing}`;
  }
  return `${path} L ${clean.at(-1)!.x} ${clean.at(-1)!.y}`;
}

function isClear(a: Point, b: Point, obstacles: WorkflowRect[]): boolean {
  return !obstacles.some((r) => a.x === b.x
    ? a.x > r.left && a.x < r.right && Math.max(a.y, b.y) > r.top && Math.min(a.y, b.y) < r.bottom
    : a.y > r.top && a.y < r.bottom && Math.max(a.x, b.x) > r.left && Math.min(a.x, b.x) < r.right);
}

/** Prefer a simple elbow; route skipped levels through free space when needed.
 * The visibility grid includes every obstacle boundary, so an uneven card or a
 * mobile stack cannot silently turn a connection into a line through a card. */
export function routeWorkflowConnection(start: Point, end: Point, obstacles: WorkflowRect[], railX: number, clearance = 14): Point[] {
  const middle = (start.y + end.y) / 2;
  const simple = [start, { x: start.x, y: middle }, { x: end.x, y: middle }, end];
  if (end.y >= start.y && simple.slice(1).every((p, i) => isClear(simple[i], p, obstacles))) return simple;

  const xs = [...new Set([start.x, end.x, railX, ...obstacles.flatMap((r) => [r.left - clearance, r.right + clearance])])]
    .filter((x) => x >= 4 && x <= railX).sort((a, b) => a - b);
  const ys = [...new Set([start.y, end.y, ...obstacles.flatMap((r) => [r.top - clearance, r.bottom + clearance])])]
    .sort((a, b) => a - b);
  const width = xs.length;
  const key = (p: Point) => ys.indexOf(p.y) * width + xs.indexOf(p.x);
  const point = (id: number): Point => ({ x: xs[id % width], y: ys[Math.floor(id / width)] });
  const first = key(start), last = key(end);
  const distance = new Map<number, number>([[first, 0]]);
  const previous = new Map<number, number>();
  const queue: { id: number; cost: number }[] = [{ id: first, cost: 0 }];
  // Binary min heap keeps dense branching workflows responsive.
  function push(item: typeof queue[number]) {
    queue.push(item);
    let i = queue.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (queue[parent].cost <= item.cost) break;
      queue[i] = queue[parent]; i = parent;
    }
    queue[i] = item;
  }
  function pop() {
    const result = queue[0], tail = queue.pop()!;
    if (queue.length) {
      let i = 0;
      while (i * 2 + 1 < queue.length) {
        let child = i * 2 + 1;
        if (child + 1 < queue.length && queue[child + 1].cost < queue[child].cost) child++;
        if (queue[child].cost >= tail.cost) break;
        queue[i] = queue[child]; i = child;
      }
      queue[i] = tail;
    }
    return result;
  }
  while (queue.length) {
    const current = pop();
    if (current.cost !== distance.get(current.id)) continue;
    if (current.id === last) {
      const points = [end];
      let id = last;
      while (id !== first) { id = previous.get(id)!; points.push(point(id)); }
      return points.reverse().filter((p, i, all) => !i || i === all.length - 1 ||
        !((all[i - 1].x === p.x && p.x === all[i + 1].x) || (all[i - 1].y === p.y && p.y === all[i + 1].y)));
    }
    const a = point(current.id), column = current.id % width;
    const neighbors = [column > 0 ? current.id - 1 : -1, column < width - 1 ? current.id + 1 : -1,
      current.id - width, current.id + width].filter((id) => id >= 0 && id < width * ys.length);
    for (const id of neighbors) {
      const b = point(id);
      if (!isClear(a, b, obstacles)) continue;
      const cost = current.cost + Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
      if (cost >= (distance.get(id) ?? Infinity)) continue;
      distance.set(id, cost); previous.set(id, current.id); push({ id, cost });
    }
  }
  return []; // Never draw a misleading connection through an obstacle.
}
