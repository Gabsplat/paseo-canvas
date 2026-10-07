import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { setup, mutation, workspaceId } from './helpers';
import { CanvasStore } from '../plugin/server/store';
import { CanvasService } from '../plugin/server/service';
import { canvasPresentation } from '../plugin/client/presentation';
import { selectionPack, forkPack, layoutCanvas } from '../plugin/client/logic';
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
