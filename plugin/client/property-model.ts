// The data side of the Properties editors: pure functions that turn stored block data into rows a person edits and
// back, without changing what the agent reads. Every editor writes the same shapes the MCP tools accept.
import type { BlockType, CanvasBlock, CanvasDocument, CanvasOperation } from '../shared/model';
import { getRendererSpec } from '../shared/renderers';
import { DOCUMENT_SCOPE, resolveScope, variableSchema, variablesSchema, type RuntimeState, type ScopeVariable, type VariableType } from '../shared/learning';
import { FILE_TREE_LIMITS, type FileTreeData } from '../shared/renderers/file-tree';
import type { AnimatedFlowData, AnimatedFlowEvent } from '../shared/renderers/animated-flow';
import type { GlslUniform } from '../shared/renderers/glsl-shader';
import { tokens } from './tokens';
import { renameInBindings } from '../shared/bindings';

export type Property = BlockType['properties'][number];
type Json = CanvasBlock['data'][string];
type Data = CanvasBlock['data'];

// ---- Generic -------------------------------------------------------------------------------------------------------

/** Empty means "not used yet": absent, null, blank text, an empty list or an empty object. */
export function hasValue(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim() !== '';
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}
/**
 * Which fields show at once and which wait under "More options". A field is up front when it is required, when its
 * type does not mark it advanced, or when it already holds something (an advanced field that is used never hides).
 */
export function splitProperties(type: BlockType, data: Data, hidden: (p: Property) => boolean = () => false): { primary: Property[]; more: Property[] } {
  const primary: Property[] = [], more: Property[] = [];
  for (const p of type.properties) {
    if (hidden(p)) continue;
    const value = data[p.key], defaultValue = type.defaults[p.key];
    const used = hasValue(value) && JSON.stringify(value) !== JSON.stringify(defaultValue);
    (p.required || !p.advanced || used ? primary : more).push(p);
  }
  return { primary, more };
}
/** A plain error whose message is meant for the person: Properties shows it as it is. */
export function plainError(message: string): Error { const error = new Error(message); error.name = 'LienzoPlainError'; return error; }
const issueText = (issue: { path: PropertyKey[]; message: string }) => {
  const where = issue.path.map(String).filter(Boolean).join('.');
  return where ? `${where}: ${issue.message}` : issue.message;
};
// ---- Sections ------------------------------------------------------------------------------------------------------

/**
 * Which Properties sections are open (RightPanel PanelSection). Every selection starts with its sections collapsed
 * under the header that names the kind and the title; what the person opens stays open only while that selection does.
 * A flow that asks for one section (Edit text, a data problem, instructions from the menu) opens it the same way.
 */
export function createSectionMemory() {
  const chosen = new Map<string, boolean>(), forced = new Map<string, string>(), listeners = new Set<() => void>();
  let version = 0;
  const emit = () => { version++; listeners.forEach(listener => listener()); };
  const key = (title: string, scope: string) => `${scope}\u0000${title}`;
  const isOpen = (title: string, defaultOpen = false, scope = '') => forced.get(title) === scope || (chosen.get(key(title, scope)) ?? defaultOpen);
  return {
    isOpen,
    /** The person pressed the header: kept for this selection only (another selection forgets it). */
    toggle(title: string, defaultOpen = false, scope = '') { const open = isOpen(title, defaultOpen, scope); forced.delete(title); chosen.clear(); chosen.set(key(title, scope), !open); emit(); },
    /** Opens a section for one selection only. */
    force(title: string, scope: string) { if (forced.get(title) === scope) return; forced.set(title, scope); emit(); },
    reset() { chosen.clear(); forced.clear(); emit(); },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    version: () => version,
  };
}
export type SectionMemory = ReturnType<typeof createSectionMemory>;
export const sectionMemory = createSectionMemory();
/** One selection, as forced sections know it: the selected ids and the selected link. */
export const sectionScope = (selection: readonly string[], linkId?: string | null) => `${selection.join('|')}#${linkId ?? ''}`;
/**
 * The section a block's own problem lives in, so Properties opens there: data the server would refuse, a required
 * field still empty, Controls with no variables or one that is not declared, a flow with no events. Null when fine.
 */
export function attentionSection(type: BlockType | undefined, block: CanvasBlock | undefined, document?: CanvasDocument): 'Content' | null {
  if (!type || !block) return null;
  if (dataIssue(type, block.data)) return 'Content';
  // A required field left blank (a Media with no link). An empty list is a valid start, not a problem.
  if (type.properties.some(p => p.required && (block.data[p.key] === undefined || typeof block.data[p.key] === 'string' && !String(block.data[p.key]).trim()))) return 'Content';
  if (type.renderer === 'controls') {
    const names = Array.isArray(block.data.variables) ? block.data.variables as string[] : [];
    if (!names.length) return 'Content';
    if (document) { const declared = new Set(scopesOf(document, block.id).flatMap(scope => scope.variables.map(v => v.name))); if (names.some(name => !declared.has(name))) return 'Content'; }
  }
  if (type.renderer === 'animated-flow' && !(Array.isArray(block.data.events) && block.data.events.length)) return 'Content';
  return null;
}
/**
 * The first reason the server would refuse this data, in words, or null. Mirrors the server's checks: the renderer's
 * schema, required fields, declared keys and the kind of each field. Keeps a person from waiting for a refusal.
 */
export function dataIssue(type: BlockType, data: Data): string | null {
  const parsed = getRendererSpec(type.renderer)?.dataSchema.safeParse(data);
  if (parsed && !parsed.success) return issueText(parsed.error.issues[0]);
  for (const p of type.properties) {
    const value = data[p.key];
    if (value === undefined) { if (p.required) return `${p.label} is needed.`; continue; }
    if (p.kind !== 'json' && typeof value !== (p.kind === 'text' ? 'string' : p.kind)) return `${p.label} must be ${p.kind === 'text' ? 'text' : p.kind === 'number' ? 'a number' : 'yes or no'}.`;
  }
  for (const key of Object.keys(data)) if (!type.properties.some(p => p.key === key)) return `${key} is not a field of ${type.name}.`;
  return null;
}
/**
 * A JSON merge patch that turns `before` into `after` exactly: removed keys become null, nested objects are patched
 * key by key (the server merges objects) and everything else is replaced.
 */
export function replacePatch(before: Record<string, unknown>, after: Record<string, unknown>): Record<string, Json> {
  const patch: Record<string, Json> = {};
  for (const key of Object.keys(before)) if (!Object.hasOwn(after, key)) patch[key] = null;
  for (const [key, value] of Object.entries(after)) {
    const old = before[key];
    if (JSON.stringify(old) === JSON.stringify(value)) continue;
    const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
    if (object(value) && object(old)) { const inner = replacePatch(old, value); if (Object.keys(inner).length) patch[key] = inner as Json; }
    else patch[key] = value as Json;
  }
  return patch;
}
/** What the server makes of a patch: the same merge rule, so local checks see the stored result. */
export function applyPatch(target: Record<string, unknown>, patch: Record<string, unknown>): Data {
  const result: Record<string, unknown> = JSON.parse(JSON.stringify(target));
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) delete result[key];
    else if (typeof value === 'object' && !Array.isArray(value)) { const old = result[key]; result[key] = applyPatch(old && typeof old === 'object' && !Array.isArray(old) ? old as Record<string, unknown> : {}, value as Record<string, unknown>); }
    else result[key] = JSON.parse(JSON.stringify(value));
  }
  return result as Data;
}
export function move<T>(list: readonly T[], index: number, delta: number): T[] {
  const to = index + delta; if (index < 0 || index >= list.length || to < 0 || to >= list.length) return [...list];
  const next = [...list]; const [item] = next.splice(index, 1); next.splice(to, 0, item); return next;
}
/** Text kept on one line, for fields that are names. */
export const oneLine = (text: string) => text.replace(/\s*\n\s*/g, ' ');

// ---- Status and kind ----------------------------------------------------------------------------------------------

export type StatusTone = 'exito' | 'aviso' | 'riesgo' | 'acento' | 'neutro';
export function statusToneOf(status: string): StatusTone {
  const word = status.trim().toLowerCase();
  return (['exito', 'aviso', 'riesgo', 'acento'] as const).find(tone => (tokens.graph.status[tone] as readonly string[]).includes(word)) ?? 'neutro';
}
/** Suggestions for a text field: the type's own, then what this Lienzo already uses for that field, without repeats. */
export function suggestions(property: Property, document: Pick<CanvasDocument, 'blocks'>, typeId: string): string[] {
  const used = document.blocks.filter(b => b.typeId === typeId).map(b => b.data[property.key]).filter((v): v is string => typeof v === 'string' && !!v.trim()).map(v => v.trim());
  const seen = new Set<string>(), out: string[] = [];
  for (const value of [...property.options ?? [], ...used]) { const key = value.toLowerCase(); if (!seen.has(key)) { seen.add(key); out.push(value); } }
  return out;
}

// ---- Checklist ----------------------------------------------------------------------------------------------------

export type ChecklistRow = { label: string; done: boolean };
/** Old items may be bare strings; they read as not done. */
export function checklistRows(items: unknown): ChecklistRow[] {
  return Array.isArray(items) ? items.map(item => typeof item === 'string' ? { label: item, done: false } : { label: typeof item?.label === 'string' ? item.label : '', done: item?.done === true }) : [];
}
export const checklistItems = (rows: readonly ChecklistRow[]): Json => rows.map(row => ({ label: row.label, done: row.done }));

// ---- File tree ----------------------------------------------------------------------------------------------------

export type TreeRow = { name: string; depth: number; dir: boolean; note?: string; ref?: string; highlight?: boolean; muted?: boolean; closed?: boolean };
/**
 * Stored entries as editable rows: parents before children, siblings in the order they were listed, folders that were
 * only implied by their children made explicit. Each row keeps its own flags (a muted folder does not mute the rows).
 */
export function treeRows(data: Partial<FileTreeData>): TreeRow[] {
  type Node = TreeRow & { path: string; kids: Node[] };
  const root: Node[] = [], byPath = new Map<string, Node>(), closed = new Set((data.collapsed ?? []).map(path => path.replace(/\/$/, '')));
  const ensure = (path: string, dir: boolean): Node => {
    const known = byPath.get(path); if (known) { if (dir) known.dir = true; return known; }
    const cut = path.lastIndexOf('/'), parent = cut < 0 ? null : ensure(path.slice(0, cut), true);
    const node: Node = { path, name: path.slice(cut + 1), depth: parent ? parent.depth + 1 : 0, dir, kids: [] };
    byPath.set(path, node); (parent ? parent.kids : root).push(node); return node;
  };
  for (const entry of data.entries ?? []) {
    const node = ensure(entry.path.replace(/\/$/, ''), entry.path.endsWith('/'));
    if (entry.note) node.note = entry.note; if (entry.ref) node.ref = entry.ref;
    if (entry.highlight) node.highlight = true; if (entry.muted) node.muted = true;
  }
  const rows: TreeRow[] = [];
  const walk = (nodes: Node[]) => nodes.forEach(({ kids, path, ...row }) => { rows.push({ ...row, dir: row.dir || kids.length > 0, ...(closed.has(path) ? { closed: true } : {}) }); walk(kids); });
  walk(root); return rows;
}
/** The path of each row, from the names of the rows above it. */
export function treePaths(rows: readonly TreeRow[]): string[] {
  const stack: string[] = [];
  return rows.map(row => { stack.length = row.depth; stack.push(row.name.trim()); return stack.join('/'); });
}
/** Rows back to stored data: one entry per row, folders with a trailing slash, closed folders listed. */
export function treeData(rows: readonly TreeRow[]): Pick<FileTreeData, 'entries' | 'collapsed'> {
  const paths = treePaths(rows);
  const entries = rows.map((row, i) => ({ path: paths[i] + (row.dir ? '/' : ''), ...(row.note?.trim() ? { note: row.note.trim() } : {}), ...(row.ref ? { ref: row.ref } : {}), ...(row.highlight ? { highlight: true } : {}), ...(row.muted ? { muted: true } : {}) }));
  const collapsed = rows.map((row, i) => row.dir && row.closed ? paths[i] + '/' : null).filter((p): p is string => !!p);
  return { entries, ...(collapsed.length ? { collapsed } : {}) };
}
/** The rows a row carries with it: itself and everything deeper right after it. */
export function subtreeEnd(rows: readonly TreeRow[], index: number): number {
  let end = index + 1; while (end < rows.length && rows[end].depth > rows[index].depth) end++; return end;
}
/** Indent (+1) or outdent (-1) a row with what it holds. A row goes at most one level under the row above it. */
export function indentRow(rows: readonly TreeRow[], index: number, delta: 1 | -1): TreeRow[] {
  const row = rows[index]; if (!row) return [...rows];
  const limit = index === 0 ? 0 : rows[index - 1].depth + 1, depth = Math.max(0, Math.min(limit, row.depth + delta, FILE_TREE_LIMITS.depth - 1));
  const shift = depth - row.depth; if (!shift) return [...rows];
  const end = subtreeEnd(rows, index), next = rows.map(r => ({ ...r }));
  for (let i = index; i < end; i++) next[i].depth = Math.min(FILE_TREE_LIMITS.depth - 1, next[i].depth + shift);
  // Whatever now holds a row is a folder.
  for (let i = 1; i < next.length; i++) if (next[i].depth > next[i - 1].depth) next[i - 1].dir = true;
  return next;
}
/** Move a row (and what it holds) above or below its neighbouring sibling; `index` is where the row is then. */
export function moveTreeRow(rows: readonly TreeRow[], index: number, delta: 1 | -1): { rows: TreeRow[]; index: number } {
  const row = rows[index], same = { rows: [...rows], index }; if (!row) return same;
  const end = subtreeEnd(rows, index), block = rows.slice(index, end);
  if (delta < 0) {
    let prev = index - 1; while (prev >= 0 && rows[prev].depth > row.depth) prev--;
    if (prev < 0 || rows[prev].depth !== row.depth) return same;
    return { rows: [...rows.slice(0, prev), ...block, ...rows.slice(prev, index), ...rows.slice(end)], index: prev };
  }
  if (end >= rows.length || rows[end].depth !== row.depth) return same;
  const after = subtreeEnd(rows, end);
  return { rows: [...rows.slice(0, index), ...rows.slice(end, after), ...block, ...rows.slice(after)], index: index + after - end };
}
/** A new row after `index` (and after what that row holds), as its sibling; inside it when it is an open folder. */
export function insertTreeRow(rows: readonly TreeRow[], index: number, dir: boolean): { rows: TreeRow[]; index: number } {
  const taken = new Set(treePaths(rows));
  const anchor = rows[index], inside = !!anchor?.dir && !anchor.closed, depth = anchor ? anchor.depth + (inside ? 1 : 0) : 0;
  const at = anchor ? inside ? index + 1 : subtreeEnd(rows, index) : rows.length;
  const prefix = anchor ? treePaths(rows)[index].split('/').slice(0, depth).join('/') : '';
  let n = 1, name = dir ? 'folder' : 'file.txt';
  while (taken.has(prefix ? `${prefix}/${name}` : name)) { n++; name = dir ? `folder-${n}` : `file-${n}.txt`; }
  const next = [...rows.map(r => ({ ...r })).slice(0, at), { name, depth, dir }, ...rows.slice(at).map(r => ({ ...r }))];
  return { rows: next, index: at };
}
/** Remove a row with everything it holds. */
export function removeTreeRow(rows: readonly TreeRow[], index: number): TreeRow[] {
  if (!rows[index]) return [...rows]; return [...rows.slice(0, index), ...rows.slice(subtreeEnd(rows, index))];
}
/** Why these rows cannot be saved, in words, or null. */
export function treeIssue(rows: readonly TreeRow[]): string | null {
  if (!rows.length) return 'A file tree needs at least one file or folder.';
  if (rows.length > FILE_TREE_LIMITS.entries) return `At most ${FILE_TREE_LIMITS.entries} files and folders.`;
  const paths = treePaths(rows), seen = new Set<string>();
  for (const [i, row] of rows.entries()) {
    const name = row.name.trim();
    if (!name) return 'Every file and folder needs a name.';
    if (name.includes('/') || name === '.' || name === '..' || /[\u0000-\u001f]/.test(name)) return `“${name}” is not a usable name: no slashes, and not . or ..`;
    if (paths[i].length > FILE_TREE_LIMITS.path) return `${paths[i].slice(0, 40)}… is too long.`;
    if ((row.note?.length ?? 0) > FILE_TREE_LIMITS.note) return `The note on ${name} is over ${FILE_TREE_LIMITS.note} characters.`;
    if (seen.has(paths[i])) return `${paths[i]} appears twice.`; seen.add(paths[i]);
  }
  return null;
}

// ---- Animated flow --------------------------------------------------------------------------------------------------

/** Durations are stored in milliseconds and shown in seconds. */
export const toSeconds = (ms: number) => Math.round(ms) / 1000;
export const toMs = (seconds: number) => Math.round(seconds * 1000);
export const secondsText = (ms: number) => String(Number(toSeconds(ms).toPrecision(6)));
export type Titled = { id: string; title: string };
type Linked = { blocks: readonly Titled[]; groups: readonly Titled[]; links: readonly { id: string; from: string; to: string; label?: string }[] };
/** The links an event can travel along, named the way a person reads them. */
export function flowRoutes(document: Linked): { id: string; from: string; to: string; label: string }[] {
  const title = (id: string) => [...document.blocks, ...document.groups].find(e => e.id === id)?.title || 'Untitled';
  return document.links.map(link => ({ id: link.id, from: link.from, to: link.to, label: `${title(link.from)} → ${title(link.to)}${link.label ? ` · ${link.label}` : ''}` }));
}
/** A new event on the first route, a second after the last one, inside the duration. Null when nothing is linked. */
export function newFlowEvent(data: Pick<AnimatedFlowData, 'events' | 'duration'>, document: Linked): AnimatedFlowEvent | null {
  const route = flowRoutes(document)[0]; if (!route) return null;
  const last = data.events.reduce((t, e) => Math.max(t, e.t), -1000);
  let t = Math.min(data.duration, last + 1000);
  const taken = (time: number) => data.events.some(e => e.t === time && e.from === route.from && e.to === route.to && e.payload === 'Message');
  while (taken(t) && t > 0) t = Math.max(0, t - 100);
  return { t, from: route.from, to: route.to, linkId: route.id, payload: 'Message', kind: 'message' };
}
/** Values travel as numbers; messages and signals as text. Typing a number into a value keeps it a number. */
export function flowPayload(kind: AnimatedFlowEvent['kind'], text: string): number | string {
  const n = Number(text); return kind === 'value' && text.trim() !== '' && Number.isFinite(n) ? n : text;
}

// ---- Variables ----------------------------------------------------------------------------------------------------

/** An identifier from a label: "Spring stiffness" → spring_stiffness, unique among `taken`. */
export function variableName(label: string, taken: Iterable<string>): string {
  const used = new Set(taken);
  let base = label.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 28) || 'value';
  if (!/^[a-z_]/.test(base)) base = 'v_' + base;
  if (['__proto__', 'constructor', 'prototype'].includes(base)) base = 'v_' + base;
  let name = base, n = 2; while (used.has(name)) name = `${base}_${n++}`;
  return name;
}
export const variableTypeLabels: Record<VariableType, string> = { number: 'Number', boolean: 'On / off', choice: 'Choice' };
export const variableTypeOf = (v: Pick<ScopeVariable, 'type'>): VariableType => v.type ?? 'number';
/** A fresh declaration of a type, with a value a person can move straight away. */
export function newVariable(type: VariableType, taken: Iterable<string>, label = type === 'boolean' ? 'Switch' : type === 'choice' ? 'Choice' : 'Value'): ScopeVariable {
  const name = variableName(label, taken);
  if (type === 'boolean') return { name, label, type, value: 0, min: 0, max: 1, step: 1 };
  if (type === 'choice') return { name, label, type, options: ['First', 'Second', 'Third'], value: 0, min: 0, max: 2, step: 1 };
  return { name, label, value: 5, min: 0, max: 10, step: 1 };
}
/** The same variable as another type, keeping its name, label and what still makes sense. */
export function retypeVariable(v: ScopeVariable, type: VariableType): ScopeVariable {
  const { type: _t, options: _o, unit, ...base } = v;
  if (type === 'boolean') return { ...base, type, value: v.value > v.min ? 1 : 0, min: 0, max: 1, step: 1 };
  if (type === 'choice') { const options = v.options ?? ['First', 'Second', 'Third']; return { ...base, type, options, value: Math.min(options.length - 1, Math.max(0, Math.round(v.value))), min: 0, max: options.length - 1, step: 1 }; }
  if (variableTypeOf(v) === 'number') return v;
  return { ...base, value: v.value, min: 0, max: Math.max(1, v.max), step: 1, ...(unit ? { unit } : {}) };
}
/** A choice with a new list of options: the range follows and the value stays on a valid option. */
export function withOptions(v: ScopeVariable, options: string[]): ScopeVariable {
  return { ...v, options, min: 0, max: Math.max(0, options.length - 1), value: Math.min(Math.max(0, options.length - 1), Math.max(0, Math.round(v.value))) };
}
/** Why this declaration cannot be saved, in words, or null. */
export function variableIssue(v: ScopeVariable, siblings: readonly ScopeVariable[] = []): string | null {
  if (siblings.some(other => other.name === v.name)) return `Another variable here is already called ${v.name}.`;
  if (!/^[a-zA-Z_][a-zA-Z0-9_]{0,31}$/.test(v.name)) return 'The name in code uses letters, digits and _ only, starts with a letter or _, and has at most 32 characters.';
  if (variableTypeOf(v) === 'number') {
    if (!(v.min <= v.max)) return 'The lowest value must not be above the highest.';
    if (v.value < v.min || v.value > v.max) return 'The starting value must be between the lowest and the highest.';
  }
  if (v.options && v.options.some(o => !o.trim())) return 'Every choice needs a name.';
  if (v.options && new Set(v.options.map(o => o.trim())).size !== v.options.length) return 'Two choices have the same name.';
  const parsed = variableSchema.safeParse(v); return parsed.success ? null : issueText(parsed.error.issues[0]);
}
export type Scope = { id: string; label: string; variables: readonly ScopeVariable[] };
/** The scopes a block can use, nearest first: its Frames, then the Lienzo. */
export function scopesOf(document: CanvasDocument, blockId: string): Scope[] {
  const block = document.blocks.find(b => b.id === blockId), out: Scope[] = [], seen = new Set<string>();
  let parent = block?.parentGroupId;
  while (parent && !seen.has(parent)) { seen.add(parent); const group = document.groups.find(g => g.id === parent); if (!group) break; out.push({ id: group.id, label: `Frame “${group.title || 'Untitled'}”`, variables: group.variables ?? [] }); parent = group.parentGroupId; }
  out.push({ id: DOCUMENT_SCOPE, label: 'The whole Lienzo', variables: document.variables ?? [] });
  return out;
}
export const scopeVariables = (document: CanvasDocument, scopeId: string): ScopeVariable[] => [...(scopeId === DOCUMENT_SCOPE ? document.variables : document.groups.find(g => g.id === scopeId)?.variables) ?? []];
const scopeUpdate = (scopeId: string, variables: ScopeVariable[]): CanvasOperation => scopeId === DOCUMENT_SCOPE ? { type: 'document.update', variables } : { type: 'group.update', id: scopeId, patch: { variables } };
/** Controls blocks whose `name` resolves to this scope, so a rename or a removal follows them. */
export function variableUsers(document: CanvasDocument, scopeId: string, name: string, controlsTypes: ReadonlySet<string>): CanvasBlock[] {
  const empty: RuntimeState = { blocks: {}, scopes: {} };
  return document.blocks.filter(b => controlsTypes.has(b.typeId) && Array.isArray(b.data.variables) && (b.data.variables as unknown[]).includes(name) && resolveScope(document, b.id, empty)[name]?.scopeId === scopeId);
}
/**
 * One transaction that writes a scope's declarations. When `renamed` maps an old name to a new one (or to null for a
 * removal), Controls that showed it follow: they show the new name, or stop listing a removed one.
 */
export function variableOperations(document: CanvasDocument, scopeId: string, next: ScopeVariable[], renamed: Readonly<Record<string, string | null>>, controlsTypes: ReadonlySet<string>): CanvasOperation[] {
  variablesSchema.parse(next);
  const ops: CanvasOperation[] = [scopeUpdate(scopeId, next)], touched = new Map<string, string[]>();
  for (const [from, to] of Object.entries(renamed)) {
    if (from === to) continue;
    for (const block of variableUsers(document, scopeId, from, controlsTypes)) {
      const names = touched.get(block.id) ?? [...block.data.variables as string[]];
      touched.set(block.id, to ? names.map(n => n === from ? to : n).filter((n, i, all) => all.indexOf(n) === i) : names.filter(n => n !== from));
    }
  }
  for (const [id, variables] of touched) ops.push({ type: 'block.update', id, patch: { data: { variables } } });
  // A shader parameter that takes this variable by name keeps taking it: its uniform and the code are renamed too.
  const empty: RuntimeState = { blocks: {}, scopes: {} };
  for (const [from, to] of Object.entries(renamed)) {
    if (!to || from === to) continue;
    for (const b of document.blocks) {
      const uniforms = b.data.uniforms as GlslUniform[] | undefined, source = b.data.fragmentSource;
      if (!Array.isArray(uniforms) || typeof source !== 'string' || !uniforms.some(u => u.name === from) || uniforms.some(u => u.name === to)) continue;
      if (resolveScope(document, b.id, empty)[from]?.scopeId !== scopeId) continue;
      const patch = uniformsPatch(source, uniforms, uniforms.map(u => u.name === from ? { ...u, name: to } : u), { [from]: to });
      ops.push({ type: 'block.update', id: b.id, patch: { data: patch } });
    }
    // Bound properties follow a rename too. A removed variable leaves its bindings inert: Properties warns about them.
    for (const { id, bindings } of renameInBindings(document, scopeId, from, to)) ops.push({ type: 'block.update', id, patch: { bindings } });
  }
  return ops;
}
/** A block that resolves `name` to this scope: the runtime writes a scope's current value through one. */
export function scopeHolder(document: CanvasDocument, scopeId: string, name: string): string | undefined {
  const empty: RuntimeState = { blocks: {}, scopes: {} };
  return document.blocks.find(b => resolveScope(document, b.id, empty)[name]?.scopeId === scopeId)?.id;
}
/** Display of a variable's value: "4 km/h", "On", "Second". */
export function variableValueText(v: Pick<ScopeVariable, 'type' | 'options' | 'unit'>, value: number): string {
  if (v.type === 'boolean') return value ? 'On' : 'Off';
  if (v.type === 'choice') return v.options?.[Math.round(value)] ?? String(value);
  return `${Number(value.toPrecision(6))}${v.unit ? ` ${v.unit}` : ''}`;
}

// ---- GLSL parameters ------------------------------------------------------------------------------------------------

const declaration = (name: string, type: 'float' | 'vec2') => new RegExp(`^[ \\t]*uniform\\s+(?:(?:lowp|mediump|highp)\\s+)?${type}\\s+${name}\\s*;[ \\t]*\\r?\\n?`, 'm');
/** Adds `uniform <type> <name>;` after the last uniform line, or after the precision line, or at the top. */
export function addUniformDeclaration(source: string, name: string, type: 'float' | 'vec2' = 'float'): string {
  if (declaration(name, type).test(source)) return source;
  const lines = source.split('\n'), line = `uniform ${type} ${name};`;
  let at = -1; lines.forEach((text, i) => { if (/^\s*uniform\s/.test(text)) at = i; });
  if (at < 0) lines.forEach((text, i) => { if (at < 0 && /^\s*precision\s/.test(text)) at = i; });
  lines.splice(at + 1, 0, line); return lines.join('\n');
}
export const removeUniformDeclaration = (source: string, name: string, type: 'float' | 'vec2' = 'float') => source.replace(declaration(name, type), '');
/** Renames an identifier as a whole word, declaration and uses alike. */
export const renameIdentifier = (source: string, from: string, to: string) => from === to ? source : source.replace(new RegExp(`\\b${from}\\b`, 'g'), to);
/** Whether the code still uses a name outside its declaration. */
export const usesIdentifier = (source: string, name: string) => new RegExp(`\\b${name}\\b`).test(removeUniformDeclaration(source, name));
/**
 * The new parameters and the code that declares them, in one patch: an added parameter is declared, a removed one
 * loses its declaration and a renamed one is renamed everywhere in the code.
 */
export function uniformsPatch(source: string, before: readonly GlslUniform[], after: readonly GlslUniform[], renamed: Readonly<Record<string, string>> = {}): { uniforms: GlslUniform[]; fragmentSource: string } {
  let code = source;
  for (const [from, to] of Object.entries(renamed)) code = renameIdentifier(code, from, to);
  const kept = new Set(after.map(u => u.name)), renamedTo = new Set(Object.values(renamed));
  for (const u of before) if (!kept.has(u.name) && !Object.hasOwn(renamed, u.name)) code = removeUniformDeclaration(code, u.name);
  for (const u of after) if (!before.some(b => b.name === u.name) && !renamedTo.has(u.name)) code = addUniformDeclaration(code, u.name);
  return { uniforms: after.map(u => ({ ...u })), fragmentSource: code };
}
/** Turning the canvas size or time on declares its uniform; turning it off removes the declaration. */
export function builtinsPatch(source: string, builtins: { resolution: boolean; time: boolean }): { builtins: { resolution: boolean; time: boolean }; fragmentSource: string } {
  let code = source;
  code = builtins.resolution ? addUniformDeclaration(code, 'u_resolution', 'vec2') : removeUniformDeclaration(code, 'u_resolution', 'vec2');
  code = builtins.time ? addUniformDeclaration(code, 'u_time', 'float') : removeUniformDeclaration(code, 'u_time', 'float');
  return { builtins, fragmentSource: code };
}
export function newUniform(taken: readonly GlslUniform[]): GlslUniform {
  let n = taken.length + 1; while (taken.some(u => u.name === `param${n}`)) n++;
  return { name: `param${n}`, label: `Parameter ${n}`, min: 0, max: 1, value: 0.5, step: 0.01 };
}
