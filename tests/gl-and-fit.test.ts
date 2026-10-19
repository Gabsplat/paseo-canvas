import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { GL_LIMITS, nextGLBudget, planGLFrame, surfacePixels } from '../plugin/client/shared-gl';
import { HTML_APP_FIT, HTML_APP_LIMITS, htmlAppFit, htmlAppHeight } from '../plugin/shared/renderers/html-app';
import { getRendererSpec } from '../plugin/shared/renderers';
import { layoutCanvas, minimumKey, sizedHeight } from '../plugin/client/logic';
import { documentSchema } from '../plugin/shared/model';
import { builtinTypes } from '../plugin/shared/builtins';
const catalog = { blockTypes: builtinTypes } as unknown as Parameters<typeof layoutCanvas>[2];

test('a frame draws fresh drawings first, then the longest waiting, within the budget, and always at least one', () => {
  const c = (id: string, pixels: number, last: number, fresh = false) => ({ id, pixels, last, fresh });
  assert.deepEqual(planGLFrame([c('a', 100, 5), c('b', 100, 1), c('c', 100, 3, true)], 1000), ['c', 'b', 'a']);
  assert.deepEqual(planGLFrame([c('a', 600, 5), c('b', 600, 1), c('c', 300, 3)], 1000), ['b', 'c'], 'over budget: the rest waits');
  assert.deepEqual(planGLFrame([c('huge', 5000, 0)], 1000), ['huge'], 'one drawing larger than the budget still draws');
  // Over many frames everyone draws: the frame rate drops, nothing is refused.
  const items = Array.from({ length: 20 }, (_, i) => c(`s${i}`, 500_000, -Infinity)), seen = new Set<string>();
  for (let frame = 0; frame < 6; frame++) for (const id of planGLFrame(items, 2_000_000)) { seen.add(id); items.find(i => i.id === id)!.last = frame; }
  assert.equal(seen.size, 20);
});
test('the pixel budget shrinks after a long frame and recovers after quick ones, within its bounds', () => {
  const { min, max, start } = GL_LIMITS.budget;
  assert.ok(nextGLBudget(start, start, 40) < start); assert.ok(nextGLBudget(start, start, 2) > start);
  assert.equal(nextGLBudget(min, min, 500), min); assert.equal(nextGLBudget(max, 10, 1), max);
  assert.ok(nextGLBudget(start, 1_000_000, 24) <= 1_000_000, 'cut to a share of what was actually drawn');
});
test('drawing buffers follow the camera, honour the block cap and the shared edge, and go below 1:1 only for WebGL', () => {
  assert.deepEqual(surfacePixels(400, 225, 3, 400, 512), { width: 512, height: 288, pixelRatio: 1.28 });
  assert.deepEqual(surfacePixels(200, 100, 2, 300), { width: 600, height: 300, pixelRatio: 3 });
  assert.equal(surfacePixels(400, 200, 2, 40).width, 400, '2D never draws below CSS pixels');
  assert.equal(surfacePixels(400, 200, 2, 40, undefined, GL_LIMITS.floor, GL_LIMITS.edge).width, 100, 'a far zoomed-out shader draws fewer pixels');
  assert.equal(surfacePixels(1600, 800, 2, 6400, undefined, GL_LIMITS.floor, GL_LIMITS.edge).width, GL_LIMITS.edge);
});
test('a mini app window fits its content unless it has a stored size or the page asked for a height', () => {
  assert.equal(htmlAppFit(912.2), 913); assert.equal(htmlAppFit(20), HTML_APP_FIT.min); assert.equal(htmlAppFit(9000), HTML_APP_FIT.max);
  for (const bad of [NaN, Infinity, -1, 0, '400', null]) assert.equal(htmlAppFit(bad), null);
  assert.equal(htmlAppHeight({ sized: false }), HTML_APP_LIMITS.defaultHeight);
  assert.equal(htmlAppHeight({ sized: false, initial: 240 }), 240, 'data.height until the page is measured');
  assert.equal(htmlAppHeight({ sized: false, initial: 240, fitted: 820 }), 820, 'then the content');
  assert.equal(htmlAppHeight({ sized: false, fitted: 820, asked: 300 }), 300, 'lienzo.resize fixes its own');
  assert.equal(htmlAppHeight({ sized: true, fitted: 820, asked: 300 }), 'fill', 'a stored size wins; the page scrolls');
  const guidance = getRendererSpec('html')!.guidance!;
  assert.match(guidance, /fits its height to the page's content/); assert.match(guidance, /592 canvas units wide/);
});
test('the bridge reports the content height when it changes, and only then', async () => {
  const source = await readFile('plugin/client/web.ts', 'utf8'), literal = /export const HTML_APP_BRIDGE = ("(?:[^"\\]|\\.)*");/.exec(source)!;
  const script = (JSON.parse(literal[1]) as string).replace(/^<script>|<\/script>$/g, '');
  const sent: Record<string, unknown>[] = []; let observed: (() => void) | null = null;
  const root = { style: {}, scrollHeight: 360, clientHeight: 360, scrollWidth: 592, getBoundingClientRect: () => ({ height: 140 }) };
  vm.runInNewContext(script, { window: {}, parent: { postMessage: (m: Record<string, unknown>) => sent.push(m) }, addEventListener() {}, requestAnimationFrame: (f: () => void) => f(),
    ResizeObserver: class { constructor(f: () => void) { observed = f; } observe() {} }, document: { readyState: 'complete', documentElement: root, body: {} } });
  const fits = () => sent.filter(m => m.type === 'fit').map(m => m.height);
  assert.deepEqual(fits(), [140], 'short content: the window can shrink to it');
  root.scrollHeight = 1300; observed!(); assert.deepEqual(fits(), [140, 1300], 'overflowing content: its full height');
  observed!(); assert.deepEqual(fits(), [140, 1300], 'no change, no message');
});
test('a sized card never goes below the floor its controls measured', () => {
  assert.equal(sizedHeight(320), 320); assert.equal(sizedHeight(320, 410.2), 411); assert.equal(sizedHeight(500, 410), 500);
  const doc = documentSchema.parse({ id: 'd', workspaceId: 'w', revision: 0, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', title: 'Fit', communication: { instructions: '' },
    blocks: [{ id: 'shader', typeId: 'glsl-shader', title: 'Plasma', data: {}, size: { width: 480, height: 200 } }], groups: [] });
  assert.equal(layoutCanvas(doc, {}, catalog).rects.get('shader')!.height, 200);
  assert.equal(layoutCanvas(doc, { [minimumKey('shader')]: 340 }, catalog).rects.get('shader')!.height, 340);
});
