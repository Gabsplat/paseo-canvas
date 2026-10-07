import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import {
  animatedFlowDataSchema, animatedFlowSpec, flowActivityAt, flowRuntimeState, flowTimeAt, motionAt,
  remapAnimatedFlowReferences, seekFlow, simulateAnimatedFlow, MISSING_FLOW_ROUTE,
  type AnimatedFlowData, type AnimatedFlowDocument,
} from '../plugin/shared/renderers/animated-flow';
import { runtimeBlockStateSchema } from '../plugin/shared/learning';
import { Platform, Button } from './fixtures/native-headless';
import { setup, workspaceId, mutation } from './helpers';
import type { Canvas2DContext } from '../plugin/client/Surfaces';
import type { RendererProps } from '../plugin/client/renderers/types';

// Retained hooks with dependency-aware effects; UI host stubs only. The actual
// renderer, WebRange, 2D surface, drawing, simulation and epoch clock are used.
type Element = { type: unknown; props: Record<string, any> };
type EffectSlot = { deps?: readonly unknown[]; cleanup?: () => void };
type HookHost = { slots: any[]; effects: (() => void)[] };
let host: HookHost = { slots: [], effects: [] }, cursor = 0;
const same = (a?: readonly unknown[], b?: readonly unknown[]) => !!a && !!b && a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
export function createElement(type: unknown, props: Record<string, unknown> | null, ...children: unknown[]): Element { return { type, props: { ...props, ...(children.length ? { children: children.length === 1 ? children[0] : children } : {}) } }; }
export function useRef<T>(current: T): { current: T } { return host.slots[cursor++] ??= { current }; }
export function useState<T>(initial: T): [T, (value: T) => void] { const owned = host, index = cursor++; if (!(index in owned.slots)) owned.slots[index] = initial; return [owned.slots[index], value => { owned.slots[index] = value; }]; }
export function useMemo<T>(get: () => T, deps?: readonly unknown[]): T { const index = cursor++; const previous = host.slots[index]; if (!previous || !same(previous.deps, deps)) host.slots[index] = { deps, value: get() }; return host.slots[index].value; }
export function useEffect(effect: () => void | (() => void), deps?: readonly unknown[]) {
  const owned = host, index = cursor++, previous = owned.slots[index] as EffectSlot | undefined;
  if (previous && same(previous.deps, deps)) return;
  const next: EffectSlot = { deps }; owned.slots[index] = next;
  owned.effects.push(() => { previous?.cleanup?.(); const cleanup = effect(); if (typeof cleanup === 'function') next.cleanup = cleanup; });
}
export const reducedMotion = { current: false };
export const Fragment = 'fragment';
export const jsx = (type: unknown, props: Record<string, unknown>) => ({ type, props });
export const jsxs = jsx;
export function createContext<T>(value:T){return{value,Provider:'context-provider'};}
export function useContext<T>(context:{value:T}){return context.value;}
export default { createElement };
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === 'react' || specifier === 'react/jsx-runtime' || (specifier.endsWith('/motion') && context.parentURL?.includes('/plugin/client/'))) return { url: new URL('./animated-flow.test.ts', `file://${__filename}`).href, shortCircuit: true };
  if (specifier === 'react-native' || (specifier.endsWith('/ui') && context.parentURL?.includes('/plugin/client/'))) return { url: new URL('./fixtures/native-headless.ts', `file://${__filename}`).href, shortCircuit: true };
  return nextResolve(specifier, context);
} });
const { animatedFlowRenderer } = require('../plugin/client/renderers/animated-flow') as typeof import('../plugin/client/renderers/animated-flow');
const { CanvasSurface, NativeLearningFallback } = require('../plugin/client/Surfaces') as typeof import('../plugin/client/Surfaces');
const { WebRange, WebCanvasSurface } = require('../plugin/client/web') as typeof import('../plugin/client/web');
const base = (patch: Record<string, unknown> = {}) => animatedFlowDataSchema.parse({ ...animatedFlowSpec.blockType.defaults, ...patch });
const event = (patch: Record<string, unknown> = {}) => ({ t: 0, from: 'a', to: 'b', payload: 2, kind: 'signal', ...patch });
const graph = (): AnimatedFlowDocument => ({ blocks: [{ id: 'a', title: 'Origen' }, { id: 'b', title: 'Destino' }], groups: [{ id: 'g', title: 'Grupo' }], links: [{ id: 'ab', from: 'a', to: 'b' }, { id: 'bg', from: 'b', to: 'g' }, { id: 'ga', from: 'g', to: 'a' }] });
const all = (node: Element): Element[] => [node, ...(Array.isArray(node.props.children) ? node.props.children.flat(Infinity) : [node.props.children]).filter((n: unknown): n is Element => !!n && typeof n === 'object').flatMap(all)];
const find = (node: Element, type: unknown) => all(node).find(n => n.type === type)!;
const button = (node: Element, label: string) => all(node).find(n => n.type === Button && n.props.label === label)!;
const text = (node: Element) => all(node).filter(n => n.type === 'Txt').map(n => Array.isArray(n.props.children) ? n.props.children.flat(Infinity).join('') : String(n.props.children)).join(' ');
const commit = (owned: HookHost) => { const pending = owned.effects.splice(0); pending.forEach(fn => fn()); };
const cleanup = (owned: HookHost) => owned.slots.forEach(slot => { if (typeof slot?.cleanup === 'function') { slot.cleanup(); slot.cleanup = undefined; } });
function context() {
  const texts: string[] = [], points: number[][] = [];
  return { texts, points, ctx: { fillStyle: '', strokeStyle: '', lineWidth: 1, globalAlpha: 1, font: '', textAlign: '', textBaseline: '', lineCap: '', lineJoin: '', lineDashOffset: 0, shadowColor: '', shadowBlur: 0, shadowOffsetX: 0, shadowOffsetY: 0,
    createLinearGradient() { return { addColorStop() {} }; }, createRadialGradient() { return { addColorStop() {} }; }, strokeText() {},
    clearRect() {}, fillRect() {}, strokeRect() {}, beginPath() {}, closePath() {}, moveTo() {}, lineTo() {}, arc(x: number, y: number) { points.push([x, y]); }, quadraticCurveTo() {}, bezierCurveTo() {}, fill() {}, stroke() {}, clip() {}, save() {}, restore() {}, setTransform() {}, translate() {}, rotate() {}, scale() {}, setLineDash() {}, fillText(value: string) { texts.push(value); }, measureText(value: string) { return { width: value.length * 7 }; }, drawImage() {},
  } satisfies Canvas2DContext };
}
function harness(data = base({ events: [event()] }), readOnly = false, platform = 'web', initial: Record<string, unknown> = {}) {
  Platform.OS = platform; reducedMotion.current = false;
  const owned: HookHost = { slots: [], effects: [] }, writes: any[] = [], events: any[][] = [], received: any[][] = [], seen = new Map<string, string>();
  let flushes = 0, rejectDelivery = false;
  const props = { data, document: { ...graph(), id: 'document' }, block: { id: 'flow' }, compact: false, availableWidth: 400, readOnly,
    ui: { layout: { platform }, c: { surface0: '#fff', foreground: '#111', foregroundMuted: '#555', border: '#ccc', accent: '#246', statusDanger: '#933' } },
    runtime: { state: initial, set(state: Record<string, unknown> | null, settled = false) { writes.push([state, settled]); (props.runtime as any).state = state ?? {}; },
      flush: async () => { flushes++; }, settle: async (...args: any[]) => {
        flushes++; events.push(args); const signature = JSON.stringify(args.slice(0, 3)), prior = seen.get(args[3]);
        if (prior) assert.equal(prior, signature, 'A retained event ID must keep its payload');
        else { seen.set(args[3], signature); received.push(args); }
        if (rejectDelivery) throw new Error('ambiguous response /private/path');
      } }, scope: { values: {}, variables: {}, get: () => NaN, set() { throw new Error('flow must not mutate scope'); } }, send: async () => { throw new Error('flow only sends settled runtime'); },
  } as unknown as RendererProps<AnimatedFlowData>;
  return { props, writes, events, received, reject(value: boolean) { rejectDelivery = value; }, flushes: () => flushes,
    render() { host = owned; cursor = 0; const node = (animatedFlowRenderer.Component as Function)(props) as Element; commit(owned); return node; },
    draw(node: Element, rafTime = 0) { const probe = context(); find(node, CanvasSurface).props.draw(probe.ctx, { width: 400, height: 160, pixelRatio: 1, time: rafTime }); return probe; },
    close() { cleanup(owned); },
  };
}
async function clock(run: (advance: (time: number) => void) => void | Promise<void>) {
  const original = Date.now; let now = 1_800_000_000_000;
  Date.now = () => now;
  try { await run(time => { now = 1_800_000_000_000 + time; }); } finally { Date.now = original; reducedMotion.current = false; Platform.OS = 'web'; }
}

test('portable schema/defaults enumerate every property and reject executable or unbounded declarations', () => {
  assert.equal(animatedFlowSpec.id, animatedFlowRenderer.id); assert.ok(base());
  assert.deepEqual(new Set(animatedFlowSpec.blockType.properties.map(p => p.key)), new Set(Object.keys(animatedFlowDataSchema.shape)));
  assert.deepEqual(base(), base(JSON.parse(JSON.stringify(animatedFlowSpec.blockType.defaults))));
  for (const patch of [
    { question: '' }, { events: [event({ t: NaN })] }, { duration: Infinity }, { duration: 0 }, { travelMs: 0 }, { travelMs: 10_001 },
    { events: [event({ t: 20_000 })] }, { events: Array.from({ length: 65 }, (_, t) => event({ t })) }, { events: [event(), event()] },
    { events: [event({ from: '__proto__' })] }, { events: [event({ kind: 'script' })] }, { events: [event({ payload: { javascript: 'run()' } })] },
    { events: [event({ payload: () => 1 })] }, { events: [event({ payload: Infinity })] }, { events: [event({ payload: 1_000_001 })] },
    { events: [event({ payload: 'a'.repeat(161) })] }, { events: [event({ onArrival: 'alert(1)' })] }, { html: '<script />' },
    { links: { ab: { sign: 0, delay: 1 } } }, { links: { ab: { sign: 1, delay: -1 } } }, { links: { ab: { sign: 1, delay: Infinity } } },
    { links: { ab: { sign: 1, delay: 1, gain: 10 } } }, { links: JSON.parse('{"__proto__":{"sign":1,"delay":0}}') },
    { propagation: { maxEvents: 257, horizon: 100 } }, { propagation: { maxEvents: 1, horizon: 10_001 } },
    { events: [event(), event({ t: 1 })], propagation: { maxEvents: 1, horizon: 100 } },
    { links: Object.fromEntries(Array.from({ length: 129 }, (_, i) => [`l${i}`, { sign: 1, delay: 0 }])) },
  ]) assert.equal(animatedFlowDataSchema.safeParse({ ...animatedFlowSpec.blockType.defaults, ...patch }).success, false, String(Object.keys(patch)));
});
test('resolves directed real blocks/groups, explicit parallel routes, and never substitutes a stale ID', () => {
  const doc = graph(), flow = base({ events: [event(), event({ t: 50, from: 'b', to: 'g' })] });
  assert.deepEqual(simulateAnimatedFlow(flow, doc).events.map(e => e.linkId), ['ab', 'bg']);
  const parallel = { ...doc, links: [...doc.links, { id: 'ab2', from: 'a', to: 'b' }] };
  const ambiguous = simulateAnimatedFlow(base({ events: [event()] }), parallel);
  assert.equal(ambiguous.events.length, 0); assert.equal(ambiguous.issues[0].reason, 'parallel');
  assert.equal(simulateAnimatedFlow(base({ events: [event({ linkId: 'ab2' })] }), parallel).events[0].linkId, 'ab2');
  for (const bad of [event({ linkId: 'deleted' }), event({ linkId: 'bg' }), event({ from: 'b', to: 'a' }), event({ to: 'absent' })]) {
    const result = simulateAnimatedFlow(base({ events: [bad] }), doc);
    assert.equal(result.events.length, 0); assert.equal(result.issues[0].message, MISSING_FLOW_ROUTE);
  }
  const removedNode = { ...doc, blocks: doc.blocks.filter(b => b.id !== 'b') };
  assert.deepEqual(motionAt(flow, { playhead: 500 }, removedNode, Date.now()), []);
});
test('epoch anchor is reproducible, reverse scrubs do not integrate frames, and reset clears tokens', () => {
  const flow = base({ events: [event()], travelMs: 1000 }), doc = graph(), epoch = 1_800_000_000_000;
  const state = Object.freeze({ playhead: 100, playing: true, anchorMs: epoch, visited: [100, 100] });
  assert.equal(motionAt(flow, state, doc, epoch + 400)[0].progress, .5);
  assert.deepEqual(motionAt(flow, state, doc, epoch + 400), motionAt(flow, state, doc, epoch + 400));
  assert.equal(flowTimeAt(flow, state, epoch - 5), 100); assert.equal(flowTimeAt(flow, state, epoch + 20_000), 10_000);
  assert.deepEqual(motionAt(flow, {}, doc, epoch), []); assert.deepEqual(motionAt(flow, { playhead: NaN }, doc, epoch), []);
  assert.deepEqual(motionAt(flow, { playhead: 10_000 }, doc, epoch), []);
  assert.equal(motionAt(flow, { playhead: 800 }, doc, epoch)[0].progress, .8);
  assert.equal(motionAt(flow, { playhead: 200 }, doc, epoch)[0].progress, .2);
  assert.deepEqual(seekFlow(flow, state, 50, epoch + 400), { playhead: 50, playing: false, anchorMs: 0, visited: [50, 500] });
  assert.deepEqual(flowRuntimeState(flow, { playhead: Infinity, anchorMs: -1, playing: true, visited: ['bad'] }), { playhead: 0, playing: false, anchorMs: 0, visited: [0, 0] });
});
test('numeric causal propagation applies signs and delays at arrivals, sums contributions and excludes undeclared links', () => {
  const flow = base({ events: [event()], travelMs: 100, links: { ab: { sign: -1, delay: 50 }, bg: { sign: -1, delay: 25 } }, propagation: { maxEvents: 8, horizon: 1000 } });
  const doc = graph(), result = simulateAnimatedFlow(flow, doc);
  assert.deepEqual(result.events.map(e => [e.linkId, e.t, e.arrival, e.payload, e.delivered]), [['ab', 0, 150, 2, -2], ['bg', 150, 275, -2, 2]]);
  assert.deepEqual(flowActivityAt(result, 149).values, {}); assert.deepEqual(flowActivityAt(result, 150).values, { b: -2 });
  assert.deepEqual(flowActivityAt(result, 275).values, { b: -2, g: 2 });
  assert.deepEqual(motionAt(flow, { playhead: 75 }, doc, 0), [{ linkId: 'ab', progress: .5, kind: 'signal', label: '2', sign: -1, delay: 50 }]);
  const textFlow = base({ ...flow, events: [event({ payload: 'Texto declarativo' })] });
  assert.equal(simulateAnimatedFlow(textFlow, doc).events.length, 1, 'Only numbers propagate');
  const two = simulateAnimatedFlow(base({ ...flow, events: [event(), event({ t: 1 })] }), doc);
  assert.deepEqual(flowActivityAt(two, 300).values, { b: -4, g: 4 });
});
test('feedback loops with zero delay, branch growth and horizons have hard simulation limits', () => {
  const links = { ab: { sign: -1, delay: 0 }, bg: { sign: 1, delay: 0 }, ga: { sign: 1, delay: 0 } };
  const flow = base({ duration: 600_000, travelMs: 1, events: [event()], links, propagation: { maxEvents: 256, horizon: 600_000 } });
  const result = simulateAnimatedFlow(flow, graph());
  assert.equal(result.events.length, 256); assert.ok(result.limitedBy.includes('events'));
  assert.deepEqual(result.events.slice(0, 4).map(e => e.delivered), [-2, -2, -2, 2]);
  const clipped = simulateAnimatedFlow(base({ ...flow, propagation: { maxEvents: 256, horizon: 3 } }), graph());
  assert.equal(clipped.events.length, 3); assert.ok(clipped.limitedBy.includes('horizon'));
  assert.deepEqual(flowActivityAt(clipped, 500).values, { b: -2, g: -2, a: -2 });
  const partial = base({ events: [event()], travelMs: 100, links, propagation: { maxEvents: 10, horizon: 20 } });
  assert.equal(flowActivityAt(simulateAnimatedFlow(partial, graph()), 50).active, 0); assert.deepEqual(motionAt(partial, { playhead: 50 }, graph(), 0), []);
  const branchDoc = { ...graph(), links: [...graph().links, { id: 'ba', from: 'b', to: 'a' }, { id: 'ag', from: 'a', to: 'g' }] };
  const branches = simulateAnimatedFlow(base({ ...flow, links: { ...links, ba: { sign: 1, delay: 0 }, ag: { sign: 1, delay: 0 } }, propagation: { maxEvents: 12, horizon: 100 } }), branchDoc);
  assert.equal(branches.events.length, 12); assert.ok(branches.limitedBy.includes('events'));
  assert.ok(branches.events.some(e => e.linkId === 'ba')); assert.ok(branches.events.some(e => e.linkId === 'bg'));
  const missing = simulateAnimatedFlow(base({ ...flow, links: { ...links, deleted: { sign: 1, delay: 0 } } }), graph());
  assert.equal(missing.issues[0].message, MISSING_FLOW_ROUTE);
});
test('copy remapping touches only internal reference fields, preserves external references and never mutates inputs', () => {
  const data = base({ events: [event({ linkId: 'ab', payload: 'a' }), event({ t: 1, from: 'b', to: 'g', linkId: 'bg' })], links: { ab: { sign: -1, delay: 50 }, bg: { sign: 1, delay: 0 } } });
  const original = JSON.stringify(data), map = new Map([['a', 'aCopy'], ['ab', 'abCopy'], ['g', 'gCopy']]);
  const mapped = animatedFlowDataSchema.parse(remapAnimatedFlowReferences(data, map));
  assert.deepEqual(mapped.events[0], { ...data.events[0], from: 'aCopy', linkId: 'abCopy' });
  assert.deepEqual(mapped.events[1], { ...data.events[1], to: 'gCopy' }); assert.equal(mapped.events[0].payload, 'a');
  assert.deepEqual(mapped.links, { abCopy: { sign: -1, delay: 50 }, bg: { sign: 1, delay: 0 } });
  assert.equal(JSON.stringify(data), original); assert.equal(map.size, 3);
  assert.deepEqual(remapAnimatedFlowReferences(data, new Map()), data);
  Object.freeze(data.events[0]); Object.freeze(data.events); Object.freeze(data.links.ab); Object.freeze(data.links); Object.freeze(data);
  assert.doesNotThrow(() => remapAnimatedFlowReferences(data, map));
  assert.doesNotThrow(() => motionAt(data, Object.freeze({ playhead: 10 }), Object.freeze(graph()), 0));
});
test('real range scrubs update every input frame before acknowledgement; only release settles once with explored interval', async () => clock(async advance => {
  const h = harness(); const initial = JSON.stringify(h.props.document); let node = h.render();
  assert.match(text(node), /¿Cómo cambia/); assert.equal(h.writes.length, 0); assert.equal(h.events.length, 0);
  const range = WebRange(find(node, WebRange).props as any) as unknown as Element;
  const input = (value: number) => range.props.onInput({ currentTarget: { value: String(value) } });
  for (const value of [100, 800, 300]) {
    input(value); const probe = h.draw(node, 99_999); assert.ok(probe.texts.includes(`Tiempo: ${value} ms`));
    assert.equal(motionAt(h.props.data, h.props.runtime.state, h.props.document, Date.now())[0].progress, value / 1000);
    assert.equal(h.events.length, 0);
  }
  range.props.onPointerUp({ currentTarget: { value: '300' } }); await Promise.resolve();
  assert.equal(h.events.length, 1); assert.deepEqual(h.events[0][1].visited, [0, 800]); assert.equal(h.events[0][1].playhead, 300);
  range.props.onPointerUp({ currentTarget: { value: '300' } }); assert.equal(h.events.length, 1);
  node = h.render(); assert.match(text(node), /Señal: 2, de Origen a Destino/);
  const keyboard = WebRange(find(node, WebRange).props as any) as unknown as Element;
  input(500); keyboard.props.onKeyUp({ key: 'ArrowRight', currentTarget: { value: '500' } }); assert.equal(h.events.length, 2);
  advance(200); node = h.render(); button(node, 'Reiniciar').props.onPress(); await Promise.resolve();
  assert.equal(h.writes.at(-1)[0], null); assert.deepEqual(h.events.at(-1)![1].visited, [0, 0]); assert.equal(h.events.at(-1)![0], 'animated-flow.reset');
  assert.deepEqual(motionAt(h.props.data, h.props.runtime.state, h.props.document, Date.now()), []);
  assert.match(text(h.render()), /Sin empezar/); assert.equal(JSON.stringify(h.props.document), initial);
  for (const [state] of h.writes) if (state) { assert.ok(runtimeBlockStateSchema.safeParse(state).success); assert.ok(Buffer.byteLength(JSON.stringify(state), 'utf8') <= 4096); }
  for (const args of h.events) assert.ok(Buffer.byteLength(JSON.stringify(args[1]), 'utf8') <= 4096);
  h.close();
}));
test('play/pause/ended use epoch time, frames never write or settle, and duplicate end frames are harmless', async () => clock(async advance => {
  const h = harness(base({ duration: 2000, events: [event()] })); let node = h.render();
  button(node, 'Reproducir').props.onPress(); assert.equal(h.events.length, 0);
  const anchor = h.props.runtime.state.anchorMs; assert.equal(anchor, Date.now()); assert.equal(h.writes.length, 1);
  for (const value of [100, 250, 500]) { advance(value); const probe = h.draw(node, 3); assert.ok(probe.texts.includes(`Tiempo: ${value} ms`)); assert.equal(h.writes.length, 1); assert.equal(h.events.length, 0); }
  node = h.render(); button(node, 'Pausar').props.onPress(); await Promise.resolve();
  assert.equal(h.events.length, 1); assert.equal(h.events[0][0], 'animated-flow.pause'); assert.equal(h.events[0][1].playhead, 500); assert.deepEqual(h.events[0][1].visited, [0, 500]);
  button(node, 'Pausar').props.onPress(); assert.equal(h.events.length, 1);
  advance(1000); node = h.render(); assert.match(text(node), /Tiempo: 500/); button(node, 'Reproducir').props.onPress();
  advance(2700); h.draw(node, 0); h.draw(node, 0); await Promise.resolve();
  assert.equal(h.events.length, 2); assert.equal(h.events[1][0], 'animated-flow.ended'); assert.equal(h.events[1][1].playhead, 2000); assert.equal(h.props.runtime.state.playing, false);
  assert.equal(find(h.render(), CanvasSurface).props.animated, false); h.close();
}));
test('visibility, reduced motion and unmount pause playback; stored state never autoplays', async () => clock(async advance => {
  const h = harness(); let node = h.render(); const surface = find(node, CanvasSurface);
  button(node, 'Reproducir').props.onPress(); advance(300); surface.props.onVisibilityChange(false); await Promise.resolve();
  assert.equal(h.props.runtime.state.playing, false); assert.equal(h.events.length, 1); assert.equal(h.events[0][1].reason, 'hidden');
  surface.props.onVisibilityChange(false); surface.props.onVisibilityChange(true); assert.equal(h.events.length, 1);
  advance(1000); assert.ok(h.draw(node).texts.includes('Tiempo: 300 ms'));
  node = h.render(); button(node, 'Reproducir').props.onPress(); reducedMotion.current = true; advance(1100); h.draw(node); assert.equal(h.props.runtime.state.playing, false);
  node = h.render(); assert.equal(button(node, 'Reproducir').props.disabled, true); assert.match(text(node), /Movimiento reducido/);
  reducedMotion.current = false; node = h.render(); button(node, 'Reproducir').props.onPress(); advance(1300); const before = h.events.length; h.close();
  assert.equal(h.props.runtime.state.playing, false); assert.equal(h.events.length, before, 'departure flushes final runtime, without a fabricated interaction');
  const restored = harness(undefined, false, 'web', { playhead: 250, playing: true, anchorMs: Date.now() - 50_000 });
  node = restored.render(); assert.equal(find(node, CanvasSurface).props.animated, false); assert.equal(restored.props.runtime.state.playing, false);
  assert.ok(restored.draw(node).texts.includes('Tiempo: 250 ms')); assert.equal(restored.events.length, 0); restored.close();
}));
test('actual renderer handles missing routes, readOnly, native fallback and empty defaults honestly', () => {
  const missing = harness(base({ events: [event({ to: 'deleted' })] })); let node = missing.render(); assert.match(text(node), /La ruta ya no existe en este lienzo/);
  assert.equal(button(node, 'Reproducir').props.disabled, true); button(node, 'Reproducir').props.onPress(); assert.equal(missing.writes.length, 0); missing.close();
  const frozen = harness(undefined, true); node = frozen.render(); find(node, WebRange).props.onChange(300); find(node, WebRange).props.onSettle(300);
  for (const b of all(node).filter(n => n.type === Button)) { assert.equal(b.props.disabled, true); b.props.onPress(); }
  assert.equal(frozen.writes.length, 0); assert.equal(frozen.events.length, 0); frozen.close();
  const native = harness(undefined, false, 'ios'); node = native.render(); assert.ok(find(node, NativeLearningFallback)); assert.equal(find(node, CanvasSurface), undefined); assert.equal(find(node, WebRange), undefined); assert.match(text(node), /Estático/);
  for (const b of all(node).filter(n => n.type === Button)) { assert.equal(b.props.disabled, true); b.props.onPress(); } assert.equal(native.writes.length, 0); assert.equal(native.events.length, 0); native.close();
  const empty = harness(base()); node = empty.render(); assert.match(text(node), /Añade eventos entre nodos conectados/); assert.equal(button(node, 'Reproducir').props.disabled, true); empty.close(); Platform.OS = 'web';
});
test('real service blocks feedback on flush failure, deduplicates a lost-response retry and persists bounded runtime', async t => {
  const { service } = await setup(t), reference = { documentId: 'd', workspaceId };
  const view = await service.mutate(mutation(0, [{ type: 'link.create', link: { id: 'bc', from: 'b', to: 'c', kind: 'flow' } }]));
  const h = harness(base({ events: [event({ from: 'b', to: 'c', linkId: 'bc' })] }));
  h.props.document = view.document; h.props.block = view.document.blocks.find(b => b.id === 'b')!;
  const originalWrite = h.props.runtime.set, calls: any[][] = [];
  let write: Promise<unknown> = Promise.resolve(), flight: Promise<void> = Promise.resolve(), failFlush = true, loseResponse = true;
  h.props.runtime.set = (state, settled) => { originalWrite(state, settled); write = service.runtimeSet({ ...reference, blocks: [{ id: 'b', state }], scopes: [] }); };
  h.props.runtime.flush = async () => { await write; if (failFlush) throw new Error('offline /private/flush'); };
  h.props.runtime.settle = (...args) => {
    calls.push(args);
    flight = (async () => {
      await h.props.runtime.flush();
      await service.action({ ...reference, expectedRevision: view.document.revision, eventId: args[3]!, action: { kind: args[0], payload: args[1], label: args[2]!, targetIds: ['b'], delivery: 'batched', settled: true } });
      if (loseResponse) { loseResponse = false; throw new Error('lost response /private/service'); }
    })();
    return flight;
  };
  try {
    let node = h.render(); find(node, WebRange).props.onChange(400); find(node, WebRange).props.onSettle(400);
    await assert.rejects(flight, /offline/); await Promise.resolve();
    assert.equal((await service.events(reference)).events.length, 0);
    node = h.render(); assert.match(text(node), /No se pudo guardar la interacción/); assert.ok(!text(node).includes('/private'));
    failFlush = false; button(node, 'Reintentar').props.onPress(); await assert.rejects(flight, /lost response/); await Promise.resolve();
    assert.equal((await service.events(reference)).events.length, 1);
    button(h.render(), 'Reintentar').props.onPress(); await flight; await Promise.resolve();
    assert.deepEqual(calls[0], calls[1]); assert.deepEqual(calls[1], calls[2]);
    const events = (await service.events(reference)).events;
    assert.equal(events.length, 1); assert.equal(events[0].action.settled, true);
    assert.ok(Buffer.byteLength(JSON.stringify(events[0].action.payload), 'utf8') <= 4096);
    const persisted = await service.read(reference);
    assert.equal(persisted.runtime.blocks.b.playhead, 400); assert.equal(persisted.document.revision, view.document.revision);
    assert.deepEqual(persisted.document, view.document);
    button(h.render(), 'Reiniciar').props.onPress(); await flight;
    assert.equal((await service.read(reference)).runtime.blocks.b, undefined);
    assert.equal((await service.events(reference)).events.length, 2);
  } finally { h.close(); }
});
test('real surface adapter pauses renderer on hidden tab, caps pixels and stops scheduling without GUI', async () => clock(async advance => {
  const h = harness(); let node = h.render(); const surfaceProps = find(node, CanvasSurface).props;
  const owned: HookHost = { slots: [], effects: [] }, frames = new Map<number, Function>(), listeners = new Map<string, Function>();
  const globals = globalThis as unknown as Record<string, any>, old = new Map<string, unknown>(), observers: Record<string, Function> = {}; let sequence = 0;
  const doc = { hidden: false, addEventListener: (name: string, fn: Function) => listeners.set(name, fn), removeEventListener: (name: string) => listeners.delete(name) };
  const browser = { document: doc, devicePixelRatio: 4, requestAnimationFrame: (fn: Function) => { frames.set(++sequence, fn); return sequence; }, cancelAnimationFrame: (id: number) => frames.delete(id),
    IntersectionObserver: class { constructor(fn: Function) { observers.intersection = fn; } observe() {} disconnect() {} },
    ResizeObserver: class { constructor(fn: Function) { observers.resize = fn; } observe() {} disconnect() {} },
  };
  for (const [key, value] of Object.entries(browser)) { old.set(key, globals[key]); globals[key] = value; }
  const probe = context(), canvas = { clientWidth: 600, clientHeight: 160, width: 0, height: 0, getBoundingClientRect: () => ({ left: 0, top: 0, width: 1200, height: 320 }), getContext: () => probe.ctx,
    addEventListener() {}, removeEventListener() {}, setPointerCapture() {}, releasePointerCapture() {} };
  try {
    host = owned; cursor = 0; const wrapper = WebCanvasSurface(surfaceProps as any) as unknown as Element;
    const root = (wrapper.type as Function)(wrapper.props) as Element; find(root, 'canvas').props.ref.current = canvas; commit(owned);
    assert.equal(frames.size, 0); observers.intersection([{ isIntersecting: true }]);
    const frame = () => { const pending = [...frames.values()]; frames.clear(); pending.forEach(fn => fn(123)); };
    frame(); assert.equal(canvas.width, 1024); assert.ok(canvas.height <= 1024);
    node = h.render(); button(node, 'Reproducir').props.onPress(); node = h.render();
    host = owned; cursor = 0; (wrapper.type as Function)({ ...find(node, CanvasSurface).props, kind: '2d' }); commit(owned);
    advance(200); const writes = h.writes.length; frame(); assert.equal(h.writes.length, writes); assert.equal(h.events.length, 0); assert.ok(frames.size > 0);
    doc.hidden = true; listeners.get('visibilitychange')!(); assert.equal(frames.size, 0); assert.equal(h.props.runtime.state.playing, false); assert.equal(h.events.length, 1);
    doc.hidden = false; listeners.get('visibilitychange')!(); frame(); assert.equal(h.props.runtime.state.playing, false);
    cleanup(owned); assert.equal(frames.size, 0);
  } finally { cleanup(owned); h.close(); for (const [key, value] of old) { if (value === undefined) delete globals[key]; else globals[key] = value; } }
}));
