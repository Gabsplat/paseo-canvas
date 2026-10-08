import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { setup, mutation, workspaceId } from './helpers';
import { CanvasStore } from '../plugin/server/store';
import { CanvasService } from '../plugin/server/service';
import { canvasPresentation } from '../plugin/client/presentation';
import { layoutCanvas } from '../plugin/client/logic';
import { blockTypeSchema, packSchema } from '../plugin/shared/model';
import { retiredRendererNames, rendererNames, isRetiredRenderer, getRendererSpec } from '../plugin/shared/renderers';
import { builtinTypes, builtinPacks, builtinTemplates } from '../plugin/shared/builtins';

const reference = { documentId: 'd', workspaceId };
// Data as the removed built-in types stored it. The block type ID was the renderer name in every case.
const removedBlocks: Record<string, Record<string, unknown>> = {
  choice: { question: '¿Qué muestra la interfaz?', options: ['Cargando', 'Error'], answer: 'Cargando' },
  progress: { current: 2, total: 5 },
  diagram: { nodes: [{ id: 'a', label: 'A' }, { id: 'b', label: 'B' }], edges: [{ id: 'ab', from: 'a', to: 'b', label: 'pasa' }], caption: 'Guardado' },
  'function-plot': { question: '¿Qué cambia?', expressions: [{ expression: 'a*sin(x)', label: 'Onda' }], xRange: [-6, 6], yRange: [-3, 3] },
  'annotated-content': { question: '¿Qué viaja?', base: { kind: 'text', key: 'base', revision: '1', passages: [{ id: 'p', text: 'Una señal viaja.' }] }, layers: [], annotations: [] },
  'step-figure': { question: '¿Qué aparece?', initial: { elements: [] }, steps: [{ caption: 'Paso', patches: [] }] },
  'step-sequencer': { question: '¿Cómo suena?', scale: { root: 'C', mode: 'major', octave: 4 }, rows: [1, 2], steps: 4, pattern: ['x...', '..x.'] },
};
const customType = (id: string, renderer: string) => ({ id, name: `Tipo ${id}`, description: 'Guardado antes de retirar su renderer.', renderer,
  properties: [{ key: 'question', label: 'Pregunta', kind: 'text' as const, required: false }], defaults: { question: '' } as Record<string, string> });

/** Rewrites state.json as an older version left it, then reopens it through the real store and service. */
async function reopen(t: TestContext, edit: (state: any) => void) {
  const { store, directory } = await setup(t);
  await store.close();
  const state = JSON.parse(await readFile(store.file, 'utf8'));
  edit(state);
  await writeFile(store.file, JSON.stringify(state));
  const reopened = new CanvasStore(directory), service = new CanvasService(reopened); t.after(() => reopened.close());
  return { store: reopened, service };
}

test('the retired list names every removed renderer, none of them live, and the type schema still reads them', () => {
  assert.deepEqual([...retiredRendererNames].sort(), ['annotated-content', 'choice', 'diagram', 'function-plot', 'prediction-gate', 'progress', 'step-figure', 'step-sequencer']);
  for (const name of retiredRendererNames) {
    assert.equal(rendererNames.includes(name), false, name); assert.equal(getRendererSpec(name), undefined, name); assert.equal(isRetiredRenderer(name), true);
    assert.ok(blockTypeSchema.safeParse(customType('old', name)).success, name);
    assert.equal(builtinTypes.some(type => type.id === name || type.renderer === name), false, name);
  }
  assert.equal(isRetiredRenderer('note'), false); assert.equal(isRetiredRenderer(undefined), false);
  assert.equal(blockTypeSchema.safeParse(customType('old', 'never-existed')).success, false);
  // Nothing shipped still depends on a removed type.
  const shipped = [...builtinTemplates.flatMap(template => template.blocks), ...builtinPacks.flatMap(pack => pack.documents.flatMap(document => document.blocks))];
  for (const block of shipped) assert.ok(builtinTypes.some(type => type.id === block.typeId), block.typeId);
  for (const pack of builtinPacks) for (const document of pack.documents) assert.equal(document.example, true);
});

test('a stored document with a block of every removed type loads, reads, is editable around them and lets them be deleted', async t => {
  const ids = Object.keys(removedBlocks);
  const { service } = await reopen(t, state => {
    const record = state.documents.d;
    for (const typeId of ids) record.document.blocks.push({ id: `old-${typeId}`, typeId, title: `Guardado ${typeId}`, parentGroupId: null, data: removedBlocks[typeId] });
    record.document.links = [{ id: 'old-link', from: 'old-diagram', to: 'c', kind: 'flow' }];
    record.runtime = { blocks: { 'old-step-sequencer': { pattern: ['xx..', '....'], bpm: 90 }, 'old-step-figure': { step: 0 } }, scopes: {} };
  });
  let view = await service.read(reference);
  const catalog = await service.catalog(), stored = (typeId: string) => view.document.blocks.find(block => block.id === `old-${typeId}`)!;
  for (const typeId of ids) {
    assert.deepEqual(stored(typeId).data, removedBlocks[typeId], typeId); assert.equal(stored(typeId).typeId, typeId);
    // Not insertable: the catalog the client and the agent read does not list the type at all.
    assert.equal(catalog.blockTypes.some(type => type.id === typeId || type.renderer === typeId), false, typeId);
  }
  assert.equal(view.runtime.blocks['old-step-sequencer'].bpm, 90);
  // The client treats them as blocks of an unknown type: nothing hidden, each one still gets a card rectangle.
  const presented = canvasPresentation(view.document, catalog, view.runtime);
  assert.equal(presented.document, view.document); assert.equal(presented.hiddenBy.size, 0);
  const rects = layoutCanvas(view.document, {}, catalog).rects;
  for (const typeId of ids) assert.ok(rects.has(`old-${typeId}`), typeId);
  // Editing around them, and their own title and position, still commits.
  view = await service.mutate(mutation(0, [
    { type: 'block.update', id: 'b', patch: { data: { text: 'new' } } },
    { type: 'block.create', block: { id: 'fresh', typeId: 'note', title: 'Nueva', data: { text: 'junto a las antiguas' } } },
    { type: 'block.update', id: 'old-diagram', patch: { title: 'Renombrado', position: { x: 40, y: 80 } } },
    { type: 'group.create', group: { id: 'g', title: 'Grupo', description: '', blockIds: [], groupIds: [] } },
    { type: 'entity.move', id: 'old-choice', parentGroupId: 'g' },
  ]));
  assert.equal(stored('diagram').title, 'Renombrado'); assert.deepEqual(stored('diagram').data, removedBlocks.diagram); assert.equal(stored('choice').parentGroupId, 'g');
  for (const typeId of ids) await assert.rejects(service.mutate(mutation(1, [{ type: 'block.create', block: { id: `again-${typeId}`, typeId, title: 'Otra', data: removedBlocks[typeId] as any } }])), /Unknown block type/, typeId);
  view = await service.mutate(mutation(1, ids.map(typeId => ({ type: 'block.delete' as const, id: `old-${typeId}` }))));
  assert.deepEqual(view.document.blocks.map(block => block.id).sort(), ['b', 'c', 'fresh']);
  assert.deepEqual(view.document.links, []); assert.deepEqual(view.runtime.blocks, {});
  assert.equal((await service.undo({ ...reference, expectedRevision: 2 })).document.blocks.length, 3 + ids.length);
});

test('a stored catalog whose custom and pack types name retired renderers loads, keeps the data and leaves those types out of the usable catalog', async t => {
  const pack = packSchema.parse({ format: 'paseo-canvas-pack', version: 1, id: 'old', name: 'Pack antiguo', description: 'Importado antes.',
    blockTypes: [...retiredRendererNames.map(name => customType(`old.${name}`, name)), { ...customType('old.plain', 'note'), properties: [{ key: 'text', label: 'Texto', kind: 'text' as const, required: false }], defaults: { text: '' } }],
    templates: [], documents: [] });
  const { service, store } = await reopen(t, state => {
    state.catalog.localTypes = [customType('my-plot', 'function-plot'), customType('my-gate', 'prediction-gate'), { ...customType('my-plain', 'note'), properties: [{ key: 'text', label: 'Texto', kind: 'text' as const, required: false }], defaults: { text: '' } }];
    state.catalog.packs = [pack]; state.catalog.revision = 3;
    state.documents.d.document.blocks.push(
      { id: 'mine', typeId: 'my-plot', title: 'Gráfica propia', parentGroupId: null, data: { question: '¿Qué cambia?' } },
      { id: 'packed', typeId: 'old.prediction-gate', title: 'Apuesta del pack', parentGroupId: null, data: { question: '¿Qué pasa?' } },
      { id: 'plain', typeId: 'my-plain', title: 'Nota propia', parentGroupId: null, data: { text: 'sigue' } });
  });
  let view = await service.read(reference);
  let catalog = await service.catalog();
  assert.equal(catalog.revision, 3);
  // Retired types are absent from blockTypes (so no picker or agent can offer them); the others are untouched.
  assert.equal(catalog.blockTypes.some(type => isRetiredRenderer(type.renderer)), false);
  for (const id of ['my-plot', 'my-gate', ...retiredRendererNames.map(name => `old.${name}`)]) assert.equal(catalog.blockTypes.some(type => type.id === id), false, id);
  for (const id of ['my-plain', 'old.plain', 'note', 'node', 'controls']) assert.ok(catalog.blockTypes.some(type => type.id === id), id);
  // The pack itself is still listed and exports exactly what was imported.
  assert.deepEqual(catalog.packs.find(item => item.id === 'old'), pack); assert.deepEqual(await service.exportPack({ id: 'old' }), pack);
  // Their blocks are preserved as unknown-type blocks and the document stays editable.
  assert.deepEqual(view.document.blocks.find(block => block.id === 'mine')!.data, { question: '¿Qué cambia?' });
  assert.ok(layoutCanvas(view.document, {}, catalog).rects.has('packed'));
  view = await service.mutate(mutation(0, [{ type: 'block.update', id: 'plain', patch: { data: { text: 'editada' } } }, { type: 'block.update', id: 'mine', patch: { title: 'Renombrada' } }, { type: 'block.delete', id: 'packed' }]));
  assert.equal(view.document.blocks.find(block => block.id === 'mine')!.title, 'Renombrada'); assert.equal(view.document.blocks.some(block => block.id === 'packed'), false);
  await assert.rejects(service.mutate(mutation(1, [{ type: 'block.create', block: { id: 'again', typeId: 'my-plot', title: 'Otra', data: {} } }])), /Unknown block type/);
  // Writing the state again keeps the retired entries on disk.
  const disk = JSON.parse(await readFile(store.file, 'utf8'));
  assert.deepEqual(disk.catalog.localTypes.map((type: { renderer: string }) => type.renderer), ['function-plot', 'prediction-gate', 'note']);
  assert.equal(disk.catalog.packs[0].blockTypes.length, retiredRendererNames.length + 1);
  // A type saved now cannot use a retired renderer or take a removed built-in ID; an ordinary save still works.
  await assert.rejects(service.catalogMutate({ expectedRevision: 3, action: { type: 'type.put', blockType: customType('new-plot', 'function-plot') } }), /no longer available/);
  await assert.rejects(service.catalogMutate({ expectedRevision: 3, action: { type: 'type.put', blockType: { ...customType('diagram', 'note'), properties: [], defaults: {} } } }), /no longer available/);
  catalog = await service.catalogMutate({ expectedRevision: 3, action: { type: 'type.put', blockType: { ...customType('my-plot', 'note'), properties: [{ key: 'question', label: 'Pregunta', kind: 'text' as const, required: false }] } } });
  assert.equal(catalog.blockTypes.find(type => type.id === 'my-plot')?.renderer, 'note');
  // A pack imported now is data too: it is accepted, stored whole, and its retired types stay out of the usable catalog.
  const incoming = { ...pack, id: 'later', name: 'Pack nuevo', blockTypes: [customType('later.seq', 'step-sequencer'), customType('later.gate', 'prediction-gate')] };
  assert.deepEqual(await service.validatePack({ pack: incoming }), { valid: true, issues: [] });
  const imported = await service.importPack({ expectedRevision: 4, pack: incoming, replace: false, dryRun: false });
  assert.equal(imported.committed, true); assert.deepEqual(imported.diff.added, ['later.seq', 'later.gate']);
  assert.equal(imported.catalog.blockTypes.some(type => type.id.startsWith('later.')), false);
  assert.deepEqual(await service.exportPack({ id: 'later' }), incoming);
});
