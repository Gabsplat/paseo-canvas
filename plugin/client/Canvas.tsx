import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, Pressable, View, type GestureResponderEvent } from 'react-native';
import { Icon, ScrollView } from '@getpaseo/plugin/client/react-native';
import type { CanvasGroup } from '../shared/model';
import type { CanvasController } from './useCanvas';
import { ancestors, hasCommunication, initialCamera, layoutDocument, moveOperations, type Point, type Rect } from './logic';
import { tokens } from './tokens';
import { withAlpha } from './color';
import { BlockCard } from './Blocks';
import { Chip, IconButton, Txt, useUI } from './ui';
import { attachWheel } from './web';
export type Camera = { scale: number; offset: Point };
export function Canvas({ controller: c, mode, onInspect, onPacks, reorder, onGeometry }: { controller: CanvasController; mode: 'canvas' | 'outline'; onInspect: () => void; onPacks: () => void; reorder: (id: string, d: number) => void; onGeometry: (rects: Map<string, Rect>, center: Point) => void }) {
  const u = useUI(), doc = c.view!.document, [size, setSize] = useState({ width: 0, height: 0 }), [heights, setHeights] = useState<Record<string, number>>({}), [camera, setCamera] = useState<Camera>({ scale: 1, offset: { x: 24, y: 24 } }), [drag, setDrag] = useState<{ id: string; delta: Point; target: string | null } | null>(null), [multi, setMulti] = useState(false);
  const viewport = useRef<View>(null), latest = useRef({ camera, size, c, drag }); latest.current = { camera, size, c, drag };
  const rects = useMemo(() => layoutDocument(doc, heights, c.catalog), [doc, heights, c.catalog]), rectRef = useRef(rects); rectRef.current = rects;
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
    return attachWheel(viewport.current, e => { if (e.command) zoom(latest.current.camera.scale * Math.exp(-e.dy * .002), e); else setCamera(old => ({ ...old, offset: { x: old.offset.x - e.dx, y: old.offset.y - e.dy } })); });
  }, [mode, u.layout.platform]);
  const pan = useMemo(() => PanResponder.create({ onStartShouldSetPanResponder: () => true, onPanResponderMove: (_, g) => { panX.setValue(g.dx); panY.setValue(g.dy); }, onPanResponderRelease: (_, g) => { setCamera(old => ({ ...old, offset: { x: old.offset.x + g.dx, y: old.offset.y + g.dy } })); panX.setValue(0); panY.setValue(0); if (Math.abs(g.dx) + Math.abs(g.dy) < 4) { setMulti(false); void latest.current.c.select([]); } }, onPanResponderTerminate: () => { panX.setValue(0); panY.setValue(0); } }), []);
  function select(id: string, event?: GestureResponderEvent, long = false) {
    event?.stopPropagation();
    const ev = event?.nativeEvent as unknown as { shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean } | undefined;
    if (long) setMulti(true);
    const add = long || multi || ev?.shiftKey || ev?.metaKey || ev?.ctrlKey;
    void c.select(add ? c.selection.includes(id) ? c.selection.filter(x => x !== id) : [...c.selection, id] : [id]);
  }
  function draggable(id: string) {
    const e = [...doc.blocks, ...doc.groups].find(e => e.id === id)!;
    const parent = doc.groups.find(g => g.id === e.parentGroupId);
    const free = !parent || parent.layout?.mode === 'free' || !parent.layout && [...parent.blockIds, ...parent.groupIds].some(id => [...doc.blocks, ...doc.groups].find(e => e.id === id)?.position);
    if (u.compact || !free || c.offline || c.busy) return {};
    let ids: string[] = [], moved: Point = { x: 0, y: 0 }, target: string | null = null;
    return PanResponder.create({ onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dx) + Math.abs(g.dy) > 4,
      onPanResponderGrant: () => { ids = c.selection.includes(id) ? c.selection : [id]; if (!c.selection.includes(id)) void c.select([id]); },
      onPanResponderMove: (_, g) => {
        moved = { x: g.dx / camera.scale, y: g.dy / camera.scale }; const r = rects.get(id)!;
        const center = { x: r.x + moved.x + r.width / 2, y: r.y + moved.y + 18 };
        target = doc.groups.filter(group => group.id !== id && !ancestors(doc, group).some(a => ids.includes(a.id)) && !ids.includes(group.id)).sort((a, b) => rects.get(b.id)!.depth - rects.get(a.id)!.depth).find(group => { const box = rects.get(group.id)!; return !box.hidden && center.x >= box.x && center.x <= box.x + box.width && center.y >= box.y && center.y <= box.y + box.height; })?.id ?? null;
        setDrag({ id, delta: moved, target });
      },
      onPanResponderRelease: () => { setDrag(null); const operations = moveOperations(doc, rects, ids, moved, target ?? undefined); if (operations.length) void c.edit(operations, `Mover «${e.title}»`); },
      onPanResponderTerminate: () => setDrag(null),
    }).panHandlers;
  }
  const measure = (id: string, height: number) => setHeights(old => Math.abs((old[id] ?? 0) - height) < 1 ? old : { ...old, [id]: height });
  const shifted = (id: string): Point => { const entity = [...doc.groups, ...doc.blocks].find(e => e.id === id)!; return drag && (entity.id === drag.id || ancestors(doc, entity).some(g => g.id === drag.id)) ? drag.delta : { x: 0, y: 0 }; };
  const blockProps = { controller: c, onSelect: select, onInspect, onPacks, onReorder: reorder };
  function groupHeader(group: CanvasGroup, ordinal: number, outline = false) {
    const selected = c.selection.includes(group.id), template = c.catalog?.templates.find(t => t.id === group.templateId);
    return <View style={{ flexDirection: 'row', height: outline ? 36 : group.parentGroupId ? 32 : 36, alignItems: 'center', paddingHorizontal: 12, gap: 6, borderBottomWidth: !outline && !group.collapsed ? 1 : 0, borderColor: u.c.border }}>
      <Pressable accessibilityRole="button" accessibilityLabel={group.collapsed ? 'Expandir grupo' : 'Contraer grupo'} accessibilityState={{ disabled: c.offline || c.busy, expanded: !group.collapsed }} disabled={c.offline || c.busy} hitSlop={12} onPress={event => { event.stopPropagation(); void c.edit([{ type: 'group.update', id: group.id, patch: { collapsed: !group.collapsed } }], group.collapsed ? 'Expandir grupo' : 'Contraer grupo'); }} style={({ pressed }) => ({ width: 20, height: 20, alignItems: 'center', justifyContent: 'center', borderRadius: 4, backgroundColor: pressed ? u.halo : 'transparent', opacity: c.offline || c.busy ? .45 : 1 })}><Icon name={group.collapsed ? 'ChevronRight' : 'ChevronDown'} size={14} color={u.c.foregroundMuted} /></Pressable>
      <Pressable {...(!outline ? draggable(group.id) : {})} accessibilityRole="button" accessibilityLabel={`Grupo: ${group.title}`} onPress={e => select(group.id, e)} onLongPress={e => select(group.id, e, true)} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8 }}><Txt kind="label" muted>{String(ordinal + 1).padStart(2, '0')}</Txt><Txt kind="groupTitle" numberOfLines={1} style={{ flex: 1 }}>{group.title}</Txt><Txt kind="label" muted>{group.blockIds.length + group.groupIds.length}</Txt></Pressable>
      {template && !u.compact && <Chip label={template.name} />}{hasCommunication(group.communication) && <Icon name="Compass" size={12} color={u.c.accent} />}{selected && <Pressable accessibilityRole="button" accessibilityLabel="Inspeccionar grupo" hitSlop={12} onPress={event => { event.stopPropagation(); onInspect(); }} style={{ width: 20, height: 20, alignItems: 'center', justifyContent: 'center' }}><Icon name="PanelRight" size={14} color={u.c.foregroundMuted} /></Pressable>}
    </View>;
  }
  function outlineGroup(group: CanvasGroup, i: number): React.ReactNode {
    return <View key={group.id} style={{ gap: 8, marginLeft: group.parentGroupId ? 12 : 0, borderLeftWidth: group.parentGroupId ? 2 : 0, borderColor: u.c.border }}><View style={{ backgroundColor: c.selection.includes(group.id) ? u.halo : withAlpha(u.c.foregroundMuted, .05), borderRadius: 10 }}>{groupHeader(group, i, true)}</View>{!group.collapsed && <>{group.description && <Txt kind="small" muted>{group.description}</Txt>}{group.blockIds.map(id => { const b = doc.blocks.find(b => b.id === id); return b && <BlockCard key={id} {...blockProps} block={b} outline selected={c.selection.includes(id)} />; })}{group.groupIds.map((id, j) => { const g = doc.groups.find(g => g.id === id); return g && outlineGroup(g, j); })}{!group.blockIds.length && !group.groupIds.length && <Txt kind="small" muted>Grupo vacío. Añade un bloque desde el catálogo.</Txt>}</>}</View>;
  }
  if (mode === 'outline') return <ScrollView contentContainerStyle={{ padding: u.compact ? 12 : 16, gap: 16 }}><View style={{ width: '100%', maxWidth: 720, alignSelf: 'center', gap: 16 }}><View style={{ gap: 8 }}><Txt kind="display">{doc.title}</Txt>{doc.example && <Chip label="Ejemplo" tone="aviso" icon="FlaskConical" />}<Txt kind="small" muted>{doc.description}</Txt></View>{doc.groups.filter(g => !g.parentGroupId).map(outlineGroup)}{doc.blocks.some(b => !b.parentGroupId) && <Txt kind="label" muted>Sueltos</Txt>}{doc.blocks.filter(b => !b.parentGroupId).map(b => <BlockCard key={b.id} {...blockProps} block={b} outline selected={c.selection.includes(b.id)} />)}</View></ScrollView>;
  return <View ref={viewport} onLayout={e => setSize(e.nativeEvent.layout)} style={{ flex: 1, overflow: 'hidden', backgroundColor: u.c.surface0 }}>
    <View {...pan.panHandlers} style={{ position: 'absolute', inset: 0 }} />
    <Animated.View pointerEvents="box-none" style={{ position: 'absolute', left: 0, top: 0, width: bound.width, height: bound.height, opacity: ready ? 1 : 0, transformOrigin: 'top left', transform: [{ translateX: Animated.add(camera.offset.x + camera.scale * bound.x, panX) }, { translateY: Animated.add(camera.offset.y + camera.scale * bound.y, panY) }, { scale: camera.scale }] }}>
      {doc.groups.filter(g => !rects.get(g.id)!.hidden).sort((a, b) => rects.get(a.id)!.depth - rects.get(b.id)!.depth).map(g => { const r = rects.get(g.id)!, delta = shifted(g.id), selected = c.selection.includes(g.id), targeted = drag?.target === g.id;
        const siblings = g.parentGroupId ? doc.groups.find(parent => parent.id === g.parentGroupId)!.groupIds : doc.groups.filter(group => !group.parentGroupId).map(group => group.id);
        return <Pressable key={g.id} accessibilityRole="button" accessibilityLabel={`Grupo: ${g.title}`} onPress={e => select(g.id, e)} style={{ position: 'absolute', left: r.x - bound.x + delta.x, top: r.y - bound.y + delta.y, width: r.width, height: r.height, backgroundColor: targeted ? u.halo : withAlpha(u.c.foregroundMuted, .05), borderRadius: g.parentGroupId ? 10 : 14, borderWidth: selected || targeted ? 2 : 1.5, borderStyle: targeted ? 'dashed' : 'solid', borderColor: selected || targeted ? u.c.accent : u.c.border }}>
        {selected && <View pointerEvents="none" style={{ position: 'absolute', inset: -3, borderRadius: 17, borderWidth: 3, borderColor: u.halo }} />}
        {groupHeader(g, siblings.indexOf(g.id))}{!g.collapsed && <View pointerEvents="none" style={{ paddingHorizontal: 16, gap: 8 }}>{g.description && <Txt kind="small" muted numberOfLines={2}>{g.description}</Txt>}{!g.blockIds.length && !g.groupIds.length && <View style={{ height: 56, borderWidth: 1, borderStyle: 'dashed', borderColor: u.c.border, justifyContent: 'center', padding: 8 }}><Txt kind="small" muted>Grupo vacío. Suelta un bloque o añade uno desde el catálogo.</Txt></View>}</View>}
      </Pressable>; })}
      {doc.groups.filter(g => g.layout?.mode === 'flow' && !g.collapsed && !rects.get(g.id)?.hidden).flatMap(g => [...g.blockIds, ...g.groupIds].slice(0, -1).map(id => { const r = rects.get(id)!; return <View key={`${g.id}:${id}`} pointerEvents="none" style={{ position: 'absolute', left: r.x + r.width + 7 - bound.x, top: r.y + 20 - bound.y }}><Icon name="ChevronRight" size={14} color={u.c.foregroundMuted} /></View>; }))}
      {doc.blocks.filter(b => !rects.get(b.id)!.hidden).map(b => { const r = rects.get(b.id)!, delta = shifted(b.id); return <View key={b.id} style={{ position: 'absolute', left: r.x - bound.x + delta.x, top: r.y - bound.y + delta.y, width: r.width }}><BlockCard {...blockProps} block={b} selected={c.selection.includes(b.id)} dragging={drag?.id === b.id} headerHandlers={draggable(b.id)} onMeasure={h => measure(b.id, h)} /></View>; })}
    </Animated.View>
    {!ready && <View pointerEvents="none" style={{ position: 'absolute', inset: 24, gap: 16 }}><Txt kind="small" muted>Preparando el lienzo…</Txt><View style={{ width: 288, height: 96, backgroundColor: u.c.surface2, borderRadius: 10 }} /></View>}
    <View style={{ position: 'absolute', right: 12, bottom: 12, backgroundColor: u.c.surface1, borderWidth: 1, borderColor: u.c.border, borderRadius: 6, alignItems: 'center' }}><IconButton icon="Plus" label="Acercar" onPress={() => zoom(tokens.canvas.zoomSteps.find(s => s > camera.scale + .01) ?? 1.6)} /><Pressable accessibilityRole="button" accessibilityLabel="Restablecer zoom" onPress={() => zoom(1)} style={{ minHeight: 24, paddingHorizontal: 6, justifyContent: 'center', alignItems: 'center' }}><Txt kind="label" muted>{Math.round(camera.scale * 100)}%</Txt></Pressable><IconButton icon="Minus" label="Alejar" onPress={() => zoom([...tokens.canvas.zoomSteps].reverse().find(s => s < camera.scale - .01) ?? .4)} /><View style={{ height: 1, width: '100%', backgroundColor: u.c.border }} /><IconButton icon="Maximize" label="Ajustar al lienzo" onPress={fit} /></View>
  </View>;
}
