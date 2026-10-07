import React, { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { ScrollView } from '@getpaseo/plugin/client/react-native';
import { arcPath, biographies, ringModel, wedgePath, type Change } from './lenses';
import { withAlpha } from './color';
import { tokens } from './tokens';
import { Button, Txt, useUI } from './ui';
import type { CanvasController } from './useCanvas';
import { useHistory } from './useHistory';
import { WebVectors, type VectorPath } from './web';
const R = tokens.rings;
/**
 * The stored history of the document seen all at once, as the rings of a trunk. Angle is identity (each block
 * keeps a bearing, areas are sectors) and radius is time (the centre is the oldest stored change, the rim is now).
 * Ink is a change, coloured by who made it. Where there is no ink the block was left alone. Nothing here is
 * inferred: every mark is one entry of the history the server keeps, and the view says how far back that goes.
 */
export function Rings({ controller: c, onOpen }: { controller: CanvasController; onOpen(id: string): void }) {
  const u = useUI(), doc = c.view!.document, { changes, failed } = useHistory(c, true), [box, setBox] = useState({ width: 0, height: 0 }), [hover, setHover] = useState<string | null>(null);
  const model = useMemo(() => changes ? ringModel(doc, changes, c.events) : null, [doc.blocks, doc.groups, changes, c.events]), lives = useMemo(() => biographies(changes ?? []), [changes]);
  const wide = box.width >= R.sideBreak, side = wide ? R.sideWidth : 0, size = Math.max(0, Math.min(box.width - side - 2 * R.pad - 2 * R.labelRoom, box.height - tokens.island.bannerTop - (wide ? R.bottomRoom : R.listHeight) - 2 * R.pad)), cx = size / 2, cy = size / 2;
  const outer = size / 2 - R.rim, inner = Math.max(R.core, outer * R.coreRatio), selected = c.selection.length === 1 ? c.selection[0] : null, focus = hover ?? selected;
  const user = u.c.accent, agent = u.tone('violeta');
  const drawn = useMemo(() => {
    if (!model || size < 120) return { paths: [] as VectorPath[], ids: [] as (string | null)[] };
    const paths: VectorPath[] = [], ids: (string | null)[] = [], add = (path: VectorPath, id: string | null = null) => { paths.push(path); ids.push(id); };
    const band = (outer - inner) / Math.max(1, model.rings), radius = (ring: number) => inner + band * (ring + .5), spoke = new Map(model.spokes.map(s => [s.id, s]));
    add({ d: arcPath(cx, cy, outer, 0, Math.PI * 1.9999), color: u.c.border, weight: 1, hit: false }); add({ d: arcPath(cx, cy, inner, 0, Math.PI * 1.9999), color: u.c.border, weight: 1, hit: false });
    for (const s of model.sectors) add({ d: `M${cx + inner * Math.cos(s.a0)} ${cy + inner * Math.sin(s.a0)}L${cx + (outer + R.tick) * Math.cos(s.a0)} ${cy + (outer + R.tick) * Math.sin(s.a0)}`, color: withAlpha(u.c.foregroundMuted, .5), weight: 1, hit: false });
    // Each block's slice is the thing you point at; the one in focus is washed so its whole life reads as a spoke.
    for (const s of model.spokes) add({ d: wedgePath(cx, cy, inner, outer + R.tick, s.a0, s.a1), color: 'transparent', weight: 0, fill: s.id === focus ? withAlpha(u.c.accent, R.focusFill) : 'rgba(0,0,0,0)' }, s.id);
    const weight = Math.max(R.inkMin, Math.min(R.inkMax, band * R.inkShare));
    for (const m of model.marks) { const s = spoke.get(m.id); if (s) add({ d: arcPath(cx, cy, radius(m.ring), s.a0, s.a1), color: m.undone ? withAlpha(u.c.foregroundMuted, .7) : m.actor === 'agent' ? agent : user, weight: m.undone ? Math.max(1, weight * .5) : weight, dash: m.undone ? '2 3' : undefined, hit: false }); }
    // Requests made to the assistant sit outside the rim: filled once attended, hollow while they wait.
    for (const b of model.barbs) { const s = spoke.get(b.id); if (!s) continue; const a = (s.a0 + s.a1) / 2, x = cx + (outer + R.barbAt) * Math.cos(a), y = cy + (outer + R.barbAt) * Math.sin(a), r = R.barb, tone = u.tone(b.state === 'acked' ? 'exito' : b.state === 'failed' ? 'riesgo' : 'aviso');
      add({ d: `M${x - r} ${y}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`, color: tone, weight: 1.5, fill: b.state === 'acked' ? tone : 'none', hit: false }); }
    return { paths, ids };
  }, [model, size, focus, u.c, user, agent]);
  const quiet = (last: number) => Math.max(0, doc.revision - last);
  const life = focus ? lives.get(focus) : undefined, title = (id: string) => doc.blocks.find(b => b.id === id)?.title || 'Sin título';
  const mine = (changes ?? []).filter(change => !!focus && change.changed.includes(focus)).sort((a, b) => b.revision - a.revision);
  const key = (color: string, label: string, hollow = false, dashed = false) => <View key={label} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><View style={{ width: hollow ? 10 : 14, height: hollow ? 10 : 4, borderRadius: hollow ? 5 : 2, backgroundColor: hollow || dashed ? 'transparent' : color, borderWidth: hollow || dashed ? 1.5 : 0, borderColor: color, borderStyle: dashed ? 'dashed' : 'solid' }} /><Txt kind="small" muted>{label}</Txt></View>;
  const panel = <ScrollView style={wide ? { width: R.sideWidth, alignSelf: 'stretch' } : { height: R.listHeight, alignSelf: 'stretch' }} contentContainerStyle={{ padding: 16, gap: 14 }}>
    {focus && model?.spokes.some(s => s.id === focus) ? <View style={{ gap: 6 }}>
      <Txt kind="heading" numberOfLines={2}>{title(focus)}</Txt>
      {life ? <><Txt kind="small" muted>{life.edits === 1 ? '1 cambio guardado' : `${life.edits} cambios guardados`}: {life.byUser} tuyos, {life.byAgent} del asistente.</Txt>
        <Txt kind="small" muted>{quiet(life.last) === 0 ? 'Cambiado en la última revisión.' : `Quieto desde hace ${quiet(life.last)} ${quiet(life.last) === 1 ? 'revisión' : 'revisiones'}.`}</Txt></>
        : <Txt kind="small" muted>Sin cambios en el historial guardado: quieto todo este tramo.</Txt>}
      {mine.slice(0, R.listMax).map(change => <View key={change.revision} style={{ flexDirection: 'row', gap: 8, alignItems: 'baseline' }}><View style={{ width: 8, height: 8, borderRadius: 4, marginTop: 4, backgroundColor: change.kind === 'undo' ? u.c.foregroundMuted : change.actor === 'agent' ? agent : user }} /><Txt kind="small" style={{ flex: 1 }} numberOfLines={2}>{change.label || 'Cambio'}{change.kind !== 'edit' ? ` (${change.kind === 'undo' ? 'deshacer' : 'rehacer'})` : ''}</Txt><Txt kind="label" muted>r{change.revision}</Txt></View>)}
      {mine.length > R.listMax && <Txt kind="small" muted>y {mine.length - R.listMax} más</Txt>}
      <Button label="Ver en el lienzo" small icon="Frame" style={{ alignSelf: 'flex-start' }} onPress={() => onOpen(focus)} />
    </View> : <Txt kind="small" muted>Pasa el cursor o pulsa un radio para leer la vida de ese bloque.</Txt>}
    <View style={{ gap: 6 }}><Txt kind="label" muted>Cómo se lee</Txt>
      <Txt kind="small" muted>El centro es el cambio guardado más antiguo; el borde es ahora. Cada bloque tiene su dirección y las áreas son sectores. Donde no hay tinta, nadie tocó ese bloque.</Txt>
      {key(user, 'Cambio tuyo')}{key(agent, 'Cambio del asistente')}{key(u.c.foregroundMuted, 'Deshecho', false, true)}{key(u.tone('exito'), 'Pedido atendido')}{key(u.tone('aviso'), 'Pedido sin respuesta', true)}
    </View>
    {model && <Txt kind="small" muted>{model.rings === 0 ? 'Todavía no hay cambios guardados.' : `Se muestran ${model.rings} cambios, de la revisión ${model.first} a la ${model.last}. El historial guarda los 50 más recientes.`}{model.unplaced ? ` ${model.unplaced === 1 ? 'Un cambio' : `${model.unplaced} cambios`} a enlaces, áreas o elementos eliminados no ${model.unplaced === 1 ? 'tiene' : 'tienen'} dirección y no se ${model.unplaced === 1 ? 'dibuja' : 'dibujan'}.` : ''}</Txt>}
  </ScrollView>;
  return <View nativeID="lienzo-rings" onLayout={e => setBox(e.nativeEvent.layout)} style={{ flex: 1, backgroundColor: u.c.surface0, flexDirection: wide ? 'row' : 'column', alignItems: 'center', justifyContent: 'center', paddingTop: u.compact ? 0 : tokens.island.bannerTop }}>
    {failed && !changes ? <View style={{ padding: 24, gap: 8, alignItems: 'center' }}><Txt>No se pudo leer el historial.</Txt><Txt kind="small" muted>Vuelve al lienzo e inténtalo de nuevo.</Txt></View>
      : !model ? <Txt muted>Leyendo el historial…</Txt>
      : u.layout.platform !== 'web' ? <View style={{ padding: 24, gap: 8 }}><Txt kind="heading">Anillos</Txt><Txt kind="small" muted>La figura se dibuja en la versión web o de escritorio. Aquí tienes la lectura por bloque.</Txt></View>
      : <View style={{ width: size, height: size, marginVertical: R.pad, marginHorizontal: R.pad + R.labelRoom, marginBottom: wide ? R.bottomRoom : R.pad }}>
          <WebVectors width={size} height={size} paths={drawn.paths} label={`Anillos de ${doc.title}: ${model.rings} cambios en ${model.spokes.length} bloques`} onPressPath={i => { const id = drawn.ids[i]; if (id) void c.select(selected === id ? [] : [id]); }} onHoverPath={i => setHover(i === null ? null : drawn.ids[i] ?? null)} />
          <View pointerEvents="none" style={{ position: 'absolute', left: cx - inner + 8, top: cy - 30, width: 2 * inner - 16, height: 60, alignItems: 'center', justifyContent: 'center' }}><Txt kind="small" numberOfLines={2} style={{ textAlign: 'center', fontWeight: '600' }}>{doc.title}</Txt><Txt kind="label" muted>{model.spokes.length} bloques</Txt></View>
          {model.sectors.length <= R.labelMax && model.sectors.map(s => { const a = (s.a0 + s.a1) / 2, x = cx + (outer + R.labelAt) * Math.cos(a), y = cy + (outer + R.labelAt) * Math.sin(a), left = Math.cos(a) < -.2, mid = Math.abs(Math.cos(a)) <= .2;
            return <View key={s.id || 'loose'} pointerEvents="none" style={{ position: 'absolute', top: y - 8, ...(mid ? { left: x - 60, width: 120, alignItems: 'center' } : left ? { right: size - x, maxWidth: 140 } : { left: x, maxWidth: 140 }) }}><Txt kind="label" muted numberOfLines={1}>{s.title || 'Área'}</Txt></View>; })}
        </View>}
    {!!model && panel}
  </View>;
}
