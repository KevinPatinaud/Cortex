import { routeWorkflowConnection } from '../../src/front/page/agent/components/workflowGeometry.ts';
const cards = Array.from({ length: 50 }, (_, i) => ({ left: i % 2 ? 460 : 0, right: i % 2 ? 860 : 400, top: Math.floor(i / 2) * 350, bottom: Math.floor(i / 2) * 350 + 260 }));
const started = performance.now();
let missing = 0;
for (let i = 0; i < 48; i++) {
  const source = cards[i], target = cards[49];
  const path = routeWorkflowConnection({x:(source.left+source.right)/2,y:source.bottom+15},{x:660,y:target.top-17}, cards, 892, 12+(i%3)*6);
  if (!path.length) missing++;
}
console.log(JSON.stringify({cards:50,connections:48,missing,milliseconds:Math.round(performance.now()-started)}));

