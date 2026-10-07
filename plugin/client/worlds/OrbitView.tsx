import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import {
  things, edges, palette, kindColor, FONT, fit, easeOut, lerp, clamp,
  type WorldProps, type Thing, type Edge,
} from './shared';
import { Stage, STAGE_INSET } from './Stage';
import { Button, Txt, useUI } from '../ui';
import { orbitModel, pickCentre, polar, type Body } from './orbit';
import { reducedMotion } from '../motion';
import type { Canvas2DContext, SurfaceFrame, SurfacePointer } from '../Surfaces';

export function OrbitView({ controller: c, onOpen }: WorldProps) {
  const u = useUI();
  const doc = c.view!.document;
  const all = things(doc);
  const links = edges(doc, all);
  const p = palette(u);

  // Empty document check
  if (all.length === 0) {
    return (
      <Stage
        id="orbit"
        title="Órbita"
        question="¿Qué tan cerca está todo de esto? Toca un cuerpo para ponerlo en el centro; arrastra para girar."
        summary="Todavía no hay nada en este lienzo."
        draw={(ctx, frame) => ctx.clearRect(0, 0, frame.width, frame.height)}
      >
        <View style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, justifyContent: 'center', alignItems: 'center' }}>
          <Txt kind="small" muted>Todavía no hay nada en este lienzo.</Txt>
        </View>
      </Stage>
    );
  }

  // Pick centre
  const centreId = pickCentre(all, links, c.selection);
  const centreThing = all.find(t => t.id === centreId);
  if (!centreId || !centreThing) {
    return (
      <Stage
        id="orbit"
        title="Órbita"
        question="¿Qué tan cerca está todo de esto?"
        summary="Todavía no hay nada en este lienzo."
        draw={(ctx, frame) => ctx.clearRect(0, 0, frame.width, frame.height)}
      >
        <View style={{ position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, justifyContent: 'center', alignItems: 'center' }}>
          <Txt kind="small" muted>Todavía no hay nada en este lienzo.</Txt>
        </View>
      </Stage>
    );
  }

  // Build model
  const model = useMemo(() => orbitModel(all, links, centreId), [all, links, centreId]);

  // Animation state
  const [hovered, setHovered] = useState<string | null>(null);
  const [rotating, setRotating] = useState(false);
  const [recentring, setRecentring] = useState(false);

  // Pointer tracking for dragging
  const pointerRef = useRef<{ x: number; y: number } | null>(null);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const rotationRef = useRef(0);
  const rotationVelRef = useRef(0);
  const frameRef = useRef<SurfaceFrame | null>(null);

  // Track previous body positions for re-centering animation
  const prevPositionsRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const animTimeRef = useRef(0);
  const rippleTimeRef = useRef(0);

  // Animation frame handler
  useEffect(() => {
    if (!rotating && !recentring && rotationVelRef.current === 0) return;

    let animId: number;
    const animate = () => {
      if (rotating || recentring) {
        const vel = rotationVelRef.current;
        if (Math.abs(vel) > 0.0005) {
          rotationVelRef.current = vel * 0.92;
          if (!recentring) {
            setRotating(true);
          }
        } else {
          rotationVelRef.current = 0;
          if (!recentring) {
            setRotating(false);
          }
        }
      }

      if (recentring) {
        animTimeRef.current += 16;
        if (animTimeRef.current > 520) {
          animTimeRef.current = 520;
          setRecentring(false);
        }
        rippleTimeRef.current += 16;
      }

      animId = requestAnimationFrame(animate);
    };

    animId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animId);
  }, [rotating, recentring]);

  // Geometry
  const draw = (ctx: Canvas2DContext, frame: SurfaceFrame) => {
    frameRef.current = frame;
    ctx.clearRect(0, 0, frame.width, frame.height);

    const cx = STAGE_INSET.left + (frame.width - STAGE_INSET.left - STAGE_INSET.right) / 2;
    const cy = STAGE_INSET.top + (frame.height - STAGE_INSET.top - STAGE_INSET.bottom) / 2;
    const safeWidth = frame.width - STAGE_INSET.left - STAGE_INSET.right;
    const safeHeight = frame.height - STAGE_INSET.top - STAGE_INSET.bottom;
    const R = Math.min(safeWidth, safeHeight) / 2;

    const ringRadii = [0, 0.3, 0.55, 0.76, 0.94].map(r => r * R);

    // Compute body screen positions
    const bodyPos = new Map<string, { x: number; y: number }>();
    for (const body of model.bodies) {
      const radius = ringRadii[body.ring];
      const pos = polar(cx, cy, radius, body.angle + rotationRef.current);
      bodyPos.set(body.id, pos);
    }

    // Handle re-centering animation
    if (recentring && animTimeRef.current > 0 && animTimeRef.current <= 520) {
      const t = easeOut(animTimeRef.current / 520);
      const animBodies = new Map<string, { x: number; y: number; start: { x: number; y: number } }>();
      for (const body of model.bodies) {
        const newPos = bodyPos.get(body.id)!;
        const oldPos = prevPositionsRef.current.get(body.id) ?? { x: cx, y: cy };
        animBodies.set(body.id, { x: lerp(oldPos.x, newPos.x, t), y: lerp(oldPos.y, newPos.y, t), start: oldPos });
      }

      // Draw animated bodies and ripple
      drawOrbits(ctx, ringRadii, cx, cy, p);
      drawTicks(ctx, cx, cy, R, model, p, FONT, frame);
      drawSpokes(ctx, cx, cy, model, animBodies, p);
      drawBodies(ctx, model, animBodies, p);
      drawLabels(ctx, model, animBodies, hovered, p, FONT, frame, all);

      // Ripple
      if (rippleTimeRef.current < 700) {
        const rt = rippleTimeRef.current / 700;
        const rippleRadius = lerp(ringRadii[0], R, rt);
        ctx.strokeStyle = p.a(p.accent, 0.5 * (1 - rt));
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(cx, cy, rippleRadius, 0, Math.PI * 2);
        ctx.stroke();
      }
    } else {
      // Normal draw
      drawOrbits(ctx, ringRadii, cx, cy, p);
      drawTicks(ctx, cx, cy, R, model, p, FONT, frame);
      drawSpokes(ctx, cx, cy, model, bodyPos, p);
      drawBodies(ctx, model, bodyPos, p);
      drawLabels(ctx, model, bodyPos, hovered, p, FONT, frame, all);
    }

    // Hover indicator
    if (hovered) {
      const hoveredBody = model.bodies.find(b => b.id === hovered);
      if (hoveredBody) {
        const pos = bodyPos.get(hovered)!;
        const radius = ringRadii[hoveredBody.ring];
        ctx.strokeStyle = p.accent;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, radius + 5, 0, Math.PI * 2);
        ctx.stroke();

        // Hover label
        const title = all.find(t => t.id === hovered)?.title ?? 'Sin título';
        const hopsCount = hoveredBody.ring === 4 ? 'sin camino' : `a ${hoveredBody.ring} enlace${hoveredBody.ring > 1 ? 's' : ''}`;
        ctx.fillStyle = p.ink;
        ctx.font = `500 13px ${FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        const fitted = fit(ctx, title, 180);
        ctx.fillText(fitted, pos.x, pos.y - radius - 14);

        ctx.font = `11px ${FONT}`;
        ctx.fillStyle = p.muted;
        ctx.textBaseline = 'top';
        ctx.fillText(hopsCount, pos.x, pos.y - radius - 8);
      }
    }
  };

  const onPointer = (e: SurfacePointer) => {
    if (!frameRef.current) return;

    if (e.kind === 'down') {
      pointerRef.current = { x: e.x, y: e.y };
      pointerStartRef.current = { x: e.x, y: e.y };
      if (!reducedMotion.current) {
        if (!recentring && Math.abs(rotationVelRef.current) > 0.001) {
          rotationVelRef.current = 0;
        }
      }
    } else if (e.kind === 'move' && pointerRef.current) {
      const oldAngle = Math.atan2(pointerRef.current.y - (STAGE_INSET.top + (frameRef.current.height - STAGE_INSET.top - STAGE_INSET.bottom) / 2), pointerRef.current.x - (STAGE_INSET.left + (frameRef.current.width - STAGE_INSET.left - STAGE_INSET.right) / 2));
      const newAngle = Math.atan2(e.y - (STAGE_INSET.top + (frameRef.current.height - STAGE_INSET.top - STAGE_INSET.bottom) / 2), e.x - (STAGE_INSET.left + (frameRef.current.width - STAGE_INSET.left - STAGE_INSET.right) / 2));
      const delta = newAngle - oldAngle;

      rotationRef.current += delta;
      if (!reducedMotion.current) {
        rotationVelRef.current = delta;
        setRotating(true);
      }
      pointerRef.current = { x: e.x, y: e.y };
    } else if (e.kind === 'up' || e.kind === 'cancel') {
      if (pointerStartRef.current) {
        const dx = e.x - pointerStartRef.current.x;
        const dy = e.y - pointerStartRef.current.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        // Tap: re-centre
        if (dist < 5) {
          const cx = STAGE_INSET.left + (frameRef.current.width - STAGE_INSET.left - STAGE_INSET.right) / 2;
          const cy = STAGE_INSET.top + (frameRef.current.height - STAGE_INSET.top - STAGE_INSET.bottom) / 2;
          const safeWidth = frameRef.current.width - STAGE_INSET.left - STAGE_INSET.right;
          const safeHeight = frameRef.current.height - STAGE_INSET.top - STAGE_INSET.bottom;
          const R = Math.min(safeWidth, safeHeight) / 2;
          const ringRadii = [0, 0.3, 0.55, 0.76, 0.94].map(r => r * R);

          for (const body of model.bodies) {
            if (body.id === centreId) continue;
            const radius = ringRadii[body.ring];
            const pos = polar(cx, cy, radius, body.angle + rotationRef.current);
            const bdx = e.x - pos.x;
            const bdy = e.y - pos.y;
            const bdist = Math.sqrt(bdx * bdx + bdy * bdy);
            if (bdist < 16) {
              // Save current positions
              prevPositionsRef.current.clear();
              for (const b of model.bodies) {
                const r = ringRadii[b.ring];
                const p = polar(cx, cy, r, b.angle + rotationRef.current);
                prevPositionsRef.current.set(b.id, p);
              }

              animTimeRef.current = 0;
              rippleTimeRef.current = 0;
              setRecentring(true);
              if (!reducedMotion.current) {
                rotationVelRef.current = 0;
              }
              void c.select([body.id]);
              return;
            }
          }
        }
      }

      if (e.kind === 'up') {
        pointerRef.current = null;
        pointerStartRef.current = null;
        if (!recentring && Math.abs(rotationVelRef.current) < 0.0005) {
          setRotating(false);
        }
      }
    }
  };

  const summary = `${centreThing.title} en el centro; ${model.counts[1]} cosa${model.counts[1] !== 1 ? 's' : ''} a un enlace, ${model.counts[2]} a dos, ${model.counts[3]} más lejos y ${model.counts[4]} sin camino.`;

  return (
    <Stage
      id="orbit"
      title="Órbita"
      question="¿Qué tan cerca está todo de esto? Toca un cuerpo para ponerlo en el centro; arrastra para girar."
      summary={summary}
      animated={rotating || recentring}
      draw={draw}
      onPointer={onPointer}
      cursor={rotating ? 'grab' : 'default'}
    >
      <View style={{ position: 'absolute', left: STAGE_INSET.left, bottom: STAGE_INSET.bottom, width: 280, backgroundColor: u.c.surface1, borderWidth: 1, borderColor: u.c.border, borderRadius: 12, padding: 12, gap: 6 }}>
        <Txt kind="heading" numberOfLines={2}>{centreThing.title}</Txt>
        {!!centreThing.summary && <Txt kind="small" muted numberOfLines={3}>{centreThing.summary}</Txt>}
        <Txt kind="small">{model.counts[1]} a un enlace · {model.counts[2]} a dos · {model.counts[3]} más lejos · {model.counts[4]} sin camino</Txt>
        <Button label="Ver en el lienzo" small icon="Frame" onPress={() => onOpen(centreId)} />
      </View>
    </Stage>
  );
}

// Drawing helpers
function drawOrbits(ctx: Canvas2DContext, radii: number[], cx: number, cy: number, p: ReturnType<typeof palette>) {
  for (let i = 1; i < radii.length; i++) {
    ctx.strokeStyle = i === radii.length - 1 ? p.border : p.border;
    ctx.lineWidth = 1;
    if (i === radii.length - 1) {
      ctx.setLineDash([2, 5]);
    }
    ctx.beginPath();
    ctx.arc(cx, cy, radii[i], 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
  }
}

function drawTicks(ctx: Canvas2DContext, cx: number, cy: number, R: number, model: ReturnType<typeof orbitModel>, p: ReturnType<typeof palette>, font: string, frame: SurfaceFrame) {
  const radius = model.bodies.length > 0 ? Math.max(...model.bodies.filter(b => b.ring === 4).map(b => Math.abs(b.angle))) === 0 && model.counts[4] === 0 ? R * 0.94 : R * 0.96 : R * 0.94;

  for (const sector of model.sectors) {
    const midAngle = (sector.a0 + sector.a1) / 2;
    const tick = polar(cx, cy, radius, midAngle);
    const outer = polar(cx, cy, radius + 8, midAngle);

    ctx.strokeStyle = p.border;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(tick.x, tick.y);
    ctx.lineTo(outer.x, outer.y);
    ctx.stroke();

    // Area name
    ctx.fillStyle = p.muted;
    ctx.font = `600 11px ${font}`;
    ctx.textBaseline = 'middle';
    const cosAngle = Math.cos(midAngle);
    ctx.textAlign = cosAngle > 0 ? 'left' : 'right';
    const textX = outer.x + (cosAngle > 0 ? 6 : -6);
    const fitted = fit(ctx, sector.area, 100);
    ctx.fillText(fitted, textX, outer.y);
  }
}

function drawSpokes(ctx: Canvas2DContext, cx: number, cy: number, model: ReturnType<typeof orbitModel>, bodyPos: Map<string, { x: number; y: number }>, p: ReturnType<typeof palette>) {
  for (const body of model.bodies) {
    if (body.ring !== 1) continue;
    const pos = bodyPos.get(body.id);
    if (!pos || !body.via) continue;

    const color = kindColor(p, body.via.kind);
    ctx.strokeStyle = p.a(color, 0.6);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();

    // Arrowhead
    if (body.out) {
      drawArrowhead(ctx, cx, cy, pos.x, pos.y, p.a(color, 0.6), 6);
    } else {
      drawArrowhead(ctx, pos.x, pos.y, cx, cy, p.a(color, 0.6), 6);
    }
  }
}

function drawArrowhead(ctx: Canvas2DContext, fromX: number, fromY: number, toX: number, toY: number, color: string, size: number) {
  const angle = Math.atan2(toY - fromY, toX - fromX);
  const a1 = angle + (Math.PI * 5) / 6;
  const a2 = angle - (Math.PI * 5) / 6;

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(toX, toY);
  ctx.lineTo(toX + size * Math.cos(a1), toY + size * Math.sin(a1));
  ctx.lineTo(toX + size * Math.cos(a2), toY + size * Math.sin(a2));
  ctx.closePath();
  ctx.fill();
}

function drawBodies(ctx: Canvas2DContext, model: ReturnType<typeof orbitModel>, bodyPos: Map<string, { x: number; y: number }>, p: ReturnType<typeof palette>) {
  for (const body of model.bodies) {
    const pos = bodyPos.get(body.id);
    if (!pos) continue;

    let color = p.ink;
    let radius = 0;

    if (body.ring === 0) {
      // Centre: accent with paper ring
      ctx.fillStyle = p.accent;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, 26, 0, Math.PI * 2);
      ctx.fill();

      ctx.strokeStyle = p.paper;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, 22, 0, Math.PI * 2);
      ctx.stroke();
    } else if (body.ring === 1) {
      // Ring 1: kindColor
      color = body.via ? kindColor(p, body.via.kind) : p.ink;
      radius = 9;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
      ctx.fill();
    } else if (body.ring === 2) {
      // Ring 2: ink at alpha 0.75
      ctx.fillStyle = p.a(p.ink, 0.75);
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, 6, 0, Math.PI * 2);
      ctx.fill();
    } else if (body.ring === 3) {
      // Ring 3: muted
      ctx.fillStyle = p.muted;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, 4, 0, Math.PI * 2);
      ctx.fill();
    } else if (body.ring === 4) {
      // Ring 4: muted at alpha 0.5
      ctx.fillStyle = p.a(p.muted, 0.5);
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, 3, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawLabels(ctx: Canvas2DContext, model: ReturnType<typeof orbitModel>, bodyPos: Map<string, { x: number; y: number }>, hovered: string | null, p: ReturnType<typeof palette>, font: string, frame: SurfaceFrame, allThings: readonly Thing[]) {
  const thingMap = new Map(allThings.map(t => [t.id, t]));

  // Ring 1 labels (always)
  for (const body of model.bodies) {
    if (body.ring !== 1) continue;
    const pos = bodyPos.get(body.id);
    if (!pos) continue;

    ctx.fillStyle = p.ink;
    ctx.font = `500 13px ${font}`;
    ctx.textBaseline = 'middle';
    const cosAngle = Math.cos(body.angle);
    ctx.textAlign = cosAngle > 0 ? 'left' : 'right';
    const offset = 14;
    const textX = pos.x + Math.cos(body.angle) * offset;
    const textY = pos.y + Math.sin(body.angle) * offset;

    const thing = thingMap.get(body.id);
    const title = thing?.title ?? 'Sin título';
    const fitted = fit(ctx, title, 180);
    ctx.fillText(fitted, textX, textY);
  }

  // Ring 2 labels (only if 24 or fewer)
  const ring2Count = model.bodies.filter(b => b.ring === 2).length;
  if (ring2Count <= 24) {
    for (const body of model.bodies) {
      if (body.ring !== 2) continue;
      const pos = bodyPos.get(body.id);
      if (!pos) continue;

      ctx.fillStyle = p.muted;
      ctx.font = `12px ${font}`;
      ctx.textBaseline = 'middle';
      const cosAngle = Math.cos(body.angle);
      ctx.textAlign = cosAngle > 0 ? 'left' : 'right';
      const offset = 8;
      const textX = pos.x + Math.cos(body.angle) * offset;
      const textY = pos.y + Math.sin(body.angle) * offset;

      const thing = thingMap.get(body.id);
      const title = thing?.title ?? 'Sin título';
      const fitted = fit(ctx, title, 100);
      ctx.fillText(fitted, textX, textY);
    }
  }
}
