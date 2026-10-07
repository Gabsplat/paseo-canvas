import React, { useCallback, useMemo, useState } from 'react';
import { View } from 'react-native';
import type { SurfaceFrame, SurfacePointer } from '../Surfaces';
import type { Canvas2DContext } from '../Surfaces';
import { STAGE_INSET, Stage } from './Stage';
import { Button, Txt, useUI } from '../ui';
import { tokens } from '../tokens';
import type { WorldProps } from './shared';
import { things, edges, placed, palette, fit, FONT, seeded, clamp, lerp } from './shared';
import {
  reliefField,
  contours,
  levelsOf,
  summits,
  fitSamples,
  type Sample
} from './relief';

const GRID_PADDING = 40;

export function ReliefView({ controller: c, onOpen }: WorldProps) {
  const u = useUI();
  const doc = c.view!.document;
  const catalog = c.catalog;
  const p = palette(u);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  // Extract things and their link counts
  const allThings = useMemo(() => things(doc), [doc.blocks, doc.groups]);
  const allEdges = useMemo(() => edges(doc, allThings), [doc.links, allThings]);

  // Compute weights: 1 + link count
  const weights = useMemo(() => {
    const w = new Map<string, number>();
    const linkCount = new Map<string, number>();
    for (const edge of allEdges) {
      linkCount.set(edge.from, (linkCount.get(edge.from) ?? 0) + 1);
      linkCount.set(edge.to, (linkCount.get(edge.to) ?? 0) + 1);
    }
    for (const thing of allThings) {
      w.set(thing.id, 1 + (linkCount.get(thing.id) ?? 0));
    }
    return w;
  }, [allThings, allEdges]);

  // Get placed positions for things
  const positions = useMemo(() => placed(doc, catalog), [doc, catalog]);

  // Samples: things that have positions
  const samples = useMemo(() => {
    const points = new Map<string, { x: number; y: number }>();
    for (const thing of allThings) {
      const pos = positions.get(thing.id);
      if (pos) {
        points.set(thing.id, { x: pos.x, y: pos.y });
      }
    }
    const inset = STAGE_INSET;
    const fitBox = {
      x: inset.left + GRID_PADDING,
      y: inset.top + GRID_PADDING,
      width: Math.max(1, size.width - inset.left - inset.right - GRID_PADDING * 2),
      height: Math.max(1, size.height - inset.top - inset.bottom - GRID_PADDING * 2)
    };
    return fitSamples(points, weights, fitBox);
  }, [allThings, positions, weights, size]);

  // Precompute grid, field, contours, and summits
  const computed = useMemo(() => {
    if (samples.length === 0) return null;

    const inset = STAGE_INSET;
    const safeWidth = Math.max(1, size.width - inset.left - inset.right - GRID_PADDING * 2);
    const safeHeight = Math.max(1, size.height - inset.top - inset.bottom - GRID_PADDING * 2);

    // Find smallest cell size that keeps cols × rows ≤ 18000
    let cell = 8;
    for (const c of [8, 10, 12, 14, 16, 20]) {
      const cols = Math.ceil(size.width / c) + 1;
      const rows = Math.ceil(size.height / c) + 1;
      if (cols * rows <= 18000) {
        cell = c;
        break;
      }
    }

    // The grid covers the whole stage, in the same coordinates as the samples, so the ground and the marks agree.
    const cols = Math.ceil(size.width / cell) + 1;
    const rows = Math.ceil(size.height / cell) + 1;
    const sigma = 0.075 * Math.min(safeWidth, safeHeight);

    const field = reliefField(samples, cols, rows, cell, sigma);
    const levels = levelsOf(field, 9);
    const topSummits = summits(samples, field, cols, rows, cell, 8);

    return {
      cell,
      cols,
      rows,
      field,
      levels,
      summits: topSummits,
      inset
    };
  }, [samples, size]);

  // Draw function
  const draw = useCallback(
    (ctx: Canvas2DContext, frame: SurfaceFrame) => {
      ctx.clearRect(0, 0, frame.width, frame.height);

      if (!computed || samples.length === 0) {
        ctx.fillStyle = p.paper;
        ctx.fillRect(0, 0, frame.width, frame.height);
        return;
      }

      const { cell, cols, rows, field, levels, summits: topSummits, inset } = computed;
      const offsetX = 0;
      const offsetY = 0;

      ctx.fillStyle = p.paper;
      ctx.fillRect(0, 0, frame.width, frame.height);

      // 1. Hypsometric tint: group cells by band
      ctx.save();
      for (let row = 0; row < rows - 1; row++) {
        let col = 0;
        while (col < cols - 1) {
          const c0 = field[row * cols + col];
          const c1 = field[row * cols + col + 1];
          const c2 = field[(row + 1) * cols + col + 1];
          const c3 = field[(row + 1) * cols + col];
          const avg = (c0 + c1 + c2 + c3) / 4;
          const band = levels.findIndex(l => l >= avg);
          const bandNum = band >= 0 ? band : levels.length;

          // Merge runs of equal band
          let endCol = col;
          while (
            endCol < cols - 1 &&
            (() => {
              const nc0 = field[row * cols + endCol + 1];
              const nc1 = field[row * cols + endCol + 2];
              const nc2 = field[(row + 1) * cols + endCol + 2];
              const nc3 = field[(row + 1) * cols + endCol + 1];
              const navg = (nc0 + nc1 + nc2 + nc3) / 4;
              const nband = levels.findIndex(l => l >= navg);
              return nband >= 0 ? nband === band : bandNum === levels.length;
            })()
          ) {
            endCol++;
          }

          if (bandNum > 0) {
            const alpha = clamp(0.035 * bandNum, 0, 1);
            ctx.fillStyle = p.a(p.accent, alpha);
            ctx.fillRect(
              offsetX + col * cell,
              offsetY + row * cell,
              (endCol - col + 1) * cell,
              cell
            );
          }

          col = endCol + 1;
        }
      }
      ctx.restore();

      // 2. Contour lines
      for (let levelIdx = 0; levelIdx < levels.length; levelIdx++) {
        const level = levels[levelIdx];
        const segs = contours(field, cols, rows, level);
        const isIndex = levelIdx % 3 === 2;
        const alpha = isIndex ? 0.6 : 0.34;
        const width = isIndex ? 1.25 : 0.75;

        ctx.strokeStyle = p.a(p.ink, alpha);
        ctx.lineWidth = width;

        for (let i = 0; i < segs.length; i += 4) {
          const x1 = offsetX + segs[i] * cell;
          const y1 = offsetY + segs[i + 1] * cell;
          const x2 = offsetX + segs[i + 2] * cell;
          const y2 = offsetY + segs[i + 3] * cell;

          ctx.beginPath();
          ctx.moveTo(x1, y1);
          ctx.lineTo(x2, y2);
          ctx.stroke();
        }
      }

      // 3. Rivers: flow and depends links
      for (const edge of allEdges) {
        const fromPos = samples.find(s => s.id === edge.from);
        const toPos = samples.find(s => s.id === edge.to);
        if (!fromPos || !toPos) continue;

        const x1 = fromPos.x;
        const y1 = fromPos.y;
        const x2 = toPos.x;
        const y2 = toPos.y;

        if (edge.kind === 'reference') continue;

        const isFlow = edge.kind === 'flow';
        const dx = x2 - x1;
        const dy = y2 - y1;
        const len = Math.sqrt(dx * dx + dy * dy);

        const seed = seeded(edge.id);
        const pushSide = (seed - 0.5) * 0.3 * len;
        const cpx = (x1 + x2) / 2 - (dy / len) * pushSide;
        const cpy = (y1 + y2) / 2 + (dx / len) * pushSide;

        ctx.strokeStyle = p.a(isFlow ? p.flow : p.needs, isFlow ? 0.7 : 0.5);
        ctx.lineWidth = isFlow ? 1.25 : 1;
        if (!isFlow) ctx.setLineDash([3, 4]);

        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.quadraticCurveTo(cpx, cpy, x2, y2);
        ctx.stroke();

        if (!isFlow) ctx.setLineDash([]);

        // Arrowhead for flow only
        if (isFlow) {
          const angle = Math.atan2(y2 - cpy, x2 - cpx);
          const size = 6;
          ctx.strokeStyle = p.a(p.flow, 0.7);
          ctx.lineWidth = 1.25;
          ctx.beginPath();
          ctx.moveTo(x2 - size * Math.cos(angle - Math.PI / 6), y2 - size * Math.sin(angle - Math.PI / 6));
          ctx.lineTo(x2, y2);
          ctx.lineTo(x2 - size * Math.cos(angle + Math.PI / 6), y2 - size * Math.sin(angle + Math.PI / 6));
          ctx.stroke();
        }
      }

      // 4. Survey marks (dots)
      for (const sample of samples) {
        const isSelected = c.selection.includes(sample.id);
        ctx.fillStyle = isSelected ? p.a(p.accent, 1) : p.a(p.ink, 1);
        ctx.beginPath();
        ctx.arc(sample.x, sample.y, isSelected ? 4 : 2.5, 0, Math.PI * 2);
        ctx.fill();

        if (isSelected) {
          ctx.strokeStyle = p.a(p.paper, 1);
          ctx.lineWidth = 2;
          ctx.beginPath();
          ctx.arc(sample.x, sample.y, 4, 0, Math.PI * 2);
          ctx.stroke();
        }
      }

      // 5. Area names (region labels)
      const areaGroups = new Map<string, Sample[]>();
      for (const sample of samples) {
        const thing = allThings.find(t => t.id === sample.id);
        if (thing && thing.area) {
          if (!areaGroups.has(thing.area)) areaGroups.set(thing.area, []);
          areaGroups.get(thing.area)!.push(sample);
        }
      }

      ctx.font = `600 11px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = p.a(p.muted, 0.75);

      for (const [areaName, areaSamples] of areaGroups) {
        if (areaSamples.length < 2) continue;

        const cx = areaSamples.reduce((sum, s) => sum + s.x, 0) / areaSamples.length;
        const cy = areaSamples.reduce((sum, s) => sum + s.y, 0) / areaSamples.length;

        const text = areaName.toUpperCase().split('').join(' ');
        const fitted = fit(ctx, text, 260);
        ctx.fillText(fitted, cx, cy);
      }

      // 6. Summits
      const drawnLabels: { x: number; y: number; w: number; h: number }[] = [];

      for (const summit of topSummits) {
        const dotX = summit.x;
        const dotY = summit.y;

        // Triangle
        const triBase = 9;
        const triHeight = 8;
        ctx.fillStyle = p.a(p.ink, 1);
        ctx.beginPath();
        ctx.moveTo(dotX, dotY - triHeight);
        ctx.lineTo(dotX - triBase / 2, dotY);
        ctx.lineTo(dotX + triBase / 2, dotY);
        ctx.closePath();
        ctx.fill();

        // Title and cota
        const title = allThings.find(t => t.id === summit.id)?.title || 'Sin título';
        ctx.font = `600 12px ${FONT}`;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'top';
        ctx.fillStyle = p.a(p.ink, 1);

        const titleFitted = fit(ctx, title, 180);
        const titleMetrics = ctx.measureText(titleFitted);
        const labelX = dotX + 8;
        const labelY = dotY - triHeight - 12;

        ctx.font = `10px ${FONT}`;
        const cotaText = `cota ${summit.weight - 1}`;
        const cotaMetrics = ctx.measureText(cotaText);
        const labelW = Math.max(titleMetrics.width, cotaMetrics.width);
        const labelH = 20;

        const overlap = drawnLabels.some(
          rect =>
            !(labelX + labelW < rect.x ||
              labelX > rect.x + rect.w ||
              labelY + labelH < rect.y ||
              labelY > rect.y + rect.h)
        );

        if (!overlap) {
          ctx.font = `600 12px ${FONT}`;
          ctx.fillStyle = p.a(p.ink, 1);
          ctx.textAlign = 'left';
          ctx.textBaseline = 'top';
          ctx.fillText(titleFitted, labelX, labelY);

          ctx.font = `10px ${FONT}`;
          ctx.fillStyle = p.a(p.muted, 1);
          ctx.fillText(cotaText, labelX, labelY + 14);

          drawnLabels.push({ x: labelX, y: labelY, w: labelW, h: labelH });
        }
      }

      // 7. Hover crosshair and label
      if (hoveredId) {
        const hoveredSample = samples.find(s => s.id === hoveredId);
        if (hoveredSample) {
          // Crosshair
          ctx.strokeStyle = p.a(p.ink, 0.18);
          ctx.lineWidth = 1;

          ctx.beginPath();
          ctx.moveTo(0, hoveredSample.y);
          ctx.lineTo(frame.width, hoveredSample.y);
          ctx.stroke();

          ctx.beginPath();
          ctx.moveTo(hoveredSample.x, 0);
          ctx.lineTo(hoveredSample.x, frame.height);
          ctx.stroke();

          // Ring
          ctx.strokeStyle = p.a(p.accent, 1);
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.arc(hoveredSample.x, hoveredSample.y, 7, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    },
    [computed, samples, allThings, allEdges, p, c.selection, hoveredId]
  );

  // Pointer handling
  const onPointer = useCallback(
    (event: SurfacePointer) => {
      if (event.kind === 'move') {
        const threshold = 18;
        let nearest: Sample | null = null;
        let minDist = threshold;

        for (const sample of samples) {
          const dx = sample.x - event.x;
          const dy = sample.y - event.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < minDist) {
            minDist = dist;
            nearest = sample;
          }
        }

        if (nearest?.id !== hoveredId) {
          setHoveredId(nearest?.id ?? null);
        }
      } else if (event.kind === 'down' || event.kind === 'up') {
        const threshold = 5;
        let nearest: Sample | null = null;
        let minDist = threshold;

        for (const sample of samples) {
          const dx = sample.x - event.x;
          const dy = sample.y - event.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < minDist) {
            minDist = dist;
            nearest = sample;
          }
        }

        if (event.kind === 'up' && nearest) {
          void c.select([nearest.id]);
        }
      }
    },
    [samples, hoveredId]
  );

  // Selected thing info
  const selectedThing =
    c.selection.length === 1
      ? allThings.find(t => t.id === c.selection[0])
      : null;

  const summitTitles = computed
    ?.summits.slice(0, 4)
    .map(s => allThings.find(t => t.id === s.id)?.title || 'Sin título')
    .join(', ');

  const summary =
    samples.length === 0
      ? 'Todavía no hay nada en este lienzo.'
      : summitTitles
        ? `Relieve de ${samples.length} cosas. Las cumbres: ${summitTitles}.`
        : `Relieve de ${samples.length} cosas, sin cumbres: nada está especialmente conectado.`;

  if (samples.length === 0) {
    return (
      <View style={{ flex: 1, backgroundColor: u.c.surface0 }}>
        <Stage
          id="relieve"
          title="Relieve"
          question="¿Dónde está el peso de este lienzo? Las cumbres son lo más conectado."
          summary={summary}
          draw={draw}
          onPointer={onPointer}
        >
          <View
            style={{
              position: 'absolute',
              bottom: tokens.island.inset,
              left: tokens.island.inset,
              justifyContent: 'center',
              alignItems: 'center',
              width: '100%'
            }}
          >
            <Txt kind="small" muted>
              Todavía no hay nada en este lienzo.
            </Txt>
          </View>
        </Stage>
      </View>
    );
  }

  return (
    <View
      style={{ flex: 1 }}
      onLayout={e => setSize(e.nativeEvent.layout)}
    >
      <Stage
        id="relieve"
        title="Relieve"
        question="¿Dónde está el peso de este lienzo? Las cumbres son lo más conectado."
        summary={summary}
        draw={draw}
        onPointer={onPointer}
      >
        {selectedThing && positions.get(selectedThing.id) && (
          <View
            style={{
              position: 'absolute',
              bottom: tokens.island.inset,
              left: tokens.island.inset,
              width: 280,
              backgroundColor: u.c.surface1,
              borderWidth: 1,
              borderColor: u.c.border,
              borderRadius: 12,
              padding: 12,
              gap: 6
            }}
          >
            <Txt kind="heading" numberOfLines={2}>
              {selectedThing.title}
            </Txt>
            {selectedThing.summary && (
              <Txt kind="small" muted numberOfLines={3}>
                {selectedThing.summary}
              </Txt>
            )}
            <Button
              label="Ver en el lienzo"
              small
              icon="Frame"
              onPress={() => onOpen(selectedThing.id)}
            />
          </View>
        )}
        {!selectedThing && (
          <View
            style={{
              position: 'absolute',
              bottom: tokens.island.inset,
              left: tokens.island.inset,
              width: 280,
              backgroundColor: u.c.surface1,
              borderWidth: 1,
              borderColor: u.c.border,
              borderRadius: 12,
              padding: 12
            }}
          >
            <Txt kind="small" muted>
              Curvas de nivel: cuanto más juntas y más altas, más enlaces se cruzan ahí. Las líneas con flecha son el flujo.
            </Txt>
          </View>
        )}
      </Stage>
    </View>
  );
}
