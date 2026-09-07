import { test } from "node:test";
import assert from "node:assert/strict";
import { roundedWorkflowPath, routeWorkflowConnection, type WorkflowRect } from "./workflowGeometry.ts";

for (const [name, obstacles] of [
  ["stacked mobile cards", [{ left: 16, right: 350, top: 110, bottom: 430 }]],
  ["uneven parallel cards", [{ left: 16, right: 190, top: 110, bottom: 430 }, { left: 220, right: 400, top: 200, bottom: 480 }]],
  ["several skipped levels", [{ left: 16, right: 400, top: 110, bottom: 210 }, { left: 16, right: 400, top: 240, bottom: 410 }]]
] as [string, WorkflowRect[]][]) {
  test(`routes around ${name} without crossing cards`, () => {
    const start = { x: 100, y: 70 }, end = { x: 280, y: 520 };
    const points = routeWorkflowConnection(start, end, obstacles, 440);
    assert.deepEqual(points[0], start);
    assert.deepEqual(points.at(-1), end);
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1], b = points[i];
      assert.ok(a.x === b.x || a.y === b.y);
      for (const rect of obstacles) {
        assert.ok(!(a.x === b.x
          ? a.x > rect.left && a.x < rect.right && Math.max(a.y, b.y) > rect.top && Math.min(a.y, b.y) < rect.bottom
          : a.y > rect.top && a.y < rect.bottom && Math.max(a.x, b.x) > rect.left && Math.min(a.x, b.x) < rect.right));
      }
    }
    assert.doesNotMatch(roundedWorkflowPath(points), /NaN|Infinity/);
  });
}

test("short segments and duplicate points produce bounded corners", () => {
  const path = roundedWorkflowPath([{ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 4 }, { x: 4, y: 4 }]);
  assert.equal(path, "M 0 0 L 0 2 Q 0 4 2 4 L 4 4");
  assert.equal(roundedWorkflowPath([]), "");
});
