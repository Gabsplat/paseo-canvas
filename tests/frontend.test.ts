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
import { diagramLayout, forkPack, hasCommunication, initialCamera, instructionLevels, layoutDocument, moveOperations, propertyValue, safeUrl, selectionPack, topSelection } from '../plugin/client/logic';
import { initialDocumentId, rememberOpenDocument } from '../plugin/client/session';
const catalog: CanvasCatalog = { revision: 0, blockTypes: builtinTypes, templates: builtinTemplates, packs: builtinPacks };
function document(): CanvasDocument {
  return { id: 'test', workspaceId: 'workspace', title: 'Test', description: '', example: false, revision: 0, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', communication: { intent: '', audience: '', instructions: 'Document instruction' }, selectedIds: [], blocks: [], groups: [] };
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
