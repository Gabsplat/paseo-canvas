import { z } from 'zod';
import type { RendererSpec } from './spec';

const coordinate = z.number().finite().min(-10000).max(10000);
const size = z.number().finite().positive().max(10000);
const label = z.string().trim().min(1).max(120);
const id = z.string().regex(/^[a-zA-Z][a-zA-Z0-9_-]{0,47}$/).refine(value => !['constructor', 'prototype', '__proto__'].includes(value));
const role = z.enum(['ink', 'muted', 'accent']);
const points = z.array(z.tuple([coordinate, coordinate])).min(2).max(64);
const common = { id, label, stroke: role.default('ink'), lineWidth: z.number().finite().min(.25).max(12).default(2), dashed: z.boolean().default(false) };
export const stepFigureElementSchema = z.discriminatedUnion('kind', [
  z.object({ ...common, kind: z.literal('rect'), x: coordinate, y: coordinate, width: size, height: size, fill: role.optional() }).strict(),
  z.object({ ...common, kind: z.literal('circle'), x: coordinate, y: coordinate, radius: size, fill: role.optional() }).strict(),
  z.object({ ...common, kind: z.literal('line'), x: coordinate, y: coordinate, x2: coordinate, y2: coordinate }).strict(),
  z.object({ ...common, kind: z.literal('polyline'), points }).strict(),
  z.object({ ...common, kind: z.literal('polygon'), points: points.min(3), fill: role.optional() }).strict(),
  z.object({ ...common, kind: z.literal('text'), x: coordinate, y: coordinate, text: z.string().min(1).max(200), fontSize: z.number().finite().min(6).max(48).default(16) }).strict(),
]);
export type StepFigureElement = z.infer<typeof stepFigureElementSchema>;
const changesSchema = z.object({
  label: label.optional(), stroke: role.optional(), lineWidth: z.number().finite().min(.25).max(12).optional(), dashed: z.boolean().optional(),
  x: coordinate.optional(), y: coordinate.optional(), x2: coordinate.optional(), y2: coordinate.optional(),
  width: size.optional(), height: size.optional(), radius: size.optional(), fill: role.optional(), points: points.optional(),
  text: z.string().min(1).max(200).optional(), fontSize: z.number().finite().min(6).max(48).optional(),
}).strict().refine(value => Object.keys(value).length > 0, 'An update needs at least one allowed field.');
export const stepFigurePatchSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('add'), element: stepFigureElementSchema }).strict(),
  z.object({ op: z.literal('update'), id, changes: changesSchema }).strict(),
  z.object({ op: z.literal('remove'), id }).strict(),
]);
export type StepFigurePatch = z.infer<typeof stepFigurePatchSchema>;
const caption = z.string().trim().min(1).max(600);
const shape = z.object({
  question: z.string().trim().min(1).max(1000),
  viewBox: z.object({ width: size.min(1), height: size.min(1) }).strict(),
  initial: z.object({ caption, elements: z.array(stepFigureElementSchema).max(64) }).strict(),
  steps: z.array(z.object({ caption, change: z.string().trim().min(1).max(240), patches: z.array(stepFigurePatchSchema).min(1).max(64) }).strict()).min(1).max(48),
  playback: z.object({ intervalMs: z.number().int().min(500).max(10000).default(1500) }).strict().optional(),
}).strict();
export type StepFigureData = z.infer<typeof shape>;
const withinBudget = (elements: StepFigureElement[]) => elements.length <= 64 && elements.reduce((sum, e) => sum + ('points' in e ? e.points.length : 0), 0) <= 1024;

/** Atomic replay: no mutated inputs, no partial figure from a failing step. */
function applyStep(elements: StepFigureElement[], raw: unknown, used: Set<string>): { elements: StepFigureElement[]; used: Set<string> } | undefined {
  const parsed = z.array(stepFigurePatchSchema).min(1).max(64).safeParse(raw);
  if (!parsed.success) return;
  const next = new Map(elements.map(e => [e.id, e])), nextUsed = new Set(used);
  for (const patch of parsed.data) {
    if (patch.op === 'add') {
      if (nextUsed.has(patch.element.id)) return;
      next.set(patch.element.id, patch.element); nextUsed.add(patch.element.id);
    } else {
      const existing = next.get(patch.id); if (!existing) return;
      if (patch.op === 'remove') next.delete(patch.id);
      else {
        const updated = stepFigureElementSchema.safeParse({ ...existing, ...patch.changes });
        if (!updated.success) return;
        next.set(patch.id, updated.data);
      }
    }
    if (!withinBudget([...next.values()])) return;
  }
  return { elements: [...next.values()], used: nextUsed };
}
export type StepFigureSnapshot = { elements: StepFigureElement[]; step: number; validStep: number; caption: string; change: string; error?: string };
export function clampFigureStep(data: Pick<StepFigureData, 'steps'>, value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(data.steps.length, Math.round(value))) : 0;
}
export function resolveStepFigure(data: StepFigureData, requested: number): StepFigureSnapshot {
  const step = clampFigureStep(data, requested), parsed = z.array(stepFigureElementSchema).max(64).safeParse(data.initial.elements);
  let elements = parsed.success ? parsed.data : [], used = new Set(elements.map(e => e.id));
  const result: StepFigureSnapshot = { elements, step, validStep: 0, caption: data.initial.caption, change: '' };
  if (!parsed.success || used.size !== elements.length || !withinBudget(elements)) return { ...result, elements: [], error: 'La figura inicial no es válida. Revisa sus elementos.' };
  for (let i = 0; i < step; i++) {
    const current = data.steps[i], next = applyStep(elements, current.patches, used);
    if (!next) return { ...result, elements, caption: current.caption, change: '', error: `No se pudo aplicar el paso ${i + 2}. Se conserva la última figura válida, del paso ${i + 1}. Revisa los parches y sus referencias.` };
    elements = next.elements; used = next.used;
    result.elements = elements; result.validStep = i + 1; result.caption = current.caption; result.change = current.change;
  }
  return result;
}
export const stepFigureDataSchema = shape.superRefine((data, context) => {
  if (data.steps.reduce((sum, step) => sum + step.patches.length, 0) > 512) context.addIssue({ code: 'custom', path: ['steps'], message: 'At most 512 patches per sequence.' });
  const resolved = resolveStepFigure(data, data.steps.length);
  if (resolved.error) context.addIssue({ code: 'custom', path: resolved.error.startsWith('La figura inicial') ? ['initial'] : ['steps', resolved.validStep, 'patches'], message: resolved.error });
});
/** Include the old outline for removed elements and the new one for updates/additions. */
export function figureChanges(before: readonly StepFigureElement[], after: readonly StepFigureElement[]): { ids: string[]; outlines: StepFigureElement[]; description: string } {
  const old = new Map(before.map(e => [e.id, e])), next = new Map(after.map(e => [e.id, e]));
  const ids = [...new Set([...old.keys(), ...next.keys()])].filter(id => JSON.stringify(old.get(id)) !== JSON.stringify(next.get(id)));
  return { ids, outlines: ids.map(id => next.get(id) ?? old.get(id)!), description: ids.map(id => `${!old.has(id) ? 'Añadido' : !next.has(id) ? 'Retirado' : 'Cambiado'}: ${(next.get(id) ?? old.get(id))!.label}`).join('; ') };
}
export type StepFigureState = { step: number; visited: [number, number] };
export function stepFigureState(data: StepFigureData, raw: Readonly<Record<string, unknown>>): StepFigureState {
  const step = clampFigureStep(data, typeof raw.step === 'number' ? raw.step : 0), range = raw.visited;
  const visited: [number, number] = Array.isArray(range) && range.length === 2 && range.every(v => typeof v === 'number' && Number.isFinite(v)) && range[0] <= range[1] ? [clampFigureStep(data, range[0]), clampFigureStep(data, range[1])] : [step, step];
  return { step, visited: [Math.min(visited[0], step), Math.max(visited[1], step)] };
}

export const stepFigureSpec = {
  id: 'step-figure', dataSchema: stepFigureDataSchema, interactive: true,
  minSize: { width: 280, height: 360 }, defaultSize: { width: 480, height: 480 },
  guidance: 'Set question, fixed viewBox {width,height}, initial {caption,elements}, steps [{caption,change,patches}]. Elements have stable local id,label,kind (rect/circle/line/polyline/polygon/text) and bounded coordinates; stroke/fill roles ink/muted/accent. Patches are {op:add,element}, {op:update,id,changes} or {op:remove,id}; IDs and kind cannot change or be reused. Up to 64 elements, 48 patch steps, 64 points per element, 1024 active points, 512 total patches. Optional playback {intervalMs:500..10000}, manual by default. Runtime stores zero-based step and visited interval only.',
  blockType: {
    id: 'step-figure', renderer: 'step-figure', name: 'Figura por pasos', description: 'Una figura estable que cambia mediante pasos declarativos.',
    properties: [
      { key: 'question', label: 'Pregunta guía', kind: 'text', required: true },
      { key: 'viewBox', label: 'Coordenadas de la figura', kind: 'json', required: true },
      { key: 'initial', label: 'Figura inicial y descripción', kind: 'json', required: true },
      { key: 'steps', label: 'Pasos y parches', kind: 'json', required: true },
      { key: 'playback', label: 'Reproducción opcional', kind: 'json', required: false },
    ],
    defaults: {
      question: '¿Qué cambia en la figura al avanzar un paso?', viewBox: { width: 320, height: 200 },
      initial: { caption: 'Ejemplo: una recta permanece en su sitio.', elements: [{ id: 'base', label: 'Recta base', kind: 'line', x: 60, y: 150, x2: 260, y2: 150 }] },
      steps: [{ caption: 'Ejemplo: aparece un punto sobre la recta.', change: 'Se añade un punto. La recta conserva su posición.', patches: [{ op: 'add', element: { id: 'point', label: 'Punto', kind: 'circle', x: 160, y: 150, radius: 6, fill: 'accent', stroke: 'accent' } }] }],
    },
  },
} satisfies RendererSpec;
