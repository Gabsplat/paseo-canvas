import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import {
  stepSequencerDataSchema, stepSequencerSpec, degreeMidi, midiFrequency, sequencerRows, sequencerState, toggleCell, sequencerSummary, sequencerDescription, sequencerHeard, scaleName, stepSeconds,
  type StepSequencerData,
} from '../plugin/shared/renderers/step-sequencer';
import { createSequencer, SEQUENCER_AUDIO, type StepAudioPort } from '../plugin/client/sequencer-audio';
import type { RendererProps } from '../plugin/client/renderers/types';
import { LearningRuntimeStore } from '../plugin/client/learning-state';
import { documentSchema } from '../plugin/shared/model';

// Retained hook slots with dependency-aware effects and cleanup. Only React, React Native and the
// UI kit are replaced: schema, scheduler, the web.ts audio adapter and the renderer are real code.
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
export function useSyncExternalStore<T>(_subscribe: unknown, get: () => T) { return get(); }
export const Fragment = 'fragment';
export const jsx = (type: unknown, props: Record<string, unknown>) => ({ type, props });
export const jsxs = jsx;
export const Platform = { OS: 'web' };
export const View = 'View', Pressable = 'Pressable', Txt = 'Txt', Button = 'Button', Chip = 'Chip';
export default { createElement };
registerHooks({ resolve(specifier, context, nextResolve) {
  if (['react', 'react/jsx-runtime', 'react-native'].includes(specifier) || (specifier.endsWith('/ui') && context.parentURL?.includes('/plugin/client/'))) return { url: new URL('./step-sequencer.test.ts', `file://${__filename}`).href, shortCircuit: true };
  return nextResolve(specifier, context);
} });
const { stepSequencerRenderer, sequencerCellWidth } = require('../plugin/client/renderers/step-sequencer') as typeof import('../plugin/client/renderers/step-sequencer');
const { openStepAudio, attachGridKeys, STEP_AUDIO, WebRange } = require('../plugin/client/web') as typeof import('../plugin/client/web');

const raw = stepSequencerSpec.blockType.defaults;
const base = (patch: Record<string, unknown> = {}) => stepSequencerDataSchema.parse({ ...raw, ...patch });
const four = () => base({ scale: { root: 'A', mode: 'minor', octave: 4 }, rows: [1, 3], steps: 4, stepsPerBeat: 1, tempo: { bpm: 120, min: 60, max: 240 }, pattern: ['x...', '..x.'] });
const all = (node: Element): Element[] => [node, ...(Array.isArray(node.props.children) ? node.props.children.flat(Infinity) : [node.props.children]).filter((value: unknown): value is Element => !!value && typeof value === 'object').flatMap(all)];
const button = (node: Element, label: string) => all(node).find(n => n.type === Button && n.props.label === label);
const cell = (node: Element, row: number, step: number) => all(node).find(n => n.type === Pressable && String(n.props.nativeID).endsWith(`-${row}-${step}`))!;
const text = (node: Element) => all(node).filter(n => n.type === Txt).map(n => Array.isArray(n.props.children) ? n.props.children.flat(Infinity).join('') : String(n.props.children)).join(' | ');
const press = { stopPropagation() {} };
const settleMicrotasks = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

// A scripted browser audio host. It records what the adapter schedules; it produces no sound.
type FakeOscillator = { type: string; frequency: { value?: number; at?: number }; startedAt?: number; stoppedAt?: number; stoppedNow: boolean; connected: boolean; onended: (() => void) | null };
type FakeContext = { currentTime: number; state: string; closed: boolean; oscillators: FakeOscillator[]; gains: { values: [number, number][]; connected: boolean }[]; onstatechange: (() => void) | null; resumes: number };
function browser(options: { resume?: 'ok' | 'reject' | 'never' | 'stays-suspended'; audio?: boolean } = {}) {
  const contexts: FakeContext[] = [], listeners = new Map<string, Set<() => void>>(), observers: { cb(entries: { isIntersecting: boolean }[]): void; disconnected: boolean }[] = [];
  const doc = { hidden: false, body: {}, createElement() { return {}; },
    addEventListener(name: string, listener: () => void) { (listeners.get(name) ?? listeners.set(name, new Set()).get(name)!).add(listener); },
    removeEventListener(name: string, listener: () => void) { listeners.get(name)?.delete(listener); },
    getElementById(id: string) { return { id }; } };
  class AudioContext {
    currentTime = 10; state = 'suspended'; closed = false; oscillators: FakeOscillator[] = []; gains: FakeContext['gains'] = []; onstatechange: (() => void) | null = null; destination = {}; resumes = 0;
    constructor() { contexts.push(this); }
    resume() { this.resumes++; if (options.resume === 'reject') return Promise.reject(new Error('NotAllowedError')); if (options.resume === 'never') return new Promise<void>(() => {}); if (options.resume !== 'stays-suspended') this.state = 'running'; return Promise.resolve(); }
    close() { this.closed = true; this.state = 'closed'; return Promise.resolve(); }
    createGain() { const node = { values: [] as [number, number][], connected: false, gain: { setValueAtTime(v: number, t: number) { node.values.push([v, t]); }, linearRampToValueAtTime(v: number, t: number) { node.values.push([v, t]); } }, connect() { node.connected = true; }, disconnect() { node.connected = false; } }; this.gains.push(node); return node; }
    createOscillator() { const node: FakeOscillator & Record<string, unknown> = { type: 'sine', stoppedNow: false, connected: false, onended: null, frequency: { setValueAtTime(v: number, t: number) { node.frequency.value = v; node.frequency.at = t; } } as FakeOscillator['frequency'],
      start(t: number) { node.startedAt = t; }, stop(t?: number) { if (t === undefined) node.stoppedNow = true; else node.stoppedAt = t; }, connect() { node.connected = true; }, disconnect() { node.connected = false; } }; this.oscillators.push(node); return node; }
  }
  class IntersectionObserver { disconnected = false; constructor(public cb: (entries: { isIntersecting: boolean }[]) => void) { observers.push(this); } observe() {} disconnect() { this.disconnected = true; } }
  const g = globalThis as Record<string, unknown>, prior = { document: g.document, AudioContext: g.AudioContext, IntersectionObserver: g.IntersectionObserver };
  Object.assign(g, { document: doc, AudioContext: options.audio === false ? undefined : AudioContext, IntersectionObserver });
  return { contexts, doc, observers, listeners, emit(name: string) { for (const listener of [...(listeners.get(name) ?? [])]) listener(); }, restore() { Object.assign(g, prior); Platform.OS = 'web'; } };
}
const sounding = (context: FakeContext) => context.oscillators.filter(o => !o.stoppedNow);

function harness(data = base(), options: { readOnly?: boolean; platform?: string; state?: Record<string, unknown> } = {}) {
  const platform = options.platform ?? 'web'; Platform.OS = platform;
  const owned: Host = { slots: [], effects: [], cursor: 0 }, writes: unknown[] = [], events: any[][] = [];
  const props = {
    data, document: { id: 'doc' }, block: { id: 'seq' }, availableWidth: 496, compact: false, readOnly: options.readOnly ?? false,
    ui: { compact: false, layout: { platform }, c: { foreground: '#111', foregroundMuted: '#555', surface2: '#eee', accent: '#246', border: '#ccc', statusDanger: '#933' } },
    runtime: { state: options.state ?? {}, set(state: Record<string, unknown> | null) { writes.push(state); (props.runtime as any).state = state ?? {}; }, flush: async () => {}, settle: async (...args: unknown[]) => { events.push(args); } },
    scope: { variables: {}, values: {}, get: () => NaN, set: () => { throw new Error('Sequencer must not change scope.'); } }, send: async () => { throw new Error('Use settled feedback.'); },
  } as unknown as RendererProps<StepSequencerData>;
  const render = () => { host = owned; host.cursor = 0; const result = (stepSequencerRenderer.Component as Function)(props) as Element; const pending = owned.effects.splice(0); pending.forEach(run => run()); return result; };
  return { props, writes, events, render, unmount() { for (const slot of owned.slots) if (slot && typeof slot === 'object' && 'cleanup' in slot) (slot as Effect).cleanup?.(); } };
}
function clock(t: TestContext) { t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] }); return t.mock.timers; }

test('schema accepts portable defaults and rejects anything outside the bounded declarative grid', () => {
  assert.equal(stepSequencerSpec.id, stepSequencerRenderer.id); assert.ok(base());
  assert.deepEqual(new Set(stepSequencerSpec.blockType.properties.map(p => p.key)), new Set(Object.keys(stepSequencerDataSchema.shape)));
  const row = '.'.repeat(8);
  const invalid: Record<string, unknown>[] = [
    { question: '' }, { autoplay: true }, { script: 'play()' }, { url: 'https://example.com/a.mp3' },
    { rows: [1, 2, 3, 4, 5, 6, 7], pattern: Array(7).fill(row) }, { rows: [1, 1, 2, 3, 4] }, { rows: [0, 2, 3, 4, 5] }, { rows: [16, 2, 3, 4, 5] }, { rows: [1.5, 2, 3, 4, 5] },
    { steps: 17, pattern: Array(5).fill('.'.repeat(17)) }, { steps: 1, pattern: Array(5).fill('.') }, { steps: 6 }, { pattern: Array(4).fill(row) }, { pattern: [...Array(4).fill(row), 'x......o'] },
    { pattern: [...Array(4).fill(row), [0, 1]] }, { stepsPerBeat: 5 }, { stepsPerBeat: 0 },
    { tempo: { bpm: 30, min: 30, max: 100 } }, { tempo: { bpm: 300, min: 60, max: 300 } }, { tempo: { bpm: 50, min: 60, max: 160 } }, { tempo: { bpm: 100, min: 120, max: 80 } }, { tempo: { bpm: 100, min: 60, max: 160, swing: 1 } },
    { scale: { root: 'H', mode: 'major', octave: 4 } }, { scale: { root: 'C', mode: 'lydian', octave: 4 } }, { scale: { root: 'C', mode: 'major', octave: 6 } }, { scale: { root: 'C', mode: 'major', octave: 4, tuning: 432 } },
    { scale: { root: 'B', mode: 'major', octave: 5 }, rows: [15, 4, 3, 2, 1] }, { voice: 'sawtooth' }, { voice: 'https://example.com/sample.wav' }, { labels: 'frequency' },
  ];
  for (const patch of invalid) assert.equal(stepSequencerDataSchema.safeParse({ ...raw, ...patch }).success, false, JSON.stringify(patch));
  const high = stepSequencerDataSchema.safeParse({ ...raw, scale: { root: 'B', mode: 'major', octave: 5 }, rows: [15, 4, 3, 2, 1] });
  assert.ok(!high.success); assert.deepEqual(high.error.issues[0].path, ['rows', 0]);
  assert.ok(base({ rows: [1, 2, 3, 4, 5, 6], steps: 16, pattern: Array(6).fill('x'.repeat(16)) }), 'The largest declared grid stays valid.');
});
test('rows stay inside the declared scale and keep their pitch, name and pattern alignment', () => {
  const major = { root: 'C', mode: 'major', octave: 4 } as const;
  assert.equal(degreeMidi(major, 1), 60); assert.equal(degreeMidi(major, 5), 67); assert.equal(degreeMidi(major, 8), 72); assert.equal(degreeMidi(major, 15), 84);
  assert.equal(degreeMidi({ root: 'C', mode: 'pentatonic-major', octave: 4 }, 6), 72, 'A five-note scale reaches the octave at degree six.');
  assert.equal(midiFrequency(degreeMidi({ root: 'A', mode: 'minor', octave: 4 }, 1)), 440); assert.ok(Math.abs(midiFrequency(60) - 261.6256) < .001);
  assert.equal(scaleName({ root: 'Bb', mode: 'major', octave: 3 }), 'Si♭ mayor'); assert.equal(scaleName({ root: 'F#', mode: 'pentatonic-minor', octave: 3 }), 'Fa♯ pentatónica menor');
  // Declared low-to-high: the display is still highest first, and `index` keeps each row on its own pattern string.
  const rows = sequencerRows(base({ scale: { root: 'Bb', mode: 'major', octave: 3 }, rows: [1, 4, 8], pattern: ['x.......', '.x......', '..x.....'] }));
  assert.deepEqual(rows.map(r => [r.note, r.index, r.degree]), [['Si♭4', 2, 8], ['Mi♭4', 1, 4], ['Si♭3', 0, 1]]);
  assert.deepEqual(sequencerRows(base({ labels: 'degree', rows: [6, 5, 4, 2, 1] })).map(r => r.label), ['1′', '5', '4', '2', '1']);
  for (const mode of ['major', 'minor', 'dorian', 'pentatonic-major', 'pentatonic-minor', 'blues'] as const) {
    const midis = Array.from({ length: 15 }, (_, i) => degreeMidi({ root: 'D', mode, octave: 3 }, i + 1));
    assert.ok(midis.every((midi, i) => i === 0 || midi > midis[i - 1]), `${mode} degrees ascend`);
  }
});
test('runtime state is validated against the authored grid and edits never mutate inputs', () => {
  const data = four();
  assert.deepEqual(sequencerState(data, {}), { pattern: ['x...', '..x.'], bpm: 120 });
  assert.deepEqual(sequencerState(data, { pattern: ['xxxx', '....'], bpm: 90.4 }), { pattern: ['xxxx', '....'], bpm: 90 });
  for (const stale of [{ pattern: ['xxxxx', '.....'] }, { pattern: ['xxxx'] }, { pattern: ['xx!x', '....'] }, { pattern: 'xxxx' }, { pattern: [1, 2] }]) assert.deepEqual(sequencerState(data, stale).pattern, data.pattern, JSON.stringify(stale));
  assert.equal(sequencerState(data, { bpm: 999 }).bpm, 240); assert.equal(sequencerState(data, { bpm: 1 }).bpm, 60); assert.equal(sequencerState(data, { bpm: NaN }).bpm, 120); assert.equal(sequencerState(data, { bpm: '200' }).bpm, 120);
  const before = [...data.pattern], toggled = toggleCell(data.pattern, 1, 0);
  assert.deepEqual(toggled, ['x...', 'x.x.']); assert.deepEqual(data.pattern, before); assert.deepEqual(toggleCell(toggled, 1, 0), before); assert.deepEqual(toggleCell(before, 5, 9), before);
  const summary = sequencerSummary(data, { pattern: toggled, bpm: 150 }, true);
  assert.deepEqual(summary, { scale: 'La menor', bpm: 150, steps: 4, notes: 3, changed: true, heard: true, rows: [{ note: 'Do5', degree: 3, pattern: 'x.x.' }, { note: 'La4', degree: 1, pattern: 'x...' }] });
  assert.equal(sequencerSummary(data, sequencerState(data, {}), false).changed, false);
  assert.ok(Buffer.byteLength(JSON.stringify(sequencerSummary(base({ rows: [1, 2, 3, 4, 5, 6], steps: 16, pattern: Array(6).fill('x'.repeat(16)) }), { pattern: Array(6).fill('x'.repeat(16)), bpm: 240 }, true))) < 1024, 'Settled feedback stays far below the 4 KiB event cap.');
  assert.equal(sequencerDescription(data, sequencerState(data, {})), 'Patrón de 4 pasos a 120 pulsos por minuto, escala de La menor. Do5: paso 3. La4: paso 1.');
});

function fakePort() {
  const notes: { frequency: number; at: number; duration: number }[] = [];
  const state = { time: 0, running: true, closed: false };
  const port: StepAudioPort = { now: () => state.time, running: () => state.running, note(frequency, at, duration) { notes.push({ frequency, at, duration }); return true; }, close() { state.closed = true; } };
  let tick: (() => void) | null = null, cancelled = 0;
  return { port, notes, state, timers: { every(run: () => void) { tick = run; return 1; }, cancel() { tick = null; cancelled++; } }, get cancelled() { return cancelled; }, get ticking() { return tick !== null; },
    advance(seconds: number) { for (let t = 0; t < seconds - 1e-9; t += .025) { state.time = Math.round((state.time + .025) * 1000) / 1000; tick?.(); } } };
}
test('the scheduler plays the pattern on the audio clock, hears live edits and tempo, and never bursts', () => {
  const fake = fakePort(), steps: number[] = [];
  const frame = { frequencies: [440, 660], pattern: ['x...', '..x.'], steps: 4, stepSeconds: .5 };
  const engine = createSequencer({ port: fake.port, read: () => frame, onStep: step => steps.push(step), onStall: () => assert.fail('The port is running.'), timers: fake.timers });
  engine.start(); engine.start();
  assert.deepEqual(fake.notes.map(n => [n.frequency, n.at]), [[440, SEQUENCER_AUDIO.lead]], 'Only the first step is inside the lookahead.');
  fake.advance(2);
  assert.deepEqual(fake.notes.map(n => [n.frequency, Math.round((n.at - SEQUENCER_AUDIO.lead) * 1000) / 1000]), [[440, 0], [660, 1], [440, 2]], 'Row and step decide pitch and time; silent cells schedule nothing.');
  assert.ok(fake.notes.every(n => n.duration === SEQUENCER_AUDIO.maxNote), 'A slow step still gets a short note.');
  assert.deepEqual(steps, [0, 1, 2, 3]); assert.equal(engine.played, 4);
  // An edit and a faster tempo are heard from the next scheduled step, without restarting.
  frame.pattern = ['xxxx', '....']; frame.stepSeconds = .1; fake.notes.length = 0;
  fake.advance(1.5);
  assert.ok(fake.notes.length >= 4 && fake.notes.every(n => n.frequency === 440)); assert.ok(fake.notes.every(n => Math.abs(n.duration - .09) < 1e-9), 'Notes shorten with the step instead of overlapping.');
  const spacing = fake.notes.slice(1).map((n, i) => Math.round((n.at - fake.notes[i].at) * 1000) / 1000); assert.ok(spacing.slice(1).every(value => value === .1), JSON.stringify(spacing));
  // A throttled tab timer resumes from now: nothing is scheduled in the past and at most a few steps per tick.
  fake.notes.length = 0; fake.state.time += 30; fake.advance(.025);
  assert.ok(fake.notes.length <= SEQUENCER_AUDIO.maxStepsPerTick, String(fake.notes.length)); assert.ok(fake.notes.every(n => n.at >= fake.state.time));
  engine.stop(); assert.equal(engine.playing, false); assert.equal(fake.ticking, false);
  const count = fake.notes.length, shown = steps.length; fake.advance(1); assert.equal(fake.notes.length, count); assert.equal(steps.length, shown, 'A stopped engine schedules and reports nothing.');
});
test('the scheduler stops itself when the audio context is no longer running', () => {
  const fake = fakePort(); let stalled = 0;
  const engine = createSequencer({ port: fake.port, read: () => ({ frequencies: [440], pattern: ['xx'], steps: 2, stepSeconds: .25 }), onStep() {}, onStall: () => { stalled++; }, timers: fake.timers });
  engine.start(); fake.advance(.5); fake.state.running = false; const count = fake.notes.length;
  fake.advance(.5);
  assert.equal(stalled, 1); assert.equal(engine.playing, false); assert.equal(fake.notes.length, count); assert.equal(fake.cancelled, 1);
});

test('the audio adapter is inert on native and honest when the browser has no Web Audio', t => {
  const fake = browser(); t.after(fake.restore);
  Platform.OS = 'ios';
  assert.deepEqual(openStepAudio({ voice: 'sine', onInterrupt() {} }), { error: 'unsupported' }); assert.equal(fake.contexts.length, 0, 'Native never constructs a context, even if a global exists.');
  fake.restore(); const none = browser({ audio: false }); t.after(none.restore);
  assert.deepEqual(openStepAudio({ voice: 'sine', onInterrupt() {} }), { error: 'unsupported' });
});
test('the audio adapter bounds gain, note length, pitch and voices, and closing silences everything at once', async t => {
  const fake = browser(); t.after(fake.restore); clock(t);
  const opened = openStepAudio({ voice: 'triangle', elementId: 'grid', onInterrupt: () => assert.fail('Not interrupted.') });
  assert.ok('port' in opened); const context = fake.contexts[0];
  assert.equal(context.resumes, 1, 'Activation is requested synchronously, inside the press.'); assert.equal(await opened.ready, true);
  assert.deepEqual(context.gains[0].values, [[STEP_AUDIO.master, 10]]); assert.ok(STEP_AUDIO.master * STEP_AUDIO.peak.triangle * 6 < 1, 'Six simultaneous rows cannot clip.');
  assert.equal(opened.port.note(440, 10.5, 5), true);
  const [voice] = context.oscillators, envelope = context.gains[1];
  assert.equal(voice.type, 'triangle'); assert.equal(voice.frequency.value, 440); assert.equal(voice.startedAt, 10.5); assert.ok(voice.stoppedAt! <= 10.5 + STEP_AUDIO.maxNote + .011, 'A long request is cut to the note cap.');
  assert.equal(envelope.values[0][0], 0); assert.equal(Math.max(...envelope.values.map(v => v[0])), STEP_AUDIO.peak.triangle); assert.deepEqual(envelope.values.at(-1), [0, 10.5 + STEP_AUDIO.maxNote]);
  for (const bad of [NaN, 0, 10, 20000, Infinity]) assert.equal(opened.port.note(bad, 11, .1), false, String(bad));
  assert.equal(opened.port.note(440, 11, 0), false); assert.equal(opened.port.note(440, 11, NaN), false);
  assert.equal(opened.port.note(440, 1, .1), true); assert.equal(context.oscillators[1].startedAt, 10, 'A late note starts now, never in the past.');
  for (let i = 0; i < 40; i++) opened.port.note(330, 11, .2);
  assert.equal(context.oscillators.length, STEP_AUDIO.maxVoices); assert.equal(opened.port.note(330, 11, .2), false, 'The voice cap drops extra notes.');
  context.oscillators[0].onended!(); assert.equal(opened.port.note(330, 11, .2), true, 'A finished voice frees its slot.');
  opened.port.close(); opened.port.close();
  assert.equal(context.closed, true); assert.equal(sounding(context).length, 1, 'Only the voice that already ended is left alone.'); assert.equal(context.gains[0].connected, false);
  assert.equal(opened.port.running(), false); assert.equal(opened.port.note(440, 12, .1), false); assert.equal(fake.listeners.get('visibilitychange')!.size, 0); assert.equal(fake.observers[0].disconnected, true);
});
test('refused or stalled activation resolves false with the context already released', async t => {
  for (const resume of ['reject', 'stays-suspended', 'never'] as const) {
    const fake = browser({ resume }), timers = clock(t);
    const opened = openStepAudio({ voice: 'sine', onInterrupt: () => assert.fail('A failed start is reported through ready, not as an interruption.') });
    assert.ok('port' in opened);
    if (resume === 'never') { await settleMicrotasks(); assert.equal(fake.contexts[0].closed, false); timers.tick(STEP_AUDIO.activationMs); }
    assert.equal(await opened.ready, false, resume); assert.equal(fake.contexts[0].closed, true, resume); assert.equal(opened.port.note(440, 11, .1), false);
    t.mock.timers.reset(); fake.restore();
  }
});
test('a hidden tab, an offscreen grid, a suspended context and a second player each stop the first one', async t => {
  const fake = browser(); t.after(fake.restore); clock(t);
  const open = async () => { const reasons: string[] = [], opened = openStepAudio({ voice: 'sine', elementId: 'grid', onInterrupt: reason => reasons.push(reason) }); assert.ok('port' in opened); await opened.ready; opened.port.note(440, 11, .3); return { reasons, opened, context: fake.contexts.at(-1)! }; };
  const hidden = await open(); fake.doc.hidden = true; fake.emit('visibilitychange'); fake.emit('visibilitychange'); fake.doc.hidden = false;
  assert.deepEqual(hidden.reasons, ['hidden']); assert.equal(hidden.context.closed, true); assert.equal(sounding(hidden.context).length, 0);
  const offscreen = await open(); fake.observers.at(-1)!.cb([{ isIntersecting: true }]); assert.deepEqual(offscreen.reasons, []); fake.observers.at(-1)!.cb([{ isIntersecting: false }]);
  assert.deepEqual(offscreen.reasons, ['hidden']); assert.equal(offscreen.context.closed, true);
  const suspended = await open(); suspended.context.state = 'interrupted'; suspended.context.onstatechange!();
  assert.deepEqual(suspended.reasons, ['suspended']); assert.equal(suspended.context.closed, true); assert.equal(sounding(suspended.context).length, 0);
  const first = await open(), second = await open();
  assert.deepEqual(first.reasons, ['replaced']); assert.equal(first.context.closed, true); assert.equal(second.context.closed, false); assert.deepEqual(second.reasons, []);
  assert.equal(fake.contexts.filter(c => !c.closed).length, 1, 'One live context across the plugin.');
  second.opened.port.close();
});
test('grid keys are consumed only when the handler used them', () => {
  const fake = browser(); const listeners: ((event: any) => void)[] = [];
  const node = { addEventListener(_: string, l: (event: any) => void) { listeners.push(l); }, removeEventListener() { listeners.length = 0; } };
  const seen: string[] = [], detach = attachGridKeys(node, key => { seen.push(key); return key.startsWith('Arrow'); });
  const send = (key: string, extra = {}) => { const event = { key, ctrlKey: false, metaKey: false, prevented: false, stopped: false, preventDefault() { event.prevented = true; }, stopPropagation() { event.stopped = true; }, ...extra }; listeners[0](event); return event; };
  assert.deepEqual([send('ArrowRight').prevented, send('ArrowRight').stopped, send('a').prevented, send('ArrowLeft', { ctrlKey: true }).prevented], [true, true, false, false]);
  assert.deepEqual(seen, ['ArrowRight', 'ArrowRight', 'a']); detach(); assert.equal(listeners.length, 0); fake.restore();
});

test('mounting never creates audio; a press starts it, and pausing releases it without telling the assistant about beats', async t => {
  const fake = browser(); t.after(fake.restore); const timers = clock(t);
  const h = harness(four()); let view = h.render();
  assert.equal(fake.contexts.length, 0, 'No context before a gesture: nothing can autoplay.'); assert.ok(button(view, 'Reproducir')); assert.equal(button(view, 'Activar sonido'), undefined);
  timers.tick(5000); assert.equal(fake.contexts.length, 0);
  button(view, 'Reproducir')!.props.onPress();
  assert.equal(fake.contexts.length, 1, 'The context is created synchronously inside the press.'); assert.equal(fake.contexts[0].resumes, 1);
  await settleMicrotasks(); view = h.render(); assert.ok(button(view, 'Pausar'));
  const context = fake.contexts[0];
  // Two full cycles of four half-second steps.
  for (let i = 0; i < 160; i++) { context.currentTime += .025; timers.tick(25); }
  view = h.render();
  const pitches = context.oscillators.map(o => Math.round(o.frequency.value!));
  assert.deepEqual(pitches.slice(0, 4), [440, 523, 440, 523], 'La4 on step 1 and Do5 on step 3, repeating.'); assert.match(text(view), /paso \d de 4/);
  assert.equal(h.events.length, 0, 'Playback sends no settled event.'); assert.equal(h.writes.length, 0, 'Playback writes no runtime.');
  button(view, 'Pausar')!.props.onPress(); view = h.render();
  assert.equal(context.closed, true); assert.equal(sounding(context).length, 0, 'Queued notes are stopped, not left to ring out.'); assert.ok(button(view, 'Reproducir')); assert.doesNotMatch(text(view), /paso \d de 4/);
  const scheduled = context.oscillators.length; for (let i = 0; i < 80; i++) { context.currentTime += .025; timers.tick(25); }
  assert.equal(context.oscillators.length, scheduled, 'No timer keeps scheduling after pause.');
  await settleMicrotasks();
  assert.equal(h.events.length, 1, 'Having listened to a full cycle is one settled fact.'); assert.equal(h.events[0][0], 'step-sequencer.pattern'); assert.equal(h.events[0][1].heard, true); assert.equal(h.events[0][1].bpm, 120);
  assert.equal('step' in h.events[0][1] || 'playhead' in h.events[0][1], false);
  // Listening again to the same pattern is not news.
  button(h.render(), 'Reproducir')!.props.onPress(); await settleMicrotasks(); const again = fake.contexts[1];
  for (let i = 0; i < 100; i++) { again.currentTime += .025; timers.tick(25); }
  button(h.render(), 'Pausar')!.props.onPress(); await settleMicrotasks(); assert.equal(h.events.length, 1); assert.equal(again.closed, true);
});
test('edits toggle real cells, persist at once, coalesce into one settled description and are heard while playing', async t => {
  const fake = browser(); t.after(fake.restore); const timers = clock(t);
  const h = harness(four()); let view = h.render();
  assert.equal(cell(view, 0, 0).props.accessibilityLabel, 'La4, paso 1, suena'); assert.equal(cell(view, 1, 0).props.accessibilityLabel, 'Do5, paso 1, en silencio');
  cell(view, 1, 0).props.onPress(press); cell(h.render(), 0, 3).props.onPress(press); view = h.render();
  assert.deepEqual(h.writes, [{ pattern: ['x...', 'x.x.'], bpm: 120 }, { pattern: ['x..x', 'x.x.'], bpm: 120 }], 'Each toggle is stored as learner runtime.');
  assert.equal(cell(view, 1, 0).props.accessibilityState.selected, true); assert.equal(h.events.length, 0, 'Nothing is reported while the learner is still clicking.');
  timers.tick(599); assert.equal(h.events.length, 0); timers.tick(1); await settleMicrotasks();
  assert.equal(h.events.length, 1); assert.deepEqual(h.events[0][1].rows, [{ note: 'Do5', degree: 3, pattern: 'x.x.' }, { note: 'La4', degree: 1, pattern: 'x..x' }]); assert.equal(h.events[0][1].heard, false); assert.equal(h.events[0][1].notes, 4);
  button(h.render(), 'Reproducir')!.props.onPress(); await settleMicrotasks(); const context = fake.contexts[0];
  cell(h.render(), 0, 1).props.onPress(press);
  for (let i = 0; i < 80; i++) { context.currentTime += .025; timers.tick(25); }
  assert.deepEqual(context.oscillators.slice(0, 5).map(o => Math.round(o.frequency.value!)), [440, 523, 440, 523, 440], 'The cell added during playback sounds on step 2 of the same run.');
  assert.equal(h.events.length, 2, 'The edit made while playing settled once.'); h.unmount();
});
test('tempo follows the declared bounds, settles once when released and reset restores the authored exercise', async t => {
  const fake = browser(); t.after(fake.restore); const timers = clock(t);
  const h = harness(four(), { state: { pattern: ['xxxx', 'xxxx'], bpm: 200 } }); let view = h.render();
  const range = () => all(h.render()).find(n => n.type === WebRange)!;
  assert.equal(range().props.value, 200); assert.equal(range().props.min, 60); assert.equal(range().props.max, 240); assert.match(text(view), /200 pulsos por minuto/);
  range().props.onChange(90); range().props.onChange(9999);
  assert.equal(range().props.value, 240, 'A drag cannot leave the declared tempo range.'); assert.equal(h.writes.length, 0, 'Dragging writes nothing.');
  range().props.onSettle(75); await settleMicrotasks();
  assert.deepEqual(h.writes.at(-1), { pattern: ['xxxx', 'xxxx'], bpm: 75 }); assert.equal(h.events.length, 1); assert.equal(h.events[0][1].bpm, 75);
  button(h.render(), 'Reproducir')!.props.onPress(); await settleMicrotasks();
  button(h.render(), 'Reiniciar')!.props.onPress(); await settleMicrotasks(); view = h.render();
  assert.equal(fake.contexts[0].closed, true, 'Reset stops the sound.'); assert.equal(h.writes.at(-1), null);
  assert.equal(h.events.at(-1)![0], 'step-sequencer.reset'); assert.deepEqual(h.events.at(-1)![1].rows.map((r: { pattern: string }) => r.pattern), ['..x.', 'x...']); assert.equal(h.events.at(-1)![1].changed, false);
  assert.equal(cell(view, 1, 0).props.accessibilityState.selected, false); assert.match(text(view), /120 pulsos por minuto/);
  timers.tick(5000); assert.equal(h.events.length, 2);
  assert.equal(all(harness(base({ tempo: { bpm: 100, min: 100, max: 100 } })).render()).some(n => n.type === WebRange), false, 'A fixed tempo shows no slider.');
});
test('leaving the block, the document or edit rights silences audio immediately', async t => {
  const fake = browser(); t.after(fake.restore); const timers = clock(t);
  const start = async (h: ReturnType<typeof harness>) => { button(h.render(), 'Reproducir')!.props.onPress(); await settleMicrotasks(); const context = fake.contexts.at(-1)!; for (let i = 0; i < 20; i++) { context.currentTime += .025; timers.tick(25); } assert.ok(sounding(context).length > 0); return context; };
  const after = (context: FakeContext, why: string) => { assert.equal(context.closed, true, why); assert.equal(sounding(context).length, 0, why); const count = context.oscillators.length; for (let i = 0; i < 40; i++) { context.currentTime += .025; timers.tick(25); } assert.equal(context.oscillators.length, count, why); };
  const unmounted = harness(four()); const a = await start(unmounted); unmounted.unmount(); after(a, 'unmount');
  const switched = harness(four()); const b = await start(switched); (switched.props as any).document = { id: 'other' }; switched.render(); after(b, 'document change'); assert.ok(button(switched.render(), 'Reproducir'));
  const locked = harness(four()); const c = await start(locked); (locked.props as any).readOnly = true; const view = locked.render(); after(c, 'read only');
  assert.equal(button(locked.render(), 'Reproducir')!.props.disabled, true); assert.equal(cell(view, 0, 0).props.disabled, true);
  const hidden = harness(four()); const d = await start(hidden); fake.doc.hidden = true; fake.emit('visibilitychange'); fake.doc.hidden = false; after(d, 'hidden tab'); assert.ok(button(hidden.render(), 'Reproducir'));
  // A press whose activation resolves after the block is gone must not start anything.
  const late = harness(four()); button(late.render(), 'Reproducir')!.props.onPress(); late.unmount(); await settleMicrotasks(); after(fake.contexts.at(-1)!, 'unmount before activation');
  assert.equal(fake.contexts.filter(context => !context.closed).length, 0);
  assert.deepEqual([unmounted, switched, locked, hidden, late].flatMap(h => h.events), [], 'A stop is not an assistant event.');
});
test('blocked or missing audio is stated plainly, keeps the grid editable and can be retried', async t => {
  const blocked = browser({ resume: 'reject' }); clock(t);
  const h = harness(four()); button(h.render(), 'Reproducir')!.props.onPress(); await settleMicrotasks(); let view = h.render();
  assert.match(text(view), /No se pudo activar el sonido/); assert.ok(button(view, 'Activar sonido')); assert.equal(button(view, 'Reproducir'), undefined, 'One primary action: retry.'); assert.equal(blocked.contexts[0].closed, true);
  cell(view, 1, 1).props.onPress(press); assert.deepEqual(h.writes.at(-1), { pattern: ['x...', '.xx.'], bpm: 120 }, 'The grid still works without sound.');
  blocked.restore(); const working = browser();
  button(h.render(), 'Activar sonido')!.props.onPress(); await settleMicrotasks(); view = h.render();
  assert.doesNotMatch(text(view), /No se pudo activar/); assert.ok(button(view, 'Pausar')); assert.equal(working.contexts.length, 1);
  working.contexts[0].state = 'suspended'; working.contexts[0].onstatechange!(); view = h.render();
  assert.match(text(view), /El sonido se detuvo/); assert.ok(button(view, 'Activar sonido')); assert.equal(working.contexts[0].closed, true);
  h.unmount(); working.restore(); t.mock.timers.reset();
  const none = browser({ audio: false }); t.after(none.restore);
  const silent = harness(four()); button(silent.render(), 'Reproducir')!.props.onPress(); view = silent.render();
  assert.match(text(view), /Este navegador no ofrece audio/); assert.equal(button(view, 'Reproducir')!.props.disabled, true); assert.equal(cell(view, 0, 0).props.disabled, false);
});
test('native shows the labelled pattern as static and never reaches for audio', t => {
  const fake = browser(); t.after(fake.restore);
  const h = harness(four(), { platform: 'ios' }), view = h.render();
  assert.match(text(view), /Estático/); assert.match(text(view), /Do5: paso 3\. La4: paso 1\./); assert.match(text(view), /Aquí no se reproduce audio/);
  assert.deepEqual(all(view).filter(n => n.type === Txt && n.props.kind === 'code').map(n => n.props.children).slice(0, 2), ['Do5', 'La4']);
  assert.equal(all(view).filter(n => n.type === Pressable).length, 8); assert.ok(all(view).filter(n => n.type === Pressable).every(n => n.props.disabled));
  assert.equal(all(view).some(n => n.type === WebRange), false);
  button(view, 'Reproducir')!.props.onPress(); cell(view, 0, 0).props.onPress(press); button(view, 'Reiniciar')!.props.onPress();
  assert.equal(fake.contexts.length, 0); assert.equal(h.writes.length, 0); assert.equal(h.events.length, 0);
});
test('external runtime changes are adopted, and a stored pattern that no longer fits falls back to the authored one', () => {
  const fake = browser();
  const h = harness(four(), { state: { pattern: ['xxxx', '....'], bpm: 100 } }); let view = h.render();
  assert.equal(cell(view, 0, 3).props.accessibilityState.selected, true);
  (h.props.runtime as any).state = { pattern: ['....', 'xxxx'], bpm: 180 }; view = h.render();
  assert.equal(cell(view, 0, 3).props.accessibilityState.selected, false); assert.equal(cell(view, 1, 3).props.accessibilityState.selected, true); assert.match(text(view), /180 pulsos por minuto/);
  const stale = harness(four(), { state: { pattern: ['xxxxxxxx', '........'], bpm: 100 } }).render();
  assert.equal(cell(stale, 0, 0).props.accessibilityState.selected, true); assert.equal(cell(stale, 0, 1).props.accessibilityState.selected, false);
  assert.equal(sequencerCellWidth(496, 16, 4) * 16 + 44 + 2 + 12 * 2 + 3 * 8 <= 496, true, 'Sixteen steps fit the default card.'); assert.equal(sequencerCellWidth(100, 16, 4), 12);
  assert.equal(stepSeconds(120, 2), .25); fake.restore();
});
test('having listened belongs to the exact music that sounded: a new scale with the same grid must be heard again', async t => {
  const fake = browser(); t.after(fake.restore); const timers = clock(t);
  // The production optimistic runtime store; only its transport is a stand-in that acknowledges writes.
  const doc = documentSchema.parse({ id: 'doc', workspaceId: 'w', revision: 0, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', title: 'Ejemplo', communication: { instructions: '' }, blocks: [{ id: 'seq', typeId: 'note', title: 'Secuenciador de ejemplo', data: {} }], groups: [] });
  let version = 0; const server: Record<string, Record<string, unknown>> = {};
  const store = new LearningRuntimeStore(async request => {
    for (const entry of request.blocks) { if (entry.state) server[entry.id] = entry.state; else delete server[entry.id]; }
    return { runtimeVersion: ++version, runtime: { blocks: structuredClone(server), scopes: {} } } as never;
  }, error => assert.fail(String(error)));
  store.sync(doc, 0, { blocks: {}, scopes: {} });
  const h = harness(four());
  const mount = () => { Object.assign(h.props.runtime, { state: store.getSnapshot().blocks.seq ?? {}, set: (state: Record<string, never> | null, settled?: boolean) => store.setBlock('seq', state, settled) }); return h.render(); };
  const listen = async () => { button(mount(), 'Reproducir')!.props.onPress(); await settleMicrotasks(); const context = fake.contexts.at(-1)!; for (let i = 0; i < 100; i++) { context.currentTime += .025; timers.tick(25); } button(mount(), 'Pausar')!.props.onPress(); await settleMicrotasks(); return context; };
  cell(mount(), 1, 1).props.onPress(press); timers.tick(600); await settleMicrotasks();
  await listen();
  assert.deepEqual(h.events.map(e => [e[1].scale, e[1].heard]), [['La menor', false], ['La menor', true]]);
  const minor = h.props.data, state = sequencerState(minor, store.getSnapshot().blocks.seq);
  assert.deepEqual(state, { pattern: ['x...', '.xx.'], bpm: 120 }); assert.equal(sequencerHeard(minor, state, store.getSnapshot().blocks.seq), true);
  assert.ok(Buffer.byteLength(JSON.stringify(store.getSnapshot().blocks.seq)) < 512, 'The marker is a short bounded string.');
  // The author moves the exercise to another scale; rows, steps, the learner pattern and tempo still fit.
  const major = stepSequencerDataSchema.parse({ ...minor, scale: { root: 'C', mode: 'major', octave: 4 } });
  (h.props as any).data = major; let view = mount();
  assert.equal(cell(view, 1, 1).props.accessibilityState.selected, true, 'The learner pattern is kept.'); assert.equal(sequencerHeard(major, state, store.getSnapshot().blocks.seq), false);
  const context = await listen();
  assert.deepEqual(context.oscillators.slice(0, 3).map(o => Math.round(o.frequency.value!)), [262, 330, 330], 'Do4 and Mi4 sounded this time, not La4 and Do5.');
  assert.deepEqual(h.events.slice(2).map(e => [e[1].scale, e[1].heard, e[1].rows.map((r: { pattern: string }) => r.pattern)]), [['Do mayor', true, ['.xx.', 'x...']]], 'The new music is reported as heard only after it actually played.');
  assert.equal(sequencerHeard(major, state, store.getSnapshot().blocks.seq), true);
  // Voice, subdivision and a legacy boolean marker are all treated as unheard too.
  for (const patch of [{ voice: 'square' }, { stepsPerBeat: 2 }, { rows: [1, 5] }]) assert.equal(sequencerHeard(stepSequencerDataSchema.parse({ ...major, ...patch }), state, store.getSnapshot().blocks.seq), false, JSON.stringify(patch));
  assert.equal(sequencerHeard(major, state, { ...state, heard: true }), false); h.unmount();
});
test('a cycle is credited only to the music whose steps the audio clock actually reached', async t => {
  const fake = browser(); t.after(fake.restore); const timers = clock(t);
  const doc = documentSchema.parse({ id: 'doc', workspaceId: 'w', revision: 0, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', title: 'Ejemplo', communication: { instructions: '' }, blocks: [{ id: 'seq', typeId: 'note', title: 'Secuenciador de ejemplo', data: {} }], groups: [] });
  let version = 0; const server: Record<string, Record<string, unknown>> = {};
  const store = new LearningRuntimeStore(async request => {
    for (const entry of request.blocks) { if (entry.state) server[entry.id] = entry.state; else delete server[entry.id]; }
    return { runtimeVersion: ++version, runtime: { blocks: structuredClone(server), scopes: {} } } as never;
  }, error => assert.fail(String(error)));
  store.sync(doc, 0, { blocks: {}, scopes: {} });
  const h = harness(four()), data = h.props.data;
  const mount = () => { Object.assign(h.props.runtime, { state: store.getSnapshot().blocks.seq ?? {}, set: (state: Record<string, never> | null, settled?: boolean) => store.setBlock('seq', state, settled) }); return h.render(); };
  const stored = () => store.getSnapshot().blocks.seq ?? {}, heard = () => sequencerHeard(data, sequencerState(data, stored()), stored());
  const run = (context: FakeContext, seconds: number) => { for (let t = 0; t < seconds - 1e-9; t += .025) { context.currentTime += .025; timers.tick(25); } };
  const range = () => all(mount()).find(n => n.type === WebRange)!;
  // Pattern A plays for more than a full cycle (four half-second steps), then B is entered and paused at once.
  button(mount(), 'Reproducir')!.props.onPress(); await settleMicrotasks(); let context = fake.contexts.at(-1)!;
  run(context, 2.6);
  cell(mount(), 1, 1).props.onPress(press); button(mount(), 'Pausar')!.props.onPress(); timers.tick(600); await settleMicrotasks();
  assert.deepEqual(sequencerState(data, stored()).pattern, ['x...', '.xx.']); assert.equal(heard(), false, 'B never sounded: A\'s cycle is not B\'s.');
  assert.deepEqual(h.events.map(e => e[1].heard), [false]);
  // B again, but paused before its cycle completes; notes waiting in the lookahead are not credit.
  button(mount(), 'Reproducir')!.props.onPress(); await settleMicrotasks(); context = fake.contexts.at(-1)!;
  run(context, 1); assert.ok(context.oscillators.some(o => o.startedAt! > context.currentTime), 'A note is already queued ahead of the clock.');
  button(mount(), 'Pausar')!.props.onPress(); await settleMicrotasks(); assert.equal(heard(), false, 'Two reached steps and one queued are not a cycle.');
  // A tempo change mid-playback starts the count again for the new tempo.
  button(mount(), 'Reproducir')!.props.onPress(); await settleMicrotasks(); context = fake.contexts.at(-1)!;
  run(context, 2.6); range().props.onChange(240); range().props.onSettle(240); button(mount(), 'Pausar')!.props.onPress(); await settleMicrotasks();
  assert.equal(sequencerState(data, stored()).bpm, 240); assert.equal(heard(), false, 'The faster version was not heard.');
  // Enough of the final pattern and tempo: now, and only now, it is heard. One second covers four quarter-second steps.
  const before = h.events.length;
  button(mount(), 'Reproducir')!.props.onPress(); await settleMicrotasks(); context = fake.contexts.at(-1)!;
  run(context, 1.3); button(mount(), 'Pausar')!.props.onPress(); await settleMicrotasks();
  assert.equal(heard(), true); assert.deepEqual(h.events.slice(before).map(e => [e[1].heard, e[1].bpm, e[1].rows.map((r: { pattern: string }) => r.pattern)]), [[true, 240, ['.xx.', 'x...']]]);
  // An edit made while playing is credited once its own full cycle has passed, without restarting.
  button(mount(), 'Reproducir')!.props.onPress(); await settleMicrotasks(); context = fake.contexts.at(-1)!;
  run(context, .6); cell(mount(), 0, 2).props.onPress(press); run(context, 1.4);
  assert.equal(fake.contexts.filter(c => !c.closed).length, 1, 'Still the same single context.'); assert.equal(heard(), false, 'Nothing is persisted per step while it plays.');
  button(mount(), 'Pausar')!.props.onPress(); await settleMicrotasks();
  assert.deepEqual(sequencerState(data, stored()).pattern, ['x.x.', '.xx.']); assert.equal(heard(), true); h.unmount();
});
