import React, { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import {
  appendPredictionPoint, buildPredictionOutcomeEvent, commitPrediction, createPredictionAttempt,
  editPrediction, getRevealedPredictionOutcome, isValidPrediction, predictionDefinitionKey,
  readPredictionGateState, resolvePredictionTarget, revealPrediction,
  type Prediction, type PredictionGateData, type PredictionGateState, type PredictionPoint,
} from '../../shared/renderers/prediction-gate';
import { Button, Chip, OptionRow, Txt } from '../ui';
import { CanvasSurface, NativeLearningFallback, type Canvas2DContext, type SurfaceFrame, type SurfacePointer } from '../Surfaces';
import { WebRange } from '../web';
import type { RendererRuntime } from '../useLearning';
import type { ClientRenderer, RendererProps } from './types';

type ReferenceDocument = { readonly blocks: readonly { readonly id: string }[] };
type StageModel = {
  mode: 'numeric' | 'curve'; axes: { xLabel: string; yLabel: string; xMin: number; xMax: number; yMin: number; yMax: number };
  prediction: PredictionPoint[]; outcome: PredictionPoint[]; summary: string;
};
function format(value: number) { return String(Number(value.toPrecision(6))); }
function describePrediction(data: PredictionGateData, value: Prediction): string {
  if (data.mode === 'choice' && value.mode === 'choice') return data.options.find(option => option.id === value.choiceId)?.label ?? 'Sin opción válida';
  if (data.mode === 'numeric' && value.mode === 'numeric') return `${format(value.value)}${data.unit ? ` ${data.unit}` : ''}`;
  return value.mode === 'curve' ? `Curva de ${value.points.length} puntos` : 'Sin apuesta';
}

/** Pass only this sanitized model to CanvasSurface; hidden outcomes never enter its props. */
export function predictionGatePresentation(data: PredictionGateData, state: PredictionGateState, document: ReferenceDocument, blockId?: string) {
  const validState = readPredictionGateState(data, state);
  const revealed = getRevealedPredictionOutcome(data, state, document, blockId);
  const prediction = validState?.prediction ?? null;
  const outcome = revealed ? validState!.frozenOutcome : null;
  const summary = prediction ? `Mi apuesta: ${describePrediction(data, prediction)}.` : 'Sin apuesta guardada.';
  let comparison = '';
  if (outcome && prediction) {
    comparison = `Resultado: ${describePrediction(data, outcome)}.`;
    if (prediction.mode === 'numeric' && outcome.mode === 'numeric') comparison += ` Diferencia de la apuesta respecto al resultado: ${format(prediction.value - outcome.value)}${data.mode === 'numeric' && data.unit ? ` ${data.unit}` : ''}.`;
    else if (prediction.mode === 'choice' && outcome.mode === 'choice') comparison += prediction.choiceId === outcome.choiceId ? ' La apuesta coincide con el resultado.' : ' La apuesta y el resultado son diferentes.';
    else comparison += ' La línea punteada es la apuesta; la línea sólida es el resultado.';
  }
  const fullSummary = `${summary}${comparison ? ` ${comparison}` : ' El resultado permanece oculto.'}`;
  const stage: StageModel | null = data.mode === 'choice' ? null : {
    mode: data.mode,
    axes: data.mode === 'curve' ? data.axes : { xLabel: data.unit ?? 'Valor', yLabel: '', xMin: data.min, xMax: data.max, yMin: 0, yMax: 1 },
    prediction: prediction?.mode === 'curve' ? prediction.points : prediction?.mode === 'numeric' ? [[prediction.value, .2], [prediction.value, .8]] : [],
    outcome: outcome?.mode === 'curve' ? outcome.points : outcome?.mode === 'numeric' ? [[outcome.value, .2], [outcome.value, .8]] : [],
    summary: fullSummary,
  };
  return { summary, comparison, fullSummary, stage, description: revealed ? data.outcome.description : undefined };
}

const margin = { left: 44, right: 18, top: 18, bottom: 42 };
export function drawPredictionGateStage(context: Canvas2DContext, frame: SurfaceFrame, model: StageModel, colors: { ink: string; muted: string; prediction: string; background: string }) {
  const width = Math.max(1, frame.width - margin.left - margin.right), height = Math.max(1, frame.height - margin.top - margin.bottom);
  const x = (value: number) => margin.left + (value - model.axes.xMin) / (model.axes.xMax - model.axes.xMin) * width;
  const y = (value: number) => margin.top + (1 - (value - model.axes.yMin) / (model.axes.yMax - model.axes.yMin)) * height;
  context.clearRect(0, 0, frame.width, frame.height); context.fillStyle = colors.background;
  context.fillRect(0, 0, frame.width, frame.height); context.setLineDash([]); context.lineWidth = 1; context.strokeStyle = colors.muted;
  context.beginPath(); context.moveTo(margin.left, margin.top); context.lineTo(margin.left, margin.top + height); context.lineTo(margin.left + width, margin.top + height); context.stroke();
  context.fillStyle = colors.ink; context.font = '12px system-ui'; context.textAlign = 'center'; context.textBaseline = 'middle';
  context.fillText(model.axes.xLabel, margin.left + width / 2, frame.height - 10);
  context.fillText(format(model.axes.xMin), margin.left, frame.height - 28);
  context.fillText(format(model.axes.xMax), margin.left + width, frame.height - 28);
  if (model.mode === 'curve') {
    context.textAlign = 'left'; context.fillText(model.axes.yLabel, 4, 8);
    context.fillText(format(model.axes.yMax), 4, margin.top + 8); context.fillText(format(model.axes.yMin), 4, margin.top + height - 8);
  }
  const line = (points: PredictionPoint[], dashed: boolean, color: string) => {
    if (!points.length) return;
    context.strokeStyle = color; context.lineWidth = 2; context.setLineDash(dashed ? [5, 4] : []);
    context.beginPath(); points.forEach(([px, py], index) => index ? context.lineTo(x(px), y(py)) : context.moveTo(x(px), y(py))); context.stroke();
    if (points.length === 1) { context.beginPath(); context.arc(x(points[0][0]), y(points[0][1]), 3, 0, Math.PI * 2); context.stroke(); }
  };
  // Solid result underneath keeps a coincident dashed prediction visible.
  line(model.outcome, false, colors.ink); line(model.prediction, true, colors.prediction); context.setLineDash([]);
}

/** The caller locks concurrent requests. Every retry uses exactly the frozen action and event ID. */
export async function deliverPredictionGateOutcome(runtime: RendererRuntime, data: PredictionGateData, state: PredictionGateState,
  document: ReferenceDocument, blockId: string, write: (state: PredictionGateState) => void): Promise<'sent' | 'skipped'> {
  if (state.notification === 'sent') return 'skipped';
  const payload = buildPredictionOutcomeEvent(data, state, document, blockId);
  if (!payload) return 'skipped';
  const pending: PredictionGateState = { ...state, notification: 'attempted' };
  write(pending);
  try {
    await runtime.flush();
    // Settled coalescing is by block/kind. Preserve different attempts, dedupe retries of one.
    await runtime.settle(`prediction-gate.reveal.${state.attemptId}`, payload, 'Comparar apuesta y resultado', state.attemptId);
    write({ ...pending, notification: 'sent' });
    return 'sent';
  } catch (error) {
    write({ ...pending, notification: 'uncertain' });
    throw error;
  }
}

let sequence = 0;
function attemptId() { return `evt_pg_${Date.now().toString(36)}_${(++sequence).toString(36)}_${Math.random().toString(36).slice(2, 10)}`; }

export function PredictionGate({ data, document, block, runtime, readOnly, ui, availableWidth, send }: RendererProps<PredictionGateData>) {
  const [local, setLocal] = useState(readPredictionGateState(data, runtime.state) ?? createPredictionAttempt(data, attemptId()));
  const [error, setError] = useState(''), [sending, setSending] = useState(false);
  const current = useRef(local), inFlight = useRef(false), pointer = useRef<number | null>(null);
  const frame = useRef<SurfaceFrame>({ width: Math.max(280, availableWidth), height: 220, pixelRatio: 1, time: 0 });
  const definitionKey = predictionDefinitionKey(data);
  const runtimeKey = JSON.stringify(runtime.state);
  // Immediately conceal a stale attempt, even before the effect synchronizes local state.
  const state = readPredictionGateState(data, local) ?? createPredictionAttempt(data, local.definitionKey === definitionKey ? local.attemptId : attemptId());
  current.current = state;
  useEffect(() => {
    const next = readPredictionGateState(data, runtime.state);
    if (next) { current.current = next; setLocal(next); }
    else {
      const reset = createPredictionAttempt(data, attemptId()); current.current = reset; setLocal(reset);
    }
  }, [runtimeKey, definitionKey]);
  const persist = (next: PredictionGateState) => { current.current = next; setLocal(next); runtime.set(next); };
  const target = resolvePredictionTarget(document, data.targetBlockId, block.id);
  const model = predictionGatePresentation(data, state, document, block.id);
  const editable = !readOnly && state.phase === 'draft';
  const edit = (prediction: Prediction) => {
    if (!editable || current.current.phase !== 'draft') return;
    persist(editPrediction(data, current.current, prediction)); setError('');
  };
  const deliver = async (revealed: PredictionGateState) => {
    if (readOnly || inFlight.current) return;
    inFlight.current = true; setSending(true); setError('');
    const sameAttempt = () => current.current.attemptId === revealed.attemptId && current.current.definitionKey === revealed.definitionKey;
    try {
      await deliverPredictionGateOutcome(runtime, data, revealed, document, block.id, next => { if (sameAttempt()) persist(next); });
    } catch {
      if (sameAttempt()) setError('No se pudo confirmar el envío. Reintentar conserva la misma apuesta y evita duplicados.');
    } finally { inFlight.current = false; setSending(false); }
  };
  const onPointer = (event: SurfacePointer) => {
    if (!editable || data.mode !== 'curve' || current.current.phase !== 'draft') return;
    if (event.kind === 'cancel') { if (pointer.current === event.pointerId) pointer.current = null; return; }
    if (event.kind === 'down') { if (pointer.current !== null) return; pointer.current = event.pointerId; }
    else if (pointer.current !== event.pointerId) return;
    const width = Math.max(1, frame.current.width - margin.left - margin.right), height = Math.max(1, frame.current.height - margin.top - margin.bottom);
    const fractionX = Math.max(0, Math.min(1, (event.x - margin.left) / width)), fractionY = Math.max(0, Math.min(1, 1 - (event.y - margin.top) / height));
    const next: PredictionPoint = [data.axes.xMin + fractionX * (data.axes.xMax - data.axes.xMin), data.axes.yMin + fractionY * (data.axes.yMax - data.axes.yMin)];
    const before = current.current.prediction;
    const points = appendPredictionPoint(event.kind === 'down' || before?.mode !== 'curve' ? [] : before.points, next)
      .map(([x, y]): PredictionPoint => [Math.max(data.axes.xMin, Math.min(data.axes.xMax, x)), Math.max(data.axes.yMin, Math.min(data.axes.yMax, y))]);
    edit({ mode: 'curve', points });
    if (event.kind === 'up') pointer.current = null;
  };
  const reset = () => {
    if (readOnly) return;
    pointer.current = null; setError(''); persist(createPredictionAttempt(data, attemptId()));
  };
  const actions = <View nativeID={`lienzo-interactive-prediction-actions-${block.id}`} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
    {ui.layout.platform === 'web' && state.phase === 'draft' && <Button label="Guardar mi apuesta" icon="Lock" variant="primary" disabled={readOnly || !target.valid || !isValidPrediction(data, state.prediction)} onPress={() => {
      if (readOnly || !target.valid) return;
      persist(commitPrediction(data, current.current)); pointer.current = null;
    }} />}
    {ui.layout.platform === 'web' && state.phase === 'committed' && <Button label="Ver resultado" variant="primary" disabled={readOnly || !target.valid || sending} onPress={() => {
      if (readOnly || !target.valid || inFlight.current) return;
      const revealed = revealPrediction(data, current.current, document, block.id);
      if (revealed.phase !== 'revealed') return;
      persist(revealed); void deliver(revealed);
    }} />}
    {ui.layout.platform === 'web' && state.phase === 'revealed' && state.notification !== 'sent' && <Button label={sending ? 'Enviando comparación' : 'Reintentar envío'} disabled={readOnly || sending || !target.valid} onPress={() => { void deliver(current.current); }} />}
    <Button label="Reiniciar" small variant="ghost" disabled={readOnly} onPress={reset} />
    {ui.layout.platform === 'web' && state.phase !== 'revealed' && <Button label="Pedir una pista" small variant="ghost" disabled={readOnly || sending} onPress={() => {
      if (readOnly || inFlight.current) return;
      inFlight.current = true; setSending(true); setError('');
      void send('prediction-gate.hint', { attemptId: current.current.attemptId, prediction: current.current.prediction,
        request: 'Dar una pista sobre la pregunta y la apuesta actual sin revelar el resultado ni la solución.' }, 'Pedir una pista', 'batched')
        .catch(() => setError('No se pudo pedir una pista. Es posible volver a intentarlo.')).finally(() => { inFlight.current = false; setSending(false); });
    }} />}
  </View>;
  return <View style={{ gap: 8 }}>
    <Txt>{data.question}</Txt>
    {!target.valid && <Txt kind="small" style={{ color: ui.c.statusDanger }}>{target.message}</Txt>}
    {ui.layout.platform !== 'web' ? <><Chip label="Estático" /><NativeLearningFallback summary={model.fullSummary} /></> :
      <View nativeID={`lienzo-interactive-prediction-stage-${block.id}`} style={{ gap: 8, padding: 8, borderRadius: 8,
        borderWidth: 1, borderStyle: state.phase === 'revealed' ? 'solid' : 'dashed', borderColor: ui.tone('violeta'), backgroundColor: ui.c.surface0 }}>
        {state.phase !== 'revealed' && <Chip label={state.phase === 'draft' ? 'Resultado oculto' : 'Apuesta guardada'} icon="Lock" tone="violeta" />}
        {data.mode === 'choice' && state.phase === 'draft' && data.options.map(option => <OptionRow key={option.id} label={option.label}
          selected={state.prediction?.mode === 'choice' && state.prediction.choiceId === option.id} disabled={!editable}
          onPress={() => edit({ mode: 'choice', choiceId: option.id })} />)}
        {model.stage && <CanvasSurface id={`prediction-${block.id}`} label={data.mode === 'curve' && editable ? 'Dibujar la curva de la apuesta' : 'Comparación de la apuesta'}
          height={Math.max(160, Math.min(280, Math.max(280, availableWidth) * .625))} summary={model.fullSummary} onPointer={editable && data.mode === 'curve' ? onPointer : undefined}
          draw={(context, measured) => { frame.current = measured; drawPredictionGateStage(context, measured, model.stage!, { ink: ui.c.foreground, muted: ui.c.foregroundMuted, prediction: ui.tone('violeta'), background: ui.c.surface0 }); }} />}
        {data.mode === 'numeric' && state.phase === 'draft' && <View style={{ gap: 4 }}><Txt kind="label">Estimación{data.unit ? ` (${data.unit})` : ''}</Txt>
          <WebRange id={`prediction-${block.id}`} label="Estimación de la apuesta" min={data.min} max={data.max} step="any" disabled={!editable} color={ui.tone('violeta')}
            value={state.prediction?.mode === 'numeric' ? state.prediction.value : data.min + (data.max - data.min) / 2}
            onChange={value => edit({ mode: 'numeric', value })} onSettle={value => edit({ mode: 'numeric', value })} /></View>}
        {data.mode === 'curve' && state.phase === 'draft' && <Txt kind="small" muted>Dibujar una curva antes de guardar. Un nuevo trazo reemplaza la curva anterior.</Txt>}
        <Txt kind="small">{model.summary}</Txt>
        {!!model.comparison && <Txt kind="small">{model.comparison}</Txt>}
        {!!model.description && <Txt kind="small">{model.description}</Txt>}
      </View>}
    {actions}
    {!!error && <Txt kind="small" style={{ color: ui.c.statusDanger }}>{error}</Txt>}
  </View>;
}

export const predictionGateRenderer: ClientRenderer<PredictionGateData> = {
  id: 'prediction-gate', Component: PredictionGate, visual: { icon: 'Lock', tone: 'violeta', width: 'standard' },
};
