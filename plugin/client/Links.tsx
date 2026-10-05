import React, { useEffect, useMemo, useRef } from 'react';
import { Pressable, View } from 'react-native';
import type { CanvasLink } from '../shared/model';
import type { LinkRoute, Point, Side } from './logic';
import { tokens } from './tokens';
import { withAlpha, type Tone } from './color';
import { Txt, useUI } from './ui';
import { mountLinkLayer, type LinkDraw } from './web';
const L = tokens.graph.link;
/** The link schema says `peligro`; Lienzo's tone system calls the same colour `riesgo`. */
export const linkTone = (link: Pick<CanvasLink, 'kind' | 'tone'>): Tone => link.tone ? (link.tone === 'peligro' ? 'riesgo' : link.tone) : L.defaultTone[link.kind];
export const linkTitle = (route: Pick<LinkRoute, 'label' | 'count' | 'kind'>) => route.label || (route.count > 1 ? `${route.count} enlaces` : tokens.graph.kinds[route.kind]);
export type LinkFocus = { routes: Set<string> } | null;
/**
 * Connectors between frames. At rest every link is quiet ink; a link with an explicit tone keeps a hint of it.
 * With something in focus, its links take their full tone and weight and everything else recedes.
 */
export function LinkLayer({ routes, origin, width, height, focus, selected, draft, marks, onPress, onHover }: { routes: LinkRoute[]; marks?: React.RefObject<View | null>; origin: Point; width: number; height: number; focus: LinkFocus; selected: string | null; draft: { from: Point; to: Point; side: Side; valid: boolean } | null; onPress: (key: string) => void; onHover: (key: string | null) => void }) {
  const u = useUI(), host = useRef<View>(null), layer = useRef<ReturnType<typeof mountLinkLayer>>(null), handlers = useRef({ onPress, onHover }); handlers.current = { onPress, onHover };
  const web = u.layout.platform === 'web';
  const styled = useMemo(() => routes.map(route => {
    const active = !!focus?.routes.has(route.key) || selected === route.key, dimmed = !!focus && !active, tone = u.tone(linkTone(route));
    const color = active ? tone : route.tone && route.tone !== 'neutro' ? tone : u.c.foregroundMuted;
    return { route, active, color, opacity: dimmed ? L.alpha.dim : active ? 1 : route.tone && route.tone !== 'neutro' ? L.alpha.toned : L.alpha.rest, width: active ? L.widthActive : L.width, text: route.label.length > L.label.maxChars ? `${route.label.slice(0, L.label.maxChars - 1)}…` : route.label };
  }), [routes, focus, selected, u]);
  useEffect(() => {
    if (!web) return;
    layer.current = mountLinkLayer(host.current, { onPress: key => handlers.current.onPress(key), onHover: key => handlers.current.onHover(key) }, marks?.current);
    return () => { layer.current?.destroy(); layer.current = null; };
  }, [web]);
  useEffect(() => {
    if (!layer.current) return;
    const draws: LinkDraw[] = styled.flatMap(({ route, active, color, opacity, width, text }) => {
      // A lit bundle opens into one strand per link, each in its own tone and line style. The bundle's own path stays
      // underneath, invisible, so the pointer target never changes while hovering.
      const strands = active && route.count > 1 && route.count <= L.strands.max, across = route.endSide === 'top' || route.endSide === 'bottom';
      return [{
      key: route.key, d: route.d, color, width, opacity: strands ? 0 : opacity, dash: L.dash[route.kind], interactive: true, title: linkTitle(route),
      arrow: { ...route.end, side: route.endSide, length: L.arrow.length, width: L.arrow.width },
      label: text ? { ...route.labelPoint, text, color: active ? u.c.foreground : u.c.foregroundMuted } : null,
      badge: route.count > 1 ? { ...route.badgePoint, text: String(route.count), fill: active ? u.c.foreground : u.c.surface2, color: active ? u.c.surface0 : u.c.foreground, radius: L.badge.radius } : null,
      }, ...(strands ? route.links.map((link, i): LinkDraw => { const offset = (i - (route.count - 1) / 2) * L.strands.gap; return { key: `${route.key}#${i}`, d: route.d, color: u.tone(linkTone(link)), width, opacity: 1, dash: L.dash[link.kind], interactive: false, title: '', shift: across ? { x: offset, y: 0 } : { x: 0, y: offset }, arrow: { ...route.end, side: route.endSide, length: L.arrow.length, width: L.arrow.width }, label: null, badge: null }; }) : [])];
    });
    if (draft) {
      const reach = Math.max(L.curve.min, Math.min(L.curve.max, Math.hypot(draft.to.x - draft.from.x, draft.to.y - draft.from.y) / 2)), n = draft.side === 'bottom' ? { x: 0, y: 1 } : draft.side === 'top' ? { x: 0, y: -1 } : draft.side === 'left' ? { x: -1, y: 0 } : { x: 1, y: 0 };
      draws.push({ key: '\u0000draft', d: `M${draft.from.x} ${draft.from.y} C${draft.from.x + n.x * reach} ${draft.from.y + n.y * reach} ${draft.to.x} ${draft.to.y} ${draft.to.x} ${draft.to.y}`, color: u.c.accent, width: L.widthActive, opacity: draft.valid ? 1 : .6, dash: draft.valid ? '' : '4 4', interactive: false, title: '', arrow: null, label: null, badge: null });
    }
    layer.current.update({ draws, origin, halo: u.c.surface0, font: 'system-ui, -apple-system, "Segoe UI", sans-serif', labelSize: L.label.size, badgeSize: L.badge.size, hitWidth: L.hitWidth });
  }, [styled, draft, origin.x, origin.y, u]);
  // Native fallback (also covers a web host without SVG): elbow segments made of Views, like the diagram block.
  const fallback = !web;
  return <View ref={host} pointerEvents="box-none" style={{ position: 'absolute', left: 0, top: 0, width, height }}>
    {fallback && styled.map(({ route, active, color, opacity, width, text }) => {
      const dashed = route.kind !== 'flow', rotate = route.endSide === 'top' ? '45deg' : route.endSide === 'left' ? '-45deg' : route.endSide === 'right' ? '135deg' : '225deg';
      return <React.Fragment key={route.key}>
        {route.elbow.map((s, i) => { const horizontal = s.from.y === s.to.y; return <View key={i} pointerEvents="none" style={{ position: 'absolute', left: Math.min(s.from.x, s.to.x) - origin.x, top: Math.min(s.from.y, s.to.y) - origin.y, width: horizontal ? Math.abs(s.to.x - s.from.x) : dashed ? 0 : width, height: horizontal ? dashed ? 0 : width : Math.abs(s.to.y - s.from.y), opacity, backgroundColor: dashed ? 'transparent' : color, borderStyle: route.kind === 'reference' ? 'dotted' : dashed ? 'dashed' : 'solid', borderColor: color, borderTopWidth: dashed && horizontal ? width : 0, borderLeftWidth: dashed && !horizontal ? width : 0 }} />; })}
        <View pointerEvents="none" style={{ position: 'absolute', left: route.end.x - origin.x - 3 + (route.endSide === 'left' ? -4 : route.endSide === 'right' ? 4 : 0), top: route.end.y - origin.y - 3 + (route.endSide === 'top' ? -4 : route.endSide === 'bottom' ? 4 : 0), width: 6, height: 6, opacity, borderRightWidth: 1.5, borderBottomWidth: 1.5, borderColor: color, transform: [{ rotate }] }} />
        <Pressable accessibilityRole="button" accessibilityLabel={`Enlace: ${linkTitle(route)}`} hitSlop={10} onPress={e => { e.stopPropagation(); onPress(route.key); }} style={{ position: 'absolute', left: route.labelPoint.x - origin.x - 80, top: route.labelPoint.y - origin.y - 10, width: 160, height: 20, alignItems: 'center', justifyContent: 'center', opacity: Math.min(1, opacity * 1.6) }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: 160, paddingHorizontal: 5, minHeight: 16, borderRadius: 8, backgroundColor: u.c.surface0, borderWidth: active ? 1 : 0, borderColor: color }}>
            {!text && route.count < 2 && <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }} />}
            {!!text && <Txt kind="small" numberOfLines={1} muted={!active} style={{ fontSize: L.label.size, lineHeight: L.label.lineHeight, flexShrink: 1 }}>{text}</Txt>}
            {route.count > 1 && <Txt kind="label" style={{ color: active ? color : u.c.foregroundMuted, letterSpacing: 0 }}>{route.count}</Txt>}
          </View>
        </Pressable>
      </React.Fragment>;
    })}
    {fallback && draft && <View pointerEvents="none" style={{ position: 'absolute', left: draft.to.x - origin.x - 5, top: draft.to.y - origin.y - 5, width: 10, height: 10, borderRadius: 5, borderWidth: 2, borderColor: withAlpha(u.c.accent, draft.valid ? 1 : .5) }} />}
  </View>;
}
