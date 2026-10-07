import * as whiteboard from '../plugin/shared/whiteboard';
import { DEFAULT_TOOL_STYLE } from '../plugin/client/whiteboard-tools';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { test } from 'node:test';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as logic from '../plugin/client/logic';
import * as panelActions from '../plugin/client/panel-actions';
import * as learning from '../plugin/shared/learning';
import { tokens } from '../plugin/client/tokens';
import { canvasPreferences } from '../plugin/shared/preferences';
import { builtinTypes, builtinTemplates, builtinPacks } from '../plugin/shared/builtins';
import { createInputSchema, blockTypeSchema, type CanvasDocument } from '../plugin/shared/model';

// Run the real component functions and callbacks headlessly. Only host/native controls
// and hooks are replaced, so these tests open no windows or desktop services.
type Element = { type: any; props: Record<string, any> };
function runtime(controller: any) {
  let cursor = 0;
  const slots: any[] = [];
  const react = {
    createElement: (type: any, props: any, ...children: any[]) => ({ type, props: { ...props, children } }),
    createContext: () => ({ Provider: 'Provider' }),
    useState: (initial: any) => { const index = cursor++; if (!(index in slots)) slots[index] = initial; return [slots[index], (value: any) => { slots[index] = typeof value === 'function' ? value(slots[index]) : value; }]; },
    useRef: (initial: any) => { const index = cursor++; return slots[index] ??= { current: initial }; },
    useMemo: (create: any) => create(), useEffect: () => {}, useContext: () => null,
  };
  const control = (name: string) => Object.defineProperty(() => null, 'name', { value: name });
  const modal = Object.assign(control('Modal'), { Content: control('Content') });
  const native = { View: 'View', Pressable: 'Pressable', Text: 'Text', Animated: {}, Platform: { OS: 'web', select: (v: any) => v.default } };
  const host = { Icon: 'Icon', ScrollView: 'ScrollView', Modal: modal, useToast: () => ({ show() {}, error() {} }) };
  const modules: Record<string, any> = {
    react, 'react-native': native, '@getpaseo/plugin/client/react-native': host,
    '@getpaseo/plugin/client': { useAgent: () => null, useSettings: () => ({ status: 'ready', values: { guideSeen: true } }) },
    './useCanvas': { useCanvas: () => controller }, './tokens': { tokens }, './logic': logic,
    '../shared/preferences': { canvasPreferences }, './web': {}, './motion': {},
    './panel-actions': panelActions, '../shared/learning': learning,
    './DocumentActions': { DocumentActions: control('DocumentActions') },
    './SelectionOverlay': { SelectionGeometry: {} }, './NumberPropertyField': { NumberPropertyField: control('NumberPropertyField') },
    './Canvas': { Canvas: control('Canvas') }, '../shared/model': { blockTypeSchema }, './Blocks': { visual: () => ({ icon: 'StickyNote', tone: 'neutro' }), Delivery: control('Delivery'), ConnectionRows: control('ConnectionRows') },
    './Links': { linkTone: () => 'neutro' }, './color': { withAlpha: (color: string) => color, isDark: () => false },
    './AgentModal': { AgentModal: control('AgentModal') }, './Onboarding': { Onboarding: control('Onboarding') },
    './guide': { claimFirstGuide: async () => false },
    './usePresentation': { usePresentation: () => ({ document: controller.view?.document, hiddenBy: new Map(), activeGates: new Set() }) },
    './HiddenResult': { HiddenResult: control('HiddenResult') },
    './FloatingTools': Object.fromEntries(['ToolIsland','StyleIsland','ShapePopover','LibraryPopover','SvgImportDialog'].map(name=>[name,control(name)])), './whiteboard-tools': { DEFAULT_TOOL_STYLE }, './interaction': { needsContentInteraction:()=>true }, '../shared/whiteboard': whiteboard, './whiteboard-visuals': { islandStyle: () => ({}) }, './media': { mediaSource: () => null },
    './renderers/RegisteredRenderer': { RegisteredRenderer: control('RegisteredRenderer') }, './renderers': { getClientRenderer: () => undefined }, './BlockPalette': { BlockPalette: control('BlockPalette') }, './Rings': { Rings: control('Rings') },
  };
  const load = (name: string) => {
    const source = readFileSync(new URL(`../plugin/client/${name}.tsx`, import.meta.url), 'utf8');
    const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
    const exports: any = {};
    runInNewContext(output, { exports, require: (id: string) => { assert.ok(id in modules, `Unexpected import ${id}`); return modules[id]; }, Error, SyntaxError });
    return exports;
  };
  const realUI = load('ui');
  modules['./ui'] = Object.fromEntries(['Button', 'Chip', 'Field', 'Input', 'IconButton', 'Segments', 'Txt', 'UIProvider', 'Section', 'CheckRow', 'MenuRow', 'MenuDivider'].map(name => [name, control(name)]));
  Object.assign(modules['./ui'], { Modal: modal, friendlyError: realUI.friendlyError, useUI: () => ({ compact: false, host: { id: 'host' }, layout: { platform: 'web' }, font: () => ({}), c: {}, wash: () => '', tone: () => '' }) });
  modules['./Catalog'] = { Catalog: control('Catalog'), PackImport: control('PackImport'), PackExport: control('PackExport') };
  modules['./Inspector'] = { Inspector: control('Inspector') };
  modules['./SelectionActions'] = load('SelectionActions');
  const panel = load('Panel').LienzoPanel({ theme: {}, layout: {}, host: { id: 'host' }, workspaceId: 'workspace' }).props.children[0];
  return { render: () => { cursor = 0; return panel.type(panel.props); }, load, friendlyError: realUI.friendlyError };
}
function nodes(tree: any, visible = false): Element[] {
  if (Array.isArray(tree)) return tree.flatMap(child => nodes(child, visible));
  if (!tree || typeof tree !== 'object' || !tree.props) return [];
  if (visible && tree.type?.name === 'Modal' && !tree.props.open) return [];
  return [tree, ...nodes(tree.props.children, visible)];
}
function find(tree: any, name: string, label?: string): Element {
  const result = nodes(tree).find(node => node.type?.name === name && (label === undefined || node.props.label === label));
  assert.ok(result, `${name} ${label ?? ''} exists`); return result;
}
function fixture() {
  const document: CanvasDocument = { id: 'canvas', workspaceId: 'workspace', title: 'Mi lienzo', description: '', example: false, revision: 7, createdAt: '', updatedAt: '', communication: { intent: 'Preservar', audience: 'Equipo', instructions: 'Anterior' }, selectedIds: [], blocks: [{ id: 'note', typeId: 'note', title: 'Mi nota', data: { text: 'Contenido' }, communication: { intent: 'Revisar', audience: 'Yo', instructions: 'Antes' } }], groups: [], links: [] };
  const edits: any[] = [], creates: any[] = [];
  const controller: any = { view: { document }, current: { current: { document } }, selection: [], documents: [], events: [], loading: false, busy: false, offline: false, failure: null,
    catalog: { revision: 0, blockTypes: builtinTypes, templates: builtinTemplates, packs: builtinPacks },
    api: {}, refreshList: async () => [], settle: async () => {}, select: async (ids: string[]) => { controller.selection = ids; },
    edit: async (...args: any[]) => { edits.push(args); return controller.view; },
    create: async (content: any) => { creates.push(content); return { document: { ...document, ...content } }; }, send: async () => undefined,
  };
  return { document, controller, edits, creates };
}
test('new canvas is one click with no fields; title saves in place and document settings open from More actions', async () => {
  const f = fixture(), r = runtime(f.controller);
  let tree = r.render();
  await find(tree, 'Button', 'Nuevo lienzo').props.onPress();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.creates.length, 1);
  assert.equal(f.creates[0].title, 'Lienzo sin título');
  assert.equal(f.creates[0].communication.instructions, '');
  assert.equal(createInputSchema.safeParse({ workspaceId: 'workspace', content: f.creates[0] }).success, true);
  const documents = nodes(tree).find(node => node.type?.name === 'Modal' && node.props.title === 'Documentos')!;
  assert.equal(nodes(documents).some(node => ['Input', 'Field'].includes(node.type?.name)), false);
  find(tree, 'MenuRow', 'Renombrar lienzo').props.onPress(); tree = r.render();
  await find(tree, 'Field', 'Título del lienzo').props.onSave('Título nuevo');
  assert.equal(f.edits[0][0][0].title, 'Título nuevo');
  find(tree, 'MenuRow', 'Ajustes del lienzo').props.onPress();
  tree = r.render();
  assert.ok(nodes(tree, true).some(node => node.type?.name === 'Modal' && node.props.title === 'Ajustes del lienzo'));
});
test('floating panel keeps composer visible and opens contextual actions explicitly through the toolbar passed to Canvas', () => {
  const f = fixture(), r = runtime(f.controller);
  let tree = r.render(); tree.props.onLayout({ nativeEvent: { layout: { width: 1280, height: 800 } } }); tree = r.render();
  const types = () => nodes(tree, true).map(node => node.type?.name);
  assert.ok(!types().includes('Catalog') && !types().includes('Inspector'));
  assert.ok(types().includes('ContextTray'));
  assert.equal(find(tree, 'Canvas').props.selectionToolbar, undefined);
  f.controller.selection = ['note']; tree = r.render();
  assert.ok(!types().includes('Inspector'));
  const toolbar = find(tree, 'Canvas').props.selectionToolbar;
  const actions = toolbar.type(toolbar.props);
  assert.ok(nodes(actions).some(node => node.props.accessibilityLabel === 'Preguntar'));
  nodes(actions).find(node => node.props.accessibilityLabel === 'Más')!.props.onPress({ stopPropagation() {} }); tree = r.render();
  const contextual = find(tree, 'Canvas').props.selectionToolbar;
  assert.equal(contextual.props.popup.kind, 'more');
  assert.ok(nodes(contextual.type(contextual.props)).some(node => node.props.accessibilityLabel === 'Datos…'));
  assert.ok(!types().includes('Inspector'));
  f.controller.selection = []; f.controller.events = [{ id: 'pending', status: 'pending' }]; tree = r.render();
  assert.ok(types().includes('ContextTray'));
});
test('details omit technical fields and editing instructions preserves hidden intent and audience', async () => {
  const f = fixture(), r = runtime(f.controller); f.controller.selection = ['note'];
  const inspector = r.load('Inspector').Inspector({ controller: f.controller, linkId: null, onLink() {}, rects: () => new Map(), release() {}, reorder() {}, groupSelection() {}, onTemplate() {}, onExportSelection() {} });
  const labels = nodes(inspector).map(node => node.props.label ?? node.props.title);
  for (const removed of ['Datos', 'Copiar ID', 'Ancho (px)', 'Alto (px)', 'Ubicación', 'Intención', 'Audiencia']) assert.ok(!labels.includes(removed));
  const editor = nodes(inspector).find(node => node.type?.name === 'CommunicationEditor')!;
  const field = editor.type(editor.props);
  assert.equal(field.props.label, 'Indicaciones para el asistente');
  await field.props.onSave('Después');
  assert.deepEqual(JSON.parse(JSON.stringify(f.edits[0][0][0].patch.communication)), { intent: 'Revisar', audience: 'Yo', instructions: 'Después' });
  assert.equal(labels.includes('Tamaño automático'), false);
  f.document.blocks[0].size = { width: 320, height: 160 };
  const sized = runtime(f.controller).load('Inspector').Inspector({ controller: f.controller, linkId: null, onLink() {}, rects: () => new Map(), release() {}, reorder() {}, groupSelection() {}, onTemplate() {}, onExportSelection() {} });
  await find(sized, 'Button', 'Tamaño automático').props.onPress();
  assert.equal(f.edits.at(-1)[0][0].patch.size, null);
});
test('friendly errors translate known server codes and hide unknown raw messages', () => {
  const r = runtime(fixture().controller);
  for (const code of ['REVISION_CONFLICT', 'NOT_FOUND', 'VALIDATION', 'INVARIANT', 'UNKNOWN_TYPE', 'UNDO_BLOCKED', 'FORBIDDEN', 'TOO_LARGE', 'UNAVAILABLE']) {
    const raw = `${code}: private technical details`;
    const result = r.friendlyError(new Error(raw));
    assert.ok(!result.includes(code) && !result.includes('private'));
    assert.equal(r.friendlyError(result), result);
  }
  assert.equal(r.friendlyError(new Error('Unexpected server details /private/file')), 'No se pudo completar la acción. Vuelve a intentarlo.');
  assert.equal(tokens.font.style.label.family, 'sans');
  assert.equal(tokens.font.style.code.family, 'mono');
});

test('catalog rows display names without raw type or collection IDs', () => {
  const f = fixture();
  f.controller.catalog = { revision: 0, blockTypes: [{ ...builtinTypes[0], id: 'internal-type-id', name: 'Nota propia' }], templates: [], packs: [{ ...builtinPacks[0], id: 'internal-pack-id', name: 'Colección propia' }] };
  for (const initialTab of ['types', 'packs']) {
    const tree = runtime(f.controller).load('Catalog').Catalog({ controller: f.controller, initialTab, insert() {}, insertTemplate() {}, onImport() {}, onExport() {} });
    const text = nodes(tree).flatMap(node => node.props.children).filter(value => typeof value === 'string');
    assert.ok(text.includes(initialTab === 'types' ? 'Nota propia' : 'Colección propia'));
    assert.ok(!text.includes('internal-type-id') && !text.includes('internal-pack-id'));
  }
});
