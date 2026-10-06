import test from 'node:test';
import assert from 'node:assert/strict';
import { setup, mutation, workspaceId } from './helpers';
import { predictionGateDataSchema, createPredictionAttempt, editPrediction, commitPrediction, revealPrediction } from '../plugin/shared/renderers/prediction-gate';
import { canvasPresentation } from '../plugin/client/presentation';
import { documentContent, selectionPack, forkPack } from '../plugin/client/logic';

const reference = { documentId: 'd', workspaceId };
const data = predictionGateDataSchema.parse({ question: '¿Qué cambia?', targetBlockId: 'c', mode: 'numeric', min: 0, max: 10, outcome: { value: 7 } });
const prepared = () => commitPrediction(data, editPrediction(data, createPredictionAttempt(data, 'evt_pg_integration'), { mode: 'numeric', value: 3 }));

test('registered variants create and switch without stale defaults; partial updates and invalid-write rollback remain intact', async t => {
  const { service } = await setup(t);
  let view = await service.mutate(mutation(0, [{ type: 'block.create', block: { id: 'gate', typeId: 'prediction-gate', title: 'Apuesta', data: { question: 'Pregunta', targetBlockId: 'c' } } }]));
  assert.equal(view.document.blocks.find(b => b.id === 'gate')!.data.mode, 'choice');
  view = await service.mutate(mutation(1, [{ type: 'block.update', id: 'gate', patch: { data } }]));
  assert.deepEqual(view.document.blocks.find(b => b.id === 'gate')!.data, data);
  view = await service.mutate(mutation(2, [{ type: 'block.update', id: 'gate', patch: { data: { outcome: { value: 8 } } } }]));
  assert.deepEqual(view.document.blocks.find(b => b.id === 'gate')!.data, { ...data, outcome: { value: 8 } });
  await assert.rejects(service.mutate(mutation(3, [{ type: 'block.update', id: 'gate', patch: { data: { mode: 'curve' } } }])));
  assert.deepEqual((await service.read(reference)).document, view.document);
});

test('registered gate hides arbitrary content through runtime changes and closes after reset or definition changes', async t => {
  const { service } = await setup(t);
  let view = await service.mutate(mutation(0, [{ type: 'block.create', block: { id: 'gate', typeId: 'prediction-gate', title: 'Apuesta', data } }]));
  const catalog = await service.catalog();
  const presented = () => canvasPresentation(view.document, catalog, view.runtime);
  assert.deepEqual(presented().hiddenBy.get('c'), ['gate']);
  await service.runtimeSet({ ...reference, blocks: [{ id: 'gate', state: prepared() }], scopes: [] });
  view = await service.read(reference); assert.equal(presented().document.blocks.find(b => b.id === 'c')!.title, 'Resultado oculto');
  const revealed = revealPrediction(data, prepared(), view.document, 'gate');
  await service.runtimeSet({ ...reference, blocks: [{ id: 'gate', state: revealed }], scopes: [] });
  view = await service.read(reference); assert.equal(presented().hiddenBy.size, 0);
  assert.equal(presented().document.blocks.find(b => b.id === 'c')!.data.text, 'other');
  view = await service.mutate(mutation(1, [{ type: 'block.update', id: 'gate', patch: { data: { question: 'Otra pregunta' } } }]));
  assert.deepEqual(presented().hiddenBy.get('c'), ['gate']);
  assert.equal(view.document.blocks.find(b => b.id === 'c')!.data.text, 'other');
  await service.runtimeSet({ ...reference, blocks: [{ id: 'gate', state: null }], scopes: [] });
  view = await service.read(reference); assert.deepEqual(presented().hiddenBy.get('c'), ['gate']);
});

test('group duplication and template insertion remap gate targets; copies and packs preserve authored data without runtime', async t => {
  const { service } = await setup(t);
  let view = await service.mutate(mutation(0, [
    { type: 'block.create', block: { id: 'gate', typeId: 'prediction-gate', title: 'Apuesta', data } },
    { type: 'block.create', block: { id: 'external', typeId: 'prediction-gate', title: 'Apuesta externa', data: { ...data, targetBlockId: 'b' } } },
    { type: 'group.create', group: { id: 'lesson', title: 'Lección', description: '', groupIds: [], blockIds: ['gate', 'external', 'c'] } },
  ]));
  await service.runtimeSet({ ...reference, blocks: [{ id: 'gate', state: revealPrediction(data, prepared(), view.document, 'gate') }], scopes: [] });
  const { template } = await service.exportGroup({ ...reference, groupId: 'lesson', templateId: 'gate-template', name: 'Apuesta y resultado' });
  await service.catalogMutate({ expectedRevision: 0, action: { type: 'template.put', template } });
  view = await service.mutate(mutation(1, [
    { type: 'entity.duplicate', id: 'lesson', idPrefix: 'copy' },
    { type: 'template.insert', templateId: 'gate-template', idPrefix: 'insert' },
    { type: 'entity.duplicate', id: 'gate', idPrefix: 'single' },
  ]));
  for (const prefix of ['copy', 'insert']) {
    assert.equal(view.document.blocks.find(b => b.id === `${prefix}.gate`)!.data.targetBlockId, `${prefix}.c`);
    assert.equal(view.document.blocks.find(b => b.id === `${prefix}.external`)!.data.targetBlockId, 'b');
    assert.equal(view.runtime.blocks[`${prefix}.gate`], undefined);
  }
  assert.equal(view.document.blocks.find(b => b.id === 'single.gate')!.data.targetBlockId, 'c');
  const catalog = await service.catalog();
  const visible = canvasPresentation(view.document, catalog, view.runtime);
  assert.ok(visible.hiddenBy.has('copy.c') && visible.hiddenBy.has('insert.c'));
  const own = await service.create({ id: 'own', workspaceId, content: documentContent(view.document, true) });
  assert.equal(own.document.blocks.find(b => b.id === 'gate')!.data.targetBlockId, 'c');
  assert.deepEqual(own.runtime, { blocks: {}, scopes: {} });
  const pack = forkPack(selectionPack(view.document, catalog, ['lesson']), 'gate-portable');
  await service.importPack({ expectedRevision: 1, pack, replace: false, dryRun: false });
  assert.deepEqual(await service.exportPack({ id: 'gate-portable' }), pack);
  const copy = await service.instantiatePack({ workspaceId, packId: 'gate-portable', documentIndex: 0, id: 'pack-gates' });
  assert.equal(copy.document.blocks.find(b => b.id === 'gate')!.data.targetBlockId, 'c');
  assert.deepEqual(copy.runtime, { blocks: {}, scopes: {} });
  assert.ok(canvasPresentation(copy.document, await service.catalog(), copy.runtime).hiddenBy.has('c'));
});
