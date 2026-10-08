import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { canvasPresentation } from '../plugin/client/presentation';
import { controlsSpec } from '../plugin/shared/renderers/controls';
import { builtinTypes } from '../plugin/shared/builtins';
import type { CanvasDocument, CanvasCatalog } from '../plugin/shared/model';
import type { RuntimeState } from '../plugin/shared/learning';
import { tokens } from '../plugin/client/tokens';

type Element = { type: unknown; props: Record<string, any> };
function fixture() {
  const document: CanvasDocument = { id: 'd', workspaceId: 'w', title: 'Ejemplo', description: '', example: true, revision: 3, createdAt: '', updatedAt: '', selectedIds: [], communication: { intent: '', audience: '', instructions: '' }, groups: [],
    blocks: [
      { id: 'g1', typeId: 'gate', title: 'Primer cierre', data: { target: 'result' } },
      { id: 'g2', typeId: 'gate', title: 'Segundo cierre', data: { target: 'result' } },
      { id: 'result', typeId: 'node', title: 'SECRET TITLE', data: { summary: 'SECRET SUMMARY', details: 'SECRET DETAILS', status: 'SECRET STATUS' }, communication: { intent: '', audience: '', instructions: 'SECRET HINT' } },
    ], links: [{ id: 'link', from: 'g1', to: 'result', label: 'SECRET LINK', kind: 'flow' }],
  };
  const catalog: CanvasCatalog = { revision: 1, templates: [], packs: [], extensions: [], blockTypes: [...builtinTypes, { ...controlsSpec.blockType, id: 'gate', renderer: 'test-gate' }] };
  const runtime: RuntimeState = { blocks: {}, scopes: {} };
  const lookup = (id?: string) => id === 'test-gate' ? { ...controlsSpec, hiddenTargets: (data: unknown, state: Record<string, unknown>) => state.revealed ? [] : [(data as { target: string }).target] } : undefined;
  return { document, catalog, runtime, lookup, present: () => canvasPresentation(document, catalog, runtime, lookup) };
}

test('all gates must open; presentation hides title, data, hints and link labels without changing the document', () => {
  const f = fixture(), original = JSON.stringify(f.document);
  let view = f.present();
  assert.deepEqual(view.hiddenBy.get('result'), ['g1', 'g2']);
  assert.equal(view.document.blocks[2].title, 'Resultado oculto');
  assert.deepEqual(view.document.blocks[2].data, {});
  assert.equal(view.document.blocks[2].communication, undefined);
  assert.equal(view.document.links[0].label, '');
  assert.equal(view.document.blocks[0], f.document.blocks[0]);
  f.runtime.blocks.g1 = { revealed: true };
  view = f.present(); assert.deepEqual(view.hiddenBy.get('result'), ['g2']);
  f.runtime.blocks.g2 = { revealed: true };
  view = f.present(); assert.equal(view.document, f.document); assert.equal(view.hiddenBy.size, 0);
  f.runtime.blocks.g1 = {}; view = f.present(); assert.deepEqual(view.hiddenBy.get('result'), ['g1']);
  assert.equal(JSON.stringify(f.document), original);
});

test('missing and self references cannot mask unrelated blocks', () => {
  const f = fixture();
  f.document.blocks[0].data.target = 'missing'; f.document.blocks[1].data.target = 'g2';
  const view = f.present();
  assert.equal(view.hiddenBy.size, 0); assert.equal(view.document, f.document);
  assert.ok(view.activeGates.has('g1') && view.activeGates.has('g2'));
});

function headless(presentation: ReturnType<typeof canvasPresentation>, document: CanvasDocument, catalog: CanvasCatalog, selection: string[]) {
  const controller = { view: { document }, catalog, selection, events: [], pendingIds: [], api: {}, busy: false, offline: false, failure: null };
  const rendered: unknown[] = [];
  const react = { createElement: (type: unknown, props: unknown, ...children: unknown[]) => { rendered.push(type); return { type, props: { ...(props as object), children } }; }, useEffect() {}, useState: (v: unknown) => [v, () => {}], useRef: (v: unknown) => ({ current: v }) };
  const modules: Record<string, unknown> = {
    react, 'react-native': { Animated: { View: 'AnimatedView' }, View: 'View', Pressable: 'Pressable', Image: 'Image' },
    '@getpaseo/plugin/client': {}, '@getpaseo/plugin/client/react-native': { Icon: 'Icon', ScrollView: 'ScrollView', useToast: () => ({}) },
    './tokens': { tokens }, './usePresentation': { usePresentation: () => presentation },
    './ui': { Txt: 'Txt', Button: 'Button', IconButton: 'IconButton', useUI: () => ({ compact: false, c: { surface1: '#fff', border: '#888', accent: '#268' } }) },
    './logic': {}, './color': {}, './web': {}, './media': {}, './ImageViewer': {},
    './renderers': { getClientRenderer: () => undefined },
    './renderers/RegisteredRenderer': { RegisteredRenderer: 'RegisteredRenderer' },
    './HiddenResult': { HiddenResult: 'HiddenResult' }, './Blocks': {}, './Links': {}, './WhiteboardContent': { WhiteboardContent: 'WhiteboardContent' }, './whiteboard-visuals': { islandStyle: () => ({}) }, '../shared/whiteboard': { isWhiteboardRenderer: (id?:string) => id?.startsWith('wb-') },
  };
  function load(name: string) {
    const source = readFileSync(new URL(`../plugin/client/${name}.tsx`, import.meta.url), 'utf8');
    const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
    const exports: Record<string, Function> = {};
    runInNewContext(compiled, { exports, require: (id: string) => { assert.ok(id in modules, `Unhandled module ${id}`); return modules[id]; } });
    return exports;
  }
  return { controller, rendered, load };
}
function nodes(tree: unknown): Element[] {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== 'object' || !('props' in tree)) return [];
  const element = tree as Element; return [element, ...nodes(element.props.children)];
}
test('canvas and list cards do not dispatch a hidden node or reveal it in accessibility text', () => {
  const f = fixture(), h = headless(f.present(), f.document, f.catalog, ['result']);
  const { BlockCard } = h.load('Blocks');
  for (const outline of [false, true]) {
    const tree = BlockCard({ block: f.document.blocks[2], controller: h.controller, selected: true, outline, onSelect() {}, onInspect() {}, onPacks() {}, onReorder() {} });
    assert.ok(nodes(tree).some(node => node.type === 'HiddenResult'));
    assert.ok(!h.rendered.includes('RegisteredRenderer'));
    assert.ok(!JSON.stringify(tree).includes('SECRET'));
    assert.equal(nodes(tree).find(node => node.type === 'Pressable')!.props.accessibilityLabel, 'Resultado oculto');
  }
});
test('details replaces hidden target fields, and shows gate controls rather than its raw outcome editor', () => {
  const f = fixture(), h = headless(f.present(), f.document, f.catalog, ['result']), { Inspector } = h.load('Inspector');
  const props = { controller: h.controller, linkId: null, onLink() {}, rects: () => new Map(), release() {}, reorder() {}, groupSelection() {}, onTemplate() {}, onExportSelection() {} };
  let tree = Inspector(props);
  assert.ok(nodes(tree).some(node => node.type === 'HiddenResult')); assert.ok(!JSON.stringify(tree).includes('SECRET'));
  h.controller.selection = ['g1']; tree = Inspector(props);
  assert.ok(nodes(tree).some(node => node.type === 'RegisteredRenderer'));
  assert.ok(!nodes(tree).some(node => node.type === 'Field'));
});
