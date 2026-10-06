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
import { alignmentGuides, connectionsOf, connectOperations, containerMode, descriptionKey, diagramLayout, documentContent, dropTarget, edgePan, fitCamera, forkPack, freezeOperations, groupOperations, hasCommunication, initialCamera, instructionLevels, layeredLayout, layoutCanvas, layoutDocument, linkFocus, linkRoutes, moveOperations, pinnedChildren, propertyValue, releaseOperations, resolveOverlaps, reuseDocumentEntities, safeUrl, selectionPack, topSelection, travellers, visibleEnd, zoomAround } from '../plugin/client/logic';
import { initialDocumentId, rememberOpenDocument } from '../plugin/client/session';
import { linkMagnet, minimumBlockSize, resizeBlockSize } from '../plugin/client/logic';
import { frameSandbox, mediaSource } from '../plugin/client/media';
const catalog: CanvasCatalog = { revision: 0, blockTypes: builtinTypes, templates: builtinTemplates, packs: builtinPacks };
test('media URLs resolve to safe players, preserve timestamps and Vimeo privacy hashes, and do not enable autoplay', () => {
  for (const url of ['https://youtube.com/watch?v=M7lc1UVf-VE&t=1m12s&autoplay=1', 'https://youtu.be/M7lc1UVf-VE?t=72', 'https://www.youtube.com/shorts/M7lc1UVf-VE?start=72', 'https://www.youtube-nocookie.com/embed/M7lc1UVf-VE?start=72']) {
    const media = mediaSource(url)!; assert.equal(media.provider, 'YouTube');
    const embed = new URL(media.embed!); assert.equal(embed.origin, 'https://www.youtube-nocookie.com'); assert.equal(embed.pathname, '/embed/M7lc1UVf-VE'); assert.equal(embed.searchParams.get('start'), '72'); assert.equal(embed.searchParams.has('autoplay'), false);
  }
  const publicVideo = mediaSource('https://vimeo.com/76979871')!; assert.equal(publicVideo.provider, 'Vimeo');
  assert.equal(new URL(mediaSource('https://vimeo.com/album/123/video/76979871')!.embed!).pathname, '/video/76979871');
  assert.equal(new URL(mediaSource('https://vimeo.com/76979871/1234567890')!.embed!).searchParams.get('h'), '1234567890');
  for (const url of ['https://vimeo.com/76979871/abc123def0', 'https://player.vimeo.com/video/76979871?h=abc123def0&autoplay=1']) {
    const media = mediaSource(url)!; assert.equal(new URL(media.embed!).searchParams.get('h'), 'abc123def0'); assert.equal(new URL(media.embed!).searchParams.has('autoplay'), false);
  }
  assert.equal(mediaSource('https://files.test/clip.MP4?token=example')?.kind, 'video');
  assert.equal(mediaSource('https://files.test/photo.webp')?.kind, 'image'); assert.equal(mediaSource('https://files.test/sound.mp3')?.kind, 'audio');
  assert.equal(mediaSource('https://files.test/asset', 'video')?.kind, 'video');
  assert.equal(mediaSource('https://youtube.com.evil.test/watch?v=M7lc1UVf-VE')?.embed, undefined);
  assert.equal(mediaSource('https://youtube.com/watch?v=invalid')?.kind, 'reference');
  for (const url of ['javascript:alert(1)', 'file:///home/private', 'data:text/html,<script>', 'https://person:secret@files.test/a.mp4']) assert.equal(mediaSource(url), null);
  assert.equal(frameSandbox('http://127.0.0.1:8765/fixture', 'http://127.0.0.1:8765').includes('allow-same-origin'), false);
  assert.equal(frameSandbox('https://example.test/app', 'http://127.0.0.1:8765').includes('allow-same-origin'), true);
});
test('resize bounds, grid and proportions produce valid size updates without touching block data', () => {
  const doc = document(); doc.blocks = [{ id: 'list', typeId: 'checklist', title: 'Lista', data: { items: ['Uno'] }, position: { x: 96, y: 32 } }];
  const min = minimumBlockSize(doc.blocks[0], catalog), size = resizeBlockSize({ width: 288, height: 176 }, { x: 99, y: -500 }, min, false, true);
  assert.deepEqual(size, { width: 384, height: 144 });
  const input = mutateInputSchema.parse({ workspaceId: doc.workspaceId, documentId: doc.id, expectedRevision: 0, operations: [{ type: 'block.update', id: 'list', patch: { size } }] });
  const next = reduce(doc, input.operations, catalog); assert.deepEqual(next.blocks[0].data, doc.blocks[0].data); assert.deepEqual(next.blocks[0].position, doc.blocks[0].position); assert.deepEqual(next.blocks[0].size, size);
  const rect = layoutDocument(next, { list: 999 }, catalog).get('list')!; assert.equal(rect.width, 384); assert.equal(rect.height, 144);
  const ratio = resizeBlockSize({ width: 320, height: 160 }, { x: 100, y: 4 }, { width: 160, height: 104 }, true); assert.equal(ratio.width, 420); assert.equal(ratio.height, 210);
  const huge = resizeBlockSize({ width: 160, height: 4096 }, { x: 4096, y: 0 }, min, true); assert.ok(huge.width <= 4096 && huge.height <= 4096);
  for (const invalid of [{ width: 159, height: 104 }, { width: 160, height: 103 }, { width: 5000, height: 200 }, { width: Infinity, height: 200 }, { width: 200, height: 200, html: 'ignored?' }]) assert.equal(mutateInputSchema.safeParse({ workspaceId: doc.workspaceId, documentId: doc.id, expectedRevision: 0, operations: [{ type: 'block.update', id: 'list', patch: { size: invalid } }] }).success, false);
  const automatic = reduce(next, [{ type: 'block.update', id: 'list', patch: { size: null } }], catalog); assert.equal(layoutDocument(automatic, { list: 176 }, catalog).get('list')!.height, 176); assert.deepEqual(automatic.blocks[0].position, doc.blocks[0].position);
});
test('automatic layouts preserve chosen frame size; groups and connector ports include it', () => {
  for (const mode of ['stack', 'grid', 'flow', 'graph'] as const) {
    const doc = document(); doc.groups = [{ id: 'g', title: 'Grupo', description: '', blockIds: ['a', 'b'], groupIds: [], layout: { mode } }];
    doc.blocks = [{ id: 'a', typeId: 'node', title: 'A', parentGroupId: 'g', data: {}, size: { width: 400, height: 320 } }, { id: 'b', typeId: 'node', title: 'B', parentGroupId: 'g', data: {} }]; doc.links = [{ id: 'ab', from: 'a', to: 'b', kind: 'flow' }];
    const layout = layoutCanvas(doc, {}, catalog), a = layout.rects.get('a')!, group = layout.rects.get('g')!;
    assert.equal(a.width, 400, mode); assert.equal(a.height, 320, mode); assert.ok(group.width >= a.x - group.x + a.width && group.height >= a.y - group.y + a.height, mode);
    const before = linkRoutes(doc, layout)[0], live = linkRoutes(doc, layout, id => id === 'a' ? { x: 0, y: 0, width: 560, height: 400 } : undefined)[0];
    assert.notDeepEqual(live.start, before.start, 'live ports follow a frame before its size has been saved');
  }
});
test('link magnet has screen-space attraction and release hysteresis, and excludes hidden and related endpoints', () => {
  const doc = document(); doc.blocks = [{ id: 'a', typeId: 'node', title: 'A', data: {}, position: { x: 0, y: 0 } }, { id: 'b', typeId: 'node', title: 'B', data: {}, position: { x: 400, y: 0 }, size: { width: 224, height: 160 } }];
  const layout = layoutCanvas(doc, { a: 104 }, catalog);
  const target = linkMagnet(layout, 'a', { x: 374, y: 80 })!; assert.equal(target.id, 'b'); assert.equal(target.side, 'left'); assert.deepEqual(target.point, { x: 400, y: 80 });
  assert.equal(linkMagnet(layout, 'a', { x: 367, y: 80 }), null);
  assert.equal(linkMagnet(layout, 'a', { x: 367, y: 80 }, 1, target)?.id, 'b');
  assert.equal(linkMagnet(layout, 'a', { x: 359, y: 80 }, 1, target), null);
  assert.equal(linkMagnet(layout, 'a', { x: 350, y: 80 }, .5)?.id, 'b');
  assert.equal(linkMagnet(layout, 'a', { x: 374, y: 80 }, 2), null);
  assert.equal(linkMagnet(layout, 'a', { x: 20, y: 20 }), null);
  doc.groups = [{ id: 'g', title: 'G', description: '', blockIds: ['b'], groupIds: [], collapsed: true, position: { x: 800, y: 300 } }]; doc.blocks[1].parentGroupId = 'g';
  const collapsed = layoutCanvas(doc, {}, catalog), child = collapsed.rects.get('b')!; assert.equal(linkMagnet(collapsed, 'g', { x: child.x + child.width / 2, y: child.y + child.height / 2 }), null);
  collapsed.rects.get('b')!.hidden = true; assert.equal(linkMagnet(collapsed, 'a', { x: 400, y: 80 })?.id === 'b', false);
});
test('resize survives storage, undo/redo, duplication, unpinning and pack roundtrip, and rejects stale revisions', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'canvas-sizing-')); let store = new CanvasStore(dir), service = new CanvasService(store);
  try {
    const doc = document(); doc.blocks = [{ id: 'a', typeId: 'note', title: 'A', data: { text: 'Contenido' }, position: { x: 8, y: 16 } }];
    let view = await service.create({ workspaceId: doc.workspaceId, content: doc });
    const input = mutateInputSchema.parse({ workspaceId: doc.workspaceId, documentId: view.document.id, expectedRevision: view.document.revision, operations: [{ type: 'block.update', id: 'a', patch: { size: { width: 480, height: 240 } } }], label: 'Redimensionar' });
    view = await service.mutate(input); const sized = view.document;
    view = await service.undo({ workspaceId: doc.workspaceId, documentId: sized.id, expectedRevision: view.document.revision }); assert.equal(view.document.blocks[0].size, undefined);
    view = await service.undo({ workspaceId: doc.workspaceId, documentId: sized.id, expectedRevision: view.document.revision }, 'user', true); assert.deepEqual(view.document.blocks[0].size, { width: 480, height: 240 });
    const duplicated = reduce(view.document, [{ type: 'entity.duplicate', id: 'a', idPrefix: 'copy' }], catalog); assert.deepEqual(duplicated.blocks.find(b => b.id !== 'a')!.size, sized.blocks[0].size);
    const unpinned = reduce(view.document, releaseOperations(view.document, ['a'], catalog), catalog); assert.deepEqual(unpinned.blocks[0].size, sized.blocks[0].size);
    const pack = parsePack(JSON.parse(JSON.stringify(selectionPack(view.document, catalog, ['a']))), catalog); assert.deepEqual(pack.documents[0].blocks[0].size, sized.blocks[0].size);
    await store.close(); store = new CanvasStore(dir); service = new CanvasService(store);
    const persisted = (await service.read({ workspaceId: doc.workspaceId, documentId: sized.id })).document; assert.deepEqual(persisted.blocks[0].size, sized.blocks[0].size);
    await assert.rejects(service.mutate(input), /revision|conflict/i); assert.deepEqual((await service.read({ workspaceId: doc.workspaceId, documentId: sized.id })).document, persisted);
  } finally { await store.close(); await rm(dir, { recursive: true, force: true }); }
});
function document(): CanvasDocument {
  return { id: 'test', workspaceId: 'workspace', title: 'Test', description: '', example: false, revision: 0, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', communication: { intent: '', audience: '', instructions: 'Document instruction' }, selectedIds: [], blocks: [], groups: [], links: [] };
}
test('fresh RPC JSON reuses unchanged cards while preserving nested edits, order and revision', () => {
  const before = graphDocument();
  const operations = moveOperations(before, layoutDocument(before, {}, catalog), ['host'], { x: 80, y: 16 });
  const reply = { ...reduce(before, operations, catalog), revision: 1 };
  const shared = reuseDocumentEntities(before, reply);
  assert.deepEqual(shared, reply); assert.equal(shared.revision, 1);
  assert.equal(shared.blocks.find(b => b.id === 'session'), before.blocks.find(b => b.id === 'session'));
  assert.notEqual(shared.blocks.find(b => b.id === 'host'), before.blocks.find(b => b.id === 'host'));
  assert.equal(shared.groups, before.groups); assert.equal(shared.links, before.links);
  const reordered = JSON.parse(JSON.stringify(shared)) as CanvasDocument;
  reordered.blocks.reverse(); reordered.blocks.find(b => b.id === 'session')!.data.details = 'Changed nested content';
  const updated = reuseDocumentEntities(shared, reordered);
  assert.deepEqual(updated, reordered); assert.equal(updated.blocks[0].id, reordered.blocks[0].id);
  assert.notEqual(updated.blocks.find(b => b.id === 'session'), shared.blocks.find(b => b.id === 'session'));
  assert.equal(updated.blocks.find(b => b.id === 'host'), shared.blocks.find(b => b.id === 'host'));
  const otherDocument = { ...reordered, id: 'another-document' };
  assert.equal(reuseDocumentEntities(shared, otherDocument), otherDocument);
});
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
test('dropping into a group stores a place relative to its frame, keeps the group layout and leaves the others flowing', () => {
  const doc = document(); doc.blocks = [{ id: 'a', typeId: 'note', title: 'A', data: { text: '' }, parentGroupId: 'g' }, { id: 'b', typeId: 'note', title: 'B', data: { text: '' }, parentGroupId: 'g' }, { id: 'loose', typeId: 'note', title: 'Loose', data: { text: '' }, position: { x: 900, y: 0 } }];
  doc.groups = [{ id: 'g', title: 'Group', description: '', blockIds: ['a', 'b'], groupIds: [], position: { x: 0, y: 0 }, layout: { mode: 'stack' } }];
  const heights = { a: 100, b: 100, loose: 100 }, rects = layoutDocument(doc, heights, catalog), frame = rects.get('g')!;
  // Dropped 400 to the right of the stack, inside the frame's row.
  const operations = moveOperations(doc, rects, ['loose'], { x: frame.x + 400 - 900, y: 60 }, 'g', { catalog });
  assert.deepEqual(operations, [{ type: 'entity.move', id: 'loose', parentGroupId: 'g', position: { x: 400, y: 64 } }]);
  mutateInputSchema.parse({ workspaceId: 'workspace', documentId: 'test', expectedRevision: 0, operations });
  const next = reduce(doc, operations, catalog), after = layoutDocument(next, heights, catalog); assertTidy(next, after);
  assert.equal(next.groups[0].layout?.mode, 'stack'); assert.deepEqual(next.groups[0].blockIds, ['a', 'b', 'loose']);
  assert.deepEqual([after.get('loose')!.x - after.get('g')!.x, after.get('loose')!.y - after.get('g')!.y], [400, 64]);
  // The stack did not notice: its members are where they were, and the frame grew to hold the newcomer.
  for (const id of ['a', 'b']) assert.deepEqual([after.get(id)!.x, after.get(id)!.y], [rects.get(id)!.x, rects.get(id)!.y]);
  assert.ok(after.get('g')!.width >= 400 + 288 + 16);
  // Out again, onto the canvas: the place is relative to the canvas.
  const out = moveOperations(next, after, ['loose'], { x: 1000, y: 0 }, null, { catalog }), outside = reduce(next, out, catalog);
  assert.equal(outside.blocks.find(b => b.id === 'loose')!.parentGroupId, null); assert.equal(outside.blocks.find(b => b.id === 'loose')!.position!.x, snapTo8(after.get('loose')!.x + 1000));
  assert.deepEqual(outside.groups[0].blockIds, ['a', 'b']);
});
const snapTo8 = (value: number) => Math.round(value / 8) * 8;
test('dragging inside an automatic layout pins only that element: the rest close ranks, order is kept, and letting go restores it', () => {
  for (const mode of ['stack', 'grid', 'flow'] as const) {
    const doc = document(); doc.groups = [{ id: 'g', title: 'G', description: '', blockIds: ['a', 'b', 'c'], groupIds: [], layout: { mode } }];
    doc.blocks = ['a', 'b', 'c'].map(id => ({ id, typeId: 'note', title: id, data: { text: id }, parentGroupId: 'g' })); doc.links = [{ id: 'l1', from: 'a', to: 'c', kind: 'reference', label: 'ver' }];
    const heights = { a: 100, b: 100, c: 100 }, rects = layoutDocument(doc, heights, catalog);
    // Pull the first one out to the right of everything.
    const operations = moveOperations(doc, rects, ['a'], { x: 800, y: 40 }, undefined, { catalog });
    assert.deepEqual(operations.map(op => op.type), ['entity.move', 'group.update']); assert.ok(operations[0].type === 'entity.move' && operations[0].position);
    mutateInputSchema.parse({ workspaceId: 'workspace', documentId: 'test', expectedRevision: 0, operations });
    const pinned = reduce(doc, operations, catalog), after = layoutDocument(pinned, heights, catalog); assertTidy(pinned, after);
    assert.deepEqual(pinned.groups[0].blockIds, ['a', 'b', 'c'], 'reading order survives the move'); assert.equal(pinned.groups[0].layout?.mode, mode); assert.equal(containerMode(pinned, 'g', catalog), mode);
    assert.deepEqual(pinnedChildren(pinned, 'g'), ['a']);
    assert.deepEqual([after.get('a')!.x, after.get('a')!.y], [snapTo8(rects.get('a')!.x + 800 - rects.get('g')!.x) + after.get('g')!.x, snapTo8(rects.get('a')!.y + 40 - rects.get('g')!.y) + after.get('g')!.y]);
    // b takes the slot a left; c follows it.
    assert.deepEqual([after.get('b')!.x, after.get('b')!.y], [rects.get('a')!.x, rects.get('a')!.y]); assert.deepEqual([after.get('c')!.x, after.get('c')!.y], [rects.get('b')!.x, rects.get('b')!.y]);
    // Dropped on top of the others, it keeps its place and they step aside.
    const onTop = reduce(pinned, moveOperations(pinned, after, ['a'], { x: after.get('b')!.x - after.get('a')!.x + 8, y: after.get('b')!.y - after.get('a')!.y + 8 }, undefined, { catalog }), catalog), crowded = layoutDocument(onTop, heights, catalog); assertTidy(onTop, crowded);
    assert.deepEqual([crowded.get('a')!.x - crowded.get('g')!.x, crowded.get('a')!.y - crowded.get('g')!.y], [onTop.blocks.find(b => b.id === 'a')!.position!.x, onTop.blocks.find(b => b.id === 'a')!.position!.y]);
    // "Soltar posición": one transaction, same id, contents, order and links; the layout is exactly what it was.
    const release = releaseOperations(pinned, ['a'], catalog); mutateInputSchema.parse({ workspaceId: 'workspace', documentId: 'test', expectedRevision: 0, operations: release });
    const free = reduce(pinned, release, catalog), a = free.blocks.find(b => b.id === 'a')!;
    assert.equal(a.position, undefined); assert.deepEqual(a.data, { text: 'a' }); assert.equal(a.parentGroupId, 'g'); assert.deepEqual(free.groups[0].blockIds, ['a', 'b', 'c']); assert.deepEqual(free.links, doc.links);
    assert.deepEqual(pinnedChildren(free, 'g'), []);
    const back = layoutDocument(free, heights, catalog); for (const id of ['a', 'b', 'c', 'g']) assert.deepEqual(back.get(id), rects.get(id));
    assert.deepEqual(releaseOperations(free, ['a'], catalog), [], 'nothing to let go of');
  }
});
test('a pinned group is released with its members, nested order and links intact, and a list re-parent joins without a place', () => {
  const doc = document();
  doc.groups = [{ id: 'outer', title: 'Outer', description: '', blockIds: ['x'], groupIds: ['first', 'inner'], layout: { mode: 'stack' } }, { id: 'first', title: 'First', description: '', blockIds: [], groupIds: [], parentGroupId: 'outer' },
    { id: 'inner', title: 'Inner', description: 'd', blockIds: ['m1', 'm2'], groupIds: ['deep'], parentGroupId: 'outer', position: { x: 600, y: 80 }, collapsed: false, communication: { intent: 'i', audience: '', instructions: 'keep' } }, { id: 'deep', title: 'Deep', description: '', blockIds: ['m3'], groupIds: [], parentGroupId: 'inner' }];
  doc.blocks = [{ id: 'x', typeId: 'note', title: 'x', data: { text: '' }, parentGroupId: 'outer' }, { id: 'm1', typeId: 'note', title: 'm1', data: { text: '' }, parentGroupId: 'inner', position: { x: 16, y: 300 } }, { id: 'm2', typeId: 'note', title: 'm2', data: { text: '' }, parentGroupId: 'inner' }, { id: 'm3', typeId: 'note', title: 'm3', data: { text: '' }, parentGroupId: 'deep' }];
  doc.links = [{ id: 'to-group', from: 'x', to: 'inner', kind: 'flow' }, { id: 'inside', from: 'm1', to: 'm3', kind: 'depends' }];
  const operations = releaseOperations(doc, ['inner'], catalog); mutateInputSchema.parse({ workspaceId: 'workspace', documentId: 'test', expectedRevision: 0, operations });
  const next = reduce(doc, operations, catalog), inner = next.groups.find(g => g.id === 'inner')!;
  assert.equal(inner.position, undefined); assert.deepEqual([inner.blockIds, inner.groupIds, inner.parentGroupId, inner.description, inner.communication?.instructions], [['m1', 'm2'], ['deep'], 'outer', 'd', 'keep']);
  assert.deepEqual(next.groups.find(g => g.id === 'outer')!.groupIds, ['first', 'inner']); assert.deepEqual(next.groups.find(g => g.id === 'deep')!.blockIds, ['m3']);
  assert.deepEqual(next.blocks.find(b => b.id === 'm1')!.position, { x: 16, y: 300 }, 'members keep their own pins'); assert.equal(next.blocks.length, 4);
  assert.deepEqual(new Set(next.links.map(l => l.id)), new Set(['to-group', 'inside'])); assertTidy(next, layoutDocument(next, {}, catalog));
  // Chosen from the inspector list: it leaves its pin behind and joins the other group's stack.
  const joined = reduce(doc, releaseOperations(doc, ['m1'], catalog, 'first'), catalog), m1 = joined.blocks.find(b => b.id === 'm1')!;
  assert.equal(m1.position, undefined); assert.equal(m1.parentGroupId, 'first'); assert.deepEqual(joined.links.map(l => l.id).sort(), ['inside', 'to-group']);
  assert.deepEqual(releaseOperations(doc, ['m2'], catalog, 'first'), [{ type: 'entity.move', id: 'm2', parentGroupId: 'first' }]);
  // Never into itself or its own contents.
  assert.deepEqual(releaseOperations(doc, ['inner'], catalog, 'deep'), []); assert.deepEqual(moveOperations(doc, layoutDocument(doc, {}, catalog), ['inner'], { x: 0, y: 0 }, 'deep'), []);
});
test('on a free canvas the first drag freezes every sibling where it is drawn, so nothing else moves', () => {
  const doc = document(); doc.groups = ['g1', 'g2', 'g3'].map(id => ({ id, title: id, description: '', blockIds: [`${id}-a`], groupIds: [] }));
  doc.blocks = [...['g1', 'g2', 'g3'].map(id => ({ id: `${id}-a`, typeId: 'note', title: id, data: { text: '' }, parentGroupId: id })), { id: 'solo', typeId: 'note', title: 'solo', data: { text: '' } }];
  assert.equal(containerMode(doc, null, catalog), 'free');
  const rects = layoutDocument(doc, {}, catalog, 1600), operations = moveOperations(doc, rects, ['g1'], { x: 40, y: 600 }, undefined, { catalog });
  assert.deepEqual(operations.map(op => op.type === 'entity.move' ? op.id : op.type), ['g2', 'g3', 'solo', 'g1']);
  mutateInputSchema.parse({ workspaceId: 'workspace', documentId: 'test', expectedRevision: 0, operations });
  const next = reduce(doc, operations, catalog), after = layoutDocument(next, {}, catalog, 1600); assertTidy(next, after);
  for (const id of ['g2', 'g3', 'solo', 'g2-a']) assert.deepEqual([after.get(id)!.x, after.get(id)!.y], [rects.get(id)!.x, rects.get(id)!.y], `${id} stayed`);
  assert.deepEqual([after.get('g1')!.x, after.get('g1')!.y], [snapTo8(rects.get('g1')!.x + 40), snapTo8(rects.get('g1')!.y + 600)]);
  // Switching a container to Libre uses the same freeze; a second drag has nothing left to freeze.
  assert.equal(freezeOperations(next, after, null).length, 0); assert.equal(moveOperations(next, after, ['g2'], { x: 8, y: 0 }, undefined, { catalog }).length, 1);
  const frozenGroup = reduce(doc, freezeOperations(doc, rects, 'g1'), catalog);
  assert.deepEqual(frozenGroup.groups[0].blockIds, ['g1-a']);
  assert.deepEqual(frozenGroup.blocks[0].position, { x: 16, y: 52 });
});
test('switching a partly pinned stack to free preserves every drawn position and the original reading order', () => {
  const doc = document();
  doc.groups = [{ id: 'g', title: 'G', description: '', blockIds: ['a', 'b', 'c'], groupIds: [], layout: { mode: 'stack' } }];
  doc.blocks = ['a', 'b', 'c'].map(id => ({ id, typeId: 'note', title: id, data: { text: id }, parentGroupId: 'g', ...(id === 'b' ? { position: { x: 400, y: 52 } } : {}) }));
  const heights = { a: 100, b: 100, c: 100 }, before = layoutDocument(doc, heights, catalog);
  const operations = [...freezeOperations(doc, before, 'g'), { type: 'group.update' as const, id: 'g', patch: { layout: { mode: 'free' as const } } }];
  mutateInputSchema.parse({ workspaceId: 'workspace', documentId: 'test', expectedRevision: 0, operations });
  const next = reduce(doc, operations, catalog), after = layoutDocument(next, heights, catalog);
  assert.deepEqual(next.groups[0].blockIds, ['a', 'b', 'c']);
  for (const id of ['a', 'b', 'c', 'g']) assert.deepEqual(after.get(id), before.get(id), `${id} did not move`);
  assert.equal(next.blocks.find(b => b.id === 'a')!.position!.y, 52, 'freezing preserves non-grid header offsets');
});
test('moving out of a free group freezes its unplaced siblings and does not reattach the departing block', () => {
  const doc = document();
  doc.groups = [{ id: 'source', title: 'Source', description: '', blockIds: ['a', 'b', 'c'], groupIds: [], layout: { mode: 'free' }, position: { x: 0, y: 0 } }, { id: 'target', title: 'Target', description: '', blockIds: [], groupIds: [], layout: { mode: 'stack' }, position: { x: 900, y: 0 } }];
  doc.blocks = ['a', 'b', 'c'].map(id => ({ id, typeId: 'note', title: id, data: { text: id }, parentGroupId: 'source', ...(id === 'a' ? { position: { x: 16, y: 52 } } : {}) }));
  const heights = { a: 100, b: 100, c: 100 }, before = layoutDocument(doc, heights, catalog);
  const operations = moveOperations(doc, before, ['a'], { x: 1000, y: 16 }, 'target', { catalog });
  mutateInputSchema.parse({ workspaceId: 'workspace', documentId: 'test', expectedRevision: 0, operations });
  const next = reduce(doc, operations, catalog), after = layoutDocument(next, heights, catalog);
  assert.deepEqual(next.groups.find(g => g.id === 'source')!.blockIds, ['b', 'c']);
  assert.deepEqual(next.groups.find(g => g.id === 'target')!.blockIds, ['a']);
  for (const id of ['b', 'c']) assert.deepEqual(after.get(id), before.get(id), `${id} stayed in place`);
  assert.equal(next.blocks.find(b => b.id === 'a')!.parentGroupId, 'target'); assertTidy(next, after);
});
test('dragging a selected group and its child together produces one group move and preserves child-local positions', () => {
  const doc = document();
  doc.groups = [{ id: 'g', title: 'G', description: '', blockIds: ['a'], groupIds: [], position: { x: 0, y: 0 } }];
  doc.blocks = [{ id: 'a', typeId: 'note', title: 'A', data: { text: '' }, parentGroupId: 'g', position: { x: 16, y: 52 } }, { id: 'b', typeId: 'note', title: 'B', data: { text: '' }, position: { x: 500, y: 0 } }];
  const before = layoutDocument(doc, {}, catalog), operations = moveOperations(doc, before, ['g', 'a', 'b'], { x: 80, y: 160 }, undefined, { catalog });
  mutateInputSchema.parse({ workspaceId: 'workspace', documentId: 'test', expectedRevision: 0, operations });
  assert.deepEqual(operations.filter(op => op.type === 'entity.move').map(op => op.id), ['g', 'b']);
  const next = reduce(doc, operations, catalog), after = layoutDocument(next, {}, catalog);
  for (const id of ['g', 'a', 'b']) assert.deepEqual([after.get(id)!.x - before.get(id)!.x, after.get(id)!.y - before.get(id)!.y], [80, 160]);
  assert.deepEqual(next.blocks.find(b => b.id === 'a')!.position, { x: 16, y: 52 });
});
test('drop targets follow the pointer: innermost open group, never the dragged family, steady at a frame edge', () => {
  const doc = document();
  doc.groups = [{ id: 'outer', title: 'Outer', description: '', blockIds: ['a'], groupIds: ['inner', 'shut'], position: { x: 0, y: 0 } }, { id: 'inner', title: 'Inner', description: '', blockIds: ['b'], groupIds: [], parentGroupId: 'outer' }, { id: 'shut', title: 'Shut', description: '', blockIds: ['c'], groupIds: [], parentGroupId: 'outer', collapsed: true }];
  doc.blocks = [{ id: 'a', typeId: 'note', title: 'a', data: { text: '' }, parentGroupId: 'outer' }, { id: 'b', typeId: 'note', title: 'b', data: { text: '' }, parentGroupId: 'inner' }, { id: 'c', typeId: 'note', title: 'c', data: { text: '' }, parentGroupId: 'shut' }, { id: 'free', typeId: 'note', title: 'free', data: { text: '' }, position: { x: 2400, y: 0 } }];
  const layout = layoutCanvas(doc, {}, catalog), r = (id: string) => layout.rects.get(id)!, mid = (id: string) => ({ x: r(id).x + r(id).width / 2, y: r(id).y + r(id).height / 2 });
  assert.equal(dropTarget(doc, layout, ['free'], mid('b')), 'inner'); assert.equal(dropTarget(doc, layout, ['free'], mid('a')), 'outer');
  assert.equal(dropTarget(doc, layout, ['free'], { x: 5000, y: 5000 }), null);
  assert.equal(dropTarget(doc, layout, ['free'], mid('shut')), 'outer', 'a collapsed group cannot show where something lands');
  // A group is not a target for itself or for what it contains; its parent is.
  assert.equal(dropTarget(doc, layout, ['inner'], mid('b')), 'outer'); assert.equal(dropTarget(doc, layout, ['outer'], mid('b')), null);
  assert.deepEqual(travellers(doc, ['outer', 'b', 'free']), ['outer', 'a', 'inner', 'b', 'shut', 'c', 'free']);
  // Just outside the frame: a fresh drag is on the canvas, one already over the frame stays until it is clearly out.
  const edge = { x: r('outer').x + r('outer').width + 5, y: mid('a').y };
  assert.equal(dropTarget(doc, layout, ['free'], edge), null); assert.equal(dropTarget(doc, layout, ['free'], edge, 'outer', 8), 'outer'); assert.equal(dropTarget(doc, layout, ['free'], { ...edge, x: edge.x + 8 }, 'outer', 8), null);
});
test('alignment guides snap edges and centres within the threshold, one per axis, and say where to draw', () => {
  const others = [{ x: 0, y: 0, width: 200, height: 80 }, { x: 400, y: 300, width: 100, height: 100 }];
  // Left edges 4 apart: snaps left. Far on the other axis: no guide there.
  let result = alignmentGuides({ x: 4, y: 150, width: 120, height: 60 }, others, 6);
  assert.deepEqual([result.dx, result.dy], [-4, 0]); assert.deepEqual(result.guides, [{ axis: 'x', at: 0, from: 0, to: 210 }]);
  // Centres: 100 vs box centre 97 on x; bottom of the box meets the top of the second one on y.
  result = alignmentGuides({ x: 47, y: 238, width: 100, height: 60 }, others, 6);
  assert.deepEqual([result.dx, result.dy], [3, 2]); assert.deepEqual(result.guides.map(g => [g.axis, g.at]), [['x', 100], ['y', 300]]);
  // The nearest line wins, and outside the threshold nothing snaps.
  assert.equal(alignmentGuides({ x: 5, y: 500, width: 191, height: 10 }, others, 6).dx, -.5, 'centres half a pixel apart beat right edges 4 apart and left edges 5 apart');
  assert.deepEqual(alignmentGuides({ x: 7, y: 500, width: 30, height: 10 }, others, 6), { dx: 0, dy: 0, guides: [] }); assert.deepEqual(alignmentGuides({ x: 0, y: 0, width: 10, height: 10 }, [], 6).guides, []);
});
test('grouping keeps everything where it is drawn and the camera helpers keep their anchors', () => {
  const doc = document(); doc.blocks = [{ id: 'a', typeId: 'note', title: 'a', data: { text: '' }, position: { x: 200, y: 120 } }, { id: 'b', typeId: 'note', title: 'b', data: { text: '' }, position: { x: 640, y: 360 } }, { id: 'c', typeId: 'note', title: 'c', data: { text: '' }, position: { x: 1400, y: 0 } }];
  const heights = { a: 100, b: 100, c: 100 }, rects = layoutDocument(doc, heights, catalog), operations = groupOperations(doc, rects, ['a', 'b'], 'new', catalog);
  mutateInputSchema.parse({ workspaceId: 'workspace', documentId: 'test', expectedRevision: 0, operations });
  const next = reduce(doc, operations, catalog), after = layoutDocument(next, heights, catalog); assertTidy(next, after);
  for (const id of ['a', 'b', 'c']) assert.deepEqual([after.get(id)!.x, after.get(id)!.y], [rects.get(id)!.x, rects.get(id)!.y], `${id} stayed`);
  assert.deepEqual(next.groups[0].blockIds, ['a', 'b']); assert.equal(containerMode(next, 'new', catalog), 'free');
  // Fit shows the whole box centred; zooming keeps the world point under the anchor where it was.
  const view = { width: 1000, height: 600 }, box = { x: -400, y: 100, width: 3000, height: 900 }, cam = fitCamera(view, box);
  assert.ok(Math.abs(cam.scale * box.x + cam.offset.x - (view.width - box.width * cam.scale) / 2) < 1e-9); assert.ok(cam.scale * box.width <= view.width - 96 + 1e-9); assert.ok(fitCamera(view, { x: 0, y: 0, width: 10, height: 10 }).scale <= 1);
  const anchor = { x: 320, y: 210 }, world = { x: (anchor.x - cam.offset.x) / cam.scale, y: (anchor.y - cam.offset.y) / cam.scale }, zoomed = zoomAround(cam, 1.25, anchor);
  assert.ok(Math.abs(zoomed.scale * world.x + zoomed.offset.x - anchor.x) < 1e-9 && Math.abs(zoomed.scale * world.y + zoomed.offset.y - anchor.y) < 1e-9); assert.equal(zoomAround(cam, 99, anchor).scale, 1.6); assert.equal(zoomAround(cam, 0, anchor).scale, .25);
  // Auto-pan: nothing in the middle, towards the edge the pointer is at, never faster than the limit.
  assert.deepEqual(edgePan({ x: 500, y: 300 }, view), { x: 0, y: 0 }); assert.ok(edgePan({ x: 10, y: 300 }, view).x > 0 && edgePan({ x: 990, y: 300 }, view).x < 0 && edgePan({ x: 500, y: 595 }, view).y < 0);
  assert.equal(edgePan({ x: -200, y: 300 }, view).x, 900); assert.ok(edgePan({ x: 40, y: 300 }, view).x < edgePan({ x: 10, y: 300 }, view).x);
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
test('pin and release transactions persist, undo and redo as complete edits, and reject a stale revision without losing links', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'canvas-pinning-')); let store = new CanvasStore(dir), service = new CanvasService(store);
  try {
    const doc = document();
    doc.groups = [{ id: 'outer', title: 'Outer', description: 'Purpose', blockIds: ['outside'], groupIds: ['inner'], layout: { mode: 'stack' } }, { id: 'inner', title: 'Inner', description: 'Keep me', blockIds: ['a', 'b'], groupIds: [], parentGroupId: 'outer', communication: { intent: 'Explain', audience: '', instructions: 'Keep it short' } }];
    doc.blocks = [{ id: 'outside', typeId: 'note', title: 'Outside', data: { text: 'Outside' }, parentGroupId: 'outer' }, ...['a', 'b'].map(id => ({ id, typeId: 'note', title: id, data: { text: id }, parentGroupId: 'inner', ...(id === 'a' ? { position: { x: 16, y: 96 } } : {}) }))];
    doc.links = [{ id: 'boundary', from: 'outside', to: 'inner', kind: 'reference' }, { id: 'internal', from: 'a', to: 'b', kind: 'flow' }];
    let view = await service.create({ workspaceId: doc.workspaceId, content: doc });
    const move = moveOperations(view.document, layoutDocument(view.document, {}, catalog), ['inner'], { x: 700, y: 80 }, undefined, { catalog });
    view = await service.mutate(mutateInputSchema.parse({ workspaceId: doc.workspaceId, documentId: view.document.id, expectedRevision: view.document.revision, operations: move, label: 'Mover grupo' }));
    const pinned = view.document, position = pinned.groups.find(g => g.id === 'inner')!.position;
    assert.ok(position);
    const release = releaseOperations(pinned, ['inner'], catalog);
    const input = mutateInputSchema.parse({ workspaceId: doc.workspaceId, documentId: pinned.id, expectedRevision: pinned.revision, operations: release, label: 'Soltar posición' });
    view = await service.mutate(input);
    assert.equal(view.document.revision, pinned.revision + 1, 'recreating the frame is one transaction');
    assert.equal(view.document.groups.find(g => g.id === 'inner')!.position, undefined);
    assert.deepEqual(view.document.blocks, pinned.blocks);
    assert.deepEqual(view.document.links.sort((a, b) => a.id.localeCompare(b.id)), pinned.links.sort((a, b) => a.id.localeCompare(b.id)));
    assert.deepEqual(view.document.groups.find(g => g.id === 'outer')!.groupIds, ['inner']);
    assert.equal(view.document.groups.find(g => g.id === 'inner')!.communication?.instructions, 'Keep it short');
    view = await service.undo({ workspaceId: doc.workspaceId, documentId: pinned.id, expectedRevision: view.document.revision });
    assert.deepEqual(view.document.groups.find(g => g.id === 'inner')!.position, position);
    assert.deepEqual(view.document.blocks, pinned.blocks);
    view = await service.undo({ workspaceId: doc.workspaceId, documentId: pinned.id, expectedRevision: view.document.revision }, 'user', true);
    assert.equal(view.document.groups.find(g => g.id === 'inner')!.position, undefined);
    const released = view.document;
    await store.close(); store = new CanvasStore(dir); service = new CanvasService(store);
    assert.deepEqual((await service.read({ workspaceId: doc.workspaceId, documentId: pinned.id })).document, released);
    await assert.rejects(service.mutate(input), /revision|conflict/i);
    assert.deepEqual((await service.read({ workspaceId: doc.workspaceId, documentId: pinned.id })).document, released, 'stale release changes neither persisted content nor revision');
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
  assert.deepEqual(operations.map(op => op.type), ['entity.move', 'group.update']); assert.ok(operations[0].type === 'entity.move' && operations[0].position);
  const moved = reduce(doc, operations, catalog), after = layoutDocument(moved, {}, catalog); assertTidy(moved, after);
  assert.deepEqual(moved.groups[0].blockIds, doc.groups[0].blockIds, 'the order the graph is laid out from is untouched');
  assert.equal(after.get('host')!.x - after.get('inside')!.x, moved.blocks.find(b => b.id === 'host')!.position!.x);
  // A stack group takes drags too now: the dragged one is pinned, the group stays a stack.
  moved.groups[0].layout = { mode: 'stack' }; const stacked = layoutDocument(moved, {}, catalog), pin = moveOperations(moved, stacked, ['session'], { x: 8, y: 8 });
  assert.ok(pin[0].type === 'entity.move' && pin[0].position); assertTidy(reduce(moved, pin, catalog), layoutDocument(reduce(moved, pin, catalog), {}, catalog));
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
