import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { annotatedContentSpec, annotatedContentDataSchema, annotatedContentAnchorSchema, initialAnnotatedState, readAnnotatedState,
  resolveAnnotatedAnchor, validTextOffsets, ANNOTATED_LIMITS, type AnnotatedContentData } from '../plugin/shared/renderers/annotated-content';
import { setup, mutation, workspaceId } from './helpers';
import { CanvasStore } from '../plugin/server/store';
import { CanvasService } from '../plugin/server/service';
import { LearningRuntimeStore } from '../plugin/client/learning-state';
import type { CanvasController } from '../plugin/client/useCanvas';
import type { RendererProps } from '../plugin/client/renderers/types';

// Host-only stubs are local to this file. Components, anchor logic, runtime, service,
// and persistence are production code; no browser/native bridge is started.
type Element = { type: unknown; props: Record<string, any> };
type Slots = unknown[];
let slots: Slots = [], cursor = 0;
const effects: (() => void)[] = [];
export const Platform = { OS: 'web' }, View = 'View', Image = 'Image', Pressable = 'Pressable', Icon = 'Icon', Txt = 'Txt', Button = 'Button', Chip = 'Chip';
export const Fragment = 'fragment';
export function createElement(type: unknown, props: Record<string, unknown> | null, ...children: unknown[]): Element {
  return { type, props: { ...props, ...(children.length ? { children: children.length === 1 ? children[0] : children } : {}) } };
}
export function useRef<T>(current: T): { current: T } { const i = cursor++; return (slots[i] ??= { current }) as { current: T }; }
export function useState<T>(initial: T): [T, (value: T) => void] { const owned = slots, i = cursor++; if (!(i in owned)) owned[i] = initial; return [owned[i] as T, value => { owned[i] = value; }]; }
export function useEffect(effect: () => void, deps: unknown[]) {
  const i = cursor++, old = slots[i] as unknown[] | undefined;
  if (!old || deps.some((d, index) => !Object.is(d, old[index]))) { slots[i] = deps; effects.push(effect); }
}
export function useMemo<T>(get: () => T) { return get(); }
export function useSyncExternalStore(_subscribe: unknown, get: () => unknown) { return get(); }
export const jsx = (type: unknown, props: Record<string, unknown>) => ({ type, props }), jsxs = jsx;
export function createContext<T>(value:T){return{value,Provider:'context-provider'};}
export function useContext<T>(context:{value:T}){return context.value;}
export default { createElement, Fragment };
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === 'react' || specifier === 'react/jsx-runtime' || specifier === 'react-native'
    || specifier === '@getpaseo/plugin/client/react-native' || specifier.endsWith('/ui') && context.parentURL?.includes('/plugin/client/')) {
    return { url: new URL('./annotated-content.test.ts', `file://${__filename}`).href, shortCircuit: true };
  }
  return nextResolve(specifier, context);
} });
const { annotatedContentRenderer, annotatedImageFrame, annotatedImageGeometry } = require('../plugin/client/renderers/annotated-content') as typeof import('../plugin/client/renderers/annotated-content');
const { NativeLearningFallback } = require('../plugin/client/Surfaces') as typeof import('../plugin/client/Surfaces');
const { useLearning } = require('../plugin/client/useLearning') as typeof import('../plugin/client/useLearning');

const textData = (): AnnotatedContentData => annotatedContentDataSchema.parse({ question: '¿Qué cambia en este pasaje?',
  base: { kind: 'text', key: 'reading', revision: 'r1', passages: [{ id: 'p1', text: 'Una señal viaja.' }] },
  layers: [{ id: 'cause', name: 'Causa', visible: true }, { id: 'effect', name: 'Efecto', visible: false }],
  annotations: [{ id: 'a1', title: 'Señal', text: 'Observa lo que viaja.', anchor: { kind: 'text-range', baseKey: 'reading', baseRevision: 'r1', layerId: 'cause', passageId: 'p1', passageText: 'Una señal viaja.', start: 4, end: 9 } },
    { id: 'a2', title: 'Movimiento', text: 'Observa el verbo.', anchor: { kind: 'text-range', baseKey: 'reading', baseRevision: 'r1', layerId: 'effect', passageId: 'p1', passageText: 'Una señal viaja.', start: 10, end: 15 } }],
});
const imageData = (): AnnotatedContentData => annotatedContentDataSchema.parse({ question: '¿Qué destaca en la figura?',
  base: { kind: 'image', key: 'figure', revision: 'r1', url: 'https://example.org/figure.png', alt: 'Figura de referencia declarada', aspectRatio: 2 },
  layers: [{ id: 'cause', name: 'Causa', visible: true }], annotations: [
    { id: 'point', title: 'Origen', text: 'Observa este punto.', anchor: { kind: 'image-point', baseKey: 'figure', baseRevision: 'r1', layerId: 'cause', sourceUrl: 'https://example.org/figure.png', x: .25, y: .75 } },
    { id: 'rect', title: 'Región', text: 'Observa esta región.', anchor: { kind: 'image-rect', baseKey: 'figure', baseRevision: 'r1', layerId: 'cause', sourceUrl: 'https://example.org/figure.png', x: .5, y: .2, width: .5, height: .6 } },
  ],
});
const all = (node: Element): Element[] => [node, ...(Array.isArray(node.props.children) ? node.props.children.flat(Infinity) : [node.props.children]).filter((n: unknown): n is Element => !!n && typeof n === 'object' && 'props' in n).flatMap(all)];
const ofType = (node: Element, type: unknown) => all(node).filter(n => n.type === type);
const button = (node: Element, label: string) => ofType(node, Button).find(n => n.props.label === label)!;
const mark = (node: Element, id: string) => all(node).find(n => n.props.nativeID === `lienzo-interactive-annotation-b-${id}`)!;
const layer = (node: Element, name: string) => ofType(node, Pressable).find(n => n.props.accessibilityRole === 'checkbox' && n.props.accessibilityLabel === name)!;
const text = (node: Element) => ofType(node, Txt).flatMap(n => Array.isArray(n.props.children) ? n.props.children.flat(Infinity) : [n.props.children]).filter(n => typeof n === 'string' || typeof n === 'number').join(' ');
const tick = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const press = (element: Element) => element.props.onPress({ stopPropagation() {} });
function harness(data = textData(), readOnly = false, platform = 'web') {
  const owned: Slots = [], writes: any[][] = [], events: any[][] = [];
  const props = { data, document: {}, block: { id: 'b' }, compact: false, availableWidth: 400, readOnly,
    ui: { compact: false, layout: { platform }, c: { surface0: '#fff', surface1: '#fff', surface2: '#eee', foreground: '#111', foregroundMuted: '#555', border: '#ccc', accent: '#246', accentForeground: '#fff', statusDanger: '#933' } },
    runtime: { state: {}, set(state: Record<string, unknown> | null, settled: boolean) { writes.push([state, settled]); (props.runtime as any).state = state ?? {}; }, flush: async () => {}, settle: async (...args: unknown[]) => { events.push(args); } },
  } as unknown as RendererProps<AnnotatedContentData>;
  return { props, writes, events, render() {
    Platform.OS = props.ui.layout.platform; slots = owned; cursor = 0; effects.length = 0;
    const node = (annotatedContentRenderer.Component as Function)(props) as Element;
    for (const effect of effects.splice(0)) effect(); return node;
  } };
}
function loadImage(h: ReturnType<typeof harness>, width = 400, intrinsicWidth = 200, intrinsicHeight = 400) {
  const node = h.render(), image = ofType(node, Image)[0];
  const wrapper = ofType(node, View).find(n => n.props.onLayout)!;
  wrapper.props.onLayout({ nativeEvent: { layout: { width } } });
  image.props.onLoad({ nativeEvent: { source: { width: intrinsicWidth, height: intrinsicHeight } } });
  return h.render();
}

test('annotated schema has honest empty defaults, strict declarative data and small explicit budgets', () => {
  const defaults = annotatedContentDataSchema.parse(annotatedContentSpec.blockType.defaults);
  assert.equal(defaults.annotations.length, 0); assert.equal(defaults.layers.length, 0);
  assert.deepEqual(defaults.base.kind === 'text' && defaults.base.passages, []);
  assert.equal(annotatedContentRenderer.id, annotatedContentSpec.id);
  assert.deepEqual(new Set(annotatedContentSpec.blockType.properties.map(p => p.key)), new Set(['question', 'base', 'layers', 'annotations']));
  for (const patch of [{ question: '' }, { js: 'eval(1)' }, { html: '<b>x</b>' }, { annotations: Array(13).fill(textData().annotations[0]) },
    { layers: Array(5).fill(textData().layers[0]) }, { layers: [textData().layers[0], textData().layers[0]] }, { annotations: [textData().annotations[0], textData().annotations[0]] },
    { base: { kind: 'text', key: 'reading', revision: '1', passages: Array(5).fill({ id: 'p', text: 'x' }) } },
    { base: { kind: 'text', key: 'reading', revision: '1', passages: [{ id: 'p', text: 'x'.repeat(2001) }] } },
    { annotations: [{ ...textData().annotations[0], onPress: () => {} }] },
  ]) assert.equal(annotatedContentDataSchema.safeParse({ ...textData(), ...patch }).success, false);
  for (const url of ['javascript:alert(1)', 'data:image/png,a', 'file:///tmp/a', 'https://user:pass@example.org/a']) {
    const image = imageData(); assert.equal(annotatedContentDataSchema.safeParse({ ...image, base: { ...image.base, url } }).success, false);
  }
  const worst = textData();
  worst.base = { kind: 'text', key: 'base', revision: 'r1', passages: Array.from({ length: 4 }, (_, i) => ({ id: `p${i}`, text: '😀'.repeat(1000) })) };
  worst.layers = Array.from({ length: 4 }, (_, i) => ({ id: `l${i}`, name: 'c'.repeat(60), visible: true }));
  worst.annotations = Array.from({ length: 12 }, (_, i) => ({ id: `a${i}`, title: 't'.repeat(100), text: '😀'.repeat(300), anchor: {
    kind: 'text-range', baseKey: 'base', baseRevision: 'r1', layerId: `l${i % 4}`, passageId: `p${i % 4}`, passageText: '😀'.repeat(1000), start: 0, end: 2,
  } }));
  assert.ok(annotatedContentDataSchema.parse(worst)); assert.ok(Buffer.byteLength(JSON.stringify(worst)) < 1024 * 1024);
  assert.equal(ANNOTATED_LIMITS.annotations, 12);
  const state = { ...initialAnnotatedState(worst), explored: worst.annotations.map(a => a.id), visitedLayers: worst.layers.map(l => l.id), selected: 'a0' };
  assert.ok(Buffer.byteLength(JSON.stringify(state)) < 4096);
});

test('text anchors validate offsets and become unresolved for edits with the same passage ID and revision', () => {
  const data = textData(), anchor = data.annotations[0].anchor;
  assert.deepEqual(resolveAnnotatedAnchor(data, anchor), { resolved: true, message: '', excerpt: 'señal' });
  const edited = structuredClone(data); if (edited.base.kind === 'text') edited.base.passages[0].text = 'Una cosa viaja.';
  assert.ok(annotatedContentDataSchema.parse(edited)); assert.match(resolveAnnotatedAnchor(edited, anchor).message, /texto del pasaje cambió/);
  for (const patch of [{ start: -1 }, { end: 3000 }, { start: 8, end: 8 }, { start: 1.5 }, { end: 17 }]) {
    assert.equal(annotatedContentAnchorSchema.safeParse({ ...anchor, ...patch }).success, false);
  }
  assert.equal(resolveAnnotatedAnchor(data, { ...anchor, kind: 'text-range', passageId: 'p1', passageText: 'Una señal viaja.', start: 0, end: 100 }).resolved, false);
  assert.equal(validTextOffsets('a😀b', 1, 3), true); assert.equal(validTextOffsets('a😀b', 2, 3), false); assert.equal(validTextOffsets('a😀b', 1, 2), false);
  assert.equal(annotatedContentAnchorSchema.safeParse({ ...anchor, passageText: 'a😀b', start: 1, end: 2 }).success, false);
});

test('removed layers/passages, changed base types/keys/revisions and image sources stay unresolved', () => {
  const data = textData(), anchor = data.annotations[0].anchor;
  assert.match(resolveAnnotatedAnchor({ ...data, layers: [] }, anchor).message, /capa ya no existe/);
  if (data.base.kind === 'text') {
    assert.match(resolveAnnotatedAnchor({ ...data, base: { ...data.base, passages: [] } }, anchor).message, /pasaje ya no existe/);
    assert.match(resolveAnnotatedAnchor({ ...data, base: { ...data.base, key: 'other' } }, anchor).message, /referencia base cambió/);
    assert.match(resolveAnnotatedAnchor({ ...data, base: { ...data.base, revision: 'r2' } }, anchor).message, /revisión/);
  }
  const image = imageData();
  assert.equal(resolveAnnotatedAnchor(image, image.annotations[0].anchor).resolved, true);
  assert.match(resolveAnnotatedAnchor({ ...data, base: { ...image.base, key: 'reading' } }, anchor).message, /ya no es texto/);
  assert.match(resolveAnnotatedAnchor({ ...image, base: { ...data.base, key: 'figure' } }, image.annotations[0].anchor).message, /ya no es una imagen/);
  assert.match(resolveAnnotatedAnchor({ ...image, base: { ...image.base, kind: 'image', url: 'https://example.org/replacement.png', alt: 'Otra', aspectRatio: 1 } }, image.annotations[0].anchor).message, /imagen de referencia cambió/);
});

test('normalized image coordinates map to the confirmed image rectangle, including resize and boundary marks', () => {
  const data = imageData(), point = data.annotations[0].anchor, rect = data.annotations[1].anchor;
  for (const patch of [{ x: -.01 }, { y: 1.01 }, { x: Infinity }, { x: NaN }]) assert.equal(annotatedContentAnchorSchema.safeParse({ ...point, ...patch }).success, false);
  for (const patch of [{ width: 0 }, { height: -1 }, { x: .6, width: .5 }, { y: .9, height: .2 }]) assert.equal(annotatedContentAnchorSchema.safeParse({ ...rect, ...patch }).success, false);
  assert.ok(annotatedContentAnchorSchema.parse({ ...point, x: 0, y: 1 }));
  assert.deepEqual(annotatedImageFrame(400, 200, 400), { width: 400, height: 800 });
  assert.deepEqual(annotatedImageFrame(200, 800, 400), { width: 200, height: 100 }); assert.equal(annotatedImageFrame(0, 800, 400), null);
  assert.deepEqual(annotatedImageGeometry(data.annotations[0], { width: 400, height: 800 }), { x: 100, y: 600, rect: null });
  assert.deepEqual(annotatedImageGeometry(data.annotations[1], { width: 200, height: 100 }), { x: 150, y: 50, rect: { left: 100, top: 20, width: 100, height: 60 } });
});

test('actual text component reveals on focus, toggles named layers, resets runtime and preserves authored content', async () => {
  const h = harness(), authored = JSON.stringify(h.props.data);
  let node = h.render(); assert.ok(mark(node, 'a1')); assert.equal(mark(node, 'a2'), undefined);
  mark(node, 'a1').props.onFocus(); await tick(); node = h.render();
  assert.match(text(node), /Observa lo que viaja/); assert.equal(h.writes.at(-1)![1], true);
  assert.deepEqual(h.props.runtime.state.explored, ['a1']); assert.equal(h.events.length, 0);
  assert.ok(ofType(layer(node, 'Causa'), Icon).some(n => n.props.name === 'Eye'));
  press(layer(node, 'Causa')); node = h.render(); assert.equal(mark(node, 'a1'), undefined); assert.equal(h.props.runtime.state.selected, null);
  assert.ok(ofType(layer(node, 'Causa'), Icon).some(n => n.props.name === 'EyeOff'));
  press(layer(node, 'Efecto')); node = h.render(); press(mark(node, 'a2')); node = h.render(); assert.match(text(node), /Observa el verbo/);
  button(node, 'Reiniciar').props.onPress(); await tick(); node = h.render();
  assert.deepEqual(h.props.runtime.state, {}); assert.equal(mark(node, 'a2'), undefined); assert.ok(mark(node, 'a1')); assert.ok(!text(node).includes('Observa lo que viaja'));
  assert.equal(JSON.stringify(h.props.data), authored); assert.deepEqual(readAnnotatedState(h.props.data, {}), initialAnnotatedState(h.props.data));
});

test('actual image component waits for a measured loaded image, handles failures/source changes and rescales hotspots', async () => {
  const h = harness(imageData()); let node = h.render();
  assert.equal(mark(node, 'point'), undefined); assert.match(text(node), /Cargando imagen/); assert.match(text(node), /pendiente de verificar/);
  node = loadImage(h); assert.equal(mark(node, 'point').props.style.left, 84); assert.equal(mark(node, 'point').props.style.top, 584);
  const image = ofType(node, Image)[0]; assert.equal(image.props.accessibilityLabel, 'Figura de referencia declarada'); assert.equal(image.props.resizeMode, 'contain');
  assert.equal(ofType(node, View).find(n => n.props.onLayout)!.props.style.height, 800);
  mark(node, 'point').props.onFocus(); node = h.render(); assert.match(text(node), /Observa este punto/);
  const oldMark = mark(node, 'rect');
  image.props.onError(); node = h.render(); assert.equal(mark(node, 'point'), undefined); assert.match(text(node), /No se pudo cargar/);
  const before = h.writes.length; oldMark.props.onFocus(); assert.equal(h.writes.length, before);
  node = loadImage(h, 200); assert.equal(mark(node, 'point').props.style.left, 34); assert.equal(mark(node, 'point').props.style.top, 284);
  h.props.compact = true; node = h.render(); assert.equal(mark(node, 'point').props.style.width, 44);
  const disc = ofType(mark(node, 'point'), View)[0]; assert.equal(disc.props.style.width, 22);
  h.props.data = imageData(); if (h.props.data.base.kind === 'image') h.props.data.base.url = 'https://example.org/new.png';
  node = h.render(); assert.equal(mark(node, 'point'), undefined); assert.match(text(node), /imagen de referencia cambió/);
  image.props.onLoad({ nativeEvent: { source: { width: 200, height: 400 } } }); node = h.render(); assert.equal(mark(node, 'point'), undefined);
  assert.match(text(node), /Cargando imagen/);
  // Zero dimensions cannot certify a drawable image.
  node = loadImage(h, 200, 0, 100); assert.match(text(node), /No se pudo cargar/);
  await tick();
});

test('real component never relocates stale text anchors and keeps unresolved captions visible', () => {
  const h = harness(); let node = h.render(); const old = mark(node, 'a1');
  h.props.data = structuredClone(h.props.data); if (h.props.data.base.kind === 'text') h.props.data.base.passages[0].text = 'Una cosa viaja.';
  node = h.render(); assert.equal(mark(node, 'a1'), undefined); assert.match(text(node), /Anotación no resuelta/); assert.match(text(node), /Observa lo que viaja/);
  old.props.onFocus(); assert.equal(h.writes.length, 0);
  h.props.data.layers = []; node = h.render(); assert.match(text(node), /capa ya no existe/);
});

test('readOnly handlers, stale handler references and honest native fallback cannot write or send', async () => {
  const h = harness(); const old = h.render(); h.props.readOnly = true; let node = h.render();
  assert.ok(mark(node, 'a1').props.disabled); press(mark(node, 'a1')); mark(node, 'a1').props.onFocus(); press(layer(node, 'Causa'));
  mark(old, 'a1').props.onFocus(); button(old, 'Compartir exploración').props.onPress(); button(node, 'Reiniciar').props.onPress(); await tick();
  assert.equal(h.writes.length, 0); assert.equal(h.events.length, 0);
  const native = harness(textData(), false, 'ios'); node = native.render();
  assert.equal(ofType(node, Chip)[0].props.label, 'Estático'); assert.equal(ofType(node, Pressable).length, 0); assert.equal(ofType(node, Image).length, 0);
  assert.ok(button(node, 'Reiniciar').props.disabled); button(node, 'Reiniciar').props.onPress();
  assert.equal(native.writes.length, 0); assert.equal(native.events.length, 0);
  assert.match(ofType(node, NativeLearningFallback)[0].props.summary, /Una señal viaja/);
  const fallback = NativeLearningFallback({ summary: 'Referencia' }) as unknown as Element;
  assert.match(text(fallback), /versión interactiva está disponible/); Platform.OS = 'web';
});

test('compact exploration and hint attempts flush first, retain frozen retry IDs/payloads and respect readOnly after awaiting', async () => {
  const h = harness(); let node = h.render(); press(mark(node, 'a1')); node = h.render();
  let fail = true; h.props.runtime.flush = async () => { if (fail) throw new Error('private-path'); };
  button(node, 'Compartir exploración').props.onPress(); await tick(); node = h.render();
  assert.equal(h.events.length, 0); assert.match(text(node), /No se pudo confirmar/); assert.ok(!text(node).includes('private-path'));
  fail = false; let uncertain = true;
  h.props.runtime.settle = async (...args) => { h.events.push(args); if (uncertain) throw new Error('lost response'); };
  button(node, 'Reintentar envío').props.onPress(); await tick(); node = h.render();
  press(layer(node, 'Efecto')); node = h.render(); // Later local state cannot rewrite an ambiguous event.
  uncertain = false; button(node, 'Reintentar envío').props.onPress(); await tick(); node = h.render();
  assert.deepEqual(h.events[1], h.events[0]); assert.deepEqual(h.events[0][1].visibleLayers, ['cause']);
  assert.deepEqual(h.events[0][1].explored, ['a1']); assert.ok(Buffer.byteLength(JSON.stringify(h.events[0][1])) < 4096);
  assert.ok(!JSON.stringify(h.events[0][1]).includes('Observa lo que viaja'));
  button(node, 'Pedir una pista').props.onPress(); await tick(); node = h.render();
  assert.match(h.events.at(-1)![1].request, /sin revelar la solución/); assert.equal(h.events.at(-1)![0], 'annotated-content.hint');
  let release!: () => void; h.props.runtime.flush = () => new Promise<void>(resolve => { release = resolve; });
  button(node, 'Compartir exploración').props.onPress(); h.props.readOnly = true; h.render(); const count = h.events.length;
  release(); await tick(); assert.equal(h.events.length, count);
});

test('component exploration persists through CanvasService, settled delivery dedupes lost acknowledgements and reset preserves content', async t => {
  const { service, store, directory } = await setup(t), data = textData(), reference = { documentId: 'd', workspaceId };
  // Coordinator owns registration. A local catalog type carries the identical authored
  // properties with an inert legacy renderer to test real persistence without editing indices.
  const type = { ...annotatedContentSpec.blockType, id: 'annotated-test', renderer: 'note' };
  await service.catalogMutate({ expectedRevision: 0, action: { type: 'type.put', blockType: type } });
  let view = await service.mutate(mutation(0, [{ type: 'block.delete', id: 'b' }, { type: 'block.create', block: { id: 'b', typeId: type.id, title: 'Anotaciones de prueba', data } }]));
  let transportService = service;
  const learning = new LearningRuntimeStore(request => transportService.runtimeSet(request), () => {});
  learning.sync(view.document, view.runtimeVersion, view.runtime); t.after(() => learning.reset());
  let lost = true, failFlush = false;
  const events: string[] = []; let delivery: Promise<unknown> = Promise.resolve();
  const controller = { view, current: { current: view }, learning,
    send: async (action: Parameters<CanvasController['send']>[0], eventId: string) => {
      events.push(eventId); delivery = service.action({ ...reference, expectedRevision: view.document.revision, action, eventId }); const event = await delivery;
      if (lost) { lost = false; return undefined; } return event;
    },
  } as unknown as CanvasController;
  const h = harness(data), actualFlush = learning.flush.bind(learning);
  learning.flush = async () => { if (failFlush) throw new Error('offline runtime'); await actualFlush(); };
  const refresh = () => { h.props.runtime = useLearning(view.document.blocks.find(b => b.id === 'b')!, controller).runtime; return h.render(); };
  let node = refresh(); press(mark(node, 'a1')); await learning.flush(); node = refresh();
  let saved = await service.read(reference); assert.deepEqual(saved.runtime.blocks.b.explored, ['a1']); assert.equal(saved.document.revision, 1);
  failFlush = true; button(node, 'Compartir exploración').props.onPress(); await tick(); node = refresh();
  assert.equal((await service.events(reference)).events.length, 0); failFlush = false;
  button(node, 'Reintentar envío').props.onPress(); await tick(); await delivery; await tick(); node = refresh();
  assert.match(text(node), /No se pudo confirmar/);
  button(node, 'Reintentar envío').props.onPress(); await tick(); await delivery; await tick();
  assert.equal(events.length, 2); assert.equal(events[0], events[1]);
  const retained = (await service.events(reference)).events;
  assert.equal(retained.length, 1); assert.equal(retained[0].action.settled, true); assert.equal(retained[0].action.delivery, 'batched');
  assert.deepEqual(retained[0].action.payload!.explored, ['a1']);
  await store.close();
  const reopened = new CanvasStore(directory), reopenedService = new CanvasService(reopened);
  try {
    saved = await reopenedService.read(reference); assert.deepEqual(saved.runtime.blocks.b.explored, ['a1']); assert.deepEqual(saved.document.blocks.find(b => b.id === 'b')!.data, data);
    transportService = reopenedService; learning.reset(); learning.sync(saved.document, saved.runtimeVersion, saved.runtime);
    node = refresh(); button(node, 'Reiniciar').props.onPress(); await actualFlush(); saved = await reopenedService.read(reference);
    assert.equal(saved.runtime.blocks.b, undefined); assert.deepEqual(saved.document.blocks.find(b => b.id === 'b')!.data, data);
  } finally { await reopened.close(); }
});
