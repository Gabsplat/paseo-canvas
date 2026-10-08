import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { reducedMotion } from '../motion';
import type { Canvas2DContext } from '../Surfaces';
import { Button, Txt, useUI } from '../ui';
import { areaColor, arrow, rounded, tag, tooltip, wrap } from './kit';
import { easeOut, edges, FONT, palette, seeded, things, type WorldProps } from './shared';
import { Stage, type Sight } from './Stage';
import { strataModel, type Cell } from './strata';

type Box = { cell: Cell; x: number; y: number; w: number; h: number };
const H = 112, MIN = 156, WAVE = (x: number, depth: number) => depth < 0 ? 0 : 5 * Math.sin(x * .011 + 6.283 * seeded('s', depth)) + 3 * Math.sin(x * .029 + 6.283 * seeded('t', depth));
/**
 * A cut through the ground. Left and right mean nothing here: only what rests on what. The bottom layer needs
 * nothing; every layer above rests on something below it. A block is as wide as what it carries. Point at one to
 * see what it stands on and what stands on it; press it to take a core sample of everything above or below.
 */
export function StrataView({ controller: c, onOpen }: WorldProps) {
  const u = useUI(), p = palette(u), doc = c.view!.document;
  const [hover, setHover] = useState<string | null>(null), [picked, setPicked] = useState<string | null>(null), [mode, setMode] = useState<'above' | 'below'>('above'), born = useRef(0);
  const model = useMemo(() => {
    const all = things(doc), links = edges(doc, all), m = strataModel(all, links), rows = m.layers, width = Math.max(1320, ...rows.map(r => r.length * 184)), boxes: Box[] = [], keyOf = new Map<string, string>();
    rows.forEach((row, depth) => { const weights = row.map(cell => 1 + .6 * Math.log2(1 + cell.load)), total = weights.reduce((a, b) => a + b, 0), spare = width - MIN * row.length; let x = 0;
      row.forEach((cell, i) => { const w = MIN + spare * weights[i] / total; boxes.push({ cell, x, y: -(depth + 1) * H, w, h: H }); x += w; for (const id of cell.ids) keyOf.set(id, cell.key); }); });
    // Which blocks touch directly: `rests` goes down to what a block stands on, `holds` goes up to what stands on it.
    const rests = new Map<string, Set<string>>(), holds = new Map<string, Set<string>>(), add = (map: Map<string, Set<string>>, a: string, b: string) => { (map.get(a) ?? map.set(a, new Set()).get(a)!).add(b); };
    for (const l of links) { if (l.kind === 'reference') continue; const [upper, lower] = l.kind === 'depends' ? [keyOf.get(l.from), keyOf.get(l.to)] : [keyOf.get(l.to), keyOf.get(l.from)]; if (upper && lower && upper !== lower) { add(rests, upper, lower); add(holds, lower, upper); } }
    const top = -rows.length * H, perRow = Math.max(1, Math.floor(width / 168)), pebbles = m.loose.map((t, i) => ({ thing: t, x: 84 + (i % perRow) * 168, y: top - 92 - Math.floor(i / perRow) * 50 }));
    const height = rows.length * H + (pebbles.length ? 110 + Math.floor((pebbles.length - 1) / perRow) * 50 : 0);
    return { ...m, all, byId: new Map(all.map(t => [t.id, t])), boxes, byKey: new Map(boxes.map(b => [b.cell.key, b])), rests, holds, width, top, pebbles, height };
  }, [doc.blocks, doc.groups, doc.links]);
  const chosen = picked ? model.byKey.get(picked) ?? null : null;
  useEffect(() => { if (picked && !model.byKey.has(picked)) setPicked(null); }, [model, picked]);
  const lit = useMemo(() => { const set = new Set<string>(); if (chosen) for (const id of (mode === 'above' ? model.above : model.below).get(chosen.cell.ids[0]) ?? []) { const key = model.boxes.find(b => b.cell.ids.includes(id))?.cell.key; if (key) set.add(key); } return set; }, [chosen, mode, model]);
  const name = (key: string) => model.byKey.get(key)?.cell.title ?? '';

  const draw = (ctx: Canvas2DContext, sight: Sight) => {
    const rows = model.layers.length; if (!rows) return; if (!born.current) born.current = sight.time; const still = reducedMotion.current, W = model.width;
    // Each layer settles from above, the deepest first: the ground is laid down in the order things depend on each other.
    const settle = (depth: number) => still ? 1 : easeOut((sight.time - born.current - depth * 80) / 520), focus = chosen?.cell.key ?? hover, near = new Set<string>(focus ? [...(model.rests.get(focus) ?? []), ...(model.holds.get(focus) ?? [])] : []);
    ctx.fillStyle = p.a(p.ink, .05); ctx.fillRect(-24, 4, W + 48, 44); ctx.save(); rounded(ctx, -24, 4, W + 48, 44, 0); ctx.clip(); ctx.strokeStyle = p.a(p.ink, .16); ctx.lineWidth = 1;
    ctx.beginPath(); for (let x = -80; x < W + 80; x += 14) { ctx.moveTo(x, 48); ctx.lineTo(x + 44, 4); } ctx.stroke(); ctx.restore();
    tag(ctx, p, 'Roca madre · lo de arriba descansa en lo de abajo', W / 2, 26, { size: 12, weight: 600, align: 'center' });
    for (const b of model.boxes) {
      const d = b.cell.depth, k = settle(d); if (k <= 0) continue; const dy = -(1 - k) * 150, key = b.cell.key, isChosen = chosen?.cell.key === key, isLit = lit.has(key), isNear = near.has(key), isHover = hover === key;
      const dim = chosen ? !isChosen && !isLit : !!hover && model.byKey.has(hover) && !isHover && !isNear, color = areaColor(p, b.cell.areaIndex), x0 = b.x + 1.5, x1 = b.x + b.w - 1.5, top = (x: number) => b.y + dy + WAVE(x, d) + 1.5, base = (x: number) => b.y + b.h + dy + WAVE(x, d - 1) - 1.5;
      ctx.save(); ctx.globalAlpha = k * (dim ? .26 : 1);
      ctx.beginPath(); for (let x = x0; ; x = Math.min(x1, x + 14)) { if (x === x0) ctx.moveTo(x, top(x)); else ctx.lineTo(x, top(x)); if (x >= x1) break; } for (let x = x1; ; x = Math.max(x0, x - 14)) { ctx.lineTo(x, base(x)); if (x <= x0) break; } ctx.closePath();
      if (isChosen || isHover) { ctx.shadowColor = p.a(isChosen ? p.accent : color, .7); ctx.shadowBlur = 20 * sight.scale; }
      ctx.fillStyle = p.surface; ctx.fill(); ctx.shadowBlur = 0; ctx.shadowColor = 'transparent';
      const rock = ctx.createLinearGradient(0, b.y + dy, 0, b.y + b.h + dy); rock.addColorStop(0, p.a(color, isLit || isChosen || isNear ? .62 : .44)); rock.addColorStop(1, p.a(color, isLit || isChosen || isNear ? .34 : .18)); ctx.fillStyle = rock; ctx.fill();
      if (sight.scale >= .4) { ctx.save(); ctx.clip(); ctx.fillStyle = p.a(p.ink, .12); const grains = Math.min(40, Math.floor(b.w * b.h / 1000));
        for (let i = 0; i < grains; i++) { const gx = b.x + seeded(key, i) * b.w, gy = b.y + dy + seeded(key, i + 97) * b.h; if (d % 2) ctx.fillRect(gx, gy, 7, 1.5); else ctx.fillRect(gx, gy, 2, 2); } ctx.restore(); }
      ctx.lineWidth = isChosen ? 3 : isHover || isNear ? 2 : 1; ctx.strokeStyle = isChosen ? p.accent : isHover || isNear ? p.ink : p.a(color, .7); ctx.stroke();
      if (sight.scale >= .3) {
        const cx = b.x + b.w / 2, cy = b.y + b.h / 2 + dy + (WAVE(cx, d) + WAVE(cx, d - 1)) / 2, room = b.w - 26, close = sight.scale >= 1.15, summary = close ? model.byId.get(b.cell.ids[0])?.summary ?? '' : '';
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.font = `700 14px ${FONT}`; const title = wrap(ctx, b.cell.title, room, 2); ctx.font = `400 11px ${FONT}`; const more = summary ? wrap(ctx, summary, room, 2) : [];
        let ty = cy - (title.length * 17 + 15 + more.length * 14) / 2 + 8.5; ctx.font = `700 14px ${FONT}`; ctx.fillStyle = p.ink; for (const line of title) { ctx.fillText(line, cx, ty); ty += 17; }
        ctx.font = `500 11px ${FONT}`; ctx.fillStyle = p.a(p.ink, .68); ctx.fillText((b.cell.load ? `sostiene ${b.cell.load}` : 'nada encima') + (b.cell.ids.length > 1 ? ` · ciclo de ${b.cell.ids.length}` : ''), cx, ty); ty += 15;
        ctx.font = `400 11px ${FONT}`; ctx.fillStyle = p.a(p.ink, .6); for (const line of more) { ctx.fillText(line, cx, ty); ty += 14; }
      }
      ctx.restore();
    }
    for (let d = 0; d < rows; d++) { const k = settle(d); if (k <= 0) continue; ctx.globalAlpha = k; tag(ctx, p, d === 0 ? 'Base' : d === rows - 1 ? 'Superficie' : `Capa ${d + 1}`, -20, -(d + .5) * H, { size: 12, weight: 600, align: 'right', color: d === 0 || d === rows - 1 ? p.ink : p.muted }); ctx.globalAlpha = 1; }
    if (rows > 1) { tag(ctx, p, '↑ depende de más', -20, model.top - 26, { align: 'right' }); tag(ctx, p, '↓ más básico', -20, 26, { align: 'right' }); }
    // What the block under the pointer touches: down to what it stands on, up to what stands on it.
    const from = focus ? model.byKey.get(focus) : undefined;
    if (from) for (const [set, down] of [[model.rests.get(from.cell.key), true], [model.holds.get(from.cell.key), false]] as const) for (const key of set ?? []) {
      const to = model.byKey.get(key); if (!to) continue; const a = { x: from.x + from.w / 2, y: down ? from.y + from.h - 16 : from.y + 16 }, b = { x: to.x + to.w / 2, y: down ? to.y + 18 : to.y + to.h - 18 }, color = down ? p.needs : p.flow, my = (a.y + b.y) / 2;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.bezierCurveTo(a.x, my, b.x, my, b.x, b.y); ctx.lineWidth = 2.5; ctx.strokeStyle = color; ctx.setLineDash(down ? [] : [7, 5]); ctx.stroke(); ctx.setLineDash([]); ctx.fillStyle = color;
      if (down) arrow(ctx, { x: b.x, y: my }, b, 10); else arrow(ctx, { x: a.x, y: my }, a, 10); ctx.beginPath(); ctx.arc(down ? a.x : b.x, down ? a.y : b.y, 3.5, 0, 6.2832); ctx.fill();
    }
    if (model.pebbles.length) {
      tag(ctx, p, 'Sueltas · no sostienen ni necesitan nada', 0, model.pebbles[model.pebbles.length - 1].y - 36, { size: 12, weight: 600, pad: false });
      for (const s of model.pebbles) { const on = hover === s.thing.id; ctx.globalAlpha = (chosen ? .3 : 1) * settle(rows); rounded(ctx, s.x - 76, s.y - 17, 152, 34, 17); ctx.fillStyle = p.a(areaColor(p, s.thing.areaIndex), on ? .4 : .18); ctx.fill(); ctx.lineWidth = on ? 2 : 1; ctx.strokeStyle = on ? p.ink : p.a(p.ink, .25); ctx.stroke();
        if (sight.scale >= .4) { ctx.font = `500 12px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = p.ink; ctx.fillText(wrap(ctx, s.thing.title, 130, 1)[0] ?? '', s.x, s.y + .5); } ctx.globalAlpha = 1; }
    }
  };
  const overlay = (ctx: Canvas2DContext, sight: Sight) => {
    if (!hover || !sight.pointer) return; const b = model.byKey.get(hover), loose = model.pebbles.find(s => s.thing.id === hover);
    if (loose) { tooltip(ctx, p, sight, sight.pointer, loose.thing.title, [loose.thing.summary, 'Suelta: ningún enlace de flujo o dependencia la une al resto.']); return; }
    if (!b || chosen?.cell.key === hover) return; const down = [...(model.rests.get(hover) ?? [])].map(name), up = [...(model.holds.get(hover) ?? [])].map(name), list = (items: string[]) => items.slice(0, 4).join(', ') + (items.length > 4 ? ` y ${items.length - 4} más` : '');
    tooltip(ctx, p, sight, sight.pointer, b.cell.title, [model.byId.get(b.cell.ids[0])?.summary ?? '', down.length ? `Descansa sobre: ${list(down)}` : 'No necesita nada: es base.', up.length ? `Sobre esto se apoya: ${list(up)}` : 'Nada se apoya en esto.', 'Presiona para ver todo lo que arrastra.']);
  };
  const hit = (x: number, y: number) => { for (const b of model.boxes) if (x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h) return b.cell.key; for (const s of model.pebbles) if (Math.abs(x - s.x) <= 76 && Math.abs(y - s.y) <= 17) return s.thing.id; return null; };
  const count = model.boxes.length + model.pebbles.length, names = [...lit].map(name);
  const summary = !count ? 'Todavía no hay nada en este lienzo.' : !model.boxes.length ? 'Nada depende de nada todavía: todo está suelto.' : `${model.layers.length} capas. En la base: ${model.layers[0].slice(0, 5).map(cell => cell.title).join(', ')}.${model.pebbles.length ? ` ${model.pebbles.length} sueltas.` : ''}`;
  return <Stage id="strata" title="Estratos" question="¿Qué sostiene a qué? Abajo está lo que no necesita nada; cada capa descansa sobre las de abajo." summary={summary} fitKey={`${model.boxes.length}:${model.pebbles.length}:${model.width}`}
    bounds={count ? { x: -150, y: model.top - (model.height - model.layers.length * H) - 50, width: model.width + 190, height: model.height + 110 } : { x: 0, y: 0, width: 0, height: 0 }}
    legend={[{ color: p.muted, shape: 'bar', text: 'Ancho = cuánto carga' }, { color: p.needs, shape: 'line', text: 'Descansa sobre' }, { color: p.flow, shape: 'line', text: 'Se apoya en esto' }, { color: p.accent, shape: 'ring', text: 'Muestra tomada' }]}
    draw={draw} overlay={overlay} hit={hit} onHover={setHover} onPress={id => setPicked(id && model.byKey.has(id) && id !== picked ? id : null)}
    side={chosen ? <><Txt kind="label" muted>Muestra</Txt><Txt kind="heading" numberOfLines={3}>{chosen.cell.title}</Txt>
      <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}><Button label="Lo que sostiene" small active={mode === 'above'} variant={mode === 'above' ? 'primary' : 'secondary'} onPress={() => setMode('above')} /><Button label="Sobre qué descansa" small active={mode === 'below'} variant={mode === 'below' ? 'primary' : 'secondary'} onPress={() => setMode('below')} /></View>
      <Txt kind="small" muted>{names.length ? (mode === 'above' ? `Si esto falta, se caen ${names.length}:` : `Para existir necesita ${names.length}:`) : mode === 'above' ? 'Nada se apoya en esto.' : 'No necesita nada: es base.'}</Txt>
      {!!names.length && <Txt kind="small" numberOfLines={7}>{names.slice(0, 10).join(' · ')}{names.length > 10 ? ` · y ${names.length - 10} más` : ''}</Txt>}
      <Button label="Ver en el lienzo" small icon="Frame" onPress={() => onOpen(chosen.cell.ids[0])} /><Button label="Soltar la muestra" small variant="ghost" onPress={() => setPicked(null)} /></> : undefined}>
    {!count && <View pointerEvents="none" style={{ position: 'absolute', inset: 0, alignItems: 'center', justifyContent: 'center' }}><Txt kind="small" muted>Todavía no hay nada en este lienzo.</Txt></View>}
  </Stage>;
}
