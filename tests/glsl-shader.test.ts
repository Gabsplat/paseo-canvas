import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { glslShaderDataSchema, glslShaderSpec, glslShaderState, glslSummary, glslUtf8Length, glslWantsToPlay, type GlslShaderData } from '../plugin/shared/renderers/glsl-shader';
import { documentSchema } from '../plugin/shared/model';
import { resolveScope } from '../plugin/shared/learning';
import { LearningRuntimeStore } from '../plugin/client/learning-state';
import type { RendererProps } from '../plugin/client/renderers/types';
import type { GLContext } from '../plugin/client/Surfaces';
import { Platform, Button } from './fixtures/native-headless';

// Only React's host and native widgets are simulated. Renderer, GL compiler helper,
// drawing adapter and optimistic runtime store execute their production code.
type Element = { type: unknown; props: Record<string, any> };
type Slot = any;
let slots: Slot[] = [], cursor = 0;
export function createElement(type: unknown, props: Record<string, unknown> | null, ...children: unknown[]): Element { return { type, props: { ...props, ...(children.length ? { children: children.length === 1 ? children[0] : children } : {}) } }; }
export function useRef<T>(current: T): { current: T } { return slots[cursor++] ??= { current }; }
export function useState<T>(initial: T): [T, (value: T) => void] { const owned = slots, i = cursor++; if (!(i in owned)) owned[i] = initial; return [owned[i], value => { owned[i] = value; }]; }
const same = (a?: unknown[], b?: unknown[]) => !!a && !!b && a.length === b.length && a.every((x, i) => Object.is(x, b[i]));
export function useMemo<T>(get: () => T, deps?: unknown[]): T { const i = cursor++, old = slots[i]; if (!old || !same(old.deps, deps)) slots[i] = { value: get(), deps }; return slots[i].value; }
export function useEffect(effect: () => void | (() => void), deps?: unknown[]) { const i = cursor++, old = slots[i]; if (!old || !same(old.deps, deps)) slots[i] = { effect, deps, dirty: true, cleanup: old?.cleanup }; }
export function useSyncExternalStore(_subscribe: unknown, get: () => unknown) { return get(); }
export const jsx = (type: unknown, props: Record<string, unknown>) => ({ type, props });
export const jsxs = jsx;
export function createContext<T>(value:T){return{value,Provider:'context-provider'};}
export function useContext<T>(context:{value:T}){return context.value;}
export default { createElement };
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === 'react' || specifier === 'react/jsx-runtime') return { url: new URL('./glsl-shader.test.ts', `file://${__filename}`).href, shortCircuit: true };
  if (specifier === 'react-native' || (specifier.endsWith('/ui') && context.parentURL?.includes('/plugin/client/'))) return { url: new URL('./fixtures/native-headless.ts', `file://${__filename}`).href, shortCircuit: true };
  return nextResolve(specifier, context);
} });
const { glslShaderRenderer, prepareShader, boundedShaderMessage } = require('../plugin/client/renderers/glsl-shader') as typeof import('../plugin/client/renderers/glsl-shader');
const { GLSurface, NativeLearningFallback } = require('../plugin/client/Surfaces') as typeof import('../plugin/client/Surfaces');
const { WebRange } = require('../plugin/client/web') as typeof import('../plugin/client/web');
const { controlsRenderer } = require('../plugin/client/renderers/controls') as typeof import('../plugin/client/renderers/controls');
// Blocks stored before the chrome became optional carry a question; most tests below exercise that legacy face.
const LEGACY = { question: 'How does the spacing of the stripes change with the frequency?' };
const base = (patch: Record<string, unknown> = {}) => glslShaderDataSchema.parse({ ...glslShaderSpec.blockType.defaults, ...LEGACY, ...patch });
const timed = () => base({ builtins: { resolution: true, time: true }, fragmentSource: String(glslShaderSpec.blockType.defaults.fragmentSource).replace('void main()', 'uniform float u_time;\nvoid main()') });
const all = (node: Element): Element[] => [node, ...(Array.isArray(node.props.children) ? node.props.children.flat(Infinity) : [node.props.children]).filter((n: unknown): n is Element => !!n && typeof n === 'object' && 'props' in n).flatMap(all)];
const find = (node: Element, type: unknown) => all(node).find(n => n.type === type)!;
const button = (node: Element, label: string) => all(node).find(n => n.type === Button && n.props.label === label)!;
const text = (node: Element) => all(node).filter(n => n.type === 'Txt').map(n => Array.isArray(n.props.children) ? n.props.children.flat(Infinity).join('') : String(n.props.children)).join(' ');
function run<T>(owned: Slot[], fn: () => T): T { slots = owned; cursor = 0; return fn(); }
function commit(owned: Slot[]) { for (const slot of owned) if (slot?.dirty) { slot.dirty = false; slot.cleanup?.(); slot.cleanup = slot.effect(); } }
function cleanup(owned: Slot[]) { for (const slot of [...owned].reverse()) { slot?.cleanup?.(); if (slot) slot.cleanup = undefined; } }
function fakeGL() {
  let sequence = 0;
  const created: Record<string, object[]> = { shader: [], program: [], buffer: [] }, deleted: Record<string, object[]> = { shader: [], program: [], buffer: [] };
  const uniforms: Record<string, number[]> = {}, sources: string[] = [];
  const settings = { compile: true, link: true, buffer: true, setup: true, log: 'ERROR: 0:3: syntax error', draws: 0, lost: 0 };
  const allocate = (kind: string) => { const object = { kind, id: ++sequence }; created[kind].push(object); return object; };
  const free = (kind: string, object: object) => { assert.ok(!deleted[kind].includes(object), `${kind} deleted twice`); deleted[kind].push(object); };
  const gl = {
    VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4, ARRAY_BUFFER: 5, STATIC_DRAW: 6, DYNAMIC_DRAW: 7, FLOAT: 8,
    TRIANGLES: 9, TRIANGLE_STRIP: 10, LINES: 11, POINTS: 12, COLOR_BUFFER_BIT: 13,
    createShader: () => allocate('shader'), shaderSource(_shader: object, source: string) { sources.push(source); }, compileShader() {}, getShaderParameter: () => settings.compile,
    getShaderInfoLog: () => settings.log, deleteShader: (s: object) => free('shader', s), createProgram: () => allocate('program'), attachShader() {}, linkProgram() {},
    getProgramParameter: () => settings.link, getProgramInfoLog: () => settings.log, deleteProgram: (p: object) => free('program', p), useProgram() {},
    getUniformLocation: (_p: object, name: string) => ({ name }), uniform1f(location: any, value: number) { uniforms[location.name] = [value]; }, uniform2f(location: any, x: number, y: number) { uniforms[location.name] = [x, y]; },
    uniform3f() {}, uniform4f() {}, uniform1i() {}, createBuffer: () => settings.buffer ? allocate('buffer') : null, bindBuffer() {},
    bufferData() { if (!settings.setup) throw new Error('Buffer setup failed'); }, deleteBuffer: (b: object) => free('buffer', b), getAttribLocation: () => 0,
    enableVertexAttribArray() {}, vertexAttribPointer() {}, viewport() {}, clearColor() {}, clear() {}, drawArrays() { settings.draws++; }, getExtension: () => ({ loseContext() { settings.lost++; } }),
  } satisfies GLContext;
  return { gl, settings, created, deleted, uniforms, sources, assertFreed() { for (const kind of Object.keys(created)) assert.deepEqual(new Set(deleted[kind]), new Set(created[kind]), kind); } };
}
function harness(data = base(), readOnly = false, platform = 'web') {
  Platform.OS = platform;
  const owned: Slot[] = [], writes: unknown[] = [], events: any[][] = [], scopeWrites: unknown[] = [];
  const props = { data, document: {}, block: { id: 'shader' }, compact: false, availableWidth: 400, readOnly,
    ui: { layout: { platform }, c: { surface0: '#fff', foreground: '#111', foregroundMuted: '#555', border: '#ccc', accent: '#246', statusDanger: '#933' } },
    scope: { variables: {}, values: {}, get: () => NaN, set: (...args: unknown[]) => scopeWrites.push(args) },
    runtime: { state: {}, set(state: Record<string, unknown> | null) { writes.push(state); (props.runtime as any).state = state ?? {}; }, flush: async () => {}, record: async (...args: unknown[]) => { events.push(args); } }, send: async () => {},
  } as unknown as RendererProps<GlslShaderData>;
  return { props, writes, events, scopeWrites,
    render() { const node = run(owned, () => (glslShaderRenderer.Component as Function)(props) as Element); commit(owned); return node; },
    close() { cleanup(owned); },
  };
}
// Real surface adapter with a contained fake browser host. No GUI or GPU is opened.
function adapter(h: ReturnType<typeof harness>, probe: ReturnType<typeof fakeGL>, available = true) {
  const owned: Slot[] = [], frames = new Map<number, (t: number) => void>(), canvasEvents = new Map<string, Function>(), docEvents = new Map<string, Function>();
  let intersection: Function = () => {}, sequence = 0;
  const globals = globalThis as unknown as Record<string, any>, old = new Map<string, unknown>();
  // The page's one shared WebGL canvas, and the 2D canvas each card copies its picture into.
  const shared = { width: 0, height: 0, getContext: (kind: string) => kind === 'webgl' && available ? probe.gl : null, addEventListener: (name: string, cb: Function) => canvasEvents.set(name, cb), removeEventListener: (name: string) => canvasEvents.delete(name) };
  const document = { hidden: false, createElement: () => shared, addEventListener: (name: string, cb: Function) => docEvents.set(name, cb), removeEventListener: (name: string) => docEvents.delete(name) };
  const copies: number[][] = [], view = { clearRect() {}, drawImage: (_source: unknown, ...rect: number[]) => copies.push(rect) };
  const host = { document, devicePixelRatio: 3, requestAnimationFrame: (cb: (t: number) => void) => { frames.set(++sequence, cb); return sequence; }, cancelAnimationFrame: (id: number) => frames.delete(id),
    IntersectionObserver: class { constructor(cb: Function) { intersection = cb; } observe() {} disconnect() {} }, ResizeObserver: class { constructor(_cb: Function) {} observe() {} disconnect() {} } };
  for (const [key, value] of Object.entries(host)) { old.set(key, globals[key]); globals[key] = value; }
  const canvas = { clientWidth: 400, clientHeight: 225, width: 0, height: 0, getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 225 }), getContext: (kind: string) => kind === '2d' ? view : null,
    addEventListener() {}, removeEventListener() {}, setPointerCapture() {}, releasePointerCapture() {} };
  let node: Element;
  const render = () => {
    node = h.render(); const stage = find(node, GLSurface);
    const wrapper = GLSurface(stage.props as any) as unknown as Element;
    const inner = (wrapper.type as Function)(wrapper.props) as Element;
    const tree = run(owned, () => (inner.type as Function)(inner.props) as Element);
    find(tree, 'canvas').props.ref.current = canvas; commit(owned); return node;
  };
  render();
  return { render, canvas, frames, document, shared, copies,
    show(value: boolean) { intersection([{ isIntersecting: value }]); },
    frame(time = 0) { const pending = [...frames.values()]; frames.clear(); for (const cb of pending) cb(time); },
    hideTab(value: boolean) { document.hidden = value; docEvents.get('visibilitychange')!(); },
    lost() { canvasEvents.get('webglcontextlost')!({ preventDefault() {} }); }, restored() { canvasEvents.get('webglcontextrestored')!({}); },
    close() { cleanup(owned); h.close(); for (const [key, value] of old) { if (value === undefined) delete globals[key]; else globals[key] = value; } },
  };
}

test('shader defaults and portable schema reject extra executable controls, bad declarations and excessive work', () => {
  assert.equal(glslShaderSpec.id, glslShaderRenderer.id); assert.equal(base().maxPixelSize, 512);
  assert.deepEqual(new Set(glslShaderSpec.blockType.properties.map(p => p.key)), new Set(Object.keys(glslShaderDataSchema.shape)));
  const u = base().uniforms[0];
  for (const patch of [ { controls: 'sideways' }, { reset: 'yes' }, { uniforms: Array(5).fill(u) }, { uniforms: [u, u] }, { uniforms: [{ ...u, name: 'u_time' }] },
    { uniforms: [{ ...u, name: '__proto__' }] }, { uniforms: [{ ...u, value: 13 }] }, { uniforms: [{ ...u, min: Infinity }] }, { uniforms: [{ ...u, max: 1 }] },
    { uniforms: [{ ...u, step: 0 }] }, { uniforms: [{ ...u, javascript: 'alert(1)' }] }, { maxPixelSize: 1025 }, { maxPixelSize: 15 }, { maxPixelSize: 1.5 },
    { fragmentSource: 'é'.repeat(2049) }, { fragmentSource: 'x'.repeat(4097) }, { html: '<input>' }, { fragmentSource: 'uniform sampler2D image; void main() {}' },
    { fragmentSource: 'uniform float frequency[2]; uniform vec2 u_resolution; void main() {}' }, { builtins: { resolution: true, time: true } },
    { fragmentSource: base().fragmentSource + '\nuniform float hidden;' },
  ]) assert.equal(glslShaderDataSchema.safeParse({ ...glslShaderSpec.blockType.defaults, ...patch }).success, false, JSON.stringify(patch));
  assert.ok(timed());
  assert.ok(base({ fragmentSource: '// uniform sampler2D example;\n' + base().fragmentSource }));
});

test('runtime recovery drops undeclared payloads, clamps locals and time, and stays under 4096 UTF-8 bytes', () => {
  assert.deepEqual(glslShaderState(base(), { values: { frequency: 99, hidden: 10 }, time: Infinity }), { values: { frequency: 12 }, time: 0 });
  assert.deepEqual(glslShaderState(base(), { values: [], time: -4 }), { values: {}, time: 0 });
  assert.deepEqual(glslShaderState(base(), { values: { frequency: 'wrong' }, time: 1e9 }), { values: {}, time: 86400 });
  const bounded = glslShaderState(base(), { values: { frequency: 3 }, time: 23 });
  assert.ok(Buffer.byteLength(JSON.stringify(bounded), 'utf8') < 4096);
  assert.equal(glslUtf8Length('é😀'), Buffer.byteLength('é😀', 'utf8'));
});

test('compile/link failures and partial buffer failures release exactly their owned allocations', () => {
  for (const mode of ['compile', 'link', 'buffer', 'setup'] as const) {
    const p = fakeGL(); p.settings[mode] = false;
    const result = prepareShader(p.gl, base()); assert.ok(result.error, mode); assert.equal(result.resources, undefined); p.assertFreed();
  }
  const p = fakeGL(), result = prepareShader(p.gl, base()); assert.ok(result.resources);
  assert.ok(p.sources[0].includes('attribute vec2 a_position')); assert.equal(p.sources[1], base().fragmentSource);
  result.resources.dispose(); result.resources.dispose(); p.assertFreed();
});

test('real component shows bounded compile/link code while retaining controls and reset', () => {
  for (const failure of ['compile', 'link'] as const) {
    const h = harness(), p = fakeGL(); p.settings[failure] = false; p.settings.log = 'ERROR: 0:3: invalid token\n/home/private/file ' + 'é'.repeat(3000);
    const a = adapter(h, p);
    try {
      const node = a.render(); assert.match(text(node), /The shader did not compile/); assert.match(text(node), /ERROR: 0:3/); assert.ok(!text(node).includes('/home/private'));
      const diagnostic = all(node).find(n => n.type === 'Txt' && n.props.kind === 'code' && String(n.props.children).startsWith('ERROR:'))!;
      assert.ok(Buffer.byteLength(diagnostic.props.children, 'utf8') <= 1024);
      assert.ok(find(node, WebRange)); assert.equal(button(node, 'Reset').props.disabled, false);
      find(node, WebRange).props.onChange(8); assert.equal(h.props.runtime.state.values && (h.props.runtime.state.values as any).frequency, 8);
      button(a.render(), 'Reset').props.onPress(); assert.equal(h.writes.at(-1), null);
      a.show(true); a.frame(); assert.equal(p.settings.draws, 0);
    } finally { a.close(); }
    p.assertFreed();
  }
  assert.equal(boundedShaderMessage(''), 'The compiler gave no more detail.');
});

test('actual WebRange pointer/input frames draw local values immediately and release settles only final explored range', async () => {
  const h = harness(), p = fakeGL(), a = adapter(h, p);
  try {
    a.show(true); a.frame(); let node = a.render();
    const range = find(node, WebRange), input = WebRange(range.props as any) as unknown as Element;
    for (const value of [7, 2, 9]) { input.props.onInput({ currentTarget: { value: String(value) } }); node = a.render(); a.frame(20); assert.deepEqual(p.uniforms.frequency, [value]); assert.equal(h.events.length, 0); }
    input.props.onPointerUp({ currentTarget: { value: '6' } }); await Promise.resolve();
    assert.deepEqual(h.events[0].slice(0, 2), ['glsl-shader.uniform.frequency', { name: 'frequency', value: 6, visited: [2, 9] }]);
    button(a.render(), 'Reset').props.onPress(); a.render(); a.frame(); assert.deepEqual(p.uniforms.frequency, [4]); assert.equal(h.events.at(-1)![0], 'glsl-shader.reset');
    for (const payload of [...h.writes.filter(Boolean), ...h.events.map(e => e[1])]) assert.ok(Buffer.byteLength(JSON.stringify(payload), 'utf8') < 4096);
  } finally { a.close(); }
  p.assertFreed();
});

test('real scope store binds before transport acknowledgement, including sibling controls and shared ranges', () => {
  for (const scopeId of ['$document', 'group']) {
    const variable = { name: 'frequency', min: 0, max: 24, value: 3, step: .5 };
    const doc = documentSchema.parse({ id: 'd', workspaceId: 'w', revision: 0, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', title: 'Ejemplo', communication: { instructions: '' },
      variables: [{ ...variable, value: 1 }], blocks: [{ id: 'shader', typeId: 'note', title: 'Shader', data: {}, parentGroupId: scopeId === 'group' ? 'group' : undefined }, { id: 'control', typeId: 'controls', title: 'Control', data: {}, parentGroupId: scopeId === 'group' ? 'group' : undefined }],
      groups: scopeId === 'group' ? [{ id: 'group', title: 'Grupo', blockIds: ['shader', 'control'], variables: [variable] }] : [],
    });
    let requests = 0; const store = new LearningRuntimeStore(async () => { requests++; return await new Promise(() => {}); }, () => {}); store.sync(doc, 0, { blocks: {}, scopes: {} });
    const h = harness(), p = fakeGL();
    const scopeFor = (id: string): RendererProps['scope'] => { const variables = resolveScope(doc, id, store.getSnapshot()), values = Object.fromEntries(Object.entries(variables).map(([name, v]) => [name, v.current])); return { variables, values, get: name => values[name] ?? NaN, set: (name, value) => store.setVariable(id, name, value) }; };
    h.props.scope = scopeFor('shader'); const a = adapter(h, p);
    try {
      a.show(true); a.frame(); const node = a.render(), shaderControl = find(node, WebRange); assert.equal(shaderControl.props.max, 24); assert.equal(shaderControl.props.step, .5);
      const sibling = run([], () => (controlsRenderer.Component as Function)({ ...h.props, block: { id: 'control' }, scope: scopeFor('control'), data: { question: '¿Qué cambia?', variables: ['frequency'] } }) as Element);
      for (const value of [20, 2, 18]) { find(sibling, WebRange).props.onChange(value); h.props.scope = scopeFor('shader'); a.render(); a.frame(); assert.deepEqual(p.uniforms.frequency, [value]); assert.equal(requests, 0); }
      void store.flush(); assert.equal(requests, 1);
      shaderControl.props.onChange(22); h.props.scope = scopeFor('shader'); a.render(); a.frame(); assert.deepEqual(p.uniforms.frequency, [22]); assert.equal(h.events.length, 0);
      button(a.render(), 'Reset').props.onPress(); assert.equal(store.getSnapshot().scopes[scopeId].frequency, 22); assert.equal(h.scopeWrites.length, 0);
      shaderControl.props.onSettle(23); assert.equal(h.events.at(-1)![1].value, 23); assert.equal(h.events.at(-1)![1].scopeId, scopeId);
    } finally { a.close(); store.reset(); }
    p.assertFreed();
  }
});

test('time starts by a play gesture, pauses offscreen/tab, resumes when back unless the person paused, no RAF noise', () => {
  const h = harness(timed()), p = fakeGL(), a = adapter(h, p);
  const near = (want: number) => assert.ok(Math.abs(p.uniforms.u_time[0] - want) < 1e-9, `u_time ${p.uniforms.u_time} != ${want}`);
  try {
    a.show(true); a.render(); a.frame(1000); a.render(); a.frame(2000); assert.deepEqual(p.uniforms.u_time, [0]); assert.equal(h.events.length, 0);
    button(a.render(), 'Play').props.onPress(); a.render(); a.frame(3000); a.frame(3100); a.frame(3200); near(.2); assert.equal(h.writes.length, 0); assert.equal(h.events.length, 0);
    a.show(false); assert.equal(h.events.length, 1); assert.equal(h.events[0][1].time, .2); assert.equal(h.events[0][1].reason, 'out of view'); assert.deepEqual(h.events[0][1].visited, [0, .2]); assert.equal(a.frames.size, 0);
    // Back in view: it was playing, so it plays again on its own, from where it stopped.
    a.show(true); a.render(); assert.equal(find(a.render(), GLSurface).props.animated, true); assert.ok(button(a.render(), 'Pause'));
    a.frame(10000); near(.2); a.frame(10100); near(.3); a.hideTab(true); assert.equal(h.events.length, 2);
    a.hideTab(false); a.render(); a.frame(20000); a.frame(20100); near(.4);
    button(a.render(), 'Pause').props.onPress(); assert.equal(h.events.length, 3); assert.equal(h.events[2][1].reason, 'paused by the person');
    // Paused by the person: leaving and coming back keeps it still, and records nothing more.
    a.show(false); a.show(true); a.render(); a.frame(30000); a.frame(30100); near(.4); assert.equal(find(a.render(), GLSurface).props.animated, false); assert.ok(button(a.render(), 'Play'));
  } finally { a.close(); }
  assert.equal(h.events.length, 3); assert.equal(h.events.at(-1)![0], 'glsl-shader.pause'); p.assertFreed();
});

test('visibility cleanup plus core dispose, context restoration, recompilation and unmount free each resource once', () => {
  const h = harness(timed()), p = fakeGL(), a = adapter(h, p);
  try {
    a.show(true); a.render(); a.frame(); button(a.render(), 'Play').props.onPress(); a.render(); a.frame(100); a.frame(200);
    a.lost(); assert.equal(a.frames.size, 0); assert.equal(h.events.length, 1); p.assertFreed();
    // A lost context is not the person's pause: once it is restored, time runs on from where it stopped.
    a.restored(); a.render(); a.frame(300); assert.equal(find(a.render(), GLSurface).props.animated, true); assert.deepEqual(p.uniforms.u_time, [.1]);
    a.frame(350); assert.ok(Math.abs(p.uniforms.u_time[0] - .15) < 1e-9);
    const initializer = find(a.render(), GLSurface).props.initialize, losses = p.settings.lost, programs = p.created.program.length;
    h.props.data = timed(); h.props.data.fragmentSource += '\n// recompiled'; a.render(); a.frame(400);
    assert.equal(find(a.render(), GLSurface).props.initialize, initializer); assert.equal(p.settings.lost, losses); assert.equal(p.created.program.length, programs + 1);
    a.show(false); p.assertFreed(); a.show(true); a.render(); a.frame(500); assert.ok(p.created.program.length >= 4);
  } finally { a.close(); }
  p.assertFreed();
});

test('physical resolution honors default 512 and explicit 1024, even under DPR 3', () => {
  for (const cap of [512, 1024]) {
    const h = harness(base({ maxPixelSize: cap })), p = fakeGL(), a = adapter(h, p);
    try { a.show(true); a.frame(); assert.equal(a.canvas.width, cap); assert.deepEqual(p.uniforms.u_resolution, [cap, Math.round(cap * 225 / 400)]); } finally { a.close(); }
    p.assertFreed();
  }
});

test('no WebGL and native fallback are honest, controls/reset remain visible and readOnly callbacks cannot write', () => {
  const h = harness(), p = fakeGL(), a = adapter(h, p, false);
  try { const node = a.render(); assert.match(text(node), /WebGL is not available/); assert.match(text(node), /a picture drawn by a shader/); assert.ok(find(node, WebRange)); assert.ok(button(node, 'Reset')); assert.equal(p.created.program.length, 0); } finally { a.close(); }
  const frozen = harness(timed(), true), node = frozen.render();
  // Watching is not editing: Play stays available read-only and keeps its time local; Reset and sliders cannot write.
  for (const control of all(node).filter(n => n.type === Button)) { assert.equal(control.props.disabled, control.props.label !== 'Play', control.props.label); control.props.onPress(); }
  assert.ok(button(frozen.render(), 'Pause'), 'read-only Play still runs the clock');
  const range = find(node, WebRange); assert.equal(range.props.disabled, true); range.props.onChange(10); range.props.onSettle(10); assert.equal(frozen.writes.length, 0); assert.equal(frozen.events.length, 0); frozen.close();
  const native = harness(base(), false, 'ios'), fallback = native.render(); assert.match(text(fallback), /Static/); assert.ok(find(fallback, NativeLearningFallback)); assert.equal(find(fallback, GLSurface), undefined); assert.equal(button(fallback, 'Reset').props.disabled, true);
  button(fallback, 'Reset').props.onPress(); assert.equal(native.writes.length, 0); native.close(); Platform.OS = 'web';
});

test('reset returns locals and time to defaults, preserves authored data, and no button asks the agent for anything', async () => {
  const h = harness(timed()), p = fakeGL(), a = adapter(h, p), authored = JSON.stringify(h.props.data);
  try {
    a.show(true); a.render(); a.frame(); find(a.render(), WebRange).props.onChange(10); a.render(); a.frame();
    button(a.render(), 'Play').props.onPress(); a.render(); a.frame(100); a.frame(200);
    button(a.render(), 'Reset').props.onPress(); a.render(); a.frame(300); assert.deepEqual(p.uniforms.frequency, [4]); assert.deepEqual(p.uniforms.u_time, [0]); assert.equal(find(a.render(), GLSurface).props.animated, false);
    assert.deepEqual(h.events.map(e => e[0]), ['glsl-shader.reset']); assert.equal(JSON.stringify(h.props.data), authored);
    assert.ok(!text(a.render()).includes('Ask for a hint'));
    h.props.runtime.record = async () => { throw new Error('/private/transport/path'); };
    find(a.render(), WebRange).props.onSettle(6); await Promise.resolve(); await Promise.resolve(); assert.match(text(a.render()), /The setting could not be saved/); assert.ok(!text(a.render()).includes('/private'));
  } finally { a.close(); }
  p.assertFreed();
});

test('reset recovers a transient draw failure and never leaves playback running after a failed frame', () => {
  const h = harness(timed()), p = fakeGL(), a = adapter(h, p);
  try {
    a.show(true); a.render(); a.frame(); button(a.render(), 'Play').props.onPress(); a.render();
    const working = p.gl.drawArrays; p.gl.drawArrays = () => { throw new Error('/private/GPU/path'); };
    a.frame(100); assert.match(text(a.render()), /The shader could not be drawn/); assert.ok(!text(a.render()).includes('/private'));
    assert.equal(find(a.render(), GLSurface).props.animated, false); p.assertFreed();
    p.gl.drawArrays = working; button(a.render(), 'Reset').props.onPress(); a.render(); a.show(true); a.frame(200);
    assert.ok(!text(a.render()).includes('could not be drawn')); assert.ok(p.settings.draws > 1); assert.deepEqual(p.uniforms.u_time, [0]);
  } finally { a.close(); }
  p.assertFreed();
});

test('Play pressed before the picture is drawable runs once drawn; manual pause settles once; readOnly does not stop playback', () => {
  const h = harness(timed()), p = fakeGL(), a = adapter(h, p);
  try {
    button(a.render(), 'Play').props.onPress(); assert.equal(find(a.render(), GLSurface).props.animated, true, 'the wish to play is kept');
    assert.equal(p.uniforms.u_time, undefined, 'nothing drawn off screen');
    a.show(true); a.render(); a.frame(0); a.frame(100); a.frame(200); assert.ok(Math.abs(p.uniforms.u_time[0] - .2) < 1e-9);
    button(a.render(), 'Pause').props.onPress(); assert.equal(h.events.length, 1); assert.equal(h.events[0][1].reason, 'paused by the person');
    a.render(); a.frame(10000); assert.ok(Math.abs(p.uniforms.u_time[0] - .2) < 1e-9);
    button(a.render(), 'Play').props.onPress(); a.render(); a.frame(10100); a.frame(10200); h.props.readOnly = true; a.render(); a.frame(10300);
    assert.equal(h.events.length, 1, 'no "read only" pause'); assert.equal(find(a.render(), GLSurface).props.animated, true); assert.ok(Math.abs(p.uniforms.u_time[0] - .4) < 1e-9);
  } finally { a.close(); }
  assert.equal(h.events.length, 1, 'read-only: leaving saves nothing'); p.assertFreed();
});

test('autoplay wish, kept across remounts: the person\'s pause wins; the summary is the block\'s own or a plain line', () => {
  const data = (patch: Record<string, unknown> = {}) => ({ builtins: { resolution: true, time: true }, autoplay: true, ...patch }) as Parameters<typeof glslWantsToPlay>[0];
  assert.equal(glslWantsToPlay(data(), {}, false), true);
  assert.equal(glslWantsToPlay(data(), {}, true), false, 'reduced motion');
  assert.equal(glslWantsToPlay(data({ autoplay: false }), {}, false), false);
  assert.equal(glslWantsToPlay(data({ builtins: { resolution: true, time: false } }), {}, false), false, 'no u_time, nothing to play');
  const paused = (reason: string) => ({ lastInteraction: { kind: 'glsl-shader.pause', label: 'Pause shader', at: '2026-10-19T00:00:00.000Z', payload: { time: 3, reason } } });
  assert.equal(glslWantsToPlay(data(), paused('paused by the person'), false), false);
  assert.equal(glslWantsToPlay(data(), paused('out of view'), false), true);
  assert.equal(glslWantsToPlay(data(), { lastInteraction: 'junk' } as never, false), true);
  assert.equal(glslSummary({ staticSummary: 'Blue rings.' }, 'Rings'), 'Blue rings.');
  assert.match(glslSummary({}, 'Rings'), /^Rings: a picture drawn by a shader/); assert.match(glslSummary({}, '  '), /^Shader:/);
  // A new block is not given a summary or a resolution limit it did not ask for: both are read-time defaults.
  assert.equal('staticSummary' in glslShaderSpec.blockType.defaults, false); assert.equal('maxPixelSize' in glslShaderSpec.blockType.defaults, false);
  assert.match(glslShaderSpec.guidance, /staticSummary is optional/);
});

// ---- Optional chrome (docs/design.md §36.3).
const fresh = (patch: Record<string, unknown> = {}) => glslShaderDataSchema.parse({ ...glslShaderSpec.blockType.defaults, ...patch });
test('chrome: a new shader is the picture alone; a stored block with a question keeps its old face', async () => {
  const { glslChrome } = await import('../plugin/shared/renderers/glsl-shader');
  assert.equal('question' in glslShaderSpec.blockType.defaults, false, 'new blocks start without a question');
  assert.deepEqual(glslChrome(fresh()), { question: '', title: false, controls: 'overlay', reset: false, autoplay: false });
  assert.deepEqual(glslChrome(base()), { question: LEGACY.question, title: false, controls: 'below', reset: true, autoplay: false });
  assert.deepEqual(glslChrome(base({ controls: 'overlay' })), { question: LEGACY.question, title: false, controls: 'overlay', reset: false, autoplay: false }, 'a newer choice opts out of the legacy face');
  assert.deepEqual(glslChrome(fresh({ question: '  ', showTitle: true, controls: 'none', reset: true, autoplay: true })), { question: '', title: true, controls: 'none', reset: true, autoplay: true });
});
test('old shader data loads unchanged: the stored shape of the previous version still parses', () => {
  const stored = { question: 'How does the spacing of the stripes change with the frequency?', fragmentSource: String(glslShaderSpec.blockType.defaults.fragmentSource), uniforms: [{ name: 'frequency', label: 'Frequency', min: 1, max: 12, value: 4, step: 0.1 }], builtins: { resolution: true, time: false }, maxPixelSize: 512, staticSummary: 'Static reference: grey vertical stripes.' };
  assert.deepEqual(glslShaderDataSchema.parse(stored), stored);
  assert.ok(glslShaderDataSchema.safeParse({ fragmentSource: stored.fragmentSource, uniforms: stored.uniforms }).success, 'no question needed');
});
test('a bare shader fills its card: no question, no Reset, a passive full-height surface; controls show on selection', () => {
  const h = harness(fresh()), node = h.render();
  try {
    const surface = find(node, GLSurface); assert.equal(surface.props.passive, true); assert.equal(surface.props.height, '100%');
    assert.equal(button(node, 'Reset'), undefined); assert.equal(find(node, WebRange), undefined, 'sliders wait for selection');
    assert.ok(!text(node).includes('stripes'));
    (h.props as any).selection = ['shader'];
    const picked = h.render(); assert.ok(find(picked, WebRange), 'selected: the overlay shows the sliders');
    assert.ok(all(picked).some(n => n.props.nativeID === 'lienzo-shader-shader-overlay'));
  } finally { h.close(); }
  const none = harness(fresh({ controls: 'none' })); (none.props as any).selection = ['shader'];
  try { assert.equal(find(none.render(), WebRange), undefined); } finally { none.close(); }
  const below = harness(fresh({ controls: 'below', reset: true }));
  try { const node = below.render(); assert.ok(find(node, WebRange)); assert.ok(button(node, 'Reset')); } finally { below.close(); }
  const titled = harness(fresh({ showTitle: true })); (titled.props as any).block = { id: 'shader', title: 'Plasma' };
  try { assert.match(text(titled.render()), /Plasma/); } finally { titled.close(); }
  const untitled = harness(fresh()); (untitled.props as any).block = { id: 'shader', title: 'Plasma' };
  try { assert.ok(!text(untitled.render()).includes('Plasma'), 'the title shows only when asked'); } finally { untitled.close(); }
});
test('a timed bare shader offers Play over the picture; autoplay starts it in view, but not under reduced motion', () => {
  const timedFresh = (patch: Record<string, unknown> = {}) => fresh({ builtins: { resolution: true, time: true }, fragmentSource: String(glslShaderSpec.blockType.defaults.fragmentSource).replace('void main()', 'uniform float u_time;\nvoid main()'), ...patch });
  { const h = harness(timedFresh()), p = fakeGL(), a = adapter(h, p);
    try { a.show(true); a.frame(); const node = a.render(); assert.ok(button(node, 'Play')); assert.equal(find(node, WebRange), undefined); } finally { a.close(); } p.assertFreed(); }
  { const h = harness(timedFresh({ autoplay: true })), p = fakeGL(), a = adapter(h, p);
    try { a.show(true); a.frame(); a.render(); a.frame(16); const node = a.render(); assert.equal(button(node, 'Play'), undefined, 'playing'); assert.ok(!all(node).some(n => n.props.nativeID === 'lienzo-shader-shader-overlay'), 'a playing, unselected shader is the picture alone'); } finally { a.close(); } p.assertFreed(); }
  const globals = globalThis as any, old = globals.matchMedia; globals.matchMedia = () => ({ matches: true });
  { const h = harness(timedFresh({ autoplay: true })), p = fakeGL(), a = adapter(h, p);
    try { a.show(true); a.frame(); assert.ok(button(a.render(), 'Play'), 'reduced motion: waits for the person'); } finally { a.close(); globals.matchMedia = old; } p.assertFreed(); }
});
