import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { compileExpression } from '../plugin/shared/expr';
import { documentSchema } from '../plugin/shared/model';
import { resolveScope } from '../plugin/shared/learning';
import { LearningRuntimeStore } from '../plugin/client/learning-state';
import {
  functionPlotSpec, functionPlotDataSchema, compilePlotExpressions, buildPlotCurves, familyValues,
  samplePlotCurve, traceReadout, plotTraceState, type FunctionPlotData,
} from '../plugin/shared/renderers/function-plot';
import { Platform, Button } from './fixtures/native-headless';
import type { Canvas2DContext } from '../plugin/client/Surfaces';
import type { RendererProps } from '../plugin/client/renderers/types';

// A synchronous hook host retained across render calls. UI/native modules are host stubs;
// the component, drawing, expressions and optimistic learning store are real code.
type Element = { type: unknown; props: Record<string, any> };
type HookSlots = unknown[];
let slots: HookSlots = [], cursor = 0;
export function createElement(type: unknown, props: Record<string, unknown> | null, ...children: unknown[]): Element { return { type, props: { ...props, ...(children.length ? { children: children.length === 1 ? children[0] : children } : {}) } }; }
export function useRef<T>(current: T): { current: T } { const index = cursor++; return (slots[index] ??= { current }) as { current: T }; }
export function useState<T>(initial: T): [T, (value: T) => void] { const owned = slots, index = cursor++; if (!(index in owned)) owned[index] = initial; return [owned[index] as T, value => { owned[index] = value; }]; }
export function useMemo<T>(get: () => T) { return get(); }
export function useEffect() {}
export function useSyncExternalStore(_subscribe: unknown, get: () => unknown) { return get(); }
export const Fragment = 'fragment';
export const jsx = (type: unknown, props: Record<string, unknown>) => ({ type, props });
export const jsxs = jsx;
export function createContext<T>(value:T){return{value,Provider:'context-provider'};}
export function useContext<T>(context:{value:T}){return context.value;}
export default { createElement };
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === 'react' || specifier === 'react/jsx-runtime') return { url: new URL('./function-plot.test.ts', `file://${__filename}`).href, shortCircuit: true };
  if (specifier === 'react-native' || (specifier.endsWith('/ui') && context.parentURL?.includes('/plugin/client/'))) return { url: new URL('./fixtures/native-headless.ts', `file://${__filename}`).href, shortCircuit: true };
  return nextResolve(specifier, context);
} });
const { functionPlotRenderer, plotBounds, pointerPlotX, plotReadoutText } = require('../plugin/client/renderers/function-plot') as typeof import('../plugin/client/renderers/function-plot');
const { CanvasSurface, NativeLearningFallback } = require('../plugin/client/Surfaces') as typeof import('../plugin/client/Surfaces');
const { controlsRenderer } = require('../plugin/client/renderers/controls') as typeof import('../plugin/client/renderers/controls');
const { WebRange } = require('../plugin/client/web') as typeof import('../plugin/client/web');
const base = (patch: Record<string, unknown> = {}) => functionPlotDataSchema.parse({ ...functionPlotSpec.blockType.defaults, ...patch });
const all = (node: Element): Element[] => [node, ...(Array.isArray(node.props.children) ? node.props.children.flat(Infinity) : [node.props.children]).filter((n: unknown): n is Element => !!n && typeof n === 'object').flatMap(all)];
const find = (node: Element, type: unknown) => all(node).find(n => n.type === type)!;
const button = (node: Element, label: string) => all(node).find(n => n.type === Button && n.props.label === label)!;
const text = (node: Element) => all(node).filter(n => n.type === 'Txt').map(n => Array.isArray(n.props.children) ? n.props.children.flat(Infinity).join('') : String(n.props.children)).join(' ');
function context() {
  const paths: number[][][] = [], texts: string[] = []; let path: number[][] = [];
  const ctx = { fillStyle: '', strokeStyle: '', lineWidth: 1, globalAlpha: 1, font: '', textAlign: '', textBaseline: '', lineCap: '', lineJoin: '',
    clearRect() {}, fillRect() {}, strokeRect() {}, beginPath() { path = []; }, closePath() {}, moveTo(x: number, y: number) { path.push([x, y]); }, lineTo(x: number, y: number) { path.push([x, y]); }, arc() {}, quadraticCurveTo() {}, bezierCurveTo() {}, fill() {}, stroke() { paths.push(path); }, clip() {}, save() {}, restore() {}, setTransform() {}, translate() {}, rotate() {}, scale() {}, setLineDash() {}, fillText(value: string) { texts.push(value); }, measureText(value: string) { return { width: value.length * 7 }; }, drawImage() {},
  } satisfies Canvas2DContext;
  return { ctx, paths, texts };
}
function harness(data = base(), readOnly = false, platform = 'web') {
  Platform.OS = platform;
  const owned: HookSlots = [], writes: unknown[] = [], events: any[][] = [], scopeWrites: unknown[] = [];
  const props = { data, document: {}, block: { id: 'plot' }, compact: false, availableWidth: 400, readOnly,
    ui: { layout: { platform }, c: { surface0: '#fff', foreground: '#111', foregroundMuted: '#555', border: '#ccc', accent: '#246', statusDanger: '#933' } },
    scope: { variables: {}, values: {}, get: () => NaN, set: (...args: unknown[]) => scopeWrites.push(args) },
    runtime: { state: {}, set(state: Record<string, unknown> | null) { writes.push(state); (props.runtime as any).state = state ?? {}; }, flush: async () => {}, settle: async (...args: unknown[]) => { events.push(args); } }, send: async () => {},
  } as unknown as RendererProps<FunctionPlotData>;
  return { props, writes, events, scopeWrites,
    render() { slots = owned; cursor = 0; return (functionPlotRenderer.Component as Function)(props) as Element; },
    draw(node: Element) { const surface = find(node, CanvasSurface); assert.ok(surface); const probe = context(); surface.props.draw(probe.ctx, { width: 400, height: 250, pixelRatio: 1, time: 0 }); return probe; },
  };
}

test('schema accepts portable defaults and rejects executable data, unbounded ranges and excessive work', () => {
  assert.equal(functionPlotSpec.id, functionPlotRenderer.id); assert.ok(base());
  const raw = functionPlotSpec.blockType.defaults;
  for (const patch of [
    { question: '' }, { expressions: [] }, { expressions: [{ expression: 'Math.sin(x)', label: 'Mal' }] },
    { expressions: [{ expression: 'sin(', label: 'Mal' }], family: { parameter: 'a', min: 0, max: 1, count: 2 } },
    { expressions: [{ expression: 'x = 2', label: 'Mal' }] }, { expressions: [{ expression: 'x', label: 'Bien', html: '<script/>' }] },
    { expressions: [{ expression: 'x'.repeat(513), label: 'Mal' }] }, { xRange: [0, 0] }, { xRange: [0, Infinity] },
    { yRange: [-1e7, 1] }, { samples: 193 }, { samples: 3.5 }, { initialTrace: 50 }, { javascript: 'alert(1)' },
    { family: { parameter: 'x', min: 0, max: 1, count: 2 } }, { family: { parameter: 'a', min: 0, max: 1, count: 5 } },
    { expressions: Array.from({ length: 4 }, () => ({ expression: 'a*x', label: 'a' })), family: { parameter: 'a', min: 0, max: 1, count: 2 } },
  ]) assert.equal(functionPlotDataSchema.safeParse({ ...raw, ...patch }).success, false, JSON.stringify(patch));
  assert.deepEqual(new Set(functionPlotSpec.blockType.properties.map(p => p.key)), new Set(Object.keys(functionPlotDataSchema.shape)));
});
test('compiled expressions resolve scope and give safe syntax, undeclared and domain readouts', () => {
  const compiled = compilePlotExpressions(base({ expressions: [{ label: 'Onda', expression: 'a*sin(x)+b' }] }));
  assert.equal(traceReadout(compiled, { a: 2, b: 3 }, Math.PI / 2)[0].y, 5);
  assert.match(traceReadout(compiled, { a: 2 }, 1)[0].error!, /Falta declarar la variable b/);
  assert.equal(traceReadout(compiled, { a: 2 }, 1)[0].y, null);
  const syntax = compilePlotExpressions({ expressions: [{ label: 'Mal', expression: 'sin(' }] });
  assert.match(syntax[0].error!, /Sintaxis inválida en la posición/);
  const root = compilePlotExpressions(base({ expressions: [{ label: 'Raíz', expression: 'sqrt(x)' }] }));
  assert.equal(traceReadout(root, {}, -1)[0].y, null);
  assert.equal(traceReadout(root, {}, 4)[0].y, 2);
});
test('sampling separates poles, jumps and domain holes, including poles between sample locations', () => {
  for (const expression of ['1/(x-0.017)', 'tan(x)', 'x < 0 ? -1 : 1', 'x < 0 ? -1e308 : 1e308']) {
    const data = base({ xRange: [-2, 2], yRange: [-5, 5], samples: 32 });
    const result = samplePlotCurve(compileExpression(expression), data, {});
    assert.ok(result.domainGap, expression); assert.ok(result.segments.length > 1, expression);
    const breaks = expression.startsWith('tan') ? [-Math.PI / 2, Math.PI / 2] : [expression.startsWith('1/') ? .017 : 0];
    for (const at of breaks) assert.ok(!result.segments.some(points => points.length > 1 && points[0].x < at && points.at(-1)!.x > at), `${expression} connected across ${at}`);
  }
  const data = base({ xRange: [-2, 2], yRange: [-2, 2], samples: 32 });
  const root = samplePlotCurve(compileExpression('sqrt(x)'), data, {});
  assert.ok(root.domainGap); assert.ok(root.segments.flat().every(p => p.x >= 0));
  const line = samplePlotCurve(compileExpression('x'), data, {});
  assert.equal(line.segments.length, 1); assert.equal(line.domainGap, false);
  const hole = samplePlotCurve(compileExpression('abs(x) < .03 ? sqrt(-1) : x'), data, {});
  assert.ok(hole.domainGap); assert.equal(hole.segments.length, 2);
});
test('family has a bounded range, preserves the active scope and obeys sampling budget', () => {
  const data = base({ expressions: [{ expression: 'a*x', label: 'Recta' }], xRange: [0, 2], yRange: [-5, 5], family: { parameter: 'a', min: -2, max: 2, count: 3 } });
  const values = Object.freeze({ a: 1.5 }), compiled = compilePlotExpressions(data), curves = buildPlotCurves(data, compiled, values);
  assert.deepEqual(familyValues(data.family!), [-2, 0, 2]); assert.equal(curves.length, 4);
  assert.equal(curves.at(-1)!.active, true); assert.equal(curves.at(-1)!.segments[0].at(-1)!.y, 3);
  assert.deepEqual(curves.slice(0, 3).map(c => c.segments[0].at(-1)!.y), [-4, 0, 4]); assert.equal(values.a, 1.5);
  let evaluations = 0;
  samplePlotCurve({ identifiers: ['x'], evaluate: ({ x } = {}) => { evaluations++; return x; } }, { ...data, samples: 192 }, {});
  assert.ok(evaluations <= 384); // Endpoints plus bounded midpoint probes, regardless of domain.
  assert.match(buildPlotCurves(data, compiled, {})[0].error!, /Falta declarar/);
});
test('readout, pointer mapping and runtime recovery handle boundaries, invalid state and units', () => {
  const data = base({ expressions: [{ expression: 'x^2', label: 'Cuadrado' }], xRange: [-2, 2], yRange: [0, 4], xUnit: 's', yUnit: 'm' });
  assert.match(plotReadoutText(data, compilePlotExpressions(data), {}, 2), /x = 2 s; Cuadrado: y = 4 m/);
  const bounds = plotBounds(400, 250, 1); assert.equal(pointerPlotX(data, bounds, bounds.left), -2); assert.equal(pointerPlotX(data, bounds, bounds.left + bounds.width / 2), 0); assert.equal(pointerPlotX(data, bounds, 1e9), 2);
  assert.deepEqual(plotTraceState(data, { traceX: NaN, visited: ['bad'] }), { traceX: 0, visited: [0, 0] });
  assert.deepEqual(plotTraceState(data, { traceX: 100, visited: [-100, 100] }), { traceX: 2, visited: [-2, 2] });
});
test('actual renderer keeps hover local, settles release with explored interval, supports button trace and reset', async () => {
  const h = harness(base({ expressions: [{ expression: 'x^2', label: 'Cuadrado' }], xRange: [-2, 2], yRange: [0, 4], initialTrace: 1 }));
  let node = h.render(); assert.match(text(node), /¿Cómo cambia/); const stage = find(node, CanvasSurface);
  const probe = h.draw(node); assert.ok(probe.paths.length > 6); assert.equal(stage.props.animated, true);
  const bounds = plotBounds(400, 250, 1), pointer = (kind: string, x: number, pointerId = 1) => stage.props.onPointer({ kind, x: bounds.left + (x + 2) / 4 * bounds.width, y: 120, pointerId, buttons: kind === 'move' ? 0 : 1, pressure: .5 });
  pointer('move', -.5); const hover = h.draw(node); assert.ok(hover.texts.includes('x = -0.5')); assert.equal(h.events.length, 0); assert.equal(h.writes.length, 0);
  pointer('up', -.5); assert.equal(h.events.length, 0);
  pointer('down', -1); pointer('move', 1.5); pointer('move', -1.5, 2); assert.equal(h.writes.length, 0); assert.equal(h.events.length, 0);
  pointer('up', .5); await Promise.resolve();
  assert.deepEqual(h.writes[0], { traceX: .5, visited: [-1, 1.5] });
  assert.deepEqual(h.events[0][1], { x: .5, visited: [-1, 1.5], readings: [{ label: 'Cuadrado', y: .25 }] });
  node = h.render(); assert.match(text(node), /Traza fijada: x = 0.5/);
  button(node, 'Traza siguiente').props.onPress(); await Promise.resolve(); assert.equal(h.events.length, 2);
  assert.ok((h.props.runtime.state.traceX as number) > .5);
  node = h.render(); button(node, 'Reiniciar').props.onPress(); await Promise.resolve(); node = h.render();
  assert.equal(h.writes.at(-1), null); assert.equal(h.events.at(-1)![0], 'function-plot.reset'); assert.deepEqual(h.events.at(-1)![1].visited, [1, 1]); assert.match(text(node), /Traza fijada: x = 1/);
  assert.equal(h.scopeWrites.length, 0);
  for (const event of h.events) assert.ok(Buffer.byteLength(JSON.stringify(event[1]), 'utf8') < 4096);
  for (const write of h.writes) assert.ok(Buffer.byteLength(JSON.stringify(write), 'utf8') < 4096);
  const before = h.events.length; button(node, 'Pedir una pista').props.onPress(); await Promise.resolve();
  assert.equal(h.events.length, before + 1); assert.match(h.events.at(-1)![1].request, /sin revelar la solución/);
});
test('cancelled pointer gestures never settle and readOnly/native are honest', () => {
  const h = harness(); let node = h.render(); h.draw(node); const stage = find(node, CanvasSurface);
  stage.props.onPointer({ kind: 'down', x: 80, pointerId: 1 }); stage.props.onPointer({ kind: 'cancel', pointerId: 1 }); stage.props.onPointer({ kind: 'up', x: 300, pointerId: 1 }); assert.equal(h.events.length, 0);
  const frozen = harness(base(), true); node = frozen.render(); assert.equal(find(node, CanvasSurface).props.onPointer, undefined);
  for (const control of all(node).filter(n => n.type === Button)) { assert.equal(control.props.disabled, true); control.props.onPress(); } assert.equal(frozen.writes.length, 0); assert.equal(frozen.events.length, 0);
  const native = harness(base(), false, 'ios'); node = native.render(); assert.ok(find(node, NativeLearningFallback)); assert.equal(find(node, CanvasSurface), undefined); assert.match(text(node), /Estático/); assert.ok(button(node, 'Reiniciar').props.disabled);
  assert.match(find(node, NativeLearningFallback).props.summary, /Seno: y = 0/); Platform.OS = 'web';
});
test('real sibling controls change the plot at each optimistic frame before transport acknowledgement', async () => {
  for (const scopeId of ['$document', 'g']) {
    const variable = { name: 'a', value: 1, min: -4, max: 4, step: .1 };
    const doc = documentSchema.parse({ id: 'd', workspaceId: 'w', revision: 0, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', title: 'Ejemplo', communication: { instructions: '' }, blocks: [{ id: 'plot', typeId: 'note', title: 'Gráfica', data: {}, parentGroupId: scopeId === 'g' ? 'g' : undefined }, { id: 'ctrl', typeId: 'controls', title: 'Control', data: { variables: ['a'] }, parentGroupId: scopeId === 'g' ? 'g' : undefined }], groups: scopeId === 'g' ? [{ id: 'g', title: 'Grupo', blockIds: ['plot', 'ctrl'], variables: [variable] }] : [], variables: [{ ...variable, value: scopeId === 'g' ? .2 : 1 }] });
    let requests = 0;
    const store = new LearningRuntimeStore(async () => { requests++; return await new Promise(() => {}); }, () => {});
    store.sync(doc, 0, { blocks: {}, scopes: {} });
    const h = harness(base({ expressions: [{ expression: 'a*x', label: 'Recta' }], xRange: [-2, 2], yRange: [-8, 8], initialTrace: 1 }));
    const scopeFor = (blockId: string): RendererProps['scope'] => {
      const variables = resolveScope(doc, blockId, store.getSnapshot()), values = Object.fromEntries(Object.entries(variables).map(([name, v]) => [name, v.current]));
      return { variables, values, get: name => values[name] ?? NaN, set: (name, value) => store.setVariable(blockId, name, value) };
    };
    const refresh = () => { h.props.scope = scopeFor('plot'); };
    refresh(); let node = h.render(); const originalDraw = find(node, CanvasSurface).props.draw; const before = h.draw(node);
    assert.equal(h.props.scope.variables.a.scopeId, scopeId); assert.ok(before.texts.includes('1. Recta: y = 1'));
    const ctrlSlots: HookSlots = []; slots = ctrlSlots; cursor = 0;
    const controls = (controlsRenderer.Component as Function)({ ...h.props, scope: scopeFor('ctrl'), data: { question: '¿Cómo cambia la pendiente?', variables: ['a'] }, block: { id: 'ctrl' } }) as Element;
    const range = find(controls, WebRange); assert.ok(range);
    try {
      for (const value of [2, -3, .5]) {
        range.props.onChange(value); refresh(); node = h.render();
        const probe = context(); originalDraw(probe.ctx, { width: 400, height: 250, pixelRatio: 1, time: value });
        assert.ok(probe.texts.includes(`1. Recta: y = ${value}`)); assert.notDeepEqual(probe.paths, before.paths);
        assert.equal(requests, 0); assert.equal(h.events.length, 0);
      }
      // Start a transport request and leave it unacknowledged, then change again.
      void store.flush(); assert.equal(requests, 1); range.props.onChange(3); refresh(); h.render();
      const probe = context(); originalDraw(probe.ctx, { width: 400, height: 250, pixelRatio: 1, time: 50 }); assert.ok(probe.texts.includes('1. Recta: y = 3'));
      assert.equal(h.events.length, 0);
      button(h.render(), 'Reiniciar').props.onPress(); assert.equal(store.getSnapshot().scopes[scopeId].a, 3);
    } finally { store.reset(); }
  }
});
test('actual renderer displays safe errors, retains valid siblings and reports failed settled writes', async () => {
  const missing = harness(base({ expressions: [{ expression: 'a*x', label: 'Falta' }, { expression: 'x', label: 'Disponible' }] })); let node = missing.render();
  assert.match(text(node), /Falta declarar la variable a/); assert.ok(missing.draw(node).texts.includes('2. Disponible: y = 0'));
  const domain = harness(base({ expressions: [{ expression: 'sqrt(x)', label: 'Raíz' }], initialTrace: -1 })); assert.match(text(domain.render()), /fuera del dominio/);
  const syntax = harness({ ...base(), expressions: [{ expression: 'sin(', label: 'Inválida' }] }); assert.match(text(syntax.render()), /Sintaxis inválida/);
  const failed = harness(); failed.props.runtime.settle = async () => { throw new Error('private /secret/server/path'); }; node = failed.render(); button(node, 'Traza siguiente').props.onPress(); await Promise.resolve(); await Promise.resolve(); node = failed.render(); assert.match(text(node), /No se pudo guardar la traza/); assert.ok(!text(node).includes('/secret'));
});
