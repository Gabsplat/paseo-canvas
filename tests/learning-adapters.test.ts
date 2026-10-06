import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { effects, reset, updates, type Element } from './fixtures/react-headless';
import { Platform } from './fixtures/native-headless';
// Replace host UI and React hooks only in this test worker. Exercise actual adapter code.
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === 'react' || specifier === 'react/jsx-runtime') return { url: new URL('./fixtures/react-headless.ts', `file://${__filename}`).href, shortCircuit: true };
  if (specifier === 'react-native' || (specifier.endsWith('/ui') && context.parentURL?.includes('/plugin/client/'))) return { url: new URL('./fixtures/native-headless.ts', `file://${__filename}`).href, shortCircuit: true };
  return nextResolve(specifier, context);
} });
const { WebCanvasSurface, WebGLSurface, WebRange, compileGLProgram, MAX_LIVE_GL_CONTEXTS } = require('../plugin/client/web');
const { CanvasSurface, GLSurface, NativeLearningFallback } = require('../plugin/client/Surfaces');
const { controlsRenderer } = require('../plugin/client/renderers/controls');
const children = (node: Element): Element[] => (Array.isArray(node.props.children) ? node.props.children.flat(Infinity) : [node.props.children]).filter((x: unknown) => x && typeof x === 'object');
const find = (node: Element, type: unknown): Element | undefined => node.type === type ? node : children(node).map(n => find(n, type)).find(Boolean);
function harness(kind: '2d' | 'webgl', props: Record<string, unknown>, gl?: Record<string, unknown>) {
  reset(); Platform.OS = 'web';
  const frames = new Map<number, (time: number) => void>(), docEvents = new Map<string, () => void>(), canvasEvents = new Map<string, (event: any) => void>();
  const observers: Record<string, Function> = {}; let sequence = 0;
  const doc = { hidden: false, addEventListener: (name: string, cb: () => void) => docEvents.set(name, cb), removeEventListener: (name: string) => docEvents.delete(name) };
  const globals = globalThis as unknown as Record<string, any>, old = new Map<string, unknown>();
  const host = { document: doc, devicePixelRatio: 2, requestAnimationFrame: (cb: (time: number) => void) => { frames.set(++sequence, cb); return sequence; }, cancelAnimationFrame: (id: number) => frames.delete(id),
    IntersectionObserver: class { constructor(cb: Function) { observers.intersection = cb; } observe() {} disconnect() {} },
    ResizeObserver: class { constructor(cb: Function) { observers.resize = cb; } observe() {} disconnect() {} },
  };
  for (const [key, value] of Object.entries(host)) { old.set(key, globals[key]); globals[key] = value; }
  const transforms: number[][] = []; let saved = 0, restored = 0;
  const ctx = { save: () => saved++, restore: () => restored++, setTransform: (...args: number[]) => transforms.push(args) };
  const canvas = { clientWidth: 200, clientHeight: 100, width: 0, height: 0, getBoundingClientRect: () => ({ left: 10, top: 20, width: 300, height: 150 }), getContext: () => kind === '2d' ? ctx : gl,
    addEventListener: (name: string, cb: (e: any) => void) => canvasEvents.set(name, cb), removeEventListener: (name: string) => canvasEvents.delete(name), setPointerCapture() {}, releasePointerCapture() {},
  };
  const element = (kind === '2d' ? WebCanvasSurface : WebGLSurface)({ id: 'test', label: 'Graph', height: 100, ...props } as any) as unknown as Element;
  const root = (element.type as Function)(element.props) as Element, node = find(root, 'canvas')!;
  node.props.ref.current = canvas;
  const cleanups = effects.map(effect => effect()).filter((value): value is () => void => typeof value === 'function');
  return { canvas, node, doc, docEvents, frames, observers, canvasEvents, transforms, balances: () => [saved, restored],
    frame(time = 0) { const pending = [...frames.values()]; frames.clear(); pending.forEach(cb => cb(time)); },
    close() { cleanups.reverse().forEach(fn => fn()); for (const [key, value] of old) { if (value === undefined) delete globals[key]; else globals[key] = value; } },
  };
}
test('2D adapter uses camera/DPR pixels, logical pointer coordinates, resizes, and stops while invisible', () => {
  let draws = 0; const pointers: unknown[] = [];
  const h = harness('2d', { animated: true, draw: () => draws++, onPointer: (p: unknown) => pointers.push(p) });
  try {
    assert.equal(h.frames.size, 0); h.observers.intersection([{ isIntersecting: true }]); h.frame(42);
    assert.equal(draws, 1); assert.equal(h.canvas.width, 600); assert.equal(h.canvas.height, 300);
    assert.deepEqual(h.transforms[0], [3, 0, 0, 3, 0, 0]); assert.deepEqual(h.balances(), [1, 1]);
    h.node.props.onPointerDown({ clientX: 160, clientY: 95, pointerId: 7, buttons: 1, pressure: .5, stopPropagation() {} });
    assert.deepEqual(pointers[0], { kind: 'down', x: 100, y: 50, pointerId: 7, buttons: 1, pressure: .5 });
    h.observers.intersection([{ isIntersecting: false }]); assert.equal(h.frames.size, 0); h.frame(); assert.equal(draws, 1);
    h.observers.intersection([{ isIntersecting: true }]); h.doc.hidden = true; h.frame(); assert.equal(draws, 1);
    h.doc.hidden = false; h.canvas.clientWidth = 100; h.observers.resize(); h.frame(); assert.equal(h.canvas.width, 400);
  } finally { h.close(); }
  assert.equal(h.frames.size, 0);
});
function fakeGL() {
  let disposed = 0;
  return { viewport() {}, getExtension: () => ({ loseContext: () => disposed++ }), disposed: () => disposed };
}
test('WebGL adapter pauses on context loss, reinitializes on restore, and releases its context', () => {
  const gl = fakeGL(); let initializations = 0, draws = 0;
  const h = harness('webgl', { animated: true, initialize: () => { initializations++; }, draw: () => draws++ }, gl);
  try {
    h.observers.intersection([{ isIntersecting: true }]); h.frame(); assert.equal(draws, 1);
    let prevented = false; h.canvasEvents.get('webglcontextlost')!({ preventDefault() { prevented = true; } });
    assert.equal(prevented, true); assert.equal(h.frames.size, 0); h.frame(); assert.equal(draws, 1);
    h.canvasEvents.get('webglcontextrestored')!({}); h.frame(); assert.equal(initializations, 2); assert.equal(draws, 2);
  } finally { h.close(); }
  assert.equal(gl.disposed(), 1);
});
test('surface visibility pauses playback on hidden stages and pixel caps bound physical drawing size', () => {
  const visibility: boolean[] = [];
  const h = harness('2d', { animated: true, maxPixelSize: 192, draw() {}, onVisibilityChange: (value: boolean) => visibility.push(value) });
  try {
    assert.deepEqual(visibility, [false]);
    h.observers.intersection([{ isIntersecting: true }]); h.frame();
    assert.deepEqual(visibility, [false, true]);
    assert.equal(h.canvas.width, 192); assert.equal(h.canvas.height, 96);
    h.doc.hidden = true; h.docEvents.get('visibilitychange')!();
    assert.deepEqual(visibility, [false, true, false]); assert.equal(h.frames.size, 0);
    h.doc.hidden = false; h.docEvents.get('visibilitychange')!();
    assert.deepEqual(visibility, [false, true, false, true]);
    h.observers.intersection([{ isIntersecting: false }]);
    assert.deepEqual(visibility, [false, true, false, true, false]); assert.equal(h.frames.size, 0);
  } finally { h.close(); }
});
test('WebGL context cap degrades in Spanish and freeing a context permits another one', () => {
  const held: ReturnType<typeof harness>[] = [];
  try {
    for (let i = 0; i < MAX_LIVE_GL_CONTEXTS; i++) held.push(harness('webgl', { draw() {} }, fakeGL()));
    const overflow = harness('webgl', { draw() {} }, fakeGL());
    assert.ok(updates.some(message => String(message).includes('demasiados gráficos WebGL'))); overflow.close();
    held.pop()!.close();
    const next = harness('webgl', { draw() {} }, fakeGL()); assert.ok(!updates.some(message => String(message).includes('demasiados'))); next.close();
  } finally { held.reverse().forEach(h => h.close()); }
});
test('shader compilation/link diagnostics return without throwing and release temporary resources', () => {
  const deleted: object[] = []; let linked = false;
  const gl = { VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4, createShader: () => ({}), shaderSource() {}, compileShader() {}, getShaderParameter: () => true, getShaderInfoLog: () => 'compile detail', deleteShader: (s: object) => deleted.push(s), createProgram: () => ({}), attachShader() {}, linkProgram() {}, getProgramParameter: () => linked, getProgramInfoLog: () => 'link detail', deleteProgram: (p: object) => deleted.push(p) };
  assert.deepEqual(compileGLProgram(gl as any, 'vertex', 'fragment'), { error: 'link detail' }); assert.equal(deleted.length, 3);
  gl.getShaderParameter = () => false; assert.deepEqual(compileGLProgram(gl as any, 'bad', 'bad'), { error: 'compile detail' }); assert.equal(deleted.length, 4);
  gl.getShaderParameter = () => true; linked = true; assert.ok(compileGLProgram(gl as any, 'ok', 'ok').program); assert.equal(deleted.length, 6);
});
test('native wrappers return static Spanish fallback without touching the browser', () => {
  Platform.OS = 'ios'; const props = { id: 'b', summary: 'Resultado estático', label: 'Graph', height: 100, draw() { throw new Error('must not draw'); } };
  for (const Component of [CanvasSurface, GLSurface]) {
    const node = Component(props) as unknown as Element;
    assert.equal(node.type, NativeLearningFallback); assert.equal(node.props.summary, 'Resultado estático');
    const fallback = NativeLearningFallback(node.props as any) as unknown as Element;
    assert.equal(children(fallback)[1].props.children, 'La versión interactiva está disponible en escritorio/web.');
  }
  const web = WebCanvasSurface(props) as unknown as Element; assert.equal((web.type as Function)(web.props), null);
  assert.equal(WebRange({ id: 'r', label: 'r', min: 0, max: 1, value: 0, step: 1, disabled: false, color: '#000', onChange() {}, onSettle() {} }), null);
  Platform.OS = 'web';
});
test('controls presents its guiding question and visible reset, removes overrides and reports settled defaults', async () => {
  reset(); const writes: unknown[] = [], events: unknown[] = [];
  const component = controlsRenderer.Component as Function;
  const node = component({ data: { question: '¿Cómo cambia la amplitud?', variables: ['amplitude'] }, block: { id: 'b' }, ui: { layout: { platform: 'web' }, c: { accent: '#246', statusDanger: '#933' } }, scope: { variables: { amplitude: { label: 'Amplitud', value: 1, current: 3, min: 0, max: 4, scopeId: 'g' } }, get: () => 3, set: (...args: unknown[]) => writes.push(args) }, runtime: { settle: async (...args: unknown[]) => { events.push(args); } } }) as Element;
  assert.equal(children(node)[0].props.children, '¿Cómo cambia la amplitud?');
  const button = find(node, 'Button')!; assert.equal(button.props.label, 'Reiniciar'); button.props.onPress(); await Promise.resolve();
  assert.deepEqual(writes, [['amplitude', null]]); assert.deepEqual(events, [['controls.reset', { values: { amplitude: 1 } }, 'Reiniciar controles']]);
});
