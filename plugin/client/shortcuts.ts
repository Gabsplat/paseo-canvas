/**
 * Every keyboard shortcut in one place (docs/redesign-2026-10.md, "Shortcuts"). A shortcut is an id with a label,
 * default keys, a group and a `when`. The person's overrides win, then ours, then the ones extensions contribute
 * in the order they register. A combination already taken is not assigned: the loser is listed as unassigned.
 *
 * Combinations are lowercase strings joined by `+`, modifiers first in a fixed order: `mod` (⌘ on a Mac, Ctrl
 * elsewhere), `alt`, `shift`, then the key: `mod+shift+z`, `shift+1`, `[`, `?`, `delete`, `space`.
 */
export type ShortcutGroup = 'Tools' | 'Navigation' | 'Editing' | 'Extensions';
export type ShortcutWhen = 'always' | 'document' | 'canvas' | 'selection';
export type ShortcutDef = {
  id: string; label: string; group: ShortcutGroup; keys: readonly string[]; when?: ShortcutWhen;
  /** Who contributed it: `lienzo`, or an extension id. */
  source?: string;
  /** Shown but not reassignable (Space held for the hand). */
  fixed?: boolean;
};
export type Overrides = Readonly<Record<string, string>>;
export type ResolvedShortcut = ShortcutDef & { assigned: string[]; overridden: boolean; unassigned: boolean; conflictWith?: string };
export type KeyInput = { key: string; code?: string; shift: boolean; command: boolean; alt?: boolean };

const tool = (id: string, label: string, key: string): ShortcutDef => ({ id: `tool.${id}`, label, group: 'Tools', keys: [key], when: 'document' });
export const DEFAULT_SHORTCUTS: readonly ShortcutDef[] = [
  tool('select', 'Select', 'v'), tool('hand', 'Hand', 'h'), tool('pencil', 'Pencil', 'p'), tool('rectangle', 'Rectangle', 'r'),
  tool('ellipse', 'Ellipse', 'o'), tool('text', 'Text', 't'), tool('arrow', 'Arrow', 'a'), tool('eraser', 'Eraser', 'e'),
  tool('marco', 'Frame', 'm'), tool('ventana', 'Window', 'w'), tool('comment', 'Comment', 'c'),
  { id: 'lens.cycle', label: 'Next Lens', group: 'Tools', keys: ['l'], when: 'canvas' },
  { id: 'tool.space', label: 'Hand while held', group: 'Tools', keys: ['space'], when: 'canvas', fixed: true },
  ...Array.from({ length: 9 }, (_, i): ShortcutDef => ({ id: `pinned.${i + 1}`, label: `Pinned tool ${i + 1}`, group: 'Tools', keys: [String(i + 1)], when: 'document' })),
  { id: 'palette.open', label: 'Command palette', group: 'Navigation', keys: ['mod+k'], when: 'always' },
  { id: 'hoja.previous', label: 'Previous Sheet', group: 'Navigation', keys: ['['], when: 'document' },
  { id: 'hoja.next', label: 'Next Sheet', group: 'Navigation', keys: [']'], when: 'document' },
  { id: 'hoja.jump', label: 'Jump to Sheet', group: 'Navigation', keys: ['mod+j'], when: 'document' },
  { id: 'agent.follow', label: 'Follow the agent', group: 'Navigation', keys: ['f'], when: 'document' },
  { id: 'agent.latest', label: "Go to the agent's latest", group: 'Navigation', keys: ['g'], when: 'document' },
  { id: 'view.fitAll', label: 'Fit all', group: 'Navigation', keys: ['shift+1'], when: 'canvas' },
  { id: 'view.fitSelection', label: 'Fit selection', group: 'Navigation', keys: ['shift+2'], when: 'selection' },
  { id: 'panel.right', label: 'Properties panel', group: 'Navigation', keys: ['mod+\\'], when: 'document' },
  { id: 'ui.hide', label: 'Hide all UI', group: 'Navigation', keys: ['mod+.'], when: 'document' },
  { id: 'help.shortcuts', label: 'Keyboard shortcuts', group: 'Navigation', keys: ['?'], when: 'always' },
  { id: 'edit.undo', label: 'Undo', group: 'Editing', keys: ['mod+z'], when: 'document' },
  { id: 'edit.redo', label: 'Redo', group: 'Editing', keys: ['mod+shift+z'], when: 'document' },
  { id: 'edit.duplicate', label: 'Duplicate', group: 'Editing', keys: ['mod+d'], when: 'selection' },
  { id: 'edit.wrap', label: 'Wrap in a Frame', group: 'Editing', keys: ['mod+g'], when: 'selection' },
  { id: 'edit.unwrap', label: 'Unwrap Frame', group: 'Editing', keys: ['mod+shift+g'], when: 'selection' },
  { id: 'edit.delete', label: 'Delete', group: 'Editing', keys: ['delete', 'backspace'], when: 'selection' },
  { id: 'edit.escape', label: 'Deselect, cancel or close', group: 'Editing', keys: ['escape'], when: 'always', fixed: true },
  { id: 'edit.selectAll', label: 'Select all', group: 'Editing', keys: ['mod+a'], when: 'document' },
];
export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = ['Tools', 'Navigation', 'Editing', 'Extensions'];

const MODIFIERS = ['mod', 'alt', 'shift'] as const;
const NAMED: Record<string, string> = { ' ': 'space', spacebar: 'space', esc: 'escape', del: 'delete', arrowup: 'up', arrowdown: 'down', arrowleft: 'left', arrowright: 'right' };
/** One spelling for a combination: lowercase, modifiers in a fixed order, `cmd`/`ctrl`/`meta` read as `mod`. */
export function normalizeCombo(combo: string): string {
  const { mods, key } = splitCombo(combo.trim().toLowerCase());
  const set = new Set(mods.map(m => ['cmd', 'ctrl', 'meta', 'command', 'control'].includes(m) ? 'mod' : m === 'option' ? 'alt' : m));
  return [...MODIFIERS.filter(m => set.has(m)), NAMED[key] ?? key].join('+');
}
function splitCombo(text: string): { mods: string[]; key: string } {
  if (text === '+') return { mods: [], key: '+' };
  if (text.endsWith('++')) return { mods: text.slice(0, -2).split('+').filter(Boolean), key: '+' };
  const at = text.lastIndexOf('+');
  return { mods: at < 0 ? [] : text.slice(0, at).split('+').filter(Boolean), key: text.slice(at + 1) };
}
/**
 * The combination a key press spells. Letters and digits come from the physical key, so Shift+1 is `shift+1` on
 * every layout; a symbol is taken as typed, without the Shift that produced it (`?`, `[`, `\`).
 */
export function eventCombo(e: KeyInput): string | null {
  const raw = e.key ?? '', lower = raw.toLowerCase();
  if (['shift', 'control', 'meta', 'alt', 'os', 'capslock', 'dead', 'unidentified'].includes(lower)) return null;
  const digit = /^Digit(\d)$/.exec(e.code ?? '')?.[1] ?? /^Numpad(\d)$/.exec(e.code ?? '')?.[1];
  const letter = /^Key([A-Z])$/.exec(e.code ?? '')?.[1]?.toLowerCase();
  let key = digit ?? (lower.length === 1 && /[a-z]/.test(lower) ? lower : undefined) ?? (e.command && letter ? letter : undefined) ?? (NAMED[lower] ?? lower);
  if (e.code === 'Backslash' && e.command) key = '\\';
  if (e.code === 'Period' && e.command) key = '.';
  const symbol = key.length === 1 && !/[a-z0-9]/.test(key);
  return [...(e.command ? ['mod'] : []), ...(e.alt ? ['alt'] : []), ...(e.shift && !symbol ? ['shift'] : []), key].join('+');
}
/**
 * Who gets which combination. Overrides are claimed first, then defaults in registration order. A default whose
 * combination is already taken stays unassigned and says by whom. An override of `''` clears a shortcut.
 */
export function resolveShortcuts(defs: readonly ShortcutDef[], overrides: Overrides = {}): { list: ResolvedShortcut[]; byCombo: Map<string, string> } {
  const byCombo = new Map<string, string>(), known = new Set(defs.map(d => d.id)), assigned = new Map<string, string[]>(), lost = new Map<string, string>();
  for (const def of defs) assigned.set(def.id, []);
  for (const [id, raw] of Object.entries(overrides)) {
    const def = defs.find(d => d.id === id); if (!def || def.fixed || !known.has(id) || !raw) continue;
    const combo = normalizeCombo(raw); if (byCombo.has(combo)) { lost.set(id, byCombo.get(combo)!); continue; }
    byCombo.set(combo, id); assigned.get(id)!.push(combo);
  }
  for (const def of defs) {
    if (!def.fixed && overrideOf(overrides, def.id) !== undefined) continue;
    for (const raw of def.keys) {
      const combo = normalizeCombo(raw), owner = byCombo.get(combo);
      if (owner && owner !== def.id) { if (!assigned.get(def.id)!.length) lost.set(def.id, owner); continue; }
      byCombo.set(combo, def.id); assigned.get(def.id)!.push(combo); lost.delete(def.id);
    }
  }
  const list = defs.map(def => { const keys = assigned.get(def.id)!, conflictWith = keys.length ? undefined : lost.get(def.id);
    return { ...def, assigned: keys, overridden: !def.fixed && overrideOf(overrides, def.id) !== undefined, unassigned: !keys.length, ...(conflictWith ? { conflictWith } : {}) }; });
  return { list, byCombo };
}
const overrideOf = (overrides: Overrides, key: string) => Object.prototype.hasOwnProperty.call(overrides, key) ? overrides[key] : undefined;

/** The registry the panel and extensions share. Extensions register later through the same call. */
export class ShortcutRegistry {
  private defs: ShortcutDef[];
  private listeners = new Set<() => void>();
  constructor(defaults: readonly ShortcutDef[] = DEFAULT_SHORTCUTS) { this.defs = [...defaults]; }
  /** Adds shortcuts contributed from outside (an extension). Returns a function that removes them again. */
  register(defs: readonly ShortcutDef[]): () => void {
    const added = defs.filter(d => !this.defs.some(x => x.id === d.id)).map(d => ({ ...d, group: d.group ?? 'Extensions' }));
    this.defs.push(...added); this.emit();
    return () => { this.defs = this.defs.filter(d => !added.includes(d)); this.emit(); };
  }
  all(): readonly ShortcutDef[] { return this.defs; }
  resolve(overrides: Overrides = {}) { return resolveShortcuts(this.defs, overrides); }
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private emit() { this.listeners.forEach(l => l()); }
}

/** Display parts for one combination: `['⌘', 'K']` on a Mac, `['Ctrl', 'K']` elsewhere. */
export function comboParts(combo: string, mac: boolean): string[] {
  const names: Record<string, string> = { mod: mac ? '⌘' : 'Ctrl', alt: mac ? '⌥' : 'Alt', shift: mac ? '⇧' : 'Shift', escape: 'Esc', delete: mac ? '⌦' : 'Del', backspace: mac ? '⌫' : 'Backspace', space: 'Space', enter: '↵', up: '↑', down: '↓', left: '←', right: '→' };
  const { mods, key } = splitCombo(combo);
  return [...mods.map(p => names[p] ?? p), names[key] ?? (key.length === 1 ? key.toUpperCase() : key[0].toUpperCase() + key.slice(1))];
}
/** One combination as text: `⌘K`, `Ctrl+K`, `⇧1`, `P`. */
export function formatCombo(combo: string, mac: boolean): string { return comboParts(combo, mac).join(mac ? '' : '+'); }
/** Whether the shortcut applies right now. */
export function applies(when: ShortcutWhen | undefined, state: { document: boolean; canvas: boolean; selection: boolean }): boolean {
  return when === 'selection' ? state.document && state.selection : when === 'canvas' ? state.document && state.canvas : when === 'document' ? state.document : true;
}
/** The registry this client uses. Extensions (stage 3) add theirs with `shortcutRegistry.register(...)`. */
export const shortcutRegistry = new ShortcutRegistry();
