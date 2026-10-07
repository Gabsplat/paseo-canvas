import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { URL } from 'node:url';
import ts from 'typescript';
import { z } from 'zod';
import { builtinTypes } from '../plugin/shared/builtins';
import { getRendererSpec } from '../plugin/shared/renderers';
import { canvasPresentation } from '../plugin/client/presentation';
import { LearningRuntimeStore } from '../plugin/client/learning-state';
import { controlsSpec } from '../plugin/shared/renderers/controls';
import type { RendererSpec } from '../plugin/shared/renderers';
import type { CanvasDocument, CanvasCatalog } from '../plugin/shared/model';
import type { RuntimeState } from '../plugin/shared/learning';

type Element = { type: unknown; props: Record<string, any> };
// No shipped renderer hides other blocks, so the dispatcher's protection is exercised
// with a test-only renderer that hides data.target until its runtime says revealed.
const gateSpec: RendererSpec = { id: 'test-gate', dataSchema: z.object({ target: z.string() }).strict(), interactive: true, guidance: '',
  blockType: { ...controlsSpec.blockType, id: 'gate', renderer: 'test-gate' },
  hiddenTargets: (data, state) => state.revealed ? [] : [(data as { target: string }).target] };
const lookup = (id?: string) => id === 'test-gate' ? gateSpec : getRendererSpec(id);
const Probe = 'Probe';
function nodes(tree: any): Element[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  return tree?.props ? [tree, ...nodes(tree.props.children)] : [];
}

// Preserve hooks across renders and deliberately defer effects. A protected result
// must never reach the first committed tree while an effect is still pending.
function host(flush: () => Promise<void> = async () => {}) {
  let slots: any[] = [], cursor = 0;
  const react = {
    createElement: (type: unknown, props: unknown, ...children: unknown[]) => ({ type, props: { ...(props as object), children } }),
    useState(initial: unknown) { const i = cursor++; if (!(i in slots)) slots[i] = initial; return [slots[i], (v: unknown) => { slots[i] = v; }]; },
    useRef(initial: unknown) { const i = cursor++; return slots[i] ??= { current: initial }; },
    useMemo: (get: () => unknown) => get(), useEffect() {},
  };
  const ui = { layout: { platform: 'web' }, compact: false, c: { statusDanger: '#933', foreground: '#111', foregroundMuted: '#555', surface0: '#fff' }, tone: () => '#246' };
  let presentation: ReturnType<typeof canvasPresentation>, runtime: RuntimeState;
  const writes: unknown[] = [], events: unknown[] = [];
  const controller: any = { current: { current: null } };
  const modules: Record<string, any> = {
    react, 'react-native': { View: 'View' },
    '../../shared/renderers': { getRendererSpec: lookup },
    '../ui': { useUI: () => ui, Txt: 'Txt' },
    './index': { getClientRenderer: () => ({ Component: Probe }) },
    '../HiddenResult': { HiddenResult: 'HiddenResult' },
    '../usePresentation': { usePresentation: () => presentation },
    '../useLearning': { useLearning: (block: { id: string }) => ({ runtime: { state: runtime.blocks[block.id] ?? {}, set: (...args: unknown[]) => writes.push(args), flush, settle: async (...args: unknown[]) => { events.push(args); } }, scope: { set: (...args: unknown[]) => writes.push(args) } }) },
  };
  function load(file: string) {
    const source = readFileSync(new URL(`../plugin/client/renderers/${file}.tsx`, import.meta.url), 'utf8');
    const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
    const exports: Record<string, any> = {};
    runInNewContext(code, { exports, require: (id: string) => { assert.ok(id in modules, `Unhandled module ${id}`); return modules[id]; } });
    return exports;
  }
  const { RegisteredRenderer } = load('RegisteredRenderer');
  const dispatcher: any[] = [];
  return {
    writes, events,
    render(document: CanvasDocument, catalog: CanvasCatalog, nextRuntime: RuntimeState, blockId = 'gate') {
      runtime = nextRuntime; presentation = canvasPresentation(document, catalog, runtime, lookup);
      controller.view = { document }; controller.current.current = controller.view; controller.catalog = catalog;
      slots = dispatcher; cursor = 0;
      const tree = RegisteredRenderer({ block: document.blocks.find(b => b.id === blockId), id: 'test-gate', controller, readOnly: false, send: async () => {} });
      return { tree, element: nodes(tree).find(n => n.type === Probe) };
    },
  };
}
function fixture() {
  const document: CanvasDocument = { id: 'one', workspaceId: 'w', title: 'Example', description: '', example: true, revision: 0, createdAt: '', updatedAt: '', selectedIds: [], communication: { intent: '', audience: '', instructions: '' }, groups: [],
    blocks: [{ id: 'gate', typeId: 'gate', title: 'Gate', data: { target: 'result' } }, { id: 'result', typeId: 'node', title: 'SECRET TITLE', data: { summary: 'SECRET DATA' } }],
    links: [{ id: 'link', from: 'gate', to: 'result', label: 'SECRET LINK', kind: 'flow' }],
  };
  const catalog: CanvasCatalog = { revision: 0, blockTypes: [...builtinTypes, gateSpec.blockType], templates: [], packs: [] };
  return { document, catalog, runtime: { blocks: { gate: { revealed: true } }, scopes: {} } satisfies RuntimeState };
}

test('runtime reset remounts an open gate with the masked document before effects run', () => {
  const f = fixture(), h = host();
  const open = h.render(f.document, f.catalog, f.runtime).element!;
  assert.match(JSON.stringify(open.props.document), /SECRET TITLE/);
  const reset = h.render(f.document, f.catalog, { blocks: {}, scopes: {} }).element!;
  assert.notEqual(reset.props.key, open.props.key);
  assert.doesNotMatch(JSON.stringify(reset.props.document), /SECRET TITLE|SECRET DATA|SECRET LINK/);
});

test('same block IDs in another document or workspace cannot inherit local renderer state', () => {
  for (const change of [{ id: 'two' }, { workspaceId: 'another' }]) {
    const f = fixture(), h = host();
    const first = h.render(f.document, f.catalog, f.runtime).element!;
    const switched = h.render({ ...f.document, ...change }, f.catalog, f.runtime).element!;
    assert.notEqual(switched.props.key, first.props.key);
  }
});

test('direct hidden target mounts return HiddenResult before dispatch', () => {
  const f = fixture(), hidden = host().render(f.document, f.catalog, { blocks: {}, scopes: {} }, 'result');
  assert.equal(hidden.element, undefined);
  assert.equal(hidden.tree.type, 'HiddenResult');
  assert.doesNotMatch(JSON.stringify(hidden.tree), /SECRET/);
});

test('callbacks pending during reset or document switch cannot restore old runtime or settle in the new lifetime', async () => {
  for (const switched of [false, true]) {
    let release!: () => void;
    const f = fixture(), h = host(() => new Promise<void>(resolve => { release = resolve; }));
    const old = h.render(f.document, f.catalog, f.runtime).element!;
    const pending = old.props.runtime.settle('gate.old', {}, 'Comparar');
    h.render(switched ? { ...f.document, id: 'two' } : f.document, f.catalog, { blocks: {}, scopes: {} });
    old.props.runtime.set(f.runtime.blocks.gate);
    old.props.scope.set('x', 7);
    release();
    await assert.rejects(pending, /cambió/);
    assert.equal(h.writes.length, 0); assert.equal(h.events.length, 0);
  }
});

test('opening a gate preserves its sending attempt and callbacks', () => {
  const f = fixture(), h = host();
  const closed = h.render(f.document, f.catalog, { blocks: {}, scopes: {} }).element!;
  const opened = h.render(f.document, f.catalog, f.runtime).element!;
  assert.equal(closed.props.key, opened.props.key);
  closed.props.runtime.set(f.runtime.blocks.gate);
  assert.equal(h.writes.length, 1);
});

test('late block and scope acknowledgements stay in their original document', async t => {
  const f = fixture(), document = { ...f.document, variables: [{ name: 'x', value: 1, min: 0, max: 10 }] };
  const responses: ((response: any) => void)[] = [];
  const local = new LearningRuntimeStore(async () => new Promise(resolve => responses.push(resolve)), error => { throw error; });
  t.after(() => local.reset());
  local.sync(document, 0, { blocks: {}, scopes: {} });
  local.setBlock('gate', f.runtime.blocks.gate); local.setVariable('gate', 'x', 7);
  const oldFlush = local.flush();
  const next = { ...document, id: 'two' };
  local.sync(next, 0, { blocks: {}, scopes: {} });
  local.setVariable('gate', 'x', 2);
  const nextFlush = local.flush();
  responses[0]({ runtimeVersion: 99, runtime: { ...f.runtime, scopes: { '$document': { x: 7 } } } });
  await oldFlush;
  assert.deepEqual(local.getSnapshot(), { blocks: {}, scopes: { '$document': { x: 2 } } });
  assert.ok(canvasPresentation(next, f.catalog, local.getSnapshot(), lookup).hiddenBy.has('result'));
  responses[1]({ runtimeVersion: 1, runtime: { blocks: {}, scopes: { '$document': { x: 2 } } } });
  await nextFlush;
  assert.deepEqual(local.getSnapshot(), { blocks: {}, scopes: { '$document': { x: 2 } } });
});
