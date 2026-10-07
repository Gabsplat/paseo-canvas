import test from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeSvg, SVG_LIMITS } from '../plugin/shared/svg';
import { readFile } from 'node:fs/promises';
import { wbTextDataSchema, wbShapeDataSchema, wbSvgDataSchema, wbDrawDataSchema, simplifyStroke, appendStroke, WB_LIMITS } from '../plugin/shared/whiteboard';
import { documentContentSchema, packSchema, operationSchema, type CanvasBlock } from '../plugin/shared/model';
import { getRendererSpec } from '../plugin/shared/renderers';
import { CanvasError } from '../plugin/shared/errors';
import { CanvasService } from '../plugin/server/service';
import { CanvasStore } from '../plugin/server/store';
import { ToolRouter } from '../plugin/server/tools';
import { feedbackPrompt } from '../plugin/server/feedback';
import { setup, workspaceId, mutation } from './helpers';

const svg = (content: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">${content}</svg>`;
test('static SVG canonicalization retains Tabler geometry and intrinsic bounds, without decorative classes', () => {
  const raw = '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon icon-tabler icon-tabler-server"><path d="M3 3h18v6H3z"/><circle cx="7" cy="6" r="1"/><title>Server &amp; database</title></svg>';
  const result = sanitizeSvg(raw);
  assert.deepEqual(result.viewBox, [0, 0, 24, 24]);
  assert.match(result.svg, /stroke="currentColor"/);
  assert.match(result.svg, /Server &amp; database/);
  assert.doesNotMatch(result.svg, /class=/);
  assert.deepEqual(sanitizeSvg(result.svg), result);
  assert.deepEqual(sanitizeSvg('<svg width="40" height="12"><rect width="40" height="12"/></svg>').viewBox, [0, 0, 40, 12]);
});

test('SVG rejects executable, referenced, malformed, encoded and resource-bearing markup', () => {
  for (const hostile of [
    '<script>alert(1)</script>', '<foreignObject><div>html</div></foreignObject>',
    '<image href="https://example.org/icon.svg"/>', '<use href="#local"/>', '<style>path{fill:red}</style>',
    '<animate attributeName="fill"/>', '<path onload="alert(1)" d="M0 0"/>',
    '<path style="stroke:red" d="M0 0"/>', '<path href="javascript:alert(1)" d="M0 0"/>',
    '<path fill="url(https://example.org/a)" d="M0 0"/>', '<path fill="url(#gradient)" d="M0 0"/>',
    '<path fill="&#106;avascript:alert(1)" d="M0 0"/>', '<path xmlns:xlink="http://www.w3.org/1999/xlink"/>',
    '<path stroke="red"/><path d="M0 0" d="M1 1"/>', '<g><path/></svg>',
    '<svg viewBox="0 0 10 10"/>', '<title>&xxe;</title>', '<path d="M1e999 0"/>',
    '<path transform="translate(Infinity)"/>', '<path stroke-width="-1"/>',
  ]) assert.throws(() => sanitizeSvg(svg(hostile)), /Unsafe SVG/);
  for (const hostile of [
    'https://example.org/icon.svg', 'data:image/svg+xml,<svg/>', 'file:///tmp/icon.svg',
    'javascript:alert(1)', '<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]>' + svg('<title>&x;</title>'),
    '<?xml-stylesheet href="https://example.org/style.css"?>' + svg(''),
    '<svg/>', '<svg viewBox="0 0 0 24"/>', svg('') + svg(''),
  ]) assert.throws(() => sanitizeSvg(hostile), /Unsafe SVG/);
});

test('SVG budgets reject input, depth, geometry and elements before unbounded rendering', () => {
  assert.throws(() => sanitizeSvg(svg('x'.repeat(SVG_LIMITS.bytes))), /64 KiB/);
  assert.throws(() => sanitizeSvg(svg('<g>'.repeat(16) + '</g>'.repeat(16))), /depth budget/);
  assert.throws(() => sanitizeSvg(svg('<path d="M0 0"/>'.repeat(SVG_LIMITS.elements))), /element\/depth budget/);
  assert.throws(() => sanitizeSvg(svg(`<path d="M${'0 '.repeat(5000)}"/>`)), /invalid path/);
  assert.throws(() => sanitizeSvg(svg('<circle cx="100001" cy="0" r="1"/>')), /outside bounds/);
  assert.throws(() => sanitizeSvg(svg(`<title>${'💡'.repeat(20000)}</title>`)), /64 KiB/);
  assert.throws(() => sanitizeSvg(svg(`<title>${'>'.repeat(40000)}</title>`)), /canonical output/);
  assert.throws(() => sanitizeSvg(svg(`<path points="${'1 2 '.repeat(5000)}"/>`)), /forbidden attribute/);
});

test('SVG supports local gradients, clipping, masks and text while rejecting unresolved/cyclic references', () => {
  const result = sanitizeSvg(svg('<defs><linearGradient id="paint"><stop offset="0%" stop-color="#fff"/><stop offset="100%" stop-color="#000"/></linearGradient><clipPath id="clip"><rect width="24" height="24"/></clipPath><mask id="mask"><circle cx="12" cy="12" r="10" fill="white"/></mask></defs><rect width="24" height="24" fill="url(#paint)" clip-path="url(#clip)" mask="url(#mask)"/><text x="1" y="12" font-family="sans-serif" font-size="8"><tspan>Safe &amp; local</tspan></text><path d="M0 0L1 1" style="fill:none;stroke:currentColor;stroke-width:2"/>'));
  assert.deepEqual(sanitizeSvg(result.svg), result);
  assert.match(result.svg, /id="paint"/); assert.doesNotMatch(result.svg, /style=/);
  const legacy = sanitizeSvg('<svg xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 24 24"><defs><linearGradient id="a"/><linearGradient id="b" xlink:href="#a"/></defs><text><tspan>a</tspan> <tspan>b</tspan></text></svg>');
  assert.match(legacy.svg, /href="#a"/); assert.doesNotMatch(legacy.svg, /xlink/);
  assert.match(legacy.svg, /<\/tspan> <tspan>/); assert.deepEqual(sanitizeSvg(legacy.svg), legacy);
  for (const bad of [
    '<defs><linearGradient id="a" href="#b"/><linearGradient id="b" href="#a"/></defs>',
    '<defs><linearGradient id="a"/><linearGradient id="a"/></defs>',
    '<rect fill="url(#missing)"/>', '<defs><linearGradient id="a" href="https://example.org/a"/></defs>',
    '<text font-family="url(https://example.org)">Active</text>', '<text style="font-size:12;behavior:url(a)">Active</text>',
  ]) assert.throws(() => sanitizeSvg(svg(bad)), /Unsafe SVG/);
});

test('SVG parser accepts only one well-formed root and a bounded static XML dialect', () => {
  const result = sanitizeSvg('<?xml version="1.0" encoding="UTF-8"?>' + svg('<!-- ignored --><g transform="translate(1,2) scale(.5)"><polygon points="0,0 10,0 5,10" fill="#fff"/></g><desc>Safe &lt;caption&gt;</desc>'));
  assert.deepEqual(sanitizeSvg(result.svg), result);
  assert.doesNotMatch(result.svg, /ignored|<\?/);
  for (const hostile of [
    '<!doctype svg>' + svg(''), '<!DOCTYPE svg SYSTEM "https://example.org/a.dtd">' + svg(''),
    svg('<path xlink:href="data:image/svg+xml;base64,abc"/>'), svg('<path href="file:///tmp/a"/>'),
    svg('<path fill="URL(#x)"/>'), svg('<path style="fill:u\\72l(https://example.org)"/>'),
    svg('<path onClick="alert(1)"/>'), svg('<path OnLoad="alert(1)"/>'),
    svg('<a href="https://example.org"><path/></a>'), svg('<g><title><path/></title></g>'),
    svg('<path d="M0 0"/ junk>'), svg('<path d=M0/>'), svg('<path d="M0 0"/><'),
    svg('<path opacity="2"/>'), svg('<path transform="matrix(1,2,3)"/>'),
    svg('<path/>text'), svg('<title>unterminated &amp</title>'), svg('<title>nul\u0000</title>'),
    '<svg xmlns="https://evil.example/svg" viewBox="0 0 1 1"/>',
    svg('<!-- unclosed'), svg('<!-- illegal -- interior -->'), '<!--'.repeat(20000),
  ]) assert.throws(() => sanitizeSvg(hostile), /Unsafe SVG/, hostile);
});

test('SVG path grammar accepts bounded curves/arcs and rejects incomplete or invalid geometry', () => {
  for (const d of [
    'M3 3h18v6H3z', 'M.5 -.5L1e1 2e+1l-1-2', 'M0 0C1 2 3 4 5 6s1 2 3 4Q1 2 3 4t5 6z',
    'M12 3a9 9 0 1 0 0 18a9 9 0 0 0 0 -18', 'M0,0 10,10 20,20Z',
  ]) { const result = sanitizeSvg(svg(`<path d="${d}"/>`)); assert.deepEqual(sanitizeSvg(result.svg), result); }
  for (const d of ['eeee', 'L0 0', 'M0', 'M0 0 L1', 'M0 0 Z1', 'M0 0a1 1 0 2 0 3 4', 'M0 0a-1 1 0 0 0 3 4', 'M0 0Q1 2 3']) {
    assert.throws(() => sanitizeSvg(svg(`<path d="${d}"/>`)), /Unsafe SVG/, d);
  }
});

const ref = { documentId: 'd', workspaceId };
const reject = (code: string) => (error: unknown) => error instanceof CanvasError && error.code === code;
const drawing = { extent: { width: 100, height: 100 }, strokes: [{ points: [0, 0, 20, 20, 50, 50, 100, 100], color: 'tinta', weight: 'm' }] };
function objects(): CanvasBlock[] {
  return [
    { id: 'txt', typeId: 'wb-text', title: '', data: { text: 'API', align: 'center' }, position: { x: 10, y: 10 } },
    { id: 'shape', typeId: 'wb-shape', title: '', data: { shape: 'diamond' }, position: { x: 30, y: 40 }, size: { width: 24, height: 24 } },
    { id: 'icon', typeId: 'wb-svg', title: '', data: { svg: svg('<path class="icon" d="M3 3h18v6H3z" stroke="currentColor"/>'), viewBox: [1, 1, 1, 1], caption: 'Servidor', source: 'tabler:server', license: 'MIT · Tabler Icons' }, position: { x: 60, y: 80 }, size: { width: 24, height: 24 } },
    { id: 'draw', typeId: 'wb-draw', title: '', data: drawing, position: { x: 100, y: 100 }, size: { width: 100, height: 100 } },
  ];
}
const whiteboardContent = () => documentContentSchema.parse({ title: 'Whiteboard test', blocks: objects(), groups: [], communication: { instructions: 'Explain selected objects.' } });

test('whiteboard schemas are strict, role-based and accept all line heads/alignment variants', () => {
  assert.equal(wbTextDataSchema.parse({ text: '' }).text, '');
  for (const align of ['left', 'center', 'right']) assert.equal(wbTextDataSchema.safeParse({ text: 't', align }).success, true);
  for (const heads of ['none', 'start', 'end', 'both']) assert.equal(wbShapeDataSchema.safeParse({ shape: 'line', from: 'se', heads }).success, true);
  for (const data of [{ text: 'a', color: '#fff' }, { text: 'a', width: 23 }, { text: 'a', extra: true }, { text: 'x'.repeat(4001) }]) assert.equal(wbTextDataSchema.safeParse(data).success, false);
  assert.equal(wbShapeDataSchema.safeParse({ shape: 'rect', heads: 'end' }).success, false);
  assert.equal(wbShapeDataSchema.safeParse({ shape: 'ellipse', from: 'nw' }).success, false);
  assert.deepEqual(wbSvgDataSchema.parse({ svg: svg(''), viewBox: [99, 99, 99, 99] }).viewBox, [0, 0, 24, 24]);
  assert.equal(wbDrawDataSchema.safeParse({ ...drawing, strokes: [{ points: [0, 0, 1], color: 'tinta', weight: 'm' }] }).success, false);
  assert.equal(wbDrawDataSchema.safeParse({ ...drawing, extent: { width: 99, height: 100 } }).success, false);
  for (const id of ['wb-text', 'wb-shape', 'wb-svg', 'wb-draw']) assert.equal(getRendererSpec(id)!.interactive, false);
});

test('RDP drawing normalization is bounded, half-unit precise, endpoint-preserving and stable', () => {
  const straight = Array.from({ length: 4096 }, (_, i) => [i / 2, i / 2]).flat();
  assert.deepEqual(simplifyStroke(straight), [0, 0, 2047.5, 2047.5]);
  const zigzag = Array.from({ length: 4096 }, (_, i) => [i, i % 2 ? 100 : 0]).flat();
  const result = simplifyStroke(zigzag);
  assert.ok(result.length / 2 <= 512); assert.deepEqual(result.slice(0, 2), zigzag.slice(0, 2)); assert.deepEqual(result.slice(-2), zigzag.slice(-2));
  assert.deepEqual(simplifyStroke(result), result);
  const parsed = wbDrawDataSchema.parse({ extent: { width: 4096, height: 100 }, strokes: [{ points: zigzag, color: 'tinta', weight: 'm' }] });
  assert.deepEqual(wbDrawDataSchema.parse(parsed), parsed);
  assert.ok(parsed.strokes.every(stroke => stroke.points.every(n => Number.isInteger(n * 2))));
  for (const points of [[0, 0, Infinity, 1], [0, 0, 1], Array(WB_LIMITS.inputPointsPerStroke * 2 + 2).fill(0)]) assert.throws(() => simplifyStroke(points));
  assert.equal(wbDrawDataSchema.safeParse({ ...drawing, strokes: Array(33).fill(drawing.strokes[0]) }).success, false);
  const dense = Array.from({ length: 512 }, (_, i) => [i, i % 2 ? 100 : 0]).flat();
  assert.equal(wbDrawDataSchema.safeParse({ extent: { width: 4096, height: 100 }, strokes: Array(8).fill({ points: dense, color: 'tinta', weight: 'm' }) }).success, false);
  const fractional = wbDrawDataSchema.parse({ extent: { width: 1.4, height: 1.4 }, strokes: [{ points: [0, 0, 1.4, 1.4], color: 'tinta', weight: 'm' }] });
  assert.deepEqual(wbDrawDataSchema.parse(fractional), fractional);
});

test('appendStroke unites boxes and rebases resized prior points without mutating its inputs', () => {
  const input = { position: { x: 10, y: 20 }, size: { width: 200, height: 200 }, data: wbDrawDataSchema.parse(drawing) };
  const before = structuredClone(input);
  const result = appendStroke(input, [0, 0, 20, 10], { color: 'rojo', weight: 'l' });
  assert.deepEqual(input, before); assert.deepEqual(result.position, { x: 0, y: 0 });
  assert.deepEqual(result.size, { width: 210, height: 220 });
  assert.deepEqual(result.data.extent, result.size);
  assert.deepEqual(result.data.strokes[0].points, [10, 20, 210, 220]);
  assert.deepEqual(result.data.strokes[1].points, [0, 0, 20, 10]);
  assert.throws(() => appendStroke(input, [-5000, 0, 0, 0], { color: 'tinta', weight: 'm' }), /4096/);
});

test('all whiteboard types persist in ordinary groups, selected context, undo/redo and conflicts', async t => {
  const { service, store, directory } = await setup(t);
  const created = await service.create({ ...ref, id: 'whiteboard', content: whiteboardContent() });
  assert.deepEqual(created.document.blocks.find(b => b.id === 'icon')!.data.viewBox, [0, 0, 24, 24]);
  assert.doesNotMatch(String(created.document.blocks.find(b => b.id === 'icon')!.data.svg), /class=/);
  assert.deepEqual((created.document.blocks.find(b => b.id === 'draw')!.data.strokes as { points: number[] }[])[0].points, [0, 0, 100, 100]);
  let current = await service.mutate(mutation(0, [
    { type: 'group.create', group: { id: 'g', title: 'Architecture', description: '', blockIds: objects().map(b => b.id), groupIds: [], layout: { mode: 'graph' }, communication: { instructions: 'Explain this group.', intent: '', audience: '' } } },
    { type: 'selection.set', ids: ['txt', 'icon', 'draw', 'g'] },
  ], 'whiteboard'));
  const selection = await service.selected({ documentId: 'whiteboard', workspaceId });
  assert.equal(selection.entities.length, 4); assert.equal(selection.entities[0].effectiveInstructions.length, 2);
  const positions = current.document.blocks.map(b => b.position);
  current = await service.mutate(mutation(1, [
    { type: 'block.update', id: 'txt', patch: { data: { text: 'Updated', width: 80 } } },
    { type: 'block.update', id: 'shape', patch: { data: { shape: 'line', heads: 'both' }, size: { width: 8, height: 8 } } },
    { type: 'block.update', id: 'icon', patch: { data: { svg: '<svg width="40" height="20"><circle cx="10" cy="10" r="5"/></svg>' } } },
    { type: 'block.update', id: 'draw', patch: { size: { width: 8, height: 8 } } },
  ], 'whiteboard'));
  assert.deepEqual(current.document.blocks.map(b => b.position), positions);
  assert.deepEqual(current.document.blocks.find(b => b.id === 'icon')!.data.viewBox, [0, 0, 40, 20]);
  const undone = await service.undo({ documentId: 'whiteboard', workspaceId, expectedRevision: 2 });
  assert.equal(undone.document.blocks.find(b => b.id === 'txt')!.data.text, 'API');
  const redone = await service.undo({ documentId: 'whiteboard', workspaceId, expectedRevision: 3 }, 'user', true);
  assert.deepEqual(redone.document.blocks, current.document.blocks);
  const disk = await readFile(store.file, 'utf8');
  await assert.rejects(service.mutate(mutation(1, [{ type: 'block.delete', id: 'icon' }], 'whiteboard')), reject('REVISION_CONFLICT'));
  assert.equal(await readFile(store.file, 'utf8'), disk);
  await store.close(); const reopened = new CanvasStore(directory); t.after(() => reopened.close());
  const persisted = await new CanvasService(reopened).read({ documentId: 'whiteboard', workspaceId });
  assert.deepEqual(persisted.document.blocks, redone.document.blocks);
  assert.equal((await new CanvasService(reopened).read(ref)).document.blocks[0].data.text, 'old');
});

test('per-renderer minima and active SVG failures roll back revision/history/disk on every service write', async t => {
  const { service, store } = await setup(t);
  await service.catalogMutate({ expectedRevision: 0, action: { type: 'type.put', blockType: { id: 'ordinary-card', name: 'Ordinary custom card', description: '', renderer: 'note', properties: [{ key: 'text', label: 'Text', kind: 'text', required: true }], defaults: { text: '' } } } });
  await service.mutate(mutation(0, objects().map(block => ({ type: 'block.create' as const, block }))));
  const disk = await readFile(store.file, 'utf8');
  for (const patch of [
    { id: 'txt', patch: { size: { width: 24, height: 24 } } },
    { id: 'shape', patch: { size: { width: 8, height: 8 } } },
    { id: 'icon', patch: { size: { width: 8, height: 8 } } },
    { id: 'draw', patch: { size: null } },
    { id: 'txt', patch: { data: { width: 23 } } },
    { id: 'icon', patch: { data: { svg: svg('<script>alert(1)</script>') } } },
    { id: 'shape', patch: { data: { from: 'nw' } } },
    { id: 'b', patch: { size: { width: 159, height: 104 } } },
  ]) {
    await assert.rejects(service.mutate(mutation(1, [operationSchema.parse({ type: 'block.update', ...patch })])), reject('VALIDATION'));
    assert.equal(await readFile(store.file, 'utf8'), disk);
  }
  const invalid = whiteboardContent(); invalid.blocks[2].data.svg = svg('<foreignObject/>');
  await assert.rejects(service.create({ workspaceId, id: 'rejected', content: invalid }), reject('VALIDATION'));
  await assert.rejects(service.mutate(mutation(1, [{ type: 'block.create', block: { id: 'nopos', typeId: 'wb-shape', title: '', data: {} } }])), reject('VALIDATION'));
  await assert.rejects(service.mutate(mutation(1, [{ type: 'block.create', block: { id: 'small-card', typeId: 'ordinary-card', title: '', data: {}, size: { width: 24, height: 24 } } }])), reject('VALIDATION'));
  assert.equal(await readFile(store.file, 'utf8'), disk);
  await service.mutate(mutation(1, [{ type: 'block.update', id: 'b', patch: { size: { width: 160, height: 104 } } }]));
});

test('pack/template/default SVG normalization covers custom renderer types and roundtrips', async t => {
  const { service, store } = await setup(t);
  const pack = packSchema.parse({ format: 'paseo-canvas-pack', version: 1, id: 'wb-test', name: 'Local whiteboard', description: '', blockTypes: [],
    templates: [{ id: 'wb-test.scene', name: 'Scene', description: '', blocks: objects().map(b => ({ ...b, parentGroupId: 'g' })), groups: [{ id: 'g', title: 'Group', blockIds: objects().map(b => b.id) }] }], documents: [whiteboardContent()] });
  const imported = await service.importPack({ expectedRevision: 0, pack, replace: false, dryRun: false });
  assert.equal(imported.committed, true);
  const exported = await service.exportPack({ id: pack.id });
  assert.deepEqual(exported.documents[0].blocks[2].data.viewBox, [0, 0, 24, 24]);
  assert.deepEqual(exported.templates[0].blocks[2].data.viewBox, [0, 0, 24, 24]);
  await service.instantiatePack({ packId: pack.id, documentIndex: 0, workspaceId, id: 'instantiated' });
  const inserted = await service.mutate(mutation(0, [{ type: 'template.insert', templateId: 'wb-test.scene', idPrefix: 'copy' }]));
  assert.equal(inserted.document.blocks.find(b => b.id === 'copy.icon')!.parentGroupId, 'copy.g');
  const template = (await service.exportGroup({ ...ref, groupId: 'copy.g', templateId: 'local.copy', name: 'Copied' })).template;
  assert.equal(template.blocks.length, 4);
  const custom = { ...getRendererSpec('wb-svg')!.blockType, id: 'custom-icon', name: 'Custom icon', defaults: { svg: svg('<circle cx="12" cy="12" r="5"/>') } };
  const catalog = await service.catalogMutate({ expectedRevision: 1, action: { type: 'type.put', blockType: custom } });
  assert.deepEqual(catalog.blockTypes.find(t => t.id === 'custom-icon')!.defaults.viewBox, [0, 0, 24, 24]);
  const added = await service.mutate(mutation(1, [{ type: 'block.create', block: { id: 'custom', typeId: 'custom-icon', title: '', data: {}, position: { x: 0, y: 0 }, size: { width: 24, height: 24 } } }]));
  assert.deepEqual(added.document.blocks.find(b => b.id === 'custom')!.data.viewBox, [0, 0, 24, 24]);
  const disk = await readFile(store.file, 'utf8');
  const malicious = structuredClone(pack); malicious.id = 'bad'; malicious.templates = []; malicious.documents[0].blocks[2].data.svg = svg('<path onload="alert(1)"/>');
  assert.equal((await service.validatePack({ pack: malicious })).valid, false);
  await assert.rejects(service.importPack({ expectedRevision: 2, pack: malicious, replace: false, dryRun: false }), reject('VALIDATION'));
  await assert.rejects(service.catalogMutate({ expectedRevision: 2, action: { type: 'type.put', blockType: { ...custom, id: 'bad-default', defaults: { svg: svg('<image href="https://example.org/a"/>') } } } }), reject('VALIDATION'));
  const badTemplate = structuredClone(template); badTemplate.id = 'bad-template'; badTemplate.blocks[2].data.svg = svg('<script/>');
  await assert.rejects(service.catalogMutate({ expectedRevision: 2, action: { type: 'template.put', template: badTemplate } }), reject('VALIDATION'));
  assert.equal(await readFile(store.file, 'utf8'), disk);
});

test('removing a custom whiteboard pack preserves small orphan blocks and permits unrelated edits until reimport', async t => {
  const { service, store } = await setup(t);
  const pack = packSchema.parse({ format: 'paseo-canvas-pack', version: 1, id: 'external', name: 'Custom whiteboard', description: '',
    blockTypes: [
      { ...getRendererSpec('wb-shape')!.blockType, id: 'external.shape' },
      { ...getRendererSpec('wb-svg')!.blockType, id: 'external.svg', defaults: { svg: svg('<circle cx="12" cy="12" r="5"/>') } },
    ], templates: [], documents: [] });
  await service.importPack({ expectedRevision: 0, pack, replace: false, dryRun: false });
  const created = await service.mutate(mutation(0, [
    { type: 'block.create', block: { id: 'external-shape', typeId: 'external.shape', title: '', data: { shape: 'rect' }, position: { x: 0, y: 0 }, size: { width: 24, height: 24 } } },
    { type: 'block.create', block: { id: 'external-icon', typeId: 'external.svg', title: '', data: {}, position: { x: 30, y: 0 }, size: { width: 24, height: 24 } } },
  ]));
  const original = created.document.blocks.filter(block => block.typeId.startsWith('external.'));
  await service.catalogMutate({ expectedRevision: 1, action: { type: 'pack.remove', id: 'external' } });
  assert.equal((await service.catalog()).blockTypes.some(type => type.id.startsWith('external.')), false);
  const edited = await service.mutate(mutation(1, [
    { type: 'document.update', title: 'Renamed after pack removal' },
    { type: 'block.update', id: 'b', patch: { data: { text: 'An unrelated edit still works.' } } },
  ]));
  assert.equal(edited.document.title, 'Renamed after pack removal');
  assert.equal(edited.document.blocks.find(block => block.id === 'b')!.data.text, 'An unrelated edit still works.');
  assert.deepEqual(edited.document.blocks.filter(block => block.typeId.startsWith('external.')), original);
  let disk = await readFile(store.file, 'utf8');
  await assert.rejects(service.mutate(mutation(2, [{ type: 'block.update', id: 'b', patch: { size: { width: 159, height: 104 } } }])), reject('VALIDATION'));
  assert.throws(() => mutation(2, [{ type: 'block.update', id: 'external-shape', patch: { size: { width: 7, height: 24 } } }]));
  assert.equal(await readFile(store.file, 'utf8'), disk);
  await service.importPack({ expectedRevision: 2, pack, replace: false, dryRun: false });
  const canonical = await service.mutate(mutation(2, [
    { type: 'block.update', id: 'external-shape', patch: { title: 'Known again' } },
    { type: 'block.update', id: 'external-icon', patch: { data: { svg: '<svg width="40" height="20"><circle cx="10" cy="10" r="5"/></svg>', viewBox: [1, 1, 1, 1] } } },
  ]));
  assert.deepEqual(canonical.document.blocks.find(block => block.id === 'external-shape')!.data, original[0].data);
  assert.deepEqual(canonical.document.blocks.find(block => block.id === 'external-icon')!.data.viewBox, [0, 0, 40, 20]);
  assert.deepEqual(canonical.document.blocks.find(block => block.id === 'external-icon')!.size, { width: 24, height: 24 });
  disk = await readFile(store.file, 'utf8');
  await assert.rejects(service.mutate(mutation(3, [{ type: 'block.update', id: 'external-shape', patch: { size: { width: 8, height: 8 } } }])), reject('VALIDATION'));
  await assert.rejects(service.mutate(mutation(3, [{ type: 'block.update', id: 'external-icon', patch: { data: { svg: svg('<script/>') } } }])), reject('VALIDATION'));
  assert.equal(await readFile(store.file, 'utf8'), disk);
});

test('MCP create/apply/read/group/history share canonical persistent whiteboard blocks', async t => {
  const { service } = await setup(t);
  const router = new ToolRouter(service, async () => ({ workspaceId, agentId: 'test-agent' }));
  const created = await router.call('canvas_create', { id: 'mcp-whiteboard', content: whiteboardContent() }, 'owner') as { revision: number };
  assert.equal(created.revision, 0);
  await router.call('canvas_apply', { documentId: 'mcp-whiteboard', expectedRevision: 0, operations: [{ type: 'block.update', id: 'icon', patch: { data: { caption: 'MCP icon', viewBox: [2, 2, 2, 2] } } }] }, 'owner');
  const read = await router.call('canvas_read', { documentId: 'mcp-whiteboard', ids: ['icon'] }, 'owner') as { entities: { entity: CanvasBlock }[] };
  assert.deepEqual(read.entities[0].entity.data.viewBox, [0, 0, 24, 24]);
  assert.equal(read.entities[0].entity.data.caption, 'MCP icon');
  await router.call('canvas_group', { documentId: 'mcp-whiteboard', expectedRevision: 1, action: 'create', group: { id: 'group', title: 'G', blockIds: ['txt', 'icon'] } }, 'owner');
  assert.equal((await service.read({ documentId: 'mcp-whiteboard', workspaceId })).document.blocks.find(b => b.id === 'icon')!.parentGroupId, 'group');
  await router.call('canvas_undo', { documentId: 'mcp-whiteboard', expectedRevision: 2 }, 'owner');
  await router.call('canvas_redo', { documentId: 'mcp-whiteboard', expectedRevision: 3 }, 'owner');
  await assert.rejects(router.call('canvas_apply', { documentId: 'mcp-whiteboard', expectedRevision: 1, operations: [{ type: 'block.delete', id: 'txt' }] }, 'owner'), reject('REVISION_CONFLICT'));
  const list = await router.call('canvas_catalog', { action: 'list' }, 'owner') as { blockTypes: { id: string; guidance: string }[] };
  assert.equal(list.blockTypes.filter(t => t.id.startsWith('wb-')).length, 4);
  assert.match(list.blockTypes.find(t => t.id === 'wb-draw')!.guidance, /petición explícita/);
  const event = await service.action({ documentId: 'mcp-whiteboard', workspaceId, expectedRevision: 4, eventId: 'ask-about-objects', action: { kind: 'ask', label: 'Explain', payload: {}, targetIds: ['icon', 'draw'], delivery: 'immediate' } });
  const prompt = feedbackPrompt([event]);
  assert.match(prompt, /"summary":\{"caption":"MCP icon","source":"tabler:server"\}/);
  assert.match(prompt, /"strokes":1,"extent":\{"width":100,"height":100\}/);
  assert.doesNotMatch(prompt, /"points"|<svg/);
});

test('a shape keeps a fill colour separate from its outline, through the real service', async t => {
  assert.equal(wbShapeDataSchema.parse({}).fillColor, undefined);
  assert.equal(wbShapeDataSchema.parse({ color: 'naranja', fill: 'solid', fillColor: 'azul' }).fillColor, 'azul');
  assert.equal(wbShapeDataSchema.safeParse({ fillColor: '#ff0000' }).success, false);
  const { service } = await setup(t);
  await service.mutate(mutation(0, [{ type: 'block.create', block: { id: 'box', typeId: 'wb-shape', title: '', data: { shape: 'rect', color: 'naranja', text: 'Hola' }, position: { x: 0, y: 0 }, size: { width: 160, height: 104 } } }]));
  const next = await service.mutate(mutation(1, [{ type: 'block.update', id: 'box', patch: { data: { fill: 'solid', fillColor: 'verde', weight: 'xl' } } }]));
  const box = next.document.blocks.find(b => b.id === 'box')!;
  assert.deepEqual({ color: box.data.color, fill: box.data.fill, fillColor: box.data.fillColor, weight: box.data.weight, text: box.data.text }, { color: 'naranja', fill: 'solid', fillColor: 'verde', weight: 'xl', text: 'Hola' });
  await assert.rejects(service.mutate(mutation(2, [{ type: 'block.update', id: 'box', patch: { data: { fillColor: 'fucsia' } } }])));
});
