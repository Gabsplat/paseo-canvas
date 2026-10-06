import { z } from 'zod';
import { sanitizeSvg, SVG_LIMITS } from './svg';
export { sanitizeSvg, SVG_LIMITS, type SanitizedSvg } from './svg';

export const WB_COLORS = ['tinta', 'gris', 'azul', 'turquesa', 'verde', 'naranja', 'rojo', 'violeta'] as const;
export const WB_SCALE = ['s', 'm', 'l', 'xl'] as const;
export const WB_SHAPES = ['rect', 'rounded', 'ellipse', 'diamond', 'triangle', 'hexagon', 'cylinder', 'line'] as const;
export const WB_RENDERERS = ['wb-text', 'wb-shape', 'wb-svg', 'wb-draw'] as const;
export const WB_LIMITS = { text: 4000, shapeText: 1000, caption: 200, strokes: 32, pointsPerStroke: 512, totalPoints: 4000, inputPointsPerStroke: 8192, extent: 4096, tolerance: .75, simplifyComparisons: 65536 } as const;
export type WbColor = typeof WB_COLORS[number];
export type WbScale = typeof WB_SCALE[number];
export type WbShape = typeof WB_SHAPES[number];
export type WbRenderer = typeof WB_RENDERERS[number];
const color = z.enum(WB_COLORS).default('tinta'), scale = z.enum(WB_SCALE).default('m');
const coordinate = z.number().finite().min(-100000).max(100000);
export const wbTextDataSchema = z.object({
  text: z.string().max(WB_LIMITS.text), color, scale,
  font: z.enum(['sans', 'serif', 'mono']).default('sans'), align: z.enum(['left', 'center', 'right']).default('left'),
  width: z.number().finite().min(24).max(4096).optional(),
}).strict();
export const wbShapeDataSchema = z.object({
  shape: z.enum(WB_SHAPES).default('rect'), color, fill: z.enum(['none', 'wash', 'solid']).default('none'),
  stroke: z.enum(['solid', 'dashed', 'dotted']).default('solid'), weight: scale, text: z.string().max(WB_LIMITS.shapeText).default(''),
  from: z.enum(['nw', 'ne', 'sw', 'se']).optional(), heads: z.enum(['none', 'end', 'start', 'both']).optional(),
}).strict().superRefine((data, context) => {
  if (data.shape !== 'line' && (data.from !== undefined || data.heads !== undefined)) context.addIssue({ code: 'custom', message: 'from y heads solo se permiten en líneas.' });
});
const viewBoxSchema = z.tuple([coordinate, coordinate, z.number().finite().positive().max(100000), z.number().finite().positive().max(100000)]);
export const wbSvgDataSchema = z.object({
  svg: z.string().min(1).max(SVG_LIMITS.bytes), viewBox: viewBoxSchema.optional(), color,
  caption: z.string().max(200).default(''), source: z.string().max(200).optional(), license: z.string().max(200).optional(),
}).strict().transform((data, context) => {
  try { return { ...data, ...sanitizeSvg(data.svg) }; }
  catch { context.addIssue({ code: 'custom', path: ['svg'], message: 'Este SVG contiene contenido no permitido, enlaces externos o geometría inválida y no se puede importar.' }); return z.NEVER; }
});
const extentSchema = z.object({ width: z.number().finite().min(1).max(4096), height: z.number().finite().min(1).max(4096) }).strict();
const pointsSchema = z.array(z.number().finite().min(0).max(4096)).min(4).max(WB_LIMITS.inputPointsPerStroke * 2).refine(points => points.length % 2 === 0, 'Los puntos deben ser pares x,y.');
export const wbDrawDataSchema = z.object({
  extent: extentSchema,
  strokes: z.array(z.object({ points: pointsSchema, color, weight: scale }).strict()).min(1).max(WB_LIMITS.strokes),
}).strict().superRefine((data, context) => {
  const total = data.strokes.reduce((sum, stroke) => sum + stroke.points.length / 2, 0);
  if (total > WB_LIMITS.inputPointsPerStroke) context.addIssue({ code: 'custom', path: ['strokes'], message: 'El dibujo supera el límite de puntos de entrada.' });
  data.strokes.forEach((stroke, index) => {
    if (stroke.points.some((v, i) => v > (i % 2 ? data.extent.height : data.extent.width))) context.addIssue({ code: 'custom', path: ['strokes', index, 'points'], message: 'Los puntos deben estar dentro de extent.' });
  });
}).transform((data, context) => {
  const strokes = data.strokes.map(stroke => ({ ...stroke, points: simplifyStroke(stroke.points, WB_LIMITS.tolerance) }));
  if (strokes.reduce((sum, stroke) => sum + stroke.points.length / 2, 0) > WB_LIMITS.totalPoints) {
    context.addIssue({ code: 'custom', path: ['strokes'], message: 'El dibujo simplificado supera 4000 puntos.' }); return z.NEVER;
  }
  return { ...data, extent: { width: Math.ceil(data.extent.width * 2) / 2, height: Math.ceil(data.extent.height * 2) / 2 }, strokes };
});
export type WbTextData = z.infer<typeof wbTextDataSchema>;
export type WbShapeData = z.infer<typeof wbShapeDataSchema>;
export type WbSvgData = z.infer<typeof wbSvgDataSchema>;
export type WbDrawData = z.infer<typeof wbDrawDataSchema>;
export type WbStroke = WbDrawData['strokes'][number];
export const isWhiteboardRenderer = (id?: string): id is WbRenderer => WB_RENDERERS.includes(id as WbRenderer);
export function whiteboardMinSize(typeId: string, data: Readonly<Record<string, unknown>> = {}): { width: number; height: number } {
  if (typeId === 'wb-text') return { width: 24, height: 8 };
  if (typeId === 'wb-draw' || typeId === 'wb-shape' && data.shape === 'line') return { width: 8, height: 8 };
  if (typeId === 'wb-shape' || typeId === 'wb-svg') return { width: 24, height: 24 };
  return { width: 160, height: 104 };
}

function uniform(points: readonly number[], limit: number): number[] {
  const count = points.length / 2;
  if (count <= limit) return [...points];
  const result: number[] = [];
  for (let i = 0; i < limit; i++) { const index = Math.round(i * (count - 1) / (limit - 1)); result.push(points[index * 2], points[index * 2 + 1]); }
  return result;
}
/** Iterative RDP, with an explicit comparison budget and uniform fallback. No recursive stack. */
export function simplifyStroke(points: readonly number[], tolerance = WB_LIMITS.tolerance): number[] {
  if (points.length < 4 || points.length % 2 || points.length > WB_LIMITS.inputPointsPerStroke * 2 || !points.every(v => Number.isFinite(v) && Math.abs(v) <= 100000) || !Number.isFinite(tolerance) || tolerance < 0 || tolerance > 100) throw new Error('Trazo o tolerancia fuera de los límites.');
  const rounded = points.map(v => Math.round(v * 2) / 2), count = rounded.length / 2;
  const keep = new Set([0, count - 1]), pending: [number, number][] = [[0, count - 1]];
  let comparisons = 0;
  while (pending.length) {
    const [start, end] = pending.pop()!, ax = rounded[start * 2], ay = rounded[start * 2 + 1], dx = rounded[end * 2] - ax, dy = rounded[end * 2 + 1] - ay;
    let furthest = -1, largest = tolerance * tolerance;
    for (let i = start + 1; i < end; i++) {
      if (++comparisons > WB_LIMITS.simplifyComparisons) {
        const sampled = uniform(rounded, WB_LIMITS.pointsPerStroke);
        return count > WB_LIMITS.pointsPerStroke ? simplifyStroke(sampled, tolerance) : sampled;
      }
      const px = rounded[i * 2] - ax, py = rounded[i * 2 + 1] - ay, length = dx * dx + dy * dy;
      const t = length ? Math.max(0, Math.min(1, (px * dx + py * dy) / length)) : 0;
      const distance = (px - t * dx) ** 2 + (py - t * dy) ** 2;
      if (distance > largest) { largest = distance; furthest = i; }
    }
    if (furthest >= 0) { keep.add(furthest); pending.push([start, furthest], [furthest, end]); }
  }
  const result = [...keep].sort((a, b) => a - b).flatMap(i => [rounded[i * 2], rounded[i * 2 + 1]]);
  return result.length / 2 > WB_LIMITS.pointsPerStroke ? simplifyStroke(uniform(result, WB_LIMITS.pointsPerStroke), tolerance) : result;
}
export type WbDrawing = { position: { x: number; y: number }; size: { width: number; height: number }; data: WbDrawData };
/** worldPoints are flat x,y pairs in the same coordinate space as position, including group-local space. */
export function appendStroke(drawing: WbDrawing, worldPoints: readonly number[], style: Pick<WbStroke, 'color' | 'weight'>): WbDrawing {
  const data = wbDrawDataSchema.parse(drawing.data), points = simplifyStroke(worldPoints);
  if (data.strokes.length >= WB_LIMITS.strokes) throw new Error('El dibujo ya contiene 32 trazos.');
  const { position, size } = drawing;
  if (![position.x, position.y, size.width, size.height].every(Number.isFinite) || size.width < 8 || size.height < 8 || size.width > 4096 || size.height > 4096) throw new Error('Caja de dibujo inválida.');
  const xs = points.filter((_, i) => i % 2 === 0), ys = points.filter((_, i) => i % 2 === 1);
  const x = Math.floor(Math.min(position.x, ...xs) * 2) / 2, y = Math.floor(Math.min(position.y, ...ys) * 2) / 2;
  const width = Math.ceil(Math.max(position.x + size.width, ...xs) * 2) / 2 - x, height = Math.ceil(Math.max(position.y + size.height, ...ys) * 2) / 2 - y;
  if (width > 4096 || height > 4096) throw new Error('El dibujo supera una caja de 4096 unidades.');
  const previous = data.strokes.map(stroke => ({ ...stroke, points: stroke.points.map((v, i) => i % 2 ? v * size.height / data.extent.height + position.y - y : v * size.width / data.extent.width + position.x - x) }));
  const next = wbDrawDataSchema.parse({ extent: { width, height }, strokes: [...previous, { ...style, points: points.map((v, i) => v - (i % 2 ? y : x)) }] });
  return { position: { x, y }, size: { width, height }, data: next };
}
