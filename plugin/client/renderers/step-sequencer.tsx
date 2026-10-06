import React, { useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import {
  cellOn, clampTempo, degreeMidi, midiFrequency, scaleName, sequencerDescription, sequencerRows, sequencerState, sequencerSummary, stepSeconds, toggleCell,
  type StepSequencerData, type StepSequencerState,
} from '../../shared/renderers/step-sequencer';
import { createSequencer, type StepAudioPort } from '../sequencer-audio';
import { withAlpha } from '../color';
import { Button, Chip, Txt } from '../ui';
import { WebRange, attachGridKeys, openStepAudio, useKeyboardFocus } from '../web';
import type { ClientRenderer, RendererProps } from './types';

type AudioStatus = 'idle' | 'starting' | 'playing' | 'blocked' | 'interrupted' | 'unsupported';
type Engine = ReturnType<typeof createSequencer>;
const SETTLE_MS = 600, LABEL_WIDTH = 44, GAP = 2, BEAT_GAP = 8;
export const sequencerCellId = (blockId: string, row: number, step: number) => `lienzo-interactive-sequencer-cell-${blockId}-${row}-${step}`;
/** Cell width that fits the card, with a wider gap before each beat. */
export function sequencerCellWidth(available: number, steps: number, stepsPerBeat: number): number {
  const beats = Math.ceil(steps / stepsPerBeat) - 1, gaps = (steps - 1 - beats) * GAP + beats * BEAT_GAP;
  return Math.max(12, Math.min(40, Math.floor((available - LABEL_WIDTH - GAP - gaps) / steps)));
}

function StepSequencer(props: RendererProps<StepSequencerData>) {
  const { data, block, runtime, ui, readOnly } = props;
  const [, render] = useState(0), [error, setError] = useState('');
  const live = useRef(props); live.current = props;
  const mounted = useRef(true), grid = useRef<View | null>(null), cells = useRef(new Map<string, { focus(): void }>());
  const audio = useRef<{ port: StepAudioPort; engine: Engine | null } | null>(null);
  const signature = JSON.stringify(runtime.state);
  const local = useRef({ data, documentId: props.document.id, state: sequencerState(data, runtime.state), heard: runtime.state.heard === true, signature,
    status: 'idle' as AudioStatus, step: -1, attempt: 0, dragging: false, pending: null as ReturnType<typeof setTimeout> | null, focus: { row: 0, step: 0 }, focused: false });
  const current = local.current, keyboardFocus = useKeyboardFocus(ui.layout.platform === 'web');
  const refresh = () => { if (mounted.current) render(value => value + 1); };
  const enabled = () => !live.current.readOnly && live.current.ui.layout.platform === 'web';
  const fail = () => { if (mounted.current) setError('No se pudo guardar el patrón. Revisa la conexión y vuelve a intentarlo.'); };
  const write = (settled = false) => live.current.runtime.set({ pattern: [...current.state.pattern], bpm: current.state.bpm, ...(current.heard ? { heard: true } : {}) }, settled);
  /** One settled description of the final pattern and tempo. Playback position is never reported. */
  const commit = (kind: 'pattern' | 'reset' = 'pattern') => {
    if (current.pending !== null) clearTimeout(current.pending);
    current.pending = null;
    if (!enabled()) return;
    if (mounted.current) setError('');
    try {
      if (kind === 'reset') live.current.runtime.set(null, true); else write(true);
      void live.current.runtime.settle(`step-sequencer.${kind}`, sequencerSummary(live.current.data, current.state, current.heard), kind === 'reset' ? 'Reiniciar secuenciador' : 'Cambiar el patrón del secuenciador').catch(fail);
    } catch { fail(); }
  };
  /** Stop scheduling and close the context, so queued notes cannot keep sounding. */
  const silence = (report = true) => {
    const active = audio.current;
    audio.current = null; current.attempt++; current.step = -1;
    if (!active) return;
    const played = active.engine?.played ?? 0;
    active.engine?.stop(); active.port.close();
    if (report && played >= live.current.data.steps && !current.heard) { current.heard = true; commit(); }
  };
  const edit = (next: StepSequencerState, settleNow = false) => {
    if (!enabled()) return;
    current.state = next; current.heard = false;
    try { write(); } catch { fail(); }
    if (settleNow) commit(); else { if (current.pending !== null) clearTimeout(current.pending); current.pending = setTimeout(() => commit(), SETTLE_MS); }
    refresh();
  };
  const play = () => {
    if (!enabled() || audio.current) return;
    setError('');
    const attempt = ++current.attempt, options = live.current;
    const opened = openStepAudio({ voice: options.data.voice, elementId: `lienzo-interactive-sequencer-${options.block.id}`, onInterrupt: reason => { silence(); current.status = reason === 'suspended' ? 'interrupted' : 'idle'; refresh(); } });
    if ('error' in opened) { current.status = opened.error === 'unsupported' ? 'unsupported' : 'blocked'; refresh(); return; }
    const session = { port: opened.port, engine: null as Engine | null };
    audio.current = session; current.status = 'starting'; refresh();
    void opened.ready.then(ok => {
      if (current.attempt !== attempt || audio.current !== session) { opened.port.close(); return; }
      if (!ok) { audio.current = null; current.status = 'blocked'; refresh(); return; }
      session.engine = createSequencer({
        port: opened.port,
        read: () => { const now = live.current.data; return { frequencies: now.rows.map(degree => midiFrequency(degreeMidi(now.scale, degree))), pattern: current.state.pattern, steps: now.steps, stepSeconds: stepSeconds(current.state.bpm, now.stepsPerBeat) }; },
        onStep: step => { current.step = step; refresh(); },
        onStall: () => { silence(); current.status = 'interrupted'; refresh(); },
      });
      current.status = 'playing'; session.engine.start(); refresh();
    });
  };
  const pause = () => { silence(); current.status = 'idle'; refresh(); };

  // Receive real runtime/content changes, while retaining an edit that has not settled yet.
  if (current.data !== data || current.documentId !== props.document.id) {
    silence(false); if (current.pending !== null) clearTimeout(current.pending);
    Object.assign(current, { data, documentId: props.document.id, state: sequencerState(data, runtime.state), heard: runtime.state.heard === true, signature, status: 'idle', pending: null, dragging: false });
  } else if (current.signature !== signature) {
    current.signature = signature;
    if (current.pending === null && !current.dragging) { current.state = sequencerState(data, runtime.state); current.heard = runtime.state.heard === true; }
  }
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; const pending = current.pending !== null; silence(false); if (pending) commit(); };
  }, []);
  useEffect(() => { if (readOnly || ui.layout.platform !== 'web') { silence(false); current.status = 'idle'; refresh(); } }, [readOnly, ui.layout.platform]);

  const rows = sequencerRows(data), isWeb = ui.layout.platform === 'web', disabled = readOnly || !isWeb;
  const moveFocus = (key: string) => {
    const { row, step } = current.focus;
    const next = key === 'ArrowLeft' ? { row, step: step - 1 } : key === 'ArrowRight' ? { row, step: step + 1 } : key === 'ArrowUp' ? { row: row - 1, step } : key === 'ArrowDown' ? { row: row + 1, step }
      : key === 'Home' ? { row, step: 0 } : key === 'End' ? { row, step: live.current.data.steps - 1 } : null;
    if (!next) return false;
    next.row = Math.max(0, Math.min(live.current.data.rows.length - 1, next.row)); next.step = Math.max(0, Math.min(live.current.data.steps - 1, next.step));
    current.focus = next; cells.current.get(`${next.row}:${next.step}`)?.focus(); refresh();
    return true;
  };
  useEffect(() => attachGridKeys(grid.current, moveFocus), [isWeb]);

  const { state, status, step: playhead } = current, playing = status === 'playing' || status === 'starting';
  const cell = sequencerCellWidth(props.availableWidth || 496, data.steps, data.stepsPerBeat), height = ui.compact ? 36 : 28;
  const lead = (step: number) => step === 0 ? 0 : step % data.stepsPerBeat === 0 ? BEAT_GAP : GAP;
  const description = sequencerDescription(data, state);
  const focusRow = Math.min(current.focus.row, rows.length - 1), focusStep = Math.min(current.focus.step, data.steps - 1);
  return <View nativeID={`lienzo-interactive-sequencer-${block.id}`} style={{ gap: 8 }}>
    <Txt>{data.question}</Txt>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
      <Chip label={`Escala fija: ${scaleName(data.scale)}`} icon="Lock" />
      <Txt kind="small" muted>{data.steps} pasos, {data.stepsPerBeat} por pulso</Txt>
    </View>
    <View ref={grid} accessibilityLabel={description} style={{ gap: GAP, alignSelf: 'flex-start' }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', height: 18 }}>
        <View style={{ width: LABEL_WIDTH + GAP }} />
        {Array.from({ length: data.steps }, (_, step) => <View key={step} style={{ width: cell, marginLeft: lead(step), alignItems: 'center', gap: 2 }}>
          <Txt kind="label" muted={playhead !== step} style={playhead === step ? { color: ui.c.accent, fontWeight: '700' } : undefined}>{step % data.stepsPerBeat === 0 ? String(step / data.stepsPerBeat + 1) : '·'}</Txt>
          <View style={{ width: cell, height: 2, borderRadius: 1, backgroundColor: playhead === step ? ui.c.accent : 'transparent' }} />
        </View>)}
      </View>
      {rows.map((row, display) => <View key={row.index} style={{ flexDirection: 'row', alignItems: 'center' }}>
        <Txt kind="code" numberOfLines={1} style={{ width: LABEL_WIDTH, marginRight: GAP }}>{row.label}</Txt>
        {Array.from({ length: data.steps }, (_, step) => {
          const on = cellOn(state.pattern, row.index, step), here = playhead === step, roving = display === focusRow && step === focusStep, ring = roving && current.focused && keyboardFocus;
          return <Pressable key={step} ref={node => { if (node) cells.current.set(`${display}:${step}`, node as unknown as { focus(): void }); else cells.current.delete(`${display}:${step}`); }}
            nativeID={sequencerCellId(block.id, row.index, step)} accessibilityRole="button" accessibilityLabel={`${row.note}, paso ${step + 1}, ${on ? 'suena' : 'en silencio'}`} accessibilityState={{ disabled, selected: on }}
            disabled={disabled} tabIndex={roving ? 0 : -1} onFocus={() => { current.focus = { row: display, step }; current.focused = true; refresh(); }} onBlur={() => { current.focused = false; refresh(); }}
            onPress={event => { event.stopPropagation(); edit({ ...current.state, pattern: toggleCell(current.state.pattern, row.index, step) }); }}
            style={{ width: cell, height, marginLeft: lead(step), borderRadius: 4, borderWidth: ring || (here && on) ? 2 : 1,
              borderColor: ring ? ui.c.foreground : on ? here ? ui.c.foreground : ui.c.accent : here ? ui.c.foregroundMuted : ui.c.border,
              backgroundColor: on ? ui.c.accent : here ? withAlpha(ui.c.foreground, .14) : ui.c.surface2, opacity: disabled ? .7 : 1 }} />;
        })}
      </View>)}
    </View>
    {!isWeb && <View style={{ gap: 4 }}>
      <Txt kind="label" muted>Estático</Txt>
      <Txt kind="small" muted>{description}</Txt>
      <Txt kind="small" muted>El sonido y la edición están disponibles en la versión web. Aquí no se reproduce audio.</Txt>
    </View>}
    <Txt kind="code" accessibilityLiveRegion="polite">{state.bpm} pulsos por minuto{playing && playhead >= 0 ? `, paso ${playhead + 1} de ${data.steps}` : ''}</Txt>
    {isWeb && data.tempo.min < data.tempo.max && <WebRange id={`sequencer-tempo-${block.id}`} label="Tempo en pulsos por minuto" min={data.tempo.min} max={data.tempo.max} step={1} value={state.bpm} disabled={disabled} color={ui.c.accent}
      onChange={value => { if (!enabled()) return; current.dragging = true; current.state = { ...current.state, bpm: clampTempo(data.tempo, value) }; refresh(); }}
      onSettle={value => { current.dragging = false; edit({ ...current.state, bpm: clampTempo(data.tempo, value) }, true); }} />}
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
      <Button label={playing ? 'Pausar' : status === 'blocked' || status === 'interrupted' ? 'Activar sonido' : 'Reproducir'} variant="primary" disabled={disabled || status === 'unsupported'} style={{ minHeight: 44 }} onPress={playing ? pause : play} />
      <Button label="Reiniciar" variant="ghost" disabled={disabled} style={{ minHeight: 44 }} onPress={() => {
        if (!enabled()) return;
        silence(false); current.status = 'idle'; current.dragging = false; current.heard = false;
        current.state = { pattern: [...live.current.data.pattern], bpm: live.current.data.tempo.bpm }; commit('reset'); refresh();
      }} />
    </View>
    {status === 'blocked' && <Txt kind="small" style={{ color: ui.c.statusDanger }}>No se pudo activar el sonido. El navegador o el sistema lo impidió; el patrón se conserva.</Txt>}
    {status === 'interrupted' && <Txt kind="small" style={{ color: ui.c.statusDanger }}>El sonido se detuvo porque el navegador suspendió el audio. El patrón se conserva.</Txt>}
    {status === 'unsupported' && <Txt kind="small" style={{ color: ui.c.statusDanger }}>Este navegador no ofrece audio. Puedes editar el patrón, pero no sonará.</Txt>}
    {!!error && <Txt kind="small" style={{ color: ui.c.statusDanger }}>{error}</Txt>}
  </View>;
}
export const stepSequencerRenderer: ClientRenderer<StepSequencerData> = { id: 'step-sequencer', Component: StepSequencer, visual: { icon: 'Music', tone: 'violeta', width: 'wide' } };
