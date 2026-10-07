import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import type { Canvas2DContext, SurfaceFrame, SurfacePointer } from '../Surfaces';
import { reducedMotion } from '../motion';
import { Button, Txt, useUI } from '../ui';
import { clamp, easeOut, edges, fit, FONT, palette, seeded, things, type WorldProps } from './shared';
import { Stage, STAGE_INSET } from './Stage';
import { strataModel, type Cell } from './strata';

type Box = { cell: Cell; x: number; y: number; w: number; h: number; depth: number };
const SURFACE = 34, WAVE = (x: number, depth: number) => 4 * Math.sin(x * 0.012 + 6.283 * seeded('s' + depth)) + 2.5 * Math.sin(x * 0.031 + 6.283 * seeded('t' + depth));
/**
 * A cut through the ground. No cards, no left and right that mean anything: only what rests on what. Bedrock, at
 * the bottom, is what everything else needs; the surface is what nothing needs. A stratum is as thick as its
 * heaviest member's load, and each member is as wide as what it carries. Touch one for a core sample.
 */
export function StrataView({ controller: c, onOpen }: WorldProps) {
  const u = useUI(), p = palette(u), doc = c.view!.document;
  const model = useMemo(() => { const all = things(doc); return { all, ...strataModel(all, edges(doc, all)) }; }, [doc.blocks, doc.groups, doc.links]);
  const [hover, setHover] = useState<string | null>(null), [picked, setPicked] = useState<string | null>(null), [mode, setMode] = useState<'above' | 'below'>('above'), [moving, setMoving] = useState(false);
  const boxes = useRef<Box[]>([]), pebbles = useRef<{ id: string; x: number; y: number }[]>([]), down = useRef<{ x: number; y: number } | null>(null), dim = useRef({ from: 0, to: 0, start: 0 });
  const cells = useMemo(() => new Map(model.layers.flat().map(cell => [cell.key, cell])), [model]), chosen = picked ? cells.get(picked) ?? null : null;
  const lit = useMemo(() => chosen ? (mode === 'above' ? model.above : model.below).get(chosen.ids[0]) ?? new Set<string>() : new Set<string>(), [chosen, mode, model]);
  useEffect(() => { if (picked && !cells.has(picked)) setPicked(null); }, [cells, picked]);
  // The rest of the ground recedes when a sample is taken, and comes back when it is let go.
  useEffect(() => { dim.current = { from: dim.current.to, to: chosen ? 1 : 0, start: -1 }; if (!reducedMotion.current) setMoving(true); }, [!!chosen]);

  const draw = (ctx: Canvas2DContext, frame: SurfaceFrame) => {
    ctx.clearRect(0, 0, frame.width, frame.height); boxes.current = []; pebbles.current = [];
    const left = STAGE_INSET.left, right = frame.width - STAGE_INSET.right, top = STAGE_INSET.top + SURFACE, bottom = frame.height - STAGE_INSET.bottom, width = right - left, height = bottom - top, layers = model.layers;
    if (!layers.length || width < 80 || height < 80) return;
    if (dim.current.start < 0) dim.current.start = frame.time;
    const t = reducedMotion.current ? 1 : clamp((frame.time - dim.current.start) / 220, 0, 1), fade = dim.current.from + (dim.current.to - dim.current.from) * easeOut(t);
    if (t >= 1 && moving) setMoving(false);
    const weights = layers.map(layer => 1 + Math.log2(1 + Math.max(...layer.map(cell => cell.load)))), total = weights.reduce((a, b) => a + b, 0), deepest = layers.length - 1;
    // Bedrock (depth 0) is the bottom row; each row's top edge is a sediment line, not a ruled one.
    let y = bottom; const edgeOf = (depth: number, rowTop: number) => (x: number) => rowTop + (depth === deepest ? WAVE(x, depth) * 0.6 : WAVE(x, depth));
    const rows = layers.map((layer, depth) => { const h = height * weights[depth] / total, row = { layer, depth, top: y - h, bottom: y }; y -= h; return row; });
    const trace = (edge: (x: number) => number, x0: number, x1: number, first: boolean) => { for (let x = x0; ; x = Math.min(x1, x + 16)) { if (first && x === x0) ctx.moveTo(x, edge(x)); else ctx.lineTo(x, edge(x)); if (x >= x1) break; } };
    for (const row of rows) {
      const upper = edgeOf(row.depth, row.top), lower = row.depth === 0 ? () => row.bottom : edgeOf(row.depth - 1, row.bottom), sum = row.layer.reduce((a, cell) => a + 1 + cell.load, 0); let x = left;
      for (const cell of row.layer) {
        const w = width * (1 + cell.load) / sum, isPicked = chosen?.key === cell.key, isLit = !!chosen && cell.ids.some(id => lit.has(id)), tone = cell.areaIndex < 0 ? p.muted : p.areas[cell.areaIndex % p.areas.length];
        boxes.current.push({ cell, x, y: row.top, w, h: row.bottom - row.top, depth: row.depth });
        ctx.save(); ctx.globalAlpha = chosen && !isPicked && !isLit ? 1 - 0.65 * fade : 1;
        ctx.beginPath(); trace(upper, x, x + w, true); for (let bx = x + w; ; bx = Math.max(x, bx - 16)) { ctx.lineTo(bx, lower(bx)); if (bx <= x) break; } ctx.closePath();
        ctx.fillStyle = p.a(tone, Math.min(0.42, 0.14 + 0.05 * (deepest - row.depth))); ctx.fill();
        if (isPicked) { ctx.fillStyle = p.a(p.accent, 0.38); ctx.fill(); } else if (isLit) { ctx.fillStyle = p.a(p.accent, 0.22 * fade); ctx.fill(); }
        // Heavier strata read as rock: a sparse grain, fixed by the stratum's own name.
        if (cell.load >= 3) { ctx.save(); ctx.clip(); ctx.fillStyle = p.a(p.ink, 0.18); for (let i = 0, n = Math.min(60, Math.floor(w * (row.bottom - row.top) / 900)); i < n; i++) { ctx.beginPath(); ctx.arc(x + seeded(cell.key, i) * w, row.top + seeded(cell.key, i + 1000) * (row.bottom - row.top), 1, 0, 6.283); ctx.fill(); } ctx.restore(); }
        if (isPicked || isLit || hover === cell.key) { ctx.strokeStyle = isPicked || isLit ? p.accent : p.ink; ctx.lineWidth = isPicked || hover === cell.key ? 2 : 1.5; ctx.stroke(); }
        const rowHeight = row.bottom - row.top;
        if (w >= 72 && rowHeight >= 26) { ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = p.ink; ctx.font = `600 13px ${FONT}`; const showLoad = rowHeight >= 44 && cell.load > 0; ctx.fillText(fit(ctx, cell.title, w - 16), x + w / 2, row.top + rowHeight / 2 - (showLoad ? 8 : 0)); if (showLoad) { ctx.fillStyle = p.muted; ctx.font = `11px ${FONT}`; ctx.fillText(`sostiene ${cell.load}`, x + w / 2, row.top + rowHeight / 2 + 10); } }
        ctx.restore();
        if (x > left) { ctx.strokeStyle = p.border; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(x, upper(x)); ctx.lineTo(x, lower(x)); ctx.stroke(); }
        x += w;
      }
      ctx.strokeStyle = p.a(p.ink, row.depth === deepest ? 0.9 : 0.5); ctx.lineWidth = row.depth === deepest ? 1.5 : 1; ctx.beginPath(); trace(upper, left, right, true); ctx.stroke();
    }
    ctx.strokeStyle = p.a(p.ink, 0.5); ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(left, bottom); ctx.lineTo(right, bottom); ctx.stroke();
    // What rests on nothing and holds nothing lies loose on the surface.
    const surface = edgeOf(deepest, rows[deepest].top);
    model.loose.forEach((thing, i) => { const x = left + width * (i + 0.5) / model.loose.length, py = surface(x) - 7; pebbles.current.push({ id: thing.id, x, y: py });
      ctx.globalAlpha = chosen ? 1 - 0.65 * fade : 1; ctx.fillStyle = p.a(p.muted, 0.7); ctx.beginPath(); ctx.arc(x, py, 5, 0, 6.283); ctx.fill(); ctx.globalAlpha = 1;
      if (hover === thing.id) { ctx.fillStyle = p.ink; ctx.font = `500 12px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.fillText(fit(ctx, thing.title, 200), clamp(x, left + 100, right - 100), py - 9); } });
  };
  const at = (x: number, y: number) => pebbles.current.find(q => Math.hypot(q.x - x, q.y - y) <= 9)?.id ?? boxes.current.find(b => x >= b.x && x <= b.x + b.w && y >= b.y - 6 && y <= b.y + b.h)?.cell.key ?? null;
  const onPointer = (e: SurfacePointer) => {
    if (e.kind === 'move') { const next = at(e.x, e.y); if (next !== hover) setHover(next); }
    else if (e.kind === 'down') down.current = { x: e.x, y: e.y };
    else if (e.kind === 'up' && down.current && Math.hypot(e.x - down.current.x, e.y - down.current.y) <= 5) { const key = at(e.x, e.y), cell = key ? cells.get(key) : undefined; setPicked(cell ? cell.key : null); if (cell) void c.select([cell.ids[0]]); else if (key) void c.select([key]); }
    else if (e.kind === 'cancel') down.current = null;
  };
  const bedrock = (model.layers[0] ?? []).slice(0, 3).map(cell => cell.title).join(', ');
  const summary = model.layers.length ? `${model.layers.length} capas. En el fondo: ${bedrock}. ${model.loose.length} cosas sueltas en la superficie.` : 'Sin capas: este lienzo no tiene enlaces de dependencia ni de flujo.';
  const title = (id: string) => model.all.find(thing => thing.id === id)?.title ?? id;
  return <Stage id="strata" title="Estratos" question="¿Qué sostiene todo, y qué se cae si esto cambia? Toca una capa." summary={summary} animated={moving} draw={draw} onPointer={onPointer} cursor={hover ? 'pointer' : undefined}>
    {!model.layers.length && <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center', padding: 32 }}><Txt muted style={{ textAlign: 'center', maxWidth: 420 }}>Este lienzo no tiene enlaces de dependencia ni de flujo, así que no hay capas que mostrar.</Txt></View>}
    {!!chosen && <View style={{ position: 'absolute', right: STAGE_INSET.right, top: STAGE_INSET.top - 44, flexDirection: 'row', gap: 6 }}><Button small label="Lo que sostiene" active={mode === 'above'} onPress={() => setMode('above')} /><Button small label="Sobre qué descansa" active={mode === 'below'} onPress={() => setMode('below')} /></View>}
    {!!model.layers.length && <View pointerEvents="box-none" style={{ position: 'absolute', left: STAGE_INSET.left, bottom: 20, width: 300 }}>
      {chosen ? <View style={{ backgroundColor: u.c.surface1, borderWidth: 1, borderColor: u.c.border, borderRadius: 12, padding: 12, gap: 6 }}>
        <Txt kind="heading" numberOfLines={2}>{chosen.title}</Txt><Txt kind="small" muted>Sostiene {chosen.load} · descansa sobre {model.below.get(chosen.ids[0])?.size ?? 0}</Txt>
        {chosen.ids.length > 1 && <Txt kind="small" muted numberOfLines={3}>Se sostienen entre sí: {chosen.ids.map(title).join(', ')}</Txt>}
        <Button label="Ver en el lienzo" small icon="Frame" style={{ alignSelf: 'flex-start' }} onPress={() => onOpen(chosen.ids[0])} />
      </View> : <Txt kind="small" muted>Abajo, lo que sostiene a todo. Arriba, lo que nadie necesita.</Txt>}
    </View>}
  </Stage>;
}
