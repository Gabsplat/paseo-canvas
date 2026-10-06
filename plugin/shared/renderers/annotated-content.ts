import { z } from 'zod';
import type { RendererSpec } from './spec';

// Small authored budgets, including expected passage snapshots, remain well below 1 MiB.
export const ANNOTATED_LIMITS = { passages: 4, passageChars: 2000, totalChars: 8000, annotations: 12, layers: 4 } as const;
const reference = z.string().min(1).max(32).regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/)
  .refine(value => !['__proto__', 'constructor', 'prototype'].includes(value));
const revision = z.string().min(1).max(48);
const unit = z.number().finite().min(0).max(1);
const url = z.string().max(2048).refine(value => {
  try { const parsed = new URL(value); return /^https?:\/\//i.test(value) && !parsed.username && !parsed.password; } catch { return false; }
}, 'Hace falta un enlace http o https sin credenciales.');
const passageText = z.string().max(ANNOTATED_LIMITS.passageChars);
const owner = { baseKey: reference, baseRevision: revision, layerId: reference };
/** UTF-16 offsets, as used by JS slice, may not split a surrogate pair. */
export function validTextOffsets(text: string, start: number, end: number): boolean {
  const boundary = (at: number) => !(at > 0 && at < text.length && /[\uD800-\uDBFF]/.test(text[at - 1]) && /[\uDC00-\uDFFF]/.test(text[at]));
  return Number.isInteger(start) && Number.isInteger(end) && start >= 0 && start < end && end <= text.length && boundary(start) && boundary(end);
}
export const annotatedContentAnchorSchema = z.discriminatedUnion('kind', [
  z.object({ ...owner, kind: z.literal('image-point'), sourceUrl: url, x: unit, y: unit }).strict(),
  z.object({ ...owner, kind: z.literal('image-rect'), sourceUrl: url, x: unit, y: unit, width: unit, height: unit }).strict()
    .refine(a => a.width > 0 && a.height > 0 && a.x + a.width <= 1 && a.y + a.height <= 1, 'El rectángulo debe quedar dentro de la imagen.'),
  z.object({ ...owner, kind: z.literal('text-range'), passageId: reference, passageText,
    start: z.number().int().min(0).max(ANNOTATED_LIMITS.passageChars), end: z.number().int().min(1).max(ANNOTATED_LIMITS.passageChars),
  }).strict().refine(a => validTextOffsets(a.passageText, a.start, a.end), 'El rango debe pertenecer al texto esperado y conservar caracteres completos.'),
]);
export const annotatedContentDataSchema = z.object({
  question: z.string().min(1).max(600),
  base: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('image'), key: reference, revision, url, alt: z.string().min(1).max(400), aspectRatio: z.number().finite().min(.1).max(10) }).strict(),
    z.object({ kind: z.literal('text'), key: reference, revision,
      passages: z.array(z.object({ id: reference, text: passageText }).strict()).max(ANNOTATED_LIMITS.passages),
    }).strict().refine(b => new Set(b.passages.map(p => p.id)).size === b.passages.length && b.passages.reduce((sum, p) => sum + p.text.length, 0) <= ANNOTATED_LIMITS.totalChars,
      'Los pasajes deben tener claves únicas y respetar el límite de texto.'),
  ]),
  layers: z.array(z.object({ id: reference, name: z.string().min(1).max(60), visible: z.boolean() }).strict()).max(ANNOTATED_LIMITS.layers),
  annotations: z.array(z.object({ id: reference, title: z.string().min(1).max(100), text: z.string().min(1).max(600), anchor: annotatedContentAnchorSchema }).strict()).max(ANNOTATED_LIMITS.annotations),
}).strict().refine(d => new Set(d.layers.map(l => l.id)).size === d.layers.length && new Set(d.annotations.map(a => a.id)).size === d.annotations.length,
  'Las capas y anotaciones deben tener claves únicas.');
export type AnnotatedContentData = z.infer<typeof annotatedContentDataSchema>;
export type AnnotatedAnchor = z.infer<typeof annotatedContentAnchorSchema>;
export type AnnotatedAnnotation = AnnotatedContentData['annotations'][number];

/** Compare exact snapshots as well as revisions. Never relocate an obsolete range. */
export function resolveAnnotatedAnchor(data: AnnotatedContentData, anchor: AnnotatedAnchor): { resolved: boolean; message: string; excerpt?: string } {
  const missing = (reason: string) => ({ resolved: false, message: `Anotación no resuelta: ${reason}` });
  if (anchor.baseKey !== data.base.key) return missing('la referencia base cambió.');
  if (anchor.baseRevision !== data.base.revision) return missing('la revisión del contenido cambió.');
  if (!data.layers.some(layer => layer.id === anchor.layerId)) return missing('la capa ya no existe.');
  if (anchor.kind === 'text-range') {
    if (data.base.kind !== 'text') return missing('la base ya no es texto.');
    const passage = data.base.passages.find(p => p.id === anchor.passageId);
    if (!passage) return missing('el pasaje ya no existe.');
    if (passage.text !== anchor.passageText) return missing('el texto del pasaje cambió. Revisa el ancla antes de volver a usarla.');
    if (!validTextOffsets(passage.text, anchor.start, anchor.end)) return missing('el rango queda fuera del pasaje o corta un carácter.');
    return { resolved: true, message: '', excerpt: passage.text.slice(anchor.start, anchor.end) };
  }
  if (data.base.kind !== 'image') return missing('la base ya no es una imagen.');
  if (data.base.url !== anchor.sourceUrl) return missing('la imagen de referencia cambió.');
  return { resolved: true, message: '' };
}

// Fingerprint scopes learner state to an authored definition. Exact anchor validation above
// is authoritative; this bounded noncryptographic key is only for runtime recovery.
export function annotatedDefinitionKey(data: AnnotatedContentData): string {
  let hash = 2166136261;
  for (const char of JSON.stringify(data)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  return `ac1-${(hash >>> 0).toString(16)}`;
}
export type AnnotatedContentState = { definitionKey: string; selected: string | null; visibleLayers: string[]; visitedLayers: string[]; explored: string[] };
const runtimeSchema = z.object({ definitionKey: z.string().max(20), selected: reference.nullable(),
  visibleLayers: z.array(reference).max(4), visitedLayers: z.array(reference).max(4), explored: z.array(reference).max(12),
}).strict();
export function initialAnnotatedState(data: AnnotatedContentData): AnnotatedContentState {
  return { definitionKey: annotatedDefinitionKey(data), selected: null, visibleLayers: data.layers.filter(l => l.visible).map(l => l.id), visitedLayers: [], explored: [] };
}
export function readAnnotatedState(data: AnnotatedContentData, raw: unknown): AnnotatedContentState {
  const parsed = runtimeSchema.safeParse(raw), initial = initialAnnotatedState(data);
  if (!parsed.success || parsed.data.definitionKey !== initial.definitionKey) return initial;
  const state = parsed.data;
  const layers = new Set(data.layers.map(l => l.id));
  const annotations = new Set(data.annotations.filter(a => resolveAnnotatedAnchor(data, a.anchor).resolved).map(a => a.id));
  const clean = (values: string[], allowed: Set<string>) => [...new Set(values.filter(value => allowed.has(value)))];
  const visibleLayers = clean(state.visibleLayers, layers);
  const selected = data.annotations.find(a => a.id === state.selected && annotations.has(a.id) && visibleLayers.includes(a.anchor.layerId));
  return { definitionKey: initial.definitionKey, selected: selected?.id ?? null, visibleLayers, visitedLayers: clean(state.visitedLayers, layers), explored: clean(state.explored, annotations) };
}
export function annotatedExplorationPayload(state: AnnotatedContentState) {
  return { explored: [...state.explored], visibleLayers: [...state.visibleLayers], visitedLayers: [...state.visitedLayers], selected: state.selected };
}
export const annotatedContentSpec = {
  id: 'annotated-content', dataSchema: annotatedContentDataSchema, interactive: true,
  guidance: 'Define una pregunta, una base image/text con clave y revisión, hasta cuatro capas y doce anclas. Conserva sourceUrl o passageText esperado; las referencias obsoletas quedan no resueltas.',
  minSize: { width: 280, height: 220 }, defaultSize: { width: 480, height: 420 },
  blockType: { id: 'annotated-content', renderer: 'annotated-content', name: 'Contenido anotado', description: 'Imagen o texto con anotaciones numeradas y capas visibles.',
    properties: [{ key: 'question', label: 'Pregunta', kind: 'text', required: true }, { key: 'base', label: 'Contenido base', kind: 'json', required: true },
      { key: 'layers', label: 'Capas', kind: 'json', required: true }, { key: 'annotations', label: 'Anotaciones', kind: 'json', required: true }],
    defaults: { question: '¿Qué quieres observar en este contenido?', base: { kind: 'text', key: 'base', revision: '1', passages: [] }, layers: [], annotations: [] },
  },
} satisfies RendererSpec;
