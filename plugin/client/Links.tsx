import React, { useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import type { CanvasLink } from '../shared/model';
import { bundleShapes, linkRoutes, type BundleShape, type CanvasLayout, type FrameShift, type LinkRoute, type Point, type Side } from './logic';
import type { CanvasDocument } from '../shared/model';
import { tokens } from './tokens';
import { withAlpha, type Tone } from './color';
import { Txt, useUI } from './ui';
import { mountLinkLayer, type BandDraw, type LinkDraw, type TieDraw } from './web';
import type { LinkMotionSample } from './renderers/types';
const L = tokens.graph.link, B = L.bundle;
/** The link schema says `peligro`; Lienzo's tone system calls the same colour `riesgo`. */
export const linkTone = (link: Pick<CanvasLink, 'kind' | 'tone'>): Tone => link.tone ? (link.tone === 'peligro' ? 'riesgo' : link.tone) : L.defaultTone[link.kind];
export const linkTitle = (route: Pick<LinkRoute, 'label' | 'count' | 'kind'>) => route.label || (route.count > 1 ? `${route.count} links` : tokens.graph.kinds[route.kind]);
export type LinkFocus = { routes: Set<string> } | null;
/**
 * Connectors between frames. At rest every link is quiet ink; a link with an explicit tone keeps a hint of it.
 * With something in focus, its links take their full tone and weight and everything else recedes.
 */
/** `follow()` redraws the connectors against where the frames are right now; the canvas calls it on every drag and glide frame. */
/** `cut`: the straight Alt-drag line that gathers the links it crosses into a bundle. */
export type LinkDraft = { from: Point; to: Point; side: Side; endSide?: Side; valid: boolean; cut?: boolean };
export type LinkLayerHandle = { follow(): void; preview(draft: LinkDraft | null): void };
/** A bundle's clips while the hand holds them: drawn there before the one write on release. */
export type BundleMove = { id: string; points: Point[] } | null;
/** What a bundle shows: `selected` rings its clips and lays a band under its lanes; `hot` (hover) lays the band only. */
export type BundleFocus = { selected: string | null; hot: string | null };
/**
 * `routes` is the geometry at rest. While frames are away from their place (`shift` returns their offset: a drag, a
 * glide to a new layout) the same links are re-routed from `doc` and `layout` without going through a React render on web.
 */
export function LinkLayer({ routes, doc, layout, shift, handle, origin, width, height, focus, selected, picked, bundles, moving, draft, draftRef, marks, motion, onPress, onHover }: { routes: LinkRoute[]; doc?: CanvasDocument; layout?: CanvasLayout; shift?: (id: string) => FrameShift | undefined; handle?: React.Ref<LinkLayerHandle>; marks?: React.RefObject<View | null>; motion?: (epochMs: number) => LinkMotionSample; origin: Point; width: number; height: number; focus: LinkFocus; selected: string | null;
  /** Links selected together (Shift-click), drawn lit like the selected one. */
  picked?: ReadonlySet<string>; bundles?: BundleFocus; moving?: React.RefObject<BundleMove>;
  draft: LinkDraft | null; draftRef?: React.RefObject<LinkDraft | null>; onPress: (key: string, add: boolean) => void; onHover: (key: string | null) => void }) {
  const u = useUI(), host = useRef<View>(null), layer = useRef<ReturnType<typeof mountLinkLayer>>(null), handlers = useRef({ onPress, onHover }); handlers.current = { onPress, onHover };
  const web = u.layout.platform === 'web', [, setTick] = useState(0);
  // Same links, same keys; only the geometry differs while something is off its place.
  const held = (id: string) => moving?.current?.id === id ? moving.current.points : undefined;
  const away = () => !!doc && !!layout && (!!moving?.current || !!shift && [...layout.rects.keys()].some(id => shift(id)));
  const moved = away() ? new Map(linkRoutes(doc!, layout!, shift, held).map(route => [route.key, route])) : null;
  const live = (route: LinkRoute) => moved?.get(route.key) ?? route;
  // A dense canvas rests calm: connectors between areas recede and drop their labels until something is in focus.
  const dense = useMemo(() => routes.filter(route => route.across).length > L.calm.threshold, [routes]);
  const styled = useMemo(() => routes.map(route => {
    const active = !!focus?.routes.has(route.key) || selected === route.key || route.links.some(l => picked?.has(l.id)), dimmed = !!focus && !active, tone = u.tone(linkTone(route));
    // A lane of a bundle keeps its own colour at rest: a strand reads as neat coloured wires, never as one grey rope.
    if (route.bundle) return { route, active, color: tone, opacity: dimmed ? B.alpha.dim : active ? 1 : B.alpha.rest, width: active ? B.widthActive : B.width, text: active || !dense ? route.label.length > L.label.maxChars ? `${route.label.slice(0, L.label.maxChars - 1)}…` : route.label : '' };
    const calm = dense && !active && route.across;
    const color = active ? tone : route.tone && route.tone !== 'neutro' ? tone : u.c.foregroundMuted;
    return { route, active, color, opacity: dimmed ? L.alpha.dim : calm ? L.calm.alpha : active ? 1 : route.tone && route.tone !== 'neutro' ? L.alpha.toned : L.alpha.rest, width: active ? L.widthActive : L.width, text: dense && !active ? '' : route.label.length > L.label.maxChars ? `${route.label.slice(0, L.label.maxChars - 1)}…` : route.label };
  }), [routes, focus, selected, picked, u, dense]);
  /** Clips and bands for the bundles drawn now; `current` is the re-routed geometry while something is away. */
  const bundleDraws = (current: Map<string, LinkRoute> | null): { shapes: BundleShape[]; ties: TieDraw[]; bands: BandDraw[] } => {
    if (!doc?.bundles?.length || !layout) return { shapes: [], ties: [], bands: [] };
    const shapes = bundleShapes(doc, layout, current ? [...current.values()] : routes, shift, held), lit = new Set(styled.filter(s => s.active && s.route.bundle).map(s => s.route.bundle!.id));
    const ties = shapes.flatMap(shape => { const chosen = bundles?.selected === shape.id, faded = !!focus && !lit.has(shape.id) && !chosen;
      return shape.ties.map((tie, i): TieDraw => ({ key: `${shape.id}#${i}`, ...tie, length: tie.length + (chosen ? 2 : 0), thickness: B.clip.thickness + (chosen ? 1.5 : 0), fill: u.tone(B.clip.tone), halo: chosen ? u.c.foreground : u.c.surface0, haloWidth: chosen ? 1.5 : B.clip.halo, grip: u.c.accentForeground, opacity: faded ? .4 : 1 })); });
    const bands = shapes.filter(shape => bundles?.selected === shape.id || bundles?.hot === shape.id).map((shape): BandDraw => ({ key: shape.id, d: shape.spine, width: shape.span + 2 * B.spine.bandPad, color: u.c.accent, opacity: B.spine.bandAlpha * (bundles?.selected === shape.id ? 1.6 : 1) }));
    return { shapes, ties, bands };
  };
  useEffect(() => {
    if (!web) return;
    layer.current = mountLinkLayer(host.current, { onPress: (key, add) => handlers.current.onPress(key, add), onHover: key => handlers.current.onHover(key) }, marks?.current);
    return () => { layer.current?.destroy(); layer.current = null; };
  }, [web]);
  const draw = (current: Map<string, LinkRoute> | null) => {
    if (!layer.current) return;
    const draws: LinkDraw[] = styled.flatMap(({ route: rest, active, color, opacity, width, text }) => {
      const route = current?.get(rest.key) ?? rest;
      // A lit bundle opens into one strand per link, each in its own tone and line style. The bundle's own path stays
      // underneath, invisible, so the pointer target never changes while hovering.
      const strands = active && route.count > 1 && route.count <= L.strands.max, across = route.endSide === 'top' || route.endSide === 'bottom';
      return [{
      key: route.key, linkIds: strands ? [] : route.links.map(link => link.id), d: route.d, color, width, opacity: strands ? 0 : opacity, dash: L.dash[route.kind], interactive: true, title: linkTitle(route), ...(route.bundle ? { hit: B.hitWidth } : {}),
      arrow: { ...route.end, side: route.endSide, length: L.arrow.length, width: L.arrow.width },
      label: text ? { ...route.labelPoint, text, color: active ? u.c.foreground : u.c.foregroundMuted } : null,
      badge: route.count > 1 ? { ...route.badgePoint, text: String(route.count), fill: active ? u.c.foreground : u.c.surface2, color: active ? u.c.surface0 : u.c.foreground, radius: L.badge.radius } : null,
      }, ...(strands ? route.links.map((link, i): LinkDraw => { const offset = (i - (route.count - 1) / 2) * L.strands.gap; return { key: `${route.key}#${i}`, linkIds: [link.id], d: route.d, color: u.tone(linkTone(link)), width, opacity: 1, dash: L.dash[link.kind], interactive: false, title: '', shift: across ? { x: offset, y: 0 } : { x: 0, y: offset }, arrow: { ...route.end, side: route.endSide, length: L.arrow.length, width: L.arrow.width }, label: null, badge: null }; }) : [])];
    });
    const currentDraft = draftRef ? draftRef.current : draft;
    layer.current.preview(draftDraw(currentDraft));
    const { ties, bands } = bundleDraws(current);
    layer.current.update({ draws, origin, halo: u.c.surface0, font: 'system-ui, -apple-system, "Segoe UI", sans-serif', labelSize: L.label.size, badgeSize: L.badge.size, hitWidth: L.hitWidth, motion, ties, bands });
  };
  function draftDraw(value: LinkDraft | null) {
    if (!value) return null;
    if (value.cut) return { d: `M${value.from.x} ${value.from.y} L${value.to.x} ${value.to.y}`, color: u.c.accent, width: L.widthActive, opacity: value.valid ? 1 : .55, dash: '5 4' };
    const reach = Math.max(L.curve.min, Math.min(L.curve.max, Math.hypot(value.to.x - value.from.x, value.to.y - value.from.y) / 2));
    const normal = (side?: Side) => side === 'bottom' ? { x: 0, y: 1 } : side === 'top' ? { x: 0, y: -1 } : side === 'left' ? { x: -1, y: 0 } : side === 'right' ? { x: 1, y: 0 } : { x: 0, y: 0 };
    const a = normal(value.side), b = normal(value.endSide);
    return { d: `M${value.from.x} ${value.from.y} C${value.from.x + a.x * reach} ${value.from.y + a.y * reach} ${value.to.x + b.x * reach} ${value.to.y + b.y * reach} ${value.to.x} ${value.to.y}`, color: u.c.accent, width: L.widthActive, opacity: value.valid ? 1 : .6, dash: value.valid ? '' : '4 4' };
  }
  const latest = useRef({ draw, doc, layout, shift, draftDraw, away, held }); latest.current = { draw, doc, layout, shift, draftDraw, away, held };
  useImperativeHandle(handle, () => ({ follow() {
    const { draw, doc, layout, shift, away, held } = latest.current;
    if (!layer.current) { setTick(n => n + 1); return; } // native: the elbow Views are React, so following is a render of this layer only
    draw(away() ? new Map(linkRoutes(doc!, layout!, shift, held).map(route => [route.key, route])) : null);
  }, preview(value) { if (layer.current) layer.current.preview(latest.current.draftDraw(value)); else setTick(n => n + 1); } }), []);
  useEffect(() => { draw(moved); }, [styled, draft, origin.x, origin.y, u, motion, bundles?.selected, bundles?.hot, doc?.bundles]);
  // Native fallback (also covers a web host without SVG): elbow segments made of Views.
  const fallback = !web;
  return <View ref={host} pointerEvents="box-none" style={{ position: 'absolute', left: 0, top: 0, width, height, zIndex: 1 }}>
    {fallback && styled.map(({ route: rest, active, color, opacity, width, text }) => {
      const route = live(rest), dashed = route.kind !== 'flow', rotate = route.endSide === 'top' ? '45deg' : route.endSide === 'left' ? '-45deg' : route.endSide === 'right' ? '135deg' : '225deg';
      return <React.Fragment key={route.key}>
        {route.elbow.map((s, i) => { const horizontal = s.from.y === s.to.y; return <View key={i} pointerEvents="none" style={{ position: 'absolute', left: Math.min(s.from.x, s.to.x) - origin.x, top: Math.min(s.from.y, s.to.y) - origin.y, width: horizontal ? Math.abs(s.to.x - s.from.x) : dashed ? 0 : width, height: horizontal ? dashed ? 0 : width : Math.abs(s.to.y - s.from.y), opacity, backgroundColor: dashed ? 'transparent' : color, borderStyle: route.kind === 'reference' ? 'dotted' : dashed ? 'dashed' : 'solid', borderColor: color, borderTopWidth: dashed && horizontal ? width : 0, borderLeftWidth: dashed && !horizontal ? width : 0 }} />; })}
        <View pointerEvents="none" style={{ position: 'absolute', left: route.end.x - origin.x - 3 + (route.endSide === 'left' ? -4 : route.endSide === 'right' ? 4 : 0), top: route.end.y - origin.y - 3 + (route.endSide === 'top' ? -4 : route.endSide === 'bottom' ? 4 : 0), width: 6, height: 6, opacity, borderRightWidth: 1.5, borderBottomWidth: 1.5, borderColor: color, transform: [{ rotate }] }} />
        <Pressable accessibilityRole="button" accessibilityLabel={`Link: ${linkTitle(route)}`} hitSlop={10} onPress={e => { e.stopPropagation(); onPress(route.key, false); }} style={{ position: 'absolute', left: route.labelPoint.x - origin.x - 80, top: route.labelPoint.y - origin.y - 10, width: 160, height: 20, alignItems: 'center', justifyContent: 'center', opacity: Math.min(1, opacity * 1.6) }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: 160, paddingHorizontal: 5, minHeight: 16, borderRadius: 8, backgroundColor: u.c.surface0, borderWidth: active ? 1 : 0, borderColor: color }}>
            {!text && route.count < 2 && <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: color }} />}
            {!!text && <Txt kind="small" numberOfLines={1} muted={!active} style={{ fontSize: L.label.size, lineHeight: L.label.lineHeight, flexShrink: 1 }}>{text}</Txt>}
            {route.count > 1 && <Txt kind="label" style={{ color: active ? color : u.c.foregroundMuted, letterSpacing: 0 }}>{route.count}</Txt>}
          </View>
        </Pressable>
      </React.Fragment>;
    })}
    {fallback && bundleDraws(moved).ties.map(tie => <View key={tie.key} pointerEvents="none" style={{ position: 'absolute', left: tie.x - origin.x - tie.length / 2, top: tie.y - origin.y - tie.thickness / 2, width: tie.length, height: tie.thickness, borderRadius: tie.thickness / 2, backgroundColor: tie.fill, borderWidth: 1, borderColor: tie.halo, opacity: tie.opacity, transform: [{ rotate: `${tie.angle}deg` }] }} />)}
    {fallback && draft && <View pointerEvents="none" style={{ position: 'absolute', left: draft.to.x - origin.x - 5, top: draft.to.y - origin.y - 5, width: 10, height: 10, borderRadius: 5, borderWidth: 2, borderColor: withAlpha(u.c.accent, draft.valid ? 1 : .5) }} />}
  </View>;
}
