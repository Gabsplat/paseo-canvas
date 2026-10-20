import assert from 'node:assert/strict';
import { test } from 'node:test';
import { builtinTypes } from '../plugin/shared/builtins';
import type { CanvasCatalog, CanvasDocument } from '../plugin/shared/model';
import { reduce } from '../plugin/server/reducer';
import { layoutDocument } from '../plugin/client/logic';
import { alignDeltas, arrangeOperations, axisLock, distributeDeltas, flipOperations, nudgeBurst, nudgeDelta, selectionBoxes } from '../plugin/client/arrange';
import { clipBounds, clipText, copyClip, duplicateOperations, parseClip, pasteOperations, placeAt } from '../plugin/client/clipboard';
import { DEFAULT_SHORTCUTS, eventCombo, resolveShortcuts } from '../plugin/client/shortcuts';

const catalog: CanvasCatalog = { revision: 0, blockTypes: builtinTypes, packs: [], extensions: [] };
const card = (id: string, x: number, y: number, parentGroupId: string | null = null) => ({ id, typeId: 'node', title: id.toUpperCase(), data: { summary: id }, position: { x, y }, parentGroupId });
function document(): CanvasDocument {
  return { id: 'd', workspaceId: 'w', revision: 0, createdAt: '2026-10-20T00:00:00.000Z', updatedAt: '2026-10-20T00:00:00.000Z', title: 'Power (example data)', description: '', example: true,
    communication: { instructions: '', intent: '', audience: '' }, layout: { mode: 'free' }, selectedIds: [],
    blocks: [card('a', 0, 0), card('b', 400, 40), card('c', 900, 200), card('inner', 24, 64, 'f'),
      { id: 'ink', typeId: 'wb-draw', title: '', position: { x: 10, y: 10 }, size: { width: 40, height: 20 }, parentGroupId: null, data: { extent: { width: 40, height: 20 }, strokes: [{ points: [0, 0, 40, 20], color: 'tinta', weight: 'm' }], anchor: 'a' } },
      { id: 'line', typeId: 'wb-shape', title: '', position: { x: 0, y: 600 }, size: { width: 80, height: 40 }, parentGroupId: null, data: { shape: 'line', from: 'nw' } }],
    groups: [{ id: 'f', title: 'Frame', description: '', blockIds: ['inner'], groupIds: [], position: { x: 0, y: 900 }, layout: { mode: 'free' }, sheet: { number: 1, createdAt: '2026-10-20T00:00:00.000Z', source: 'user' } }],
    links: [{ id: 'ab', from: 'a', to: 'b', kind: 'flow' }, { id: 'bc', from: 'b', to: 'c', kind: 'flow' }, { id: 'a-inner', from: 'a', to: 'inner', kind: 'depends' }],
  } as CanvasDocument;
}
const counter = () => { let n = 0; return (kind: string) => `${kind}-${++n}`; };

test('Shift-drag keeps the larger axis only', () => {
  assert.deepEqual(axisLock({ x: 30, y: -12 }), { x: 30, y: 0 });
  assert.deepEqual(axisLock({ x: -3, y: 40 }), { x: 0, y: 40 });
  assert.deepEqual(axisLock({ x: 5, y: -5 }), { x: 5, y: 0 }, 'a tie stays horizontal');
});

test('Alt-drag and ⌘D duplicate with the links among the copies, fresh ids, one valid transaction', () => {
  const doc = document(), rects = layoutDocument(doc, {}, catalog);
  const made = duplicateOperations(doc, rects, ['a', 'b'], { x: 16, y: 16 }, { catalog, idFor: counter() })!;
  assert.deepEqual(made.tops, ['block-1', 'block-2']);
  const next = reduce(doc, made.operations, catalog);
  const a2 = next.blocks.find(b => b.id === 'block-1')!, b2 = next.blocks.find(b => b.id === 'block-2')!;
  assert.deepEqual(a2.position, { x: 16, y: 16 }); assert.deepEqual(b2.position, { x: 416, y: 56 }); assert.equal(a2.title, 'A');
  assert.deepEqual(next.links.filter(l => made.tops.includes(l.from)).map(l => [l.from, l.to]), [['block-1', 'block-2']], 'only the link inside the copy is copied');
  assert.equal(next.links.length, doc.links.length + 1);
  assert.deepEqual(next.blocks.filter(b => doc.blocks.some(o => o.id === b.id)).map(b => b.position), doc.blocks.map(b => b.position), 'the originals stay');
  // A Frame comes with what it holds; the copy of a Sheet is an ordinary Frame.
  const frame = duplicateOperations(doc, rects, ['f'], { x: 0, y: 400 }, { catalog, idFor: counter() })!, withFrame = reduce(doc, frame.operations, catalog);
  const copy = withFrame.groups.find(g => g.id === frame.tops[0])!;
  assert.equal(copy.sheet, undefined); assert.deepEqual(copy.position, { x: 0, y: 1300 }); assert.equal(copy.blockIds.length, 1);
  assert.deepEqual(withFrame.blocks.find(b => b.id === copy.blockIds[0])!.position, { x: 24, y: 64 }, 'inside, positions stay relative to the Frame');
  // Into another Frame (an Alt-drag dropped there): positions become relative to it.
  const into = duplicateOperations(doc, rects, ['c'], { x: 0, y: 0 }, { catalog, parentOf: () => 'f', idFor: counter() })!, inFrame = reduce(doc, into.operations, catalog);
  const placed = inFrame.blocks.find(b => b.id === into.tops[0])!, f = rects.get('f')!, c = rects.get('c')!;
  assert.equal(placed.parentGroupId, 'f'); assert.deepEqual(placed.position, { x: c.x - f.x, y: c.y - f.y });
});

test('a drawing copied with its card follows the copy; copied alone it becomes a free drawing', () => {
  const doc = document(), rects = layoutDocument(doc, {}, catalog);
  const both = duplicateOperations(doc, rects, ['a', 'ink'], { x: 16, y: 16 }, { catalog, idFor: counter() })!, next = reduce(doc, both.operations, catalog);
  const ink = next.blocks.find(b => b.typeId === 'wb-draw' && b.id !== 'ink')!;
  assert.equal(ink.data.anchor, 'block-1'); assert.deepEqual(ink.position, { x: 10, y: 10 }, 'still relative to its (copied) card');
  const alone = duplicateOperations(doc, rects, ['ink'], { x: 16, y: 16 }, { catalog, idFor: counter() })!, free = reduce(doc, alone.operations, catalog).blocks.find(b => b.id === alone.tops[0])!;
  const r = rects.get('ink')!;
  assert.equal(free.data.anchor, undefined); assert.deepEqual(free.position, { x: Math.round(r.x + 16), y: Math.round(r.y + 16) });
});

test('copy and paste across Lienzos: marked text, every id remapped, pasted around a point', () => {
  const source = document(), rects = layoutDocument(source, {}, catalog);
  const text = clipText(copyClip(source, rects, ['a', 'b', 'f'])!);
  assert.equal(parseClip('just some text'), null); assert.equal(parseClip('{"format":"other"}'), null); assert.equal(parseClip(text.slice(0, -2)), null);
  const clip = parseClip(text)!; assert.ok(clip);
  const target = { ...document(), id: 'other', blocks: [], groups: [], links: [] } as CanvasDocument, bounds = clipBounds(clip);
  const at = { x: 2000, y: 2000 }, offset = { x: at.x - bounds.x - bounds.width / 2, y: at.y - bounds.y - bounds.height / 2 };
  const made = pasteOperations(clip, { catalog, idFor: counter(), place: placeAt(new Map(), offset, () => null) }), pasted = reduce(target, made.operations, catalog);
  assert.equal(pasted.blocks.length, 3); assert.equal(pasted.groups.length, 1);
  const old = new Set([...source.blocks, ...source.groups, ...source.links].map(e => e.id));
  assert.ok([...pasted.blocks, ...pasted.groups, ...pasted.links].every(e => !old.has(e.id)), 'no id of the source Lienzo');
  assert.deepEqual(pasted.links.map(l => l.kind).sort(), ['depends', 'flow'], 'a→b and a→inner, not b→c');
  assert.ok(pasted.links.every(l => pasted.blocks.some(b => b.id === l.from) && pasted.blocks.some(b => b.id === l.to)));
  // Two cards pasted around the pointer: the middle of what was copied lands on it.
  const pair = copyClip(source, rects, ['a', 'b'])!, pb = clipBounds(pair), shift = { x: at.x - pb.x - pb.width / 2, y: at.y - pb.y - pb.height / 2 };
  const around = pasteOperations(pair, { catalog, idFor: counter(), place: placeAt(new Map(), shift, () => null) }), placed = layoutDocument(reduce(target, around.operations, catalog), {}, catalog);
  // (A card's width depends on its Lienzo, so the copied boxes are what is centred.)
  assert.deepEqual(around.tops.map(id => placed.get(id)!.x), [Math.round(at.x - pb.width / 2), Math.round(at.x - pb.width / 2 + 400)], 'centred on the point');
  // Paste in place: where it was copied from.
  const inPlace = reduce(target, pasteOperations(clip, { catalog, idFor: counter(), place: placeAt(new Map(), { x: 0, y: 0 }, () => null) }).operations, catalog);
  assert.deepEqual(inPlace.blocks.find(b => b.title === 'A')!.position, { x: 0, y: 0 });
  // A type this catalog lacks is left out with its links, and said so.
  const narrow = { ...catalog, blockTypes: builtinTypes.filter(t => t.id !== 'node') }, skipped = pasteOperations(clip, { catalog: narrow, place: placeAt(new Map(), offset, () => null) });
  assert.equal(skipped.skipped, 3); assert.ok(skipped.operations.every(op => op.type !== 'link.create'));
});

test('align and distribute move each box by its own delta, in one transaction', () => {
  const boxes = [{ id: 'a', x: 0, y: 0, width: 100, height: 50 }, { id: 'b', x: 300, y: 80, width: 60, height: 40 }, { id: 'c', x: 140, y: 200, width: 80, height: 100 }];
  assert.deepEqual([...alignDeltas(boxes, 'left')], [['b', { x: -300, y: 0 }], ['c', { x: -140, y: 0 }]]);
  assert.deepEqual([...alignDeltas(boxes, 'right')], [['a', { x: 260, y: 0 }], ['c', { x: 140, y: 0 }]]);
  assert.deepEqual([...alignDeltas(boxes, 'center')], [['a', { x: 130, y: 0 }], ['b', { x: -150, y: 0 }], ['c', { x: 0, y: 0 }]].filter(([, d]) => (d as { x: number }).x));
  assert.deepEqual([...alignDeltas(boxes, 'bottom')], [['a', { x: 0, y: 250 }], ['b', { x: 0, y: 180 }]]);
  assert.deepEqual([...alignDeltas(boxes, 'middle')].map(([id, d]) => [id, d.y]), [['a', 125], ['b', 50], ['c', -100]]);
  assert.equal(alignDeltas(boxes.slice(0, 1), 'left').size, 0, 'one box has nothing to align with');
  // Widths 100 + 80 + 60 over a span of 360: two gaps of 60, in the order the boxes stand.
  assert.deepEqual([...distributeDeltas(boxes, 'horizontal')], [['c', { x: 20, y: 0 }]]);
  assert.equal(distributeDeltas(boxes.slice(0, 2), 'vertical').size, 0);
  const doc = document(), rects = layoutDocument(doc, {}, catalog);
  const next = reduce(doc, arrangeOperations(doc, rects, alignDeltas(selectionBoxes(doc, rects, ['a', 'b', 'c']), 'top'), catalog), catalog);
  assert.deepEqual(['a', 'b', 'c'].map(id => next.blocks.find(b => b.id === id)!.position!.y), [0, 0, 0]);
  assert.deepEqual(['a', 'b', 'c'].map(id => next.blocks.find(b => b.id === id)!.position!.x), [0, 400, 900], 'x untouched, no grid snap');
});

test('flip mirrors drawings and lines, and the places of several things', () => {
  const doc = document(), rects = layoutDocument(doc, {}, catalog);
  const one = reduce(doc, flipOperations(doc, rects, ['ink'], 'horizontal', catalog), catalog).blocks.find(b => b.id === 'ink')!;
  assert.deepEqual((one.data.strokes as { points: number[] }[])[0].points, [40, 0, 0, 20]);
  const line = reduce(doc, flipOperations(doc, rects, ['line'], 'vertical', catalog), catalog).blocks.find(b => b.id === 'line')!;
  assert.equal(line.data.from, 'sw');
  assert.deepEqual(flipOperations(doc, rects, ['c'], 'horizontal', catalog), [], 'a card alone does not flip');
  const two = reduce(doc, flipOperations(doc, rects, ['a', 'b'], 'horizontal', catalog), catalog), ra = rects.get('a')!, rb = rects.get('b')!;
  assert.equal(two.blocks.find(b => b.id === 'a')!.position!.x, Math.round(rb.x + rb.width - ra.width));
  assert.equal(two.blocks.find(b => b.id === 'b')!.position!.x, 0);
});

test('arrow keys nudge 1 unit, 10 with Shift, and a burst is written once', () => {
  assert.deepEqual(nudgeDelta('ArrowLeft', false), { x: -1, y: 0 }); assert.deepEqual(nudgeDelta('ArrowDown', true), { x: 0, y: 10 }); assert.equal(nudgeDelta('a', false), null);
  const timers: (() => void)[] = [], commits: [string[], { x: number; y: number }][] = [];
  const burst = nudgeBurst((ids, delta) => commits.push([ids, delta]), 450, { set: run => timers.push(run) - 1, clear: handle => { timers[handle as number] = () => {}; } });
  assert.deepEqual(burst.add(['a'], { x: 1, y: 0 }), { x: 1, y: 0 });
  burst.add(['a'], { x: 1, y: 0 }); assert.deepEqual(burst.add(['a'], { x: 0, y: 10 }), { x: 2, y: 10 });
  assert.equal(commits.length, 0, 'nothing written while the keys repeat');
  timers.at(-1)!(); assert.deepEqual(commits, [[['a'], { x: 2, y: 10 }]]);
  burst.add(['a'], { x: -1, y: 0 }); burst.add(['b'], { x: 0, y: 1 }); assert.deepEqual(commits.at(-1), [['a'], { x: -1, y: 0 }], 'another selection starts a new burst');
  burst.add(['b'], { x: 0, y: -1 }); burst.flush(); assert.equal(commits.length, 2, 'a burst that adds up to nothing writes nothing');
});

test('the power keys are free, assigned, and Alt+letter reads the physical key', () => {
  const { list, byCombo } = resolveShortcuts(DEFAULT_SHORTCUTS);
  assert.deepEqual(list.filter(s => s.unassigned).map(s => s.id), []);
  for (const [combo, id] of [['mod+c', 'edit.copy'], ['mod+x', 'edit.cut'], ['mod+v', 'edit.paste'], ['mod+shift+v', 'edit.pasteInPlace'], ['alt+a', 'arrange.alignLeft'], ['alt+d', 'arrange.alignRight'], ['alt+w', 'arrange.alignTop'], ['alt+s', 'arrange.alignBottom'],
    ['alt+h', 'arrange.alignCenter'], ['alt+v', 'arrange.alignMiddle'], ['alt+shift+h', 'arrange.distributeH'], ['alt+shift+v', 'arrange.distributeV'], ['shift+h', 'arrange.flipH'], ['shift+v', 'arrange.flipV'], ['mod+/', 'help.shortcuts'], ['?', 'help.shortcuts'],
    ['[', 'hoja.previous'], [']', 'hoja.next'], ['h', 'tool.hand'], ['v', 'tool.select'], ['mod+d', 'edit.duplicate'], ['mod+g', 'edit.wrap'], ['mod+shift+g', 'edit.unwrap'], ['left', 'edit.nudge'], ['alt+drag', 'pointer.duplicate'], ['shift+drag', 'pointer.axis']] as const) assert.equal(byCombo.get(combo), id, combo);
  assert.ok(list.filter(s => s.group === 'Pointer').every(s => s.fixed), 'pointer modifiers are listed, not reassigned');
  assert.equal(eventCombo({ key: 'å', code: 'KeyA', shift: false, command: false, alt: true }), 'alt+a', 'Option+A on a Mac types å');
  assert.equal(eventCombo({ key: 'Ó', code: 'KeyH', shift: true, command: false, alt: true }), 'alt+shift+h');
  assert.equal(eventCombo({ key: '/', code: 'Slash', shift: false, command: true }), 'mod+/');
  assert.equal(eventCombo({ key: 'V', code: 'KeyV', shift: true, command: false }), 'shift+v');
});
