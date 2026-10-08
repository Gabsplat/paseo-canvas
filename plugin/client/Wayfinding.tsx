import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, Pressable, View } from 'react-native';
import { Icon } from '@getpaseo/plugin/client/react-native';
import { edgeHint, minimapFit, type Box, type Point } from './logic';
import { LENSES, LENS_LABEL, type LensId, type LensKey } from './lenses';
import { withAlpha } from './color';
import { NATIVE, easeOut, reducedMotion } from './motion';
import { tokens } from './tokens';
import { Txt, useUI } from './ui';
import { islandStyle } from './whiteboard-visuals';

type Camera = { scale: number; offset: Point };
type CameraSource = { camera(): Camera; subscribe(listener: () => void): () => void };
/** Re-render with the camera, at most once per frame. */
function useCamera({ camera, subscribe }: CameraSource): Camera {
  const [, tick] = useState(0), pending = useRef<number | null>(null);
  useEffect(() => { const stop = subscribe(() => { if (pending.current === null) pending.current = requestAnimationFrame(() => { pending.current = null; tick(n => n + 1); }); }); return () => { stop(); if (pending.current !== null) cancelAnimationFrame(pending.current); }; }, [subscribe]);
  return camera();
}
export type MinimapItem = { id: string; box: Box; group: boolean; lit: boolean };
const M = tokens.canvas.minimap;
function Frame({ fit, view, source }: { fit: { k: number; x: number; y: number }; view: { width: number; height: number }; source: CameraSource }) {
  const u = useUI(), cam = useCamera(source);
  const x = -cam.offset.x / cam.scale * fit.k + fit.x, y = -cam.offset.y / cam.scale * fit.k + fit.y, w = view.width / cam.scale * fit.k, h = view.height / cam.scale * fit.k;
  return <View pointerEvents="none" style={{ position: 'absolute', left: x, top: y, width: Math.max(M.frameMin, w), height: Math.max(M.frameMin, h), borderWidth: 1.5, borderColor: u.c.accent, borderRadius: 3, backgroundColor: withAlpha(u.c.accent, M.frameFill) }} />;
}
/**
 * The whole canvas in a corner: areas as outlines, cards as marks, what is selected in the accent, and the
 * part on screen as a frame. Pressing or dragging on it carries the view there.
 */
export function Minimap({ items, content, view, source, onNavigate }: { items: readonly MinimapItem[]; content: Box; view: { width: number; height: number }; source: CameraSource; onNavigate(world: Point, animate: boolean): void }) {
  const u = useUI(), fit = useMemo(() => minimapFit(content, M), [content.x, content.y, content.width, content.height]), latest = useRef({ fit, onNavigate }); latest.current = { fit, onNavigate };
  const go = (x: number, y: number, animate: boolean) => { const f = latest.current.fit; latest.current.onNavigate({ x: (x - f.x) / f.k, y: (y - f.y) / f.k }, animate); };
  const start = useRef({ x: 0, y: 0 }), responder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => true, onMoveShouldSetPanResponder: () => true, onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: e => { start.current = { x: e.nativeEvent.locationX, y: e.nativeEvent.locationY }; go(start.current.x, start.current.y, true); },
    onPanResponderMove: (_, g) => { if (Math.abs(g.dx) + Math.abs(g.dy) > 2) go(start.current.x + g.dx, start.current.y + g.dy, false); },
  })).current;
  const marks = useMemo(() => items.map(item => { const b = item.box, style = { position: 'absolute' as const, left: b.x * fit.k + fit.x, top: b.y * fit.k + fit.y, width: Math.max(2, b.width * fit.k), height: Math.max(2, b.height * fit.k) };
    return item.group ? <View key={item.id} style={{ ...style, borderWidth: 1, borderColor: item.lit ? u.c.accent : withAlpha(u.c.foregroundMuted, M.groupAlpha), borderRadius: 2 }} />
      : <View key={item.id} style={{ ...style, borderRadius: 1, backgroundColor: item.lit ? u.c.accent : withAlpha(u.c.foregroundMuted, M.cardAlpha) }} />; }), [items, fit, u.c.accent, u.c.foregroundMuted]);
  return <View nativeID="lienzo-interactive-minimap" accessibilityRole="adjustable" accessibilityLabel="Mapa del lienzo. Pulsa o arrastra para moverte" style={[islandStyle(u), { position: 'absolute', left: tokens.island.inset, bottom: tokens.island.inset, padding: M.padding }]}>
    <View {...responder.panHandlers} style={{ width: M.width, height: M.height, overflow: 'hidden', borderRadius: 6, backgroundColor: u.c.surface0, ...({ cursor: 'pointer' } as object) }}>
      <View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0 }}>{marks}<Frame fit={fit} view={view} source={source} /></View>
    </View>
  </View>;
}
const B = tokens.canvas.beacon;
/**
 * Says where the selected thing is. Out of sight: a chip on the edge of the view, on the side it lies, that
 * takes you there. In sight but chosen from somewhere else (a file tree row, a list): one ring that opens
 * around it and fades, so the eye lands on it.
 */
export function SelectionBeacon({ id, title, box, remote, view, source, inset, onGo }: { id: string; title: string; box: Box; remote: boolean; view: { width: number; height: number }; source: CameraSource; inset: { top: number; right: number; bottom: number; left: number }; onGo(): void }) {
  const u = useUI(), cam = useCamera(source), ring = useRef(new Animated.Value(1)).current, shown = useRef(new Animated.Value(0)).current;
  const screen = { x: box.x * cam.scale + cam.offset.x, y: box.y * cam.scale + cam.offset.y, width: box.width * cam.scale, height: box.height * cam.scale };
  const hint = edgeHint(view, screen, inset), away = !!hint;
  useEffect(() => { if (remote && !reducedMotion.current) { ring.setValue(0); Animated.timing(ring, { toValue: 1, duration: B.ringMs, easing: easeOut, useNativeDriver: NATIVE }).start(); } }, [id, remote]);
  useEffect(() => { if (reducedMotion.current) shown.setValue(away ? 1 : 0); else Animated.timing(shown, { toValue: away ? 1 : 0, duration: away ? B.chipInMs : B.chipOutMs, easing: easeOut, useNativeDriver: NATIVE }).start(); }, [away]);
  const last = useRef(hint); if (hint) last.current = hint; const at = last.current;
  return <>
    {!away && <Animated.View pointerEvents="none" style={{ position: 'absolute', left: screen.x - B.ringOutset, top: screen.y - B.ringOutset, width: screen.width + 2 * B.ringOutset, height: screen.height + 2 * B.ringOutset, borderRadius: 14, borderWidth: 2, borderColor: u.c.accent, zIndex: 19,
      opacity: ring.interpolate({ inputRange: [0, .15, 1], outputRange: [0, B.ringAlpha, 0] }), transform: [{ scale: ring.interpolate({ inputRange: [0, 1], outputRange: [1, B.ringScale] }) }] }} />}
    {at && <Animated.View pointerEvents={away ? 'box-none' : 'none'} style={{ position: 'absolute', left: at.x, top: at.y, zIndex: 21, opacity: shown, transform: [{ translateX: '-50%' as unknown as number }, { translateY: '-50%' as unknown as number }, { scale: shown.interpolate({ inputRange: [0, 1], outputRange: [B.chipScale, 1] }) }] }}>
      <Pressable nativeID="lienzo-interactive-beacon" accessibilityRole="button" accessibilityLabel={`Ir a «${title}», fuera de la vista`} onPress={e => { e.stopPropagation(); onGo(); }}
        style={({ pressed, ...state }) => [islandStyle(u, true), { flexDirection: 'row', alignItems: 'center', gap: 6, paddingLeft: 6, paddingRight: 10, minHeight: B.chipHeight, maxWidth: B.chipMaxWidth, borderColor: u.c.accent, backgroundColor: pressed || (state as { hovered?: boolean }).hovered ? u.c.surface2 : u.c.surface1 }]}>
        <View style={{ width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: withAlpha(u.c.accent, .16), transform: [{ rotate: `${at.angle}deg` }] }}><Icon name="ArrowUp" size={12} color={u.c.accent} /></View>
        <Txt kind="small" numberOfLines={1} style={{ flexShrink: 1, fontWeight: '600' }}>{title || 'Selección'}</Txt>
      </Pressable>
    </Animated.View>}
  </>;
}

/**
 * Lenses keep the canvas as it is and tint every card by one thing it does not show. The control names the lens
 * in use and what each tint means; pressing it moves to the next one.
 */
export function LensControl({ lens, legend, note, bottom, onChange }: { lens: LensId; legend: readonly LensKey[]; note?: string; bottom: number; onChange(next: LensId): void }) {
  const u = useUI(), next = LENSES[(LENSES.indexOf(lens) + 1) % LENSES.length], on = lens !== 'none';
  return <View nativeID="lienzo-interactive-lens" style={[islandStyle(u), { position: 'absolute', left: tokens.island.inset, bottom, maxWidth: 260, padding: on ? 8 : tokens.island.padding, gap: 6 }]}>
    <Pressable accessibilityRole="button" accessibilityLabel={`Lente: ${LENS_LABEL[lens]}. Pulsa para ${LENS_LABEL[next]}`} onPress={e => { e.stopPropagation(); onChange(next); }}
      style={({ pressed, ...state }) => ({ minHeight: 28, paddingHorizontal: 8, borderRadius: 8, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: on ? withAlpha(u.c.accent, .14) : pressed ? withAlpha(u.c.foreground, .1) : (state as { hovered?: boolean }).hovered ? withAlpha(u.c.foreground, .06) : 'transparent' })}>
      <Icon name="Glasses" size={14} color={on ? u.c.accent : u.c.foregroundMuted} /><Txt kind="small" style={{ fontWeight: '600', color: on ? u.c.accent : u.c.foreground }}>{on ? LENS_LABEL[lens] : 'Lente'}</Txt>
    </Pressable>
    {on && legend.map(entry => <View key={entry.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 8, opacity: entry.count ? 1 : .45 }}><View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: withAlpha(u.tone(entry.tone), .6), borderWidth: 1.5, borderColor: u.tone(entry.tone) }} /><Txt kind="small" muted style={{ flex: 1 }} numberOfLines={1}>{entry.label}</Txt><Txt kind="label" muted>{entry.count}</Txt></View>)}
    {on && !!note && <Txt kind="label" muted style={{ paddingHorizontal: 8, textTransform: 'none', letterSpacing: 0 }}>{note}</Txt>}
  </View>;
}
