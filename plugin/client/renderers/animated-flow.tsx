import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import type { CanvasBlock } from '../../shared/model';
import {
  flowActivityAt, flowEventText, flowNumber, flowRuntimeState, flowTimeAt, seekFlow, simulateAnimatedFlow,
  type AnimatedFlowData, type FlowRuntime, type FlowSimulation,
} from '../../shared/renderers/animated-flow';
import { CanvasSurface, NativeLearningFallback, type Canvas2DContext, type SurfaceFrame } from '../Surfaces';
import { Button, Txt } from '../ui';
import { WebRange } from '../web';
import { reducedMotion } from '../motion';
import type { ClientRenderer, RendererProps } from './types';

let interactionSequence = 0;
type Report = { kind: string; payload: CanvasBlock['data']; label: string; eventId: string };
type Ink = { surface0: string; foreground: string; foregroundMuted: string; border: string; accent: string };
/** A timeline only. Tokens belong to the host's real link paths, never a second graph. */
export function drawFlowTimeline(ctx: Canvas2DContext, frame: SurfaceFrame, data: AnimatedFlowData, simulation: FlowSimulation, time: number, started: boolean, ink: Ink): void {
  const left = 20, width = Math.max(1, frame.width - 40), y = 76, x = (t: number) => left + t / data.duration * width;
  ctx.clearRect(0, 0, frame.width, frame.height); ctx.fillStyle = ink.surface0; ctx.fillRect(0, 0, frame.width, frame.height);
  ctx.save(); ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(frame.width, 0); ctx.lineTo(frame.width, frame.height); ctx.lineTo(0, frame.height); ctx.closePath(); ctx.clip();
  ctx.fillStyle = ink.foreground; ctx.font = '14px monospace'; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.fillText(`Tiempo: ${flowNumber(time)} ms`, left, 26);
  ctx.strokeStyle = ink.border; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(left, y); ctx.lineTo(left + width, y); ctx.stroke();
  ctx.strokeStyle = ink.foregroundMuted; ctx.lineWidth = 1;
  // At most 64 authored ticks, rather than hundreds of loop-generated marks.
  for (const event of data.events) { ctx.beginPath(); ctx.moveTo(x(event.t), y - 8); ctx.lineTo(x(event.t), y + 8); ctx.stroke(); }
  ctx.fillStyle = ink.accent; ctx.beginPath(); ctx.arc(x(time), y, 5, 0, Math.PI * 2); ctx.fill();
  ctx.font = '12px monospace'; ctx.fillStyle = ink.foregroundMuted;
  ctx.fillText('0 ms', left, y + 26); ctx.textAlign = 'right'; ctx.fillText(`${flowNumber(data.duration)} ms`, left + width, y + 26); ctx.textAlign = 'left';
  const activity = flowActivityAt(simulation, time);
  ctx.fillText(started ? `En tránsito: ${activity.active}; llegadas: ${activity.completed}` : 'Sin empezar', left, 136);
  ctx.restore();
}

function AnimatedFlow(props: RendererProps<AnimatedFlowData>) {
  const { data, document, runtime, ui, block, readOnly } = props;
  const isWeb = ui.layout.platform === 'web';
  const simulation = useMemo(() => simulateAnimatedFlow(data, document), [data, document]);
  const state = useRef<FlowRuntime>({ ...flowRuntimeState(data, runtime.state), playing: false });
  const source = useRef(runtime.state), armed = useRef(false), started = useRef(Object.hasOwn(runtime.state, 'playhead'));
  if (source.current !== runtime.state) {
    source.current = runtime.state; started.current = Object.hasOwn(runtime.state, 'playhead');
    const incoming = flowRuntimeState(data, runtime.state);
    state.current = { ...incoming, playing: armed.current && incoming.playing };
  }
  const live = useRef({ props, simulation }); live.current = { props, simulation };
  const visible = useRef(true), mounted = useRef(true), scrub = useRef(false), pending = useRef<Report | null>(null);
  const [error, setError] = useState(''), [, refresh] = useState(0);
  const canChange = () => !live.current.props.readOnly && live.current.props.ui.layout.platform === 'web';
  const fail = () => { if (mounted.current) setError('No se pudo guardar la interacción. Revisa la conexión y vuelve a intentarlo.'); };
  const write = (next: FlowRuntime, settled = false, reset = false) => {
    state.current = next; armed.current = next.playing; started.current = !reset;
    live.current.props.runtime.set(reset ? null : { ...next }, settled);
    if (mounted.current) refresh(next.playhead + (next.playing ? .001 : 0));
  };
  const deliver = (report: Report) => {
    pending.current = report; setError('');
    void live.current.props.runtime.settle(report.kind, report.payload, report.label, report.eventId).then(() => {
      if (pending.current === report) pending.current = null;
    }).catch(() => { if (pending.current === report) fail(); });
  };
  const report = (kind: string, next: FlowRuntime, reason: string, reset = false) => {
    if (!canChange()) return;
    const activity = flowActivityAt(live.current.simulation, next.playhead);
    try {
      write(next, true, reset);
      deliver({ kind: `animated-flow.${kind}`, payload: { playhead: next.playhead, visited: next.visited, reason,
        active: reset ? 0 : activity.active, completed: reset ? 0 : activity.completed, unresolved: live.current.simulation.issues.length, limitedBy: [...live.current.simulation.limitedBy] },
        label: reset ? 'Reiniciar flujo' : 'Explorar el flujo',
        eventId: `flow.${Date.now().toString(36)}.${(++interactionSequence).toString(36)}.${Math.random().toString(36).slice(2, 10)}` });
    } catch { fail(); }
  };
  const pause = (reason: string, feedback = true) => {
    if (!state.current.playing) return;
    const now = Date.now(), current = live.current;
    const next = seekFlow(current.props.data, state.current, flowTimeAt(current.props.data, state.current, now), now);
    armed.current = false; state.current = next;
    if (!canChange()) return;
    if (feedback) report('pause', next, reason);
    else { try { write(next, true); void current.props.runtime.flush().catch(fail); } catch { fail(); } }
  };
  // Stored playback is never an autoplay instruction. Pause on departure even if
  // the surface has not delivered its own unmount visibility notification yet.
  useEffect(() => {
    mounted.current = true;
    if (canChange() && live.current.props.runtime.state.playing === true) {
      try { write({ ...state.current, playing: false, anchorMs: 0 }, true); void live.current.props.runtime.flush().catch(fail); } catch { fail(); }
    }
    return () => { mounted.current = false; pause('departure', false); };
  }, [block.id, document.id]);
  useEffect(() => { if (readOnly || !isWeb) pause('readonly', false); }, [readOnly, isWeb]);
  // A spec revision may change the time range. This is presentation state only.
  useEffect(() => {
    state.current = flowRuntimeState(data, state.current);
    if (state.current.playing) pause('spec-change', false);
    scrub.current = false;
  }, [data]);
  const seek = (value: number) => {
    if (!canChange()) return;
    const next = seekFlow(live.current.props.data, state.current, value, Date.now());
    if (next.playhead === state.current.playhead && !state.current.playing && started.current) return;
    scrub.current = true; setError('');
    try { write(next); } catch { fail(); }
  };
  const release = (value: number) => {
    if (!canChange()) return;
    seek(value);
    if (!scrub.current) return;
    scrub.current = false; report('seek', state.current, 'release');
  };
  const draw = (ctx: Canvas2DContext, frame: SurfaceFrame) => {
    const current = live.current, now = Date.now();
    if (state.current.playing && reducedMotion.current) pause('reduced-motion');
    let time = flowTimeAt(current.props.data, state.current, now);
    if (state.current.playing && time >= current.props.data.duration) {
      const next = seekFlow(current.props.data, state.current, time, now);
      state.current = next; report('ended', next, 'ended');
    } else if (state.current.playing && mounted.current) refresh(time);
    time = flowTimeAt(current.props.data, state.current, now);
    drawFlowTimeline(ctx, frame, current.props.data, current.simulation, time, started.current, current.props.ui.c);
  };
  const time = flowTimeAt(data, state.current, Date.now()), activity = flowActivityAt(simulation, time);
  const currentEvent = (time < simulation.horizon ? simulation.events.find(e => time >= e.t && time < e.arrival) : undefined) ?? [...simulation.events].reverse().find(e => e.arrival <= Math.min(time, simulation.horizon));
  const eventRow = !data.events.length ? 'Añade eventos entre nodos conectados de este lienzo.' : !started.current ? 'Sin empezar. Recorre el tiempo para observar los eventos.'
    : currentEvent ? flowEventText(currentEvent, document) : 'No hay eventos en este instante.';
  const wasPlaying = state.current.playing;
  return <View nativeID={`lienzo-interactive-animated-flow-${block.id}`} style={{ gap: 8 }}>
    <Txt>{data.question}</Txt>
    {isWeb ? <View style={{ backgroundColor: ui.c.surface0, borderRadius: 8, borderWidth: 1, borderColor: ui.c.border, overflow: 'hidden' }}>
      <CanvasSurface id={`animated-flow-${block.id}`} label="Tiempo y actividad del flujo" height={160} summary={eventRow}
        animated={state.current.playing} maxPixelSize={1024} draw={draw}
        onVisibilityChange={value => { visible.current = value; if (!value) pause('hidden'); }}
        onError={() => { pause('surface-error'); if (mounted.current) setError('No se pudo dibujar el tiempo. Usa el control de tiempo para recorrer los eventos.'); }} />
    </View> : <View style={{ gap: 4 }}><Txt kind="label" muted>Estático</Txt><NativeLearningFallback summary={`${flowNumber(time)} ms. ${eventRow}`} /></View>}
    <View nativeID={`lienzo-interactive-animated-flow-time-${block.id}`} style={{ gap: 4 }}>
      <Txt kind="code">Tiempo: {flowNumber(time)} de {flowNumber(data.duration)} ms</Txt>
      {isWeb && <View style={{ minHeight: 44, justifyContent: 'center' }}><WebRange id={`animated-flow-${block.id}`} label="Tiempo del flujo en milisegundos" min={0} max={data.duration} step="any"
        value={time} disabled={readOnly} color={ui.c.accent} onChange={seek} onSettle={release} /></View>}
    </View>
    <Txt kind="small">{eventRow}</Txt>
    {started.current && <Txt kind="small" muted>En tránsito: {activity.active}. Llegadas: {activity.completed}.
      {Object.entries(activity.values).slice(0, 4).map(([id, value]) => ` ${[...document.blocks, ...document.groups].find(n => n.id === id)?.title || 'Nodo sin título'}: ${flowNumber(value)}.`).join('')}</Txt>}
    {!!simulation.issues.length && <Txt kind="small" style={{ color: ui.c.statusDanger }}>{[...new Set(simulation.issues.map(issue => issue.message))].join(' ')}. Ese evento queda pausado.</Txt>}
    {!!simulation.limitedBy.length && <Txt kind="small" muted>Simulación acotada{simulation.limitedBy.includes('events') ? ` a ${data.propagation?.maxEvents ?? 64} eventos` : ''}{simulation.limitedBy.includes('horizon') ? ` hasta ${flowNumber(simulation.horizon)} ms` : ''}. La actividad posterior no se calcula.</Txt>}
    <Txt kind="small" muted>Los eventos recorren las conexiones del lienzo. El tiempo de llegada incluye la demora y el recorrido. Reiniciar conserva los nodos y conexiones.</Txt>
    {reducedMotion.current && <Txt kind="small" muted>Movimiento reducido. Recorre los eventos con el control de tiempo.</Txt>}
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
      <Button label={state.current.playing ? 'Pausar' : 'Reproducir'} disabled={readOnly || !isWeb || !simulation.events.length || (!state.current.playing && (time >= data.duration || reducedMotion.current))}
        style={{ minHeight: 44 }} onPress={() => {
          if (!canChange()) return;
          if (wasPlaying) { pause('user'); return; }
          if (state.current.playing) return;
          if (!visible.current || reducedMotion.current || !live.current.simulation.events.length || state.current.playhead >= live.current.props.data.duration) return;
          scrub.current = false; setError('');
          try { write({ ...state.current, playing: true, anchorMs: Date.now() }, true); void live.current.props.runtime.flush().catch(fail); } catch { fail(); }
        }} />
      <Button label="Reiniciar" variant="ghost" disabled={readOnly || !isWeb} style={{ minHeight: 44 }} onPress={() => {
        if (!canChange()) return;
        scrub.current = false; report('reset', { playhead: 0, playing: false, anchorMs: 0, visited: [0, 0] }, 'reset', true);
      }} />
    </View>
    {!!error && <View style={{ gap: 4 }}><Txt kind="small" style={{ color: ui.c.statusDanger }}>{error}</Txt>
      {pending.current && <Button label="Reintentar" disabled={readOnly || !isWeb} onPress={() => { if (canChange() && pending.current) deliver(pending.current); }} />}
    </View>}
  </View>;
}
export const animatedFlowRenderer: ClientRenderer<AnimatedFlowData> = { id: 'animated-flow', Component: AnimatedFlow, visual: { icon: 'Workflow', tone: 'turquesa', width: 'wide' } };
