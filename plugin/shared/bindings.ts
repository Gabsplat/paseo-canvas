// Property bindings (docs/mcp.md "Bindings", docs/design.md §38): a block property follows a variable at render time.
// The stored document holds only the rule; the value comes from runtime variables, so moving a slider never writes a
// revision. One registry says what can be bound, so the server, the renderers and the Properties panel agree.
import { z } from 'zod';
import { resolveScope, variableNameSchema, type RuntimeState } from './learning';
import { WB_COLORS, type WbColor } from './whiteboard';
import type { CanvasBlock, CanvasDocument } from './model';

export type BindableKind = 'number' | 'color' | 'text';
export type Bindable = { path: string; label: string; kind: BindableKind; unit?: string; min?: number; max?: number; renderers?: readonly string[]; except?: readonly string[]; help: string };
const TEXT_RENDERERS = ['wb-text', 'wb-shape', 'node', 'note'] as const;
/** Everything a binding can drive. `renderers` limits a property to those renderers; absent, every block has it. */
export const BINDABLE = [
  { path: 'size.width', label: 'Width', kind: 'number', unit: 'px', min: 8, max: 4096, except: ['wb-text'], help: 'Links and Frames follow the bound size.' },
  { path: 'size.height', label: 'Height', kind: 'number', unit: 'px', min: 8, max: 4096, except: ['wb-text'], help: 'Links and Frames follow the bound size.' },
  { path: 'offset.x', label: 'Shift right', kind: 'number', unit: 'px', min: -4096, max: 4096, help: 'Moves the drawing only; the stored place, links and Frames stay.' },
  { path: 'offset.y', label: 'Shift down', kind: 'number', unit: 'px', min: -4096, max: 4096, help: 'Moves the drawing only; the stored place, links and Frames stay.' },
  { path: 'rotation', label: 'Rotation', kind: 'number', unit: '°', min: -3600, max: 3600, help: 'Turns the drawing around its centre.' },
  { path: 'opacity', label: 'Opacity', kind: 'number', min: 0, max: 1, help: '0 is invisible, 1 is solid.' },
  { path: 'stroke.color', label: 'Outline colour', kind: 'color', renderers: ['wb-shape'], help: 'A hue along a range, or a colour per threshold.' },
  { path: 'fill.color', label: 'Fill colour', kind: 'color', renderers: ['wb-shape'], help: 'Fills the shape, also when its fill is none.' },
  { path: 'stroke.width', label: 'Outline width', kind: 'number', unit: 'px', min: 0, max: 48, renderers: ['wb-shape'], help: 'The line thickness.' },
  { path: 'corner.radius', label: 'Corner radius', kind: 'number', unit: 'px', min: 0, max: 512, renderers: ['wb-shape'], help: 'Rectangles only.' },
  { path: 'text.size', label: 'Text size', kind: 'number', unit: 'px', min: 6, max: 240, renderers: TEXT_RENDERERS, help: 'The size of the label or text.' },
  { path: 'text.template', label: 'Text', kind: 'text', renderers: TEXT_RENDERERS, help: 'Shows the value in words: “Speed: {v}”.' },
] as const satisfies readonly Bindable[];
export type BindablePath = typeof BINDABLE[number]['path'];
export const BINDABLE_PATHS = BINDABLE.map(b => b.path) as [BindablePath, ...BindablePath[]];
export const BINDING_LIMITS = { perBlock: 12, expression: 160, tokens: 80, depth: 16, steps: 8, template: 300, args: 8 } as const;
export const bindableOf = (path: string): Bindable | undefined => (BINDABLE as readonly Bindable[]).find(b => b.path === path);
/** Whether a block of this renderer has the property. */
export function bindableFor(path: string, renderer: string | undefined): boolean {
  const b = bindableOf(path); if (!b) return false;
  if (b.renderers) return !!renderer && b.renderers.includes(renderer);
  return !b.except?.includes(renderer ?? '');
}
export const bindablesFor = (renderer: string | undefined): Bindable[] => (BINDABLE as readonly Bindable[]).filter(b => bindableFor(b.path, renderer));

// ---- Expressions: numbers, v, pi, + - * / %, parentheses and a few functions. Parsed into a tree, never evaluated as code.

type ExprNode = { k: 'n'; v: number } | { k: 'v' } | { k: 'neg'; a: ExprNode } | { k: 'op'; op: string; a: ExprNode; b: ExprNode } | { k: 'fn'; f: string; args: ExprNode[] };
const FUNCTIONS: Record<string, { min: number; max: number; run(...xs: number[]): number }> = {
  min: { min: 2, max: BINDING_LIMITS.args, run: Math.min }, max: { min: 2, max: BINDING_LIMITS.args, run: Math.max },
  clamp: { min: 3, max: 3, run: (x, a, b) => Math.min(Math.max(x, Math.min(a, b)), Math.max(a, b)) },
  round: { min: 1, max: 1, run: Math.round }, floor: { min: 1, max: 1, run: Math.floor }, ceil: { min: 1, max: 1, run: Math.ceil },
  abs: { min: 1, max: 1, run: Math.abs }, sqrt: { min: 1, max: 1, run: Math.sqrt },
  sin: { min: 1, max: 1, run: Math.sin }, cos: { min: 1, max: 1, run: Math.cos },
};
export const EXPRESSION_FUNCTIONS = Object.keys(FUNCTIONS);
export class ExpressionError extends Error { constructor(message: string) { super(message); this.name = 'ExpressionError'; } }
/** Parses `v * 20 + 40`. Throws ExpressionError with a message for people. */
export function parseExpression(source: string): ExprNode {
  if (typeof source !== 'string' || !source.trim()) throw new ExpressionError('The expression is empty.');
  if (source.length > BINDING_LIMITS.expression) throw new ExpressionError(`At most ${BINDING_LIMITS.expression} characters.`);
  const tokens: string[] = [], re = /\s*(?:(\d+\.?\d*(?:e[+-]?\d+)?|\.\d+(?:e[+-]?\d+)?)|([a-z_][a-z0-9_]*)|([-+*/%(),]))/iy;
  let at = 0;
  while (at < source.length) {
    if (/^\s*$/.test(source.slice(at))) break;
    re.lastIndex = at; const m = re.exec(source);
    if (!m) throw new ExpressionError(`Unexpected “${source.slice(at).trim()[0]}”. Use numbers, v, + - * / %, parentheses and ${EXPRESSION_FUNCTIONS.join(', ')}.`);
    tokens.push(m[1] ?? m[2] ?? m[3]); at = re.lastIndex;
    if (tokens.length > BINDING_LIMITS.tokens) throw new ExpressionError('The expression is too long.');
  }
  let i = 0, depth = 0;
  const peek = () => tokens[i], next = () => tokens[i++];
  const expect = (t: string) => { if (next() !== t) throw new ExpressionError(`Expected “${t}”.`); };
  const deeper = <T>(f: () => T): T => { if (++depth > BINDING_LIMITS.depth) throw new ExpressionError('The expression nests too deeply.'); try { return f(); } finally { depth--; } };
  const add = (): ExprNode => { let a = mul(); while (peek() === '+' || peek() === '-') { const op = next()!; a = { k: 'op', op, a, b: mul() }; } return a; };
  const mul = (): ExprNode => { let a = unary(); while (peek() === '*' || peek() === '/' || peek() === '%') { const op = next()!; a = { k: 'op', op, a, b: unary() }; } return a; };
  const unary = (): ExprNode => deeper(() => { if (peek() === '-') { next(); return { k: 'neg', a: unary() }; } if (peek() === '+') { next(); return unary(); } return primary(); });
  const primary = (): ExprNode => {
    const t = next();
    if (t === undefined) throw new ExpressionError('The expression ends too early.');
    if (t === '(') { const a = add(); expect(')'); return a; }
    if (/^[\d.]/.test(t)) { const v = Number(t); if (!Number.isFinite(v)) throw new ExpressionError(`${t} is not a usable number.`); return { k: 'n', v }; }
    if (/^[a-z_]/i.test(t)) {
      const name = t.toLowerCase();
      if (name === 'v') return { k: 'v' };
      if (name === 'pi') return { k: 'n', v: Math.PI };
      const f = FUNCTIONS[name];
      if (!f || !Object.hasOwn(FUNCTIONS, name)) throw new ExpressionError(name === 't' ? 'Time (t) is not available; use v, the variable’s value.' : `Unknown name “${t}”. Use v, pi or ${EXPRESSION_FUNCTIONS.join(', ')}.`);
      expect('('); const args: ExprNode[] = [];
      if (peek() !== ')') { args.push(add()); while (peek() === ',') { next(); args.push(add()); } }
      expect(')');
      if (args.length < f.min || args.length > f.max) throw new ExpressionError(`${name} takes ${f.min === f.max ? f.min : `${f.min} to ${f.max}`} value${f.max === 1 ? '' : 's'}.`);
      return { k: 'fn', f: name, args };
    }
    throw new ExpressionError(`Unexpected “${t}”.`);
  };
  const tree = add();
  if (i < tokens.length) throw new ExpressionError(`Unexpected “${tokens[i]}”.`);
  return tree;
}
export function evaluateExpression(tree: ExprNode, v: number): number {
  switch (tree.k) {
    case 'n': return tree.v;
    case 'v': return v;
    case 'neg': return -evaluateExpression(tree.a, v);
    case 'fn': return FUNCTIONS[tree.f].run(...tree.args.map(a => evaluateExpression(a, v)));
    case 'op': { const a = evaluateExpression(tree.a, v), b = evaluateExpression(tree.b, v); return tree.op === '+' ? a + b : tree.op === '-' ? a - b : tree.op === '*' ? a * b : tree.op === '/' ? a / b : a % b; }
  }
}
const parsed = new Map<string, ExprNode | ExpressionError>();
/** The value of an expression for v, or NaN when it cannot be computed (it never throws). */
export function expressionValue(source: string, v: number): number {
  let tree = parsed.get(source);
  if (!tree) { try { tree = parseExpression(source); } catch (error) { tree = error instanceof ExpressionError ? error : new ExpressionError('Invalid expression.'); } if (parsed.size > 256) parsed.clear(); parsed.set(source, tree); }
  if (tree instanceof ExpressionError) return NaN;
  const value = evaluateExpression(tree, v); return Number.isFinite(value) ? value : NaN;
}
export function expressionIssue(source: string): string | null { try { parseExpression(source); return null; } catch (error) { return error instanceof Error ? error.message : 'Invalid expression.'; } }

// ---- The stored rule ----------------------------------------------------------------------------------------------

const finite = z.number().finite().min(-1e9).max(1e9), pair = z.tuple([finite, finite]);
export const linearMapSchema = z.object({ from: pair, to: pair, clamp: z.boolean().optional() }).strict()
  .refine(m => m.from[0] !== m.from[1], 'map.from needs two different numbers.');
export const bindingColorSchema = z.union([z.enum(WB_COLORS), z.string().regex(/^#[0-9a-fA-F]{6}$/, 'A colour is a whiteboard colour name or #rrggbb.')]);
const hue = z.number().finite().min(-720).max(720);
export const bindingSchema = z.object({
  variable: variableNameSchema,
  /** v from from[0]..from[1] becomes to[0]..to[1]; outside the range it is clamped unless clamp is false. */
  map: linearMapSchema.optional(),
  /** Or a small formula of v instead of map. */
  expr: z.string().min(1).max(BINDING_LIMITS.expression).optional(),
  /** Colour: a hue (degrees) along a range of v. */
  hue: z.object({ from: pair, to: z.tuple([hue, hue]) }).strict().refine(m => m.from[0] !== m.from[1], 'hue.from needs two different numbers.').optional(),
  /** Colour: the colour of the last step whose `at` is at most v (below the first step, the first colour). */
  steps: z.array(z.object({ at: finite, color: bindingColorSchema }).strict()).min(1).max(BINDING_LIMITS.steps).refine(s => s.every((x, i) => !i || x.at > s[i - 1].at), 'steps go from the lowest at to the highest, each above the one before.').optional(),
  /** Text: {v} is the value, {v:2} with two decimals. */
  template: z.string().max(BINDING_LIMITS.template).optional(),
}).strict().superRefine((b, ctx) => {
  if (b.map && b.expr) ctx.addIssue({ code: 'custom', message: 'Use map or expr, not both.' });
  if (b.hue && b.steps) ctx.addIssue({ code: 'custom', message: 'Use hue or steps, not both.' });
  if (b.expr) { const issue = expressionIssue(b.expr); if (issue) ctx.addIssue({ code: 'custom', path: ['expr'], message: issue }); }
});
export type Binding = z.infer<typeof bindingSchema>;
export const bindingsSchema = z.record(z.string(), bindingSchema).superRefine((all, ctx) => {
  const paths = Object.keys(all);
  if (paths.length > BINDING_LIMITS.perBlock) ctx.addIssue({ code: 'custom', message: `At most ${BINDING_LIMITS.perBlock} bindings per block.` });
  for (const path of paths) {
    const b = bindableOf(path), binding = all[path];
    if (!b) { ctx.addIssue({ code: 'custom', path: [path], message: `${path} cannot be bound. Bindable: ${BINDABLE_PATHS.join(', ')}.` }); continue; }
    if (b.kind === 'color' && !binding.hue && !binding.steps) ctx.addIssue({ code: 'custom', path: [path], message: 'A colour binding needs hue {from,to} or steps [{at,color}].' });
    if (b.kind !== 'color' && (binding.hue || binding.steps)) ctx.addIssue({ code: 'custom', path: [path], message: 'hue and steps are only for stroke.color and fill.color.' });
    if (b.kind !== 'text' && binding.template !== undefined) ctx.addIssue({ code: 'custom', path: [path], message: 'template is only for text.template.' });
  }
});
export type Bindings = z.infer<typeof bindingsSchema>;

// ---- From a value to what is drawn --------------------------------------------------------------------------------

/** map or expr applied to v; v itself without either. NaN when it cannot be computed. */
export function transformValue(binding: Pick<Binding, 'map' | 'expr'>, v: number): number {
  if (!Number.isFinite(v)) return NaN;
  if (binding.expr) return expressionValue(binding.expr, v);
  if (!binding.map) return v;
  const { from: [a, b], to: [c, d], clamp = true } = binding.map;
  let t = (v - a) / (b - a); if (clamp) t = Math.max(0, Math.min(1, t));
  return c + (d - c) * t;
}
/** A colour a binding produces: a whiteboard colour name, #rrggbb, or `hue:<degrees>` for the renderer to light by theme. */
export type BoundColor = WbColor | `#${string}` | `hue:${number}`;
export function formatTemplate(template: string, value: number): string {
  return template.replace(/\{v(?::([0-4]))?\}/g, (_, digits?: string) => digits !== undefined ? value.toFixed(Number(digits)) : String(Number(value.toPrecision(6)))).slice(0, 1000);
}
/** What a binding gives for the value v, already inside the property's limits; undefined when it gives nothing usable. */
export function bindingOutput(path: string, binding: Binding, v: number): number | string | undefined {
  const b = bindableOf(path); if (!b) return undefined;
  const x = transformValue(binding, v); if (!Number.isFinite(x)) return undefined;
  if (b.kind === 'text') return formatTemplate(binding.template ?? '{v}', x);
  if (b.kind === 'color') {
    if (binding.steps) { let pick = binding.steps[0].color; for (const s of binding.steps) if (x >= s.at) pick = s.color; return pick; }
    if (binding.hue) { const { from: [a, c], to: [h0, h1] } = binding.hue, t = Math.max(0, Math.min(1, (x - a) / (c - a))); return `hue:${Math.round(((h0 + (h1 - h0) * t) % 360 + 360) % 360)}`; }
    return undefined;
  }
  return Math.max(b.min ?? -Infinity, Math.min(b.max ?? Infinity, x));
}
export type BoundValues = Partial<Record<BindablePath, number | string>>;
export type BindingState = { path: BindablePath; variable: string; scopeId?: string; value?: number; output?: number | string; issue?: string };
/** Every binding of a block, resolved through its scope chain: what it gives now, or why it gives nothing. */
export function bindingStates(document: CanvasDocument, block: CanvasBlock, runtime: RuntimeState, renderer: string | undefined): BindingState[] {
  if (!block.bindings) return [];
  const scope = resolveScope(document, block.id, runtime);
  return Object.entries(block.bindings).map(([path, binding]) => {
    const state: BindingState = { path: path as BindablePath, variable: binding.variable };
    if (!bindableFor(path, renderer)) return { ...state, issue: 'This kind of block does not have it.' };
    const variable = Object.hasOwn(scope, binding.variable) ? scope[binding.variable] : undefined;
    if (!variable) return { ...state, issue: `${binding.variable} is not declared on its Frames or the Lienzo.` };
    const output = bindingOutput(path, binding, variable.current);
    return { ...state, scopeId: variable.scopeId, value: variable.current, ...(output === undefined ? { issue: 'The mapping gives no usable value here.' } : { output }) };
  });
}
export function boundValues(states: readonly BindingState[]): BoundValues {
  const out: BoundValues = {}; for (const s of states) if (s.output !== undefined) out[s.path] = s.output; return out;
}
/**
 * The values bound on a projected block (client/presentation.ts). Kept beside the block, never in it, so a bound value
 * can reach layout and renderers without ever being written to the document.
 */
const view = new WeakMap<object, BoundValues>();
export const boundOf = (block: object | undefined | null): BoundValues | undefined => block ? view.get(block) : undefined;
export const setBound = (block: object, values: BoundValues) => { view.set(block, values); };
/** Bindings that follow a renamed variable: those of blocks whose name resolves to the scope that renamed it. */
export function renameInBindings(document: CanvasDocument, scopeId: string, from: string, to: string): { id: string; bindings: Bindings }[] {
  const empty: RuntimeState = { blocks: {}, scopes: {} }, out: { id: string; bindings: Bindings }[] = [];
  for (const block of document.blocks) {
    if (!block.bindings || !Object.values(block.bindings).some(b => b.variable === from)) continue;
    if (resolveScope(document, block.id, empty)[from]?.scopeId !== scopeId) continue;
    out.push({ id: block.id, bindings: Object.fromEntries(Object.entries(block.bindings).map(([path, b]) => [path, b.variable === from ? { ...b, variable: to } : b])) });
  }
  return out;
}
