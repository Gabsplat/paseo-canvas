import React, { useEffect, useRef, useState } from 'react';
import { Image, Pressable, View } from 'react-native';
import { Icon } from '@getpaseo/plugin/client/react-native';
import {
  annotatedDefinitionKey, annotatedExplorationPayload, initialAnnotatedState, readAnnotatedState, resolveAnnotatedAnchor,
  type AnnotatedAnnotation, type AnnotatedContentData, type AnnotatedContentState,
} from '../../shared/renderers/annotated-content';
import { safeUrl, newId } from '../logic';
import { Button, Chip, Txt } from '../ui';
import { NativeLearningFallback } from '../Surfaces';
import { imageLoadDimensions } from '../web';
import type { ClientRenderer, RendererProps } from './types';

/** A contain image in a frame with its confirmed intrinsic ratio has no letterboxing. */
export function annotatedImageFrame(width: number, intrinsicWidth: number, intrinsicHeight: number) {
  if (![width, intrinsicWidth, intrinsicHeight].every(n => Number.isFinite(n) && n > 0)) return null;
  return { width, height: width * intrinsicHeight / intrinsicWidth };
}
export function annotatedImageGeometry(annotation: AnnotatedAnnotation, frame: { width: number; height: number }) {
  const anchor = annotation.anchor;
  if (anchor.kind === 'text-range') return null;
  const rect = anchor.kind === 'image-rect' ? { left: anchor.x * frame.width, top: anchor.y * frame.height, width: anchor.width * frame.width, height: anchor.height * frame.height } : null;
  return { x: (anchor.x + (anchor.kind === 'image-rect' ? anchor.width / 2 : 0)) * frame.width,
    y: (anchor.y + (anchor.kind === 'image-rect' ? anchor.height / 2 : 0)) * frame.height, rect };
}
type ImageStatus = { source: string; status: 'loaded' | 'error'; width: number; height: number };
type Pending = { definitionKey: string; eventId: string; kind: string; payload: Record<string, string | string[] | null>; label: string };

export function AnnotatedContent(props: RendererProps<AnnotatedContentData>) {
  const { data, block, runtime, readOnly, ui, compact, availableWidth } = props;
  const definitionKey = annotatedDefinitionKey(data), runtimeKey = JSON.stringify(runtime.state);
  const [local, setLocal] = useState(readAnnotatedState(data, runtime.state));
  const [image, setImage] = useState<ImageStatus | null>(null), [measuredWidth, setMeasuredWidth] = useState(0);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [pending, setPending] = useState<Pending | null>(null);
  const state = readAnnotatedState(data, local), current = useRef(state), latest = useRef(props), flight = useRef(false);
  current.current = state; latest.current = props;
  useEffect(() => { const next = readAnnotatedState(data, runtime.state); current.current = next; setLocal(next); }, [runtimeKey, definitionKey]);
  const editable = () => !latest.current.readOnly && latest.current.ui.layout.platform === 'web';
  const persist = (next: AnnotatedContentState | null) => {
    if (!editable()) return;
    const value = next ?? initialAnnotatedState(latest.current.data);
    current.current = value; setLocal(value); setError('');
    latest.current.runtime.set(next, true);
    void latest.current.runtime.flush().catch(() => setError('No se pudo guardar la exploración. Vuelve a intentar cuando haya conexión.'));
  };
  const source = data.base.kind === 'image' ? JSON.stringify([data.base.key, data.base.revision, data.base.url]) : '';
  const safe = data.base.kind === 'image' ? safeUrl(data.base.url) : null;
  const loaded = image?.source === source && image.status === 'loaded' && !!safe;
  const width = measuredWidth || Math.max(1, availableWidth);
  const frame = loaded && measuredWidth > 0 ? annotatedImageFrame(width, image.width, image.height) : null;
  const imageReady = useRef(false); imageReady.current = !!frame;
  const height = frame?.height ?? (data.base.kind === 'image' ? width / data.base.aspectRatio : 0);
  const status = image?.source === source && image.status === 'error' || !safe ? 'No se pudo cargar la imagen. Las anclas no se muestran sobre una imagen ausente.' : 'Cargando imagen. Las anclas estarán disponibles cuando termine la carga.';
  const visible = data.annotations.filter(a => state.visibleLayers.includes(a.anchor.layerId));
  const resolved = (a: AnnotatedAnnotation) => resolveAnnotatedAnchor(data, a.anchor);
  const selected = visible.find(a => a.id === state.selected && resolved(a).resolved);
  const select = (id: string) => {
    if (!editable()) return;
    const activeData = latest.current.data, activeState = readAnnotatedState(activeData, current.current);
    const annotation = activeData.annotations.find(a => a.id === id);
    if (!annotation || !resolveAnnotatedAnchor(activeData, annotation.anchor).resolved || !activeState.visibleLayers.includes(annotation.anchor.layerId)) return;
    if (annotation.anchor.kind !== 'text-range' && !imageReady.current) return;
    if (activeState.selected === id) return;
    persist({ ...activeState, selected: id, explored: [...new Set([...activeState.explored, id])], visitedLayers: [...new Set([...activeState.visitedLayers, annotation.anchor.layerId])] });
  };
  const toggle = (id: string) => {
    if (!editable()) return;
    const activeData = latest.current.data, activeState = readAnnotatedState(activeData, current.current);
    if (!activeData.layers.some(l => l.id === id)) return;
    const visibleLayers = activeState.visibleLayers.includes(id) ? activeState.visibleLayers.filter(l => l !== id) : [...activeState.visibleLayers, id];
    const annotation = activeData.annotations.find(a => a.id === activeState.selected);
    persist({ ...activeState, visibleLayers, selected: annotation && visibleLayers.includes(annotation.anchor.layerId) ? annotation.id : null,
      visitedLayers: [...new Set([...activeState.visitedLayers, id])] });
  };
  const deliver = async (action: Pending) => {
    if (!editable() || flight.current || action.definitionKey !== annotatedDefinitionKey(latest.current.data)) return;
    flight.current = true; setBusy(true); setError(''); setPending(action);
    try {
      await latest.current.runtime.flush();
      if (!editable() || action.definitionKey !== annotatedDefinitionKey(latest.current.data)) return;
      await latest.current.runtime.settle(action.kind, action.payload, action.label, action.eventId);
      setPending(null);
    } catch { setError('No se pudo confirmar el envío. Reintentar conserva el mismo envío para evitar duplicados.'); }
    finally { flight.current = false; setBusy(false); }
  };
  const share = (hint: boolean) => {
    if (!editable() || flight.current || pending?.definitionKey === annotatedDefinitionKey(latest.current.data)) return;
    const payload = annotatedExplorationPayload(readAnnotatedState(latest.current.data, current.current));
    void deliver({ definitionKey, eventId: newId('evt'), kind: hint ? 'annotated-content.hint' : 'annotated-content.exploration',
      payload: hint ? { ...payload, request: 'Da una pista sobre el objetivo y las anotaciones exploradas sin revelar la solución.' } : payload,
      label: hint ? 'Pedir una pista' : 'Compartir exploración' });
  };
  const hit = compact || ui.compact ? 44 : 32;
  const mark = (a: AnnotatedAnnotation, index: number, position?: { x: number; y: number }) => <Pressable key={a.id}
    nativeID={`lienzo-interactive-annotation-${block.id}-${a.id}`} accessibilityRole="button" accessibilityLabel={`Anotación ${index + 1}: ${a.title}`}
    accessibilityState={{ disabled: readOnly, selected: state.selected === a.id }} disabled={readOnly}
    onPress={event => { event.stopPropagation(); select(a.id); }} onFocus={() => select(a.id)}
    style={{ width: hit, height: hit, alignItems: 'center', justifyContent: 'center', ...(position ? { position: 'absolute', left: position.x - hit / 2, top: position.y - hit / 2 } : {}) }}>
    <View style={{ width: 22, height: 22, borderRadius: 11, borderWidth: 1, borderColor: ui.c.foreground,
      backgroundColor: state.selected === a.id ? ui.c.accent : ui.c.surface1, alignItems: 'center', justifyContent: 'center' }}>
      <Txt kind="small" style={{ color: state.selected === a.id ? ui.c.accentForeground : ui.c.foreground, fontWeight: '600' }}>{index + 1}</Txt>
    </View>
  </Pressable>;
  const staticAnnotations = data.annotations.map((a, index) => `${index + 1}. ${a.title}: ${a.text}${resolved(a).message ? ` ${resolved(a).message}` : ''}`).join('\n');
  if (ui.layout.platform !== 'web') return <View style={{ gap: 8 }}><Txt>{data.question}</Txt><Chip label="Estático" />
    <NativeLearningFallback summary={`${data.base.kind === 'text' ? data.base.passages.map(p => p.text).join('\n') || 'Todavía no hay contenido base.' : `Imagen de referencia: ${data.base.alt}. La imagen no se ha verificado en esta vista estática.`}\n${staticAnnotations}`} />
    <Txt kind="small" muted>{data.layers.map(l => `${l.name}: ${l.visible ? 'visible' : 'oculta'}`).join(' · ')}</Txt>
    <Button label="Reiniciar" disabled onPress={() => {}} />
  </View>;
  return <View style={{ gap: 8 }}><Txt>{data.question}</Txt>
    {!!data.layers.length && <View nativeID={`lienzo-interactive-annotation-layers-${block.id}`} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
      {data.layers.map(layer => { const checked = state.visibleLayers.includes(layer.id); return <Pressable key={layer.id} accessibilityRole="checkbox"
        accessibilityLabel={layer.name} accessibilityState={{ checked, disabled: readOnly }} disabled={readOnly}
        onPress={event => { event.stopPropagation(); toggle(layer.id); }} style={{ minHeight: hit, paddingHorizontal: 6, borderRadius: 6, borderWidth: 1,
          borderColor: checked ? ui.c.accent : ui.c.border, backgroundColor: checked ? ui.c.surface2 : ui.c.surface0, flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <Icon name={checked ? 'Eye' : 'EyeOff'} size={12} color={ui.c.foreground} /><Txt kind="small" style={{ fontWeight: '600' }}>{layer.name}</Txt>
      </Pressable>; })}
    </View>}
    <View nativeID={`lienzo-interactive-annotation-stage-${block.id}`} style={{ gap: 8, padding: 8, borderRadius: 8, borderWidth: 1, borderColor: ui.c.border, backgroundColor: ui.c.surface0 }}>
      {data.base.kind === 'image' ? <>
        <View onLayout={event => { const next = event.nativeEvent.layout.width; if (Number.isFinite(next) && next > 0) setMeasuredWidth(next); }} style={{ height, position: 'relative', margin: hit / 2 }}>
          {safe && <Image key={source} source={{ uri: safe }} accessibilityLabel={data.base.alt} accessible resizeMode="contain" style={{ width: '100%', height: '100%' }}
            onLoad={event => {
              const base = latest.current.data.base;
              if (base.kind !== 'image' || JSON.stringify([base.key, base.revision, base.url]) !== source) return;
              const dimensions = imageLoadDimensions(event);
              setImage(dimensions ? { source, status: 'loaded', ...dimensions } : { source, status: 'error', width: 0, height: 0 });
            }} onError={() => { const base = latest.current.data.base; if (base.kind === 'image' && JSON.stringify([base.key, base.revision, base.url]) === source) setImage({ source, status: 'error', width: 0, height: 0 }); }} />}
          {frame && visible.map(a => { const index = data.annotations.indexOf(a), geometry = annotatedImageGeometry(a, frame); if (!resolved(a).resolved || !geometry) return null;
            return <React.Fragment key={a.id}>{geometry.rect && <View pointerEvents="none" style={{ position: 'absolute', ...geometry.rect, borderWidth: 2, borderColor: ui.c.foreground }} />}{mark(a, index, geometry)}</React.Fragment>;
          })}
        </View>
        <Txt kind="small" muted>{data.base.alt}</Txt>{!frame && <Txt kind="small" muted>{status}</Txt>}
      </> : data.base.passages.length ? data.base.passages.map(passage => {
        // Split only at validated boundaries. Overlapping ranges remain readable once, with
        // separately numbered keyboard targets below each passage.
        const anchors = visible.filter(a => a.anchor.kind === 'text-range' && a.anchor.passageId === passage.id && resolved(a).resolved);
        const boundaries = [...new Set([0, passage.text.length, ...anchors.flatMap(a => a.anchor.kind === 'text-range' ? [a.anchor.start, a.anchor.end] : [])])].sort((a, b) => a - b);
        return <View key={passage.id} style={{ gap: 4 }}><Txt>{boundaries.slice(0, -1).map((start, i) => {
          const end = boundaries[i + 1], highlighted = anchors.some(a => a.anchor.kind === 'text-range' && a.anchor.start <= start && a.anchor.end >= end);
          return <Txt key={start} style={highlighted ? { backgroundColor: ui.c.surface2, textDecorationLine: 'underline' } : undefined}>{passage.text.slice(start, end)}</Txt>;
        })}</Txt><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>{anchors.map(a => mark(a, data.annotations.indexOf(a)))}</View></View>;
      }) : <Txt muted>Todavía no hay contenido base. Añade una imagen o un pasaje para observarlo.</Txt>}
      {!!selected && (selected.anchor.kind === 'text-range' || frame) && <View accessibilityLiveRegion="polite" style={{ gap: 4 }}>
        <Txt kind="label">{data.annotations.indexOf(selected) + 1}. {selected.title}</Txt>
        {!!resolved(selected).excerpt && <Txt kind="small" muted>{resolved(selected).excerpt}</Txt>}<Txt>{selected.text}</Txt>
      </View>}
      {data.annotations.filter(a => !resolved(a).resolved).map(a => <View key={a.id} style={{ gap: 4 }}><Txt kind="small" style={{ color: ui.c.statusDanger }}>{a.title}. {resolved(a).message}</Txt><Txt kind="small">{a.text}</Txt></View>)}
      {data.base.kind === 'image' && !frame && visible.filter(a => resolved(a).resolved).map(a => <Txt key={a.id} kind="small">{data.annotations.indexOf(a) + 1}. {a.title}: {a.text} Ancla pendiente de verificar en la imagen.</Txt>)}
      {!data.annotations.length && <Txt kind="small" muted>Todavía no hay anotaciones.</Txt>}
    </View>
    <View nativeID={`lienzo-interactive-annotation-actions-${block.id}`} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
      <Button label="Reiniciar" icon="RotateCcw" variant="ghost" disabled={readOnly || busy} onPress={() => { if (editable() && !flight.current) persist(null); }} />
      <Button label="Compartir exploración" disabled={readOnly || busy || !!pending && pending.definitionKey === definitionKey} onPress={() => share(false)} />
      <Button label="Pedir una pista" variant="ghost" disabled={readOnly || busy || !!pending && pending.definitionKey === definitionKey} onPress={() => share(true)} />
      {pending?.definitionKey === definitionKey && <Button label="Reintentar envío" disabled={readOnly || busy} onPress={() => { if (editable()) void deliver(pending); }} />}
    </View>
    {!!error && <Txt kind="small" style={{ color: ui.c.statusDanger }}>{error}</Txt>}
  </View>;
}
export const annotatedContentRenderer: ClientRenderer<AnnotatedContentData> = {
  id: 'annotated-content', Component: AnnotatedContent, visual: { icon: 'Image', tone: 'neutro', width: 'wide' },
};
