import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import {
  appendPredictionPoint, buildPredictionOutcomeEvent, commitPrediction, createPredictionAttempt, editPrediction,
  getRevealedPredictionOutcome, isPredictionGateRevealed, predictionGateDataSchema, predictionGateRuntimeSchema,
  predictionGateSpec, predictionJSONBytes, readPredictionGateState, resolvePredictionTarget, revealPrediction,
  remapPredictionGateReferences,
  validatePredictionGateReferences, type PredictionGateData, type PredictionGateState, type PredictionPoint,
} from '../plugin/shared/renderers/prediction-gate';
import { reset, updates, type Element } from './fixtures/react-headless';
import { setup, workspaceId } from './helpers';
import type { RendererProps } from '../plugin/client/renderers/types';

// Exercise the actual component, drawing callback and delivery code without a native bridge or browser.
registerHooks({ resolve(specifier, context, nextResolve) {
  if (specifier === 'react' || specifier === 'react/jsx-runtime') return { url: new URL('./fixtures/react-headless.ts', import.meta.url).href, shortCircuit: true };
  if (specifier === 'react-native' || (specifier.endsWith('/ui') && context.parentURL?.includes('/plugin/client/'))) return { url: new URL('./fixtures/native-headless.ts', import.meta.url).href, shortCircuit: true };
  return nextResolve(specifier, context);
} });
const { PredictionGate, predictionGateRenderer, predictionGatePresentation, drawPredictionGateStage, deliverPredictionGateOutcome } =
  require('../plugin/client/renderers/prediction-gate') as typeof import('../plugin/client/renderers/prediction-gate');
const { CanvasSurface, NativeLearningFallback } = require('../plugin/client/Surfaces');
const { WebRange } = require('../plugin/client/web');

const choice = predictionGateDataSchema.parse({ question: '¿Cómo cambia?', targetBlockId: 'c', mode: 'choice',
  options: [{ id: 'up', label: 'Aumenta' }, { id: 'down', label: 'Disminuye' }], outcome: { choiceId: 'up', description: 'RESULTADO_PRIVADO' } });
const numeric = predictionGateDataSchema.parse({ question: '¿Cuánto cambia?', targetBlockId: 'c', mode: 'numeric',
  min: -10, max: 10, unit: 'm', outcome: { value: 7.123, description: 'RESULTADO_PRIVADO' } });
const curve = predictionGateDataSchema.parse({ question: '¿Qué forma tendrá?', targetBlockId: 'c', mode: 'curve',
  axes: { xLabel: 'Tiempo', yLabel: 'Altura', xMin: 0, xMax: 10, yMin: -5, yMax: 10 },
  outcome: { points: [[0, 3.123], [5, 7.123], [10, 9.123]], description: 'RESULTADO_PRIVADO' } });
const doc = Object.freeze({ blocks: Object.freeze([Object.freeze({ id: 'b', typeId: 'prediction-gate' }), Object.freeze({ id: 'c', typeId: 'arbitrary-custom-block' })]) });
const predictionFor = (data: PredictionGateData) => data.mode === 'choice' ? { mode: 'choice' as const, choiceId: 'down' }
  : data.mode === 'numeric' ? { mode: 'numeric' as const, value: 2 }
  : { mode: 'curve' as const, points: [[0, -2], [5, 1], [10, 2]] as PredictionPoint[] };
const prepared = (data: PredictionGateData, id = 'evt_pg_test'): PredictionGateState =>
  commitPrediction(data, editPrediction(data, createPredictionAttempt(data, id), predictionFor(data)));
const descendants = (node: Element): Element[] => [node, ...(Array.isArray(node.props.children) ? node.props.children.flat(Infinity) : [node.props.children])
  .filter((child: unknown): child is Element => !!child && typeof child === 'object' && 'props' in child)
  .flatMap((child: Element) => descendants(child))];
const label = (tree: Element, text: string) => descendants(tree).find(node => node.props.label === text)!;
const text = (tree: Element) => descendants(tree).flatMap(node => [node.props.summary, ...[node.props.children].flat(Infinity).filter(value => typeof value === 'string')]).filter(Boolean).join(' ');
function mount(data: PredictionGateData, initial?: PredictionGateState, overrides: Record<string, unknown> = {}) {
  const writes: unknown[] = [], events: unknown[][] = [], hints: unknown[][] = [];
  const runtime = { state: initial ?? {}, set(value: any) { writes.push(value); runtime.state = value ?? {}; }, flush: async () => {},
    settle: async (...args: unknown[]) => { events.push(args); } };
  const props = { data, document: doc, block: { id: 'b' }, runtime, readOnly: false, availableWidth: 400, compact: false,
    ui: { layout: { platform: 'web' }, c: { statusDanger: '#933', foreground: '#222', foregroundMuted: '#666', surface0: '#fff' }, tone: () => '#639' },
    send: async (...args: unknown[]) => { hints.push(args); }, ...overrides } as unknown as RendererProps<PredictionGateData>;
  return { runtime, writes, events, hints, props, render() { reset(); return PredictionGate(props) as unknown as Element; } };
}
function drawingProbe() {
  const strings: string[] = [], lines: unknown[] = [];
  const context = { clearRect() {}, fillRect() {}, beginPath() {}, moveTo(...args: number[]) { lines.push(args); }, lineTo(...args: number[]) { lines.push(args); },
    stroke() {}, setLineDash(dash: number[]) { lines.push({ dash }); }, fillText(value: string) { strings.push(value); }, arc() {},
  } as any;
  return { context, strings, lines };
}

test('Apuesta schemas accept all three typed modes and catalog defaults without registration', () => {
  for (const data of [choice, numeric, curve]) assert.deepEqual(predictionGateDataSchema.parse(data), data);
  assert.ok(predictionGateDataSchema.safeParse(predictionGateSpec.blockType.defaults).success);
  assert.equal(predictionGateSpec.id, predictionGateRenderer.id);
  assert.equal(predictionGateRenderer.Component, PredictionGate);
  const keys = new Set(predictionGateSpec.blockType.properties.map(property => property.key));
  for (const data of [choice, numeric, curve]) for (const key of Object.keys(data)) assert.ok(keys.has(key));
});
test('Apuesta rejects executable keys, unknown modes, invalid options, nonfinite estimates and curves outside axes', () => {
  for (const invalid of [
    { ...choice, js: 'return 3' }, { ...choice, mode: 'html' }, { ...choice, options: [{ id: 'a', label: 'A' }, { id: 'a', label: 'B' }] },
    { ...choice, outcome: { choiceId: 'missing' } }, { ...choice, options: Array(5).fill({ id: 'a', label: 'A' }) },
    { ...numeric, min: 20 }, { ...numeric, outcome: { value: Infinity } }, { ...numeric, outcome: { value: 11 } },
    { ...curve, axes: { ...(curve as any).axes, xMax: 0 } }, { ...curve, outcome: { points: [[-1, 0], [0, 0]] } },
    { ...curve, outcome: { points: Array(25).fill([0, 0]) } }, { ...curve, outcome: { points: [[0, 0]] } },
  ]) assert.equal(predictionGateDataSchema.safeParse(invalid).success, false);
});
for (const data of [choice, numeric, curve]) {
  test(`${data.mode}: editable draft, frozen commitment, reveal-only outcome and fresh reset`, () => {
    const draft = createPredictionAttempt(data, 'evt_pg_first');
    assert.equal(commitPrediction(data, draft).phase, 'draft');
    assert.equal(getRevealedPredictionOutcome(data, draft, doc, 'b'), null);
    assert.equal(buildPredictionOutcomeEvent(data, draft, doc, 'b'), null);
    const entered = editPrediction(data, draft, predictionFor(data));
    assert.notEqual(entered, draft); assert.equal(draft.prediction, null);
    const committed = commitPrediction(data, entered);
    assert.equal(committed.phase, 'committed');
    assert.equal(editPrediction(data, committed, predictionFor(data)), committed);
    assert.equal(revealPrediction(data, entered, doc, 'b'), entered);
    assert.equal(getRevealedPredictionOutcome(data, committed, doc, 'b'), null);
    const revealed = revealPrediction(data, committed, doc, 'b');
    assert.equal(isPredictionGateRevealed(data, revealed, doc, 'b'), true);
    assert.ok(buildPredictionOutcomeEvent(data, revealed, doc, 'b'));
    assert.equal(editPrediction(data, revealed, predictionFor(data)), revealed);
    const reset = createPredictionAttempt(data, 'evt_pg_second');
    assert.equal(reset.phase, 'draft'); assert.equal(reset.prediction, null); assert.equal(reset.frozenOutcome, null);
    assert.equal(isPredictionGateRevealed(data, reset, doc, 'b'), false);
  });
}
test('targets resolve arbitrary real readonly blocks; missing/deleted/self references never reveal', () => {
  const target = resolvePredictionTarget(doc, 'c', 'b');
  assert.ok(target.valid); assert.equal(target.block, doc.blocks[1]);
  assert.equal(validatePredictionGateReferences(choice, doc, 'b').length, 0);
  assert.equal(resolvePredictionTarget(doc, 'b', 'b').valid, false);
  const missing = { blocks: [{ id: 'b' }] };
  const committed = prepared(choice);
  assert.equal(revealPrediction(choice, committed, missing, 'b'), committed);
  assert.match(validatePredictionGateReferences(choice, missing, 'b')[0], /No se encontró/);
  const revealed = revealPrediction(choice, committed, doc, 'b');
  assert.equal(isPredictionGateRevealed(choice, revealed, missing, 'b'), false);
  assert.equal(getRevealedPredictionOutcome(choice, revealed, missing, 'b'), null);
});
test('reference remapping changes only mapped targets and preserves external refs and authored JSON', () => {
  const original = Object.freeze({ ...choice, otherId: 'c' });
  const remapped = remapPredictionGateReferences(original, new Map([['c', 'copy.c']]));
  assert.equal(remapped.targetBlockId, 'copy.c'); assert.equal(remapped.otherId, 'c');
  assert.equal(remapped.outcome, original.outcome); assert.equal(original.targetBlockId, 'c');
  assert.equal(remapPredictionGateReferences(original, new Map([['external', 'copy.external']])), original);
  assert.equal(remapPredictionGateReferences({ targetBlockId: 3 }, new Map([['3', 'copy.3']])).targetBlockId, 3);
});
test('core visibility hook conceals only the target, including stale or malformed runtime', () => {
  const document = doc as any;
  assert.deepEqual(predictionGateSpec.hiddenTargets(choice, {}, document, 'b'), ['c']);
  assert.deepEqual(predictionGateSpec.hiddenTargets({ ...choice, targetBlockId: 'b' }, {}, document, 'b'), []);
  const revealed = revealPrediction(choice, prepared(choice), doc, 'b');
  assert.deepEqual(predictionGateSpec.hiddenTargets(choice, revealed, document, 'b'), []);
  const changed = { ...choice, question: 'Otra pregunta' };
  assert.equal(readPredictionGateState(changed, revealed), null);
  assert.deepEqual(predictionGateSpec.hiddenTargets(changed, revealed, document, 'b'), ['c']);
  assert.equal(readPredictionGateState(choice, { ...revealed, frozenOutcome: predictionFor(choice) }), null);
  assert.equal(readPredictionGateState(choice, { ...revealed, prediction: { mode: 'numeric', value: 2 } }), null);
  assert.equal(predictionGateRuntimeSchema.safeParse({ ...revealed, phase: 'draft' }).success, false);
});
test('curve recording responds to every point, retains endpoints and stays under runtime/event limits', () => {
  let recorded: PredictionPoint[] = [];
  for (let index = 0; index < 1200; index++) {
    recorded = appendPredictionPoint(recorded, [index / 119.9, Math.sin(index) + 1]);
    assert.ok(recorded.length <= 24); assert.equal(recorded.at(-1)![0], Number((index / 119.9).toPrecision(6)));
  }
  assert.equal(recorded[0][0], 0);
  assert.deepEqual(appendPredictionPoint(recorded, [NaN, 1]), recorded);
  const committed = commitPrediction(curve, editPrediction(curve, createPredictionAttempt(curve, 'evt_pg_long'), { mode: 'curve', points: recorded }));
  const revealed = revealPrediction(curve, committed, doc, 'b');
  assert.equal(revealed.phase, 'revealed');
  for (const value of [revealed, buildPredictionOutcomeEvent(curve, revealed, doc, 'b')]) {
    assert.ok(Buffer.byteLength(JSON.stringify(value)) <= 4096);
    assert.equal(predictionJSONBytes(value), Buffer.byteLength(JSON.stringify(value)));
  }
  const huge = predictionGateDataSchema.parse({ ...(curve as any), axes: { ...(curve as any).axes, xMin: -1e12, xMax: 1e12, yMin: -1e12, yMax: 1e12 },
    outcome: { points: Array.from({ length: 24 }, (_, i) => [-1e-100 * (i + .1234567890123456), 1e-100 * (i + .1234567890123456)]) } });
  const hugeState = revealPrediction(huge, commitPrediction(huge, editPrediction(huge, createPredictionAttempt(huge, 'evt_pg_' + 'a'.repeat(63)),
    { mode: 'curve', points: (huge as any).outcome.points })), doc, 'b');
  assert.ok(predictionJSONBytes(hugeState) <= 4096);
  assert.ok(predictionJSONBytes(buildPredictionOutcomeEvent(huge, hugeState, doc, 'b')) <= 4096);
  assert.equal(predictionGateRuntimeSchema.safeParse({ ...hugeState, attemptId: 'evt_pg_' + 'a'.repeat(64) }).success, false);
  assert.equal(predictionJSONBytes({ text: '😀á\ud800' }), Buffer.byteLength(JSON.stringify({ text: '😀á\ud800' })));
});
test('native fallback retains the question/reset and does not expose a committed outcome', () => {
  for (const data of [choice, numeric, curve]) {
    const h = mount(data, prepared(data), { ui: { layout: { platform: 'ios' }, c: { statusDanger: '#933' } } });
    const tree = h.render(), fallback = descendants(tree).find(node => node.type === NativeLearningFallback)!;
    assert.ok(fallback); assert.ok(text(tree).includes(data.question)); assert.ok(label(tree, 'Reiniciar'));
    assert.equal(descendants(tree).some(node => node.type === CanvasSurface), false);
    assert.equal(text(tree).includes('RESULTADO_PRIVADO'), false);
    assert.ok(fallback.props.summary.includes('permanece oculto'));
    if (data.mode === 'numeric') assert.equal(text(tree).includes('7.123'), false);
    if (data.mode === 'curve') assert.equal(text(tree).includes('9.123'), false);
  }
});
test('actual choice component freezes its input, reveals only on request and emits once on repeated press', async () => {
  const h = mount(choice);
  let tree = h.render();
  assert.equal(label(tree, 'Guardar mi apuesta').props.disabled, true);
  label(tree, 'Disminuye').props.onPress(); tree = h.render();
  assert.equal(label(tree, 'Guardar mi apuesta').props.disabled, false);
  label(tree, 'Guardar mi apuesta').props.onPress(); tree = h.render();
  assert.equal(text(tree).includes('RESULTADO_PRIVADO'), false);
  assert.equal(label(tree, 'Disminuye'), undefined);
  const reveal = label(tree, 'Ver resultado'); reveal.props.onPress(); reveal.props.onPress();
  await new Promise(resolve => setImmediate(resolve)); tree = h.render();
  assert.ok(text(tree).includes('RESULTADO_PRIVADO')); assert.ok(text(tree).includes('son diferentes'));
  assert.equal(h.events.length, 1); assert.equal(h.events[0][0], `prediction-gate.reveal.${(h.runtime.state as PredictionGateState).attemptId}`);
  assert.equal(h.events[0][3], (h.runtime.state as PredictionGateState).attemptId);
  label(tree, 'Reiniciar').props.onPress(); tree = h.render();
  assert.equal(text(tree).includes('RESULTADO_PRIVADO'), false); assert.equal(h.events.length, 1);
  assert.equal((h.runtime.state as PredictionGateState).phase, 'draft');
});
test('actual numeric slider updates locally without events and reveals a signed, unit-labelled comparison', async () => {
  const h = mount(numeric); let tree = h.render();
  let range = descendants(tree).find(node => node.type === WebRange)!;
  for (const value of [-8, 3, 2]) range.props.onChange(value);
  assert.equal((h.runtime.state as PredictionGateState).prediction?.mode, 'numeric');
  assert.equal(h.events.length, 0); tree = h.render();
  assert.equal(text(tree).includes('7.123'), false); assert.ok(text(tree).includes('2 m'));
  const surface = descendants(tree).find(node => node.type === CanvasSurface)!;
  const probe = drawingProbe(); surface.props.draw(probe.context, { width: 400, height: 220 });
  assert.equal(probe.strings.includes('7.123'), false);
  label(tree, 'Guardar mi apuesta').props.onPress(); tree = h.render();
  assert.equal(descendants(tree).some(node => node.type === WebRange), false);
  label(tree, 'Ver resultado').props.onPress(); await new Promise(resolve => setImmediate(resolve)); tree = h.render();
  assert.ok(text(tree).includes('-5.123 m')); assert.equal(h.events.length, 1);
});
test('actual curve pointer handlers update every frame, replace old strokes, freeze and draw dashed/solid comparison', async () => {
  const h = mount(curve); let tree = h.render();
  const surface = descendants(tree).find(node => node.type === CanvasSurface)!;
  surface.props.draw(drawingProbe().context, { width: 400, height: 220 });
  const point = (kind: string, x: number, y: number, pointerId = 1) => surface.props.onPointer({ kind, x, y, pointerId, buttons: 1, pressure: 1 });
  point('down', 44, 160);
  for (let index = 0; index < 180; index++) point('move', 44 + index, 150 - index / 4);
  point('up', 382, 18); assert.equal(h.events.length, 0); assert.ok(h.writes.length >= 182);
  const state = h.runtime.state as PredictionGateState;
  assert.ok(state.prediction?.mode === 'curve'); assert.ok(state.prediction.points.length <= 24);
  const before = h.writes.length; point('move', 80, 80); assert.equal(h.writes.length, before);
  tree = h.render();
  const fresh = descendants(tree).find(node => node.type === CanvasSurface)!;
  fresh.props.onPointer({ kind: 'down', x: 44, y: 160, pointerId: 2 });
  assert.equal((h.runtime.state as any).prediction.points.length, 1);
  fresh.props.onPointer({ kind: 'up', x: 382, y: 18, pointerId: 2 });
  tree = h.render(); label(tree, 'Guardar mi apuesta').props.onPress(); tree = h.render();
  const frozen = descendants(tree).find(node => node.type === CanvasSurface)!;
  assert.equal(frozen.props.onPointer, undefined);
  const presentation = predictionGatePresentation(curve, h.runtime.state as PredictionGateState, doc, 'b');
  assert.deepEqual(presentation.stage!.outcome, []); assert.equal(presentation.description, undefined);
  label(tree, 'Ver resultado').props.onPress(); await new Promise(resolve => setImmediate(resolve)); tree = h.render();
  const revealed = predictionGatePresentation(curve, h.runtime.state as PredictionGateState, doc, 'b');
  assert.deepEqual(revealed.stage!.outcome, (curve as any).outcome.points);
  const probe = drawingProbe(); drawPredictionGateStage(probe.context, { width: 400, height: 220, pixelRatio: 1, time: 0 }, revealed.stage!, { ink: '#222', muted: '#666', prediction: '#639', background: '#fff' });
  assert.ok(probe.lines.some((line: any) => JSON.stringify(line.dash) === '[5,4]'));
  assert.ok(probe.lines.some((line: any) => JSON.stringify(line.dash) === '[]')); assert.equal(h.events.length, 1);
});
test('actual component honors readOnly in controls and handlers, and missing targets have a Spanish error', () => {
  for (const data of [choice, numeric, curve]) {
    const h = mount(data, undefined, { readOnly: true }); const tree = h.render();
    const before = h.writes.length;
    label(tree, 'Reiniciar').props.onPress(); label(tree, 'Guardar mi apuesta').props.onPress(); label(tree, 'Pedir una pista').props.onPress();
    assert.equal(h.writes.length, before); assert.equal(h.hints.length, 0);
    assert.equal(label(tree, 'Reiniciar').props.disabled, true);
    const missing = mount(data, prepared(data), { document: { blocks: [{ id: 'b' }] } });
    const missingTree = missing.render(); assert.ok(text(missingTree).includes('No se encontró'));
    assert.equal(label(missingTree, 'Ver resultado').props.disabled, true); label(missingTree, 'Ver resultado').props.onPress();
    assert.equal(missing.events.length, 0); assert.equal((missing.runtime.state as PredictionGateState).phase, 'committed');
  }
});
test('hint asks for a clue with the current prediction, never the hidden outcome', async () => {
  const h = mount(numeric, prepared(numeric)); const tree = h.render();
  label(tree, 'Pedir una pista').props.onPress(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.hints.length, 1); assert.equal(h.events.length, 0);
  assert.match(JSON.stringify(h.hints[0][1]), /sin revelar/);
  assert.equal(JSON.stringify(h.hints[0][1]).includes('7.123'), false);
  assert.equal(JSON.stringify(h.hints[0][1]).includes('RESULTADO_PRIVADO'), false);
  assert.ok(predictionJSONBytes(h.hints[0][1]) <= 4096);
});
test('flush failure sends no event; repeated retries freeze the same action and a sent attempt is skipped', async () => {
  let state = revealPrediction(numeric, prepared(numeric), doc, 'b'), attempts = 0, failFlush = true;
  const runtime = { state, set() {}, flush: async () => { if (failFlush) throw new Error('offline'); },
    settle: async () => { attempts++; } };
  const write = (next: PredictionGateState) => { state = next; };
  await assert.rejects(deliverPredictionGateOutcome(runtime, numeric, state, doc, 'b', write), /offline/);
  assert.equal(attempts, 0); assert.equal(state.notification, 'uncertain');
  failFlush = false; await deliverPredictionGateOutcome(runtime, numeric, state, doc, 'b', write);
  assert.equal(attempts, 1); assert.equal(state.notification, 'sent');
  assert.equal(await deliverPredictionGateOutcome(runtime, numeric, state, doc, 'b', write), 'skipped');
  assert.equal(attempts, 1);
});
test('renderer retry after a lost service response creates one real settled event per attempt', async t => {
  const { service } = await setup(t); const reference = { documentId: 'd', workspaceId };
  const view = await service.read(reference); const document = view.document;
  let state = revealPrediction(curve, prepared(curve, 'evt_pg_network'), document, 'b'), loseResponse = true;
  const calls: unknown[] = [];
  const runtime = { state, set() {}, flush: async () => {}, settle: async (kind: string, payload: any, label?: string, eventId?: string) => {
    const action = { kind, payload, label: label!, delivery: 'batched' as const, settled: true, targetIds: ['b'] };
    calls.push({ action, eventId });
    await service.action({ ...reference, expectedRevision: view.document.revision, action, eventId: eventId! });
    if (loseResponse) { loseResponse = false; throw new Error('lost response'); }
  } };
  const write = (next: PredictionGateState) => { state = next; };
  await assert.rejects(deliverPredictionGateOutcome(runtime, curve, state, document, 'b', write), /lost response/);
  const frozen = structuredClone(state.frozenOutcome);
  await deliverPredictionGateOutcome(runtime, curve, state, document, 'b', write);
  assert.deepEqual(calls[0], calls[1]); assert.deepEqual(state.frozenOutcome, frozen);
  let events = (await service.events(reference)).events;
  assert.equal(events.length, 1); assert.equal(events[0].action.settled, true);
  assert.ok(Buffer.byteLength(JSON.stringify(events[0].action.payload)) <= 4096);
  const next = revealPrediction(curve, prepared(curve, 'evt_pg_network_second'), document, 'b');
  await deliverPredictionGateOutcome(runtime, curve, next, document, 'b', write);
  events = (await service.events(reference)).events; assert.equal(events.length, 2);
});
test('reset during in-flight reveal preserves the fresh attempt and does not auto-emit or resurrect the old result', async () => {
  const h = mount(choice, prepared(choice)); let finish!: () => void;
  h.runtime.settle = async (...args: unknown[]) => { h.events.push(args); await new Promise<void>(resolve => { finish = resolve; }); };
  const tree = h.render(); label(tree, 'Ver resultado').props.onPress();
  await new Promise(resolve => setImmediate(resolve));
  label(tree, 'Reiniciar').props.onPress(); const newAttempt = (h.runtime.state as PredictionGateState).attemptId;
  finish(); await new Promise(resolve => setImmediate(resolve));
  assert.equal((h.runtime.state as PredictionGateState).attemptId, newAttempt);
  assert.equal((h.runtime.state as PredictionGateState).phase, 'draft'); assert.equal(h.events.length, 1);
  assert.equal(text(h.render()).includes('RESULTADO_PRIVADO'), false);
});
