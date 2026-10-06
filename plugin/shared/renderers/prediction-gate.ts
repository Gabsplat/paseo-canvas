import { z } from 'zod';
import type { RendererSpec } from './spec';
import type { CanvasBlock } from '../model';

export const PREDICTION_POINT_LIMIT = 24;
export const PREDICTION_BYTES = 4096;
const reference = z.string().min(1).max(100).regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/)
  .refine(value => !['__proto__', 'constructor', 'prototype'].includes(value));
const coordinate = z.number().finite().min(-1e12).max(1e12);
const point = z.tuple([coordinate, coordinate]);
const points = z.array(point).min(2).max(PREDICTION_POINT_LIMIT);
const description = z.string().max(400).optional();
const common = { question: z.string().min(1).max(1000), targetBlockId: reference };
export const predictionGateDataSchema = z.discriminatedUnion('mode', [
  z.object({ ...common, mode: z.literal('choice'),
    options: z.array(z.object({ id: reference.max(48), label: z.string().min(1).max(100) }).strict()).min(2).max(4),
    outcome: z.object({ choiceId: reference.max(48), description }).strict(),
  }).strict().refine(data => new Set(data.options.map(option => option.id)).size === data.options.length
    && data.options.some(option => option.id === data.outcome.choiceId), 'Las opciones deben ser únicas y contener el resultado.'),
  z.object({ ...common, mode: z.literal('numeric'), min: coordinate, max: coordinate, unit: z.string().max(40).optional(),
    outcome: z.object({ value: coordinate, description }).strict(),
  }).strict().refine(data => data.min < data.max && data.outcome.value >= data.min && data.outcome.value <= data.max,
    'La estimación y el resultado requieren un intervalo válido.'),
  z.object({ ...common, mode: z.literal('curve'),
    axes: z.object({ xLabel: z.string().min(1).max(60), yLabel: z.string().min(1).max(60),
      xMin: coordinate, xMax: coordinate, yMin: coordinate, yMax: coordinate }).strict(),
    outcome: z.object({ points, description }).strict(),
  }).strict().refine(data => data.axes.xMin < data.axes.xMax && data.axes.yMin < data.axes.yMax
    && data.outcome.points.every(([x, y]) => x >= data.axes.xMin && x <= data.axes.xMax && y >= data.axes.yMin && y <= data.axes.yMax),
    'Los ejes deben tener intervalos válidos y contener todos los puntos.'),
]);
export type PredictionGateData = z.infer<typeof predictionGateDataSchema>;
/** Only internal IDs are rewritten when core duplicates a group or inserts a template. */
export function remapPredictionGateReferences(data: CanvasBlock['data'], ids: ReadonlyMap<string, string>): CanvasBlock['data'] {
  const target = data.targetBlockId;
  return typeof target === 'string' && ids.has(target) ? { ...data, targetBlockId: ids.get(target)! } : data;
}
export type PredictionPoint = [number, number];
export const predictionSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('choice'), choiceId: reference.max(48) }).strict(),
  z.object({ mode: z.literal('numeric'), value: coordinate }).strict(),
  z.object({ mode: z.literal('curve'), points: z.array(point).max(PREDICTION_POINT_LIMIT) }).strict(),
]);
export type Prediction = z.infer<typeof predictionSchema>;

/** Shared with core visibility. This is pedagogical state, not an access boundary. */
export const predictionGateRuntimeSchema = z.object({
  version: z.literal(1), definitionKey: z.string().regex(/^pg1-[a-f0-9]{16}$/),
  attemptId: reference.max(70).refine(value => value.startsWith('evt_pg_')),
  phase: z.enum(['draft', 'committed', 'revealed']), prediction: predictionSchema.nullable(),
  frozenOutcome: predictionSchema.nullable(),
  notification: z.enum(['ready', 'attempted', 'sent', 'uncertain']),
}).strict().refine(state => (state.phase === 'draft' || state.prediction !== null)
  && (state.phase === 'revealed' ? state.frozenOutcome !== null : state.notification === 'ready' && state.frozenOutcome === null))
  .refine(state => predictionJSONBytes(state) <= PREDICTION_BYTES, 'La apuesta supera 4096 bytes.');
export type PredictionGateState = z.infer<typeof predictionGateRuntimeSchema>;

/** UTF-8 length without Node or DOM APIs; also counts lone surrogates as replacement characters. */
export function predictionJSONBytes(value: unknown): number {
  let length = 0;
  for (const character of JSON.stringify(value)) {
    const code = character.codePointAt(0)!;
    length += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return length;
}

/** Invalidate saved attempts when their authored question, reference or outcome changes. */
export function predictionDefinitionKey(data: PredictionGateData): string {
  let first = 2166136261, second = 3339675911;
  for (const char of JSON.stringify(data)) {
    const code = char.codePointAt(0)!;
    first = Math.imul(first ^ code, 16777619); second = Math.imul(second ^ code, 2246822519);
  }
  return `pg1-${(first >>> 0).toString(16).padStart(8, '0')}${(second >>> 0).toString(16).padStart(8, '0')}`;
}
export function createPredictionAttempt(data: PredictionGateData, attemptId: string): PredictionGateState {
  return predictionGateRuntimeSchema.parse({ version: 1, definitionKey: predictionDefinitionKey(data), attemptId,
    phase: 'draft', prediction: null, frozenOutcome: null, notification: 'ready' });
}
export function isValidPrediction(data: PredictionGateData, prediction: Prediction | null, complete = true): boolean {
  if (!prediction || prediction.mode !== data.mode) return false;
  if (data.mode === 'choice' && prediction.mode === 'choice') return data.options.some(option => option.id === prediction.choiceId);
  if (data.mode === 'numeric' && prediction.mode === 'numeric') return prediction.value >= data.min && prediction.value <= data.max;
  if (data.mode === 'curve' && prediction.mode === 'curve') return (!complete || prediction.points.length >= 2)
    && prediction.points.every(([x, y]) => x >= data.axes.xMin && x <= data.axes.xMax && y >= data.axes.yMin && y <= data.axes.yMax);
  return false;
}
export function readPredictionGateState(data: PredictionGateData, raw: unknown): PredictionGateState | null {
  const parsed = predictionGateRuntimeSchema.safeParse(raw);
  if (!parsed.success || parsed.data.definitionKey !== predictionDefinitionKey(data)) return null;
  const state = parsed.data;
  if (state.prediction && !isValidPrediction(data, state.prediction, state.phase !== 'draft')) return null;
  if (state.phase === 'revealed' && JSON.stringify(state.frozenOutcome) !== JSON.stringify(declaredPredictionOutcome(data))) return null;
  return state;
}
export function editPrediction(data: PredictionGateData, state: PredictionGateState, raw: unknown): PredictionGateState {
  const parsed = predictionSchema.safeParse(raw);
  if (!readPredictionGateState(data, state) || state.phase !== 'draft' || !parsed.success || !isValidPrediction(data, parsed.data, false)) return state;
  return predictionGateRuntimeSchema.parse({ ...state, prediction: parsed.data });
}
export function commitPrediction(data: PredictionGateData, state: PredictionGateState): PredictionGateState {
  return readPredictionGateState(data, state)?.phase === 'draft' && isValidPrediction(data, state.prediction) ? { ...state, phase: 'committed' } : state;
}

type BlockReference = { readonly id: string };
export function resolvePredictionTarget<Block extends BlockReference>(document: { readonly blocks: readonly Block[] }, targetBlockId: string, gateBlockId?: string):
  { valid: true; block: Block } | { valid: false; message: string } {
  if (targetBlockId === gateBlockId) return { valid: false, message: 'El bloque de resultado debe ser distinto de la apuesta.' };
  const block = document.blocks.find(candidate => candidate.id === targetBlockId);
  return block ? { valid: true, block } : { valid: false, message: 'No se encontró el bloque de resultado. Es necesario restaurarlo o elegir otro bloque.' };
}
export function validatePredictionGateReferences(data: PredictionGateData, document: { readonly blocks: readonly BlockReference[] }, gateBlockId?: string): readonly string[] {
  const target = resolvePredictionTarget(document, data.targetBlockId, gateBlockId);
  return target.valid ? [] : [target.message];
}
export function isPredictionGateRevealed(data: PredictionGateData, rawRuntime: unknown, document: { readonly blocks: readonly BlockReference[] }, gateBlockId?: string): boolean {
  return readPredictionGateState(data, rawRuntime)?.phase === 'revealed' && resolvePredictionTarget(document, data.targetBlockId, gateBlockId).valid;
}
export function revealPrediction(data: PredictionGateData, state: PredictionGateState, document: { readonly blocks: readonly BlockReference[] }, gateBlockId?: string): PredictionGateState {
  return readPredictionGateState(data, state)?.phase === 'committed' && resolvePredictionTarget(document, data.targetBlockId, gateBlockId).valid
    ? predictionGateRuntimeSchema.parse({ ...state, phase: 'revealed', frozenOutcome: declaredPredictionOutcome(data) }) : state;
}
export function declaredPredictionOutcome(data: PredictionGateData): Prediction {
  return data.mode === 'choice' ? { mode: 'choice', choiceId: data.outcome.choiceId }
    : data.mode === 'numeric' ? { mode: 'numeric', value: data.outcome.value }
    : { mode: 'curve', points: data.outcome.points.map(([x, y]) => [x, y]) };
}
export function getRevealedPredictionOutcome(data: PredictionGateData, rawRuntime: unknown, document: { readonly blocks: readonly BlockReference[] }, gateBlockId?: string) {
  const state = readPredictionGateState(data, rawRuntime);
  return state?.prediction && isPredictionGateRevealed(data, state, document, gateBlockId)
    ? { prediction: state.prediction, outcome: data.outcome } : null;
}

/** Retain the beginning and latest endpoint, with bounded points and no pointer-frame events. */
export function appendPredictionPoint(current: readonly PredictionPoint[], next: PredictionPoint): PredictionPoint[] {
  if (!next.every(Number.isFinite)) return current.map(p => [...p]);
  const rounded: PredictionPoint = [Number(next[0].toPrecision(6)), Number(next[1].toPrecision(6))];
  const result = [...current.map((p): PredictionPoint => [...p]), rounded];
  if (result.length <= PREDICTION_POINT_LIMIT) return result;
  // Decimate interior samples to leave room for subsequent frames.
  return result.filter((_, index) => index === 0 || index === result.length - 1 || index % 2 === 0);
}
export function buildPredictionOutcomeEvent(data: PredictionGateData, state: PredictionGateState, document: { readonly blocks: readonly BlockReference[] }, gateBlockId?: string) {
  const revealed = getRevealedPredictionOutcome(data, state, document, gateBlockId);
  if (!revealed) return null;
  const payload = { attemptId: state.attemptId, targetBlockId: data.targetBlockId, prediction: revealed.prediction, outcome: state.frozenOutcome! };
  if (predictionJSONBytes(payload) > PREDICTION_BYTES) throw new Error('La comparación supera 4096 bytes.');
  return payload;
}

export const predictionGateSpec = {
  id: 'prediction-gate', dataSchema: predictionGateDataSchema, interactive: true,
  hiddenTargets(data, runtime, document, blockId) {
    const parsed = predictionGateDataSchema.safeParse(data);
    return parsed.success && parsed.data.targetBlockId !== blockId && !isPredictionGateRevealed(parsed.data, runtime, document, blockId) ? [parsed.data.targetBlockId] : [];
  },
  minSize: { width: 280, height: 220 }, defaultSize: { width: 400, height: 360 },
  guidance: 'Apuesta: declare one question, a real targetBlockId and mode choice/numeric/curve with a typed outcome. Commit before revealing; runtime stores a bounded frozen prediction and one idempotent settled comparison per attempt. Core hides the external target until reveal; authored outcomes are pedagogical, not secret data.',
  blockType: { id: 'prediction-gate', name: 'Apuesta', description: 'Predicción previa y comparación con un resultado declarado.', renderer: 'prediction-gate',
    properties: [
      { key: 'question', label: 'Pregunta', kind: 'text', required: true },
      { key: 'targetBlockId', label: 'Bloque de resultado', kind: 'text', required: true },
      { key: 'mode', label: 'Tipo de apuesta', kind: 'text', required: true },
      { key: 'options', label: 'Opciones', kind: 'json', required: false },
      { key: 'min', label: 'Mínimo', kind: 'number', required: false },
      { key: 'max', label: 'Máximo', kind: 'number', required: false },
      { key: 'unit', label: 'Unidad', kind: 'text', required: false },
      { key: 'axes', label: 'Ejes', kind: 'json', required: false },
      { key: 'outcome', label: 'Resultado declarado', kind: 'json', required: true },
    ], defaults: { question: '¿Qué resultado se espera?', targetBlockId: 'resultado', mode: 'choice',
      options: [{ id: 'a', label: 'Aumenta' }, { id: 'b', label: 'Disminuye' }], outcome: { choiceId: 'a' } },
  },
} satisfies RendererSpec;
