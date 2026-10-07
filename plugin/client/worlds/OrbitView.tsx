import React, { useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { reducedMotion } from '../motion';
import type { Canvas2DContext } from '../Surfaces';
import { Button, Txt, useUI } from '../ui';
import { along, areaColor, arrow, bend, Drift, legible, plate, tag, tooltip, type Point } from './kit';
import { orbitModel, pickCentre, polar } from './orbit';
import { adjacency, edges, FONT, kindColor, palette, seeded, things, type Edge, type WorldProps } from './shared';
import { Stage, type Sight } from './Stage';

const RING = ['', 'a 1 enlace', 'a 2 enlaces', 'a 3 o más', 'sin camino'], SUN = { w: 224, h: 72 };
/**
 * A system around one thing. Whatever is selected is the sun; everything else sits on the orbit of how many links
 * away it is, in the slice of sky that belongs to its area. A line back towards the sun says through what it is
 * reached. Press a body and the whole system rearranges around it.
 */
export function OrbitView({ controller: c, onOpen }: WorldProps) {
  const u = useUI(), p = palette(u), doc = c.view!.document, [hover, setHover] = useState<string | null>(null);
  const base = useMemo(() => { const all = things(doc), links = edges(doc, all), degree = new Map<string, number>(); for (const l of links) { degree.set(l.from, (degree.get(l.from) ?? 0) + 1); degree.set(l.to, (degree.get(l.to) ?? 0) + 1); } return { all, links, degree, byId: new Map(all.map(t => [t.id, t])) }; }, [doc.blocks, doc.groups, doc.links]);
  const centre = pickCentre(base.all, base.links, c.selection);
  const model = useMemo(() => {
    if (!centre) return null;
    const m = orbitModel(base.all, base.links, centre), near = adjacency(base.links), parent = new Map<string, { id: string; edge: Edge; outward: boolean }>(), seen = new Set([centre]), queue = [centre];
    for (let i = 0; i < queue.length; i++) for (const n of near.get(queue[i]) ?? []) if (!seen.has(n.id)) { seen.add(n.id); parent.set(n.id, { id: queue[i], edge: n.edge, outward: n.out }); queue.push(n.id); }
    const n = m.counts, r1 = Math.max(235, n[1] * 60 / 6.283), r2 = Math.max(r1 + 135, n[2] * 54 / 6.283), r3 = Math.max(r2 + 115, n[3] * 48 / 6.283), r4 = Math.max(r3 + 105, n[4] * 40 / 6.283), radius = [0, r1, r2, r3, r4];
    const outer = radius[[4, 3, 2, 1].find(k => n[k] > 0) ?? 1], targets = new Map<string, Point>(m.bodies.map(b => [b.id, b.ring === 0 ? { x: 0, y: 0 } : polar(0, 0, radius[b.ring], b.angle)]));
    return { ...m, parent, radius, outer, targets, ring: new Map(m.bodies.map(b => [b.id, b.ring])) };
  }, [base, centre]);
  const drift = useRef(new Drift()), now = useRef(new Map<string, Point>());
  const chain = (id: string) => { const out = [id]; for (let at = model?.parent.get(id); at && out.length < 40; at = model?.parent.get(at.id)) out.push(at.id); return out; };
  const size = (id: string) => Math.min(20, 7 + 2.4 * Math.sqrt(base.degree.get(id) ?? 0));

  const draw = (ctx: Canvas2DContext, sight: Sight) => {
    if (!model) return; const still = reducedMotion.current, t = sight.time, R = model.radius, span = model.outer + 420, k = legible(sight);
    for (let i = 0; i < 130; i++) { const x = (seeded('sx', i) * 2 - 1) * span, y = (seeded('sy', i) * 2 - 1) * span; ctx.fillStyle = p.a(p.ink, .05 + .12 * seeded('sa', i) * (still ? 1 : .6 + .4 * Math.sin(t / 900 + i))); ctx.fillRect(x, y, 2, 2); }
    // Each area owns a slice of the sky, so an area is a direction you can point at.
    if (model.sectors.length > 1) for (const s of model.sectors) {
      const color = areaColor(p, s.areaIndex), inner = R[1] - 70, rim = model.outer + 50; ctx.beginPath(); ctx.arc(0, 0, rim, s.a0, s.a1); ctx.arc(0, 0, inner, s.a1, s.a0, true); ctx.closePath(); ctx.fillStyle = p.a(color, .05); ctx.fill();
      const edge = polar(0, 0, inner, s.a0), far = polar(0, 0, rim, s.a0); ctx.beginPath(); ctx.moveTo(edge.x, edge.y); ctx.lineTo(far.x, far.y); ctx.lineWidth = 1; ctx.strokeStyle = p.a(p.ink, .1); ctx.stroke();
      const at = polar(0, 0, rim + 62 * k, (s.a0 + s.a1) / 2); tag(ctx, p, s.area || 'Sin área', at.x, at.y, { size: 13, weight: 700, color, align: 'center', k });
    }
    for (const ring of [1, 2, 3, 4]) { if (!model.counts[ring]) continue; ctx.beginPath(); ctx.arc(0, 0, R[ring], 0, 6.2832); ctx.lineWidth = 1.25 * k; ctx.strokeStyle = p.a(p.ink, ring === 4 ? .16 : .22); ctx.setLineDash(ring === 4 ? [3, 9] : []); ctx.stroke(); ctx.setLineDash([]); tag(ctx, p, RING[ring], 0, -R[ring], { size: 11, weight: 600, align: 'center', alpha: 1, k }); }
    const targets = model.targets, bobbed = new Map<string, Point>();
    for (const [id, to] of targets) { const ring = model.ring.get(id) ?? 0, wob = still || !ring ? 0 : 3.5 * Math.sin(t / 1500 + 6.283 * seeded(id)), len = Math.hypot(to.x, to.y) || 1; bobbed.set(id, { x: to.x + to.x / len * wob, y: to.y + to.y / len * wob }); }
    const at = drift.current.step(bobbed, sight.dt, still, { x: 0, y: 0 }); now.current = at;
    const lit = new Set(hover ? chain(hover) : []), origin = at.get(model.centre) ?? { x: 0, y: 0 };
    // How each body is reached: a thread to the one before it on the way to the sun.
    for (const [id, via] of model.parent) {
      const a = at.get(via.id), b = at.get(id); if (!a || !b) continue; const first = via.id === model.centre, on = lit.has(id), color = kindColor(p, via.edge.kind), mid = bend(a, b, first ? .1 : .06);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo(mid.x, mid.y, b.x, b.y); ctx.lineWidth = (on ? 2.75 : first ? 1.9 : 1) * k; ctx.strokeStyle = on ? p.accent : p.a(first ? color : p.ink, hover ? (first ? .3 : .08) : first ? .75 : .17); ctx.stroke();
      if (first || on) { const tip = along(a, mid, b, .78), head = via.outward ? tip : along(a, mid, b, .3), tail = via.outward ? along(a, mid, b, .7) : along(a, mid, b, .38); ctx.fillStyle = on ? p.accent : p.a(color, hover ? .35 : .9); arrow(ctx, tail, head, 9 * k);
        if (!still && first) { const f = (t / 2600 + seeded(id)) % 1, dot = along(a, mid, b, via.outward ? f : 1 - f); ctx.beginPath(); ctx.arc(dot.x, dot.y, 2.8 * k, 0, 6.2832); ctx.fillStyle = p.a(color, .9 * Math.sin(f * 3.1416)); ctx.fill(); }
        if (via.edge.label && sight.scale >= .9 && (first || on)) { const m = along(a, mid, b, .52); tag(ctx, p, via.edge.label, m.x, m.y, { size: 10, align: 'center', color: on ? p.accent : p.muted, k }); } }
    }
    const glow = ctx.createRadialGradient(origin.x, origin.y, 20, origin.x, origin.y, 150 * k * (still ? 1 : 1 + .05 * Math.sin(t / 1100))); glow.addColorStop(0, p.a(p.accent, .5)); glow.addColorStop(1, p.a(p.accent, 0));
    ctx.fillStyle = glow; ctx.beginPath(); ctx.arc(origin.x, origin.y, 170 * k, 0, 6.2832); ctx.fill();
    const few = base.all.length <= 26;
    for (const b of model.bodies) {
      if (b.ring === 0) continue; const pos = at.get(b.id), thing = base.byId.get(b.id); if (!pos || !thing) continue;
      const r = size(b.id) * k, color = areaColor(p, thing.areaIndex), on = b.id === hover, faded = !!hover && !lit.has(b.id);
      ctx.globalAlpha = faded ? .3 : 1; if (on) { ctx.shadowColor = p.a(color, .8); ctx.shadowBlur = 18 * sight.scale; }
      ctx.beginPath(); ctx.arc(pos.x, pos.y, on ? r + 2 : r, 0, 6.2832); ctx.fillStyle = b.ring === 4 ? p.a(color, .35) : color; ctx.fill(); ctx.shadowBlur = 0; ctx.shadowColor = 'transparent';
      ctx.lineWidth = (b.ring === 1 || on ? 2 : 1) * k; ctx.strokeStyle = b.ring === 1 || on ? p.ink : p.a(p.paper, .9); ctx.stroke();
      if (b.ring <= 2 || few || on || lit.has(b.id) || sight.scale >= .8) {
        const right = Math.cos(b.angle) >= 0, lx = pos.x + (r + 7 * k) * (right ? 1 : -1); ctx.font = `${b.ring === 1 || on ? 600 : 500} ${(b.ring === 1 ? 13 : 12) * k}px ${FONT}`; ctx.textAlign = right ? 'left' : 'right'; ctx.textBaseline = 'middle';
        const text = thing.title.length > 30 ? thing.title.slice(0, 29).trimEnd() + '…' : thing.title; ctx.lineWidth = 4 * k; ctx.lineJoin = 'round'; ctx.strokeStyle = p.a(p.paper, .85); ctx.strokeText(text, lx, pos.y);
        ctx.fillStyle = b.ring === 1 || on ? p.ink : p.a(p.ink, b.ring === 2 ? .82 : .6); ctx.fillText(text, lx, pos.y);
      }
      ctx.globalAlpha = 1;
    }
    const sun = base.byId.get(model.centre); if (sun) { ctx.save(); ctx.translate(origin.x, origin.y); ctx.scale(Math.min(k, 1.3), Math.min(k, 1.3)); plate(ctx, p, { ...sight, scale: sight.scale * Math.min(k, 1.3) }, sun, 0, 0, { chosen: true, w: SUN.w, h: SUN.h }); ctx.restore(); }
  };
  const overlay = (ctx: Canvas2DContext, sight: Sight) => {
    const thing = hover ? base.byId.get(hover) : undefined, pos = hover ? now.current.get(hover) : undefined; if (!model || !thing || !pos || hover === model.centre) return;
    const path = chain(thing.id).reverse(), reach = path.length > 1 && path[0] === model.centre;
    tooltip(ctx, p, sight, pos, thing.title, [thing.summary, reach ? `A ${path.length - 1} ${path.length === 2 ? 'enlace' : 'enlaces'}: ${path.map(id => base.byId.get(id)?.title ?? '').join(' → ')}` : 'No hay camino de enlaces hasta el centro.', 'Presiona para ponerlo en el centro.']);
  };
  const hit = (x: number, y: number, sight: Sight) => {
    if (!model) return null; let best: string | null = null, reach = Infinity;
    for (const b of model.bodies) { const pos = now.current.get(b.id); if (!pos) continue; if (b.ring === 0) { if (Math.abs(x - pos.x) <= SUN.w / 2 * Math.min(legible(sight), 1.3) && Math.abs(y - pos.y) <= SUN.h / 2 * Math.min(legible(sight), 1.3)) return b.id; continue; }
      const d = Math.hypot(x - pos.x, y - pos.y); if (d <= Math.max(size(b.id) * legible(sight) + 8, 14 / sight.scale) && d < reach) { reach = d; best = b.id; } }
    return best;
  };
  const sun = model ? base.byId.get(model.centre) : undefined, n = model?.counts ?? [0, 0, 0, 0, 0];
  const summary = sun ? `«${sun.title}» en el centro. ${n[1]} a un enlace, ${n[2]} a dos, ${n[3]} más lejos y ${n[4]} sin camino hasta él.` : 'Todavía no hay nada en este lienzo.';
  const rows: [number, string][] = [[n[1], 'a un enlace'], [n[2], 'a dos enlaces'], [n[3], 'a tres o más'], [n[4], 'sin camino hasta aquí']];
  return <Stage id="orbit" title="Órbita" question="¿Qué tan cerca está todo de esto? Lo elegido es el sol; cada órbita es un enlace más de distancia." summary={summary} fitKey={`${base.all.length}:${model?.outer ?? 0}`}
    bounds={model ? { x: -model.outer - 200, y: -model.outer - 140, width: 2 * model.outer + 400, height: 2 * model.outer + 280 } : { x: 0, y: 0, width: 0, height: 0 }}
    legend={[{ color: p.accent, shape: 'ring', text: 'El centro' }, { color: p.flow, shape: 'line', text: 'Flujo' }, { color: p.needs, shape: 'line', text: 'Necesita' }, { color: p.mentions, shape: 'line', text: 'Menciona' }, { color: p.muted, text: 'Tamaño = cuántos enlaces tiene' }]}
    draw={draw} overlay={overlay} hit={hit} onHover={setHover} onPress={id => { if (id && id !== model?.centre) void c.select([id]); }}
    side={sun ? <><Txt kind="label" muted>En el centro</Txt><Txt kind="heading" numberOfLines={3}>{sun.title}</Txt>{!!sun.summary && <Txt kind="small" muted numberOfLines={4}>{sun.summary}</Txt>}
      <View style={{ gap: 3 }}>{rows.filter(r => r[0] > 0).map(r => <View key={r[1]} style={{ flexDirection: 'row', gap: 8 }}><Txt kind="small" style={{ width: 26, textAlign: 'right', fontWeight: '600' }}>{r[0]}</Txt><Txt kind="small" muted>{r[1]}</Txt></View>)}</View>
      <Txt kind="label" muted>Presiona otro cuerpo para ponerlo en el centro.</Txt><Button label="Ver en el lienzo" small icon="Frame" onPress={() => onOpen(sun.id)} /></> : undefined}>
    {!sun && <View pointerEvents="none" style={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center' }}><Txt kind="small" muted>Todavía no hay nada en este lienzo.</Txt></View>}
  </Stage>;
}
