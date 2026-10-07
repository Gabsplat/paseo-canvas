import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { setup, mutation, workspaceId } from './helpers';
import { CanvasStore } from '../plugin/server/store';
import { CanvasService } from '../plugin/server/service';
import { canvasPresentation } from '../plugin/client/presentation';
import { selectionPack, forkPack, layoutCanvas } from '../plugin/client/logic';
import { annotatedContentDataSchema, initialAnnotatedState, readAnnotatedState, resolveAnnotatedAnchor } from '../plugin/shared/renderers/annotated-content';
import { stepFigureDataSchema } from '../plugin/shared/renderers/step-figure';
import { glslShaderDataSchema } from '../plugin/shared/renderers/glsl-shader';

const reference = { documentId: 'd', workspaceId };

test('registered shaders preserve GLSL for compiler diagnostics and reject undeclared uniforms or oversized source atomically', async t => {
  const { service } = await setup(t);
  let view = await service.mutate(mutation(0, [{ type: 'block.create', block: { id: 'shader', typeId: 'glsl-shader', title: 'Shader', data: {} } }]));
  const initial = glslShaderDataSchema.parse(view.document.blocks.find(b => b.id === 'shader')!.data);
  assert.equal(initial.maxPixelSize, 512); assert.equal(initial.uniforms.length, 1);
  const invalidSyntax = 'precision mediump float;\nuniform vec2 u_resolution;\nuniform float frequency;\nvoid main() { compiler_error }';
  view = await service.mutate(mutation(1, [{ type: 'block.update', id: 'shader', patch: { data: { fragmentSource: invalidSyntax } } }]));
  assert.equal(view.document.blocks.find(b => b.id === 'shader')!.data.fragmentSource, invalidSyntax);
  for (const source of [invalidSyntax + '\nuniform sampler2D undeclared;', invalidSyntax + '\n//' + '😀'.repeat(1100)]) {
    await assert.rejects(service.mutate(mutation(2, [{ type: 'block.update', id: 'shader', patch: { data: { fragmentSource: source } } }])));
    assert.deepEqual((await service.read(reference)).document, view.document);
  }
});

test('registered step figures enforce atomic replay before committing authored patches', async t => {
  const { service } = await setup(t);
  const view = await service.mutate(mutation(0, [{ type: 'block.create', block: { id: 'figure', typeId: 'step-figure', title: 'Figura', data: {} } }]));
  const figure = stepFigureDataSchema.parse(view.document.blocks.find(b => b.id === 'figure')!.data);
  const invalidSteps = figure.steps.map(step => ({ ...step, patches: [...step.patches, { op: 'remove', id: 'missing' }] }));
  await assert.rejects(service.mutate(mutation(1, [{ type: 'block.update', id: 'figure', patch: { data: { steps: invalidSteps } } }])));
  assert.deepEqual((await service.read(reference)).document, view.document);
  await service.runtimeSet({ ...reference, blocks: [{ id: 'figure', state: { step: 1, visited: [0, 1] } }], scopes: [] });
  const after = await service.read(reference);
  assert.equal(after.document.revision, 1); assert.deepEqual(after.document, view.document);
});

test('registered annotations validate authored data, preserve obsolete anchors after edits, and export without learner runtime', async t => {
  const { service } = await setup(t);
  const textData = annotatedContentDataSchema.parse({ question: '¿Qué viaja?', base: { kind: 'text', key: 'base', revision: '1', passages: [{ id: 'p', text: 'Una señal viaja.' }] },
    layers: [{ id: 'layer', name: 'Señal', visible: true }], annotations: [{ id: 'a', title: 'Señal', text: 'Observa la señal.',
      anchor: { kind: 'text-range', baseKey: 'base', baseRevision: '1', layerId: 'layer', passageId: 'p', passageText: 'Una señal viaja.', start: 4, end: 9 } }] });
  let view = await service.mutate(mutation(0, [{ type: 'block.create', block: { id: 'annotation', typeId: 'annotated-content', title: 'Lectura', data: textData } }]));
  assert.deepEqual(view.document.blocks.find(b => b.id === 'annotation')!.data, textData);
  await service.runtimeSet({ ...reference, blocks: [{ id: 'annotation', state: { ...initialAnnotatedState(textData), selected: 'a', explored: ['a'] } }], scopes: [] });
  view = await service.mutate(mutation(1, [{ type: 'block.update', id: 'annotation', patch: { data: { base: { passages: [{ id: 'p', text: 'Una cosa viaja.' }] } } } }]));
  const changed = annotatedContentDataSchema.parse(view.document.blocks.find(b => b.id === 'annotation')!.data);
  assert.match(resolveAnnotatedAnchor(changed, changed.annotations[0].anchor).message, /texto del pasaje cambió/);
  assert.equal(readAnnotatedState(changed, view.runtime.blocks.annotation).selected, null);
  assert.deepEqual(changed.annotations, textData.annotations);
  await assert.rejects(service.mutate(mutation(2, [{ type: 'block.update', id: 'annotation', patch: { data: { annotations: [{ ...changed.annotations[0], anchor: { ...changed.annotations[0].anchor, start: 100 } }] } } }])));
  assert.deepEqual((await service.read(reference)).document, view.document);
  const catalog = await service.catalog(), pack = forkPack(selectionPack(view.document, catalog, ['annotation']), 'annotation-pack');
  await service.importPack({ expectedRevision: 0, pack, replace: false, dryRun: false });
  assert.deepEqual(await service.exportPack({ id: 'annotation-pack' }), pack);
  const copy = await service.instantiatePack({ workspaceId, packId: 'annotation-pack', documentIndex: 0, id: 'annotation-copy' });
  assert.deepEqual(copy.document.blocks[0].data, changed); assert.deepEqual(copy.runtime, { blocks: {}, scopes: {} });
  assert.equal(resolveAnnotatedAnchor(changed, changed.annotations[0].anchor).resolved, false);
  const imageData = annotatedContentDataSchema.parse({ ...textData, base: { kind: 'image', key: 'image', revision: '2', url: 'https://example.org/figure.png', alt: 'Referencia declarada', aspectRatio: 2 }, annotations: [] });
  view = await service.mutate(mutation(2, [{ type: 'block.update', id: 'annotation', patch: { data: imageData } }]));
  assert.deepEqual(view.document.blocks.find(b => b.id === 'annotation')!.data, imageData);
});

test('a stored document keeps a block whose renderer type left the catalog: it loads, reads, lays out and stays editable', async t => {
  const { store, directory } = await setup(t);
  await store.close();
  const state = JSON.parse(await readFile(store.file, 'utf8')), record = state.documents.d;
  const retired = { id: 'gate', typeId: 'prediction-gate', title: 'Apuesta guardada', parentGroupId: null,
    data: { question: '¿Qué cambia?', targetBlockId: 'c', mode: 'choice', options: [{ id: 'a', label: 'Aumenta' }, { id: 'b', label: 'Disminuye' }], outcome: { choiceId: 'a' } } };
  record.document.blocks.push(retired);
  record.document.links = [...(record.document.links ?? []), { id: 'gate-c', from: 'gate', to: 'c', label: 'oculta', kind: 'flow' }];
  record.runtime = { blocks: { gate: { version: 1, phase: 'draft', prediction: null } }, scopes: {} };
  await writeFile(store.file, JSON.stringify(state));
  const reopened = new CanvasStore(directory), service = new CanvasService(reopened); t.after(() => reopened.close());
  let view = await service.read(reference);
  const catalog = await service.catalog(), stored = () => view.document.blocks.find(b => b.id === 'gate')!;
  assert.equal(catalog.blockTypes.some(type => type.id === 'prediction-gate' || type.renderer === 'prediction-gate'), false);
  assert.equal(stored().typeId, 'prediction-gate'); assert.deepEqual(stored().data, retired.data);
  // The client shows it as an unknown type: nothing is hidden and it still gets a card rectangle.
  const presented = canvasPresentation(view.document, catalog, view.runtime);
  assert.equal(presented.document, view.document); assert.equal(presented.hiddenBy.size, 0); assert.equal(presented.activeGates.size, 0);
  assert.ok(layoutCanvas(view.document, {}, catalog).rects.has('gate'));
  view = await service.mutate(mutation(0, [{ type: 'block.update', id: 'b', patch: { data: { text: 'new' } } }, { type: 'block.update', id: 'gate', patch: { title: 'Renombrada' } }]));
  assert.equal(stored().title, 'Renombrada'); assert.deepEqual(stored().data, retired.data);
  await assert.rejects(service.mutate(mutation(1, [{ type: 'block.create', block: { id: 'again', typeId: 'prediction-gate', title: 'Otra', data: retired.data } }])), /Unknown block type/);
  view = await service.mutate(mutation(1, [{ type: 'block.delete', id: 'gate' }]));
  assert.equal(view.document.blocks.some(b => b.id === 'gate'), false); assert.equal(view.runtime.blocks.gate, undefined);
});
