import React, { useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import {
  buildPlotCurves, clampPlotTrace, compilePlotExpressions, initialPlotTrace, plotNumber,
  plotTraceState, traceReadout, type FunctionPlotData, type PlotCurve, type PlotExpression,
} from '../../shared/renderers/function-plot';
import { CanvasSurface, NativeLearningFallback, type Canvas2DContext, type SurfaceFrame, type SurfacePointer } from '../Surfaces';
import { Button, Txt } from '../ui';
import type { ClientRenderer, RendererProps } from './types';

type Bounds = { left: number; top: number; width: number; height: number };
export function plotBounds(width: number, height: number, expressionCount: number): Bounds {
  const top = 46 + expressionCount * 16;
  return { left: 48, top, width: Math.max(1, width - 64), height: Math.max(1, height - top - 34) };
}
export function pointerPlotX(data: FunctionPlotData, bounds: Bounds, pixelX: number): number {
  return clampPlotTrace(data, data.xRange[0] + (pixelX - bounds.left) / bounds.width * (data.xRange[1] - data.xRange[0]));
}
export function plotReadoutText(data: FunctionPlotData, expressions: PlotExpression[], values: Readonly<Record<string, number>>, x: number): string {
  return `x = ${plotNumber(x)}${data.xUnit ? ` ${data.xUnit}` : ''}; ${traceReadout(expressions, values, x).map(r => `${r.label}: y = ${r.y === null ? 'sin valor definido' : plotNumber(r.y)}${r.y !== null && data.yUnit ? ` ${data.yUnit}` : ''}`).join('; ')}`;
}
type Ink = { surface0: string; foreground: string; foregroundMuted: string; border: string; accent: string };
const dashes = [[], [8, 4], [2, 4], [10, 3, 2, 3]];
const lineNames = ['continua', 'guiones', 'puntos', 'guiones y puntos'];
export function drawFunctionPlot(ctx: Canvas2DContext, frame: SurfaceFrame, data: FunctionPlotData, expressions: PlotExpression[], curves: PlotCurve[], values: Readonly<Record<string, number>>, traceX: number, ink: Ink): void {
  const bounds = plotBounds(frame.width, frame.height, expressions.length), { left, top, width, height } = bounds;
  const px = (x: number) => left + (x - data.xRange[0]) / (data.xRange[1] - data.xRange[0]) * width;
  const py = (y: number) => top + height - (y - data.yRange[0]) / (data.yRange[1] - data.yRange[0]) * height;
  ctx.clearRect(0, 0, frame.width, frame.height); ctx.fillStyle = ink.surface0; ctx.fillRect(0, 0, frame.width, frame.height);
  ctx.font = '12px monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle'; ctx.fillStyle = ink.foreground;
  ctx.fillText(`x = ${plotNumber(traceX)}${data.xUnit ? ` ${data.xUnit}` : ''}`, 12, 16);
  traceReadout(expressions, values, traceX).forEach((readout, i) => {
    ctx.fillText(`${i + 1}. ${readout.label}: y = ${readout.y === null ? 'sin valor definido' : plotNumber(readout.y)}${readout.y !== null && data.yUnit ? ` ${data.yUnit}` : ''}`, 12, 34 + i * 16);
  });
  ctx.strokeStyle = ink.border; ctx.lineWidth = 1; ctx.setLineDash([]);
  for (let i = 0; i <= 4; i++) {
    const x = left + width * i / 4, y = top + height * i / 4;
    ctx.beginPath(); ctx.moveTo(x, top); ctx.lineTo(x, top + height); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(left + width, y); ctx.stroke();
  }
  ctx.strokeStyle = ink.foregroundMuted;
  if (data.xRange[0] <= 0 && data.xRange[1] >= 0) { ctx.beginPath(); ctx.moveTo(px(0), top); ctx.lineTo(px(0), top + height); ctx.stroke(); }
  if (data.yRange[0] <= 0 && data.yRange[1] >= 0) { ctx.beginPath(); ctx.moveTo(left, py(0)); ctx.lineTo(left + width, py(0)); ctx.stroke(); }
  ctx.fillStyle = ink.foregroundMuted;
  ctx.fillText(plotNumber(data.xRange[0]), left, top + height + 13);
  ctx.textAlign = 'right'; ctx.fillText(`${plotNumber(data.xRange[1])} x${data.xUnit ? ` (${data.xUnit})` : ''}`, left + width, top + height + 13);
  ctx.textAlign = 'left'; ctx.fillText(`${plotNumber(data.yRange[1])} y${data.yUnit ? ` (${data.yUnit})` : ''}`, 4, top - 8); ctx.fillText(plotNumber(data.yRange[0]), 4, top + height);
  ctx.save(); ctx.beginPath(); ctx.moveTo(left, top); ctx.lineTo(left + width, top); ctx.lineTo(left + width, top + height); ctx.lineTo(left, top + height); ctx.closePath(); ctx.clip();
  // Family first, so the active curves remain visible and thicker.
  for (const curve of [...curves.filter(c => !c.active), ...curves.filter(c => c.active)]) {
    ctx.strokeStyle = curve.active ? ink.foreground : ink.foregroundMuted;
    ctx.lineWidth = curve.active ? 2.5 : 1; ctx.setLineDash(curve.active ? dashes[curve.expressionIndex] : [3, 5]);
    for (const segment of curve.segments) {
      ctx.beginPath();
      segment.forEach((point, i) => {
        // Clip extreme finite results before projection to avoid huge canvas coordinates.
        const safeY = Math.max(data.yRange[0] - (data.yRange[1] - data.yRange[0]), Math.min(data.yRange[1] + (data.yRange[1] - data.yRange[0]), point.y));
        if (i === 0) ctx.moveTo(px(point.x), py(safeY)); else ctx.lineTo(px(point.x), py(safeY));
      }); ctx.stroke();
    }
  }
  ctx.setLineDash([2, 3]); ctx.lineWidth = 1; ctx.strokeStyle = ink.accent;
  ctx.beginPath(); ctx.moveTo(px(traceX), top); ctx.lineTo(px(traceX), top + height); ctx.stroke();
  ctx.setLineDash([]);
  traceReadout(expressions, values, traceX).forEach(readout => {
    if (readout.y === null || readout.y < data.yRange[0] || readout.y > data.yRange[1]) return;
    ctx.fillStyle = ink.accent; ctx.beginPath(); ctx.arc(px(traceX), py(readout.y), 3, 0, Math.PI * 2); ctx.fill();
  });
  ctx.restore();
}

function FunctionPlot(props: RendererProps<FunctionPlotData>) {
  const { data, ui, runtime, scope, block, readOnly } = props;
  const expressions = useMemo(() => compilePlotExpressions(data), [data]);
  const state = plotTraceState(data, runtime.state);
  const [error, setError] = useState('');
  const names = useMemo(() => [...new Set(expressions.flatMap(e => e.compiled?.identifiers ?? []).filter(name => name !== 'x').concat(data.family ? [data.family.parameter] : []))], [expressions, data.family]);
  const live = useRef({ props, expressions, state, names }); live.current = { props, expressions, state, names };
  const hover = useRef<number | null>(null), gesture = useRef<{ pointerId: number; x: number; visited: [number, number] } | null>(null);
  const dimensions = useRef<Bounds | null>(null);
  const cached = useRef<{ data: FunctionPlotData; signature: string; curves: PlotCurve[] } | null>(null);
  // The drawing callback reads the latest optimistic props, not a network snapshot.
  const valuesNow = () => Object.fromEntries(live.current.names.filter(name => Object.hasOwn(live.current.props.scope.variables, name)).map(name => [name, live.current.props.scope.get(name)]));
  const values = valuesNow();
  const readout = plotReadoutText(data, expressions, values, state.traceX);
  const curveErrors = expressions.map(e => traceReadout([e], values, state.traceX)[0].error).filter((e): e is string => !!e);
  if (data.family && !Object.hasOwn(scope.variables, data.family.parameter)) curveErrors.push(`Falta declarar la variable ${data.family.parameter}.`);
  const report = (kind: string, x: number, visited: [number, number], reset = false) => {
    if (live.current.props.readOnly || live.current.props.ui.layout.platform !== 'web') return;
    const current = live.current, readings = traceReadout(current.expressions, valuesNow(), x);
    setError('');
    try {
      current.props.runtime.set(reset ? null : { traceX: x, visited });
      void current.props.runtime.settle(kind, { x, visited, readings: readings.map(r => ({ label: r.label, y: r.y })) }, reset ? 'Reiniciar traza' : 'Explorar la gráfica').catch(() => setError('No se pudo guardar la traza. Revisa la conexión y vuelve a intentarlo.'));
    } catch { setError('No se pudo guardar la traza. Revisa la conexión y vuelve a intentarlo.'); }
  };
  const moveTrace = (direction: number) => {
    if (live.current.props.readOnly) return;
    const current = live.current, previous = current.state;
    const x = clampPlotTrace(current.props.data, previous.traceX + direction * (current.props.data.xRange[1] - current.props.data.xRange[0]) / (current.props.data.samples - 1));
    hover.current = null; gesture.current = null;
    report('function-plot.trace', x, [Math.min(previous.visited[0], x), Math.max(previous.visited[1], x)]);
  };
  const onPointer = (pointer: SurfacePointer) => {
    if (live.current.props.readOnly || !dimensions.current) return;
    const current = live.current, x = pointerPlotX(current.props.data, dimensions.current, pointer.x);
    if (pointer.kind === 'cancel') { if (gesture.current?.pointerId === pointer.pointerId) { gesture.current = null; hover.current = null; } return; }
    if (pointer.kind === 'down') {
      if (gesture.current) return;
      gesture.current = { pointerId: pointer.pointerId, x, visited: [Math.min(current.state.visited[0], x), Math.max(current.state.visited[1], x)] };
    }
    if (gesture.current) {
      if (gesture.current.pointerId !== pointer.pointerId) return;
      gesture.current.x = x; gesture.current.visited = [Math.min(gesture.current.visited[0], x), Math.max(gesture.current.visited[1], x)];
      if (pointer.kind === 'up') {
        const final = gesture.current; gesture.current = null; hover.current = null;
        report('function-plot.trace', final.x, final.visited);
      }
    } else if (pointer.kind === 'move') hover.current = x;
  };
  const draw = (ctx: Canvas2DContext, frame: SurfaceFrame) => {
    const current = live.current, currentValues = valuesNow(), signature = JSON.stringify(currentValues);
    if (!cached.current || cached.current.data !== current.props.data || cached.current.signature !== signature) cached.current = { data: current.props.data, signature, curves: buildPlotCurves(current.props.data, current.expressions, currentValues) };
    dimensions.current = plotBounds(frame.width, frame.height, current.expressions.length);
    drawFunctionPlot(ctx, frame, current.props.data, current.expressions, cached.current.curves, currentValues, gesture.current?.x ?? hover.current ?? current.state.traceX, current.props.ui.c);
  };
  const isWeb = ui.layout.platform === 'web';
  const stageHeight = Math.max(240, Math.min(420, (props.availableWidth || 384) * 10 / 16));
  return <View nativeID={`lienzo-interactive-function-plot-${block.id}`} style={{ gap: 8 }}>
    <Txt>{data.question}</Txt>
    {isWeb ? <View style={{ backgroundColor: ui.c.surface0, borderColor: ui.c.border, borderWidth: 1, borderRadius: 8, overflow: 'hidden' }}>
      <CanvasSurface id={`function-plot-${block.id}`} label={`${data.question} Pulsa para fijar la traza o usa los botones de anterior y siguiente.`} height={stageHeight} summary={readout} animated draw={draw} onPointer={readOnly ? undefined : onPointer} onError={() => setError('No se pudo dibujar la gráfica. Vuelve a abrir el bloque.')} />
    </View> : <View style={{ gap: 4 }}><Txt kind="label" muted>Estático</Txt><NativeLearningFallback summary={readout} /></View>}
    <Txt kind="small" muted>{data.expressions.map((e, i) => `${i + 1}. ${e.label} = ${e.expression}, línea ${lineNames[i]}`).join('; ')}</Txt>
    {data.family && <Txt kind="small" muted>Familia punteada: {data.family.parameter} de {plotNumber(data.family.min)} a {plotNumber(data.family.max)}, {data.family.count} valores. Curva actual más gruesa: {plotNumber(scope.get(data.family.parameter))}.</Txt>}
    <Txt kind="small" accessibilityLiveRegion="polite">Traza fijada: {readout}</Txt>
    {!!curveErrors.length && <Txt kind="small" style={{ color: ui.c.statusDanger }}>{[...new Set(curveErrors)].join(' ')}</Txt>}
    {!curveErrors.length && traceReadout(expressions, values, state.traceX).some(r => r.y === null) && <Txt kind="small" style={{ color: ui.c.statusDanger }}>No se pudo evaluar la expresión en esta traza. El valor está fuera del dominio o el resultado no es finito.</Txt>}
    {!curveErrors.length && <Txt kind="small" muted>Los valores sin dominio dejan huecos. La gráfica usa muestreo limitado; detalles muy estrechos pueden quedar sin resolver.</Txt>}
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
      <Button label="Traza anterior" disabled={readOnly || !isWeb || state.traceX <= data.xRange[0]} style={{ minHeight: 44 }} onPress={() => moveTrace(-1)} />
      <Button label="Traza siguiente" disabled={readOnly || !isWeb || state.traceX >= data.xRange[1]} style={{ minHeight: 44 }} onPress={() => moveTrace(1)} />
      <Button label="Reiniciar" variant="ghost" disabled={readOnly || !isWeb} style={{ minHeight: 44 }} onPress={() => {
        if (live.current.props.readOnly || !isWeb) return;
        hover.current = null; gesture.current = null; cached.current = null;
        const x = initialPlotTrace(live.current.props.data); report('function-plot.reset', x, [x, x], true);
      }} />
      <Button label="Pedir una pista" variant="ghost" disabled={readOnly} style={{ minHeight: 44 }} onPress={() => {
        if (live.current.props.readOnly) return;
        setError('');
        void live.current.props.runtime.settle('function-plot.hint', { question: data.question, x: state.traceX, request: 'Dame una pista sobre esta traza sin revelar la solución.' }, 'Pedir una pista').catch(() => setError('No se pudo pedir la pista. Revisa la conexión y vuelve a intentarlo.'));
      }} />
    </View>
    {!!error && <Txt kind="small" style={{ color: ui.c.statusDanger }}>{error}</Txt>}
  </View>;
}
export const functionPlotRenderer: ClientRenderer<FunctionPlotData> = { id: 'function-plot', Component: FunctionPlot, visual: { icon: 'ChartLine', tone: 'neutro', width: 'wide' } };
