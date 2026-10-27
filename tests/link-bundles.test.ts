import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { builtinTypes } from '../plugin/shared/builtins';
import { documentContentSchema, documentSchema, type CanvasCatalog, type CanvasDocument, type CanvasOperation } from '../plugin/shared/model';
import { reduce } from '../plugin/server/reducer';
import { CanvasStore } from '../plugin/server/store';
import { CanvasService } from '../plugin/server/service';
import { MediaStore } from '../plugin/server/media';
import { exportLienzo, importLienzo } from '../plugin/server/lienzo-file';
import { ToolRouter } from '../plugin/server/tools';
import { legibility } from '../plugin/shared/legibility';
import { CanvasError } from '../plugin/shared/errors';
import { mutation, workspaceId } from './helpers';

/** Example data: four source cards on the left, four targets on the right, eight links between them. */
const catalog: CanvasCatalog = { revision: 0, blockTypes: builtinTypes, packs: [], extensions: [] };
const card = (id: string, x: number, y: number, parentGroupId: string | null = null) => ({ id, typeId: 'node', title: id.toUpperCase(), data: { summary: id }, position: { x, y }, parentGroupId });
const links = [['s1', 't1'], ['s1', 't2'], ['s2', 't2'], ['s2', 't3'], ['s3', 't3'], ['s3', 't4'], ['s4', 't4'], ['s4', 't1']].map(([from, to], i) => ({ id: `l${i + 1}`, from, to, kind: 'flow' as const }));
export function wiring(): CanvasDocument {
  return documentSchema.parse({ id: 'd', workspaceId, revision: 0, createdAt: '2026-10-26T00:00:00.000Z', updatedAt: '2026-10-26T00:00:00.000Z', title: 'Wiring (example data)', example: true,
    communication: { instructions: '' }, layout: { mode: 'free' },
    blocks: [...[0, 1, 2, 3].map(i => card(`s${i + 1}`, 0, i * 140)), ...[0, 1, 2, 3].map(i => card(`t${i + 1}`, 900, i * 140))],
    groups: [], links });
}
const bundle = (id = 'bn', linkIds = links.map(l => l.id)): CanvasOperation => ({ type: 'bundle.create', bundle: { id, points: [{ x: 380, y: 260 }, { x: 560, y: 260 }] }, linkIds });
const fails = (fn: () => unknown, code: string, pattern?: RegExp) => assert.throws(fn, (error: unknown) => error instanceof CanvasError && error.code === code && (!pattern || pattern.test(error.message)));

test('bundle.create gathers links, bundle.update moves the clips, bundle.delete releases them', () => {
  const made = reduce(wiring(), [bundle()], catalog);
  assert.deepEqual(made.bundles, [{ id: 'bn', points: [{ x: 380, y: 260 }, { x: 560, y: 260 }] }]);
  assert.ok(made.links.every(l => l.bundleId === 'bn'));
  const moved = reduce(made, [{ type: 'bundle.update', id: 'bn', patch: { points: [{ x: 400, y: 300 }, { x: 500, y: 300 }, { x: 600, y: 320 }] } }], catalog);
  assert.equal(moved.bundles![0].points.length, 3);
  const released = reduce(moved, [{ type: 'bundle.delete', id: 'bn' }], catalog);
  assert.equal(released.bundles, undefined, 'no bundles left, no field'); assert.ok(released.links.every(l => !('bundleId' in l)));
  // link.update sets and clears membership; the last link leaving removes the bundle.
  const out = reduce(made, [{ type: 'link.update', id: 'l1', patch: { bundleId: null } }], catalog);
  assert.equal(out.links.find(l => l.id === 'l1')!.bundleId, undefined); assert.equal(out.bundles!.length, 1);
  const back = reduce(out, [{ type: 'link.update', id: 'l1', patch: { bundleId: 'bn' } }], catalog);
  assert.equal(back.links.find(l => l.id === 'l1')!.bundleId, 'bn');
  const emptied = reduce(made, links.map(l => ({ type: 'link.update', id: l.id, patch: { bundleId: null } }) as CanvasOperation), catalog);
  assert.equal(emptied.bundles, undefined, 'an empty bundle is removed');
});

test('bundle validation: same document, unique ids, limits, existing links and bundles', () => {
  const doc = wiring();
  fails(() => reduce(doc, [bundle('bn', ['l1', 'nope'])], catalog), 'NOT_FOUND', /Link nope/);
  fails(() => reduce(doc, [bundle('s1')], catalog), 'INVARIANT', /Duplicate bundle ID/);
  fails(() => reduce(doc, [bundle('l1')], catalog), 'INVARIANT', /Duplicate bundle ID/);
  fails(() => reduce(doc, [bundle('bn', ['l1', 'l1'])], catalog), 'VALIDATION');
  fails(() => reduce(doc, [{ type: 'link.update', id: 'l1', patch: { bundleId: 'ghost' } }], catalog), 'NOT_FOUND', /bundle ghost/);
  fails(() => reduce(doc, [{ type: 'bundle.update', id: 'ghost', patch: {} }], catalog), 'NOT_FOUND');
  fails(() => reduce(doc, [{ type: 'bundle.create', bundle: { id: 'far', points: [{ x: 0, y: 0 }, { x: 200_000, y: 0 }] }, linkIds: ['l1'] }], catalog), 'VALIDATION', /finite/);
  fails(() => reduce(doc, [{ type: 'bundle.create', bundle: { id: 'framed', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }], parentGroupId: 'nowhere' }, linkIds: ['l1'] }], catalog), 'INVARIANT', /missing Frame/);
  // 65 links in one bundle is one too many.
  const many = { ...doc, blocks: [...doc.blocks, ...Array.from({ length: 65 }, (_, i) => card(`m${i}`, 2000, i * 10))], links: [...doc.links, ...Array.from({ length: 65 }, (_, i) => ({ id: `ml${i}`, from: 's1', to: `m${i}`, kind: 'flow' as const }))] };
  const first = reduce(many, [{ type: 'bundle.create', bundle: { id: 'big', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] }, linkIds: many.links.slice(8, 72).map(l => l.id) }], catalog);
  fails(() => reduce(first, [{ type: 'link.update', id: 'ml64', patch: { bundleId: 'big' } }], catalog), 'VALIDATION', /at most 64/);
  // An old document with neither field still loads; a stored link with bundleId but no bundle does not.
  assert.equal(documentSchema.parse(JSON.parse(JSON.stringify(doc))).bundles, undefined);
});

test('deleting a link or an end card cleans the bundle up; a Frame that goes takes its bundles back to the root', () => {
  const made = reduce(wiring(), [bundle('bn', ['l1', 'l2'])], catalog);
  const oneLeft = reduce(made, [{ type: 'link.delete', id: 'l1' }], catalog);
  assert.deepEqual(oneLeft.bundles!.map(b => b.id), ['bn']);
  const gone = reduce(made, [{ type: 'block.delete', id: 's1' }], catalog);
  assert.equal(gone.bundles, undefined, 's1 carried both links of the bundle');
  // Inside a transaction a bundle may be empty for a moment (release position deletes and re-creates a card with its links).
  const kept = reduce(made, [{ type: 'block.delete', id: 's1' }, { type: 'block.create', block: card('s1', 0, 0) }, { type: 'link.create', link: { ...links[0], bundleId: 'bn' } }], catalog);
  assert.deepEqual(kept.links.filter(l => l.bundleId).map(l => l.id), ['l1']);
  const framed = reduce({ ...wiring(), groups: [{ id: 'f', title: 'F', description: '', blockIds: [], groupIds: [], position: { x: 0, y: 0 } }] }, [{ type: 'bundle.create', bundle: { id: 'bf', points: [{ x: 0, y: 0 }, { x: 40, y: 0 }], parentGroupId: 'f' }, linkIds: ['l1'] }], catalog);
  assert.equal(framed.bundles![0].parentGroupId, 'f');
  assert.equal(reduce(framed, [{ type: 'group.delete', id: 'f' }], catalog).bundles![0].parentGroupId, undefined);
});

test('duplicating a Frame copies a bundle whose links all come along; a partly copied bundle leaves its copies loose', () => {
  const base = wiring();
  const doc = { ...base, blocks: base.blocks.map(b => ({ ...b, parentGroupId: 'f' })), groups: [{ id: 'f', title: 'F', description: '', blockIds: base.blocks.map(b => b.id), groupIds: [], position: { x: 0, y: 0 } }] } as CanvasDocument;
  const made = reduce(doc, [bundle('bn', ['l1', 'l2']), { type: 'bundle.create', bundle: { id: 'bf', points: [{ x: 0, y: 0 }, { x: 40, y: 0 }], parentGroupId: 'f' }, linkIds: ['l3'] }], catalog);
  const copy = reduce(made, [{ type: 'entity.duplicate', id: 'f', idPrefix: 'copy' }], catalog);
  assert.deepEqual(copy.bundles!.map(b => b.id).sort(), ['bf', 'bn', 'copy.bf', 'copy.bn']);
  assert.equal(copy.bundles!.find(b => b.id === 'copy.bf')!.parentGroupId, 'copy.f', 'a bundle placed in the Frame follows the copy');
  assert.equal(copy.links.find(l => l.id === 'copy.l1')!.bundleId, 'copy.bn');
  assert.equal(copy.links.find(l => l.id === 'copy.l4')!.bundleId, undefined);
});

async function service(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'lienzo-bundles-'));
  const store = new CanvasStore(directory), canvas = new CanvasService(store), media = new MediaStore(directory);
  t.after(async () => { await store.close(); await rm(directory, { recursive: true, force: true }); });
  const { id: _id, workspaceId: _w, revision: _r, createdAt: _c, updatedAt: _u, ...content } = wiring();
  await canvas.create({ workspaceId, id: 'd', content: documentContentSchema.parse(content) });
  return { store, canvas, media };
}

test('undo and redo restore bundles and memberships as one step; history names the bundle', async t => {
  const { canvas } = await service(t), reference = { workspaceId, documentId: 'd' };
  await canvas.mutate(mutation(0, [bundle()]));
  const history = await canvas.history(reference);
  assert.ok(history.transactions.at(-1)!.changed.includes('bn'));
  await canvas.mutate(mutation(1, [{ type: 'bundle.update', id: 'bn', patch: { points: [{ x: 0, y: 0 }, { x: 10, y: 10 }] } }]));
  await canvas.undo({ ...reference, expectedRevision: 2 });
  assert.deepEqual((await canvas.read(reference)).document.bundles![0].points[0], { x: 380, y: 260 });
  await canvas.undo({ ...reference, expectedRevision: 3 });
  const undone = (await canvas.read(reference)).document;
  assert.equal(undone.bundles, undefined); assert.ok(undone.links.every(l => !l.bundleId));
  await canvas.undo({ ...reference, expectedRevision: 4 }, 'user', true);
  assert.ok((await canvas.read(reference)).document.links.every(l => l.bundleId === 'bn'));
  // Deleting a card that empties the bundle, then undoing, brings both back.
  await canvas.mutate(mutation(5, [{ type: 'link.update', id: 'l1', patch: { bundleId: null } }, ...['s2', 's3', 's4', 't1', 't2', 't3', 't4'].map(id => ({ type: 'block.delete', id }) as CanvasOperation), { type: 'block.delete', id: 's1' }]));
  assert.equal((await canvas.read(reference)).document.bundles, undefined);
  await canvas.undo({ ...reference, expectedRevision: 6 });
  assert.equal((await canvas.read(reference)).document.bundles!.length, 1);
});

test('a .lienzo file carries bundles both ways', async t => {
  const a = await service(t), b = await service(t);
  await a.canvas.mutate(mutation(0, [bundle()]));
  const { text } = await exportLienzo(a.store, a.media, { workspaceId, documentId: 'd', comments: false, runtime: false }, { name: 'Lienzo', version: 'test' });
  assert.match(text, /"bundles"/);
  const done = await importLienzo(b.store, b.media, { workspaceId, text, dryRun: false });
  const copy = (await b.canvas.read({ workspaceId, documentId: done.documentId! })).document;
  assert.deepEqual(copy.bundles, [{ id: 'bn', points: [{ x: 380, y: 260 }, { x: 560, y: 260 }] }]); assert.ok(copy.links.every(l => l.bundleId === 'bn'));
});

test('MCP: canvas_apply takes bundle operations; canvas_read outline lists bundles and ids reads one with its links', async t => {
  const { canvas } = await service(t), router = new ToolRouter(canvas, async () => ({ agentId: 'a', workspaceId }));
  const applied = await router.call('canvas_apply', { documentId: 'd', expectedRevision: 0, operations: [bundle()] }, 'owner') as { revision: number };
  assert.equal(applied.revision, 1);
  const outline = await router.call('canvas_read', { documentId: 'd' }, 'owner') as { document: { bundles: unknown[]; links: { bundleId?: string }[] } };
  assert.equal(outline.document.bundles.length, 1); assert.ok(outline.document.links.every(l => l.bundleId === 'bn'));
  const read = await router.call('canvas_read', { documentId: 'd', ids: ['bn'] }, 'owner') as { entities: { entity: { linkIds: string[] } }[] };
  assert.deepEqual(read.entities[0].entity.linkIds, links.map(l => l.id));
  await router.call('canvas_apply', { documentId: 'd', expectedRevision: 1, operations: [{ type: 'bundle.delete', id: 'bn' }] }, 'owner');
  const after = await router.call('canvas_read', { documentId: 'd' }, 'owner') as { document: { bundles?: unknown[] } };
  assert.equal(after.document.bundles, undefined);
});

test('legibility suggests bundling many loose links between two areas, and bundled links stop counting as a tangle', () => {
  const area = (id: string, prefix: string) => ({ id, title: id, description: '', blockIds: [0, 1, 2, 3, 4, 5, 6].map(i => `${prefix}${i}`), groupIds: [] });
  const blocks = [...[0, 1, 2, 3, 4, 5, 6].map(i => card(`a${i}`, 0, 0, 'A')), ...[0, 1, 2, 3, 4, 5, 6].map(i => card(`b${i}`, 0, 0, 'B'))];
  const loose = [0, 1, 2, 3, 4, 5, 6].flatMap(i => [{ id: `x${i}`, from: `a${i}`, to: `b${i}`, kind: 'flow' as const }, { id: `y${i}`, from: `a${i}`, to: `b${(i + 1) % 7}`, kind: 'flow' as const }]);
  const report = legibility({ blocks, groups: [area('A', 'a'), area('B', 'b')], links: loose });
  assert.ok(report.warnings.some(w => /bundle the ones that must stay/.test(w)), 'a tangle names bundling among its remedies');
  const few = legibility({ blocks, groups: [area('A', 'a'), area('B', 'b')], links: loose.slice(0, 5) });
  assert.ok(few.warnings.some(w => /5 separate links run between "A" and "B"\. Bundle them/.test(w)), 'a handful between two areas: bundle them');
  assert.ok(!legibility({ blocks, groups: [area('A', 'a'), area('B', 'b')], links: loose.slice(0, 3) }).warnings.length);
  const bundled = legibility({ blocks, groups: [area('A', 'a'), area('B', 'b')], links: loose.map(l => ({ ...l, bundleId: 'bn' })) });
  assert.equal(bundled.crossAreaLinks, 14); assert.ok(!bundled.warnings.some(w => /tangle|bundle/i.test(w)));
});

// ---- Client geometry (plugin/client/logic.ts) and copies (clipboard.ts). ----
import { bundleOperations, bundlePlacement, crossedLinks, laneOrder, layoutCanvas, linkRoutes, pathPoints, bundleShapes, packPorts, resamplePath, morphFrame, easeOutCubic, strandFrame } from '../plugin/client/logic';
import { tokens } from '../plugin/client/tokens';
import { copyClip, duplicateOperations, pasteOperations, placeAt } from '../plugin/client/clipboard';
const segmentsCross = (p: { x: number; y: number }[], q: { x: number; y: number }[]) => {
  const side = (o: { x: number; y: number }, s: { x: number; y: number }, t: { x: number; y: number }) => (s.x - o.x) * (t.y - o.y) - (s.y - o.y) * (t.x - o.x);
  for (let i = 1; i < p.length; i++) for (let j = 1; j < q.length; j++) { const a = p[i - 1], b = p[i], c = q[j - 1], d = q[j]; if (side(a, b, c) * side(a, b, d) < 0 && side(c, d, a) * side(c, d, b) < 0) return true; }
  return false;
};

test('lanes follow the sources across the entry; a monotonic wiring never crosses, and lanes stay parallel between the clips', () => {
  const P = [{ x: 400, y: 200 }, { x: 600, y: 200 }];
  assert.deepEqual(laneOrder(P, [{ id: 'c', from: { x: 0, y: 300 }, to: { x: 900, y: 0 } }, { id: 'a', from: { x: 0, y: 0 }, to: { x: 900, y: 300 } }, { id: 'b', from: { x: 0, y: 0 }, to: { x: 900, y: 100 } }]), ['b', 'a', 'c'], 'by source, then by target');
  const doc = { ...wiring(), links: [0, 1, 2, 3].map(i => ({ id: `m${i}`, from: `s${i + 1}`, to: `t${i + 1}`, kind: 'flow' as const })) };
  const layout = layoutCanvas(doc, {}, catalog), [a, b] = bundlePlacement(['s1', 's2', 's3', 's4'].map(id => layout.rects.get(id)!), ['t1', 't2', 't3', 't4'].map(id => layout.rects.get(id)!));
  const bundled = { ...doc, bundles: [{ id: 'bn', points: [a, b] }], links: doc.links.map(l => ({ ...l, bundleId: 'bn' })) };
  const routes = linkRoutes(bundled, layout).filter(r => r.bundle);
  assert.equal(routes.length, 4); assert.deepEqual(routes.map(r => r.bundle!.lanes), [4, 4, 4, 4]);
  assert.deepEqual([...routes].sort((p, q) => p.bundle!.lane - q.bundle!.lane).map(r => r.links[0].id), ['m0', 'm1', 'm2', 'm3']);
  const lines = routes.map(r => pathPoints(r.d));
  for (let i = 0; i < lines.length; i++) for (let j = i + 1; j < lines.length; j++) assert.equal(segmentsCross(lines[i], lines[j]), false, `${routes[i].key} × ${routes[j].key}`);
  // Between the clips each lane is the trunk moved by its offset: `gap` apart, parallel; arrows still end at the targets.
  const B = tokens.graph.link.bundle, mid = (a.x + b.x) / 2;
  const ys = [...routes].sort((p, q) => p.bundle!.lane - q.bundle!.lane).map(r => resamplePath(r.d, 800).filter(pt => Math.abs(pt.x - mid) < (b.x - a.x) / 2 - 1).map(pt => pt.y));
  for (const lane of ys) assert.ok(lane.length && lane.every(y => Math.abs(y - lane[0]) < .01), 'straight between the ties');
  ys.slice(1).forEach((lane, i) => assert.ok(Math.abs(lane[0] - ys[i][0] - B.gap) < .01, 'evenly spaced'));
  for (const r of routes) assert.equal(r.end.x, layout.rects.get(r.to)!.x, 'the arrow touches its target on the side facing the clip');
  const [shape] = bundleShapes(bundled, layout, routes);
  assert.equal(shape.ties.length, 2); assert.equal(Math.round(shape.ties[0].angle), 90, 'a tie lies across a horizontal strand');
  assert.equal(shape.ties[0].length, 3 * B.gap + B.width + 2 * B.tie.pad, 'trunk width plus a little each side');
  assert.deepEqual(shape.ties.map(t => t.grip), [0, 1]); assert.ok(!shape.collapsed); assert.doesNotMatch(shape.outline, /NaN/);
});

/** Sampled lanes of every route of a bundle, the sample spacing about one world unit. */
const lanesOf = (routes: ReturnType<typeof linkRoutes>) => routes.filter(r => r.bundle).sort((p, q) => p.bundle!.lane - q.bundle!.lane).map(r => ({ route: r, points: resamplePath(r.d, 600) }));
/** The closest two different lanes come, away from the cards (where a shared port may legitimately meet). */
const closest = (lanes: { points: { x: number; y: number }[] }[]) => { let min = Infinity; for (let i = 0; i < lanes.length; i++) for (let j = i + 1; j < lanes.length; j++) for (const p of lanes[i].points.slice(30, -30)) for (const q of lanes[j].points.slice(30, -30)) min = Math.min(min, Math.hypot(p.x - q.x, p.y - q.y)); return min; };

test('dressed lanes: square stubs, nested bends, no crossing and no touching for a monotonic wiring; a comb at the target', () => {
  const B = tokens.graph.link.bundle;
  const doc = { ...wiring(), links: [0, 1, 2, 3].flatMap(i => [{ id: `m${i}`, from: `s${i + 1}`, to: 't2', kind: 'flow' as const }]) };
  const layout = layoutCanvas(doc, {}, catalog), made = bundleOperations(doc, layout, doc.links.map(l => l.id), 'bn') as { operations: CanvasOperation[] };
  const bundled = reduce(doc, made.operations, catalog), lanes = lanesOf(linkRoutes(bundled, layoutCanvas(bundled, {}, catalog)));
  assert.equal(lanes.length, 4);
  for (let i = 0; i < lanes.length; i++) for (let j = i + 1; j < lanes.length; j++) assert.equal(segmentsCross(lanes[i].points, lanes[j].points), false, `lane ${i} × lane ${j}`);
  assert.ok(closest(lanes) >= B.gap - .2, `lanes keep at least the trunk spacing apart (${closest(lanes)})`);
  // Every lane leaves its source square: the first stretch is straight along the side's normal.
  for (const { route, points } of lanes) { const a = points[0], b = points[4]; assert.ok(Math.abs(a.y - b.y) < .01 && b.x > a.x, `${route.key} leaves sideways`); }
  // The comb: four arrowheads on one side of t2, `comb` apart, each after a straight run of the same length.
  const ends = lanes.map(l => l.route.end), t2 = bundled.blocks.find(b => b.id === 't2')!;
  assert.ok(ends.every(e => e.x === layoutCanvas(bundled, {}, catalog).rects.get('t2')!.x), `all into the left side of ${t2.id}`);
  const ys = ends.map(e => e.y).sort((p, q) => p - q); ys.slice(1).forEach((y, i) => assert.ok(Math.abs(y - ys[i] - B.comb) < .01, 'teeth evenly spaced'));
  const finals = lanes.map(({ points }) => { let n = points.length - 1; while (n > 0 && Math.abs(points[n - 1].y - points[points.length - 1].y) < .01) n--; return points[points.length - 1].x - points[n].x; });
  finals.forEach(f => assert.ok(Math.abs(f - finals[0]) < 2.5 && f >= B.approach - .5, `same final run (${finals})`));
});

test('bends nest about one centre: radii grow by exactly the spacing', () => {
  const B = tokens.graph.link.bundle, doc = { ...wiring(), links: [{ id: 'a', from: 's1', to: 't4', kind: 'flow' as const }, { id: 'b', from: 's1', to: 't4', kind: 'depends' as const }, { id: 'c', from: 's1', to: 't4', kind: 'reference' as const }] };
  const layout = layoutCanvas(doc, {}, catalog), made = bundleOperations(doc, layout, ['a', 'b', 'c'], 'bn') as { operations: CanvasOperation[] }, bundled = reduce(doc, made.operations, catalog);
  const lanes = lanesOf(linkRoutes(bundled, layoutCanvas(bundled, {}, catalog)));
  // Where each lane turns from across back into the strand's axis, the centres of the turns coincide.
  const arcs = lanes.map(({ route }) => { const m = [...route.d.matchAll(/C([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+)/g)].map(x => x.slice(1).map(Number)); return m; });
  assert.ok(arcs.every(a => a.length >= 2), 'each lane has bends');
  assert.ok(closest(lanes) >= B.gap - .2);
});

test('a short bundle folds into one tie with straight parallel lanes; the clips land in the gap', () => {
  const B = tokens.graph.link.bundle, doc = documentSchema.parse({ ...wiring(), blocks: [card('up', 100, 100), card('down', 100, 330)], links: (['flow', 'depends', 'reference'] as const).map((kind, i) => ({ id: `k${i}`, from: 'up', to: 'down', kind })) });
  const layout = layoutCanvas(doc, {}, catalog), made = bundleOperations(doc, layout, ['k0', 'k1', 'k2'], 'bn') as { operations: CanvasOperation[] }, bundled = reduce(doc, made.operations, catalog);
  const l2 = layoutCanvas(bundled, {}, catalog), routes = linkRoutes(bundled, l2), [shape] = bundleShapes(bundled, l2, routes), up = l2.rects.get('up')!, down = l2.rects.get('down')!;
  assert.ok(shape.collapsed); assert.equal(shape.ties.length, 1); assert.equal(shape.ties[0].grip, null, 'the one tie drags the whole bundle');
  assert.ok(shape.ties[0].y > up.y + up.height && shape.ties[0].y < down.y, 'the tie sits in the gap, off both cards');
  const lanes = lanesOf(routes); for (const { points } of lanes) assert.ok(points.every(p => Math.abs(p.x - points[0].x) < .01), 'a straight vertical lane');
  const xs = lanes.map(l => l.points[0].x); xs.slice(1).forEach((x, i) => assert.ok(Math.abs(Math.abs(x - xs[i]) - B.comb) < .01, 'parallel, a comb apart'));
  assert.equal(shape.ties[0].length, 2 * B.comb + B.width + 2 * B.tie.pad);
  // Pulled apart, the same bundle opens into a trunk between two ties.
  const far = { ...bundled, blocks: bundled.blocks.map(b => b.id === 'down' ? { ...b, position: { x: 100, y: 900 } } : b), bundles: [{ id: 'bn', points: [{ x: 220, y: 400 }, { x: 220, y: 700 }] }] };
  const l3 = layoutCanvas(far, {}, catalog), [open] = bundleShapes(far, l3, linkRoutes(far, l3)); assert.ok(!open.collapsed); assert.equal(open.ties.length, 2);
});

test('clips dragged off the axis: a square step with nested bends, never a crossing; the frame names the axis', () => {
  const frame = strandFrame([{ x: 300, y: 200 }, { x: 600, y: 260 }], [{ x: 0, y: 150, width: 200, height: 100 }], [{ x: 900, y: 200, width: 200, height: 100 }], 4);
  assert.deepEqual(frame.e, { x: 1, y: 0 }); assert.ok(!frame.collapsed); assert.equal(frame.trunk.length, 4, 'a Z: out, across, on');
  assert.ok(frame.trunk.slice(1).every((q, i) => q.x === frame.trunk[i].x || q.y === frame.trunk[i].y), 'every trunk run is square');
  const doc = { ...wiring(), links: [0, 1, 2, 3].map(i => ({ id: `m${i}`, from: `s${i + 1}`, to: `t${i + 1}`, kind: 'flow' as const })) }, layout = layoutCanvas(doc, {}, catalog);
  const bundled = { ...doc, bundles: [{ id: 'bn', points: [{ x: 360, y: 230 }, { x: 600, y: 330 }] }], links: doc.links.map(l => ({ ...l, bundleId: 'bn' })) }, lanes = lanesOf(linkRoutes(bundled, layout));
  for (let i = 0; i < lanes.length; i++) for (let j = i + 1; j < lanes.length; j++) assert.equal(segmentsCross(lanes[i].points, lanes[j].points), false);
  assert.ok(closest(lanes) >= tokens.graph.link.bundle.gap - .2, `nested, never touching (${closest(lanes)})`);
});

test('ports pack into a comb: their own lines when they fit, neighbours moved together, squeezed when the side is short', () => {
  assert.deepEqual(packPorts([0, 7, 14], 7, -100, 100), [0, 7, 14]);
  assert.deepEqual(packPorts([0, 2], 7, -100, 100), [-2.5, 4.5], 'a collision moves both, centred');
  assert.deepEqual(packPorts([95, 102], 7, -100, 100), [93, 100], 'kept inside the side');
  assert.deepEqual(packPorts([0, 0, 0], 7, 0, 6), [0, 3, 6], 'squeezed evenly');
});

test('the bundling morph: both paths sampled alike, eased out, each lane a beat later', () => {
  const from = resamplePath('M0 0 L100 0', 5), to = resamplePath('M0 0 C0 50 100 50 100 100', 5);
  assert.equal(from.length, 5); assert.deepEqual(from[2], { x: 50, y: 0 }); assert.deepEqual(to[0], { x: 0, y: 0 }); assert.deepEqual(to[4], { x: 100, y: 100 });
  assert.equal(easeOutCubic(0), 0); assert.equal(easeOutCubic(1), 1); assert.ok(easeOutCubic(.5) > .5, 'quick to leave');
  assert.equal(morphFrame(from, to, 0, 0, 300).d, 'M0 0 L25 0 L50 0 L75 0 L100 0');
  const half = morphFrame(from, to, 150, 0, 300); assert.ok(half.end.y > 50 && half.end.y < 100 && !half.done);
  const late = morphFrame(from, to, 150, 150, 300); assert.equal(late.end.y, 0, 'a staggered lane has not left yet');
  const done = morphFrame(from, to, 300, 0, 300); assert.ok(done.done); assert.deepEqual(done.end, { x: 100, y: 100 });
});

test('clips land between the two sides, inside the gap; the bundle sits in the Frame that holds both ends', () => {
  const box = (x: number, y: number) => ({ x, y, width: 200, height: 80 });
  const [a, b] = bundlePlacement([box(0, 0), box(0, 200)], [box(900, 0), box(900, 200)]);
  assert.ok(a.x > 200 && b.x < 900 && a.x < b.x, 'inside the gap, in reading order'); assert.equal(a.y, 140); assert.equal(b.y, 140);
  const [c, d] = bundlePlacement([box(0, 0)], [box(0, 600)]); assert.ok(c.y > 80 && d.y < 600 && c.x === 100, 'vertical when the targets are below');
  const [e] = bundlePlacement([box(0, 0)], [box(60, 600)], 3); assert.ok(e.x >= 60 + 7 + 6 && e.x <= 200 - 7 - 6, 'lined up with the target so its lanes run straight');
  const base = wiring(), doc = { ...base, blocks: base.blocks.map(b => ({ ...b, parentGroupId: 'f' })), groups: [{ id: 'f', title: 'F', description: '', blockIds: base.blocks.map(b => b.id), groupIds: [], position: { x: 100, y: 50 }, layout: { mode: 'free' as const } }] };
  const layout = layoutCanvas(doc, {}, catalog), made = bundleOperations(doc, layout, ['l1', 'l2', 'l3'], 'bn');
  assert.ok(!('error' in made)); const op = made.operations[0] as Extract<CanvasOperation, { type: 'bundle.create' }>;
  assert.equal(op.bundle.parentGroupId, 'f'); const f = layout.rects.get('f')!;
  assert.ok(op.bundle.points[0].x + f.x > layout.rects.get('s1')!.x + layout.rects.get('s1')!.width, 'relative to the Frame, still between the sides');
  assert.ok(reduce(doc, made.operations, catalog).bundles![0].parentGroupId === 'f');
  assert.deepEqual(bundleOperations(doc, layout, ['l1']), { error: 'Pick at least two links to bundle.' });
});

test('a straight cut across the strand catches every link it crosses', () => {
  const doc = wiring(), layout = layoutCanvas(doc, {}, catalog), routes = linkRoutes(doc, layout);
  const middle = (layout.rects.get('s1')!.x + layout.rects.get('s1')!.width + layout.rects.get('t1')!.x) / 2;
  assert.deepEqual(crossedLinks(routes, { x: middle, y: -400 }, { x: middle, y: 1200 }).sort(), links.map(l => l.id).sort());
  assert.deepEqual(crossedLinks(routes, { x: -500, y: -400 }, { x: -500, y: 1200 }), []);
});

test('Alt-drag and ⌘D copies: a bundle copied whole comes along, moved with the copies; part of one leaves the copies loose', () => {
  const doc = reduce(wiring(), [bundle()], catalog), layout = layoutCanvas(doc, {}, catalog);
  let n = 0; const idFor = (kind: string) => `${kind}-${++n}`;
  const all = duplicateOperations(doc, layout.rects, doc.blocks.map(b => b.id), { x: 0, y: 700 }, { catalog, idFor })!, copied = reduce(doc, all.operations, catalog);
  assert.equal(copied.bundles!.length, 2); const copy = copied.bundles!.find(b => b.id !== 'bn')!;
  assert.deepEqual(copy.points, [{ x: 380, y: 960 }, { x: 560, y: 960 }]); assert.equal(copied.links.filter(l => l.bundleId === copy.id).length, 8);
  const part = duplicateOperations(doc, layout.rects, ['s1', 't1', 't2'], { x: 0, y: 700 }, { catalog, idFor })!, loose = reduce(doc, part.operations, catalog);
  assert.equal(loose.bundles!.length, 1); assert.equal(loose.links.length, 10); assert.ok(loose.links.filter(l => !links.some(o => o.id === l.id)).every(l => !l.bundleId));
  // Pasted into another Lienzo, the bundle arrives with fresh ids.
  const clip = copyClip(doc, layout.rects, doc.blocks.map(b => b.id))!, pasted = pasteOperations(clip, { catalog, idFor, offset: { x: 10, y: 0 }, place: placeAt(new Map(), { x: 10, y: 0 }, () => null) });
  const fresh = reduce({ ...wiring(), blocks: [], links: [] }, pasted.operations, catalog);
  assert.equal(fresh.bundles!.length, 1); assert.deepEqual(fresh.bundles![0].points[0], { x: 390, y: 260 });
});
