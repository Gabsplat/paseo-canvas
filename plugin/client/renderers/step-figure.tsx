import React, { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { clampFigureStep, figureChanges, resolveStepFigure, stepFigureState, type StepFigureData, type StepFigureElement } from '../../shared/renderers/step-figure';
import { CanvasSurface, NativeLearningFallback, type Canvas2DContext, type SurfaceFrame } from '../Surfaces';
import { Button, Txt } from '../ui';
import { WebRange } from '../web';
import type { ClientRenderer, RendererProps } from './types';

type Ink = { foreground: string; foregroundMuted: string; accent: string; surface0: string };
function elementPath(ctx: Canvas2DContext, e: StepFigureElement): void {
  ctx.beginPath();
  if (e.kind === 'rect') { ctx.moveTo(e.x, e.y); ctx.lineTo(e.x + e.width, e.y); ctx.lineTo(e.x + e.width, e.y + e.height); ctx.lineTo(e.x, e.y + e.height); ctx.closePath(); }
  else if (e.kind === 'circle') ctx.arc(e.x, e.y, e.radius, 0, Math.PI * 2);
  else if (e.kind === 'line') { ctx.moveTo(e.x, e.y); ctx.lineTo(e.x2, e.y2); }
  else if ('points' in e) { e.points.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); if (e.kind === 'polygon') ctx.closePath(); }
}
export function drawStepFigure(ctx: Canvas2DContext, frame: SurfaceFrame, data: StepFigureData, elements: readonly StepFigureElement[], outlines: readonly StepFigureElement[], alpha: number, ink: Ink): void {
  ctx.clearRect(0, 0, frame.width, frame.height); ctx.fillStyle = ink.surface0; ctx.fillRect(0, 0, frame.width, frame.height);
  const scale = Math.min(Math.max(1, frame.width - 24) / data.viewBox.width, Math.max(1, frame.height - 24) / data.viewBox.height);
  ctx.save(); ctx.translate((frame.width - data.viewBox.width * scale) / 2, (frame.height - data.viewBox.height * scale) / 2); ctx.scale(scale, scale);
  ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(data.viewBox.width, 0); ctx.lineTo(data.viewBox.width, data.viewBox.height); ctx.lineTo(0, data.viewBox.height); ctx.closePath(); ctx.clip();
  const color = (role: string) => role === 'accent' ? ink.accent : role === 'muted' ? ink.foregroundMuted : ink.foreground;
  ctx.lineJoin = 'round'; ctx.lineCap = 'round'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  for (const e of elements) {
    ctx.globalAlpha = 1; ctx.lineWidth = e.lineWidth; ctx.strokeStyle = color(e.stroke); ctx.setLineDash(e.dashed ? [6, 4] : []);
    if (e.kind === 'text') { ctx.fillStyle = color(e.stroke); ctx.font = `${e.fontSize}px sans-serif`; ctx.fillText(e.text, e.x, e.y); }
    else { elementPath(ctx, e); if ('fill' in e && e.fill) { ctx.fillStyle = color(e.fill); ctx.fill(); } ctx.stroke(); }
  }
  // A separate dashed outline leaves the original geometry and ink unchanged.
  if (alpha > 0) for (const e of outlines) {
    ctx.globalAlpha = alpha; ctx.strokeStyle = ink.accent; ctx.lineWidth = e.lineWidth + 3 / scale; ctx.setLineDash([4 / scale, 3 / scale]);
    if (e.kind === 'text') { ctx.font = `${e.fontSize}px sans-serif`; ctx.strokeRect(e.x - 2 / scale, e.y - 2 / scale, ctx.measureText(e.text).width + 4 / scale, e.fontSize + 4 / scale); }
    else { elementPath(ctx, e); ctx.stroke(); }
  }
  ctx.restore();
}

function StepFigure(props: RendererProps<StepFigureData>) {
  const { data, block, runtime, ui, readOnly } = props;
  const [, render] = useState(0), [error, setError] = useState('');
  const live = useRef(props); live.current = props;
  const mounted = useRef(true), timer = useRef<ReturnType<typeof setInterval> | null>(null), visible = useRef(true);
  const initialState = stepFigureState(data, runtime.state);
  const local = useRef({ data, documentId: props.document.id, state: initialState, snapshot: resolveStepFigure(data, initialState.step), runtimeSignature: JSON.stringify(runtime.state), playing: false, seeking: false, highlight: false, highlightStart: null as number | null, changes: figureChanges([], []) });
  const current = local.current;
  const refresh = () => { if (mounted.current) render(value => value + 1); };
  const stopTimer = () => { if (timer.current !== null) clearInterval(timer.current); timer.current = null; current.playing = false; };
  const enabled = () => !live.current.readOnly && live.current.ui.layout.platform === 'web';
  const report = (kind: string, reset = false) => {
    if (!enabled()) return;
    const { state, snapshot } = local.current, active = live.current;
    const fail = () => { if (mounted.current) setError('No se pudo guardar el paso. Revisa la conexión y vuelve a intentarlo.'); };
    if (mounted.current) setError('');
    try {
      active.runtime.set(reset ? null : { step: state.step, visited: [...state.visited] });
      void active.runtime.settle(`step-figure.${kind}`, { step: state.step, visited: [...state.visited], validStep: snapshot.validStep }, reset ? 'Reiniciar figura' : 'Explorar la figura por pasos').catch(fail);
    } catch { fail(); }
  };
  const move = (step: number) => {
    const active = live.current, prior = current.snapshot;
    step = clampFigureStep(active.data, step);
    current.state = { step, visited: [Math.min(current.state.visited[0], step), Math.max(current.state.visited[1], step)] };
    current.snapshot = resolveStepFigure(active.data, step);
    current.changes = figureChanges(prior.elements, current.snapshot.elements);
    current.highlight = current.changes.ids.length > 0; current.highlightStart = null;
    refresh();
  };
  // Receive real runtime/content changes, while retaining local playback and drag frames.
  const signature = JSON.stringify(runtime.state);
  if (current.data !== data || current.documentId !== props.document.id) {
    stopTimer(); current.data = data; current.documentId = props.document.id; current.seeking = false;
    current.state = initialState; current.snapshot = resolveStepFigure(data, initialState.step); current.highlight = false; current.changes = figureChanges([], []); current.runtimeSignature = signature;
  } else if (current.runtimeSignature !== signature) {
    current.runtimeSignature = signature;
    if (!current.playing && !current.seeking) { current.state = initialState; current.snapshot = resolveStepFigure(data, initialState.step); }
  }
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; const wasPlaying = current.playing; stopTimer(); if (wasPlaying) report('pause'); };
  }, []);
  useEffect(() => { if (readOnly || ui.layout.platform !== 'web') { stopTimer(); current.seeking = false; refresh(); } }, [readOnly, ui.layout.platform]);

  const manual = (direction: number) => {
    if (!enabled()) return;
    const target = clampFigureStep(live.current.data, current.state.step + direction);
    if (target === current.state.step) return;
    stopTimer(); current.seeking = false; move(target); report('step');
  };
  const togglePlay = () => {
    if (!enabled()) return;
    if (current.playing) { stopTimer(); report('pause'); refresh(); return; }
    if (!visible.current || !live.current.data.playback || current.snapshot.error || current.state.step >= live.current.data.steps.length) return;
    current.seeking = false; current.playing = true; refresh();
    timer.current = setInterval(() => {
      if (!enabled() || !visible.current) { stopTimer(); refresh(); return; }
      move(current.state.step + 1);
      if (current.snapshot.error || current.state.step >= live.current.data.steps.length) { stopTimer(); report('end'); refresh(); }
    }, live.current.data.playback.intervalMs);
  };
  const onVisibilityChange = (value: boolean) => {
    visible.current = value;
    if (!value && current.playing) { stopTimer(); report('pause'); refresh(); }
  };
  const seek = (step: number, settled: boolean) => {
    if (!enabled()) return;
    // Interrupting playback is reported together with the seek's final position.
    stopTimer(); current.seeking = !settled; move(step);
    if (settled) report('seek');
  };
  const draw = (ctx: Canvas2DContext, frame: SurfaceFrame) => {
    if (current.highlight && current.highlightStart === null) current.highlightStart = frame.time;
    const alpha = current.highlight ? Math.max(0, 1 - (frame.time - current.highlightStart!) / 1100) : 0;
    drawStepFigure(ctx, frame, live.current.data, current.snapshot.elements, current.changes.outlines, alpha, live.current.ui.c);
    if (current.highlight && alpha === 0) { current.highlight = false; refresh(); }
  };
  const isWeb = ui.layout.platform === 'web', disabled = readOnly || !isWeb;
  const snapshot = current.snapshot, state = current.state;
  const counter = `Paso ${state.step + 1} de ${data.steps.length + 1}`;
  const summary = `${counter}. ${snapshot.caption} ${snapshot.elements.length} elementos. ${snapshot.elements.map(e => e.label).join(', ')}.`;
  const height = Math.max(160, Math.min(420, (props.availableWidth || 384) * 10 / 16));
  return <View nativeID={`lienzo-interactive-step-figure-${block.id}`} style={{ gap: 8 }}>
    <Txt>{data.question}</Txt>
    {isWeb ? <View style={{ backgroundColor: ui.c.surface0, borderWidth: 1, borderColor: ui.c.border, borderRadius: 8, overflow: 'hidden' }}>
      <CanvasSurface id={`step-figure-${block.id}`} label={summary} height={height} summary={summary} animated={current.playing || current.highlight} maxPixelSize={1024} draw={draw} onVisibilityChange={onVisibilityChange} onError={() => { const wasPlaying = current.playing; stopTimer(); if (wasPlaying) report('pause'); setError('No se pudo dibujar la figura. Vuelve a abrir el bloque.'); refresh(); }} />
    </View> : <View style={{ gap: 4 }}><Txt kind="label" muted>Estático</Txt><NativeLearningFallback summary={summary} /></View>}
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 4 }}>
      <Button label="Anterior" disabled={disabled || state.step === 0} style={{ minHeight: 44 }} onPress={() => manual(-1)} />
      <Txt kind="code" accessibilityLiveRegion="polite">{counter}</Txt>
      <Button label="Siguiente" disabled={disabled || state.step === data.steps.length} style={{ minHeight: 44 }} onPress={() => manual(1)} />
    </View>
    <Txt>{snapshot.caption}</Txt>
    {!!snapshot.error && <Txt kind="small" style={{ color: ui.c.statusDanger }}>{snapshot.error}</Txt>}
    {!snapshot.error && !!current.changes.ids.length && <Txt kind="small" muted>{snapshot.change} {current.changes.description}</Txt>}
    {isWeb && <WebRange id={`step-figure-${block.id}`} label="Recorrer los pasos de la figura" min={0} max={data.steps.length} step={1} value={state.step} disabled={disabled} color={ui.c.accent} onChange={value => seek(value, false)} onSettle={value => seek(value, true)} />}
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
      {data.playback && <Button label={current.playing ? 'Pausar' : 'Reproducir'} disabled={disabled || (!current.playing && (state.step === data.steps.length || !!snapshot.error))} style={{ minHeight: 44 }} onPress={togglePlay} />}
      <Button label="Reiniciar" variant="ghost" disabled={disabled} style={{ minHeight: 44 }} onPress={() => {
        if (!enabled()) return;
        stopTimer(); current.seeking = false; move(0); current.state = { step: 0, visited: [0, 0] }; report('reset', true);
      }} />
    </View>
    {!!error && <Txt kind="small" style={{ color: ui.c.statusDanger }}>{error}</Txt>}
  </View>;
}
export const stepFigureRenderer: ClientRenderer<StepFigureData> = { id: 'step-figure', Component: StepFigure, visual: { icon: 'Shapes', tone: 'neutro', width: 'wide' } };
