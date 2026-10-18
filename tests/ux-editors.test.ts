// The Properties editors for people (docs/ux-audit-2026-10.md): each editor's rows turn back into the same data the
// agent writes, typed variables extend the old numeric ones, and data stored before the overhaul still loads.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as model from '../plugin/client/property-model';
import { mergePatch } from '../plugin/server/reducer';
import { builtinTypes } from '../plugin/shared/builtins';
import { blockTypeSchema, documentContentSchema, type BlockType, type CanvasDocument } from '../plugin/shared/model';
import { variableSchema, variablesSchema, resolveScope, DOCUMENT_SCOPE } from '../plugin/shared/learning';
import { fileTreeDataSchema, fileTreeRows } from '../plugin/shared/renderers/file-tree';
import { animatedFlowDataSchema, animatedFlowSpec } from '../plugin/shared/renderers/animated-flow';
import { controlsDataSchema, controlsSpec } from '../plugin/shared/renderers/controls';
import { glslShaderDataSchema, glslShaderSpec } from '../plugin/shared/renderers/glsl-shader';
import * as rpc from '../plugin/shared/rpc';
import { setup, mutation, workspaceId } from './helpers';

const type = (id: string) => builtinTypes.find(t => t.id === id)!;
const doc = (patch: Partial<CanvasDocument>): CanvasDocument => ({ id: 'd', workspaceId, title: 'T', description: '', example: false, revision: 1, createdAt: '', updatedAt: '', selectedIds: [], communication: { instructions: '', intent: '', audience: '' }, blocks: [], groups: [], links: [], ...patch });

test('checklist rows round-trip: old string items read as not done and save as the objects the agent writes', () => {
  const rows = model.checklistRows(['Plain', { label: 'Ticked', done: true }, { label: 'Open', done: false }]);
  assert.deepEqual(rows, [{ label: 'Plain', done: false }, { label: 'Ticked', done: true }, { label: 'Open', done: false }]);
  const items = model.checklistItems(model.move(rows, 2, -1));
  assert.deepEqual(items, [{ label: 'Plain', done: false }, { label: 'Open', done: false }, { label: 'Ticked', done: true }]);
  assert.equal(model.dataIssue(type('checklist'), { items }), null);
  assert.deepEqual(model.checklistRows(model.checklistItems(model.checklistRows(items))), model.checklistRows(items));
  assert.deepEqual(model.checklistRows(undefined), []);
});

test('file tree rows round-trip to entries that draw the same tree, implied folders made explicit', () => {
  const data = fileTreeDataSchema.parse({ root: 'p/', entries: [{ path: 'src/lib/a.ts', note: 'deep', ref: 'card' }, { path: 'README.md', highlight: true }, { path: 'vendor/', muted: true }, { path: 'vendor/x.js' }, { path: 'src/index.ts' }], collapsed: ['vendor/'] });
  const rows = model.treeRows(data), back = { ...data, ...model.treeData(rows) };
  assert.deepEqual(rows.map(r => `${'  '.repeat(r.depth)}${r.name}${r.dir ? '/' : ''}`), ['src/', '  lib/', '    a.ts', '  index.ts', 'README.md', 'vendor/', '  x.js']);
  assert.equal(fileTreeDataSchema.safeParse(back).success, true);
  assert.deepEqual(fileTreeRows(fileTreeDataSchema.parse(back)), fileTreeRows(data));
  assert.deepEqual(back.collapsed, ['vendor/']);
  assert.equal(rows.find(r => r.name === 'x.js')!.muted, undefined, 'a muted folder does not write muted onto what it holds');
  assert.deepEqual(model.treeRows(fileTreeDataSchema.parse(back)), rows, 'stable after one round');
});

test('file tree editing: indent, outdent, move with what a row holds, insert inside open folders, remove, refuse bad names', () => {
  let rows: model.TreeRow[] = [{ name: 'a', depth: 0, dir: false }, { name: 'b', depth: 0, dir: false }, { name: 'c', depth: 0, dir: true }, { name: 'd', depth: 1, dir: false }];
  rows = model.indentRow(rows, 1, 1);
  assert.deepEqual(model.treePaths(rows), ['a', 'a/b', 'c', 'c/d']); assert.equal(rows[0].dir, true, 'what holds a row becomes a folder');
  assert.deepEqual(model.treePaths(model.indentRow(rows, 1, 1)), model.treePaths(rows), 'at most one level under the row above');
  const moved = model.moveTreeRow(rows, 2, -1);
  assert.deepEqual(model.treePaths(moved.rows), ['c', 'c/d', 'a', 'a/b']); assert.equal(moved.index, 0);
  const down = model.moveTreeRow(moved.rows, 0, 1); assert.deepEqual(model.treePaths(down.rows), ['a', 'a/b', 'c', 'c/d']); assert.equal(down.index, 2);
  const inserted = model.insertTreeRow(rows, 2, false);
  assert.deepEqual(model.treePaths(inserted.rows), ['a', 'a/b', 'c', 'c/file.txt', 'c/d']); assert.equal(inserted.index, 3);
  assert.deepEqual(model.treePaths(model.insertTreeRow(inserted.rows, 2, false).rows).filter(p => p.startsWith('c/file')), ['c/file-2.txt', 'c/file.txt']);
  assert.deepEqual(model.treePaths(model.removeTreeRow(rows, 0)), ['c', 'c/d'], 'a folder goes with what it holds');
  assert.deepEqual(model.treePaths(model.indentRow(rows, 1, -1)), ['a', 'b', 'c', 'c/d']);
  assert.match(model.treeIssue([{ name: 'x', depth: 0, dir: false }, { name: 'x', depth: 0, dir: false }])!, /twice/);
  assert.match(model.treeIssue([{ name: 'a/b', depth: 0, dir: false }])!, /slashes/);
  assert.match(model.treeIssue([])!, /at least one/);
  assert.equal(model.treeIssue(rows), null);
  assert.equal(model.dataIssue(type('file-tree'), { root: 'p/', ...model.treeData(rows) } as never), null);
});

test('typed variables extend the numeric ones: old declarations load, on/off and choices keep numbers in range', () => {
  assert.equal(variableSchema.safeParse({ name: 'x', value: 2, min: 0, max: 10 }).success, true, 'a declaration from before types is a number');
  assert.equal(variableSchema.safeParse({ name: 'on', type: 'boolean', value: 1, min: 0, max: 1, step: 1 }).success, true);
  assert.equal(variableSchema.safeParse({ name: 'mode', type: 'choice', options: ['A', 'B', 'C'], value: 2, min: 0, max: 2, step: 1 }).success, true);
  for (const bad of [
    { name: 'on', type: 'boolean', value: 0.5, min: 0, max: 1 }, { name: 'on', type: 'boolean', value: 1, min: 0, max: 2 },
    { name: 'm', type: 'choice', value: 0, min: 0, max: 1 }, { name: 'm', type: 'choice', options: ['A', 'B'], value: 0, min: 0, max: 2 },
    { name: 'm', type: 'choice', options: ['A', 'A'], value: 0, min: 0, max: 1 }, { name: 'm', type: 'choice', options: ['A', 'B'], value: 0.5, min: 0, max: 1 },
    { name: 'n', options: ['A', 'B'], value: 0, min: 0, max: 1 }, { name: 'n', type: 'text', value: 0, min: 0, max: 1 },
  ]) assert.equal(variableSchema.safeParse(bad).success, false, JSON.stringify(bad));
  const taken = ['value', 'speed'];
  for (const t of ['number', 'boolean', 'choice'] as const) { const v = model.newVariable(t, taken); assert.equal(model.variableIssue(v), null, t); assert.ok(!taken.includes(v.name)); }
  const speed = { name: 'speed', label: 'Speed', value: 7, min: 0, max: 10, step: 1 };
  for (const t of ['boolean', 'choice', 'number'] as const) assert.equal(variableSchema.safeParse(model.retypeVariable(model.retypeVariable(speed, t), 'number')).success, true, t);
  const choice = model.withOptions(model.newVariable('choice', []), ['One', 'Two']);
  assert.deepEqual([choice.min, choice.max, choice.value <= 1], [0, 1, true]); assert.equal(variableSchema.safeParse(choice).success, true);
  assert.equal(model.variableName('Spring stiffness (N/m)', []), 'spring_stiffness_n_m');
  assert.equal(model.variableName('2 lanes', []), 'v_2_lanes'); assert.equal(model.variableName('Speed', ['speed']), 'speed_2');
  assert.match(model.variableIssue({ ...speed, value: 20 })!, /starting value/);
  assert.match(model.variableIssue(speed, [speed])!, /already called/);
  assert.equal(model.variableValueText({ type: 'choice', options: ['Low', 'High'] }, 1), 'High');
  assert.equal(model.variableValueText({ type: 'boolean' }, 0), 'Off'); assert.equal(model.variableValueText({ unit: 'km/h' }, 12.5), '12.5 km/h');
});

test('renaming or deleting a variable follows the Controls that show it, only where the name resolves to that scope', () => {
  const v = (name: string) => ({ name, value: 1, min: 0, max: 2 });
  const document = doc({
    variables: [v('x'), v('y')],
    groups: [{ id: 'g', title: 'G', description: '', blockIds: ['inner'], groupIds: [], variables: [v('x')] }],
    blocks: [{ id: 'outer', typeId: 'controls', title: '', data: { variables: ['x', 'y'] } }, { id: 'inner', typeId: 'controls', title: '', parentGroupId: 'g', data: { variables: ['x', 'y'] } }],
  });
  const controls = new Set(['controls']);
  const renamed = model.variableOperations(document, DOCUMENT_SCOPE, [v('speed'), v('y')], { x: 'speed' }, controls);
  assert.deepEqual(renamed, [{ type: 'document.update', variables: [v('speed'), v('y')] }, { type: 'block.update', id: 'outer', patch: { data: { variables: ['speed', 'y'] } } }], 'the Frame’s own x is untouched');
  const removed = model.variableOperations(document, DOCUMENT_SCOPE, [v('x')], { y: null }, controls);
  assert.deepEqual(removed.slice(1).map(op => op.type === 'block.update' && op.patch.data), [{ variables: ['x'] }, { variables: ['x'] }]);
  assert.throws(() => model.variableOperations(document, DOCUMENT_SCOPE, [v('x'), v('x')], {}, controls));
  assert.equal(model.scopeHolder(document, 'g', 'x'), 'inner'); assert.equal(model.scopeHolder(document, DOCUMENT_SCOPE, 'x'), 'outer');
  assert.deepEqual(model.scopesOf(document, 'inner').map(s => s.id), ['g', DOCUMENT_SCOPE]);
});

test('flow events are made along real links, in seconds, with numeric values', () => {
  const document = { blocks: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }], groups: [], links: [{ id: 'ab', from: 'a', to: 'b', label: 'orders' }] };
  assert.deepEqual(model.flowRoutes(document), [{ id: 'ab', from: 'a', to: 'b', label: 'A → B · orders' }]);
  const data = animatedFlowDataSchema.parse(animatedFlowSpec.blockType.defaults), first = model.newFlowEvent(data, document)!;
  assert.deepEqual(first, { t: 0, from: 'a', to: 'b', linkId: 'ab', payload: 'Message', kind: 'message' });
  const second = model.newFlowEvent({ ...data, events: [first] }, document)!;
  assert.equal(second.t, 1000);
  const events = [first, { ...second, kind: 'value' as const, payload: model.flowPayload('value', '5') }];
  assert.equal(events[1].payload, 5); assert.equal(model.flowPayload('message', '5'), '5');
  assert.equal(animatedFlowDataSchema.safeParse({ ...data, events }).success, true);
  assert.equal(model.newFlowEvent(data, { ...document, links: [] }), null);
  assert.equal(model.toMs(2.5), 2500); assert.equal(model.secondsText(250), '0.25');
  assert.match(model.dataIssue(type('animated-flow'), { ...data, duration: 500, events })!, /duration/);
});

test('shader parameters keep the code declaring them: add, rename everywhere, remove, and the builtins', () => {
  const data = glslShaderDataSchema.parse(glslShaderSpec.blockType.defaults);
  const added = [...data.uniforms, model.newUniform(data.uniforms)];
  let patch = model.uniformsPatch(data.fragmentSource, data.uniforms, added);
  assert.match(patch.fragmentSource, /uniform float param2;/);
  assert.equal(glslShaderDataSchema.safeParse({ ...data, ...patch }).success, true);
  const renamed = added.map(u => u.name === 'frequency' ? { ...u, name: 'stripes' } : u);
  patch = model.uniformsPatch(patch.fragmentSource, added, renamed, { frequency: 'stripes' });
  assert.doesNotMatch(patch.fragmentSource, /frequency/); assert.match(patch.fragmentSource, /uv\.x \* stripes/);
  assert.equal(glslShaderDataSchema.safeParse({ ...data, ...patch }).success, true);
  const fewer = renamed.filter(u => u.name !== 'param2'); patch = model.uniformsPatch(patch.fragmentSource, renamed, fewer);
  assert.doesNotMatch(patch.fragmentSource, /param2/); assert.equal(glslShaderDataSchema.safeParse({ ...data, ...patch }).success, true);
  const timed = model.builtinsPatch(patch.fragmentSource, { resolution: true, time: true });
  assert.match(timed.fragmentSource, /uniform float u_time;/); assert.equal(glslShaderDataSchema.safeParse({ ...data, uniforms: fewer, ...timed }).success, true);
  const plain = model.builtinsPatch(timed.fragmentSource, { resolution: true, time: false });
  assert.doesNotMatch(plain.fragmentSource, /u_time/);
  assert.equal(model.usesIdentifier(data.fragmentSource, 'frequency'), true); assert.equal(model.usesIdentifier('uniform float k;\nvoid main(){}', 'k'), false);
});

test('raw JSON and editor patches merge on the server exactly into what the person saw', () => {
  const before = { a: 1, keep: 'x', nested: { s: 1, gone: 2 }, list: [1, 2] }, after = { a: 2, keep: 'x', nested: { s: 3 }, list: [3], added: true };
  const patch = model.replacePatch(before, after);
  assert.deepEqual(patch, { a: 2, nested: { s: 3, gone: null }, list: [3], added: true });
  assert.deepEqual(mergePatch(before, patch), after); assert.deepEqual(model.applyPatch(before, patch), after);
  assert.deepEqual(model.replacePatch({ links: { ab: { sign: 1, delay: 0 } } }, { links: {} }), { links: { ab: null } });
  assert.deepEqual(model.replacePatch(after, after), {});
});

test('Properties show what is needed first and keep the rest under More until it is used', () => {
  const flow = type('animated-flow'), split = (data: object) => { const s = model.splitProperties(flow, data as never); return [s.primary.map(p => p.key), s.more.map(p => p.key)]; };
  assert.deepEqual(split(flow.defaults), [['events', 'duration'], ['question', 'travelMs', 'links', 'propagation']]);
  assert.deepEqual(split({ ...flow.defaults, question: 'Why?', travelMs: 400 })[0], ['events', 'duration', 'question', 'travelMs']);
  const tree = model.splitProperties(type('file-tree'), type('file-tree').defaults, p => p.key === 'collapsed');
  assert.deepEqual([tree.primary.map(p => p.key), tree.more.map(p => p.key)], [['entries'], ['root']], 'a root still at its default waits under More');
  assert.deepEqual(model.splitProperties(type('file-tree'), { ...type('file-tree').defaults, root: 'app/' } as never).primary.map(p => p.key), ['entries', 'root', 'collapsed'].slice(0, 2));
  assert.equal(model.hasValue('  '), false); assert.equal(model.hasValue([]), false); assert.equal(model.hasValue(0), true);
  assert.equal(model.statusToneOf('In progress'), 'aviso'); assert.equal(model.statusToneOf('Blocked'), 'riesgo'); assert.equal(model.statusToneOf('Paused'), 'neutro');
  const kind = type('node').properties.find(p => p.key === 'kind')!;
  assert.deepEqual(model.suggestions(kind, { blocks: [{ id: 'n', typeId: 'node', title: '', data: { kind: 'Gateway' } }, { id: 'm', typeId: 'node', title: '', data: { kind: 'service' } }] }, 'node').slice(-1), ['Gateway']);
  assert.match(model.dataIssue(type('node'), { kind: 3 } as never)!, /Kind must be text/);
  assert.match(model.dataIssue(type('note'), { text: 'x', extra: 1 } as never)!, /extra is not a field/);
  assert.equal(model.plainError('Shown as is.').name, 'LienzoPlainError');
});

test('old documents and agent data load: controls without a question, flows with one, hints on types, typed variables over MCP shapes', async t => {
  assert.equal(controlsDataSchema.safeParse({ variables: ['x'] }).success, true);
  assert.equal(controlsDataSchema.safeParse({ question: 'Old question?', variables: [] }).success, true);
  assert.equal(animatedFlowDataSchema.safeParse({ question: 'Old?', events: [], duration: 1000, travelMs: 1000, links: {} }).success, true);
  for (const spec of [controlsSpec, animatedFlowSpec, glslShaderSpec]) assert.equal(blockTypeSchema.safeParse(spec.blockType).success, true, spec.id);
  for (const t2 of builtinTypes) assert.equal(blockTypeSchema.safeParse(t2).success, true, t2.id);
  assert.equal(blockTypeSchema.safeParse({ ...type('note'), properties: [{ key: 'text', label: 'Text', kind: 'text', options: ['a'], advanced: true, help: 'h', extra: 1 }] }).success, false, 'still strict');
  const { service } = await setup(t);
  // A document written before the overhaul, with numeric variables and a controls question, loads and keeps both.
  const legacy = documentContentSchema.parse({ title: 'Old', blocks: [{ id: 'k', typeId: 'controls', title: 'K', data: { question: 'Kept?', variables: ['x'] } }], groups: [], variables: [{ name: 'x', value: 2, min: 0, max: 4, step: 1 }], communication: { instructions: '' } });
  const created = await service.create({ workspaceId, id: 'legacy', content: legacy });
  assert.equal(created.document.blocks[0].data.question, 'Kept?'); assert.deepEqual(created.document.variables, legacy.variables);
  // Typed declarations through the same revisioned update; runtime values stay numbers and discrete ones stay whole.
  const typed = [{ name: 'on', label: 'Show', type: 'boolean' as const, value: 0, min: 0, max: 1, step: 1 }, { name: 'mode', type: 'choice' as const, options: ['A', 'B'], value: 1, min: 0, max: 1, step: 1 }];
  const view = await service.mutate(mutation(0, [{ type: 'document.update', variables: variablesSchema.parse(typed) }]));
  assert.deepEqual(view.document.variables, typed);
  const set = (values: Record<string, number>) => service.runtimeSet(rpc.runtimeSetInputSchema.parse({ documentId: 'd', workspaceId, scopes: [{ id: DOCUMENT_SCOPE, values }] }));
  await set({ on: 1, mode: 0 });
  await assert.rejects(set({ on: 0.5 }), /whole values/);
  await assert.rejects(set({ mode: 2 }), /outside/);
  assert.equal(resolveScope(view.document, 'b', { blocks: {}, scopes: { [DOCUMENT_SCOPE]: { on: 1 } } }).on.current, 1);
  // A custom type made by an agent can carry the same hints the built-ins use.
  const custom: BlockType = { id: 'mine', name: 'Mine', description: '', properties: [{ key: 'tone', label: 'Tone', kind: 'text', required: false, options: ['Calm', 'Loud'], advanced: true, help: 'How it sounds.' }], defaults: {} };
  const catalog = await service.catalogMutate({ expectedRevision: 0, action: { type: 'type.put', blockType: custom } });
  assert.deepEqual(catalog.blockTypes.find(x => x.id === 'mine')!.properties[0].options, ['Calm', 'Loud']);
});
