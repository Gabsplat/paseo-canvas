import { registerRendererVisual } from "../plugin/client/renderer-visuals";
import { documentContent, forkPack, selectionPack, layoutCanvas } from "../plugin/client/logic";
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { CanvasStore } from '../plugin/server/store';
import { CanvasService } from '../plugin/server/service';
import { ToolRouter, toolDefinitions, integrationInstructions } from '../plugin/server/tools';
import { feedbackPrompt } from '../plugin/server/feedback';
import { blockTypeSchema, documentSchema, agentActionInputSchema, type CanvasDocument } from '../plugin/shared/model';
import { rendererSpecs, legacyRendererNames, getRendererSpec } from '../plugin/shared/renderers';
import { controlsDataSchema } from '../plugin/shared/renderers/controls';
import { resolveScope, variablesSchema, RUNTIME_BLOCK_BYTES, RUNTIME_DOCUMENT_BYTES, type RuntimeState } from '../plugin/shared/learning';
import * as rpc from '../plugin/shared/rpc';
import { LearningRuntimeStore } from '../plugin/client/learning-state';
import { setup, mutation, workspaceId, content } from './helpers';
const reference = { documentId: 'd', workspaceId };
const emptyRuntime = (): RuntimeState => ({ blocks: {}, scopes: {} });
const variable = (name: string, value = 1) => ({ name, value, min: 0, max: 10, step: .1 });
const runtimeSet = async (service: CanvasService, patch: unknown) => service.runtimeSet(rpc.runtimeSetInputSchema.parse({ ...reference, ...(patch as object) }));
const runtimeRead = (service: CanvasService, blockIds = ['b'], scopeIds: string[] = []) => service.runtimeRead(rpc.runtimeReadInputSchema.parse({ ...reference, blockIds, scopeIds }));
async function withScopes(service: CanvasService) {
  return service.mutate(mutation(0, [
    { type: 'document.update', variables: [variable('x', 1), variable('shared', 2)] },
    { type: 'group.create', group: { id: 'outer', title: 'Outer', description: '', blockIds: [], groupIds: [], variables: [variable('x', 3)] } },
    { type: 'group.create', group: { id: 'inner', title: 'Inner', description: '', blockIds: ['b', 'c'], groupIds: [], parentGroupId: 'outer', variables: [variable('x', 4)] } },
  ]));
}
test('registry validates registered JSON data, keeps the legacy names and exposes agent guidance', async t => {
  const { service } = await setup(t);
  for (const name of legacyRendererNames) assert.ok(blockTypeSchema.shape.renderer.safeParse(name).success);
  assert.ok(blockTypeSchema.shape.renderer.safeParse('controls').success); assert.ok(!blockTypeSchema.shape.renderer.safeParse('unregistered').success);
  for (const spec of rendererSpecs) {
    assert.equal(spec.id, spec.blockType.renderer); assert.ok(spec.guidance.length > 10); assert.ok(spec.dataSchema.safeParse(spec.blockType.defaults).success); assert.ok(getRendererSpec(spec.id));
  }
  const view = await service.mutate(mutation(0, [{ type: 'block.create', block: { id: 'ctrl', title: 'Controles', typeId: 'controls', data: { variables: ['x'], question: '¿Qué cambia al mover x?' } } }]));
  assert.equal(view.document.blocks.at(-1)?.data.question, '¿Qué cambia al mover x?');
  for (const variables of [['invalid-name'], ['x', 'x'], [1], ['a', 'b', 'c', 'd', 'e']]) await assert.rejects(service.mutate(mutation(1, [{ type: 'block.update', id: 'ctrl', patch: { data: { variables } } }])));
  assert.equal((await service.read(reference)).document.revision, 1);
  const router = new ToolRouter(service, async () => ({ workspaceId, agentId: 'a' }));
  const catalog = await router.call('canvas_catalog', { action: 'list' }, 'owner') as any;
  assert.ok(catalog.blockTypes.find((entry: any) => entry.id === 'controls').guidance.includes('data.question'));
  assert.ok(integrationInstructions.includes('canvas_runtime'));
  assert.equal(controlsDataSchema.parse({ variables: [] }).question, '¿Cómo cambia el resultado al ajustar estas variables?');
});
test('runtime uses last-write-wins without revisions/history/undo, coalesces disk writes and survives reopen', async t => {
  const { store, service, directory } = await setup(t);
  const before = await readFile(store.file, 'utf8');
  const first = await runtimeSet(service, { blocks: [{ id: 'b', state: { slider: 2 } }] });
  assert.equal(first.runtimeVersion, 1); assert.equal(await readFile(store.file, 'utf8'), before);
  const second = await runtimeSet(service, { blocks: [{ id: 'b', state: { slider: 3 } }] }); assert.equal(second.runtimeVersion, 2);
  assert.equal((await runtimeSet(service, { blocks: [{ id: 'b', state: { slider: 3 } }] })).runtimeVersion, 2);
  const view = await service.read(reference); assert.equal(view.document.revision, 0); assert.equal(view.canUndo, false); assert.equal((await service.history(reference)).transactions.length, 0);
  await assert.rejects(service.undo({ ...reference, expectedRevision: 0 }), /No undo/);
  const change = await service.watch({ ...reference, knownRevision: 0, knownRuntimeVersion: 0 }); assert.equal(change.view?.runtime.blocks.b.slider, 3);
  await store.flushRuntime(); assert.notEqual(await readFile(store.file, 'utf8'), before);
  await store.close(); const reopened = new CanvasStore(directory); t.after(() => reopened.close());
  assert.deepEqual((await new CanvasService(reopened).read(reference)).runtime.blocks.b, { slider: 3 });
});
test('runtime auto-persistence and close flush pending writes; old state files gain an empty channel', async t => {
  const { service, store, directory } = await setup(t);
  await runtimeSet(service, { blocks: [{ id: 'b', state: { value: 8 } }] });
  await new Promise(resolve => setTimeout(resolve, 350));
  assert.equal(JSON.parse(await readFile(store.file, 'utf8')).documents.d.runtime.blocks.b.value, 8);
  await runtimeSet(service, { blocks: [{ id: 'b', state: { value: 9 } }] }); await store.close();
  const saved = JSON.parse(await readFile(store.file, 'utf8')); assert.equal(saved.documents.d.runtime.blocks.b.value, 9);
  delete saved.documents.d.runtime; await writeFile(store.file, JSON.stringify(saved));
  const reopened = new CanvasStore(directory); t.after(() => reopened.close());
  assert.deepEqual((await new CanvasService(reopened).read(reference)).runtime, emptyRuntime());
});
test('runtime size, unsafe JSON, missing IDs and scope bounds reject atomically', async t => {
  const { service } = await setup(t); await withScopes(service);
  const before = await service.read(reference);
  for (const patch of [
    { blocks: [{ id: 'b', state: { text: 'é'.repeat(RUNTIME_BLOCK_BYTES) } }] },
    { blocks: [{ id: 'b', state: JSON.parse('{"__proto__":{"x":1}}') }] },
    { blocks: [{ id: 'missing', state: {} }] },
    { blocks: [{ id: 'b', state: { ok: 2 } }], scopes: [{ id: 'inner', values: { x: 11 } }] },
    { scopes: [{ id: 'inner', values: { undeclared: 1 } }] },
  ]) await assert.rejects(runtimeSet(service, patch), JSON.stringify(patch));
  assert.deepEqual((await service.read(reference)).runtime, before.runtime);
  assert.equal((await service.read(reference)).runtimeVersion, before.runtimeVersion);
  await assert.rejects(service.runtimeSet(rpc.runtimeSetInputSchema.parse({ ...reference, workspaceId: 'wrong', blocks: [{ id: 'b', state: {} }] })), /workspace/);
});
test('256 KiB document runtime cap rolls back the overflowing block', async t => {
  const { service } = await setup(t), blocks = Array.from({ length: 70 }, (_, i) => ({ id: `r${i}`, typeId: 'note', title: '', data: { text: '' } }));
  await service.mutate(mutation(0, blocks.map(block => ({ type: 'block.create', block }))));
  const state = { text: 'x'.repeat(4000) }; let rejected = false;
  for (const block of blocks) {
    try { await runtimeSet(service, { blocks: [{ id: block.id, state }] }); }
    catch (error) { assert.match(String(error), /256 KiB/); rejected = true; assert.deepEqual((await runtimeRead(service, [block.id])).runtime.blocks, {}); break; }
  }
  assert.equal(rejected, true); assert.ok(Buffer.byteLength(JSON.stringify((await service.read(reference)).runtime)) <= RUNTIME_DOCUMENT_BYTES);
});
test('scope declarations are bounded, nearest ancestor shadows document, and overrides reset to defaults', async t => {
  const { service } = await setup(t); const view = await withScopes(service);
  assert.equal(resolveScope(view.document, 'b', view.runtime).x.current, 4); assert.equal(resolveScope(view.document, 'c', view.runtime).x.scopeId, 'inner'); assert.equal(resolveScope(view.document, 'b', view.runtime).shared.current, 2);
  await runtimeSet(service, { scopes: [{ id: '$document', values: { x: 9 } }, { id: 'inner', values: { x: 7 } }] });
  const current = await service.read(reference); assert.equal(resolveScope(current.document, 'b', current.runtime).x.current, 7);
  await runtimeSet(service, { scopes: [{ id: 'inner', values: { x: null } }] }); assert.equal(resolveScope(current.document, 'b', (await service.read(reference)).runtime).x.current, 4);
  for (const declarations of [[variable('bad-name')], [variable('x'), variable('x')], [variable('__proto__')], Array.from({ length: 25 }, (_, i) => variable(`x${i}`)), [{ ...variable('x'), min: 5 }], [{ ...variable('x'), step: 0 }]]) assert.ok(!variablesSchema.safeParse(declarations).success);
});
test('runtime cleanup covers block/subtree/ungroup deletion and declaration removal, without resurrection on undo', async t => {
  const { service } = await setup(t); await withScopes(service);
  await runtimeSet(service, { blocks: [{ id: 'b', state: { selected: 1 } }], scopes: [{ id: 'inner', values: { x: 8 } }] });
  await service.mutate(mutation(1, [{ type: 'group.delete', id: 'inner', ungroup: true }]));
  let current = await service.read(reference); assert.deepEqual(current.runtime.blocks.b, { selected: 1 }); assert.deepEqual(current.runtime.scopes, {});
  assert.equal(resolveScope(current.document, 'b', current.runtime).x.current, 3);
  await service.undo({ ...reference, expectedRevision: 2 }); current = await service.read(reference); assert.equal(resolveScope(current.document, 'b', current.runtime).x.current, 4);
  await service.mutate(mutation(3, [{ type: 'group.delete', id: 'outer' }])); current = await service.read(reference); assert.deepEqual(current.runtime, emptyRuntime());
  await service.undo({ ...reference, expectedRevision: 4 }); current = await service.read(reference); assert.deepEqual(current.runtime, emptyRuntime());
  await runtimeSet(service, { blocks: [{ id: 'b', state: { selection: 1 } }], scopes: [{ id: '$document', values: { shared: 5 } }] });
  await service.mutate(mutation(5, [{ type: 'block.delete', id: 'b' }, { type: 'document.update', variables: [variable('x')] }]));
  assert.deepEqual((await service.read(reference)).runtime, emptyRuntime());
});
test('revisioned document/group declaration edits undo while unrelated runtime values remain current', async t => {
  const { service } = await setup(t); await withScopes(service);
  await runtimeSet(service, { blocks: [{ id: 'b', state: { value: 2 } }] });
  await service.mutate(mutation(1, [{ type: 'document.update', variables: [variable('x', 5)] }, { type: 'group.update', id: 'inner', patch: { variables: [variable('x', 6)] } }]));
  await runtimeSet(service, { blocks: [{ id: 'b', state: { value: 3 } }] });
  const undone = await service.undo({ ...reference, expectedRevision: 2 }); assert.equal(undone.document.variables?.[0].value, 1); assert.equal(undone.document.groups.find(g => g.id === 'inner')?.variables?.[0].value, 4); assert.equal(undone.runtime.blocks.b.value, 3);
});
test('canvas_runtime MCP reads/sets/resets specific IDs below 24 KiB and enforces caller scope', async t => {
  const { service } = await setup(t); await withScopes(service);
  const router = new ToolRouter(service, async () => ({ workspaceId, agentId: 'a' }));
  assert.ok(toolDefinitions.find(tool => tool.name === 'canvas_runtime'));
  const set = await router.call('canvas_runtime', { action: 'set', documentId: 'd', blocks: [{ id: 'b', state: { value: 3 } }], scopes: [{ id: 'inner', values: { x: 6 } }] }, 'owner') as any;
  assert.equal(set.runtime.blocks.b.value, 3); assert.equal(set.runtime.scopes.inner.x, 6); assert.ok(Buffer.byteLength(JSON.stringify(set)) < 24*1024);
  const read = await router.call('canvas_runtime', { action: 'read', documentId: 'd', blockIds: ['b'], scopeIds: ['inner'] }, 'owner') as any; assert.deepEqual(read.runtime, set.runtime);
  const reset = await router.call('canvas_runtime', { action: 'set', documentId: 'd', blocks: [{ id: 'b', state: null }], scopes: [{ id: 'inner', values: { x: null } }] }, 'owner') as any; assert.deepEqual(reset.runtime, emptyRuntime());
  await assert.rejects(router.call('canvas_runtime', { action: 'read', documentId: 'd', blockIds: ['b','c','d','e','f'] }, 'owner'));
  const outsider = new ToolRouter(service, async () => ({ workspaceId: 'wrong', agentId: 'a' })); await assert.rejects(outsider.call('canvas_runtime', { action: 'read', documentId: 'd', blockIds: ['b'] }, 'owner'), /workspace/);
});
const settled = (eventId: string, kind = 'slider', target = 'b', value = 1) => agentActionInputSchema.parse({ ...reference, expectedRevision: 0, eventId, action: { kind, label: 'Ajustar', payload: { value }, targetIds: [target], delivery: 'batched', settled: true } });
test('settled events coalesce by block/kind beyond 100 drags with compact inherited feedback context', async t => {
  const { service } = await setup(t); await withScopes(service);
  for (let i = 0; i < 105; i++) await service.action(settled(`evt${i}`, 'slider', 'b', i));
  await service.action(settled('other-kind', 'transport')); await service.action(settled('other-block', 'slider', 'c'));
  const events = (await service.events(reference)).events; assert.equal(events.length, 3); assert.equal(events[0].action.payload.value, 104);
  assert.equal(events[0].context.blocks.length, 1); assert.equal(events[0].context.groups.length, 2); assert.deepEqual(events[0].context.links, []);
  assert.ok(feedbackPrompt(events).includes('Explain plainly.')); assert.equal((await service.read(reference)).document.revision, 1);
  assert.equal((await service.action(settled('evt104', 'slider', 'b', 104))).id, 'evt104');
});
test('settled coalescing preserves immutable prepared batches and normal feedback snapshots', async t => {
  const { service } = await setup(t); await service.connect({ ...reference, expectedRevision: 0, connection: { agentId: 'a', workspaceId } });
  await service.action(settled('old')); const batch = await service.prepareFeedbackBatch('d', workspaceId, 'a', true, feedbackPrompt); assert.ok(batch);
  await service.action(settled('new', 'slider', 'b', 2)); const events = (await service.events(reference)).events; assert.equal(events.length, 2); assert.equal(batch!.eventIds[0], 'old'); assert.ok(batch!.prompt.includes('"value":1'));
  const immediate = settled('normal'); immediate.expectedRevision = 1; immediate.action.settled = false; immediate.action.delivery = 'immediate';
  const event = await service.action(immediate); assert.equal(event.context.blocks.length, 2);
  await assert.rejects(service.action({ ...settled('invalid'), action: { ...settled('invalid').action, delivery: 'immediate' } }), /batched/);
});
test('optimistic runtime notifies sibling scopes before network, debounces and reconciles in-flight writes', async t => {
  const { service } = await setup(t), view = await withScopes(service), requests: unknown[] = [];
  const local = new LearningRuntimeStore(async request => { requests.push(request); return service.runtimeSet(request); }, error => { throw error; }); t.after(() => local.reset());
  local.sync(view.document, view.runtimeVersion, view.runtime); let notifications = 0; const unsubscribe = local.subscribe(() => notifications++); t.after(unsubscribe);
  local.setVariable('b', 'x', 5); local.setVariable('b', 'x', 6); local.setBlock('b', { slider: 6 });
  assert.equal(requests.length, 0); assert.equal(resolveScope(view.document, 'c', local.getSnapshot()).x.current, 6); assert.equal(notifications, 3);
  local.sync(view.document, 0, emptyRuntime()); assert.equal(resolveScope(view.document, 'b', local.getSnapshot()).x.current, 6);
  await local.flush(); assert.equal(requests.length, 1); assert.equal((await runtimeRead(service, ['b'], ['inner'])).runtime.scopes.inner.x, 6);
  local.setVariable('b', 'x', null); await local.flush(); assert.equal(resolveScope(view.document, 'c', local.getSnapshot()).x.current, 4);
});
test('optimistic channel preserves newer edits during requests, reports failures and drops deleted/switching entities', async () => {
  const document = documentSchema.parse({ ...content(), id: 'd', workspaceId, revision: 0, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' });
  let release: ((value: any) => void) | undefined, calls = 0;
  const local = new LearningRuntimeStore(async () => { calls++; return new Promise(resolve => { release = resolve; }); }, () => {});
  local.sync(document, 0, emptyRuntime()); local.setBlock('b', { x: 1 }); const flush = local.flush();
  local.setBlock('b', { x: 2 }); release!({ runtimeVersion: 1, runtime: { blocks: { b: { x: 1 } }, scopes: {} } }); await new Promise(resolve => setImmediate(resolve));
  assert.equal(local.getSnapshot().blocks.b.x, 2); assert.equal(calls, 2);
  release!({ runtimeVersion: 2, runtime: { blocks: { b: { x: 2 } }, scopes: {} } }); await flush;
  local.setBlock('b', { x: 3 }); local.sync({ ...document, blocks: document.blocks.filter(b => b.id !== 'b') }, 1, emptyRuntime()); assert.deepEqual(local.getSnapshot().blocks, {});
  local.reset(); assert.deepEqual(local.getSnapshot(), emptyRuntime());
  const failing = new LearningRuntimeStore(async () => { throw new Error('offline'); }, () => {}); failing.sync(document, 0, emptyRuntime()); failing.setBlock('b', { x: 1 }); await assert.rejects(failing.flush(), /offline/); assert.equal(failing.getSnapshot().blocks.b.x, 1); failing.reset();
});

test('document copy/export, selection packs and group templates roundtrip declarations while excluding runtime', async t => {
  const { service } = await setup(t); await withScopes(service);
  await runtimeSet(service, { blocks: [{ id: 'b', state: { privateValue: 8 } }], scopes: [{ id: '$document', values: { shared: 9 } }, { id: 'inner', values: { x: 7 } }] });
  const source = await service.read(reference), catalog = await service.catalog();
  for (const own of [false, true]) {
    const exported = documentContent(source.document, own);
    assert.deepEqual(exported.variables, source.document.variables); assert.deepEqual(exported.groups.map(g => g.variables), source.document.groups.map(g => g.variables));
    assert.equal('runtime' in exported, false); assert.equal('runtimeVersion' in exported, false);
    const copied = await service.create({ id: `copy-${own}`, workspaceId, content: exported });
    assert.deepEqual(copied.runtime, emptyRuntime()); assert.equal(resolveScope(copied.document, 'b', copied.runtime).x.current, 4); assert.equal(resolveScope(copied.document, 'b', copied.runtime).shared.current, 2);
  }
  const selected = selectionPack(source.document, catalog, ['inner']);
  assert.deepEqual(selected.documents[0].variables, source.document.variables); assert.deepEqual(selected.documents[0].groups[0].variables, source.document.groups.find(g => g.id === 'inner')!.variables);
  assert.equal(JSON.stringify(selected).includes('privateValue'), false);
  const forked = forkPack(selected, 'portable-scopes');
  await service.importPack({ expectedRevision: 0, pack: forked, replace: false, dryRun: false });
  const exportedPack = await service.exportPack({ id: 'portable-scopes' }); assert.deepEqual(exportedPack, forked);
  const instantiated = await service.instantiatePack({ workspaceId, packId: 'portable-scopes', documentIndex: 0, id: 'pack-copy' });
  assert.deepEqual(instantiated.runtime, emptyRuntime()); assert.deepEqual(instantiated.document.variables, source.document.variables); assert.equal(resolveScope(instantiated.document, 'b', instantiated.runtime).x.current, 4);
  const { template } = await service.exportGroup({ ...reference, groupId: 'outer', templateId: 'scoped-template', name: 'Scoped template' });
  assert.deepEqual(template.groups.map(g => g.variables), source.document.groups.map(g => g.variables)); assert.equal('runtime' in template, false);
  await service.catalogMutate({ expectedRevision: 1, action: { type: 'template.put', template } });
  const inserted = await service.mutate(mutation(1, [{ type: 'template.insert', templateId: 'scoped-template', idPrefix: 'inserted' }]));
  assert.equal(resolveScope(inserted.document, 'inserted.b', inserted.runtime).x.current, 4); assert.equal(resolveScope(inserted.document, 'inserted.b', inserted.runtime).shared.current, 9);
  assert.equal(inserted.runtime.blocks['inserted.b'], undefined); assert.equal(inserted.runtime.scopes['inserted.inner'], undefined);
});

test('renderer-owned visual width is used by automatic canvas layout without token edits', async t => {
  const { service } = await setup(t);
  await service.mutate(mutation(0, [{ type: 'block.create', block: { id: 'ctrl', typeId: 'controls', title: 'Controls', data: { variables: [] } } }]));
  const dispose = registerRendererVisual('controls', { icon: 'SlidersHorizontal', tone: 'neutro', width: 'wide' }); t.after(dispose);
  const current = await service.read(reference), catalog = await service.catalog();
  const layout = layoutCanvas(current.document, {}, catalog);
  assert.equal(layout.rects.get('ctrl')!.width, 592);
});
