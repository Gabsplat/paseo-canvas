import assert from 'node:assert/strict';
import { test } from 'node:test';
import { registerHooks } from 'node:module';
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === 'react' || specifier === 'react/jsx-runtime') return { url: new URL('./fixtures/react-headless.ts', `file://${__filename}`).href, shortCircuit: true };
  if (specifier === 'react-native') return { url: new URL('./fixtures/native-headless.ts', `file://${__filename}`).href, shortCircuit: true };
  return nextResolve(specifier, context);
} });
// The production pencil hook, layout, move/group builders and reducer. Only React and the transport are stand-ins.
const { useWhiteboard } = require('../plugin/client/useWhiteboard');
const { DEFAULT_TOOL_STYLE } = require('../plugin/client/whiteboard-tools');
const { layoutCanvas, moveOperations, groupOperations, anchorCard } = require('../plugin/client/logic');
const { builtinTypes, builtinTemplates, builtinPacks } = require('../plugin/shared/builtins');
const { reduce } = require('../plugin/server/reducer');
const { appendStroke, layerFits, WB_LAYER_LIMIT_MESSAGE } = require('../plugin/shared/whiteboard');
const { reset, effects } = require('./fixtures/react-headless');
const catalog = { revision: 0, blockTypes: builtinTypes, templates: builtinTemplates, packs: builtinPacks };
const card = (id: string, x: number, y: number, extra = {}) => ({ id, typeId: 'node', title: `Tarjeta ${id}`, position: { x, y }, size: { width: 240, height: 160 }, data: {}, ...extra });
function document(blocks: any[] = [card('a', 200, 100), card('b', 600, 100)], groups: any[] = []) { return { id: 'strokes', workspaceId: 'workspace', revision: 0, createdAt: '2026-10-06T00:00:00.000Z', updatedAt: '2026-10-06T00:00:00.000Z', title: 'Trazos de ejemplo', description: '', example: true, communication: { instructions: '', intent: '', audience: '' }, blocks, groups, links: [], selectedIds: [] } as any; }
const pointer = (x: number, y: number) => ({ x, y, shift: false, command: false, pointerId: 1 });
function harness(initial = document()) {
  reset(); let doc = initial, tool = 'draw'; const transactions: any[] = [], sent: any[] = [], failures: string[] = [];
  const c: any = { view: { document: doc }, catalog, busy: false, offline: false, selection: [], select: async (ids: string[]) => { c.selection = ids; }, fail: (e: Error) => { failures.push(e.message); },
    send: async (action: any) => { sent.push(action); return { id: 'evt' }; },
    edit: async (operations: any[], label: string) => { transactions.push({ operations, label }); doc = reduce(doc, operations, catalog); c.view = { document: doc }; return c.view; } };
  const env: any = { controller: c, get layout() { return layoutCanvas(doc, {}, catalog); }, world: (p: any) => ({ x: p.x, y: p.y }), center: () => ({ x: 400, y: 300 }), scale: () => 1, tool: () => tool, choose: (next: string) => { tool = next; }, style: () => DEFAULT_TOOL_STYLE, locked: () => false, pan: () => {} };
  const wb = useWhiteboard(env), toolEffect = effects[1];
  const stroke = async (points: [number, number][]) => { wb.begin(pointer(...points[0])); for (const p of points.slice(1)) wb.move(pointer(...p)); await wb.finish(pointer(...points.at(-1)!), false); };
  return { wb, c, transactions, sent, failures, stroke, doc: () => doc, apply: (operations: any[]) => { doc = reduce(doc, operations, catalog); c.view = { document: doc }; }, rect: (id: string) => layoutCanvas(doc, {}, catalog).rects.get(id),
    setTool: async (next: string) => { tool = next; toolEffect(); await Promise.resolve(); await Promise.resolve(); } };
}
const draws = (doc: any) => doc.blocks.filter((b: any) => b.typeId === 'wb-draw');

test('anchor data in an ordinary custom card does not change dragging or grouping; drawing aliases still follow their cards', () => {
  const nodeType = builtinTypes.find((type: any) => type.id === 'node');
  const referenceType = { ...nodeType, id: 'reference-card', properties: [...nodeType.properties, { key: 'anchor', label: 'Referenced card', kind: 'text' }], defaults: { ...nodeType.defaults, anchor: 'a' } };
  const drawingType = { ...builtinTypes.find((type: any) => type.id === 'wb-draw'), id: 'custom-drawing' };
  const customCatalog = { ...catalog, blockTypes: [...catalog.blockTypes, referenceType, drawingType] };
  const initial = document([card('a', 200, 100), card('ref', 600, 100, { typeId: referenceType.id, data: { anchor: 'a' } })]);
  const rects = layoutCanvas(initial, {}, customCatalog).rects;
  const moved = moveOperations(initial, rects, ['a', 'ref'], { x: 30, y: 20 }, undefined, { catalog: customCatalog, grid: false });
  assert.deepEqual(moved.filter((op: any) => op.type === 'entity.move').map((op: any) => op.id).sort(), ['a', 'ref'], 'Both ordinary cards receive their own move.');
  const afterMove = reduce(initial, moved, customCatalog), movedRects = layoutCanvas(afterMove, {}, customCatalog).rects;
  assert.equal(movedRects.get('ref').x, rects.get('ref').x + 30);
  assert.equal(anchorCard(initial, initial.blocks[1], customCatalog), undefined, 'The field belongs to the custom type, not to a stroke layer.');
  const grouped = reduce(initial, groupOperations(initial, rects, ['ref'], 'g', customCatalog), customCatalog);
  assert.equal(grouped.blocks.find((block: any) => block.id === 'ref').parentGroupId, 'g');
  assert.equal(grouped.blocks.find((block: any) => block.id === 'ref').data.anchor, 'a');
  const ink = { id: 'ink', typeId: drawingType.id, title: '', position: { x: 10, y: 10 }, size: { width: 40, height: 12 }, data: { anchor: 'a', extent: { width: 40, height: 12 }, strokes: [{ points: [0, 0, 40, 12], color: 'tinta', weight: 'm' }] } };
  const annotated = document([...initial.blocks, ink]);
  assert.equal(anchorCard(annotated, ink, customCatalog)?.id, 'a', 'A custom type using the drawing renderer remains anchored.');
  const drawingMoves = moveOperations(annotated, layoutCanvas(annotated, {}, customCatalog).rects, ['a', 'ink'], { x: 30, y: 20 }, undefined, { catalog: customCatalog, grid: false });
  assert.deepEqual(drawingMoves.filter((op: any) => op.type === 'entity.move').map((op: any) => op.id), ['a']);
});

test('the pencil signs strokes as the learner and anchors them to the card they start on', async () => {
  const h = harness();
  await h.stroke([[40, 40], [90, 60], [140, 40]]);
  await h.stroke([[250, 150], [300, 180], [350, 150]]); await h.stroke([[260, 200], [340, 200]]);
  await h.stroke([[650, 150], [700, 150]]);
  const [free, onA, onB] = draws(h.doc());
  assert.equal(draws(h.doc()).length, 3, 'Empty canvas, card A and card B are three separate layers.');
  assert.deepEqual([free.data.author, free.data.anchor], ['learner', undefined]); assert.deepEqual(free.position, { x: 40, y: 40 });
  assert.equal(onA.data.anchor, 'a'); assert.equal(onA.data.strokes.length, 2, 'Consecutive strokes on the same card share one drawing.'); assert.deepEqual(onA.position, { x: 50, y: 50 }, 'Stored relative to the card corner, not to the canvas.');
  assert.equal(onB.data.anchor, 'b'); assert.deepEqual(onB.position, { x: 50, y: 50 });
  assert.deepEqual(h.rect(onA.id), { ...h.rect(onA.id), x: 250, y: 150 }, 'It is drawn exactly where it was drawn.');
  assert.ok(h.transactions.every(t => t.label === 'Dibujar trazo')); assert.equal(h.transactions.length, 4, 'One transaction, one undo step, per stroke.');
});
test('an anchored drawing follows its card through moves, automatic layouts and grouping; moving it alone changes only its offset', async () => {
  const h = harness(); await h.stroke([[250, 150], [350, 190]]); const id = draws(h.doc())[0].id;
  const offset = () => { const d = h.rect(id), a = h.rect('a'); return { x: d.x - a.x, y: d.y - a.y }; };
  assert.deepEqual(offset(), { x: 50, y: 50 });
  // Card and drawing dragged together: one move, for the card. The drawing rides along.
  let operations = moveOperations(h.doc(), layoutCanvas(h.doc(), {}, catalog).rects, ['a', id], { x: 300, y: 220 }, undefined, { catalog, grid: false });
  assert.deepEqual(operations.filter((op: any) => op.type === 'entity.move').map((op: any) => op.id), ['a']); h.apply(operations);
  assert.deepEqual(h.rect('a').x, 500); assert.deepEqual(offset(), { x: 50, y: 50 });
  // The drawing dragged by itself: its offset changes by exactly the drag, and it stays anchored.
  operations = moveOperations(h.doc(), layoutCanvas(h.doc(), {}, catalog).rects, [id], { x: -30, y: 12 }, undefined, { catalog, grid: false }); h.apply(operations);
  assert.deepEqual(offset(), { x: 20, y: 62 }); assert.equal(draws(h.doc())[0].data.anchor, 'a');
  // Grouping the card: the server brings the annotation into the new group and the picture does not shift.
  const before = h.rect(id); h.apply(groupOperations(h.doc(), layoutCanvas(h.doc(), {}, catalog).rects, ['a', id], 'g', catalog));
  assert.equal(draws(h.doc())[0].parentGroupId, 'g'); assert.deepEqual(offset(), { x: 20, y: 62 }); assert.deepEqual([h.rect(id).x, h.rect(id).y], [before.x, before.y]);
  // Automatic arrangements place the card without a stored position; the drawing still sits on it.
  for (const mode of ['stack', 'grid', 'flow', 'graph']) {
    const q = harness(document([card('first', 0, 0, { parentGroupId: 'g', position: undefined }), card('a', 0, 0, { parentGroupId: 'g', position: undefined }),
      { id: 'ink', typeId: 'wb-draw', title: '', parentGroupId: 'g', position: { x: 30, y: 40 }, size: { width: 80, height: 20 }, data: { extent: { width: 80, height: 20 }, strokes: [{ points: [0, 0, 80, 20], color: 'tinta', weight: 'm' }], author: 'learner', anchor: 'a' } }],
      [{ id: 'g', title: 'Grupo', description: '', position: { x: 100, y: 100 }, blockIds: ['first', 'a', 'ink'], groupIds: [], layout: { mode } }]));
    const place = () => ({ x: q.rect('ink').x - q.rect('a').x, y: q.rect('ink').y - q.rect('a').y }), was = { ...q.rect('a') };
    assert.deepEqual(place(), { x: 30, y: 40 }, mode);
    q.apply([{ type: 'group.update', id: 'g', patch: { blockIds: ['a', 'first', 'ink'] } }]);
    assert.deepEqual(place(), { x: 30, y: 40 }, `${mode} after reordering`); assert.notDeepEqual({ ...q.rect('a') }, was, `${mode}: the card really moved`);
  }
});
test('the eraser works on anchored drawings where they are shown, and appending keeps author and anchor', async () => {
  const h = harness(); await h.stroke([[250, 150], [350, 150]]); await h.stroke([[250, 200], [350, 200]]);
  h.apply([{ type: 'entity.move', id: 'a', parentGroupId: null, position: { x: 900, y: 400 } }]);
  await h.setTool('eraser'); h.wb.begin(pointer(1000, 450)); await h.wb.finish(pointer(1000, 450), false);
  assert.equal(draws(h.doc())[0].data.strokes.length, 1, 'The stroke under the pointer at the card\'s new place is the one erased.'); assert.equal(h.transactions.at(-1).label, 'Borrar trazos');
  const kept = draws(h.doc())[0], next = appendStroke({ position: kept.position, size: kept.size, data: kept.data }, [60, 60, 90, 90], { color: 'rojo', weight: 'l' });
  assert.deepEqual([next.data.author, next.data.anchor, next.data.strokes.length], ['learner', 'a', 2]);
});
test('leaving pencil and eraser settles one bounded summary; drawing itself sends nothing', async () => {
  const h = harness(); await h.stroke([[250, 150], [350, 150]]); await h.stroke([[40, 40], [90, 40]]);
  assert.equal(h.sent.length, 0, 'No event per stroke.');
  await h.setTool('eraser'); assert.equal(h.sent.length, 0, 'Pencil to eraser is still the same activity.');
  await h.setTool('select');
  assert.equal(h.sent.length, 1); const action = h.sent[0];
  assert.deepEqual([action.kind, action.delivery, action.settled], ['whiteboard.strokes', 'batched', true]);
  assert.deepEqual(action.payload, { learner: { drawings: 2, strokes: 2 }, assistant: { strokes: 0 }, authored: { strokes: 0 }, anchors: [{ id: 'a', title: 'Tarjeta a' }] });
  assert.equal(JSON.stringify(action).includes('points'), false); assert.equal(action.targetIds.length, 2);
  await h.setTool('draw'); await h.setTool('select'); assert.equal(h.sent.length, 1, 'Picking the pencil up and putting it down without drawing reports nothing.');
  const offline = harness(); await offline.stroke([[40, 40], [90, 40]]); offline.c.offline = true; await offline.setTool('select'); assert.equal(offline.sent.length, 0);
});
test('a stroke that cannot fit is refused with the size message and the earlier layer is untouched', async () => {
  const filler = (length: number) => ({ id: 'big', typeId: 'note', title: 'Relleno de ejemplo', position: { x: 2000, y: 2000 }, data: { text: 'x'.repeat(length) } });
  // Leave room for one short stroke and not for a long one.
  const room = 1024 * 1024 - JSON.stringify(document([card('a', 200, 100), filler(0)])).length - 700;
  const h = harness(document([card('a', 200, 100), filler(room)]));
  assert.equal(layerFits(h.doc(), {}), true);
  await h.stroke([[250, 150], [300, 150]]);
  const first = JSON.stringify(draws(h.doc())); assert.equal(draws(h.doc()).length, 1);
  await h.stroke(Array.from({ length: 120 }, (_, i) => [250 + i, 160 + (i % 2) * 40] as [number, number]));
  assert.deepEqual(h.failures, [WB_LAYER_LIMIT_MESSAGE]); assert.equal(JSON.stringify(draws(h.doc())), first, 'The previous layer is preserved byte for byte.');
  assert.equal(h.transactions.length, 1, 'The oversized stroke was never sent.'); assert.equal(h.wb.store.current, null, 'Its preview is gone.');
  assert.equal(layerFits('ñ'.repeat(10), '', 80), false, 'Size is counted in UTF-8 bytes, as the server does.'); assert.equal(layerFits('n'.repeat(10), '', 80), true);
});
test('appending to an existing layer near the document cap counts its replacement, not a second copy of its strokes', async () => {
  const h = harness(), limit = 1024 * 1024;
  await h.stroke(Array.from({ length: 200 }, (_, i) => [40 + i * 2, 40 + (i % 2) * 40] as [number, number]));
  h.apply([{ type: 'block.create', block: { id: 'filler', typeId: 'note', title: 'Relleno de ejemplo', position: { x: 2000, y: 2000 }, data: { text: '' } } }]);
  const room = limit - Buffer.byteLength(JSON.stringify(h.doc())) - 256;
  h.apply([{ type: 'block.update', id: 'filler', patch: { data: { text: 'x'.repeat(room) } } }]);
  const earlier = draws(h.doc())[0], original = JSON.stringify(earlier.data.strokes[0]);
  await h.stroke([[40, 100], [50, 100]]);
  assert.deepEqual(h.failures, [], 'The small append fits even though another copy of the old layer would not.');
  assert.equal(draws(h.doc()).length, 1);
  assert.equal(draws(h.doc())[0].id, earlier.id);
  assert.equal(draws(h.doc())[0].data.strokes.length, 2);
  assert.equal(JSON.stringify(draws(h.doc())[0].data.strokes[0]), original, 'The old points are retained.');
  assert.equal(h.transactions.length, 2);
  assert.ok(Buffer.byteLength(JSON.stringify(h.doc())) < limit);
});
test('keys typed with nothing focused reach the panel that was pressed last, across listener replacement', () => {
  // Reproduces the browser sequence: press inside the panel, the pressed control disables itself so focus falls
  // to <body>, React replaces the key listener, then Escape is typed. It used to be lost, leaving the pencil on.
  const { keyboard } = require('../plugin/client/web');
  const listeners = new Map<string, Set<Function>>();
  const target = () => ({ addEventListener(name: string, fn: Function) { (listeners.get(name) ?? listeners.set(name, new Set()).get(name)!).add(fn); }, removeEventListener(name: string, fn: Function) { listeners.get(name)?.delete(fn); } });
  const body: any = { closest: () => null, parentElement: null }, doc: any = { ...target(), body };
  const panel: any = { ...target(), listeners: new Set<Function>(), addEventListener(_: string, fn: Function) { this.listeners.add(fn); }, removeEventListener(_: string, fn: Function) { this.listeners.delete(fn); }, parentElement: body };
  const other: any = { ...panel, listeners: new Set<Function>() }, button: any = { parentElement: panel, closest: () => null };
  const prior = Object.getOwnPropertyDescriptor(globalThis, 'document'); Object.defineProperty(globalThis, 'document', { configurable: true, value: doc });
  try {
    const seen: string[] = [], fire = (name: string, event: any) => { for (const fn of [...(listeners.get(name) ?? [])]) fn(event); };
    const type = (key: string) => { const event = { key, target: body, shiftKey: false, ctrlKey: false, metaKey: false, preventDefault() {}, stopPropagation() {} }; fire('keydown', event); };
    let detach = keyboard(panel, (e: { key: string }) => { seen.push('first:' + e.key); return true; }); const detachOther = keyboard(other, (e: { key: string }) => { seen.push('other:' + e.key); return true; });
    type('Escape'); assert.equal(seen.length, 0, 'Nothing was pressed yet: unfocused keys belong to no panel.');
    fire('pointerdown', { target: button }); detach(); detach = keyboard(panel, (e: { key: string }) => { seen.push('second:' + e.key); return true; });
    button.parentElement = null; // the pressed control has since left the page
    type('Escape'); assert.deepEqual(seen, ['second:Escape'], 'The current listener of the pressed panel gets the key; the other panel does not.');
    fire('pointerdown', { target: { parentElement: body } }); type('v'); assert.deepEqual(seen, ['second:Escape'], 'A press outside every panel releases the keys.');
    detach(); detachOther(); assert.equal([...listeners.values()].reduce((sum, set) => sum + set.size, 0), 0, 'No document listener is left behind.');
  } finally { if (prior) Object.defineProperty(globalThis, 'document', prior); else delete (globalThis as any).document; }
});
