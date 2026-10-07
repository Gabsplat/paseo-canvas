import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, Platform, Pressable, View } from 'react-native';
import { IconButton, Txt, useUI } from './ui';
import { attachMiddlePan, attachWheel } from './web';

export const ZOOM = { min: .15, max: 4, step: 1.25 } as const;
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** The zoom control every movable view shares: out, the current scale (press for 100 %), in, and back to the start. */
export function ZoomPill({ percent, onOut, onIn, onActual, onFit, fitLabel = 'Encajar' }: { percent: number; onOut(): void; onIn(): void; onActual(): void; onFit(): void; fitLabel?: string }) {
  const u = useUI();
  return <View nativeID="lienzo-view-zoom" style={{ position: 'absolute', left: u.compact ? 12 : 16, bottom: u.compact ? 12 : 20, flexDirection: 'row', alignItems: 'center', gap: 2, padding: 4, borderRadius: 10, borderWidth: 1, borderColor: u.c.border, backgroundColor: u.c.surface1 }}>
    <IconButton icon="Minus" label="Alejar" onPress={onOut} />
    <Pressable accessibilityRole="button" accessibilityLabel={`Zoom ${percent} %. Volver a 100 %`} onPress={onActual} style={{ minWidth: 46, alignItems: 'center', paddingHorizontal: 4 }}><Txt kind="small" muted>{percent} %</Txt></Pressable>
    <IconButton icon="Plus" label="Acercar" onPress={onIn} />
    <IconButton icon="Maximize" label={fitLabel} onPress={onFit} />
  </View>;
}

/**
 * Native content that can be moved like the canvas: the wheel pans, command-wheel or a pinch zooms around the
 * pointer, the middle button drags, and so does a press on anything that is not itself a control. Nothing in it
 * changes; only where you stand does. `wide` lets the content be as wide as it needs instead of the viewport.
 */
export function Pannable({ id, children, wide = false, drag = true }: { id: string; children: React.ReactNode; wide?: boolean; drag?: boolean }) {
  const outer = useRef<View | null>(null), cam = useRef({ x: 0, y: 0, scale: 1 }), [percent, setPercent] = useState(100);
  const x = useRef(new Animated.Value(0)).current, y = useRef(new Animated.Value(0)).current, scale = useRef(new Animated.Value(1)).current, size = useRef({ width: 0, height: 0 });
  const set = (next: { x: number; y: number; scale: number }) => { cam.current = next; x.setValue(next.x); y.setValue(next.y); scale.setValue(next.scale); const p = Math.round(next.scale * 100); setPercent(old => old === p ? old : p); };
  const zoomAt = (px: number, py: number, to: number) => { const c = cam.current, s = clamp(to, ZOOM.min, ZOOM.max), wx = (px - c.x) / c.scale, wy = (py - c.y) / c.scale; set({ scale: s, x: px - wx * s, y: py - wy * s }); };
  const centre = () => ({ x: size.current.width / 2, y: size.current.height / 2 });
  useEffect(() => { if (Platform.OS !== 'web') return;
    const wheel = attachWheel(outer.current, e => { if (e.command) zoomAt(e.x, e.y, cam.current.scale * Math.exp(-e.dy * .002)); else set({ ...cam.current, x: cam.current.x - e.dx, y: cam.current.y - e.dy }); });
    const middle = attachMiddlePan(outer.current, e => set({ ...cam.current, x: cam.current.x + e.dx, y: cam.current.y + e.dy }));
    return () => { wheel(); middle(); };
  }, []);
  const start = useRef({ x: 0, y: 0 });
  const pan = useMemo(() => PanResponder.create({
    onMoveShouldSetPanResponder: (_, g) => drag && Math.abs(g.dx) + Math.abs(g.dy) > 4,
    onPanResponderGrant: () => { start.current = { x: cam.current.x, y: cam.current.y }; },
    onPanResponderMove: (_, g) => set({ ...cam.current, x: start.current.x + g.dx, y: start.current.y + g.dy }),
  }), [drag]);
  return <View ref={outer} nativeID={`lienzo-pan-${id}`} onLayout={e => { size.current = e.nativeEvent.layout; }} {...pan.panHandlers} style={{ flex: 1, overflow: 'hidden', ...(drag ? { cursor: 'grab' } as object : null) }}>
    <Animated.View nativeID={`lienzo-pan-${id}-content`} style={{ position: 'absolute', left: 0, top: 0, ...(wide ? null : { width: '100%' }), transformOrigin: 'top left', transform: [{ translateX: x }, { translateY: y }, { scale }] }}>{children}</Animated.View>
    <ZoomPill percent={percent} fitLabel="Volver al inicio" onOut={() => { const c = centre(); zoomAt(c.x, c.y, cam.current.scale / ZOOM.step); }} onIn={() => { const c = centre(); zoomAt(c.x, c.y, cam.current.scale * ZOOM.step); }} onActual={() => { const c = centre(); zoomAt(c.x, c.y, 1); }} onFit={() => set({ x: 0, y: 0, scale: 1 })} />
  </View>;
}
