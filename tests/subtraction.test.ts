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
import { canvasPreferences, interfacePreferences } from '../plugin/shared/preferences';
import * as shortcuts from '../plugin/client/shortcuts';
import * as palette from '../plugin/client/palette';
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
    '../shared/preferences': { canvasPreferences, interfacePreferences }, './web': { isMacPlatform: () => false, focusInput() {}, keyboard: () => () => {} }, './motion': {},
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
    './renderers/RegisteredRenderer': { RegisteredRenderer: control('RegisteredRenderer') }, './renderers': { getClientRenderer: () => undefined }, './Hojas': { HojaControls: control('HojaControls'), HojaMenu: control('HojaMenu'), LatestPill: control('LatestPill'), useCopilotCanvas: () => ({ hojas: [], current: -1, follow: true, glowIds: [], unseen: false, menuOpen: false, setMenuOpen() {}, toggleFollow() {}, goToLatest: () => false, goToHoja: () => false, step: () => false, userMoved() {} }) }, './Extensions': { ExtensionTool: control('ExtensionTool'), extensionIcon: () => 'Puzzle' },
    './Toolbar': { Toolbar: control('Toolbar'), GLOSSARY: { lienzo: 'Lienzo', marco: 'Marco (Spanish for frame)', hoja: 'Hoja', lente: 'Lente', ventana: 'Ventana (Spanish for window)' }, shapeIcon: () => 'Square' },
    './AddMenu': { AddMenu: control('AddMenu') }, './RightPanel': { RightPanel: control('RightPanel'), PanelSection: control('PanelSection') },
    './CommandPalette': { CommandPalette: control('CommandPalette') }, './ShortcutSheet': { ShortcutSheet: control('ShortcutSheet'), ShortcutList: control('ShortcutList') },
    './Eggs': { EmptyMate: control('EmptyMate'), Kettle: control('Kettle'), LoadingEgg: control('LoadingEgg') },
    './shortcuts': shortcuts, './palette': palette,
  };
  const load = (name: string) => {
    const source = readFileSync(new URL(`../plugin/client/${name}.tsx`, import.meta.url), 'utf8');
    const output = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, esModuleInterop: true } }).outputText;
    const exports: any = {};
    runInNewContext(output, { exports, require: (id: string) => { assert.ok(id in modules, `Unexpected import ${id}`); return modules[id]; }, Error, SyntaxError });
    return exports;
  };
  const realUI = load('ui');
  modules['./ui'] = Object.fromEntries(['Button', 'Chip', 'Field', 'Input', 'IconButton', 'Segments', 'Txt', 'UIProvider', 'Section', 'CheckRow', 'MenuRow', 'MenuDivider', 'TooltipProvider', 'TooltipLayer'].map(name => [name, control(name)]));
  Object.assign(modules['./ui'], { Modal: modal, friendlyError: realUI.friendlyError, useTooltip: () => ({ ref: { current: null }, onHoverIn() {}, onHoverOut() {}, onPressIn() {}, onLongPress() {} }), useUI: () => ({ compact: false, host: { id: 'host' }, layout: { platform: 'web' }, font: () => ({}), c: {}, wash: () => '', tone: () => '' }) });
  modules['./Catalog'] = { Catalog: control('Catalog'), PackImport: control('PackImport'), PackExport: control('PackExport') };
  modules['./SelectionActions'] = load('SelectionActions');
  const panel = load('Panel').LienzoPanel({ theme: {}, layout: {}, host: { id: 'host' }, workspaceId: 'workspace' }).props.children[0];
  // The panel's root view sits inside the tooltip provider.
  return { render: () => { cursor = 0; return panel.type(panel.props).props.children[0]; }, load, friendlyError: realUI.friendlyError, modules };
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
test('new canvas is one click with no fields; title saves in place; instructions open in the right panel', async () => {
  const f = fixture(), r = runtime(f.controller);
  let tree = r.render();
  await find(tree, 'Button', 'New Lienzo').props.onPress();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.creates.length, 1);
  assert.equal(f.creates[0].title, 'Untitled Lienzo');
  assert.equal(f.creates[0].communication.instructions, '');
  assert.equal(createInputSchema.safeParse({ workspaceId: 'workspace', content: f.creates[0] }).success, true);
  const documents = nodes(tree).find(node => node.type?.name === 'Modal' && node.props.title === 'Lienzos')!;
  assert.equal(nodes(documents).some(node => ['Input', 'Field'].includes(node.type?.name)), false);
  find(tree, 'MenuRow', 'Rename').props.onPress(); tree = r.render();
  await find(tree, 'Field', 'Lienzo title').props.onSave('A new title');
  assert.equal(f.edits[0][0][0].title, 'A new title');
  assert.ok(!nodes(tree).some(node => node.type?.name === 'RightPanel'), 'nothing selected, nothing asked: no panel');
  find(tree, 'MenuRow', 'Instructions for the agent').props.onPress(); tree = r.render();
  const panel = find(tree, 'RightPanel');
  assert.deepEqual(Array.from(panel.props.tabs, (t: any) => t.label), ['Lienzo']);
  assert.equal(panel.props.focusSection, 'Instructions for the agent');
});
test('no view switcher anywhere: the toolbar, the composer and the selection bar passed to Canvas', () => {
  const f = fixture(), r = runtime(f.controller);
  let tree = r.render(); tree.props.onLayout({ nativeEvent: { layout: { width: 1280, height: 800 } } }); tree = r.render();
  const types = () => nodes(tree, true).map(node => node.type?.name);
  assert.ok(!types().includes('Catalog') && !types().includes('RightPanel'));
  assert.ok(types().includes('ContextTray') && types().includes('Toolbar'));
  const labels = JSON.stringify(nodes(tree).map(node => node.props.label ?? node.props.accessibilityLabel ?? null));
  for (const gone of ['Cambiar vista', 'Change view', 'Foco', 'Lecturas', 'Matriz', 'Herramientas propias', 'Ver como lista']) assert.ok(!labels.includes(gone), gone);
  assert.equal(find(tree, 'Canvas').props.selectionToolbar, undefined);
  f.controller.selection = ['note']; tree = r.render();
  const bar = find(tree, 'Canvas').props.selectionToolbar;
  assert.equal(bar.type.name, 'SelectionBar');
  const rendered = nodes(bar.type(bar.props));
  assert.deepEqual(Array.from(rendered.filter(node => node.type?.name === 'BarButton'), node => node.props.label), ['Wrap in a Marco', 'Duplicate', 'Ask the agent', 'Delete']);
  const panel = find(tree, 'RightPanel');
  assert.deepEqual(Array.from(panel.props.tabs, (t: any) => t.id), ['properties']);
  assert.equal(panel.props.tabs[0].content.type.name, 'SelectionProperties');
  f.controller.selection = []; f.controller.events = [{ id: 'pending', status: 'pending' }]; tree = r.render();
  assert.ok(types().includes('ContextTray'));
});
test('Properties omit technical fields and editing instructions preserves hidden intent and audience', async () => {
  const f = fixture(), r = runtime(f.controller); f.controller.selection = ['note'];
  const { SelectionProperties } = r.modules['./SelectionActions'];
  const props = { controller: f.controller, panelRoot: { current: null }, disabled: false, linkId: null, onLink() {}, rects: () => new Map(), release() {}, ask() {}, add() {}, duplicate() {}, remove() {}, groupSelection() {}, connectSelection() {}, template() {}, exportSelection() {}, editText() {}, interact() {}, undoNotice() {} };
  const tree = SelectionProperties(props), all = nodes(tree), labels = all.map(node => node.props.label ?? node.props.title ?? node.props.accessibilityLabel);
  for (const removed of ['Copy ID', 'Width (px)', 'Height (px)', 'Location', 'Intent', 'Audience']) assert.ok(!labels.includes(removed), removed);
  assert.ok(labels.includes('Content') && labels.includes('Instructions for the agent') && labels.includes('Actions'));
  const field = find(tree, 'Field', 'How the agent should talk about this');
  await field.props.onSave('After');
  assert.deepEqual(JSON.parse(JSON.stringify(f.edits[0][0][0].patch.communication)), { intent: 'Revisar', audience: 'Yo', instructions: 'After' });
  assert.equal(labels.includes('Automatic size'), false);
  f.document.blocks[0].size = { width: 320, height: 160 };
  const sized = nodes(SelectionProperties(props)).find(node => node.props.accessibilityLabel === 'Automatic size')!;
  sized.props.onPress({ stopPropagation() {} }); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.edits.at(-1)[0][0].patch.size, null);
});
test('⌘K lists tools, actions and Lienzos, and "Ask the agent" sends through the composer path with the selection', async () => {
  const f = fixture(), r = runtime(f.controller), sent: any[] = [];
  f.controller.send = async (action: any, id: string) => { sent.push({ action, id }); return { id, status: 'pending', action }; };
  f.controller.documents = [{ id: 'other', title: 'Another Lienzo', example: false, updatedAt: new Date().toISOString() }];
  f.controller.selection = ['note'];
  const tree = r.render(), palette = find(tree, 'CommandPalette');
  const items = palette.props.items('pen');
  const groups = [...new Set(items.map((i: any) => i.group))];
  for (const group of ['Tools', 'Actions', 'Lienzos', 'Extensions', 'Settings', 'Ask the agent']) assert.ok(groups.includes(group), group);
  assert.ok(items.some((i: any) => i.title === 'Another Lienzo'));
  assert.equal(palette.props.items('').some((i: any) => i.group === 'Ask the agent'), false, 'nothing to ask without a query');
  const ask = items.find((i: any) => i.group === 'Ask the agent');
  assert.equal(ask.title, 'Ask the agent: pen');
  palette.props.onRun(ask, false); await new Promise(resolve => setImmediate(resolve)); await new Promise(resolve => setImmediate(resolve));
  assert.equal(sent.length, 1);
  assert.equal(sent[0].action.kind, 'selection.send'); assert.deepEqual(Array.from(sent[0].action.targetIds), ['note']); assert.equal(sent[0].action.payload.note, 'pen');
});
test('friendly errors translate known server codes and hide unknown raw messages', () => {
  const r = runtime(fixture().controller);
  for (const code of ['REVISION_CONFLICT', 'NOT_FOUND', 'VALIDATION', 'INVARIANT', 'UNKNOWN_TYPE', 'UNDO_BLOCKED', 'FORBIDDEN', 'TOO_LARGE', 'UNAVAILABLE']) {
    const raw = `${code}: private technical details`;
    const result = r.friendlyError(new Error(raw));
    assert.ok(!result.includes(code) && !result.includes('private'));
    assert.equal(r.friendlyError(result), result);
  }
  assert.equal(r.friendlyError(new Error('Unexpected server details /private/file')), 'That did not work. Try again.');
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
