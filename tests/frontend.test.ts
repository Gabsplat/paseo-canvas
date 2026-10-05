import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { builtinPacks, builtinTypes, builtinTemplates } from '../plugin/shared/builtins';
import { mutateInputSchema, type CanvasCatalog, type CanvasDocument, type DiagramData } from '../plugin/shared/model';
import { CanvasService } from '../plugin/server/service';
import { CanvasStore } from '../plugin/server/store';
import { parsePack } from '../plugin/server/catalog';
import { reduce } from '../plugin/server/reducer';
import { connectionsOf, connectOperations, containerMode, descriptionKey, diagramLayout, documentContent, forkPack, hasCommunication, initialCamera, instructionLevels, layeredLayout, layoutCanvas, layoutDocument, linkFocus, linkRoutes, moveOperations, propertyValue, resolveOverlaps, safeUrl, selectionPack, topSelection, visibleEnd } from '../plugin/client/logic';
import { initialDocumentId, rememberOpenDocument } from '../plugin/client/session';
const catalog: CanvasCatalog = { revision: 0, blockTypes: builtinTypes, templates: builtinTemplates, packs: builtinPacks };
function document(): CanvasDocument {
  return { id: 'test', workspaceId: 'workspace', title: 'Test', description: '', example: false, revision: 0, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', communication: { intent: '', audience: '', instructions: 'Document instruction' }, selectedIds: [], blocks: [], groups: [], links: [] };
}
test('panel remount restores the last opened document only within its host and workspace and fresh document list', () => {
  const documents = [{ id: 'old-example' }, { id: 'live-demo' }];
  assert.equal(initialDocumentId('host-a', 'workspace-a', documents), 'old-example');
  rememberOpenDocument('host-a', 'workspace-a', 'live-demo');
  // A fresh panel reads the same session store despite receiving the old example first.
  assert.equal(initialDocumentId('host-a', 'workspace-a', [...documents]), 'live-demo');
  assert.equal(initialDocumentId('host-b', 'workspace-a', documents), 'old-example');
  assert.equal(initialDocumentId('host-a', 'workspace-b', documents), 'old-example');
  assert.equal(initialDocumentId('host-a', 'workspace-a', [{ id: 'old-example' }]), 'old-example');
  // A removed or inaccessible ID is forgotten, even if it later reappears.
  assert.equal(initialDocumentId('host-a', 'workspace-a', documents), 'old-example');
  rememberOpenDocument('host-a', 'workspace-a', 'live-demo');
  assert.equal(initialDocumentId('host-a', 'workspace-a', []), null);
  assert.equal(initialDocumentId('host-a', 'workspace-a', documents), 'old-example');
  rememberOpenDocument(undefined, 'workspace-a', 'live-demo');
  assert.equal(initialDocumentId(undefined, 'workspace-a', documents), 'old-example');
});
test('diagram layers draw an actual branch and stable progressive nodes/edges', () => {
  const one: DiagramData = { nodes: [{ id: 'wait', label: 'Cargando' }], edges: [] };
  const first = diagramLayout(one, 565); assert.equal(first.nodes[0].width, 136); assert.equal(first.nodes[0].height, 44);
  const branch: DiagramData = { nodes: [...one.nodes, { id: 'ready', label: 'Listo' }, { id: 'error', label: 'Error' }], edges: [{ id: 'ok', from: 'wait', to: 'ready', label: 'Correcta' }, { id: 'fail', from: 'wait', to: 'error' }] };
  const layout = diagramLayout(branch, 565);
  assert.equal(layout.nodes[0].y, 12); assert.equal(layout.nodes[1].y, 104); assert.equal(layout.nodes[1].y, layout.nodes[2].y);
  assert.ok(layout.nodes[1].x < layout.nodes[2].x); assert.equal(layout.edges.length, 2);
  assert.ok(layout.edges.every(e => e.segments.every(s => s.from.x === s.to.x || s.from.y === s.to.y)));
  const labels = layout.edges.map(edge => { const target = layout.nodes.find(n => n.id === edge.to)!; assert.equal(edge.labelPoint.x, target.x + target.width / 2); assert.equal(edge.labelPoint.y, 86); assert.equal(edge.labelWidth, 136); assert.equal(edge.segments.find(s => s.from.y === s.to.y)!.from.y, 72); return edge; });
  assert.ok(labels[0].labelPoint.x + labels[0].labelWidth / 2 < labels[1].labelPoint.x - labels[1].labelWidth / 2);
  assert.equal(diagramLayout({ ...branch, edges: branch.edges.map(({ label, ...edge }) => edge) }, 565).nodes[1].y, 96);
  assert.equal(diagramLayout(branch, 280).list, true);
  assert.equal(diagramLayout({ nodes: Array.from({ length: 31 }, (_, i) => ({ id: `n${i}`, label: String(i) })), edges: [] }, 565).list, true);
});
test('first-open camera preserves readable scale and top alignment independently of content height', () => {
  for (const viewportWidth of [320, 720, 1600]) {
    const content = { x: -120, y: 400, width: 900 }, camera = initialCamera(viewportWidth, content);
    assert.ok(camera.scale >= .8 && camera.scale <= 1);
    assert.equal(content.y * camera.scale + camera.offset.y, 48);
    if (content.width * camera.scale > viewportWidth - 96) assert.equal(content.x * camera.scale + camera.offset.x, 48);
    else assert.equal((content.x + content.width / 2) * camera.scale + camera.offset.x, viewportWidth / 2);
  }
  assert.equal(initialCamera(320, { x: 0, y: 0, width: 900 }).scale, .8);
  assert.equal(initialCamera(1600, { x: 0, y: 0, width: 900 }).scale, 1);
});
test('first-open wide document keeps the first root group visible at 80% without panning', () => {
  const doc = document();
  doc.groups = [{ id: 'first', title: 'First', description: '', blockIds: ['diagram'], groupIds: [], position: { x: 100, y: 240 } }, { id: 'next', title: 'Next', description: '', blockIds: [], groupIds: [], position: { x: 756, y: 240 } }];
  doc.blocks = [{ id: 'diagram', typeId: 'diagram', title: 'Flow', data: { nodes: [], edges: [] }, parentGroupId: 'first' }];
  const rects = layoutDocument(doc, { diagram: 400 }, catalog), roots = doc.groups.map(group => rects.get(group.id)!);
  const x = Math.min(...roots.map(r => r.x)), y = Math.min(...roots.map(r => r.y)), width = Math.max(...roots.map(r => r.x + r.width)) - x;
  const camera = initialCamera(640, { x, y, width }), first = rects.get('first')!;
  assert.equal(camera.scale, .8); assert.ok(width * camera.scale > 640 - 96);
  assert.equal(first.x * camera.scale + camera.offset.x, 48);
  assert.equal(first.y * camera.scale + camera.offset.y, 48);
  assert.ok((first.x + first.width) * camera.scale + camera.offset.x <= 640);
  // Exact-fit and roomy documents keep centring; the overflow branch is strict.
  for (const viewportWidth of [816, 1200]) {
    const content = { x: -120, y: 30, width: 900 }, fitted = initialCamera(viewportWidth, content);
    assert.equal((content.x + content.width / 2) * fitted.scale + fitted.offset.x, viewportWidth / 2);
    assert.equal(content.y * fitted.scale + fitted.offset.y, 48);
  }
});
test('diagram cycles and left rails stay inside the drawing, self loops are described only', () => {
  const data: DiagramData = { nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }, { id: 'c', label: 'C' }], edges: [{ id: 'ab', from: 'a', to: 'b' }, { id: 'bc', from: 'b', to: 'c' }, { id: 'ca', from: 'c', to: 'a' }, { id: 'self', from: 'b', to: 'b', label: 'Reintentar' }] };
  const layout = diagramLayout(data, 565); assert.equal(layout.edges.length, 3); assert.ok(layout.edges.find(e => e.id === 'ca')?.dashed);
  assert.ok(layout.edges.flatMap(e => e.segments).every(s => Math.min(s.from.x, s.to.x) >= 0));
  const explicit = diagramLayout({ ...data, nodes: data.nodes.map((n, i) => ({ ...n, position: { x: -300 + i * 180, y: 40 } })) }, 565);
  assert.ok(explicit.nodes.every(n => n.x >= 12 && n.y >= 12));
});
test('renderer widths, default stack, flow, grid spanning and root shelf follow approved geometry', () => {
  const doc = document(); doc.blocks = [{ id: 'a', typeId: 'note', title: '', data: { text: '' }, parentGroupId: 'g' }, { id: 'diagram', typeId: 'diagram', title: '', data: { nodes: [], edges: [] }, parentGroupId: 'g' }];
  doc.groups = [{ id: 'g', title: 'Group', description: '', blockIds: ['a', 'diagram'], groupIds: [] }];
  let layout = layoutDocument(doc, { a: 100, diagram: 200 }, catalog);
  assert.equal(layout.get('diagram')!.width, 592); assert.equal(layout.get('a')!.width, 592); assert.equal(layout.get('diagram')!.y - layout.get('a')!.y, 112);
  doc.groups[0].layout = { mode: 'flow' }; layout = layoutDocument(doc, { a: 100, diagram: 200 }, catalog);
  assert.equal(layout.get('diagram')!.y, layout.get('a')!.y); assert.equal(layout.get('diagram')!.x - layout.get('a')!.x, 316);
  doc.groups[0].layout = { mode: 'grid', columns: 2 }; layout = layoutDocument(doc, { a: 100, diagram: 200 }, catalog);
  assert.ok(layout.get('diagram')!.y > layout.get('a')!.y);
  doc.groups[0].collapsed = true; layout = layoutDocument(doc, {}, catalog); assert.equal(layout.get('g')!.height, 36); assert.equal(layout.get('a')!.hidden, true);
});
type Box = { x: number; y: number; width: number; height: number };
const intersects = (a: Box, b: Box) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
// Layout invariants that must hold for any document: visible siblings never intersect and frames enclose their children.
function assertTidy(doc: CanvasDocument, rects: ReturnType<typeof layoutDocument>) {
  const families = [[...doc.groups, ...doc.blocks].filter(e => !e.parentGroupId).map(e => e.id), ...doc.groups.filter(g => !g.collapsed).map(g => [...g.blockIds, ...g.groupIds])];
  for (const ids of families) for (const a of ids) for (const b of ids) if (a < b) assert.ok(!intersects(rects.get(a)!, rects.get(b)!), `${a} overlaps ${b}`);
  for (const g of doc.groups.filter(g => !g.collapsed)) for (const id of [...g.blockIds, ...g.groupIds]) {
    const frame = rects.get(g.id)!, child = rects.get(id)!;
    assert.ok(child.x >= frame.x && child.y >= frame.y + 32 && child.x + child.width <= frame.x + frame.width && child.y + child.height <= frame.y + frame.height, `${id} escapes ${g.id}`);
  }
}
test('root groups positioned for narrower content are pushed apart once real sizes are known', () => {
  // Shape of the reported document: three stack groups stored 460 apart, the middle one holding a wide diagram.
  const doc = document();
  doc.groups = [
    { id: 'g-ui', title: '1', description: 'x', blockIds: ['n1', 'n2'], groupIds: [], position: { x: 0, y: 0 }, layout: { mode: 'stack', gap: 16 } },
    { id: 'g-ciclo', title: '2', description: 'x', blockIds: ['diagram', 'n3'], groupIds: [], position: { x: 460, y: 0 }, layout: { mode: 'stack', gap: 16 } },
    { id: 'g-probar', title: '3', description: 'x', blockIds: ['list', 'ask'], groupIds: [], position: { x: 920, y: 0 }, layout: { mode: 'stack', gap: 16 } },
  ];
  const child = (id: string, typeId: string, parentGroupId: string) => ({ id, typeId, title: id, data: {}, parentGroupId });
  doc.blocks = [child('n1', 'note', 'g-ui'), child('n2', 'note', 'g-ui'), child('diagram', 'diagram', 'g-ciclo'), child('n3', 'note', 'g-ciclo'), child('list', 'checklist', 'g-probar'), child('ask', 'choice', 'g-probar'),
    { id: 'above', typeId: 'note', title: 'above', data: {}, position: { x: 0, y: -220 } }, { id: 'far', typeId: 'diagram', title: 'far', data: {}, position: { x: 1380, y: 0 } }];
  const heights = { n1: 120, n2: 140, diagram: 470, n3: 110, list: 190, ask: 270, above: 150, far: 400, [descriptionKey('g-ciclo')]: 34 };
  const rects = layoutDocument(doc, heights, catalog); assertTidy(doc, rects);
  const ui = rects.get('g-ui')!, ciclo = rects.get('g-ciclo')!, probar = rects.get('g-probar')!, far = rects.get('far')!;
  // Whatever did not collide keeps its stored place; the row stays a row.
  assert.deepEqual([ui.x, ui.y, ciclo.x, ciclo.y, rects.get('above')!.y], [0, 0, 460, 0, -220]);
  assert.equal(ciclo.width, 624); assert.equal(probar.y, 0); assert.equal(probar.x, 1120); /* 460 + 624 + 32, snapped up to the 8 px grid */
  assert.equal(far.y, 0); assert.equal(far.x, probar.x + probar.width + 32); assert.equal(far.x % 8, 0);
  // Children travel with their frame.
  assert.equal(rects.get('list')!.x, probar.x + 16); assert.ok(rects.get('ask')!.y > rects.get('list')!.y + 190);
  // Sizes are the only input: before measuring (default heights) and after a block grows, the invariants still hold.
  assertTidy(doc, layoutDocument(doc, {}, catalog)); assertTidy(doc, layoutDocument(doc, { ...heights, n2: 900, above: 400 }, catalog));
  // Nothing is written back to the document.
  assert.deepEqual(doc.groups.map(g => g.position), [{ x: 0, y: 0 }, { x: 460, y: 0 }, { x: 920, y: 0 }]);
});
test('overlap resolution leaves separated siblings alone and takes the shorter way out', () => {
  const apart = [{ x: 0, y: 0, width: 100, height: 100 }, { x: 100, y: 0, width: 100, height: 100 }, { x: 0, y: 100, width: 100, height: 100 }];
  const before = JSON.stringify(apart); resolveOverlaps(apart, 32); assert.equal(JSON.stringify(apart), before);
  const column = [{ x: 0, y: 0, width: 288, height: 300 }, { x: 0, y: 200, width: 288, height: 100 }, { x: 0, y: 320, width: 288, height: 100 }];
  resolveOverlaps(column, 16); assert.deepEqual(column.map(b => [b.x, b.y]), [[0, 0], [0, 320], [0, 440]]);
  const same = Array.from({ length: 12 }, () => ({ x: 40, y: 40, width: 120, height: 80 }));
  resolveOverlaps(same, 8); for (const a of same) for (const b of same) if (a !== b) assert.ok(!intersects(a, b));
});
test('free groups keep positioned children inside the frame, apart from each other and above the unpositioned ones', () => {
  const doc = document();
  doc.groups = [{ id: 'g', title: 'Free', description: 'Two lines of description at most', blockIds: ['a', 'b', 'c', 'loose'], groupIds: ['inner'], layout: { mode: 'free' }, position: { x: 0, y: 0 } },
    { id: 'inner', title: 'Inner', description: '', blockIds: ['d'], groupIds: [], parentGroupId: 'g', position: { x: 16, y: 60 } }];
  const at = (id: string, x: number, y: number) => ({ id, typeId: 'note', title: id, data: {}, parentGroupId: 'g', position: { x, y } });
  doc.blocks = [at('a', 16, 100), at('b', 40, 150), at('c', -80, -40), { id: 'loose', typeId: 'note', title: 'loose', data: {}, parentGroupId: 'g' }, { id: 'd', typeId: 'diagram', title: 'd', data: {}, parentGroupId: 'inner' }];
  const rects = layoutDocument(doc, { a: 200, b: 120, c: 90, loose: 80, d: 300 }, catalog); assertTidy(doc, rects);
  // A child stored over the header or outside the left edge is brought back under the description.
  assert.equal(rects.get('c')!.x, 16); assert.ok(rects.get('c')!.y >= 36 + 16 + 34 + 12);
  assert.ok(rects.get('loose')!.y >= Math.max(...['a', 'b', 'c', 'inner'].map(id => rects.get(id)!.y + rects.get(id)!.height)));
  // A measured one-line description tightens the frame; an empty group reserves its dashed drop area inside the frame.
  doc.groups[0] = { ...doc.groups[0], blockIds: [], groupIds: [] }; doc.groups.pop(); doc.blocks = [];
  assert.equal(layoutDocument(doc, { [descriptionKey('g')]: 17 }, catalog).get('g')!.height, Math.ceil((36 + 16 + 17 + 12 + 56 + 16) / 8) * 8);
});
test('dropping into an automatic or absent layout preserves layout and omits coordinates', () => {
  const doc = document(); doc.blocks = [{ id: 'loose', typeId: 'note', title: 'Loose', data: { text: '' }, position: { x: 600, y: 0 } }]; doc.groups = [{ id: 'g', title: 'Group', description: '', blockIds: [], groupIds: [] }];
  const operations = moveOperations(doc, layoutDocument(doc, {}, catalog), ['loose'], { x: -500, y: 0 }, 'g');
  assert.deepEqual(operations, [{ type: 'group.update', id: 'g', patch: { layout: { mode: 'stack' } } }, { type: 'entity.move', id: 'loose', parentGroupId: 'g' }]);
  const next = reduce(doc, operations, catalog); assert.equal(next.groups[0].layout?.mode, 'stack'); assert.equal(next.blocks[0].parentGroupId, 'g');
  next.groups[0].layout = { mode: 'stack' };
  assert.deepEqual(moveOperations(next, layoutDocument(next, {}, catalog), ['loose'], { x: 8, y: 8 }), []);
});
test('group rename and collapse through the real RPC parser preserve description and nested membership', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'canvas-frontend-')); const store = new CanvasStore(dir), service = new CanvasService(store);
  try {
    const doc = document(); doc.groups = [{ id: 'parent', title: 'Parent', description: 'Keep description', blockIds: [], groupIds: ['child'] }, { id: 'child', title: 'Child', description: 'Nested purpose', blockIds: [], groupIds: [], parentGroupId: 'parent' }];
    let view = await service.create({ workspaceId: doc.workspaceId, content: doc });
    for (const patch of [{ title: 'Renamed' }, { collapsed: true }, { collapsed: false }, { layout: { mode: 'grid' as const, columns: 2 } }]) {
      const input = mutateInputSchema.parse({ documentId: view.document.id, workspaceId: doc.workspaceId, expectedRevision: view.document.revision, label: 'Frontend edit', operations: [{ type: 'group.update', id: 'parent', patch }] });
      assert.equal(Object.hasOwn(input.operations[0].type === 'group.update' ? input.operations[0].patch : {}, 'groupIds'), false);
      view = await service.mutate(input); const parent = view.document.groups.find(g => g.id === 'parent')!, child = view.document.groups.find(g => g.id === 'child')!;
      assert.equal(parent.description, 'Keep description'); assert.deepEqual(parent.groupIds, ['child']); assert.equal(child.parentGroupId, 'parent');
    }
    await service.undo({ documentId: view.document.id, workspaceId: doc.workspaceId, expectedRevision: view.document.revision });
    assert.equal((await service.read({ documentId: view.document.id, workspaceId: doc.workspaceId })).document.groups.find(g => g.id === 'child')!.parentGroupId, 'parent');
  } finally { await store.close(); await rm(dir, { recursive: true, force: true }); }
});
test('ancestor selection produces one delete operation and selection exports retain complete subtrees', () => {
  const doc = document(); doc.blocks = [{ id: 'a', typeId: 'note', title: 'Note', data: { text: 'Text' }, parentGroupId: 'g' }]; doc.groups = [{ id: 'g', title: 'Group', description: '', blockIds: ['a'], groupIds: [] }];
  assert.deepEqual(topSelection(doc, ['g', 'a']).map(e => e.id), ['g']);
  const pack = selectionPack(doc, catalog, ['g']); const valid = parsePack(pack, catalog);
  assert.equal(valid.documents[0].blocks[0].parentGroupId, 'g'); assert.ok(valid.blockTypes.every(t => t.id.startsWith(`${valid.id}.`)));
});
test('clearing communication removes its effective level without changing group membership or ancestors', () => {
  const doc = document(), communication = { intent: 'Review', audience: 'Team', instructions: 'Keep concise' };
  doc.groups = [{ id: 'g', title: 'Group', description: 'Purpose', blockIds: ['a'], groupIds: [], communication }];
  doc.blocks = [{ id: 'a', typeId: 'note', title: 'Note', data: { text: '' }, parentGroupId: 'g', communication }];
  assert.deepEqual(instructionLevels(doc, doc.blocks[0]).map(level => level.id), ['a', 'g', doc.id]);
  const empty = { intent: '', audience: '', instructions: '' };
  const next = reduce(doc, [{ type: 'group.update', id: 'g', patch: { communication: empty } }, { type: 'block.update', id: 'a', patch: { communication: empty } }], catalog);
  assert.deepEqual(instructionLevels(next, next.blocks[0]).map(level => level.id), [doc.id]);
  assert.equal(next.groups[0].description, 'Purpose'); assert.deepEqual(next.groups[0].blockIds, ['a']); assert.equal(next.blocks[0].parentGroupId, 'g');
  assert.equal(hasCommunication({ intent: '  ', audience: '\n', instructions: '\t' }), false);
  assert.equal(hasCommunication({ ...empty, audience: 'Team' }), true);
});
test('shipped example export forks into an importable portable namespace', () => {
  for (const pack of builtinPacks) { const fork = forkPack(pack, `copy-${pack.id}`); const parsed = parsePack(JSON.parse(JSON.stringify(fork)), catalog); assert.equal(parsed.id, `copy-${pack.id}`); assert.ok(parsed.templates.every(t => t.id.startsWith(`${parsed.id}.`))); assert.equal(parsed.documents[0].example, true); }
});
test('form properties are typed and URL previews reject executable schemes and credentials', () => {
  assert.equal(propertyValue('boolean', false), false); assert.equal(propertyValue('boolean', 'true'), true); assert.throws(() => propertyValue('boolean', 'yes'));
  assert.equal(propertyValue('number', '23'), 23); assert.throws(() => propertyValue('number', '')); assert.throws(() => propertyValue('json', '{broken'));
  assert.deepEqual(propertyValue('json', '[{"label":"One","done":false}]'), [{ label: 'One', done: false }]);
  assert.equal(safeUrl('https://example.com/app'), 'https://example.com/app'); assert.equal(safeUrl('http://localhost:5173'), 'http://localhost:5173/');
  for (const url of ['javascript:alert(1)', 'data:text/html,hello', 'file:///etc/passwd', 'https://user:pass@example.com', '<html>']) assert.equal(safeUrl(url), null);
});

// ---- Graph canvas (architecture §13) ----
const node = (id: string, parentGroupId?: string, position?: { x: number; y: number }) => ({ id, typeId: 'node', title: id, data: {}, ...(parentGroupId ? { parentGroupId } : {}), ...(position ? { position } : {}) });
const link = (from: string, to: string, extra: Partial<CanvasDocument['links'][number]> = {}) => ({ id: `${from}-${to}${extra.kind ? `-${extra.kind}` : ''}`, from, to, kind: 'flow' as const, ...extra });
function graphDocument(): CanvasDocument {
  // The shape of the reference picture: a region of modules joined by links, with two loose notes.
  const doc = document(), ids = ['inspect', 'host', 'session', 'profiles', 'binding', 'recovery', 'convex', 'custody', 'clerk'];
  doc.groups = [{ id: 'inside', title: 'Inside Account session', description: '', blockIds: [...ids, 'loose1', 'loose2'], groupIds: [] }];
  doc.blocks = [...ids.map(id => node(id, 'inside')), { id: 'loose1', typeId: 'note', title: 'loose1', data: { text: '' }, parentGroupId: 'inside' }, { id: 'loose2', typeId: 'note', title: 'loose2', data: { text: '' }, parentGroupId: 'inside' }];
  doc.links = [link('inspect', 'host'), link('host', 'session'), link('host', 'profiles'), link('session', 'convex'), link('session', 'custody'), link('session', 'custody', { kind: 'depends' }), link('session', 'custody', { kind: 'reference' }), link('binding', 'custody'), link('session', 'clerk'), link('recovery', 'clerk'), link('inspect', 'convex')];
  return doc;
}
test('a container with links between its children becomes a layered graph: tidy, ordered by flow, deterministic', () => {
  const doc = graphDocument(); assert.equal(containerMode(doc, 'inside'), 'graph'); assert.equal(containerMode(doc, null), 'free');
  const rects = layoutDocument(doc, {}, catalog); assertTidy(doc, rects);
  // Node cards are compact and every link points down a layer.
  assert.equal(rects.get('host')!.width, 224);
  for (const l of doc.links) assert.ok(rects.get(l.to)!.y >= rects.get(l.from)!.y + rects.get(l.from)!.height + 40, `${l.from} is not above ${l.to}`);
  // Two dimensions, not a column: some layer holds several nodes side by side.
  assert.ok(new Set(doc.blocks.map(b => rects.get(b.id)!.y)).size < doc.blocks.length - 3);
  // Siblings without links are packed in a row under the graph.
  const bottom = Math.max(...doc.links.flatMap(l => [l.from, l.to]).map(id => rects.get(id)!.y + rects.get(id)!.height));
  assert.ok(rects.get('loose1')!.y >= bottom); assert.equal(rects.get('loose1')!.y, rects.get('loose2')!.y); assert.ok(rects.get('loose2')!.x > rects.get('loose1')!.x);
  assert.deepEqual([...layoutDocument(doc, {}, catalog)], [...rects]);
  assert.deepEqual([...layoutDocument(JSON.parse(JSON.stringify(doc)), {}, catalog)], [...rects]);
  // Real measured sizes keep the invariants; direction "right" turns layers into columns.
  assertTidy(doc, layoutDocument(doc, { host: 140, session: 64, custody: 200, loose1: 300 }, catalog));
  doc.groups[0].layout = { mode: 'graph', direction: 'right' };
  const sideways = layoutDocument(doc, {}, catalog); assertTidy(doc, sideways);
  for (const l of doc.links) assert.ok(sideways.get(l.to)!.x >= sideways.get(l.from)!.x + 224 + 40);
});
test('graph layout survives cycles, self references, duplicates and large inputs without hanging', () => {
  const sized = (id: string) => ({ id, width: 224, height: 80 }), options = { nodeGap: 32, layerGap: 80 };
  const cyc = layeredLayout(['a', 'b', 'c'].map(sized), [{ from: 'a', to: 'b' }, { from: 'b', to: 'c' }, { from: 'c', to: 'a' }, { from: 'b', to: 'b' }, { from: 'a', to: 'b' }, { from: 'b', to: 'a' }, { from: 'a', to: 'ghost' }], options);
  assert.deepEqual(['a', 'b', 'c'].map(id => cyc.layers.get(id)), [0, 1, 2]);
  // A long edge reserves a lane beside the node it skips; the reverse edge shares it backwards.
  assert.equal(cyc.lanes.has('c>a'), true); const lane = cyc.lanes.get('c>a')!, b = cyc.points.get('b')!;
  assert.ok(lane.every(p => p.x < b.x || p.x > b.x + 224)); assert.ok(lane[0].y > lane.at(-1)!.y);
  const ids = Array.from({ length: 300 }, (_, i) => `n${i}`), edges = ids.flatMap((id, i) => [{ from: id, to: ids[(i * 7 + 3) % 300] }, { from: id, to: ids[(i + 1) % 300] }]);
  const started = Date.now(), big = layeredLayout(ids.map(sized), edges, options); assert.ok(Date.now() - started < 4000); assert.equal(big.points.size, 300);
  const boxes = ids.map(id => ({ ...big.points.get(id)!, width: 224, height: 80 }));
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) assert.ok(!intersects(boxes[i], boxes[j]));
  // Crossing reduction: two parents with swapped children end up untangled.
  const crossed = layeredLayout(['p', 'q', 'x', 'y'].map(sized), [{ from: 'p', to: 'y' }, { from: 'q', to: 'x' }], options);
  assert.equal(crossed.points.get('p')!.x < crossed.points.get('q')!.x, crossed.points.get('y')!.x < crossed.points.get('x')!.x);
  assert.deepEqual(layeredLayout([], [], options).width, 0);
});
test('explicit positions win inside a graph, are separated afterwards, and dragging in a graph stores a position', () => {
  const doc = graphDocument(); doc.blocks = doc.blocks.map(b => b.id === 'custody' ? { ...b, position: { x: 700, y: 60 } } : b.id === 'clerk' ? { ...b, position: { x: 720, y: 80 } } : b);
  const rects = layoutDocument(doc, {}, catalog), frame = rects.get('inside')!; assertTidy(doc, rects);
  assert.deepEqual([rects.get('custody')!.x - frame.x, rects.get('custody')!.y - frame.y], [700, 60]);
  const operations = moveOperations(doc, rects, ['host'], { x: 40, y: 24 });
  assert.equal(operations.length, 1); assert.equal(operations[0].type, 'entity.move'); assert.ok(operations[0].type === 'entity.move' && operations[0].position);
  const moved = reduce(doc, operations, catalog), after = layoutDocument(moved, {}, catalog); assertTidy(moved, after);
  assert.equal(after.get('host')!.x - after.get('inside')!.x, moved.blocks.find(b => b.id === 'host')!.position!.x);
  // A stack group still ignores drags.
  moved.groups[0].layout = { mode: 'stack' }; assert.deepEqual(moveOperations(moved, after, ['session'], { x: 8, y: 8 }), []);
});
test('documents without links wrap into rows instead of one endless column, at the root and inside a group of groups', () => {
  const doc = document();
  doc.groups = Array.from({ length: 7 }, (_, i) => ({ id: `g${i}`, title: `G${i}`, description: '', blockIds: [`b${i}`], groupIds: [] as string[] }));
  doc.blocks = doc.groups.map((g, i) => ({ id: `b${i}`, typeId: i === 2 ? 'diagram' : 'note', title: '', data: {}, parentGroupId: g.id }));
  for (const viewport of [undefined, 700, 1280, 2200]) {
    const rects = layoutDocument(doc, {}, catalog, viewport); assertTidy(doc, rects);
    const rows = new Set(doc.groups.map(g => rects.get(g.id)!.y)); assert.ok(rows.size > 1 && rows.size < 7, `viewport ${viewport}: ${rows.size} rows`);
    assert.ok(rects.get('g1')!.x > rects.get('g0')!.x); assert.equal(rects.get('g1')!.y, rects.get('g0')!.y);
  }
  assert.ok(new Set(doc.groups.map(g => layoutDocument(doc, {}, catalog, 2200).get(g.id)!.y)).size <= new Set(doc.groups.map(g => layoutDocument(doc, {}, catalog, 700).get(g.id)!.y)).size);
  // The reported "chorizo": one outer group holding section groups and no layout. Sections now sit side by side.
  const outer = document(); outer.groups = [{ id: 'all', title: 'All', description: '', blockIds: [], groupIds: doc.groups.map(g => g.id) }, ...doc.groups.map(g => ({ ...g, parentGroupId: 'all' }))]; outer.blocks = doc.blocks;
  assert.equal(containerMode(outer, 'all'), 'rows'); const nested = layoutDocument(outer, {}, catalog); assertTidy(outer, nested);
  assert.equal(nested.get('g1')!.y, nested.get('g0')!.y); assert.ok(new Set(doc.groups.map(g => nested.get(g.id)!.y)).size > 1);
  // An explicit stack is still honoured.
  outer.groups[0].layout = { mode: 'stack' }; const stacked = layoutDocument(outer, {}, catalog); assert.equal(new Set(doc.groups.map(g => stacked.get(g.id)!.x)).size, 1);
});
test('connectors attach to frame sides, bundle parallel links, cross groups and follow collapsed groups', () => {
  const doc = graphDocument(), layout = layoutCanvas(doc, {}, catalog), routes = linkRoutes(doc, layout), rects = layout.rects;
  assert.equal(routes.length, doc.links.length - 2);
  const bundle = routes.find(r => r.key === 'session>custody')!; assert.equal(bundle.count, 3); assert.deepEqual(bundle.links.map(l => l.kind), ['flow', 'depends', 'reference']);
  for (const r of routes) {
    const a = rects.get(r.from)!, b = rects.get(r.to)!;
    assert.equal(r.start.y, a.y + a.height); assert.ok(r.start.x > a.x && r.start.x < a.x + a.width);
    assert.equal(r.end.y, b.y); assert.equal(r.endSide, 'top'); assert.ok(r.end.x > b.x && r.end.x < b.x + b.width);
    assert.match(r.d, /^M[-\d.]+ [-\d.]+( C[-\d. ]+)+$/); assert.ok(r.elbow.every(s => s.from.x === s.to.x || s.from.y === s.to.y));
  }
  // Links arriving on the same side get their own port, in the order they come from.
  const into = routes.filter(r => r.to === 'custody').sort((p, q) => p.end.x - q.end.x); assert.equal(new Set(into.map(r => r.end.x)).size, into.length);
  assert.ok(rects.get(into[0].from)!.x <= rects.get(into.at(-1)!.from)!.x);
  // The edge that skips a layer goes around the cards in between.
  const long = routes.find(r => r.key === 'inspect>convex')!; assert.ok(long.d.split(' C').length > 2);
  // Hover/selection focus: the node, its links and its neighbours stay lit; the rest dims.
  const focus = linkFocus(routes, ['custody'])!; assert.deepEqual([...focus.lit].sort(), ['binding', 'custody', 'session']); assert.equal(focus.routes.size, 2);
  assert.equal(linkFocus(routes, ['loose1']), null); assert.deepEqual([...linkFocus(routes, [], 'recovery-clerk')!.lit].sort(), ['clerk', 'recovery']);
  // Dragging moves the attached ends with the card.
  const dragged = linkRoutes(doc, layout, id => id === 'custody' ? { x: 50, y: 30 } : undefined).find(r => r.key === 'binding>custody')!;
  assert.equal(dragged.end.y, rects.get('custody')!.y + 30);
  // Cross-group: the root becomes a graph of regions and the link joins the two cards.
  const outside = { id: 'runtime', typeId: 'node', title: 'Runtime', data: {}, parentGroupId: 'out' };
  doc.blocks.push(outside); doc.groups.push({ id: 'out', title: 'Outside', description: '', blockIds: ['runtime'], groupIds: [] }); doc.links.push(link('clerk', 'runtime'));
  assert.equal(containerMode(doc, null), 'graph');
  let next = layoutCanvas(doc, {}, catalog); assertTidy(doc, next.rects); assert.ok(next.rects.get('out')!.y >= next.rects.get('inside')!.y + next.rects.get('inside')!.height);
  assert.equal(linkRoutes(doc, next).find(r => r.key === 'clerk>runtime')!.end.y, next.rects.get('runtime')!.y);
  // Collapsed: the link attaches to the group frame; links wholly inside it are not drawn.
  doc.groups[0].collapsed = true; next = layoutCanvas(doc, {}, catalog);
  assert.equal(visibleEnd(next.index, 'clerk'), 'inside'); const folded = linkRoutes(doc, next); assert.deepEqual(folded.map(r => r.key), ['inside>runtime']);
  assert.equal(folded[0].start.y, next.rects.get('inside')!.y + next.rects.get('inside')!.height);
});
test('link edits are real transactions and links travel with copies, exports and the outline', () => {
  const doc = graphDocument();
  const created = connectOperations(doc, 'profiles', 'clerk'); assert.equal(created.operations.length, 1); assert.equal(mutateInputSchema.safeParse({ documentId: 'test', workspaceId: 'workspace', expectedRevision: 0, operations: created.operations }).success, true);
  const next = reduce(doc, created.operations, catalog); assert.equal(next.links.at(-1)!.id, created.id);
  assert.equal(connectOperations(next, 'profiles', 'clerk').existing?.id, created.id); assert.deepEqual(connectOperations(next, 'clerk', 'clerk').operations, []);
  assert.equal(connectOperations(next, 'clerk', 'profiles').operations.length, 1);
  const relabelled = reduce(next, [{ type: 'link.update', id: created.id!, patch: { label: 'inicia sesión', kind: 'depends', tone: 'peligro' } }], catalog).links.at(-1)!;
  assert.deepEqual([relabelled.label, relabelled.kind, relabelled.tone, relabelled.from], ['inicia sesión', 'depends', 'peligro', 'profiles']);
  assert.equal(reduce(next, [{ type: 'link.delete', id: created.id! }], catalog).links.length, doc.links.length);
  assert.deepEqual(connectionsOf(doc, 'custody').map(c => [c.outgoing, c.otherId, c.link.kind]), [[false, 'session', 'flow'], [false, 'session', 'depends'], [false, 'session', 'reference'], [false, 'binding', 'flow']]);
  assert.equal(documentContent(doc, true).links.length, doc.links.length);
  const pack = selectionPack(doc, catalog, ['session', 'custody', 'host']); assert.deepEqual(pack.documents[0].links.map(l => l.id).sort(), ['host-session', 'session-custody', 'session-custody-depends', 'session-custody-reference']);
  assert.equal(parsePack(pack, catalog).documents[0].links.length, 4);
});
test('shipped example documents lay out tidily with their links', () => {
  for (const pack of builtinPacks) for (const content of pack.documents) {
    const doc = { ...document(), ...JSON.parse(JSON.stringify(content)) } as CanvasDocument, layout = layoutCanvas(doc, {}, catalog, 1280); assertTidy(doc, layout.rects);
    const routes = linkRoutes(doc, layout); assert.ok(routes.reduce((sum, r) => sum + r.count, 0) <= doc.links.length);
    for (const r of routes) assert.ok(Number.isFinite(r.labelPoint.x + r.labelPoint.y + r.badgePoint.x + r.end.x));
  }
});
