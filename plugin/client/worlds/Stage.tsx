import React, { useState } from 'react';
import { View } from 'react-native';
import { CanvasSurface, type Canvas2DContext, type SurfaceFrame, type SurfacePointer } from '../Surfaces';
import { tokens } from '../tokens';
import { Txt, useUI } from '../ui';

/**
 * The frame every world is drawn in: the whole panel as one drawing surface, its name and the question it answers
 * in the corner, and room for a few native controls on top. The world supplies `draw` and reads the pointer.
 * `summary` is what a screen reader, or a device without a canvas, gets instead of the drawing.
 */
export function Stage({ id, title, question, summary, animated = false, draw, onPointer, children, cursor }: {
  id: string; title: string; question: string; summary: string; animated?: boolean;
  draw(ctx: Canvas2DContext, frame: SurfaceFrame): void; onPointer?(event: SurfacePointer): void; children?: React.ReactNode; cursor?: string;
}) {
  const u = useUI(), [box, setBox] = useState({ width: 0, height: 0 });
  return <View nativeID={`lienzo-world-${id}`} onLayout={e => setBox(e.nativeEvent.layout)} style={{ flex: 1, backgroundColor: u.c.surface0, overflow: 'hidden', ...(cursor ? { cursor } as object : null) }}>
    {box.height > 0 && <CanvasSurface id={`world-${id}`} label={`${title}. ${summary}`} summary={summary} height={box.height} animated={animated} draw={draw} onPointer={onPointer} />}
    <View pointerEvents="none" style={{ position: 'absolute', left: u.compact ? 16 : tokens.island.inset + 4, top: u.compact ? 12 : tokens.island.bannerTop, maxWidth: 420, gap: 2 }}>
      <Txt kind="heading">{title}</Txt><Txt kind="small" muted>{question}</Txt>
    </View>
    {children}
  </View>;
}
/** The safe area of a stage in CSS pixels: clear of the title island, the heading, the composer and the zoom control. */
export const STAGE_INSET = { top: 132, right: 32, bottom: 128, left: 32 } as const;
