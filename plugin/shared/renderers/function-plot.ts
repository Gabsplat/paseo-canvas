import { z } from 'zod';
import { compileExpression, ExpressionParseError, type CompiledExpression } from '../expr';
import { variableNameSchema } from '../learning';
import type { RendererSpec } from './spec';

const boundedNumber = z.number().finite().min(-1e6).max(1e6);
const rangeSchema = z.tuple([boundedNumber, boundedNumber]).refine(([a, b]) => b - a >= 1e-6, 'Expected an increasing range of at least 0.000001.');
const expressionSchema = z.string().trim().min(1).max(512).refine(source => {
  try { compileExpression(source); return true; } catch { return false; }
}, 'Invalid declarative math expression.');
export const functionPlotDataSchema = z.object({
  question: z.string().trim().min(1).max(1000),
  expressions: z.array(z.object({ expression: expressionSchema, label: z.string().trim().min(1).max(80) }).strict()).min(1).max(4),
  xRange: rangeSchema, yRange: rangeSchema,
  samples: z.number().int().min(32).max(192).default(128),
  xUnit: z.string().max(24).optional(), yUnit: z.string().max(24).optional(),
  family: z.object({ parameter: variableNameSchema.refine(name => !['x', 'pi', 'e', 'tau'].includes(name)), min: boundedNumber, max: boundedNumber, count: z.number().int().min(2).max(4) }).strict().refine(f => f.max > f.min, 'Expected family min < max.').optional(),
  initialTrace: boundedNumber.optional(),
}).strict().superRefine((data, context) => {
  if (data.initialTrace !== undefined && (data.initialTrace < data.xRange[0] || data.initialTrace > data.xRange[1])) context.addIssue({ code: 'custom', path: ['initialTrace'], message: 'Initial trace must be inside xRange.' });
  if (data.expressions.length * (1 + (data.family?.count ?? 0)) > 8) context.addIssue({ code: 'custom', path: ['family'], message: 'At most eight total curves including active curves.' });
  if (data.family && !compilePlotExpressions(data).some(e => e.compiled?.identifiers.includes(data.family!.parameter))) context.addIssue({ code: 'custom', path: ['family', 'parameter'], message: 'Family parameter must occur in an expression.' });
});
export type FunctionPlotData = z.infer<typeof functionPlotDataSchema>;
export const functionPlotSpec = {
  id: 'function-plot', dataSchema: functionPlotDataSchema, interactive: true,
  minSize: { width: 280, height: 360 }, defaultSize: { width: 480, height: 430 },
  guidance: 'Set question, expressions [{expression,label}], finite xRange/yRange and optional units/initialTrace. Expressions use x and declared group/document variables. Optional family {parameter,min,max,count} uses a declared parameter. Samples 32–192, up to eight total curves. Scope controls live in a sibling controls block. Reset only clears local trace.',
  blockType: {
    id: 'function-plot', renderer: 'function-plot', name: 'Gráfica de funciones', description: 'Funciones de x con variables compartidas, familia opcional y traza.',
    properties: [
      { key: 'question', label: 'Pregunta guía', kind: 'text', required: true },
      { key: 'expressions', label: 'Expresiones y nombres', kind: 'json', required: true },
      { key: 'xRange', label: 'Rango de x', kind: 'json', required: true },
      { key: 'yRange', label: 'Rango de y', kind: 'json', required: true },
      { key: 'samples', label: 'Muestras por curva', kind: 'number', required: false },
      { key: 'xUnit', label: 'Unidad de x', kind: 'text', required: false },
      { key: 'yUnit', label: 'Unidad de y', kind: 'text', required: false },
      { key: 'family', label: 'Familia de curvas', kind: 'json', required: false },
      { key: 'initialTrace', label: 'Traza inicial', kind: 'number', required: false },
    ],
    defaults: { question: '¿Cómo cambia y cuando recorro x?', expressions: [{ expression: 'sin(x)', label: 'Seno' }], xRange: [-6.28, 6.28], yRange: [-1.5, 1.5], samples: 128 },
  },
} satisfies RendererSpec;

export type PlotExpression = { label: string; compiled?: CompiledExpression; error?: string };
export function compilePlotExpressions(data: Pick<FunctionPlotData, 'expressions'>): PlotExpression[] {
  return data.expressions.map(({ expression, label }) => {
    try { return { label, compiled: compileExpression(expression) }; }
    catch (error) { return { label, error: `No se pudo evaluar la expresión. Sintaxis inválida${error instanceof ExpressionParseError ? ` en la posición ${error.position + 1}` : ''}. Revisa los operadores, paréntesis y funciones.` }; }
  });
}
export function plotExpressionError(expression: PlotExpression, values: Readonly<Record<string, number>>): string | undefined {
  if (expression.error) return expression.error;
  const missing = expression.compiled?.identifiers.filter(name => name !== 'x' && (!Object.hasOwn(values, name) || !Number.isFinite(values[name]))) ?? [];
  return missing.length ? `No se pudo evaluar la expresión. Falta declarar la variable ${missing.join(', ')}.` : undefined;
}
export type PlotPoint = { x: number; y: number };
export type PlotCurve = { expressionIndex: number; label: string; active: boolean; parameterValue?: number; segments: PlotPoint[][]; error?: string; domainGap: boolean };
export function familyValues(family: NonNullable<FunctionPlotData['family']>): number[] {
  return Array.from({ length: family.count }, (_, i) => family.min + (family.max - family.min) * i / (family.count - 1));
}
/** Bounded midpoint checks are conservative, not a symbolic continuity proof. */
export function samplePlotCurve(expression: CompiledExpression, data: Pick<FunctionPlotData, 'samples' | 'xRange' | 'yRange'>, values: Readonly<Record<string, number>>): { segments: PlotPoint[][]; domainGap: boolean } {
  const segments: PlotPoint[][] = []; let current: PlotPoint[] = [], previous: PlotPoint | undefined, domainGap = false;
  const [xMin, xMax] = data.xRange, [yMin, yMax] = data.yRange;
  const count = Math.max(32, Math.min(192, data.samples));
  const evaluate = (x: number) => expression.evaluate({ ...values, x });
  const finish = () => { if (current.length) segments.push(current); current = []; };
  for (let i = 0; i < count; i++) {
    const x = xMin + (xMax - xMin) * i / (count - 1), y = evaluate(x);
    if (!Number.isFinite(y)) { domainGap = true; finish(); previous = undefined; continue; }
    const point = { x, y };
    if (previous) {
      const middle = evaluate((previous.x + x) / 2);
      // Break poles, steps and unresolved curvature rather than inventing a connecting line.
      // Normalize first: subtracting opposite finite values near 1e308 can overflow.
      const scale = Math.max(1, Math.abs(previous.y), Math.abs(y), Math.abs(middle));
      const a = previous.y / scale, b = y / scale, m = middle / scale;
      const broken = !Number.isFinite(middle) || Math.abs(m - (a + b) / 2) > Math.max((yMax - yMin) / scale * .02, Math.abs(b - a) * .25);
      if (broken) { domainGap = true; finish(); }
    }
    current.push(point); previous = point;
  }
  finish(); return { segments, domainGap };
}
export function buildPlotCurves(data: FunctionPlotData, expressions: PlotExpression[], values: Readonly<Record<string, number>>): PlotCurve[] {
  const result: PlotCurve[] = [];
  expressions.forEach((expression, expressionIndex) => {
    const error = plotExpressionError(expression, values);
    const add = (active: boolean, parameterValue?: number) => {
      const variables = parameterValue === undefined ? values : { ...values, [data.family!.parameter]: parameterValue };
      const sampled = error || !expression.compiled ? { segments: [], domainGap: false } : samplePlotCurve(expression.compiled, data, variables);
      result.push({ expressionIndex, label: expression.label, active, parameterValue, error, ...sampled });
    };
    if (data.family && Object.hasOwn(values, data.family.parameter)) for (const value of familyValues(data.family)) add(false, value);
    add(true);
  });
  return result;
}
export const plotNumber = (value: number) => Number.isFinite(value) ? String(Number(value.toPrecision(5))) : 'sin valor definido';
export type PlotReadout = { label: string; y: number | null; error?: string };
export function traceReadout(expressions: PlotExpression[], values: Readonly<Record<string, number>>, x: number): PlotReadout[] {
  return expressions.map(expression => {
    const error = plotExpressionError(expression, values), value = error ? NaN : expression.compiled?.evaluate({ ...values, x }) ?? NaN;
    return { label: expression.label, y: Number.isFinite(value) ? value : null, ...(error ? { error } : {}) };
  });
}
export function initialPlotTrace(data: FunctionPlotData): number { return data.initialTrace ?? Math.max(data.xRange[0], Math.min(data.xRange[1], 0)); }
export function clampPlotTrace(data: FunctionPlotData, x: number): number { return Number.isFinite(x) ? Math.max(data.xRange[0], Math.min(data.xRange[1], x)) : initialPlotTrace(data); }
export function plotTraceState(data: FunctionPlotData, state: Readonly<Record<string, unknown>>): { traceX: number; visited: [number, number] } {
  const traceX = clampPlotTrace(data, typeof state.traceX === 'number' ? state.traceX : initialPlotTrace(data));
  const raw = state.visited;
  const visited: [number, number] = Array.isArray(raw) && raw.length === 2 && raw.every(v => typeof v === 'number' && Number.isFinite(v)) && raw[0] <= raw[1] ? [clampPlotTrace(data, raw[0]), clampPlotTrace(data, raw[1])] : [traceX, traceX];
  return { traceX, visited: [Math.min(visited[0], traceX), Math.max(visited[1], traceX)] };
}
