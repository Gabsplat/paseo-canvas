import test from 'node:test';
import assert from 'node:assert/strict';
import { wbDrawDataSchema, strokeLayers, learnerLayerIds, strokeSummary, remapDrawAnchor } from '../plugin/shared/whiteboard';
import { getRendererSpec } from '../plugin/shared/renderers';
import type { CanvasBlock, CanvasOperation } from '../plugin/shared/model';
import { feedbackPrompt } from '../plugin/server/feedback';
import { setup, workspaceId, mutation } from './helpers';

// Real service, store and reducer on a temporary directory. Documents start with the note blocks "b" and "c".
const stroke = (color = 'tinta') => ({ points: [0, 0, 20, 12, 40, 4], color, weight: 'm' });
const draw = (id: string, data: Record<string, unknown> = {}, extra: Partial<CanvasBlock> = {}): CanvasBlock => ({ id, typeId: 'wb-draw', title: '', position: { x: 12, y: 16 }, size: { width: 40, height: 12 }, data: { extent: { width: 40, height: 12 }, strokes: [stroke()], ...data }, ...extra });
const create = (block: CanvasBlock): CanvasOperation => ({ type: 'block.create', block });
const isDraw = (block: { typeId: string }) => block.typeId === 'wb-draw';
const rejects = (code: string) => (error: unknown) => (error as { code?: string }).code === code;

test('drawings without the new fields keep their exact stored shape, and unknown authors or anchors are rejected', async t => {
  const { service } = await setup(t), legacy = { extent: { width: 40, height: 12 }, strokes: [stroke()] };
  assert.deepEqual(wbDrawDataSchema.parse(legacy), legacy, 'A v7 whiteboard document parses to itself: no field is added.');
  const saved = await service.mutate(mutation(0, [create(draw('old'))]));
  assert.deepEqual(saved.document.blocks.find(b => b.id === 'old')!.data, legacy);
  for (const data of [{ author: 'teacher' }, { author: '' }, { anchor: '' }, { anchor: '__proto__' }, { anchor: 'a b' }, { anchor: 7 }, { layer: 'learner' }]) assert.equal(wbDrawDataSchema.safeParse({ ...legacy, ...data }).success, false, JSON.stringify(data));
  assert.deepEqual(new Set(getRendererSpec('wb-draw')!.blockType.properties.map(p => p.key)), new Set(['extent', 'strokes', 'author', 'anchor']));
});
test('the assistant cannot sign a drawing as the learner or relabel an existing one', async t => {
  const { service } = await setup(t);
  let view = await service.mutate(mutation(0, [create(draw('mine', { author: 'learner' })), create(draw('given'))]));
  assert.deepEqual(view.document.blocks.filter(isDraw).map(b => b.data.author), ['learner', undefined], 'The interface writes the learner layer; authored content stays unsigned.');
  view = await service.mutate(mutation(view.document.revision, [create(draw('bot', { author: 'learner' })), create(draw('bot2'))]), 'agent', 'a');
  assert.deepEqual(view.document.blocks.filter(b => b.id.startsWith('bot')).map(b => b.data.author), ['assistant', 'assistant']);
  view = await service.mutate(mutation(view.document.revision, [
    { type: 'block.update', id: 'mine', patch: { data: { author: 'assistant', strokes: [stroke('rojo')] } } },
    { type: 'block.update', id: 'given', patch: { data: { author: 'learner' } } },
    { type: 'block.update', id: 'bot', patch: { data: { author: null } } },
  ]), 'agent', 'a');
  const byId = Object.fromEntries(view.document.blocks.map(b => [b.id, b.data]));
  assert.equal(byId.mine.author, 'learner'); assert.equal((byId.mine.strokes as { color: string }[])[0].color, 'rojo', 'Its other edits still apply.');
  assert.equal('author' in byId.given, false); assert.equal(byId.bot.author, 'assistant');
  // The person using the interface may correct authorship; that path is not the assistant's.
  view = await service.mutate(mutation(view.document.revision, [{ type: 'block.update', id: 'bot2', patch: { data: { author: null } } }]));
  assert.equal('author' in view.document.blocks.find(b => b.id === 'bot2')!.data, false);
});
test('an anchored drawing lives in its card\'s group, follows it between groups and is removed and restored with it', async t => {
  const { service } = await setup(t);
  let view = await service.mutate(mutation(0, [
    { type: 'group.create', group: { id: 'g', title: 'Grupo', description: '', blockIds: ['b'], groupIds: [] } },
    create(draw('note', { author: 'learner', anchor: 'b' })), create(draw('free', { author: 'learner' })), create(draw('other', { anchor: 'c' })),
  ]));
  const block = (id: string) => view.document.blocks.find(b => b.id === id);
  assert.equal(block('note')!.parentGroupId, 'g', 'Created at the root, it joins the group of the card it annotates.');
  assert.deepEqual(view.document.groups[0].blockIds, ['b', 'note']); assert.deepEqual(block('note')!.position, { x: 12, y: 16 }, 'Its offset from the card is untouched.');
  view = await service.mutate(mutation(view.document.revision, [{ type: 'entity.move', id: 'b', parentGroupId: null, position: { x: 400, y: 80 } }]));
  assert.equal(block('note')!.parentGroupId ?? null, null); assert.deepEqual(view.document.groups[0].blockIds, []); assert.deepEqual(block('note')!.position, { x: 12, y: 16 });
  // Moving only the drawing away from its card is corrected rather than leaving it in another coordinate space.
  view = await service.mutate(mutation(view.document.revision, [{ type: 'entity.move', id: 'note', parentGroupId: 'g' }]));
  assert.equal(block('note')!.parentGroupId ?? null, null);
  // "Soltar posición" re-creates a card under the same id in one transaction: its annotations must survive that.
  const card = block('b')!, { position: _position, ...unplaced } = card;
  view = await service.mutate(mutation(view.document.revision, [{ type: 'block.delete', id: 'b' }, { type: 'block.create', block: unplaced }]));
  assert.ok(block('note'), 'A card replaced within one transaction keeps its drawing.'); assert.equal(block('b')!.position, undefined);
  const before = view.document.revision;
  view = await service.mutate(mutation(before, [{ type: 'block.delete', id: 'b' }]));
  assert.deepEqual(view.document.blocks.map(b => b.id).sort(), ['c', 'free', 'other'], 'Only the deleted card\'s annotations go with it.');
  view = await service.undo({ documentId: 'd', workspaceId, expectedRevision: view.document.revision });
  assert.deepEqual(view.document.blocks.map(b => b.id).sort(), ['b', 'c', 'free', 'note', 'other']); assert.equal(block('note')!.data.anchor, 'b');
  view = await service.mutate(mutation(view.document.revision, [{ type: 'group.update', id: 'g', patch: { blockIds: ['c'] } }, { type: 'group.delete', id: 'g' }]));
  assert.deepEqual(view.document.blocks.map(b => b.id).sort(), ['b', 'free', 'note'], 'Deleting a group with a card removes that card\'s annotations too.');
});
test('anchors must be cards; an anchor that was never here stays unresolved instead of blocking the document', async t => {
  const { service } = await setup(t);
  let view = await service.mutate(mutation(0, [create(draw('one', { anchor: 'b' }))]));
  await assert.rejects(service.mutate(mutation(view.document.revision, [create(draw('two', { anchor: 'one' }))])), rejects('VALIDATION'));
  await assert.rejects(service.mutate(mutation(view.document.revision, [{ type: 'block.update', id: 'one', patch: { data: { anchor: 'one' } } }])), rejects('VALIDATION'));
  assert.equal((await service.read({ documentId: 'd', workspaceId })).document.revision, view.document.revision, 'A rejected anchor changes nothing.');
  view = await service.mutate(mutation(view.document.revision, [create(draw('lost', { anchor: 'not-in-this-document', author: 'learner' }))]));
  assert.equal(view.document.blocks.find(b => b.id === 'lost')!.data.anchor, 'not-in-this-document');
  view = await service.mutate(mutation(view.document.revision, [{ type: 'block.update', id: 'c', patch: { title: 'Otra' } }]));
  assert.ok(view.document.blocks.some(b => b.id === 'lost'), 'Later edits do not sweep an unresolved drawing away.');
});
test('copies keep annotations on the right card, and layers describe themselves without points', async t => {
  const { service } = await setup(t);
  let view = await service.mutate(mutation(0, [
    { type: 'group.create', group: { id: 'g', title: 'Grupo', description: '', blockIds: ['b'], groupIds: [] } },
    create(draw('mine', { author: 'learner', anchor: 'b', strokes: [stroke(), stroke('azul')] })), create(draw('loose', { author: 'learner' })),
  ]));
  view = await service.mutate(mutation(view.document.revision, [create(draw('hint', { anchor: 'b' })), create(draw('given', { author: 'learner' }))]), 'agent', 'a');
  view = await service.mutate(mutation(view.document.revision, [{ type: 'block.update', id: 'given', patch: { data: { author: null } } }, { type: 'entity.duplicate', id: 'g', idPrefix: 'copy' }, { type: 'entity.duplicate', id: 'mine', idPrefix: 'solo' }]));
  const data = (id: string) => view.document.blocks.find(b => b.id === id)!.data;
  assert.equal(data('copy.mine').anchor, 'copy.b', 'Inside a copied group the annotation points at the copied card.'); assert.equal(data('copy.hint').author, 'assistant');
  assert.equal(data('solo.mine').anchor, 'b', 'A copied annotation alone keeps annotating the original card.');
  assert.deepEqual(remapDrawAnchor({ anchor: 'x', strokes: [] }, new Map()), { anchor: 'x', strokes: [] });
  const layers = strokeLayers(view.document.blocks, isDraw);
  assert.deepEqual(learnerLayerIds(layers).sort(), ['copy.mine', 'loose', 'mine', 'solo.mine']);
  const summary = strokeSummary(view.document.blocks, isDraw);
  assert.deepEqual(summary, { learner: { drawings: 4, strokes: 7 }, assistant: { strokes: 2 }, authored: { strokes: 1 }, anchors: [{ id: 'b', title: 'B' }, { id: 'copy.b', title: 'B' }] });
  assert.equal(JSON.stringify(summary).includes('points'), false);
  // "Borrar mis trazos": one ordinary transaction, one undo.
  const reset = await service.mutate({ ...mutation(view.document.revision, learnerLayerIds(layers).map(id => ({ type: 'block.delete' as const, id }))), label: 'Borrar mis trazos' });
  assert.deepEqual(strokeLayers(reset.document.blocks, isDraw).map(l => [l.id, l.author]).sort(), [['copy.hint', 'assistant'], ['given', 'authored'], ['hint', 'assistant']]);
  const undone = await service.undo({ documentId: 'd', workspaceId, expectedRevision: reset.document.revision });
  assert.equal(strokeLayers(undone.document.blocks, isDraw).length, 7);
  const event = await service.action({ documentId: 'd', workspaceId, expectedRevision: undone.document.revision, eventId: 'ask-strokes', action: { kind: 'ask', label: 'Preguntar', payload: {}, targetIds: ['mine', 'hint'], delivery: 'immediate' } });
  const prompt = feedbackPrompt([event]);
  assert.match(prompt, /"author":"learner","anchor":"b"/); assert.match(prompt, /"author":"assistant"/); assert.doesNotMatch(prompt, /"points"/);
});
