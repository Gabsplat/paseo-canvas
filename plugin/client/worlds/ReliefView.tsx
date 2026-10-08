import React, { useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { reducedMotion } from '../motion';
import type { Canvas2DContext } from '../Surfaces';
import { Button, Txt, useUI } from '../ui';
import { areaColor, legible, tag, tooltip } from './kit';
import { contours, reliefField, summits } from './relief';
import { clamp, easeOut, edges, ground, mix, palette, things, type Edge, type WorldProps } from './shared';
import { Stage, type Sight } from './Stage';

const BANDS = 9, SIGMA = 150;
/**
 * The canvas as land seen from above. Nothing moves from where you put it; the ground rises where things are
 * linked the most, so the summits are what the rest leans on and the plains are what nobody connects. Raise the
 * water and the lowlands go under, leaving only the most connected in sight.
 */
export function ReliefView({ controller: c, onOpen }: WorldProps) {
  const u = useUI(), p = palette(u), doc = c.view!.document, catalog = c.catalog, [hover, setHover] = useState<string | null>(null), [sea, setSea] = useState(0), water = useRef(0), born = useRef(0);
  const model = useMemo(() => {
    const all = things(doc), g = ground(doc, catalog, all, .8, 280), shown = all.filter(t => g.at.has(t.id)), ids = new Set(shown.map(t => t.id)), links = edges(doc, all).filter(l => ids.has(l.from) && ids.has(l.to)), b = g.bounds;
    const degree = new Map<string, number>(), touch = new Map<string, Edge[]>(); for (const l of links) for (const id of [l.from, l.to]) { degree.set(id, (degree.get(id) ?? 0) + 1); (touch.get(id) ?? touch.set(id, []).get(id)!).push(l); }
    const cell = Math.max(8, Math.ceil(Math.max(b.width / 230, b.height / 160))), cols = Math.ceil(b.width / cell) + 1, rows = Math.ceil(b.height / cell) + 1;
    const samples = shown.map(t => ({ id: t.id, x: g.at.get(t.id)!.x - b.x, y: g.at.get(t.id)!.y - b.y, weight: 1 + (degree.get(t.id) ?? 0) })), field = reliefField(samples, cols, rows, cell, SIGMA);
    let max = 0; for (let i = 0; i < field.length; i++) max = Math.max(max, field[i]); max = max || 1;
    const bandAt = (col: number, row: number) => clamp(Math.floor(field[clamp(row, 0, rows - 1) * cols + clamp(col, 0, cols - 1)] / max * BANDS), 0, BANDS - 1);
    // Horizontal runs of cells of the same height and the same light, so a frame is a few thousand rectangles. Light
    // comes from the upper left: 0 flat, 1-2 facing it, 3-4 turned away. This is what makes it read as relief.
    const shade = (col: number, row: number) => { const h = (r: number, k: number) => field[clamp(r, 0, rows - 1) * cols + clamp(k, 0, cols - 1)], s = (h(row - 1, col - 1) - h(row + 1, col + 1)) / max * 7; return s > .3 ? 1 : s > .1 ? 2 : s < -.3 ? 4 : s < -.1 ? 3 : 0; };
    const land: number[][] = Array.from({ length: BANDS * 5 }, () => []);
    for (let row = 0; row < rows; row++) { let start = 0, kind = bandAt(0, row) * 5 + shade(0, row); for (let col = 1; col <= cols; col++) { const next = col < cols ? bandAt(col, row) * 5 + shade(col, row) : -1; if (next !== kind) { land[kind].push(start * cell - cell / 2, row * cell - cell / 2, (col - start) * cell); start = col; kind = next; } } }
    const lines = Array.from({ length: BANDS - 1 }, (_, i) => contours(field, cols, rows, (i + 1) / BANDS * max)), band = new Map(samples.map(s => [s.id, bandAt(Math.round(s.x / cell), Math.round(s.y / cell))]));
    const height = new Map(samples.map(s => [s.id, field[clamp(Math.round(s.y / cell), 0, rows - 1) * cols + clamp(Math.round(s.x / cell), 0, cols - 1)] / max]));
    return { ...g, shown, links, degree, touch, byId: new Map(shown.map(t => [t.id, t])), cell, land, lines, band, height, peaks: new Set(summits(samples, field, cols, rows, cell, 5).map(s => s.id)) };
  }, [doc.blocks, doc.groups, doc.links, catalog]);
  const size = (id: string) => 5 + 1.9 * Math.sqrt(model.degree.get(id) ?? 0), selected = c.selection.length === 1 && model.byId.has(c.selection[0]) ? c.selection[0] : null;
  const afloat = model.shown.filter(t => (model.band.get(t.id) ?? 0) >= sea).length;

  const draw = (ctx: Canvas2DContext, sight: Sight) => {
    if (!model.shown.length) return; if (!born.current) born.current = sight.time; const still = reducedMotion.current, t = sight.time, b = model.bounds, cell = model.cell;
    water.current = still ? sea : water.current + (sea - water.current) * (1 - Math.exp(-sight.dt / 220)); if (Math.abs(sea - water.current) < .01) water.current = sea; const level = water.current, grown = (still ? 1 : easeOut((t - born.current) / 900)) * BANDS;
    const tone = [p.mentions, p.mentions, p.mentions, p.ok, p.ok, p.wait, p.wait, p.wait, p.ink], depth = [0, .1, .17, .2, .28, .3, .4, .5, .42], sea0 = mix(p.paper, p.flow, still ? .24 : .24 + .03 * Math.sin(t / 1300));
    const bright = p.dark ? p.ink : p.paper, dark = p.dark ? p.paper : p.ink, lit = p.dark ? [0, .12, .06, .3, .52] : [0, .5, .28, .07, .14];
    // Neighbouring rectangles overlap by more than a screen pixel, or their soft edges would let the paper through.
    const lap = 1.3 / sight.scale; ctx.save(); ctx.translate(b.x, b.y);
    for (let k = 0; k < BANDS; k++) {
      const wet = clamp(level - k, 0, 1), up = clamp(grown - k, 0, 1); if (!wet && (k === 0 || !up)) continue;
      const soil = mix(p.paper, tone[k], depth[k] * up), deep = mix(sea0, p.paper, clamp((Math.floor(level) - k) * .12, 0, .5));
      for (let sh = 0; sh < 5; sh++) { const runs = model.land[k * 5 + sh]; if (!runs.length || (k === 0 && !wet && sh === 0)) continue;
        ctx.fillStyle = mix(sh ? mix(soil, sh < 3 ? bright : dark, lit[sh] * up) : soil, deep, wet); for (let i = 0; i < runs.length; i += 3) ctx.fillRect(runs[i], runs[i + 1], runs[i + 2] + lap, cell + lap); }
    }
    model.lines.forEach((segments, i) => {
      const k = i + 1; if (k > grown) return; const shore = level > .4 && k === Math.round(level), index = k % 3 === 0; ctx.beginPath(); for (let s = 0; s < segments.length; s += 4) { ctx.moveTo(segments[s] * cell, segments[s + 1] * cell); ctx.lineTo(segments[s + 2] * cell, segments[s + 3] * cell); }
      ctx.lineWidth = (shore ? 2.4 : index ? 1.5 : .8) / Math.min(1.4, Math.max(.5, sight.scale)); ctx.strokeStyle = shore ? p.a(p.flow, .95) : p.a(p.ink, k < level ? .08 : index ? .36 : .2); ctx.stroke();
    });
    ctx.restore();
    // The edge of the sheet: this is a chart of the canvas, not the whole world.
    ctx.lineWidth = 1 / sight.scale; ctx.strokeStyle = p.a(p.ink, .16); ctx.strokeRect(b.x - cell / 2, b.y - cell / 2, Math.ceil(b.width / cell + 1) * cell, Math.ceil(b.height / cell + 1) * cell);
    const near = new Set((hover ? model.touch.get(hover) ?? [] : []).map(l => l.id));
    for (const l of model.links) { const a = model.at.get(l.from), z = model.at.get(l.to); if (!a || !z) continue; const on = near.has(l.id), sunk = (model.band.get(l.from) ?? 0) < Math.round(level) || (model.band.get(l.to) ?? 0) < Math.round(level);
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(z.x, z.y); ctx.lineWidth = (on ? 2.2 : 1.1) * legible(sight); ctx.setLineDash(on ? [] : [4 * legible(sight), 6 * legible(sight)]); ctx.strokeStyle = p.a(p.ink, on ? .85 : sunk ? .06 : hover ? .12 : .28); ctx.stroke(); ctx.setLineDash([]); }
    const few = model.shown.length <= 34, k = legible(sight);
    for (const thing of model.shown) {
      const at = model.at.get(thing.id)!, r = size(thing.id) * k, sunk = (model.band.get(thing.id) ?? 0) < Math.round(level), on = thing.id === hover, peak = model.peaks.has(thing.id), chosen = thing.id === selected, color = areaColor(p, thing.areaIndex);
      ctx.globalAlpha = sunk && !on ? .22 : 1; if (on || chosen) { ctx.shadowColor = p.a(chosen ? p.accent : color, .85); ctx.shadowBlur = 16 * sight.scale; }
      ctx.beginPath(); ctx.arc(at.x, at.y, on ? r + 2 : r, 0, 6.2832); ctx.fillStyle = color; ctx.fill(); ctx.shadowBlur = 0; ctx.shadowColor = 'transparent'; ctx.lineWidth = (chosen ? 3 : 1.75) * k; ctx.strokeStyle = chosen ? p.accent : p.paper; ctx.stroke();
      if (peak && !sunk) { ctx.beginPath(); ctx.moveTo(at.x, at.y - r - 15 * k); ctx.lineTo(at.x - 7 * k, at.y - r - 4 * k); ctx.lineTo(at.x + 7 * k, at.y - r - 4 * k); ctx.closePath(); ctx.fillStyle = p.ink; ctx.fill(); }
      if ((!sunk || on) && (peak || on || chosen || few || sight.scale >= .7)) { const text = thing.title.length > 32 ? thing.title.slice(0, 31).trimEnd() + '…' : thing.title; tag(ctx, p, text, at.x + r + 9 * k, at.y, { size: peak ? 13 : 12, weight: peak || on ? 700 : 500, color: p.ink, alpha: peak || on ? .92 : .7, k });
        if (peak && sight.scale >= .55) { const n = model.degree.get(thing.id) ?? 0; tag(ctx, p, `cumbre · ${n} ${n === 1 ? 'enlace' : 'enlaces'}`, at.x + r + 9 * k, at.y + 17 * k, { size: 10, color: p.ink, alpha: .7, k }); } }
      ctx.globalAlpha = 1;
    }
  };
  const overlay = (ctx: Canvas2DContext, sight: Sight) => {
    const thing = hover ? model.byId.get(hover) : undefined, at = hover ? model.at.get(hover) : undefined; if (!thing || !at) return; const n = model.degree.get(thing.id) ?? 0;
    tooltip(ctx, p, sight, at, thing.title, [thing.summary, `${n} ${n === 1 ? 'enlace' : 'enlaces'} · altura ${Math.round((model.height.get(thing.id) ?? 0) * 100)} % de la más alta`, (model.band.get(thing.id) ?? 0) < sea ? 'Bajo el agua con este nivel.' : '', 'Presiona para elegirlo.']);
  };
  const hit = (x: number, y: number, sight: Sight) => { let best: string | null = null, reach = Infinity; for (const thing of model.shown) { const at = model.at.get(thing.id)!, d = Math.hypot(x - at.x, y - at.y); if (d <= Math.max(size(thing.id) * legible(sight) + 8, 14 / sight.scale) && d < reach) { reach = d; best = thing.id; } } return best; };
  const count = model.shown.length, chosen = selected ? model.byId.get(selected) : undefined, peaks = model.shown.filter(t => model.peaks.has(t.id)).map(t => t.title);
  const summary = !count ? 'Todavía no hay nada en este lienzo.' : !model.links.length ? `${count} cosas sin enlaces: el terreno es llano.` : `${count} cosas. Lo más enlazado: ${peaks.slice(0, 4).join(', ')}.`;
  return <Stage id="relieve" title="Relieve" question="¿Dónde se concentra esto? El suelo sube donde hay más enlaces: las cumbres son lo que el resto necesita." summary={summary} fitKey={`${count}:${Math.round(model.bounds.width)}:${Math.round(model.bounds.height)}`} bounds={model.bounds}
    legend={[{ color: p.a(p.mentions, .5), shape: 'bar', text: 'Llano = poco enlazado' }, { color: p.a(p.wait, .7), shape: 'bar', text: 'Alto = muy enlazado' }, { color: p.ink, text: '▲ Cumbre' }, { color: p.a(p.flow, .6), shape: 'bar', text: 'Agua' }]}
    draw={draw} overlay={overlay} hit={hit} onHover={setHover} onPress={id => { if (id) void c.select([id]); }}
    side={count ? <><Txt kind="label" muted>Nivel del agua</Txt>
      <View style={{ flexDirection: 'row', gap: 6 }}><Button label="Bajar" small icon="Minus" disabled={sea <= 0} onPress={() => setSea(sea - 1)} /><Button label="Subir" small icon="Plus" disabled={sea >= BANDS - 1 || afloat <= 1} onPress={() => setSea(sea + 1)} /></View>
      <Txt kind="small" muted>{sea ? `Quedan ${afloat} de ${count} a la vista: lo más enlazado.` : 'Sube el agua para dejar a la vista solo lo más enlazado.'}</Txt>
      {!!chosen && <View style={{ gap: 6, borderTopWidth: 1, borderColor: u.c.border, paddingTop: 10 }}><Txt kind="heading" numberOfLines={3}>{chosen.title}</Txt>{!!chosen.summary && <Txt kind="small" muted numberOfLines={4}>{chosen.summary}</Txt>}
        <Txt kind="small">{model.degree.get(chosen.id) ?? 0} enlaces · altura {Math.round((model.height.get(chosen.id) ?? 0) * 100)} %</Txt><Button label="Ver en el lienzo" small icon="Frame" onPress={() => onOpen(chosen.id)} /></View>}</> : undefined}>
    {!count && <View pointerEvents="none" style={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center' }}><Txt kind="small" muted>Todavía no hay nada en este lienzo.</Txt></View>}
  </Stage>;
}
