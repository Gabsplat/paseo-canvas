import React, { useMemo, useState, useRef, useEffect } from 'react';
import { View, ScrollView, Pressable } from 'react-native';
import type { Canvas2DContext, SurfaceFrame } from '../Surfaces';
import { Stage, STAGE_INSET } from './Stage';
import {
  things, edges, placed, palette, kindColor, FONT, fit, seeded, clamp, lerp, easeOut,
  type WorldProps, type Edge as IEdge,
} from './shared';
import { betweenness, route, fitPoints } from './course';
import { Txt, Button, useUI } from '../ui';
import { reducedMotion } from '../motion';
import { newId } from '../logic';
import { withAlpha } from '../color';

type Thing = ReturnType<typeof things>[number];

export function CourseView({ controller: c, onOpen }: WorldProps) {
  const u = useUI();
  const doc = c.view!.document;
  const catalog = c.catalog;
  const [frameBox, setFrameBox] = useState<{ width: number; height: number }>({ width: 0, height: 0 });

  // Build model from document
  const model = useMemo(() => {
    const allThings = things(doc);
    const allEdges = edges(doc, allThings);
    const positions = placed(doc, catalog);
    const positioned = allThings.filter(t => positions.has(t.id));

    if (positioned.length === 0) {
      return { things: positioned, edges: allEdges, positions, betweenness: new Map() };
    }

    // Compute fitted positions using frame dimensions
    const computeFitted = (frameWidth: number, frameHeight: number) => {
      const insetBox = {
        x: STAGE_INSET.left,
        y: STAGE_INSET.top,
        width: Math.max(1, frameWidth - STAGE_INSET.left - STAGE_INSET.right - (frameWidth >= 900 ? 320 : 0)),
        height: Math.max(1, frameHeight - STAGE_INSET.top - STAGE_INSET.bottom),
      };

      return fitPoints(
        new Map(positioned.map(t => [t.id, positions.get(t.id)!])),
        insetBox
      );
    };

    const fitted = frameBox.width > 0 && frameBox.height > 0
      ? computeFitted(frameBox.width, frameBox.height)
      : new Map(positioned.map(t => [t.id, { x: 0, y: 0 }]));

    const bet = betweenness(
      positioned.map(t => t.id),
      allEdges
    );

    return {
      things: positioned,
      edges: allEdges,
      positions: fitted,
      betweenness: bet,
    };
  }, [doc.blocks, doc.groups, doc.links, catalog, frameBox]);

  // Selection state
  const [from, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState<string | null>(null);

  // Animation state
  const [routePath, setRoutePath] = useState<{ ids: string[]; via: IEdge[] } | null>(null);
  const [animationT, setAnimationT] = useState(0);
  const animationStart = useRef<number | null>(null);
  const isWithdrawing = useRef(true);

  // Compute route
  useEffect(() => {
    if (!from || !to || from === to) {
      setRoutePath(null);
      return;
    }

    const result = route(from, to, model.edges);
    setRoutePath(result);

    if (animationStart.current === null) {
      animationStart.current = Date.now();
      isWithdrawing.current = true;
    }
  }, [from, to, model.edges]);

  // Animation loop
  const animationRequest = useRef<number | null>(null);
  useEffect(() => {
    const animate = () => {
      if (animationStart.current === null) {
        setAnimationT(0);
        return;
      }

      const elapsed = Date.now() - animationStart.current;
      const duration = routePath ? (isWithdrawing.current ? 700 : 500) : 500;
      const t = Math.min(elapsed / duration, 1);

      if (isWithdrawing.current) {
        setAnimationT(easeOut(t));
      } else {
        setAnimationT(1 - easeOut(t));
      }

      if (t < 1) {
        animationRequest.current = requestAnimationFrame(animate);
      } else {
        if (!routePath && isWithdrawing.current) {
          setAnimationT(0);
          animationStart.current = null;
        }
      }
    };

    animationRequest.current = requestAnimationFrame(animate);
    return () => {
      if (animationRequest.current !== null) {
        cancelAnimationFrame(animationRequest.current);
      }
    };
  }, [routePath]);

  const handlePress = (thingId: string | null, x: number, y: number) => {
    if (thingId === null) {
      // Pressed empty space
      setFrom(null);
      setTo(null);
      animationStart.current = null;
      return;
    }

    if (!from) {
      setFrom(thingId);
    } else if (thingId !== from) {
      setTo(thingId);
    }
  };

  const draw = (ctx: Canvas2DContext, frame: SurfaceFrame) => {
    // Capture frame dimensions for layout computation
    if (frameBox.width !== frame.width || frameBox.height !== frame.height) {
      setFrameBox({ width: frame.width, height: frame.height });
    }

    ctx.clearRect(0, 0, frame.width, frame.height);

    const p = palette(u);
    const positions = model.positions;
    const bet = model.betweenness;

    // Determine which things/edges are on the route
    const routeIds = new Set(routePath?.ids ?? []);
    const routeEdges = new Set(routePath?.via.map(e => e.id) ?? []);

    // Compute degree
    const degree = new Map<string, number>();
    for (const thing of model.things) degree.set(thing.id, 0);
    for (const edge of model.edges) {
      if (positions.has(edge.from) && positions.has(edge.to)) {
        degree.set(edge.from, (degree.get(edge.from) ?? 0) + 1);
        degree.set(edge.to, (degree.get(edge.to) ?? 0) + 1);
      }
    }

    // Draw veins (links)
    for (const edge of model.edges) {
      const fromPos = positions.get(edge.from);
      const toPos = positions.get(edge.to);
      if (!fromPos || !toPos) continue;

      const isOnRoute = routeEdges.has(edge.id);
      const centrality = bet.get(edge.id) ?? 0;

      // Quadratic curve with perpendicular offset
      const dx = toPos.x - fromPos.x;
      const dy = toPos.y - fromPos.y;
      const len = Math.hypot(dx, dy);
      const perpX = -dy / len;
      const perpY = dx / len;
      const offset = (seeded(edge.id) - 0.5) * 0.24 * len;
      const cpX = (fromPos.x + toPos.x) / 2 + perpX * offset;
      const cpY = (fromPos.y + toPos.y) / 2 + perpY * offset;

      // Animation: withdraw non-route veins
      let width: number;
      let alpha: number;
      let color: string;

      if (isOnRoute) {
        width = lerp(1 + 5 * centrality, 5, animationT);
        alpha = lerp(0.32, 0.95, animationT);
        color = p.accent;
      } else {
        width = lerp(1 + 5 * centrality, 0.4, animationT);
        alpha = lerp(0.32, 0.05, animationT);
        color = p.ink;
      }

      ctx.strokeStyle = p.a(color, alpha);
      ctx.lineWidth = width;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(fromPos.x, fromPos.y);
      ctx.quadraticCurveTo(cpX, cpY, toPos.x, toPos.y);
      ctx.stroke();
    }

    // Draw particles (if not reduced motion and animated)
    if (!reducedMotion.current) {
      for (const edge of model.edges) {
        const fromPos = positions.get(edge.from);
        const toPos = positions.get(edge.to);
        if (!fromPos || !toPos) continue;

        const isOnRoute = routeEdges.has(edge.id);
        const centrality = bet.get(edge.id) ?? 0;
        const particleCount = 1 + Math.round(2 * centrality);

        const dx = toPos.x - fromPos.x;
        const dy = toPos.y - fromPos.y;
        const len = Math.hypot(dx, dy);
        const perpX = -dy / len;
        const perpY = dx / len;
        const offset = (seeded(edge.id) - 0.5) * 0.24 * len;
        const cpX = (fromPos.x + toPos.x) / 2 + perpX * offset;
        const cpY = (fromPos.y + toPos.y) / 2 + perpY * offset;

        const speed = 40; // CSS px per second
        const timeMs = frame.time % (len / speed * 1000);
        const progress = timeMs / (len / speed * 1000);

        for (let i = 0; i < particleCount; i++) {
          const phase = seeded(edge.id, 7) + i / particleCount;
          const phaseTime = (frame.time / 1000 + phase * len / speed) % (len / speed);
          const t = phaseTime / (len / speed);

          // Position on quadratic curve
          const u_val = t;
          const px = (1 - u_val) * (1 - u_val) * fromPos.x +
                     2 * (1 - u_val) * u_val * cpX +
                     u_val * u_val * toPos.x;
          const py = (1 - u_val) * (1 - u_val) * fromPos.y +
                     2 * (1 - u_val) * u_val * cpY +
                     u_val * u_val * toPos.y;

          let particleAlpha = 0.7;
          if (isOnRoute) {
            particleAlpha = lerp(0.7, 0.7, animationT);
          } else {
            particleAlpha = lerp(0.7, 0, animationT);
          }

          ctx.fillStyle = p.a(p.ink, particleAlpha);
          ctx.beginPath();
          ctx.arc(px, py, 1.6, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // Draw swellings (things)
    const topDegreeIds = new Set(
      model.things
        .sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0))
        .slice(0, 12)
        .map(t => t.id)
    );

    for (const thing of model.things) {
      const pos = positions.get(thing.id);
      if (!pos) continue;

      const deg = degree.get(thing.id) ?? 0;
      const radius = 4 + 2 * Math.sqrt(deg);
      const isOnRoute = routeIds.has(thing.id);

      let alpha = 0.85;
      if (!isOnRoute && routePath) {
        alpha = lerp(0.85, 0.14, animationT);
      }

      ctx.fillStyle = p.a(p.ink, alpha);
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, radius, 0, Math.PI * 2);
      ctx.fill();

      // Outline
      ctx.strokeStyle = p.paper;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Highlight for selection
      if (thing.id === from) {
        ctx.strokeStyle = p.ok;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, radius + 6, 0, Math.PI * 2);
        ctx.stroke();
      } else if (thing.id === to) {
        ctx.strokeStyle = p.accent;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(pos.x, pos.y, radius + 6, 0, Math.PI * 2);
        ctx.stroke();
      }

      // Draw title and number for route or high degree
      const showLabel = isOnRoute || topDegreeIds.has(thing.id) || thing.id === from || thing.id === to;
      if (showLabel) {
        ctx.font = `500 12px ${FONT}`;
        const fitted = fit(ctx, thing.title, 160);
        const titleX = pos.x > frame.width * 0.67 ? pos.x - radius - 12 : pos.x + radius + 12;
        const titleAlign = pos.x > frame.width * 0.67 ? 'right' : 'left';

        ctx.textAlign = titleAlign;
        ctx.textBaseline = 'middle';
        ctx.fillStyle = p.ink;
        ctx.fillText(fitted, titleX, pos.y);
      }

      // Draw number for on-route things
      if (isOnRoute && routePath) {
        const index = routePath.ids.indexOf(thing.id);
        if (index !== -1) {
          const numberRadius = 9;
          ctx.fillStyle = p.accent;
          ctx.beginPath();
          ctx.arc(pos.x, pos.y, numberRadius, 0, Math.PI * 2);
          ctx.fill();

          ctx.font = `600 11px ${FONT}`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = p.paper;
          ctx.fillText(String(index + 1), pos.x, pos.y);
        }
      }
    }
  };

  const handlePointer = (e: { kind: 'down' | 'move' | 'up' | 'cancel'; x: number; y: number }) => {
    if (e.kind === 'down') {
      // Find which thing was pressed
      // The nearest swelling within reach of a fingertip, not only its exact centre.
      let pressed: string | null = null;
      let best = 24;
      for (const thing of model.things) {
        const pos = model.positions.get(thing.id);
        if (!pos) continue;
        const dist = Math.hypot(e.x - pos.x, e.y - pos.y);
        if (dist <= best) {
          best = dist;
          pressed = thing.id;
        }
      }
      handlePress(pressed, e.x, e.y);
    }
  };

  // Summary
  let summary: string;
  if (routePath) {
    const fromThing = model.things.find(t => t.id === from);
    const toThing = model.things.find(t => t.id === to);
    if (fromThing && toThing) {
      const titles = routePath.ids.map(id => model.things.find(t => t.id === id)?.title || 'Sin título').join(' → ');
      summary = `Camino de ${fromThing.title} a ${toThing.title}: ${titles}.`;
    } else {
      summary = `${model.things.length} cosas unidas por ${model.edges.length} enlaces.`;
    }
  } else {
    summary = `${model.things.length} cosas unidas por ${model.edges.length} enlaces. Elige dos para ver el camino más corto entre ellas.`;
  }

  const emptyDraw = (ctx: Canvas2DContext, frame: SurfaceFrame) => {
    ctx.clearRect(0, 0, frame.width, frame.height);
  };

  // Empty states
  if (model.things.length === 0) {
    return (
      <Stage
        id="course"
        title="Cauce"
        question="¿Cuál es el camino más corto para explicar una cosa a partir de otra? Toca lo que ya conoces y luego lo que quieres entender."
        summary={summary}
        draw={emptyDraw}
      >
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <Txt kind="small" muted>Todavía no hay nada en este lienzo.</Txt>
        </View>
      </Stage>
    );
  }

  if (model.edges.length === 0) {
    return (
      <Stage
        id="course"
        title="Cauce"
        question="¿Cuál es el camino más corto para explicar una cosa a partir de otra? Toca lo que ya conoces y luego lo que quieres entender."
        summary={summary}
        draw={draw}
        onPointer={handlePointer}
      >
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <Txt kind="small" muted>Sin enlaces no hay cauce: este lienzo todavía no conecta nada.</Txt>
        </View>
      </Stage>
    );
  }

  return (
    <Stage
      id="course"
      title="Cauce"
      question="¿Cuál es el camino más corto para explicar una cosa a partir de otra? Toca lo que ya conoces y luego lo que quieres entender."
      summary={summary}
      animated={true}
      draw={draw}
      onPointer={handlePointer}
    >
      {/* Hint */}
      {!routePath && (
        <View
          style={{
            position: 'absolute',
            bottom: STAGE_INSET.bottom + 16,
            left: '50%',
            transform: [{ translateX: -150 }],
            width: 300,
            backgroundColor: u.c.surface1,
            borderWidth: 1,
            borderColor: u.c.border,
            borderRadius: 999,
            paddingVertical: 6,
            paddingHorizontal: 12,
          }}
        >
          <Txt kind="small" muted style={{ textAlign: 'center' }}>
            {!from ? 'Toca lo que ya conoces' : 'Ahora toca lo que quieres entender'}
          </Txt>
        </View>
      )}

      {/* Error message */}
      {routePath === null && from && to && (
        <View
          style={{
            position: 'absolute',
            bottom: STAGE_INSET.bottom + 16,
            left: '50%',
            transform: [{ translateX: -150 }],
            width: 300,
            backgroundColor: withAlpha(u.c.statusDanger, 0.1),
            borderWidth: 1,
            borderColor: u.c.statusDanger,
            borderRadius: 12,
            paddingVertical: 12,
            paddingHorizontal: 14,
          }}
        >
          <Txt kind="small" style={{ color: u.c.statusDanger }}>
            No hay camino entre estas dos cosas.
          </Txt>
        </View>
      )}

      {/* Side panel */}
      {routePath && (
        <View
          style={{
            position: 'absolute',
            right: STAGE_INSET.right,
            top: STAGE_INSET.top,
            width: 300,
            maxHeight: Math.max(200, frameBox.height - STAGE_INSET.top - STAGE_INSET.bottom),
            backgroundColor: u.c.surface1,
            borderWidth: 1,
            borderColor: u.c.border,
            borderRadius: 12,
            padding: 14,
            gap: 10,
          }}
        >
          <Txt kind="heading">El camino más corto</Txt>

          {(() => {
            const fromThing = model.things.find(t => t.id === from);
            const toThing = model.things.find(t => t.id === to);
            if (fromThing && toThing) {
              return (
                <Txt kind="small" muted>
                  {routePath.ids.length} pasos de «{fromThing.title}» a «{toThing.title}»
                </Txt>
              );
            }
            return null;
          })()}

          <ScrollView style={{ maxHeight: 200, marginVertical: 4 }}>
            {routePath.ids.map((id, i) => {
              const thing = model.things.find(t => t.id === id);
              const link = routePath.via[i];
              return (
                <View key={id} style={{ marginBottom: 12, gap: 4 }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                    <View
                      style={{
                        width: 20,
                        height: 20,
                        borderRadius: 10,
                        backgroundColor: u.c.accent,
                        justifyContent: 'center',
                        alignItems: 'center',
                      }}
                    >
                      <Txt kind="small" style={{ color: u.c.surface0, fontWeight: '600' }}>
                        {i + 1}
                      </Txt>
                    </View>
                    <Txt kind="small" style={{ flex: 1, fontWeight: '500' }} numberOfLines={2}>
                      {thing?.title || 'Sin título'}
                    </Txt>
                  </View>
                  {link?.label && (
                    <Txt kind="small" muted style={{ marginLeft: 28 }}>
                      {link.label}
                    </Txt>
                  )}
                </View>
              );
            })}
          </ScrollView>

          <SidePanelButtons
            c={c}
            from={from}
            to={to}
            routePath={routePath}
            things={model.things}
            onOpen={onOpen}
            onClear={() => {
              setFrom(null);
              setTo(null);
              setRoutePath(null);
              animationStart.current = null;
            }}
          />
        </View>
      )}
    </Stage>
  );
}

function SidePanelButtons({
  c,
  from,
  to,
  routePath,
  things,
  onOpen,
  onClear,
}: {
  c: any;
  from: string | null;
  to: string | null;
  routePath: { ids: string[]; via: IEdge[] } | null;
  things: Thing[];
  onOpen: (id: string) => void;
  onClear: () => void;
}) {
  const [sending, setSending] = useState(false);
  const [sendStatus, setSendStatus] = useState<'idle' | 'sending' | 'success' | 'failed'>('idle');
  const u = useUI();

  const handleSend = async () => {
    if (!from || !to || !routePath) return;

    setSending(true);
    setSendStatus('sending');

    try {
      const fromThing = things.find(t => t.id === from);
      const toThing = things.find(t => t.id === to);
      if (!fromThing || !toThing) {
        setSendStatus('failed');
        setSending(false);
        return;
      }

      const titles = routePath.ids.map(id => things.find(t => t.id === id)?.title || '').filter(Boolean);
      const result = await c.send(
        {
          kind: 'route.explain',
          label: `Explicar el camino de «${fromThing.title}» a «${toThing.title}»`,
          payload: { path: routePath.ids, titles },
          targetIds: routePath.ids.slice(0, 20),
          delivery: 'immediate',
        },
        newId('evt')
      );

      if (result && result.status !== 'failed') {
        setSendStatus('success');
      } else {
        setSendStatus('failed');
      }
    } catch {
      setSendStatus('failed');
    }

    setSending(false);
  };

  return (
    <View style={{ gap: 8 }}>
      <Button
        label="Pedir esta explicación"
        variant="primary"
        small
        icon="SendHorizontal"
        disabled={c.offline || sending}
        onPress={handleSend}
      />
      {sendStatus !== 'idle' && (
        <Txt kind="small" style={{ color: sendStatus === 'failed' ? u.c.statusDanger : u.c.accent }}>
          {sendStatus === 'sending'
            ? 'Enviando…'
            : sendStatus === 'success'
              ? 'Enviado al asistente.'
              : 'No se envió.'}
        </Txt>
      )}

      <Button label="Ver en el lienzo" small icon="Frame" onPress={() => onOpen(routePath!.ids[0])} />
      <Button label="Empezar de nuevo" small variant="ghost" onPress={onClear} />
    </View>
  );
}
