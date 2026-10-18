import { z } from 'zod';
import type { CanvasDocument } from './model';
export const variableNameSchema = z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]{0,31}$/).refine(name => !['__proto__', 'constructor', 'prototype'].includes(name), 'Reserved variable name.');
/**
 * A shared value a person or the agent declares on the Lienzo or on a Frame. Values stay numbers everywhere (runtime,
 * canvas_runtime, shader uniforms), so the type only says how to show and edit one: `number` (the default when absent)
 * is a range; `boolean` is on/off stored as 0 or 1 with min 0, max 1; `choice` is one of `options`, stored as the
 * option's index with min 0 and max options.length - 1. Declarations written before types existed are numbers.
 */
export const VARIABLE_TYPES = ['number', 'boolean', 'choice'] as const;
export type VariableType = typeof VARIABLE_TYPES[number];
export const variableSchema = z.object({
  name: variableNameSchema, label: z.string().max(200).optional(), type: z.enum(VARIABLE_TYPES).optional(),
  options: z.array(z.string().trim().min(1).max(60)).min(2).max(12).optional(), value: z.number().finite(),
  min: z.number().finite(), max: z.number().finite(), step: z.number().finite().positive().optional(), unit: z.string().max(40).optional(),
}).strict().refine(v => v.min <= v.max && v.value >= v.min && v.value <= v.max, 'Expected min <= value <= max.')
  .refine(v => v.type === 'choice' ? !!v.options : !v.options, 'Only a choice variable lists options, and a choice variable needs at least two.')
  .refine(v => v.type !== 'boolean' || v.min === 0 && v.max === 1 && (v.value === 0 || v.value === 1), 'An on/off variable has min 0, max 1 and the value 0 or 1.')
  .refine(v => v.type !== 'choice' || !v.options || v.min === 0 && v.max === v.options.length - 1 && Number.isInteger(v.value), 'A choice variable has min 0, max options.length - 1 and an option index as value.')
  .refine(v => !v.options || new Set(v.options).size === v.options.length, 'Choice options must be unique.');
/** Whether a variable only takes whole steps (on/off and choices). */
export const isDiscreteVariable = (v: { type?: VariableType }) => v.type === 'boolean' || v.type === 'choice';
export const variablesSchema = z.array(variableSchema).max(24).refine(v => new Set(v.map(x => x.name)).size === v.length, 'Variable names must be unique within a scope.');
export type JSONValue = z.infer<ReturnType<typeof z.json>>;
const runtimeKeySchema = z.string().max(100).refine(key => !['__proto__', 'constructor', 'prototype'].includes(key), 'Reserved JSON key.');
export const runtimeJsonSchema: z.ZodType<JSONValue> = z.lazy(() => z.union([
  z.string(), z.number().finite(), z.boolean(), z.null(), z.array(runtimeJsonSchema), z.record(runtimeKeySchema, runtimeJsonSchema),
]));
// Check original input before Zod records normalize prototype keys away.
export const runtimeBlockStateSchema: z.ZodType<Record<string, JSONValue>, Record<string, JSONValue>> = z.preprocess((raw, context) => {
  const visit = (value: unknown, depth: number): void => {
    if (depth > 32) { context.addIssue({ code: 'custom', message: 'JSON nesting exceeds 32 levels.' }); return; }
    if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) {
      if (['__proto__', 'constructor', 'prototype'].includes(key)) context.addIssue({ code: 'custom', message: `Reserved JSON key: ${key}.` });
      visit(child, depth + 1);
    }
  };
  visit(raw, 0); return raw;
}, z.record(runtimeKeySchema, runtimeJsonSchema)).meta({ type: "object", additionalProperties: true, description: "Non-executable JSON object; maximum 4 KiB, depth 32, no prototype keys." }) as z.ZodType<Record<string, JSONValue>, Record<string, JSONValue>>;
export const runtimeStateSchema = z.object({
  blocks: z.record(z.string(), runtimeBlockStateSchema),
  scopes: z.record(z.string(), z.record(variableNameSchema, z.number().finite())),
}).strict();
export type ScopeVariable = z.infer<typeof variableSchema>;
export type RuntimeState = z.infer<typeof runtimeStateSchema>;
export type ResolvedVariable = ScopeVariable & { scopeId: string; current: number };
export const DOCUMENT_SCOPE = '$document';
export const RUNTIME_BLOCK_BYTES = 4096, RUNTIME_DOCUMENT_BYTES = 262144;
export function resolveScope(document: CanvasDocument, blockId: string, runtime: RuntimeState): Record<string, ResolvedVariable> {
  const block = document.blocks.find(b => b.id === blockId);
  if (!block) return {};
  const result: Record<string, ResolvedVariable> = {}, seen = new Set<string>();
  const add = (scopeId: string, variables?: ScopeVariable[]) => {
    for (const variable of variables ?? []) if (!Object.hasOwn(result, variable.name)) {
      const value = runtime.scopes[scopeId]?.[variable.name];
      result[variable.name] = { ...variable, scopeId, current: value === undefined ? variable.value : Math.max(variable.min, Math.min(variable.max, value)) };
    }
  };
  let parent = block.parentGroupId;
  while (parent && !seen.has(parent)) {
    seen.add(parent); const group = document.groups.find(g => g.id === parent); if (!group) break;
    add(parent, group.variables); parent = group.parentGroupId;
  }
  add(DOCUMENT_SCOPE, document.variables); return result;
}
/** Deleted declarations and entities never resurrect their old runtime values through undo. */
export function cleanRuntime(document: CanvasDocument, runtime: RuntimeState): void {
  const blocks = new Set(document.blocks.map(b => b.id));
  for (const id of Object.keys(runtime.blocks)) if (!blocks.has(id)) delete runtime.blocks[id];
  for (const [scopeId, values] of Object.entries(runtime.scopes)) {
    const declarations = scopeId === DOCUMENT_SCOPE ? document.variables : document.groups.find(g => g.id === scopeId)?.variables;
    if (!declarations) { delete runtime.scopes[scopeId]; continue; }
    for (const name of Object.keys(values)) if (!declarations.some(v => v.name === name)) delete values[name];
    if (!Object.keys(values).length) delete runtime.scopes[scopeId];
  }
}
