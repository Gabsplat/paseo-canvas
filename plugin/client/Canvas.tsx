import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, Pressable, View, type GestureResponderEvent } from 'react-native';
import { Icon, ScrollView } from '@getpaseo/plugin/client/react-native';
import type { CanvasGroup } from '../shared/model';
import type { CanvasController } from './useCanvas';
import { ancestors, connectOperations, descriptionKey, freeform, hasCommunication, initialCamera, layoutCanvas, linkFocus, linkRoutes, moveOperations, type Point, type Rect } from './logic';
import { tokens } from './tokens';
import { withAlpha } from './color';
import { BlockCard, ConnectionRows } from './Blocks';
import { LinkLayer } from './Links';
import { Chip, IconButton, Txt, useUI } from './ui';
import { attachMiddlePan, attachWheel } from './web';
export type Camera = { scale: number; offset: Point };
const G = tokens.graph;
type Page = { pageX?: number; pageY?: number };
export function Canvas({ controller: c, mode, onInspect, onPacks, reorder, onGeometry, linkId, onLink }: { controller: CanvasController; mode: 'canvas' | 'outline'; onInspect: () => void; onPacks: () => void; reorder: (id: string, d: number) => void; onGeometry: (rects: Map<string, Rect>, center: Point) => void; linkId: string | null; onLink: (id: string | null) => void }) {
  const u = useUI(), doc = c.view!.document, [size, setSize] = useState({ width: 0, height: 0 }), [heights, setHeights] = useState<Record<string, number>>({}), [camera, setCamera] = useState<Camera>({ scale: 1, offset: { x: 24, y: 24 } }), [drag, setDrag] = useState<{ id: string; delta: Point; target: string | null } | null>(null), [multi, setMulti] = useState(false), [hover, setHover] = useState<string | null>(null), [linkHover, setLinkHover] = useState<string | null>(null), [linkDraft, setLinkDraft] = useState<{ from: string; to: Point; target: string | null } | null>(null);
  const viewport = useRef<View>(null), marks = useRef<View>(null);
  const layout = useMemo(() => layoutCanvas(doc, heights, c.catalog, size.width || undefined), [doc, heights, c.catalog, size.width]), rects = layout.rects, index = layout.index;
  const latest = useRef({ camera, size, c, drag, doc, rects, onLink }); latest.current = { camera, size, c, drag, doc, rects, onLink };
  // Gestures outlive renders: the pointer origin and what is being moved live here, not in a responder's closure.
  const gesture = useRef<{ x: number; y: number; ids: string[]; moved: Point; target: string | null } | null>(null), linkGesture = useRef<{ x: number; y: number; from: string; origin: Point; target: string | null } | null>(null);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Leaving is delayed a moment so the pointer can cross from a card to its handle, or to the next card, without a flash.
  const hovering = (id: string, inside: boolean) => { if (hoverTimer.current) clearTimeout(hoverTimer.current); if (inside) setHover(id); else hoverTimer.current = setTimeout(() => setHover(old => old === id ? null : old), 90); };
  useEffect(() => () => { if (hoverTimer.current) clearTimeout(hoverTimer.current); }, []);
  const panX = useRef(new Animated.Value(0)).current, panY = useRef(new Animated.Value(0)).current;
  const roots = [...doc.groups, ...doc.blocks].filter(e => !e.parentGroupId).map(e => rects.get(e.id)!);
  const minX = Math.min(0, ...roots.map(r => r.x)), minY = Math.min(0, ...roots.map(r => r.y)), maxX = Math.max(0, ...roots.map(r => r.x + r.width)), maxY = Math.max(0, ...roots.map(r => r.y + r.height));
  const bound = { x: minX - 600, y: minY - 600, width: maxX - minX + 1200, height: maxY - minY + 1200 };
  const ready = doc.blocks.filter(b => !rects.get(b.id)?.hidden).every(b => heights[b.id] !== undefined), fitted = useRef('');
  function fit() {
    if (!size.width || !size.height) return;
    const scale = Math.max(.4, Math.min(1, (size.width - 96) / Math.max(1, maxX - minX), (size.height - 96) / Math.max(1, maxY - minY)));
    setCamera({ scale, offset: { x: (size.width - (maxX - minX) * scale) / 2 - minX * scale, y: (size.height - (maxY - minY) * scale) / 2 - minY * scale } });
  }
  useEffect(() => { if (ready && size.width && size.height && fitted.current !== doc.id) {
    const x = roots.length ? Math.min(...roots.map(r => r.x)) : 0, y = roots.length ? Math.min(...roots.map(r => r.y)) : 0;
    setCamera(initialCamera(size.width, { x, y, width: roots.length ? Math.max(...roots.map(r => r.x + r.width)) - x : 0 })); fitted.current = doc.id;
  } }, [ready, size, doc.id]);
  useEffect(() => { onGeometry(rects, { x: (size.width / 2 - camera.offset.x) / camera.scale, y: (size.height / 2 - camera.offset.y) / camera.scale }); }, [rects, camera, size]);
  function zoom(scale: number, anchor = { x: latest.current.size.width / 2, y: latest.current.size.height / 2 }) {
    const old = latest.current.camera; scale = Math.max(.4, Math.min(1.6, scale));
    setCamera({ scale, offset: { x: anchor.x - (anchor.x - old.offset.x) * scale / old.scale, y: anchor.y - (anchor.y - old.offset.y) * scale / old.scale } });
  }
  useEffect(() => { if (u.layout.platform !== 'web' || mode !== 'canvas') return;
    const wheel = attachWheel(viewport.current, e => { if (e.command) zoom(latest.current.camera.scale * Math.exp(-e.dy * .002), e); else setCamera(old => ({ ...old, offset: { x: old.offset.x - e.dx, y: old.offset.y - e.dy } })); });
    const middle = attachMiddlePan(viewport.current, e => setCamera(old => ({ ...old, offset: { x: old.offset.x + e.dx, y: old.offset.y + e.dy } })));
    return () => { wheel(); middle(); };
  }, [mode, u.layout.platform]);
  const pan = useMemo(() => PanResponder.create({ onStartShouldSetPanResponder: () => true, onPanResponderMove: (_, g) => { panX.setValue(g.dx); panY.setValue(g.dy); }, onPanResponderRelease: (_, g) => { setCamera(old => ({ ...old, offset: { x: old.offset.x + g.dx, y: old.offset.y + g.dy } })); panX.setValue(0); panY.setValue(0); if (Math.abs(g.dx) + Math.abs(g.dy) < 4) { setMulti(false); latest.current.onLink(null); void latest.current.c.select([]); } }, onPanResponderTerminate: () => { panX.setValue(0); panY.setValue(0); } }), []);
  function select(id: string, event?: GestureResponderEvent, long = false) {
    event?.stopPropagation();
    const ev = event?.nativeEvent as unknown as { shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean } | undefined;
    if (long) setMulti(true);
    onLink(null);
    const add = long || multi || ev?.shiftKey || ev?.metaKey || ev?.ctrlKey;
    void c.select(add ? c.selection.includes(id) ? c.selection.filter(x => x !== id) : [...c.selection, id] : [id]);
  }
  function draggable(id: string) {
    const e = [...doc.blocks, ...doc.groups].find(e => e.id === id)!;
    if (u.compact || !freeform(index.mode(e.parentGroupId ?? null)) || c.offline || c.busy) return {};
    return PanResponder.create({ onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) + Math.abs(g.dy) > 4,
      onPanResponderGrant: (event, g) => {
        const page = event.nativeEvent as Page, ids = c.selection.includes(id) ? c.selection : [id];
        gesture.current = { x: (page.pageX ?? g.moveX) - g.dx, y: (page.pageY ?? g.moveY) - g.dy, ids, moved: { x: 0, y: 0 }, target: null };
        if (!c.selection.includes(id)) void c.select([id]);
      },
      onPanResponderMove: (event, g) => {
        const state = gesture.current; if (!state) return;
        const page = event.nativeEvent as Page, { camera, doc, rects } = latest.current, r = rects.get(id); if (!r) return;
        state.moved = { x: ((page.pageX ?? g.moveX) - state.x) / camera.scale, y: ((page.pageY ?? g.moveY) - state.y) / camera.scale };
        const center = { x: r.x + state.moved.x + r.width / 2, y: r.y + state.moved.y + 18 };
        state.target = doc.groups.filter(group => group.id !== id && !ancestors(doc, group).some(a => state.ids.includes(a.id)) && !state.ids.includes(group.id)).sort((a, b) => rects.get(b.id)!.depth - rects.get(a.id)!.depth).find(group => { const box = rects.get(group.id)!; return !box.hidden && center.x >= box.x && center.x <= box.x + box.width && center.y >= box.y && center.y <= box.y + box.height; })?.id ?? null;
        setDrag({ id, delta: state.moved, target: state.target });
      },
      onPanResponderRelease: () => { const state = gesture.current, { doc, rects, c } = latest.current; gesture.current = null; setDrag(null); if (!state) return; const operations = moveOperations(doc, rects, state.ids, state.moved, state.target ?? undefined); if (operations.length) void c.edit(operations, `Mover «${e.title}»`); },
      onPanResponderTerminate: () => { gesture.current = null; setDrag(null); },
    }).panHandlers;
  }
  const title = (id: string) => index.entities.get(id)?.title || id;
  function connect(from: string, to: string) {
    const { existing, operations, id } = connectOperations(latest.current.doc, from, to);
    if (existing) { onLink(existing.id); void c.select([]); return; }
    if (operations.length) void c.edit(operations, `Conectar «${title(from)}» → «${title(to)}»`).then(next => { if (next && id) { onLink(id); void c.select([]); } });
  }
  // What a new link would land on: the card under the pointer, else the innermost region. Never the source or its own family.
  function linkTarget(point: Point, from: string): string | null {
    const { doc, rects } = latest.current, inside = (id: string) => { const r = rects.get(id); return !!r && !r.hidden && point.x >= r.x && point.x <= r.x + r.width && point.y >= r.y && point.y <= r.y + r.height; };
    const related = (id: string) => id === from || index.chain(id).includes(from) || index.chain(from).includes(id);
    return [...doc.blocks].reverse().find(b => inside(b.id) && !related(b.id))?.id ?? [...doc.groups].sort((a, b) => rects.get(b.id)!.depth - rects.get(a.id)!.depth).find(g => inside(g.id) && !related(g.id))?.id ?? null;
  }
  function linkHandle(id: string, origin: Point) {
    return PanResponder.create({ onStartShouldSetPanResponder: () => true, onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (event, g) => { const page = event.nativeEvent as Page; linkGesture.current = { x: page.pageX ?? g.x0, y: page.pageY ?? g.y0, from: id, origin, target: null }; setLinkDraft({ from: id, to: origin, target: null }); },
      onPanResponderMove: (event, g) => {
        const state = linkGesture.current; if (!state) return;
        const page = event.nativeEvent as Page, scale = latest.current.camera.scale, to = { x: state.origin.x + ((page.pageX ?? g.moveX) - state.x) / scale, y: state.origin.y + ((page.pageY ?? g.moveY) - state.y) / scale };
        state.target = linkTarget(to, state.from); setLinkDraft({ from: state.from, to, target: state.target });
      },
      onPanResponderRelease: () => { const state = linkGesture.current; linkGesture.current = null; setLinkDraft(null); if (state?.target) connect(state.from, state.target); },
      onPanResponderTerminate: () => { linkGesture.current = null; setLinkDraft(null); },
    }).panHandlers;
  }
  const measure = (id: string, height: number) => setHeights(old => Math.abs((old[id] ?? 0) - height) < 1 ? old : { ...old, [id]: height });
  const moving = (id: string) => { const entity = [...doc.groups, ...doc.blocks].find(e => e.id === id)!; return !!drag && (entity.id === drag.id || ancestors(doc, entity).some(g => g.id === drag.id)); };
  const shifted = (id: string): Point => moving(id) ? drag!.delta : { x: 0, y: 0 };
  const blockProps = { controller: c, onSelect: select, onInspect, onPacks, onReorder: reorder };
  const routes = useMemo(() => mode === 'canvas' ? linkRoutes(doc, layout, drag ? id => moving(id) ? drag.delta : undefined : undefined) : [], [doc, layout, drag, mode]);
  // Focus, strongest first: a link under the pointer, a linked card under the pointer, the selected link, the selection.
  const focus = useMemo(() => {
    if (linkDraft || drag) return null;
    const hovered = routes.find(r => r.key === linkHover);
    return hovered ? { lit: new Set([hovered.from, hovered.to, ...hovered.links.flatMap(l => [l.from, l.to])]), routes: new Set([hovered.key]), links: new Set(hovered.links.map(l => l.id)) } : (hover ? linkFocus(routes, [hover]) : null) ?? (linkId ? linkFocus(routes, [], linkId) : linkFocus(routes, c.selection));
  }, [routes, hover, linkHover, linkId, c.selection, linkDraft, drag]);
  const lit = (id: string) => !focus || index.chain(id).some(x => focus.lit.has(x));
  const region = (g: CanvasGroup) => index.mode(g.id) === 'graph' || index.mode(g.parentGroupId ?? null) === 'graph';
  const pressLink = (key: string) => { const route = routes.find(r => r.key === key); if (!route) return; const at = route.links.findIndex(l => l.id === linkId); onLink(route.links[(at + 1) % route.links.length].id); void c.select([]); };
  const handleFor = linkDraft?.from ?? (u.compact || c.offline || c.busy || drag ? null : hover && doc.blocks.some(b => b.id === hover) ? hover : c.selection.length === 1 ? c.selection[0] : null);
  const handleRect = handleFor ? rects.get(handleFor) : undefined, handleSide = handleFor && index.direction(index.parent.get(handleFor) || null) === 'right' ? 'right' as const : 'bottom' as const;
  const handlePoint = handleRect && !handleRect.hidden ? handleSide === 'right' ? { x: handleRect.x + handleRect.width, y: handleRect.y + handleRect.height / 2 } : { x: handleRect.x + handleRect.width / 2, y: handleRect.y + handleRect.height } : null;
  function groupHeader(group: CanvasGroup, ordinal: number, outline = false, targeted = false, dashed = false) {
    const count = group.blockIds.length + group.groupIds.length, selected = c.selection.includes(group.id), template = c.catalog?.templates.find(t => t.id === group.templateId);
    return <View style={{ flexDirection: 'row', height: outline ? 36 : group.parentGroupId ? tokens.size.groupHeaderNested : tokens.size.groupHeader, alignItems: 'center', paddingLeft: 8, paddingRight: 10, gap: 6, borderBottomWidth: !outline && !group.collapsed && !dashed ? 1 : 0, borderColor: targeted ? withAlpha(u.c.accent, tokens.alpha.toneBorder) : u.c.border }}>
      <Pressable accessibilityRole="button" accessibilityLabel={group.collapsed ? 'Expandir grupo' : 'Contraer grupo'} accessibilityState={{ disabled: c.offline || c.busy, expanded: !group.collapsed }} disabled={c.offline || c.busy} hitSlop={12} onPress={event => { event.stopPropagation(); void c.edit([{ type: 'group.update', id: group.id, patch: { collapsed: !group.collapsed } }], group.collapsed ? 'Expandir grupo' : 'Contraer grupo'); }} style={({ pressed, ...state }) => ({ width: 24, height: 24, alignItems: 'center', justifyContent: 'center', borderRadius: 4, backgroundColor: pressed ? withAlpha(u.c.foreground, tokens.alpha.pressedFill) : (state as { hovered?: boolean }).hovered ? withAlpha(u.c.foreground, tokens.alpha.hoverFill) : 'transparent', opacity: c.offline || c.busy ? .45 : 1 })}><Icon name={group.collapsed ? 'ChevronRight' : 'ChevronDown'} size={14} color={u.c.foregroundMuted} /></Pressable>
      <Pressable {...(!outline ? draggable(group.id) : {})} accessibilityRole="button" accessibilityLabel={`Grupo: ${group.title}`} onPress={e => select(group.id, e)} onLongPress={e => select(group.id, e, true)} style={{ flex: 1, minWidth: 0, alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', gap: 8 }}>{!dashed && <Txt kind="label" muted>{String(ordinal + 1).padStart(2, '0')}</Txt>}<Txt kind="groupTitle" numberOfLines={1} style={{ flexShrink: 1, minWidth: 0 }}>{group.title}</Txt></Pressable>
      {targeted ? <Txt kind="label" style={{ color: u.c.accent }}>Soltar aquí</Txt> : <>{template && !u.compact && <Chip label={template.name} center style={{ maxWidth: 112 }} />}{hasCommunication(group.communication) && <Icon name="Compass" size={12} color={u.c.accent} />}<View accessibilityLabel={count === 1 ? '1 elemento' : `${count} elementos`} style={{ minWidth: 20, height: 18, paddingHorizontal: 5, borderRadius: 9, borderWidth: 1, borderColor: u.c.border, alignItems: 'center', justifyContent: 'center' }}><Txt kind="label" muted style={{ letterSpacing: 0 }}>{count}</Txt></View></>}{selected && !targeted && <Pressable accessibilityRole="button" accessibilityLabel="Inspeccionar grupo" hitSlop={12} onPress={event => { event.stopPropagation(); onInspect(); }} style={{ width: 20, height: 20, alignItems: 'center', justifyContent: 'center' }}><Icon name="PanelRight" size={14} color={u.c.foregroundMuted} /></Pressable>}
    </View>;
  }
  function outlineGroup(group: CanvasGroup, i: number): React.ReactNode {
    return <View key={group.id} style={{ gap: 8, marginLeft: group.parentGroupId ? 12 : 0, borderLeftWidth: group.parentGroupId ? 2 : 0, borderColor: u.c.border }}><View style={{ backgroundColor: c.selection.includes(group.id) ? u.halo : u.groupFill('neutro'), borderRadius: 10 }}>{groupHeader(group, i, true)}</View>{!group.collapsed && <>{group.description && <Txt kind="small" muted>{group.description}</Txt>}<ConnectionRows doc={doc} id={group.id} onOpen={id => select(id)} />{group.blockIds.map(id => { const b = doc.blocks.find(b => b.id === id); return b && <BlockCard key={id} {...blockProps} block={b} outline selected={c.selection.includes(id)} />; })}{group.groupIds.map((id, j) => { const g = doc.groups.find(g => g.id === id); return g && outlineGroup(g, j); })}{!group.blockIds.length && !group.groupIds.length && <Txt kind="small" muted>Grupo vacío. Añade un bloque desde el catálogo.</Txt>}</>}</View>;
  }
  if (mode === 'outline') return <ScrollView contentContainerStyle={{ padding: u.compact ? 12 : 16, gap: 16 }}><View style={{ width: '100%', maxWidth: 720, alignSelf: 'center', gap: 16 }}><View style={{ gap: 8 }}><Txt kind="display">{doc.title}</Txt>{doc.example && <Chip label="Ejemplo" tone="aviso" icon="FlaskConical" />}<Txt kind="small" muted>{doc.description}</Txt></View>{doc.groups.filter(g => !g.parentGroupId).map(outlineGroup)}{doc.blocks.some(b => !b.parentGroupId) && <Txt kind="label" muted>Sueltos</Txt>}{doc.blocks.filter(b => !b.parentGroupId).map(b => <BlockCard key={b.id} {...blockProps} block={b} outline selected={c.selection.includes(b.id)} />)}</View></ScrollView>;
  return <View ref={viewport} onLayout={e => setSize(e.nativeEvent.layout)} style={{ flex: 1, overflow: 'hidden', backgroundColor: u.c.surface0 }}>
    <View {...pan.panHandlers} style={{ position: 'absolute', inset: 0 }} />
    <Animated.View pointerEvents="box-none" style={{ position: 'absolute', left: 0, top: 0, width: bound.width, height: bound.height, opacity: ready ? 1 : 0, transformOrigin: 'top left', transform: [{ translateX: Animated.add(camera.offset.x + camera.scale * bound.x, panX) }, { translateY: Animated.add(camera.offset.y + camera.scale * bound.y, panY) }, { scale: camera.scale }] }}>
      {doc.groups.filter(g => !rects.get(g.id)!.hidden).sort((a, b) => rects.get(a.id)!.depth - rects.get(b.id)!.depth).map(g => { const r = rects.get(g.id)!, delta = shifted(g.id), selected = c.selection.includes(g.id), targeted = drag?.target === g.id, nested = !!g.parentGroupId, dashed = region(g), radius = nested ? tokens.radius.block : tokens.radius.group, inset = nested ? tokens.size.groupPaddingNested : tokens.size.groupPadding;
        const siblings = g.parentGroupId ? doc.groups.find(parent => parent.id === g.parentGroupId)!.groupIds : doc.groups.filter(group => !group.parentGroupId).map(group => group.id);
        return <Pressable key={g.id} accessibilityRole="button" accessibilityLabel={`Grupo: ${g.title}`} onPress={e => select(g.id, e)} onHoverIn={() => hovering(g.id, true)} onHoverOut={() => hovering(g.id, false)} style={{ position: 'absolute', left: r.x - bound.x + delta.x, top: r.y - bound.y + delta.y, width: r.width, height: r.height, zIndex: moving(g.id) ? 2 : 0, opacity: moving(g.id) ? .92 : 1, backgroundColor: targeted || linkDraft?.target === g.id ? u.halo : dashed ? withAlpha(u.c.foregroundMuted, G.region.fillAlpha) : u.groupFill('neutro'), borderRadius: radius, borderWidth: selected || targeted || linkDraft?.target === g.id ? tokens.border.selected : nested && !dashed ? tokens.border.hairline : tokens.border.group, borderStyle: targeted || dashed ? 'dashed' : 'solid', borderColor: selected || targeted || linkDraft?.target === g.id ? u.c.accent : hover === g.id ? withAlpha(u.c.foregroundMuted, .5) : dashed ? withAlpha(u.c.foregroundMuted, .45) : u.c.border }}>
        {selected && <View pointerEvents="none" style={{ position: 'absolute', inset: -3, borderRadius: radius + 3, borderWidth: 3, borderColor: u.halo }} />}
        {groupHeader(g, siblings.indexOf(g.id), false, targeted, dashed)}{!g.collapsed && <View pointerEvents="none" style={{ paddingHorizontal: inset, paddingTop: inset, gap: tokens.size.groupDescription.gap }}>{!!g.description && <Txt kind="small" muted numberOfLines={tokens.size.groupDescription.maxLines} onLayout={e => measure(descriptionKey(g.id), e.nativeEvent.layout.height)}>{g.description}</Txt>}{!g.blockIds.length && !g.groupIds.length && <View style={{ height: tokens.size.groupEmpty, borderWidth: 1, borderStyle: 'dashed', borderColor: targeted ? u.c.accent : u.c.border, borderRadius: tokens.radius.control, justifyContent: 'center', paddingHorizontal: 12 }}><Txt kind="small" muted numberOfLines={2}>Grupo vacío. Suelta un bloque o añade uno desde el catálogo.</Txt></View>}</View>}
      </Pressable>; })}
      {doc.groups.filter(g => g.layout?.mode === 'flow' && !g.collapsed && !rects.get(g.id)?.hidden).flatMap(g => [...g.blockIds, ...g.groupIds].slice(0, -1).map(id => { const r = rects.get(id)!; return <View key={`${g.id}:${id}`} pointerEvents="none" style={{ position: 'absolute', left: r.x + r.width + 7 - bound.x, top: r.y + 20 - bound.y }}><Icon name="ChevronRight" size={14} color={u.c.foregroundMuted} /></View>; }))}
      <LinkLayer routes={routes} origin={bound} width={bound.width} height={bound.height} focus={focus} selected={routes.find(r => r.links.some(l => l.id === linkId))?.key ?? null} draft={linkDraft && handlePoint ? { from: handlePoint, to: linkDraft.to, side: handleSide, valid: !!linkDraft.target } : null} marks={marks} onPress={pressLink} onHover={setLinkHover} />
      {doc.blocks.filter(b => !rects.get(b.id)!.hidden).map(b => { const r = rects.get(b.id)!, delta = shifted(b.id), selected = c.selection.includes(b.id); return <View key={b.id} style={{ position: 'absolute', left: r.x - bound.x + delta.x, top: r.y - bound.y + delta.y, width: r.width, zIndex: moving(b.id) ? 3 : selected ? 2 : 0 }}><BlockCard {...blockProps} block={b} selected={selected} dragging={moving(b.id)} dim={!lit(b.id)} onHover={hovering} detailsSide={index.direction(b.parentGroupId ?? null) === 'right' ? 'bottom' : 'right'} headerHandlers={draggable(b.id)} onMeasure={h => measure(b.id, h)} />{linkDraft?.target === b.id && <View pointerEvents="none" style={{ position: 'absolute', inset: -4, borderRadius: tokens.radius.block + 4, borderWidth: 2, borderColor: u.c.accent }} />}</View>; })}
      <View ref={marks} pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, width: bound.width, height: bound.height, zIndex: 4 }} />
      {handleFor && handlePoint && <Pressable accessibilityRole="button" accessibilityLabel={`Arrastra para conectar «${title(handleFor)}» con otro elemento`} accessibilityHint="Con teclado: selecciona dos elementos y pulsa L, o usa Conexiones en el inspector." onHoverIn={() => hovering(handleFor, true)} onHoverOut={() => hovering(handleFor, false)} style={{ position: 'absolute', left: handlePoint.x - bound.x - G.handle.hit / 2, top: handlePoint.y - bound.y - G.handle.hit / 2, width: G.handle.hit, height: G.handle.hit, alignItems: 'center', justifyContent: 'center', zIndex: 5 }}>
        <View {...linkHandle(handleFor, handlePoint)} style={{ width: G.handle.hit, height: G.handle.hit, alignItems: 'center', justifyContent: 'center' }}><View pointerEvents="none" style={{ width: G.handle.size, height: G.handle.size, borderRadius: G.handle.size / 2, backgroundColor: linkDraft ? u.c.accent : u.c.surface1, borderWidth: 1.5, borderColor: u.c.accent, alignItems: 'center', justifyContent: 'center' }}><Icon name={G.handle.icon} size={10} color={linkDraft ? u.c.accentForeground : u.c.accent} /></View></View>
      </Pressable>}
      {linkDraft && <View pointerEvents="none" style={{ position: 'absolute', left: linkDraft.to.x - bound.x + 12, top: linkDraft.to.y - bound.y + 12, zIndex: 6, paddingHorizontal: 6, minHeight: 20, justifyContent: 'center', borderRadius: tokens.radius.chip, backgroundColor: u.c.surface2, borderWidth: 1, borderColor: u.c.border }}><Txt kind="small" numberOfLines={1}>{linkDraft.target ? `Conectar con «${title(linkDraft.target)}»` : 'Suelta sobre un nodo o grupo'}</Txt></View>}
    </Animated.View>
    {!ready && <View pointerEvents="none" style={{ position: 'absolute', inset: 24, gap: 16 }}><Txt kind="small" muted>Preparando el lienzo…</Txt><View style={{ width: 288, height: 96, backgroundColor: u.c.surface2, borderRadius: 10 }} /></View>}
    <View style={{ position: 'absolute', right: 12, bottom: 12, flexDirection: 'row', alignItems: 'center', padding: 2, backgroundColor: u.c.surface1, borderWidth: 1, borderColor: u.c.border, borderRadius: 8 }}><IconButton icon="Minus" label="Alejar" disabled={camera.scale <= tokens.canvas.zoomMin + .01} onPress={() => zoom([...tokens.canvas.zoomSteps].reverse().find(s => s < camera.scale - .01) ?? .4)} /><Pressable accessibilityRole="button" accessibilityLabel="Restablecer zoom" onPress={() => zoom(1)} style={({ pressed, ...state }) => ({ minWidth: 48, height: u.compact ? 44 : 32, paddingHorizontal: 4, borderRadius: 6, justifyContent: 'center', alignItems: 'center', backgroundColor: pressed ? withAlpha(u.c.foreground, tokens.alpha.pressedFill) : (state as { hovered?: boolean }).hovered ? withAlpha(u.c.foreground, tokens.alpha.hoverFill) : 'transparent' })}><Txt kind="label" muted>{Math.round(camera.scale * 100)}%</Txt></Pressable><IconButton icon="Plus" label="Acercar" disabled={camera.scale >= tokens.canvas.zoomMax - .01} onPress={() => zoom(tokens.canvas.zoomSteps.find(s => s > camera.scale + .01) ?? 1.6)} /><View style={{ width: 1, height: 16, marginHorizontal: 2, backgroundColor: u.c.border }} /><IconButton icon="Maximize" label="Ajustar al lienzo" onPress={fit} /></View>
  </View>;
}
