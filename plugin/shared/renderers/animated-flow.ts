import { z } from 'zod';
import type { CanvasBlock } from '../model';
import type { RendererSpec } from './spec';

// Local ID schema avoids a model -> registry -> renderer -> model value cycle.
const reference = z.string().min(1).max(100).regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]*$/).refine(id => !['__proto__', 'constructor', 'prototype'].includes(id));
const milliseconds = z.number().finite().min(0).max(600_000);
const eventSchema = z.object({
  t: milliseconds, from: reference, to: reference, linkId: reference.optional(),
  payload: z.union([z.number().finite().min(-1e6).max(1e6), z.string().max(160)]),
  kind: z.enum(['message', 'signal', 'value']),
}).strict();
export const animatedFlowDataSchema = z.object({
  question: z.string().trim().min(1).max(1000),
  events: z.array(eventSchema).max(64),
  duration: milliseconds.refine(n => n >= 1),
  travelMs: z.number().finite().min(1).max(10_000).default(1000),
  links: z.preprocess((raw, ctx) => {
    // Zod records can discard __proto__ before key validation. Reject original keys.
    if (raw && typeof raw === 'object') for (const key of Object.keys(raw)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) ctx.addIssue({ code: 'custom', message: 'Reserved reference key.' });
    }
    return raw;
  }, z.record(reference, z.object({ sign: z.union([z.literal(1), z.literal(-1)]), delay: milliseconds }).strict()).default({})),
  propagation: z.object({ maxEvents: z.number().int().min(1).max(256), horizon: milliseconds }).strict().optional(),
}).strict().superRefine((data, ctx) => {
  if (Object.keys(data.links).length > 128) ctx.addIssue({ code: 'custom', path: ['links'], message: 'At most 128 causal links.' });
  if (data.events.some(e => e.t > data.duration)) ctx.addIssue({ code: 'custom', path: ['events'], message: 'Events must start within duration.' });
  if (data.propagation && (data.propagation.horizon > data.duration || data.propagation.maxEvents < data.events.length)) ctx.addIssue({ code: 'custom', path: ['propagation'], message: 'Horizon must fit duration and maxEvents must cover authored events.' });
  const signatures = data.events.map(e => JSON.stringify(e));
  if (new Set(signatures).size !== signatures.length) ctx.addIssue({ code: 'custom', path: ['events'], message: 'Duplicate authored events.' });
});
export type AnimatedFlowData = z.infer<typeof animatedFlowDataSchema>;
export type AnimatedFlowEvent = AnimatedFlowData['events'][number];
export type AnimatedFlowDocument = {
  readonly blocks: readonly { readonly id: string; readonly title: string }[];
  readonly groups: readonly { readonly id: string; readonly title: string }[];
  readonly links: readonly { readonly id: string; readonly from: string; readonly to: string }[];
};
export type FlowRuntime = { playhead: number; playing: boolean; anchorMs: number; visited: [number, number] };
export type MotionToken = { linkId: string; progress: number; kind: AnimatedFlowEvent['kind']; label: string; sign?: 1 | -1; delay?: number };
export const MISSING_FLOW_ROUTE = 'La ruta ya no existe en este lienzo';

/** Only declared IDs are remapped. Payloads and external references stay intact. */
export function remapAnimatedFlowReferences(data: CanvasBlock['data'], ids: ReadonlyMap<string, string>): CanvasBlock['data'] {
  const parsed = animatedFlowDataSchema.safeParse(data);
  if (!parsed.success) return data;
  const flow = parsed.data, remap = (id: string) => ids.get(id) ?? id;
  return { ...flow, events: flow.events.map(e => ({ ...e, from: remap(e.from), to: remap(e.to), ...(e.linkId ? { linkId: remap(e.linkId) } : {}) })),
    links: Object.fromEntries(Object.entries(flow.links).map(([id, metadata]) => [remap(id), { ...metadata }])) };
}
export const animatedFlowSpec = {
  id: 'animated-flow', dataSchema: animatedFlowDataSchema, interactive: true,
  minSize: { width: 280, height: 320 }, defaultSize: { width: 440, height: 430 },
  remapReferences: remapAnimatedFlowReferences,
  guidance: 'Set question, duration/travelMs in milliseconds, events [{t,from,to,payload,kind,linkId?}] over existing directed document blocks/groups and links. Kinds: message/signal/value; payload: bounded number or text. Parallel routes require linkId. Optional links {realLinkId:{sign:1|-1,delay:ms}} and propagation {maxEvents:1..256,horizon:ms} propagate numeric arrivals only along declared links. Arrival=t+delay+travelMs. Runtime is local transport; reset preserves the graph. Request hints, not solutions.',
  blockType: {
    id: 'animated-flow', renderer: 'animated-flow', name: 'Flujo animado', description: 'Tiempo y propagación causal sobre las conexiones reales del lienzo.',
    properties: [
      { key: 'question', label: 'Pregunta guía', kind: 'text', required: true },
      { key: 'events', label: 'Eventos declarados', kind: 'json', required: true },
      { key: 'duration', label: 'Duración en milisegundos', kind: 'number', required: true },
      { key: 'travelMs', label: 'Tiempo de recorrido en milisegundos', kind: 'number', required: false },
      { key: 'links', label: 'Signo y demora por conexión', kind: 'json', required: false },
      { key: 'propagation', label: 'Límites de propagación', kind: 'json', required: false },
    ],
    defaults: { question: '¿Cómo cambia la señal al recorrer las conexiones?', events: [], duration: 10_000, travelMs: 1000, links: {} },
  },
} satisfies RendererSpec;

export function clampFlowTime(data: AnimatedFlowData, value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.min(data.duration, value)) : 0;
}
export function flowRuntimeState(data: AnimatedFlowData, raw: Readonly<Record<string, unknown>>): FlowRuntime {
  const playhead = clampFlowTime(data, raw.playhead), anchorMs = typeof raw.anchorMs === 'number' && Number.isFinite(raw.anchorMs) && raw.anchorMs >= 0 && raw.anchorMs <= Number.MAX_SAFE_INTEGER ? raw.anchorMs : 0;
  const visited = Array.isArray(raw.visited) && raw.visited.length === 2 && raw.visited.every(n => typeof n === 'number' && Number.isFinite(n)) && raw.visited[0] <= raw.visited[1]
    ? raw.visited.map(n => clampFlowTime(data, n)) : [playhead, playhead];
  return { playhead, playing: raw.playing === true && anchorMs > 0 && playhead < data.duration, anchorMs,
    visited: [Math.min(visited[0], playhead), Math.max(visited[1], playhead)] };
}
/** `nowMs` is an epoch clock (Date.now), never a requestAnimationFrame timestamp. */
export function flowTimeAt(data: AnimatedFlowData, runtime: Readonly<Record<string, unknown>>, nowMs: number): number {
  const state = flowRuntimeState(data, runtime);
  return clampFlowTime(data, state.playhead + (state.playing && Number.isFinite(nowMs) ? Math.max(0, nowMs - state.anchorMs) : 0));
}
export function seekFlow(data: AnimatedFlowData, runtime: Readonly<Record<string, unknown>>, value: number, nowMs: number): FlowRuntime {
  const state = flowRuntimeState(data, runtime), before = flowTimeAt(data, runtime, nowMs), playhead = clampFlowTime(data, value);
  return { playhead, playing: false, anchorMs: 0, visited: [Math.min(state.visited[0], before, playhead), Math.max(state.visited[1], before, playhead)] };
}

export type FlowIssue = { eventIndex?: number; linkId?: string; reason: 'missing' | 'parallel'; message: string };
export type ResolvedFlowEvent = AnimatedFlowEvent & { linkId: string; arrival: number; delivered: number | string; sign?: 1 | -1; delay?: number; generated: boolean };
export type FlowSimulation = { events: readonly ResolvedFlowEvent[]; issues: readonly FlowIssue[]; horizon: number; limitedBy: readonly ('events' | 'horizon')[] };
/** Bounded discrete events; every generated arrival retains its numeric contribution. */
export function simulateAnimatedFlow(data: AnimatedFlowData, document: AnimatedFlowDocument): FlowSimulation {
  const nodes = new Set([...document.blocks, ...document.groups].map(n => n.id));
  const byId = new Map(document.links.map(link => [link.id, link]));
  const directed = new Map<string, typeof document.links[number][]>();
  for (const link of document.links) {
    const key = JSON.stringify([link.from, link.to]), list = directed.get(key) ?? [];
    list.push(link); directed.set(key, list);
  }
  const issues: FlowIssue[] = [], resolved: ResolvedFlowEvent[] = [], limitedBy = new Set<'events' | 'horizon'>();
  const horizon = data.propagation?.horizon ?? data.duration, maxEvents = data.propagation?.maxEvents ?? 64;
  const append = (event: AnimatedFlowEvent, linkId: string, generated: boolean) => {
    const metadata = data.links[linkId], arrival = event.t + (metadata?.delay ?? 0) + data.travelMs;
    if (event.t >= horizon) { limitedBy.add('horizon'); return; }
    if (resolved.length >= maxEvents) { limitedBy.add('events'); return; }
    if (arrival > horizon) limitedBy.add('horizon');
    resolved.push({ ...event, linkId, arrival, delivered: typeof event.payload === 'number' ? event.payload * (metadata?.sign ?? 1) : event.payload,
      ...(metadata ? { sign: metadata.sign, delay: metadata.delay } : {}), generated });
  };
  data.events.forEach((event, eventIndex) => {
    const candidates = directed.get(JSON.stringify([event.from, event.to])) ?? [];
    const explicit = event.linkId ? byId.get(event.linkId) : undefined;
    const link = event.linkId ? explicit?.from === event.from && explicit.to === event.to ? explicit : undefined : candidates.length === 1 ? candidates[0] : undefined;
    if (!nodes.has(event.from) || !nodes.has(event.to) || !link) {
      const parallel = !event.linkId && candidates.length > 1 && nodes.has(event.from) && nodes.has(event.to);
      issues.push({ eventIndex, reason: parallel ? 'parallel' : 'missing', message: parallel ? 'Hay varias conexiones entre estos nodos. Elige una ruta para este evento.' : MISSING_FLOW_ROUTE });
    } else append(event, link.id, false);
  });
  if (data.propagation) {
    const outgoing = new Map<string, typeof document.links[number][]>();
    for (const linkId of Object.keys(data.links).sort()) {
      const link = byId.get(linkId);
      if (!link || !nodes.has(link.from) || !nodes.has(link.to)) { issues.push({ linkId, reason: 'missing', message: MISSING_FLOW_ROUTE }); continue; }
      const list = outgoing.get(link.from) ?? []; list.push(link); outgoing.set(link.from, list);
    }
    // Time priority plus stable insertion order avoids starving an earlier branch.
    const pending = [...resolved];
    while (pending.length) {
      pending.sort((a, b) => a.arrival - b.arrival);
      const event = pending.shift()!;
      if (typeof event.delivered !== 'number' || event.delivered === 0) continue;
      for (const link of outgoing.get(event.to) ?? []) {
        const before = resolved.length;
        append({ t: event.arrival, from: link.from, to: link.to, payload: event.delivered, kind: event.kind, linkId: link.id }, link.id, true);
        if (resolved.length > before) pending.push(resolved[resolved.length - 1]);
      }
      if (limitedBy.has('events')) break;
    }
  }
  return { events: resolved.sort((a, b) => a.t - b.t), issues, horizon, limitedBy: [...limitedBy] };
}
export const flowNumber = (value: number) => String(Number(value.toPrecision(5)));
export function flowPayloadLabel(payload: number | string): string {
  return Array.from(typeof payload === 'number' ? flowNumber(payload) : payload.replace(/\s+/g, ' ')).slice(0, 40).join('');
}
export function tokensAt(simulation: FlowSimulation, time: number): MotionToken[] {
  if (time >= simulation.horizon) return [];
  return simulation.events.filter(e => time >= e.t && time < e.arrival).map(e => ({ linkId: e.linkId, progress: Math.max(0, Math.min(1, (time - e.t) / (e.arrival - e.t))), kind: e.kind, label: flowPayloadLabel(e.payload),
    ...(e.sign === undefined ? {} : { sign: e.sign, delay: e.delay }) }));
}
/** Bridge API: raw per-block runtime JSON in, tokens for the real link layer out. */
export function motionAt(data: AnimatedFlowData, runtime: Readonly<Record<string, unknown>>, document: AnimatedFlowDocument, nowMs: number): MotionToken[] {
  if (!Object.hasOwn(runtime, 'playhead') || typeof runtime.playhead !== 'number' || !Number.isFinite(runtime.playhead)) return [];
  const time = flowTimeAt(data, runtime, nowMs);
  // End-of-horizon is a stopped experiment, not indefinitely frozen active tokens.
  if (time >= (data.propagation?.horizon ?? data.duration)) return [];
  return tokensAt(simulateAnimatedFlow(data, document), time);
}
export function flowActivityAt(simulation: FlowSimulation, time: number): { active: number; completed: number; values: Readonly<Record<string, number>> } {
  const values: Record<string, number> = {}, completed = simulation.events.filter(e => e.arrival <= Math.min(time, simulation.horizon));
  for (const e of completed) if (typeof e.delivered === 'number') values[e.to] = (values[e.to] ?? 0) + e.delivered;
  return { active: tokensAt(simulation, time).length, completed: completed.length, values };
}
const kindLabels = { message: 'Mensaje', signal: 'Señal', value: 'Valor' };
export function flowEventText(event: ResolvedFlowEvent, document: AnimatedFlowDocument): string {
  const title = (id: string) => [...document.blocks, ...document.groups].find(n => n.id === id)?.title || 'Nodo sin título';
  return `${kindLabels[event.kind]}: ${flowPayloadLabel(event.payload)}, de ${title(event.from)} a ${title(event.to)}${event.sign === undefined ? '' : `; signo ${event.sign === 1 ? '+' : '−'}, demora ${flowNumber(event.delay ?? 0)} ms`}.`;
}
