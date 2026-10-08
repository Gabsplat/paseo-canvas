import test from 'node:test';
import { registerHooks } from 'node:module';
import { Platform } from './fixtures/native-headless';
import assert from 'node:assert/strict';
import { builtinPacks, builtinTemplates, builtinTypes } from '../plugin/shared/builtins';
import { documentSchema, mutateInputSchema, type CanvasCatalog, type CanvasOperation } from '../plugin/shared/model';
import { communicationOperation, dataProperties, layoutOperations, leaveGroupOperations, panelShortcut, reorderOperation, toolbarPosition, typeSlot } from '../plugin/client/panel-actions';
import { connectOperations, groupOperations, instructionLevels, layoutDocument, selectionPack } from '../plugin/client/logic';
import { reduce } from '../plugin/server/reducer';
import { CanvasStore } from '../plugin/server/store';
import { CanvasService } from '../plugin/server/service';
import { LearningRuntimeStore } from '../plugin/client/learning-state';
import { mutation, setup, workspaceId } from './helpers';
const catalog: CanvasCatalog = { revision: 0, blockTypes: builtinTypes, templates: builtinTemplates, packs: builtinPacks, extensions: [] };
const fixture = () => documentSchema.parse({ id: 'd', workspaceId, title: 'Panel example', description: '', example: true, revision: 0, createdAt: '2026-10-06T00:00:00.000Z', updatedAt: '2026-10-06T00:00:00.000Z', selectedIds: [], communication: { instructions: 'Document', intent: '', audience: '' }, groups: [{ id: 'g', title: 'Group', description: '', blockIds: ['a', 'b'], groupIds: [], position: { x: 50, y: 60 }, layout: { mode: 'stack' }, communication: { instructions: 'Group', intent: 'Intent', audience: 'Audience' }, variables: [{ name: 'x', label: 'X', value: 2, min: 0, max: 10 }] }], blocks: [{ id: 'a', typeId: 'note', title: 'A', parentGroupId: 'g', data: { text: 'Authored text' } }, { id: 'b', typeId: 'node', title: 'B', parentGroupId: 'g', data: { status: 'Nuevo' } }, { id: 'c', typeId: 'note', title: 'C', data: { text: 'Other' } }], links: [] });
function apply(operations: CanvasOperation[], doc = fixture()) { const parsed = mutateInputSchema.parse({ workspaceId, documentId: doc.id, expectedRevision: doc.revision, operations }); return reduce(doc, parsed.operations, catalog); }
test('instruction edits preserve read-only intent/audience and inheritance, clearing removes all three local fields', () => {
  const before = fixture(), changed = apply([communicationOperation(before, 'g', { instructions: 'New instruction' })], before);
  assert.deepEqual(changed.groups[0].communication, { instructions: 'New instruction', intent: 'Intent', audience: 'Audience' });
  assert.deepEqual(instructionLevels(changed, changed.blocks[0]).map(level => level.id), ['g', 'd']);
  const clear = apply([communicationOperation(changed, 'g', { instructions: '', intent: '', audience: '' })], changed);
  assert.deepEqual(instructionLevels(clear, clear.blocks[0]).map(level => level.id), ['d']);
  const own = apply([communicationOperation(changed, 'a', { instructions: 'Own' })], changed); assert.deepEqual(instructionLevels(own, own.blocks[0]).map(level => level.id), ['a', 'g', 'd']);
  assert.throws(() => communicationOperation(before, 'missing', { instructions: 'x' }));
});
test('group layout changes to Libre freeze children in one validated transaction and preserve variables/data', () => {
  const before = fixture(), rects = layoutDocument(before, {}, catalog), operations = layoutOperations(before, 'g', { mode: 'free' }, rects, catalog);
  assert.equal(operations.at(-1)?.type, 'group.update'); assert.ok(operations.some(op => op.type === 'entity.move'));
  const after = apply(operations, before), next = layoutDocument(after, {}, catalog);
  for (const id of ['a', 'b']) { assert.equal(next.get(id)!.x, rects.get(id)!.x); assert.equal(next.get(id)!.y, rects.get(id)!.y); }
  assert.deepEqual(after.groups[0].variables, before.groups[0].variables); assert.deepEqual(after.blocks.map(b => b.data), before.blocks.map(b => b.data));
  assert.deepEqual(layoutOperations(before, 'missing', { mode: 'free' }, rects, catalog), []);
});
test('Sacar del grupo preserves world positions and rejects mixed parents', () => {
  const before = fixture(), rects = layoutDocument(before, {}, catalog), after = apply(leaveGroupOperations(before, ['a', 'b'], rects), before);
  assert.equal(after.blocks[0].parentGroupId, null); assert.equal(after.blocks[1].parentGroupId, null);
  for (const id of ['a', 'b']) assert.deepEqual(after.blocks.find(b => b.id === id)!.position, { x: rects.get(id)!.x, y: rects.get(id)!.y });
  assert.deepEqual(leaveGroupOperations(before, ['a', 'c'], rects), []);
  const nested = fixture(); nested.groups.push({ id: 'outer', title: 'Outer', description: '', blockIds: [], groupIds: ['g'], position: { x: 400, y: 300 } }); nested.groups[0].parentGroupId = 'outer';
  const geometry = layoutDocument(nested, {}, catalog), moved = apply(leaveGroupOperations(nested, ['a'], geometry), nested);
  assert.equal(moved.blocks[0].parentGroupId, 'outer'); assert.deepEqual(moved.blocks[0].position, { x: geometry.get('a')!.x - geometry.get('outer')!.x, y: geometry.get('a')!.y - geometry.get('outer')!.y });
});
test('Mover antes/después have boundary states and keep membership intact', () => {
  const before = fixture(); assert.deepEqual(reorderOperation(before, 'a', -1), []); assert.deepEqual(reorderOperation(before, 'b', 1), []);
  const after = apply(reorderOperation(before, 'a', 1), before); assert.deepEqual(after.groups[0].blockIds, ['b', 'a']); assert.equal(after.blocks[0].parentGroupId, 'g');
});
test('leaving a group with a card and its annotation preserves the anchor offset and moves the card once', () => {
  const before = apply([{ type: 'block.create', block: { id: 'ink', typeId: 'wb-draw', title: '', parentGroupId: 'g', position: { x: 12, y: 18 }, size: { width: 80, height: 24 }, data: { extent: { width: 80, height: 24 }, strokes: [{ points: [0, 0, 80, 24], color: 'azul', weight: 'm' }], author: 'learner', anchor: 'a' } } }]);
  const rects = layoutDocument(before, {}, catalog), operations = leaveGroupOperations(before, ['a', 'ink'], rects);
  const after = apply(operations, before), nextRects = layoutDocument(after, {}, catalog), newInk = nextRects.get('ink')!, card = nextRects.get('a')!, layer = after.blocks.find(b => b.id === 'ink')!;
  assert.deepEqual(layer.position, { x: 12, y: 18 });
  assert.equal(layer.data.anchor, 'a'); assert.equal(layer.parentGroupId, null);
  assert.deepEqual(after.blocks.find(b => b.id === 'a')!.position, { x: rects.get('a')!.x, y: rects.get('a')!.y });
  assert.deepEqual({ x: newInk.x - card.x, y: newInk.y - card.y }, { x: 12, y: 18 }, 'The annotation follows any existing overlap resolution of the card.');
  assert.deepEqual(operations.filter(op => op.type === 'entity.move').map(op => op.id), ['a']);
});
test('leaving a group with only an annotation detaches it and preserves its world position and strokes', () => {
  const before = apply([{ type: 'block.create', block: { id: 'ink', typeId: 'wb-draw', title: '', parentGroupId: 'g', position: { x: 12, y: 18 }, size: { width: 80, height: 24 }, data: { extent: { width: 80, height: 24 }, strokes: [{ points: [0, 0, 80, 24], color: 'azul', weight: 'm' }], author: 'learner', anchor: 'a' } } }]);
  const rects = layoutDocument(before, {}, catalog), oldInk = rects.get('ink')!;
  const after = apply(leaveGroupOperations(before, ['ink'], rects), before), layer = after.blocks.find(b => b.id === 'ink')!, newInk = layoutDocument(after, {}, catalog).get('ink')!;
  assert.equal(layer.parentGroupId, null); assert.equal(layer.data.anchor, undefined);
  assert.deepEqual(layer.data.strokes, before.blocks.find(b => b.id === 'ink')!.data.strokes);
  assert.deepEqual({ x: newInk.x, y: newInk.y }, { x: oldInk.x, y: oldInk.y });
  assert.equal(after.blocks.find(b => b.id === 'a')!.parentGroupId, 'g');
});
test('type slots use renderer aliases and Datos excludes in-place fields only outside compact', () => {
  for (const [id, kind] of [['node', 'status'], ['code', 'language'], ['preview', 'url'], ['media', 'url'], ['glsl-shader', 'reset']] as const) {
    const type = builtinTypes.find(t => t.id === id)!; assert.ok(type, id); assert.equal(typeSlot({ ...type, id: 'custom-alias' })?.kind, kind);
  }
  const note = builtinTypes.find(t => t.id === 'note')!; assert.equal(typeSlot(note), undefined); assert.deepEqual(dataProperties(note), []); assert.ok(dataProperties(note, true).some(p => p.key === 'text'));
  assert.equal(typeSlot()?.kind, 'data');
});
test('keyboard actions distinguish ungroup, duplicate and ask while writes are disabled', () => {
  assert.equal(panelShortcut('g', true, true, 1, true, false), 'ungroup'); assert.equal(panelShortcut('g', true, true, 1, false, false), undefined);
  assert.equal(panelShortcut('d', true, false, 2, false, false), 'duplicate'); assert.equal(panelShortcut('d', false, false, 2, false, false), undefined);
  assert.equal(panelShortcut('l', false, false, 2, false, false), 'connect'); assert.equal(panelShortcut('l', false, false, 3, false, false), undefined);
  assert.equal(panelShortcut('a', false, false, 1, false, true), 'ask'); assert.equal(panelShortcut('g', true, false, 2, false, true), undefined);
});
test('toolbar clamps at either edge, flips below the top boundary and stays above oversized selections', () => {
  const camera = { scale: 1, offset: { x: 0, y: 0 } }, viewport = { width: 600, height: 700 };
  assert.equal(toolbarPosition(camera, { x: 0, y: 200, width: 20, height: 50 }, viewport, 320).left, 8);
  assert.equal(toolbarPosition(camera, { x: 700, y: 200, width: 20, height: 50 }, viewport, 320).left, 272);
  assert.equal(toolbarPosition(camera, { x: 0, y: 0, width: 20, height: 50 }, viewport, 320).top, 68);
  assert.ok(toolbarPosition(camera, { x: 0, y: -200, width: 20, height: 1000 }, viewport, 320).top >= 68);
  assert.equal(toolbarPosition(camera, { x: 300, y: 300, width: 0, height: 0 }, viewport, 320, false, { x: 300, y: 250 }).top, 312);
  assert.equal(toolbarPosition(camera, { x: 300, y: 300, width: 0, height: 0 }, viewport, 320, true).top, 240);
});
test('group/create-link/ungroup actions persist, undo as whole edits and reject stale revisions', async t => {
  const { service, store: firstStore, directory } = await setup(t); const start = await service.read({ workspaceId, documentId: 'd' });
  const operations = groupOperations(start.document, layoutDocument(start.document, {}, catalog), ['b', 'c'], 'g', catalog);
  let view = await service.mutate(mutation(0, operations)); assert.equal(view.document.groups[0].id, 'g'); assert.equal(view.document.groups[0].blockIds.length, 2);
  const connect = connectOperations(view.document, 'b', 'c'); view = await service.mutate(mutation(view.document.revision, connect.operations)); const link = view.document.links[0];
  view = await service.mutate(mutation(view.document.revision, [{ type: 'link.update', id: link.id, patch: { label: 'Real label', kind: 'depends', tone: 'violeta' } }]));
  const revision = view.document.revision; await assert.rejects(service.mutate(mutation(revision - 1, [{ type: 'link.update', id: link.id, patch: { label: 'Stale' } }])), /REVISION_CONFLICT|revision/i);
  view = await service.undo({ workspaceId, documentId: 'd', expectedRevision: revision }); assert.equal(view.document.links[0].label, undefined);
  view = await service.undo({ workspaceId, documentId: 'd', expectedRevision: view.document.revision }, 'user', true); assert.equal(view.document.links[0].label, 'Real label');
  view = await service.mutate(mutation(view.document.revision, [{ type: 'group.delete', id: 'g', ungroup: true }])); assert.equal(view.document.groups.length, 0); assert.equal(view.document.blocks.length, 2); assert.equal(view.document.links[0].id, link.id);
  view = await service.undo({ workspaceId, documentId: 'd', expectedRevision: view.document.revision }); assert.equal(view.document.groups.length, 1);
  await firstStore.close();
  const store = new CanvasStore(directory); t.after(() => store.close()); const reopened = await new CanvasService(store).read({ workspaceId, documentId: 'd' }); assert.equal(reopened.document.links[0].label, 'Real label');
  const pack = selectionPack(view.document, catalog, ['g']); assert.equal(pack.documents[0].links[0].label, 'Real label');
});
test('toolbar reset clears only the block runtime, preserving scopes, authored data and content revision', async t => {
  const { service } = await setup(t); let view = await service.mutate(mutation(0, [{ type: 'document.update', variables: [{ name: 'x', value: 1, min: 0, max: 10 }] }]));
  await service.runtimeSet({ workspaceId, documentId: 'd', blocks: [{ id: 'b', state: { step: 3 } }], scopes: [{ id: '$document', values: { x: 7 } }] });
  view = await service.read({ workspaceId, documentId: 'd' }); const before = structuredClone(view.document);
  const learning = new LearningRuntimeStore(request => service.runtimeSet(request), error => { throw error; }); learning.sync(view.document, view.runtimeVersion, view.runtime);
  learning.setBlock('b', null); await learning.flush(); const after = await service.read({ workspaceId, documentId: 'd' });
  assert.equal(after.runtime.blocks.b, undefined); assert.equal(after.runtime.scopes.$document.x, 7); assert.deepEqual(after.document, before); learning.reset();
});

// Loading the browser adapter is inert; React/React Native here are headless stand-ins.
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === 'react' || specifier === 'react/jsx-runtime') return { url: new URL('./fixtures/react-headless.ts', `file://${__filename}`).href, shortCircuit: true };
  if (specifier === 'react-native') return { url: new URL('./fixtures/native-headless.ts', `file://${__filename}`).href, shortCircuit: true };
  return nextResolve(specifier, context);
} });
const { activateRendererReset, attachZoomMenu } = require('../plugin/client/web') as typeof import('../plugin/client/web');
test('renderer reset stays within its Panel root, checks current identity twice and never clicks disabled/unmounted/native targets', () => {
  const global = globalThis as unknown as { document?: unknown }, prior = global.document;
  let own = 0, foreign = 0, disabled = false, mounted = true, current = true;
  const action = { getAttribute: (name: string) => name === 'aria-disabled' && disabled ? 'true' : null, click: () => own++ };
  const renderer = { getAttribute: () => 'lienzo-interactive-renderer-same-id', querySelector: () => action };
  const root = { isConnected: true, querySelectorAll: () => mounted ? [renderer] : [] };
  global.document = { getElementById: () => { foreign++; throw Error('Global lookup must never run'); } };
  try {
    assert.equal(activateRendererReset(root, 'same-id', () => current), true); assert.equal(own, 1); assert.equal(foreign, 0);
    current = false; assert.equal(activateRendererReset(root, 'same-id', () => current), false); current = true;
    let checks = 0; assert.equal(activateRendererReset(root, 'same-id', () => ++checks === 1), false);
    disabled = true; assert.equal(activateRendererReset(root, 'same-id', () => true), false); disabled = false;
    mounted = false; assert.equal(activateRendererReset(root, 'same-id', () => true), false); mounted = true;
    root.isConnected = false; assert.equal(activateRendererReset(root, 'same-id', () => true), false); root.isConnected = true;
    assert.equal(activateRendererReset(null, 'same-id', () => true), false);
    Platform.OS = 'ios'; assert.equal(activateRendererReset(root, 'same-id', () => true), false); assert.equal(own, 1);
  } finally { Platform.OS = 'web'; if (prior === undefined) delete global.document; else global.document = prior; }
});

test('selection popover leaves text, cursor keys and submission to its input while Escape still dismisses', () => {
  const global = globalThis as unknown as { document?: unknown }, prior = global.document, handlers = new Map<string, Function>();
  let dismissed = 0, focused = 0, prevented = 0;
  const input: { closest(): unknown } = { closest: () => input }, row = { getAttribute: () => 'Nota', focus: () => focused++ };
  const node = { addEventListener() {}, contains: () => true, querySelectorAll: () => [row] };
  global.document = { addEventListener: (key: string, fn: Function) => handlers.set(key, fn), removeEventListener: (key: string) => handlers.delete(key) };
  let cleanup = () => {};
  try {
    cleanup = attachZoomMenu(node, null, () => dismissed++, true); focused = 0;
    for (const key of ['n', 'Home', 'End', 'ArrowLeft', 'ArrowDown', 'Enter']) handlers.get('keydown')!({ key, target: input, preventDefault: () => prevented++, stopPropagation() {} });
    assert.equal(focused, 0); assert.equal(prevented, 0); assert.equal(dismissed, 0);
    handlers.get('keydown')!({ key: 'Escape', target: input, preventDefault: () => prevented++, stopPropagation() {} });
    assert.equal(dismissed, 1); assert.equal(prevented, 1);
  } finally { cleanup(); if (prior === undefined) delete global.document; else global.document = prior; }
});
