import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { ScrollView } from '@getpaseo/plugin/client/react-native';
import { newId } from '../logic';
import { reducedMotion } from '../motion';
import type { Canvas2DContext } from '../Surfaces';
import { Button, Txt, useUI } from '../ui';
import { betweenness, route } from './course';
import { along, areaColor, arrow, bend, PLATE, plate, rounded, tag, tooltip, type Point } from './kit';
import { clamp, edges, ground, hops, kindColor, palette, seeded, things, type Edge, type WorldProps } from './shared';
import { Stage, type Sight } from './Stage';

type Sent = 'idle' | 'sending' | 'sent' | 'queued' | 'failed';
/**
 * The canvas as a watershed. Everything stays where you put it; the links become rivers that run the way they
 * point and are as wide as the number of shortest ways that pass through them. Press what you already know and
 * then what you want to understand: only the shortest way between them stays lit, and it can be asked for.
 */
export function CourseView({ controller: c, onOpen }: WorldProps) {
  const u = useUI(), p = palette(u), doc = c.view!.document, catalog = c.catalog;
  const [from, setFrom] = useState<string | null>(null), [to, setTo] = useState<string | null>(null), [hover, setHover] = useState<string | null>(null), [sent, setSent] = useState<Sent>('idle'), born = useRef(0);
  const model = useMemo(() => {
    const all = things(doc), g = ground(doc, catalog, all), shown = all.filter(t => g.at.has(t.id)), ids = new Set(shown.map(t => t.id)), links = edges(doc, all).filter(l => ids.has(l.from) && ids.has(l.to));
    const touch = new Map<string, Edge[]>(); for (const l of links) for (const id of [l.from, l.to]) (touch.get(id) ?? touch.set(id, []).get(id)!).push(l);
    return { ...g, shown, links, touch, byId: new Map(shown.map(t => [t.id, t])), busy: betweenness(shown.map(t => t.id), links) };
  }, [doc.blocks, doc.groups, doc.links, catalog]);
  useEffect(() => { if (from && !model.byId.has(from)) { setFrom(null); setTo(null); } else if (to && !model.byId.has(to)) setTo(null); }, [model, from, to]);
  const way = useMemo(() => from && to && from !== to ? route(from, to, model.links) : null, [from, to, model.links]);
  const steps = useMemo(() => from ? hops(from, model.links) : null, [from, model.links]);
  const onWay = useMemo(() => new Map((way?.via ?? []).map((e, i) => [e.id, way!.ids[i] === e.from])), [way]), inWay = useMemo(() => new Map((way?.ids ?? []).map((id, i) => [id, i])), [way]);
  const title = (id: string | null) => (id ? model.byId.get(id)?.title : '') || 'Sin título';
  const restart = () => { setFrom(null); setTo(null); setSent('idle'); };
  const press = (id: string | null) => { if (!id) return; setSent('idle'); if (!from || (to && id !== from)) { setFrom(id); setTo(null); } else if (id === from) restart(); else setTo(id); };
  const ask = async () => {
    if (!way || !from || !to) return; setSent('sending');
    try {
      const result = await c.send({ kind: 'route.explain', label: `Explicar el camino de «${title(from)}» a «${title(to)}»`, payload: { path: way.ids, titles: way.ids.map(title), links: way.via.map(e => ({ kind: e.kind, label: e.label })) }, targetIds: way.ids.slice(0, 20), delivery: 'immediate' }, newId('evt'));
      setSent(!result || result.status === 'failed' ? 'failed' : result.status === 'pending' ? 'queued' : 'sent');
    } catch { setSent('failed'); }
  };

  const draw = (ctx: Canvas2DContext, sight: Sight) => {
    if (!born.current) born.current = sight.time; const still = reducedMotion.current, t = sight.time, rise = still ? 1 : clamp((t - born.current) / 600, 0, 1), near = new Set((hover ? model.touch.get(hover) ?? [] : []).map(l => l.id));
    for (const a of model.areas) { const color = areaColor(p, a.index); rounded(ctx, a.x, a.y, a.width, a.height, 22); ctx.fillStyle = p.a(color, .04); ctx.fill(); ctx.lineWidth = 1.25; ctx.strokeStyle = p.a(color, .28); ctx.setLineDash([2, 7]); ctx.stroke(); ctx.setLineDash([]); tag(ctx, p, a.title, a.x + 18, a.y - 14, { size: 13, weight: 700, color, pad: false }); }
    ctx.lineCap = 'round';
    for (const pass of [0, 1]) for (const l of model.links) {
      const lit = onWay.has(l.id); if ((pass === 1) !== lit) continue; const a = model.at.get(l.from), b = model.at.get(l.to); if (!a || !b) continue;
      const mid = bend(a, b, (seeded(l.id) - .5) * .26), width = 2.5 + 11 * (model.busy.get(l.id) ?? 0), color = lit ? p.accent : kindColor(p, l.kind), touched = near.has(l.id), fade = rise * (way ? (lit ? 1 : .3) : hover ? (touched ? 1 : .3) : 1);
      const trace = () => { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo(mid.x, mid.y, b.x, b.y); };
      if (lit) { ctx.shadowColor = p.a(p.accent, .8); ctx.shadowBlur = 18 * sight.scale; } trace(); ctx.lineWidth = lit ? width + 5 : width; ctx.strokeStyle = p.a(color, (lit ? .9 : .34) * fade); ctx.stroke(); ctx.shadowBlur = 0; ctx.shadowColor = 'transparent';
      // The current: bright dashes that travel the way the link points, or the way the route crosses it.
      const forward = lit ? onWay.get(l.id)! : true, dash = 5 + width * .5, gap = 15 + width, core = Math.max(1.5, width * .36);
      if (still) { ctx.fillStyle = p.a(lit ? p.paper : color, fade); const tip = along(a, mid, b, forward ? .56 : .44), tail = along(a, mid, b, forward ? .46 : .54); arrow(ctx, tail, tip, 8 + width * .5); }
      else { trace(); ctx.setLineDash([dash, gap]); ctx.lineDashOffset = (forward ? -1 : 1) * (t * (lit ? .07 : .028) % (dash + gap)); ctx.lineWidth = core; ctx.strokeStyle = p.a(lit ? p.paper : color, (lit ? .95 : .9) * fade); ctx.stroke(); ctx.setLineDash([]); ctx.lineDashOffset = 0; }
      if (l.label && sight.scale >= .95 && (lit || touched)) { const m = along(a, mid, b, .5); tag(ctx, p, l.label, m.x, m.y - width / 2 - 11, { size: 11, align: 'center', color: lit ? p.accent : p.ink }); }
    }
    for (const thing of model.shown) {
      const at = model.at.get(thing.id)!, order = inWay.get(thing.id), reach = steps?.get(thing.id), isFrom = thing.id === from, isHover = thing.id === hover, touched = !!hover && (model.touch.get(hover) ?? []).some(l => l.from === thing.id || l.to === thing.id);
      const dim = way ? order === undefined : from ? reach === undefined : !!hover && !isHover && !touched;
      ctx.globalAlpha = rise; plate(ctx, p, sight, thing, at.x, at.y, { dim, hover: isHover, lit: touched && !way, chosen: order !== undefined || isFrom, badge: order !== undefined ? String(order + 1) : isFrom ? 'Desde' : undefined, badgeColor: isFrom && !way ? p.ok : p.accent });
      if (from && !way && !isFrom && reach !== undefined && sight.scale >= .5) tag(ctx, p, reach === 1 ? 'a 1 paso' : `a ${reach} pasos`, at.x, at.y + PLATE.h / 2 + 13, { size: 11, align: 'center', color: p.ok });
      ctx.globalAlpha = 1;
    }
    // Something travelling the whole route, so the order of the steps is a movement and not only numbers.
    if (way && way.via.length && !still) for (let n = 0; n < 3; n++) {
      const k = ((t / (700 * way.via.length + 900) + n / 3) % 1) * way.via.length, i = Math.min(way.via.length - 1, Math.floor(k)), e = way.via[i], a = model.at.get(e.from), b = model.at.get(e.to); if (!a || !b) continue;
      const mid = bend(a, b, (seeded(e.id) - .5) * .26), forward = way.ids[i] === e.from, dot: Point = along(a, mid, b, forward ? k - i : 1 - (k - i)); ctx.beginPath(); ctx.arc(dot.x, dot.y, 6, 0, 6.2832); ctx.fillStyle = p.paper; ctx.fill(); ctx.lineWidth = 2.5; ctx.strokeStyle = p.accent; ctx.stroke();
    }
  };
  const overlay = (ctx: Canvas2DContext, sight: Sight) => {
    const thing = hover ? model.byId.get(hover) : undefined, at = hover ? model.at.get(hover) : undefined; if (!thing || !at) return; const n = model.touch.get(thing.id)?.length ?? 0;
    tooltip(ctx, p, sight, { x: at.x + PLATE.w / 2 - 14, y: at.y + PLATE.h / 2 - 14 }, thing.title, [thing.summary, n ? `${n} ${n === 1 ? 'enlace pasa' : 'enlaces pasan'} por aquí.` : 'Ningún enlace pasa por aquí.', !from ? 'Presiona si es lo que ya conoces.' : thing.id === from ? 'Presiona otra vez para soltarlo.' : 'Presiona para ver el camino hasta aquí.']);
  };
  const hit = (x: number, y: number, sight: Sight) => { const rx = Math.max(PLATE.w / 2, 14 / sight.scale), ry = Math.max(PLATE.h / 2, 14 / sight.scale); for (let i = model.shown.length - 1; i >= 0; i--) { const at = model.at.get(model.shown[i].id)!; if (Math.abs(x - at.x) <= rx && Math.abs(y - at.y) <= ry) return model.shown[i].id; } return null; };
  const count = model.shown.length, summary = !count ? 'Todavía no hay nada en este lienzo.' : way ? `Camino de ${title(from)} a ${title(to)}: ${way.ids.map(title).join(' → ')}.` : `${count} cosas unidas por ${model.links.length} enlaces. Elige dos para ver el camino más corto entre ellas.`;
  const note = sent === 'sending' ? 'Enviando…' : sent === 'sent' ? 'Enviado al asistente.' : sent === 'queued' ? 'Guardado en cola: sale cuando haya un asistente conectado.' : sent === 'failed' ? 'No se envió.' : '';
  return <Stage id="course" title="Cauce" question="¿Cuál es el camino más corto para explicar una cosa a partir de otra? Toca lo que ya conoces y luego lo que quieres entender." summary={summary} fitKey={`${count}:${Math.round(model.bounds.width)}:${Math.round(model.bounds.height)}`} bounds={model.bounds}
    legend={[{ color: p.flow, shape: 'line', text: 'Flujo' }, { color: p.needs, shape: 'line', text: 'Necesita' }, { color: p.mentions, shape: 'line', text: 'Menciona' }, { color: p.muted, shape: 'bar', text: 'Más ancho = más caminos pasan por ahí' }]}
    draw={draw} overlay={overlay} hit={hit} onHover={setHover} onPress={press}
    side={!from ? undefined : !to ? <><Txt kind="label" muted>Desde</Txt><Txt kind="heading" numberOfLines={3}>{title(from)}</Txt><Txt kind="small" muted>Ahora toca lo que quieres entender. Cada cosa dice a cuántos pasos queda.</Txt><Button label="Empezar de nuevo" small variant="ghost" onPress={restart} /></>
      : !way ? <><Txt kind="heading">Sin camino</Txt><Txt kind="small" muted>No hay camino entre «{title(from)}» y «{title(to)}»: ningún enlace las une, ni siquiera pasando por otras.</Txt><Button label="Empezar de nuevo" small onPress={restart} /></>
      : <><Txt kind="heading">El camino más corto</Txt><Txt kind="small" muted>{way.ids.length} pasos de «{title(from)}» a «{title(to)}»</Txt>
        <ScrollView style={{ maxHeight: 240 }}>{way.ids.map((id, i) => <View key={id} style={{ marginBottom: 10, gap: 3 }}>
          {i > 0 && !!way.via[i - 1]?.label && <Txt kind="label" muted style={{ marginLeft: 28 }}>↓ {way.via[i - 1].label}</Txt>}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><View style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: u.c.accent, justifyContent: 'center', alignItems: 'center' }}><Txt kind="label" style={{ color: u.c.surface0, fontWeight: '700' }}>{i + 1}</Txt></View><Txt kind="small" numberOfLines={2} style={{ flex: 1, fontWeight: '500' }}>{title(id)}</Txt></View></View>)}</ScrollView>
        <Button label="Pedir esta explicación" variant="primary" small icon="SendHorizontal" disabled={c.offline || sent === 'sending'} onPress={() => { void ask(); }} />
        {!!note && <Txt kind="small" style={{ color: sent === 'failed' ? u.c.statusDanger : u.c.accent }}>{note}</Txt>}
        <Button label="Ver en el lienzo" small icon="Frame" onPress={() => onOpen(way.ids[0])} /><Button label="Empezar de nuevo" small variant="ghost" onPress={restart} /></>}>
    {!count && <View pointerEvents="none" style={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center' }}><Txt kind="small" muted>Todavía no hay nada en este lienzo.</Txt></View>}
    {!!count && !from && <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, bottom: 136, alignItems: 'center' }}><View style={{ backgroundColor: u.c.surface1, borderWidth: 1, borderColor: u.c.border, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 14 }}><Txt kind="small" muted>{model.links.length ? 'Toca lo que ya conoces' : 'Sin enlaces no hay cauce: este lienzo todavía no conecta nada.'}</Txt></View></View>}
  </Stage>;
}
