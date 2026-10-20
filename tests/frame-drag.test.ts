import assert from 'node:assert/strict';
import { test } from 'node:test';
import { builtinTypes } from '../plugin/shared/builtins';
import { documentSchema, groupPatchSchema, groupSchema, type CanvasCatalog, type CanvasDocument } from '../plugin/shared/model';
import { reduce } from '../plugin/server/reducer';
import { layoutDocument, movable, moveOperations, pressRole } from '../plugin/client/logic';
import { alignDeltas, selectionBoxes } from '../plugin/client/arrange';

// Frames move only by their header and not while locked (docs/design.md §6.4). Example data throughout.
const catalog: CanvasCatalog = { revision: 0, blockTypes: builtinTypes, packs: [], extensions: [] };
const card = (id: string, x: number, y: number, parentGroupId: string | null = null) => ({ id, typeId: 'node', title: id.toUpperCase(), data: { summary: id }, position: { x, y }, parentGroupId });
function document(locked?: boolean): CanvasDocument {
  return { id: 'd', workspaceId: 'w', revision: 0, createdAt: '2026-10-20T00:00:00.000Z', updatedAt: '2026-10-20T00:00:00.000Z', title: 'Frames (example data)', description: '', example: true,
    communication: { instructions: '', intent: '', audience: '' }, layout: { mode: 'free' }, selectedIds: [],
    blocks: [card('loose', 0, 0), card('inner', 24, 64, 'f'), card('deep', 16, 56, 'n')],
    groups: [{ id: 'f', title: 'Frame', description: '', blockIds: ['inner'], groupIds: ['n'], position: { x: 0, y: 400 }, layout: { mode: 'free' }, ...(locked === undefined ? {} : { locked }) },
      { id: 'n', title: 'Nested', description: '', blockIds: ['deep'], groupIds: [], parentGroupId: 'f', position: { x: 400, y: 64 }, layout: { mode: 'free' } },
      { id: 's', title: 'Sheet', description: '', blockIds: [], groupIds: [], position: { x: 1200, y: 0 }, sheet: { number: 1, createdAt: '2026-10-20T00:00:00.000Z', source: 'agent' } }],
    links: [],
  } as CanvasDocument;
}

test('a press on a Frame moves it only from its header; its body is canvas; a block always moves', () => {
  const doc = document();
  assert.equal(pressRole(doc, 'f', true), 'move');
  assert.equal(pressRole(doc, 'f', false), 'canvas', 'the body draws a selection box, never moves the Frame');
  assert.equal(pressRole(doc, 'n', false), 'canvas', 'a nested Frame too');
  assert.equal(pressRole(doc, 's', true), 'move', 'a Sheet is a Frame: its header moves it');
  assert.equal(pressRole(doc, 's', false), 'canvas');
  assert.equal(pressRole(doc, 'inner', false), 'move', 'a child inside a Frame moves itself');
  assert.equal(pressRole(doc, 'inner', true), 'move');
});

test('a locked Frame: its header selects but does not move; a drag, a nudge or an align leaves it while the rest moves', () => {
  const doc = document(true);
  assert.equal(pressRole(doc, 'f', true), 'select');
  assert.equal(pressRole(doc, 'f', false), 'canvas');
  assert.deepEqual(movable(doc, ['f', 'inner', 'loose', 'n']), ['inner', 'loose', 'n'], 'children and a nested Frame stay movable');
  assert.deepEqual(movable(document(), ['f', 'loose']), ['f', 'loose']);
  assert.deepEqual(movable(document(false), ['f']), ['f'], 'locked: false is unlocked');
  const rects = layoutDocument(doc, {}, catalog);
  assert.deepEqual(selectionBoxes(doc, rects, ['f', 'loose']).map(b => b.id), ['loose'], 'align and flip see only what may move');
  assert.equal(alignDeltas(selectionBoxes(doc, rects, ['f', 'loose']), 'left').size, 0, 'nothing to align against a locked Frame');
  // A child of a locked Frame still moves on its own, and the Frame stays where it is.
  const moved = reduce(doc, moveOperations(doc, rects, movable(doc, ['inner']), { x: 32, y: 16 }, undefined, { catalog, grid: false }), catalog);
  assert.deepEqual(moved.blocks.find(b => b.id === 'inner')!.position, { x: 56, y: 80 });
  assert.deepEqual(moved.groups.find(g => g.id === 'f')!.position, { x: 0, y: 400 });
});

test('lock position is part of the group model: validated and stored by group.update, by a person or an agent', () => {
  assert.equal(groupSchema.parse({ id: 'g', title: 'G', blockIds: [], locked: true }).locked, true);
  assert.equal(groupSchema.parse({ id: 'g', title: 'G', blockIds: [] }).locked, undefined, 'absent stays absent');
  assert.throws(() => groupSchema.parse({ id: 'g', title: 'G', blockIds: [], locked: 'yes' }));
  assert.deepEqual(groupPatchSchema.parse({ locked: false }), { locked: false });
  assert.throws(() => groupPatchSchema.parse({ locked: 1 }));
  const doc = document(), locked = reduce(doc, [{ type: 'group.update', id: 'f', patch: { locked: true } }], catalog);
  assert.equal(locked.groups.find(g => g.id === 'f')!.locked, true);
  assert.equal(documentSchema.parse(locked).groups.find(g => g.id === 'f')!.locked, true, 'persists through the document schema');
  assert.deepEqual(locked.groups.find(g => g.id === 'f')!.position, { x: 0, y: 400 }, 'locking moves nothing');
  const agent = reduce(locked, [{ type: 'group.update', id: 'f', patch: { locked: false } }], catalog, 'agent');
  assert.equal(agent.groups.find(g => g.id === 'f')!.locked, false, 'an agent may set it too');
});
