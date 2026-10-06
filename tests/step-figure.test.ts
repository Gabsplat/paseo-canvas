import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { stepFigureDataSchema, stepFigureSpec, stepFigureElementSchema, resolveStepFigure, figureChanges, stepFigureState, type StepFigureData } from '../plugin/shared/renderers/step-figure';
import { Platform, Button } from './fixtures/native-headless';
import type { RendererProps } from '../plugin/client/renderers/types';
import type { Canvas2DContext } from '../plugin/client/Surfaces';

// Retained hook slots with dependency-aware effects and cleanup. Only the React/native
// hosts are replaced: renderer, schema, patches and drawing callbacks are real code.
type Element = { type: unknown; props: Record<string, any> };
type Effect = { deps?: readonly unknown[]; cleanup?: () => void };
type Host = { slots: unknown[]; effects: (() => void)[]; cursor: number };
let host: Host;
export function createElement(type: unknown, props: Record<string, unknown> | null, ...children: unknown[]): Element { return { type, props: { ...props, ...(children.length ? { children: children.length === 1 ? children[0] : children } : {}) } }; }
export function useRef<T>(current: T): { current: T } { return (host.slots[host.cursor++] ??= { current }) as { current: T }; }
export function useState<T>(initial: T): [T, (value: T | ((old: T) => T)) => void] { const owned = host, index = host.cursor++; if (!(index in owned.slots)) owned.slots[index] = initial; return [owned.slots[index] as T, value => { owned.slots[index] = typeof value === 'function' ? (value as (old: T) => T)(owned.slots[index] as T) : value; }]; }
export function useEffect(run: () => void | (() => void), deps?: readonly unknown[]) {
  const owned = host, index = host.cursor++, prior = owned.slots[index] as Effect | undefined;
  if (!prior || !deps || !prior.deps || deps.some((dep, i) => dep !== prior.deps![i]) || deps.length !== prior.deps.length) {
    owned.effects.push(() => { prior?.cleanup?.(); const cleanup = run(); owned.slots[index] = { deps, cleanup: typeof cleanup === 'function' ? cleanup : undefined } satisfies Effect; });
  }
}
export function useMemo<T>(run: () => T) { return run(); }
export const Fragment = 'fragment';
export const jsx = (type: unknown, props: Record<string, unknown>) => ({ type, props });
export const jsxs = jsx;
export function createContext<T>(value:T){return{value,Provider:'context-provider'};}
export function useContext<T>(context:{value:T}){return context.value;}
export default { createElement };
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === 'react' || specifier === 'react/jsx-runtime') return { url: new URL('./step-figure.test.ts', `file://${__filename}`).href, shortCircuit: true };
  if (specifier === 'react-native' || (specifier.endsWith('/ui') && context.parentURL?.includes('/plugin/client/'))) return { url: new URL('./fixtures/native-headless.ts', `file://${__filename}`).href, shortCircuit: true };
  return nextResolve(specifier, context);
} });
const { stepFigureRenderer } = require('../plugin/client/renderers/step-figure') as typeof import('../plugin/client/renderers/step-figure');
const { CanvasSurface, NativeLearningFallback } = require('../plugin/client/Surfaces') as typeof import('../plugin/client/Surfaces');
const { WebRange } = require('../plugin/client/web') as typeof import('../plugin/client/web');
const base = (patch: Record<string, unknown> = {}) => stepFigureDataSchema.parse({ ...stepFigureSpec.blockType.defaults, ...patch });
const sequence = () => base({
  steps: [
    { caption: 'Aparece el punto.', change: 'Se añade el punto.', patches: [{ op: 'add', element: { id: 'point', label: 'Punto', kind: 'circle', x: 160, y: 150, radius: 6 } }] },
    { caption: 'El punto cambia.', change: 'El punto aumenta de tamaño.', patches: [{ op: 'update', id: 'point', changes: { radius: 12, fill: 'accent' } }] },
    { caption: 'Solo queda la recta.', change: 'Se retira el punto.', patches: [{ op: 'remove', id: 'point' }] },
  ], playback: { intervalMs: 500 },
});
const all = (node: Element): Element[] => [node, ...(Array.isArray(node.props.children) ? node.props.children.flat(Infinity) : [node.props.children]).filter((value: unknown): value is Element => !!value && typeof value === 'object').flatMap(all)];
const find = (node: Element, type: unknown) => all(node).find(n => n.type === type);
const button = (node: Element, label: string) => all(node).find(n => n.type === Button && n.props.label === label)!;
const text = (node: Element) => all(node).filter(n => n.type === 'Txt').map(n => Array.isArray(n.props.children) ? n.props.children.flat(Infinity).join('') : String(n.props.children)).join(' ');
function drawing() {
  const strokes: { path: unknown[]; width: number; color: string; alpha: number; dash: number[] }[] = [], transforms: unknown[] = [], texts: string[] = [];
  let path: unknown[] = [], dash: number[] = [];
  const ctx = { fillStyle: '', strokeStyle: '', lineWidth: 1, globalAlpha: 1, font: '', textAlign: '', textBaseline: '', lineCap: '', lineJoin: '',
    clearRect() {}, fillRect() {}, strokeRect(...args: number[]) { strokes.push({ path: ['rect', ...args], width: this.lineWidth, color: this.strokeStyle, alpha: this.globalAlpha, dash }); },
    beginPath() { path = []; }, closePath() { path.push('close'); }, moveTo(...args: number[]) { path.push(['move', ...args]); }, lineTo(...args: number[]) { path.push(['line', ...args]); }, arc(...args: (number | boolean | undefined)[]) { path.push(['arc', ...args]); },
    quadraticCurveTo() {}, bezierCurveTo() {}, fill() {}, stroke() { strokes.push({ path, width: this.lineWidth, color: this.strokeStyle, alpha: this.globalAlpha, dash }); }, clip() {}, save() {}, restore() {}, setTransform() {},
    translate(...args: number[]) { transforms.push(['translate', ...args]); }, rotate() {}, scale(...args: number[]) { transforms.push(['scale', ...args]); }, setLineDash(values: number[]) { dash = values; },
    fillText(value: string) { texts.push(value); }, measureText(value: string) { return { width: value.length * 7 }; }, drawImage() {},
  } satisfies Canvas2DContext;
  return { ctx, strokes, transforms, texts };
}
function harness(data = base(), options: { readOnly?: boolean; platform?: string; state?: Record<string, number | number[]> } = {}) {
  const platform = options.platform ?? 'web'; Platform.OS = platform;
  const owned: Host = { slots: [], effects: [], cursor: 0 }, writes: unknown[] = [], events: any[][] = [];
  const props = {
    data, document: { id: 'doc' }, block: { id: 'figure' }, availableWidth: 400, compact: false, readOnly: options.readOnly ?? false,
    ui: { layout: { platform }, c: { foreground: '#111', foregroundMuted: '#555', surface0: '#fff', accent: '#246', border: '#ccc', statusDanger: '#933' } },
    runtime: { state: options.state ?? {}, set(state: Record<string, unknown> | null) { writes.push(state); (props.runtime as any).state = state ?? {}; }, flush: async () => {}, settle: async (...args: unknown[]) => { events.push(args); } },
    scope: { variables: {}, values: {}, get: () => NaN, set: () => { throw new Error('Figure must not change scope.'); } }, send: async () => { throw new Error('Use settled feedback.'); },
  } as unknown as RendererProps<StepFigureData>;
  const render = () => { host = owned; host.cursor = 0; const result = (stepFigureRenderer.Component as Function)(props) as Element; const pending = owned.effects.splice(0); pending.forEach(run => run()); return result; };
  return { props, writes, events, render,
    draw(node: Element, time = 0) { const probe = drawing(); find(node, CanvasSurface)!.props.draw(probe.ctx, { width: 400, height: 250, pixelRatio: 1, time }); return probe; },
    unmount() { for (const slot of owned.slots) if (slot && typeof slot === 'object' && 'cleanup' in slot) (slot as Effect).cleanup?.(); },
  };
}

test('schema validates portable defaults, strict declarative fields, references and bounded work', () => {
  assert.equal(stepFigureSpec.id, stepFigureRenderer.id); assert.ok(base()); assert.equal(base().playback, undefined);
  assert.deepEqual(new Set(stepFigureSpec.blockType.properties.map(p => p.key)), new Set(Object.keys(stepFigureDataSchema.shape)));
  const raw = stepFigureSpec.blockType.defaults, line = raw.initial.elements[0];
  const invalid = [
    { question: '' }, { html: '<svg/>' }, { viewBox: { width: 0, height: 1 } }, { viewBox: { width: Infinity, height: 1 } }, { viewBox: { width: Number.MIN_VALUE, height: 1 } },
    { initial: { caption: 'X', elements: [{ ...line, x: 10001 }] } }, { initial: { caption: 'X', elements: [{ ...line, kind: 'svg', code: '<circle/>' }] } },
    { initial: { caption: 'X', elements: [{ ...line, onclick: 'alert(1)' }] } }, { initial: { caption: 'X', elements: [line, line] } },
    { initial: { caption: 'X', elements: Array.from({ length: 65 }, (_, i) => ({ ...line, id: `e${i}` })) } },
    { initial: { caption: 'X', elements: [{ id: 'p', label: 'P', kind: 'polyline', points: Array.from({ length: 65 }, () => [0, 0]) }] } },
    { initial: { caption: 'X', elements: Array.from({ length: 17 }, (_, i) => ({ id: `p${i}`, label: 'P', kind: 'polyline', points: Array.from({ length: 64 }, () => [0, 0]) })) } },
    { steps: [] }, { steps: Array.from({ length: 49 }, () => ({ caption: 'X', change: 'X', patches: [{ op: 'update', id: 'base', changes: { x: 1 } }] })) },
    { playback: { intervalMs: 499 } }, { playback: { intervalMs: 10001 } }, { playback: { intervalMs: 1000, autoplay: true } },
  ];
  for (const patch of invalid) assert.equal(stepFigureDataSchema.safeParse({ ...raw, ...patch }).success, false, JSON.stringify(patch));
  const patches = [
    { op: 'update', id: 'missing', changes: { x: 1 } }, { op: 'remove', id: 'missing' }, { op: 'add', element: line },
    { op: 'update', id: 'base', changes: {} }, { op: 'update', id: 'base', changes: { id: 'new' } },
    { op: 'update', id: 'base', changes: { kind: 'circle' } }, { op: 'update', id: 'base', changes: { radius: 5 } },
    { op: 'update', id: 'base', changes: { x: null } }, { op: 'update', id: 'base', changes: { script: '1' } },
  ];
  for (const patch of patches) assert.equal(stepFigureDataSchema.safeParse({ ...raw, steps: [{ caption: 'X', change: 'X', patches: [patch] }] }).success, false, JSON.stringify(patch));
  assert.equal(stepFigureDataSchema.safeParse({ ...raw, steps: [{ caption: 'X', change: 'X', patches: [{ op: 'remove', id: 'base' }, { op: 'add', element: line }] }] }).success, false, 'Removed IDs cannot denote a different element later.');
  const repeat = { caption: 'X', change: 'X', patches: Array.from({ length: 64 }, () => ({ op: 'update', id: 'base', changes: { x: 1 } })) };
  assert.equal(stepFigureDataSchema.safeParse({ ...raw, steps: Array.from({ length: 9 }, () => repeat) }).success, false);
  const missing = stepFigureDataSchema.safeParse({ ...raw, steps: [{ caption: 'X', change: 'X', patches: [{ op: 'remove', id: 'absent' }] }] });
  assert.ok(!missing.success); assert.deepEqual(missing.error.issues[0].path, ['steps', 0, 'patches']);
});
test('sequential patches and arbitrary backtracking preserve IDs, geometry and authored inputs', () => {
  const data = sequence(), original = JSON.stringify(data), baseLine = data.initial.elements[0];
  for (const step of [0, 1, 2, 3, 2, 0, 3]) {
    const snapshot = resolveStepFigure(data, step); assert.equal(snapshot.error, undefined); assert.equal(snapshot.validStep, step);
    assert.deepEqual(snapshot.elements[0], baseLine); assert.equal(snapshot.caption, step === 0 ? data.initial.caption : data.steps[step - 1].caption);
    assert.equal(snapshot.elements.length, [1, 2, 2, 1][step]);
    if (step === 2) assert.equal((snapshot.elements[1] as any).radius, 12);
  }
  assert.equal(JSON.stringify(data), original);
  const forward = figureChanges(resolveStepFigure(data, 1).elements, resolveStepFigure(data, 2).elements);
  assert.deepEqual(forward.ids, ['point']); assert.match(forward.description, /Cambiado: Punto/);
  const removed = figureChanges(resolveStepFigure(data, 2).elements, resolveStepFigure(data, 3).elements);
  assert.deepEqual(removed.ids, ['point']); assert.equal((removed.outlines[0] as any).radius, 12); assert.match(removed.description, /Retirado: Punto/);
  const back = figureChanges(resolveStepFigure(data, 3).elements, resolveStepFigure(data, 2).elements); assert.match(back.description, /Añadido: Punto/);
  assert.deepEqual(figureChanges(resolveStepFigure(data, 0).elements, resolveStepFigure(data, 0).elements).ids, []);
});
test('invalid step is atomic and retains the last valid figure even when seeking beyond it', () => {
  const data = sequence();
  data.steps[1].patches.push({ op: 'remove', id: 'absent' });
  const before = resolveStepFigure(data, 1);
  for (const step of [2, 3]) {
    const failed = resolveStepFigure(data, step); assert.deepEqual(failed.elements, before.elements); assert.equal(failed.validStep, 1);
    assert.match(failed.error!, /paso 3.*última figura válida, del paso 2/); assert.equal(failed.caption, data.steps[1].caption);
  }
  assert.equal(stepFigureDataSchema.safeParse(data).success, false);
  assert.equal(resolveStepFigure(data, 0).error, undefined);
  (data.steps[1].patches[0] as any).changes = { onclick: 'bad' };
  assert.deepEqual(resolveStepFigure(data, 2).elements, before.elements);
});
test('runtime recovery clamps corrupt/old values and keeps only bounded step/range state', () => {
  const data = sequence();
  assert.deepEqual(stepFigureState(data, { step: NaN, visited: ['x'] }), { step: 0, visited: [0, 0] });
  assert.deepEqual(stepFigureState(data, { step: 99, visited: [-10, 90], figures: ['do not restore'] }), { step: 3, visited: [0, 3] });
  assert.deepEqual(stepFigureState(data, { step: 1.4, visited: [3, 1] }), { step: 1, visited: [1, 1] });
});
test('real component steps/backtracks, fades only changed outlines and visibly resets', async () => {
  const h = harness(sequence()); let node = h.render();
  assert.match(text(node), /¿Qué cambia.*Paso 1 de 4/); assert.equal(button(node, 'Anterior').props.disabled, true);
  const initial = h.draw(node); assert.equal(find(node, CanvasSurface)!.props.maxPixelSize, 1024);
  assert.equal(find(node, CanvasSurface)!.props.animated, false); assert.equal(h.events.length, 0); assert.equal(h.writes.length, 0);
  button(node, 'Siguiente').props.onPress(); node = h.render(); const next = h.draw(node, 20);
  assert.match(text(node), /Paso 2 de 4.*Aparece el punto.*Añadido: Punto/);
  assert.deepEqual(next.strokes[0], initial.strokes[0]); assert.deepEqual(next.transforms, initial.transforms);
  assert.equal(next.strokes.length, 3); assert.deepEqual(h.events[0][1], { step: 1, visited: [0, 1], validStep: 1 });
  const faded = h.draw(node, 1200); assert.equal(faded.strokes.length, 2); assert.equal(find(h.render(), CanvasSurface)!.props.animated, false);
  button(h.render(), 'Siguiente').props.onPress(); button(h.render(), 'Anterior').props.onPress(); node = h.render();
  assert.equal(h.props.runtime.state.step, 1); assert.deepEqual(h.props.runtime.state.visited, [0, 2]);
  assert.deepEqual(h.draw(node).strokes[0], initial.strokes[0]);
  button(node, 'Reiniciar').props.onPress(); node = h.render();
  assert.match(text(node), /Paso 1 de 4/); assert.equal(h.writes.at(-1), null); assert.equal(h.events.at(-1)![0], 'step-figure.reset');
  assert.deepEqual(h.events.at(-1)![1], { step: 0, visited: [0, 0], validStep: 0 });
  assert.deepEqual(h.draw(node, 5000).strokes[0], initial.strokes[0]); h.unmount();
  await Promise.resolve();
});
test('real seek responds on every input while writing/settling only at release, including repeated pre-render inputs', () => {
  const h = harness(sequence()), node = h.render(), range = find(node, WebRange)!;
  const initial = h.draw(node);
  range.props.onChange(1); const first = h.draw(node); assert.equal(first.strokes.length, 3);
  range.props.onChange(2); const second = h.draw(node); assert.notDeepEqual(second.strokes[1].path, first.strokes[1].path);
  range.props.onChange(3); assert.equal(h.draw(node).strokes.length, 2); // Recta plus departing outline.
  assert.deepEqual(h.draw(node).strokes[0], initial.strokes[0]); assert.equal(h.writes.length, 0); assert.equal(h.events.length, 0);
  range.props.onSettle(2); assert.equal(h.writes.length, 1); assert.equal(h.events.length, 1);
  assert.deepEqual(h.writes[0], { step: 2, visited: [0, 3] }); assert.equal(h.events[0][0], 'step-figure.seek');
  assert.match(text(h.render()), /Paso 3 de 4/);
  for (const value of [...h.writes, ...h.events.map(e => e[1])]) assert.ok(Buffer.byteLength(JSON.stringify(value), 'utf8') < 4096);
  h.unmount();
});
test('real optional playback never autostarts or emits tick events and settles pause/end/hidden/unmount', t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const h = harness(sequence()); let node = h.render();
  t.mock.timers.tick(5000); assert.match(text(h.render()), /Paso 1 de 4/); assert.equal(h.events.length, 0);
  button(node, 'Reproducir').props.onPress(); t.mock.timers.tick(500); node = h.render();
  assert.match(text(node), /Paso 2 de 4/); assert.ok(button(node, 'Pausar')); assert.equal(h.events.length, 0); assert.equal(h.writes.length, 0);
  button(node, 'Pausar').props.onPress(); assert.equal(h.events[0][0], 'step-figure.pause'); t.mock.timers.tick(5000); assert.match(text(h.render()), /Paso 2 de 4/);
  button(h.render(), 'Reproducir').props.onPress(); t.mock.timers.tick(1000); assert.match(text(h.render()), /Paso 4 de 4/);
  assert.equal(h.events.length, 2); assert.equal(h.events[1][0], 'step-figure.end'); assert.deepEqual(h.events[1][1].visited, [0, 3]);
  button(h.render(), 'Reiniciar').props.onPress(); button(h.render(), 'Reproducir').props.onPress(); t.mock.timers.tick(500);
  find(h.render(), CanvasSurface)!.props.onVisibilityChange(false); const pausedStep = h.props.runtime.state.step;
  assert.equal(h.events.at(-1)![0], 'step-figure.pause'); const count = h.events.length;
  t.mock.timers.tick(10000); find(h.render(), CanvasSurface)!.props.onVisibilityChange(true); t.mock.timers.tick(10000);
  assert.equal(h.props.runtime.state.step, pausedStep); assert.equal(h.events.length, count);
  button(h.render(), 'Reproducir').props.onPress(); t.mock.timers.tick(500); h.unmount();
  assert.equal(h.events.at(-1)![0], 'step-figure.pause'); assert.equal(h.events.at(-1)![1].step, 2); const finalCount = h.events.length;
  t.mock.timers.tick(10000); assert.equal(h.events.length, finalCount);
  const manual = harness(base()); assert.equal(button(manual.render(), 'Reproducir'), undefined); manual.unmount();
});
test('invalid step is visible in real component and playback stops at it with no partial geometry', t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const data = sequence(); data.steps[1].patches.push({ op: 'remove', id: 'missing' });
  const h = harness(data); let node = h.render(); button(node, 'Reproducir').props.onPress(); t.mock.timers.tick(500); node = h.render();
  const valid = h.draw(node, 2000); t.mock.timers.tick(500); node = h.render();
  assert.match(text(node), /No se pudo aplicar el paso 3.*última figura válida/); assert.deepEqual(h.draw(node, 4000).strokes, valid.strokes.slice(0, 2));
  assert.equal(button(node, 'Reproducir').props.disabled, true); assert.equal(h.events.length, 1); assert.equal(h.events[0][1].validStep, 1);
  t.mock.timers.tick(5000); assert.equal(h.events.length, 1); button(h.render(), 'Anterior').props.onPress(); assert.doesNotMatch(text(h.render()), /No se pudo aplicar/); h.unmount();
});
test('all allowed shapes draw as canvas commands and author text stays plain text', () => {
  const elements = [
    { id: 'r', label: 'Rectángulo', kind: 'rect', x: 1, y: 2, width: 20, height: 30, fill: 'muted' },
    { id: 'c', label: 'Círculo', kind: 'circle', x: 50, y: 50, radius: 5 },
    { id: 'l', label: 'Línea', kind: 'line', x: 0, y: 0, x2: 20, y2: 20 },
    { id: 'p', label: 'Polilínea', kind: 'polyline', points: [[0, 0], [20, 10]] },
    { id: 'g', label: 'Polígono', kind: 'polygon', points: [[0, 0], [20, 10], [10, 20]], fill: 'accent' },
    { id: 't', label: 'Texto', kind: 'text', x: 0, y: 0, text: '<script>plain text</script>' },
  ].map(e => stepFigureElementSchema.parse(e));
  const h = harness(base({ initial: { caption: 'Formas', elements }, steps: [{ caption: 'Cambio', change: 'Texto nuevo', patches: [{ op: 'update', id: 't', changes: { text: 'Nuevo' } }] }] }));
  const drawn = h.draw(h.render()); assert.equal(drawn.strokes.length, 5); assert.deepEqual(drawn.texts, ['<script>plain text</script>']);
  button(h.render(), 'Siguiente').props.onPress(); assert.deepEqual(h.draw(h.render()).texts, ['Nuevo']); h.unmount();
});
test('readOnly guards every callback, native is honest and readOnly transition stops playback', t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const h = harness(sequence(), { readOnly: true, state: { step: 1, visited: [0, 1] } }); let node = h.render();
  for (const control of all(node).filter(n => n.type === Button)) { assert.equal(control.props.disabled, true); control.props.onPress(); }
  find(node, WebRange)!.props.onChange(3); find(node, WebRange)!.props.onSettle(3); t.mock.timers.tick(5000);
  assert.equal(h.events.length, 0); assert.equal(h.writes.length, 0); assert.match(text(h.render()), /Paso 2 de 4/); h.unmount();
  const native = harness(sequence(), { platform: 'ios' }); node = native.render();
  assert.match(text(node), /Estático.*Paso 1 de 4/); assert.ok(find(node, NativeLearningFallback)); assert.equal(find(node, CanvasSurface), undefined); assert.equal(find(node, WebRange), undefined);
  for (const control of all(node).filter(n => n.type === Button)) { assert.equal(control.props.disabled, true); control.props.onPress(); }
  assert.equal(native.events.length, 0); assert.equal(native.writes.length, 0); native.unmount(); Platform.OS = 'web';
  const changing = harness(sequence()); button(changing.render(), 'Reproducir').props.onPress(); t.mock.timers.tick(500);
  changing.props.readOnly = true; changing.render(); t.mock.timers.tick(5000); assert.match(text(changing.render()), /Paso 2 de 4/); assert.equal(changing.events.length, 0); assert.equal(changing.writes.length, 0); changing.unmount();
});
test('real component receives external runtime, stops on document change, and reports transport failures safely', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const h = harness(sequence()); h.render(); h.props.runtime.state = { step: 2, visited: [0, 2] }; assert.match(text(h.render()), /Paso 3 de 4/);
  button(h.render(), 'Reproducir').props.onPress(); h.props.document = { id: 'new-doc' } as RendererProps['document']; h.props.runtime.state = {};
  h.render(); t.mock.timers.tick(5000); assert.match(text(h.render()), /Paso 1 de 4/); assert.equal(h.events.length, 0);
  h.props.runtime.settle = async () => { throw new Error('/private/server/path'); }; button(h.render(), 'Siguiente').props.onPress();
  await Promise.resolve(); await Promise.resolve(); assert.match(text(h.render()), /No se pudo guardar el paso/); assert.ok(!text(h.render()).includes('/private'));
  find(h.render(), CanvasSurface)!.props.onError('private'); assert.match(text(h.render()), /No se pudo dibujar la figura/); h.unmount();
});
