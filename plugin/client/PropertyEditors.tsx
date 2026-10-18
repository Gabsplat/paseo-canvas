// Properties for people: structured editors for block data and a Variables section for the Lienzo and its Frames.
// Every editor writes the same data the agent reads and writes through MCP; "Raw data (JSON)" keeps the whole object
// reachable. Data logic lives in property-model.ts.
import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Pressable, View } from 'react-native';
import { Icon } from './host';
import type { BlockType, CanvasBlock, CanvasDocument, CanvasOperation } from '../shared/model';
import { DOCUMENT_SCOPE, VARIABLE_TYPES, type ScopeVariable, type VariableType } from '../shared/learning';
import type { FileTreeData } from '../shared/renderers/file-tree';
import type { AnimatedFlowData, AnimatedFlowEvent } from '../shared/renderers/animated-flow';
import type { GlslShaderData, GlslUniform } from '../shared/renderers/glsl-shader';
import type { CanvasController } from './useCanvas';
import { Button, CheckRow, Field, IconButton, Input, Segments, Txt, friendlyError, useUI } from './ui';
import { NumberPropertyField } from './NumberPropertyField';
import { WebRange } from './web';
import { tokens } from './tokens';
import { isDark, withAlpha } from './color';
import { safeUrl } from './logic';
import {
  applyPatch, builtinsPatch, checklistItems, checklistRows, dataIssue, flowPayload, flowRoutes, hasValue, indentRow,
  insertTreeRow, move, moveTreeRow, newFlowEvent, newUniform, newVariable, oneLine, plainError, removeTreeRow, replacePatch, retypeVariable,
  scopeHolder, scopeVariables, scopesOf, secondsText, splitProperties, statusToneOf, suggestions, toMs, treeData, treeIssue, treeRows, uniformsPatch,
  usesIdentifier, variableIssue, variableName, variableOperations, variableTypeLabels, variableTypeOf, variableUsers, variableValueText, withOptions,
  type ChecklistRow, type Property, type TreeRow,
} from './property-model';

const P = tokens.face.properties;
type UI = ReturnType<typeof useUI>;
type Data = CanvasBlock['data'];
/** Saves a data patch as one labelled transaction; resolves to the new view, or undefined when it was not applied. */
export type SaveData = (patch: Record<string, unknown>, label: string) => Promise<unknown>;

// ---- Drafts and small parts ---------------------------------------------------------------------------------------

/**
 * A local copy that a person edits freely and that saves itself 600 ms after the last change (or at once for
 * structural actions). `check` refuses a draft in words before anything is sent. While a draft is dirty, changes from
 * elsewhere do not overwrite it; once saved, it follows the stored value again.
 */
export function useDraft<T>(value: T, save: (value: T) => unknown, options: { check?: (value: T) => string | null; delay?: number } = {}) {
  const [draft, setDraft] = useState(value), [status, setStatus] = useState({ pending: false, error: '' });
  const live = useRef({ draft: value, dirty: false, saving: false, save, check: options.check }); live.current.save = save; live.current.check = options.check;
  const key = JSON.stringify(value);
  useEffect(() => { if (!live.current.dirty) { live.current.draft = value; setDraft(value); } }, [key]);
  const commit = async (): Promise<void> => {
    const l = live.current; if (!l.dirty || l.saving) return;
    const submitted = l.draft, issue = l.check?.(submitted) ?? null;
    if (issue) { setStatus({ pending: false, error: issue }); return; }
    l.saving = true; setStatus({ pending: true, error: '' });
    try {
      const result = await l.save(submitted);
      if (result === undefined || result === false) throw new Error('The change was not applied.');
      if (live.current.draft === submitted) live.current.dirty = false;
      setStatus({ pending: false, error: '' });
    } catch (error) { setStatus({ pending: false, error: friendlyError(error) }); }
    finally { live.current.saving = false; if (live.current.dirty && live.current.draft !== submitted) void commit(); }
  };
  useEffect(() => { if (!live.current.dirty) return; const timer = setTimeout(() => { void commit(); }, options.delay ?? 600); return () => clearTimeout(timer); }, [draft]);
  useEffect(() => () => { void commit(); }, []);
  const set = (next: T, now = false) => { live.current.draft = next; live.current.dirty = true; setDraft(next); setStatus(s => s.error ? { ...s, error: '' } : s); if (now) void commit(); };
  return { draft, set, commit, pending: status.pending, error: status.error };
}
function SaveState({ pending, error, onRetry }: { pending: boolean; error: string; onRetry?(): void }) {
  const u = useUI();
  if (error) return <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}><Txt kind="small" accessibilityLiveRegion="polite" style={{ color: u.c.statusDanger, flexShrink: 1 }}>Not saved · {error}</Txt>{onRetry && <Button label="Retry" small variant="ghost" onPress={onRetry} />}</View>;
  return pending ? <Txt kind="small" muted>Saving…</Txt> : null;
}
function Label({ text, help, trailing }: { text: string; help?: string; trailing?: React.ReactNode }) {
  return <View style={{ gap: 2 }}><View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><Txt kind="small" style={{ fontWeight: '600', flex: 1 }}>{text}</Txt>{trailing}</View>{!!help && <Txt kind="small" muted>{help}</Txt>}</View>;
}
/** A folding row: "More options", "Raw data (JSON)". Closed by default; it says how much it holds. */
export function Disclosure({ label, count, children, defaultOpen = false, nativeID }: { label: string; count?: number; children: React.ReactNode; defaultOpen?: boolean; nativeID?: string }) {
  const u = useUI(), [open, setOpen] = useState(defaultOpen);
  return <View nativeID={nativeID} style={{ gap: 8 }}>
    <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ expanded: open }} onPress={e => { e.stopPropagation(); setOpen(v => !v); }}
      style={({ pressed, ...state }) => ({ minHeight: u.compact ? 44 : P.disclosure, marginHorizontal: -6, paddingHorizontal: 6, borderRadius: P.rowRadius, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: pressed ? withAlpha(u.c.foreground, .08) : (state as { hovered?: boolean }).hovered ? withAlpha(u.c.foreground, .04) : 'transparent' })}>
      <Icon name={open ? 'ChevronDown' : 'ChevronRight'} size={12} color={u.c.foregroundMuted} />
      <Txt kind="small" muted style={{ flex: 1, fontWeight: '600' }}>{label}</Txt>
      {count !== undefined && count > 0 && <Txt kind="label" muted>{count}</Txt>}
    </Pressable>
    {open && <View style={{ gap: 12 }}>{children}</View>}
  </View>;
}
function Mini({ icon, label, onPress, disabled, active, danger }: { icon: string; label: string; onPress(): void; disabled?: boolean; active?: boolean; danger?: boolean }) {
  const u = useUI();
  if (danger) return <Pressable accessibilityRole="button" accessibilityLabel={label} disabled={disabled} onPress={e => { e.stopPropagation(); onPress(); }} hitSlop={4} style={({ pressed }) => ({ width: u.compact ? 44 : P.iconButton, height: u.compact ? 44 : P.iconButton, borderRadius: P.rowRadius, alignItems: 'center', justifyContent: 'center', opacity: disabled ? .4 : 1, backgroundColor: pressed ? withAlpha(u.c.statusDanger, .14) : 'transparent' })}><Icon name={icon} size={14} color={u.c.statusDanger} /></Pressable>;
  return <IconButton icon={icon} label={label} onPress={onPress} disabled={disabled} active={active} size={P.iconButton} />;
}
const rowInput = (u: UI) => ({ height: u.compact ? 44 : P.row, paddingVertical: 0 });
/** A number typed in a small box. Keeps what is typed until it is a number; reports numbers only. */
function NumberBox({ value, onChange, label, disabled, width = 64, unit }: { value: number; onChange(n: number): void; label: string; disabled?: boolean; width?: number; unit?: string }) {
  const u = useUI(), [text, setText] = useState(String(value)), focused = useRef(false);
  useEffect(() => { if (!focused.current) setText(String(value)); }, [value]);
  return <View style={{ gap: 2, width }}><Txt kind="label" muted numberOfLines={1}>{label}{unit ? ` (${unit})` : ''}</Txt>
    <Input label={label} value={text} readOnly={disabled} mono style={[rowInput(u), { paddingHorizontal: 8 }]} onChange={next => { focused.current = true; setText(next); const n = Number(next.replace(',', '.')); if (next.trim() !== '' && Number.isFinite(n)) onChange(n); }} onBlur={() => { focused.current = false; setText(String(value)); }} />
  </View>;
}
/** A list that opens in place under its trigger, so it never clips in the panel's scroll. */
function Picker({ label, value, options, onChange, placeholder = 'Choose…', disabled, nativeID }: { label: string; value?: string; options: readonly { value: string; label: string; detail?: string }[]; onChange(value: string): void; placeholder?: string; disabled?: boolean; nativeID?: string }) {
  const u = useUI(), [open, setOpen] = useState(false), current = options.find(o => o.value === value);
  return <View style={{ gap: 4 }}>
    <Pressable nativeID={nativeID} accessibilityRole="button" accessibilityLabel={`${label}: ${current?.label ?? placeholder}`} accessibilityState={{ expanded: open, disabled: !!disabled }} disabled={disabled} onPress={e => { e.stopPropagation(); setOpen(v => !v); }}
      style={({ pressed }) => ({ minHeight: u.compact ? 44 : P.row, paddingHorizontal: 8, borderRadius: P.rowRadius, borderWidth: 1, borderColor: open ? u.c.accent : u.c.border, backgroundColor: pressed ? u.c.surface1 : u.c.surface2, flexDirection: 'row', alignItems: 'center', gap: 6, opacity: disabled ? .45 : 1 })}>
      <Txt numberOfLines={1} muted={!current} style={{ flex: 1 }}>{current?.label ?? placeholder}</Txt><Icon name={open ? 'ChevronUp' : 'ChevronDown'} size={12} color={u.c.foregroundMuted} />
    </Pressable>
    {open && <View accessibilityRole="menu" style={{ borderRadius: P.rowRadius, borderWidth: 1, borderColor: u.c.border, backgroundColor: u.c.surface1, padding: 2, maxHeight: P.maxListHeight, overflow: 'hidden' }}>
      {!options.length && <Txt kind="small" muted style={{ padding: 8 }}>Nothing to choose yet.</Txt>}
      {options.map(o => <Pressable key={o.value} accessibilityRole="menuitem" accessibilityLabel={o.label} accessibilityState={{ selected: o.value === value }} onPress={e => { e.stopPropagation(); setOpen(false); onChange(o.value); }}
        style={({ pressed, ...state }) => ({ minHeight: u.compact ? 44 : P.row, paddingHorizontal: 8, paddingVertical: 4, borderRadius: P.rowRadius - 2, justifyContent: 'center', backgroundColor: o.value === value ? withAlpha(u.c.accent, .12) : pressed ? withAlpha(u.c.foreground, .1) : (state as { hovered?: boolean }).hovered ? withAlpha(u.c.foreground, .05) : 'transparent' })}>
        <Txt numberOfLines={1}>{o.label}</Txt>{!!o.detail && <Txt kind="small" muted numberOfLines={1}>{o.detail}</Txt>}
      </Pressable>)}
    </View>}
  </View>;
}
function Swatch({ color, shape = 'circle' }: { color: string; shape?: string }) {
  return <View style={{ width: P.dot, height: P.dot, borderRadius: shape === 'square' ? 2 : P.dot / 2, backgroundColor: shape === 'ring' ? 'transparent' : color, borderWidth: shape === 'ring' ? 2 : 0, borderColor: color, transform: shape === 'diamond' ? [{ rotate: '45deg' }] : undefined }} />;
}
/** A shared value keeps one colour and shape wherever it shows, by its place in the declarations (§18.3). */
export function seriesMark(u: UI, index: number) {
  const s = tokens.viz.series[index % tokens.viz.series.length]; return { color: isDark(u.c.surface0) ? s.dark : s.light, shape: s.shape };
}

// ---- Fields with choices ---------------------------------------------------------------------------------------------

/** Text with suggestions: chips under the field while it is in use. Any other text can still be typed. */
function ChoiceField({ label, help, value, options, save, disabled, mono, labels, required }: { label: string; help?: string; value: string; options: readonly string[]; save(value: string): Promise<unknown>; disabled?: boolean; mono?: boolean; labels?: Readonly<Record<string, string>>; required?: boolean }) {
  const u = useUI(), d = useDraft(value, next => save(next)), [focused, setFocused] = useState(false), hide = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const query = d.draft.trim().toLowerCase(), exact = options.some(o => o.toLowerCase() === query);
  // Few options are always shown; many show while the field is in use, narrowed by what is typed.
  const chips = options.length <= 6 ? options : focused ? (query && !exact ? options.filter(o => o.toLowerCase().includes(query)) : options).slice(0, 12) : [];
  return <View style={{ gap: 6 }}>
    <Label text={label + (required && !value ? ' *' : '')} help={help} />
    <Input label={label} value={d.draft} readOnly={disabled} mono={mono} placeholder={options.length ? `${labels?.[options[0]] ?? options[0]}, or anything` : undefined} onChange={next => d.set(oneLine(next))} onFocus={() => { clearTimeout(hide.current); setFocused(true); }} onBlur={() => { hide.current = setTimeout(() => setFocused(false), 180); void d.commit(); }} />
    {chips.length > 0 && <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>{chips.map(option => { const on = option.toLowerCase() === d.draft.trim().toLowerCase(); return <Pressable key={option} accessibilityRole="button" accessibilityLabel={labels?.[option] ?? option} accessibilityState={{ selected: on, disabled: !!disabled }} disabled={disabled} onPress={e => { e.stopPropagation(); d.set(on ? '' : option, true); }}
      style={({ pressed }) => ({ minHeight: u.compact ? 36 : 24, paddingHorizontal: 8, borderRadius: tokens.radius.pill, justifyContent: 'center', borderWidth: 1, borderColor: on ? u.c.accent : u.c.border, backgroundColor: on ? withAlpha(u.c.accent, .14) : pressed ? withAlpha(u.c.foreground, .08) : 'transparent', opacity: disabled ? .45 : 1 })}>
      <Txt kind={mono ? 'code' : 'small'} style={{ color: on ? u.c.accent : u.c.foreground }}>{labels?.[option] ?? option}</Txt></Pressable>; })}</View>}
    <SaveState pending={d.pending} error={d.error} onRetry={() => { void d.commit(); }} />
  </View>;
}
/** Status as coloured chips; "Other" takes any word, which still colours itself when it is a known one. */
function StatusField({ property, value, save, disabled }: { property: Property; value: string; save(value: string | null): Promise<unknown>; disabled?: boolean }) {
  const u = useUI(), options = property.options ?? [], known = !value || options.some(o => o.toLowerCase() === value.toLowerCase()), [other, setOther] = useState(!known);
  useEffect(() => { if (!known) setOther(true); }, [known]);
  const chip = (label: string, on: boolean, press: () => void, tone = statusToneOf(label)) => <Pressable key={label} accessibilityRole="radio" accessibilityLabel={label} accessibilityState={{ checked: on, disabled: !!disabled }} disabled={disabled} onPress={e => { e.stopPropagation(); press(); }}
    style={({ pressed }) => ({ minHeight: u.compact ? 36 : 26, paddingHorizontal: 9, borderRadius: tokens.radius.pill, flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: on ? tone === 'neutro' ? u.c.foregroundMuted : u.tone(tone) : u.c.border, backgroundColor: on ? u.wash(tone) : pressed ? withAlpha(u.c.foreground, .08) : 'transparent', opacity: disabled ? .45 : 1 })}>
    {label !== 'None' && label !== 'Other…' && <Swatch color={tone === 'neutro' ? u.c.foregroundMuted : u.tone(tone)} />}<Txt kind="small" style={{ fontWeight: on ? '600' : '400' }}>{label}</Txt></Pressable>;
  return <View style={{ gap: 6 }}>
    <Label text={property.label} help={property.help ?? 'The chip on the card. Its colour comes from the word.'} />
    <View accessibilityRole="radiogroup" accessibilityLabel={property.label} style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 4 }}>
      {chip('None', !value && !other, () => { setOther(false); if (value) void save(null); }, 'neutro')}
      {options.map(option => chip(option, !other && option.toLowerCase() === value.toLowerCase(), () => { setOther(false); void save(option); }))}
      {chip('Other…', other, () => setOther(true), 'neutro')}
    </View>
    {other && <Field label="Other status" hideLabel value={known ? '' : value} placeholder="A word, such as Paused" disabled={disabled} onSave={next => save(oneLine(next).trim() || null)} />}
  </View>;
}
/** A duration stored in milliseconds, shown and typed in seconds, with a slider over a sensible range. */
function SecondsField({ label, help, ms, save, disabled, min, max, id }: { label: string; help?: string; ms: number; save(ms: number): Promise<unknown>; disabled?: boolean; min: number; max: number; id: string }) {
  const u = useUI(), d = useDraft(ms, next => save(next), { check: next => next < min || next > max ? `${label} goes from ${secondsText(min)} to ${secondsText(max)} s.` : null });
  const sliderMax = Math.max(Math.min(max, 60_000), d.draft);
  return <View style={{ gap: 4 }}>
    <Label text={label} help={help} />
    <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 8 }}>
      <View style={{ flex: 1, paddingBottom: 6 }}><WebRange id={`seconds-${id}`} label={label} min={min} max={sliderMax} step={min < 1000 ? 50 : 500} value={d.draft} disabled={!!disabled} color={u.c.accent} onChange={value => d.set(value)} onSettle={value => d.set(value, true)} /></View>
      <NumberBox label="Seconds" value={Number(secondsText(d.draft))} disabled={disabled} width={72} onChange={seconds => d.set(toMs(seconds))} />
    </View>
    <SaveState pending={d.pending} error={d.error} onRetry={() => { void d.commit(); }} />
  </View>;
}

// ---- Checklist --------------------------------------------------------------------------------------------------------

function Tick({ done, label, onPress, disabled }: { done: boolean; label: string; onPress(): void; disabled?: boolean }) {
  const u = useUI(), tone = u.tone('exito');
  return <Pressable accessibilityRole="checkbox" accessibilityLabel={label} accessibilityState={{ checked: done, disabled: !!disabled }} disabled={disabled} hitSlop={6} onPress={e => { e.stopPropagation(); onPress(); }} style={{ width: u.compact ? 32 : 20, height: u.compact ? 32 : 20, alignItems: 'center', justifyContent: 'center' }}>
    <View style={{ width: 16, height: 16, borderRadius: 4, borderWidth: 1.5, borderColor: done ? tone : withAlpha(u.c.foregroundMuted, tokens.alpha.glyphRing), backgroundColor: done ? tone : 'transparent', alignItems: 'center', justifyContent: 'center' }}>{done && <Icon name="Check" size={12} color={u.c.surface1} />}</View>
  </Pressable>;
}
export function ChecklistEditor({ value, save, disabled }: { value: unknown; save(items: unknown): Promise<unknown>; disabled?: boolean }) {
  const u = useUI(), d = useDraft<ChecklistRow[]>(checklistRows(value), rows => save(checklistItems(rows)), { check: rows => rows.length > 200 ? 'At most 200 items.' : rows.some(r => r.label.length > 2000) ? 'An item is over 2000 characters.' : null });
  const [active, setActive] = useState(-1), [adding, setAdding] = useState('');
  const rows = d.draft, done = rows.filter(r => r.done).length;
  const add = () => { const label = oneLine(adding).trim(); if (!label) return; d.set([...rows, { label, done: false }], true); setAdding(''); };
  return <View nativeID="lienzo-properties-checklist" style={{ gap: 6 }}>
    <Label text="Items" trailing={rows.length ? <Txt kind="label" muted>{done} of {rows.length} done</Txt> : undefined} />
    <View style={{ gap: P.rowGap }}>{rows.map((row, i) => <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, borderRadius: P.rowRadius, paddingLeft: 2, backgroundColor: active === i ? withAlpha(u.c.foreground, P.activeAlpha) : 'transparent' }}>
      <Tick done={row.done} label={`Done: ${row.label || 'item ' + (i + 1)}`} disabled={disabled} onPress={() => d.set(rows.map((r, j) => j === i ? { ...r, done: !r.done } : r), true)} />
      <View style={{ flex: 1 }}><Input onFocus={() => setActive(i)} label={`Item ${i + 1}`} value={row.label} readOnly={disabled} style={[rowInput(u), { backgroundColor: 'transparent', borderColor: active === i ? u.c.border : 'transparent' }, row.done && { textDecorationLine: 'line-through', color: u.c.foregroundMuted }]} onChange={label => d.set(rows.map((r, j) => j === i ? { ...r, label: oneLine(label) } : r))} onBlur={() => { void d.commit(); }} /></View>
      {active === i && <><Mini icon="ArrowUp" label="Move up" disabled={disabled || i === 0} onPress={() => { d.set(move(rows, i, -1), true); setActive(i - 1); }} /><Mini icon="ArrowDown" label="Move down" disabled={disabled || i === rows.length - 1} onPress={() => { d.set(move(rows, i, 1), true); setActive(i + 1); }} /><Mini icon="X" label="Remove item" danger disabled={disabled} onPress={() => { d.set(rows.filter((_, j) => j !== i), true); setActive(-1); }} /></>}
    </View>)}</View>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
      <Icon name="Plus" size={14} color={u.c.foregroundMuted} />
      <View style={{ flex: 1 }}><Input label="Add an item" placeholder="Add an item and press Enter" value={adding} readOnly={disabled} style={rowInput(u)} onChange={setAdding} onBlur={add} onSubmit={add} /></View>
    </View>
    <SaveState pending={d.pending} error={d.error} onRetry={() => { void d.commit(); }} />
  </View>;
}

// ---- File tree --------------------------------------------------------------------------------------------------------

export function FileTreeEditor({ data, document, selfId, save, disabled }: { data: Partial<FileTreeData>; document: CanvasDocument; selfId: string; save(patch: Record<string, unknown>): Promise<unknown>; disabled?: boolean }) {
  const u = useUI(), d = useDraft<TreeRow[]>(treeRows(data), rows => { const next = treeData(rows); return save({ entries: next.entries, collapsed: next.collapsed ?? null }); }, { check: treeIssue });
  const [active, setActive] = useState(-1), rows = d.draft, row = rows[active];
  const set = (next: TreeRow[], now = true, focus = active) => { d.set(next, now); setActive(focus); };
  const patchRow = (i: number, patch: Partial<TreeRow>, now = false) => d.set(rows.map((r, j) => j === i ? { ...r, ...patch } : r), now);
  const cards = [...document.blocks.filter(b => b.id !== selfId), ...document.groups].map(e => ({ value: e.id, label: e.title || 'Untitled', detail: 'groupIds' in e ? 'Frame' : undefined }));
  const add = (dir: boolean) => { const result = insertTreeRow(rows, active, dir); set(result.rows, true, result.index); };
  return <View nativeID="lienzo-properties-file-tree" style={{ gap: 6 }}>
    <Label text="Files and folders" help="Press a row to edit it. Indent puts it inside the folder above." />
    <View style={{ gap: P.rowGap }}>{rows.map((r, i) => {
      const holds = i + 1 < rows.length && rows[i + 1].depth > r.depth, on = active === i;
      return <View key={i} style={{ borderRadius: P.rowRadius, backgroundColor: on ? withAlpha(u.c.foreground, P.activeAlpha) : 'transparent', paddingVertical: on ? 4 : 0, gap: 4 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2, paddingLeft: 2 + r.depth * P.indent }}>
          <Mini icon={r.dir ? r.closed ? 'Folder' : 'FolderOpen' : 'File'} label={r.dir ? holds ? 'Folder (holds files)' : 'Folder: make it a file' : 'File: make it a folder'} disabled={disabled || holds} onPress={() => { setActive(i); patchRow(i, { dir: !r.dir, closed: undefined }, true); }} />
          <View style={{ flex: 1 }}><Input onFocus={() => setActive(i)} label={`Name of ${r.name || 'entry ' + (i + 1)}`} value={r.name} mono readOnly={disabled} style={[rowInput(u), { backgroundColor: 'transparent', borderColor: on ? u.c.border : 'transparent', fontWeight: r.dir || r.highlight ? '600' : '400', color: r.highlight ? u.c.accent : r.muted ? u.c.foregroundMuted : u.c.foreground }]} onChange={name => patchRow(i, { name: oneLine(name) })} onBlur={() => { void d.commit(); }} /></View>
          {!on && !!r.note && <Txt kind="small" muted numberOfLines={1} style={{ maxWidth: '40%' }}>{r.note}</Txt>}
          {!on && <Mini icon="ChevronRight" label={`Edit ${r.name}`} onPress={() => setActive(i)} />}
        </View>
        {on && <View style={{ paddingLeft: 2 + r.depth * P.indent + P.iconButton + 2, paddingRight: 4, gap: 6 }}>
          <Input label={`Note on ${r.name}`} placeholder="What it is for, in a few words" value={r.note ?? ''} readOnly={disabled} style={rowInput(u)} onChange={note => patchRow(i, { note: oneLine(note) })} onBlur={() => { void d.commit(); }} />
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 2, alignItems: 'center' }}>
            <Mini icon="IndentDecrease" label="Outdent" disabled={disabled || r.depth === 0} onPress={() => set(indentRow(rows, i, -1))} />
            <Mini icon="IndentIncrease" label="Indent: put it inside the folder above" disabled={disabled || i === 0 || rows[i - 1].depth < r.depth} onPress={() => set(indentRow(rows, i, 1))} />
            <Mini icon="ArrowUp" label="Move up" disabled={disabled} onPress={() => { const next = moveTreeRow(rows, i, -1); set(next.rows, true, next.index); }} />
            <Mini icon="ArrowDown" label="Move down" disabled={disabled} onPress={() => { const next = moveTreeRow(rows, i, 1); set(next.rows, true, next.index); }} />
            <Mini icon="Star" label={r.highlight ? 'Highlighted: the explanation is about it' : 'Highlight'} active={!!r.highlight} disabled={disabled} onPress={() => patchRow(i, { highlight: !r.highlight || undefined }, true)} />
            <Mini icon="EyeOff" label={r.muted ? 'Muted: beside the point' : 'Mute: generated, ignored or vendored'} active={!!r.muted} disabled={disabled} onPress={() => patchRow(i, { muted: !r.muted || undefined }, true)} />
            {r.dir && <Mini icon="FolderClosed" label={r.closed ? 'Starts closed' : 'Start closed'} active={!!r.closed} disabled={disabled} onPress={() => patchRow(i, { closed: !r.closed || undefined }, true)} />}
            <View style={{ flex: 1 }} />
            <Mini icon="Trash2" label={holds ? `Remove ${r.name} and what it holds` : `Remove ${r.name}`} danger disabled={disabled || rows.length <= 1} onPress={() => set(removeTreeRow(rows, i), true, -1)} />
          </View>
          <Picker label="Opens card" placeholder="Opens no card" value={r.ref} disabled={disabled} options={[{ value: '', label: 'Opens no card' }, ...cards]} onChange={ref => patchRow(i, { ref: ref || undefined }, true)} />
        </View>}
      </View>;
    })}</View>
    <View style={{ flexDirection: 'row', gap: 6 }}><Button label="File" icon="FilePlus" small disabled={disabled} onPress={() => add(false)} /><Button label="Folder" icon="FolderPlus" small disabled={disabled} onPress={() => add(true)} />{row && <Txt kind="small" muted style={{ flex: 1, alignSelf: 'center' }} numberOfLines={1}>after {row.name}</Txt>}</View>
    <SaveState pending={d.pending} error={d.error} onRetry={() => { void d.commit(); }} />
  </View>;
}

// ---- Variables --------------------------------------------------------------------------------------------------------

/** One declaration, edited in place: what it is called, its type, its range or choices and where it starts. */
export function VariableForm({ variable, siblings, save, remove, users, current, resetCurrent, disabled, id }: { variable: ScopeVariable; siblings: readonly ScopeVariable[]; save(next: ScopeVariable, from: string): Promise<unknown>; remove(): void; users: number; current?: number; resetCurrent?(): void; disabled?: boolean; id: string }) {
  const u = useUI(), d = useDraft(variable, next => save(next, variable.name), { check: next => variableIssue(next, siblings) }), v = d.draft, type = variableTypeOf(v);
  const auto = useRef(variable.name === variableName(variable.label ?? '', []) || /^(value|switch|choice)(_\d+)?$/.test(variable.name));
  const setLabel = (label: string) => d.set({ ...v, label, ...(auto.current ? { name: variableName(label, siblings.map(s => s.name)) } : {}) });
  const options = v.options ?? [];
  return <View nativeID={`lienzo-variable-${id}`} style={{ gap: 10 }}>
    <View style={{ gap: 2 }}><Txt kind="label" muted>Label</Txt><Input label="Variable label" value={v.label ?? ''} placeholder={v.name} readOnly={disabled} style={rowInput(u)} onChange={label => setLabel(oneLine(label).slice(0, 200))} /></View>
    <View style={{ gap: 4 }}><Label text="Type" /><Segments value={type} disabled={disabled} options={VARIABLE_TYPES.map(t => ({ value: t, label: variableTypeLabels[t] }))} onChange={next => d.set(retypeVariable(v, next), true)} /></View>
    {type === 'number' && <>
      <View style={{ flexDirection: 'row', gap: 6 }}>
        <NumberBox label="Lowest" value={v.min} disabled={disabled} width={60} onChange={min => d.set({ ...v, min, value: Math.max(min, v.value) })} />
        <NumberBox label="Highest" value={v.max} disabled={disabled} width={60} onChange={max => d.set({ ...v, max, value: Math.min(max, v.value) })} />
        <NumberBox label="Step" value={v.step ?? 0} disabled={disabled} width={52} onChange={step => d.set(step > 0 ? { ...v, step } : (({ step: _s, ...rest }) => rest)(v))} />
        <View style={{ flex: 1, gap: 2 }}><Txt kind="label" muted>Unit</Txt><Input label="Unit" value={v.unit ?? ''} placeholder="km/h" readOnly={disabled} style={[rowInput(u), { paddingHorizontal: 8 }]} onChange={unit => d.set(unit.trim() ? { ...v, unit: oneLine(unit).slice(0, 40) } : (({ unit: _u, ...rest }) => rest)(v))} /></View>
      </View>
      <View style={{ gap: 2 }}><Label text="Starts at" trailing={<Txt kind="code">{variableValueText(v, v.value)}</Txt>} />
        {v.min < v.max && <WebRange id={`variable-${id}`} label={`${v.label ?? v.name}: starts at`} min={v.min} max={v.max} step={v.step ?? 'any'} value={v.value} disabled={!!disabled} color={u.c.accent} onChange={value => d.set({ ...v, value })} onSettle={value => d.set({ ...v, value }, true)} />}
      </View>
    </>}
    {type === 'boolean' && <CheckRow label="Starts on" checked={v.value === 1} disabled={disabled} onPress={() => d.set({ ...v, value: v.value ? 0 : 1 }, true)} />}
    {type === 'choice' && <View style={{ gap: 4 }}>
      <Label text="Choices" help="The first one is 0, the next 1, and so on: that number is what blocks and shaders get." />
      {options.map((option, i) => <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <Pressable accessibilityRole="radio" accessibilityLabel={`Start at ${option}`} accessibilityState={{ checked: v.value === i }} disabled={disabled} onPress={() => d.set({ ...v, value: i }, true)} style={{ width: 20, height: 20, alignItems: 'center', justifyContent: 'center' }}><View style={{ width: 14, height: 14, borderRadius: 7, borderWidth: 1.5, borderColor: v.value === i ? u.c.accent : u.c.foregroundMuted, alignItems: 'center', justifyContent: 'center' }}>{v.value === i && <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: u.c.accent }} />}</View></Pressable>
        <View style={{ flex: 1 }}><Input label={`Choice ${i + 1}`} value={option} readOnly={disabled} style={rowInput(u)} onChange={text => d.set(withOptions(v, options.map((o, j) => j === i ? oneLine(text).slice(0, 60) : o)))} /></View>
        <Mini icon="X" label={`Remove ${option}`} danger disabled={disabled || options.length <= 2} onPress={() => d.set(withOptions(v, options.filter((_, j) => j !== i)), true)} />
      </View>)}
      <Button label="Add a choice" icon="Plus" small variant="ghost" disabled={disabled || options.length >= 12} style={{ alignSelf: 'flex-start' }} onPress={() => { let n = options.length + 1; while (options.includes(`Choice ${n}`)) n++; d.set(withOptions(v, [...options, `Choice ${n}`]), true); }} />
    </View>}
    <View style={{ gap: 2 }}><Txt kind="label" muted>Name in code</Txt><Input label="Name in code" value={v.name} mono readOnly={disabled} style={rowInput(u)} onChange={name => { auto.current = false; d.set({ ...v, name: name.replace(/\s+/g, '_') }); }} /><Txt kind="small" muted>{users ? `Shown by ${users} ${users === 1 ? 'Controls block' : 'Controls blocks'}; renaming keeps them. ` : ''}A shader parameter with this name uses it too.</Txt></View>
    {current !== undefined && current !== v.value && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><Txt kind="small" muted style={{ flex: 1 }}>Now at {variableValueText(v, current)}, moved by a control.</Txt>{resetCurrent && <Button label="Back to start" small variant="ghost" icon="RotateCcw" disabled={disabled} onPress={resetCurrent} />}</View>}
    <SaveState pending={d.pending} error={d.error} onRetry={() => { void d.commit(); }} />
    <Button label="Delete variable" icon="Trash2" small variant="danger" disabled={disabled} style={{ alignSelf: 'flex-start' }} onPress={remove} />
  </View>;
}
/**
 * Editing stays open while an earlier change is still saving: edits queue in order, so typing never freezes the field.
 * Only an offline or loading Lienzo (or a reason other than being busy) turns the editors off.
 */
export const editorsOff = (c: CanvasController, disabled?: boolean) => !!disabled && (c.offline || c.loading || !c.busy);
function useRuntime(c: CanvasController) { return useSyncExternalStore(c.learning.subscribe, c.learning.getSnapshot, c.learning.getSnapshot); }
const controlsTypesOf = (c: CanvasController) => new Set((c.catalog?.blockTypes ?? []).filter(t => t.renderer === 'controls').map(t => t.id));
/** The writes for one declaration: replace it (renaming follows Controls) or drop it. */
function scopeEdit(c: CanvasController, scopeId: string, from: string, next: ScopeVariable | null, label: string) {
  const doc = c.current.current?.document ?? c.view!.document, list = scopeVariables(doc, scopeId), index = list.findIndex(v => v.name === from);
  if (index < 0) throw plainError('That variable changed. Open it again.');
  const variables = next ? list.map((v, i) => i === index ? next : v) : list.filter((_, i) => i !== index);
  return c.edit(variableOperations(doc, scopeId, variables, { [from]: next ? next.name : null }, controlsTypesOf(c)), label);
}
function VariableRow({ c, scopeId, variable, index, open, onToggle, disabled }: { c: CanvasController; scopeId: string; variable: ScopeVariable; index: number; open: boolean; onToggle(): void; disabled?: boolean }) {
  const u = useUI(), runtime = useRuntime(c), doc = c.view!.document, mark = seriesMark(u, index), current = runtime.scopes[scopeId]?.[variable.name];
  const holder = scopeHolder(doc, scopeId, variable.name), users = variableUsers(doc, scopeId, variable.name, controlsTypesOf(c)).length, siblings = scopeVariables(doc, scopeId).filter(v => v.name !== variable.name);
  return <View style={{ borderRadius: P.rowRadius, borderWidth: 1, borderColor: open ? u.c.border : 'transparent', backgroundColor: open ? withAlpha(u.c.foreground, P.activeAlpha / 2) : 'transparent' }}>
    <Pressable accessibilityRole="button" accessibilityLabel={`${variable.label || variable.name}, ${variableTypeLabels[variableTypeOf(variable)]}`} accessibilityState={{ expanded: open }} onPress={e => { e.stopPropagation(); onToggle(); }}
      style={({ pressed }) => ({ minHeight: u.compact ? 44 : P.row + 4, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: P.rowRadius, backgroundColor: pressed ? withAlpha(u.c.foreground, .08) : 'transparent' })}>
      <Swatch color={mark.color} shape={mark.shape} />
      <View style={{ flex: 1, minWidth: 0 }}><Txt numberOfLines={1}>{variable.label || variable.name}</Txt><Txt kind="small" muted numberOfLines={1}>{variableTypeOf(variable) === 'number' ? `${variable.min} to ${variable.max}${variable.unit ? ' ' + variable.unit : ''}` : variableTypeLabels[variableTypeOf(variable)]}{users ? ` · in ${users} Controls` : ''}</Txt></View>
      <Txt kind="code" muted={current === undefined}>{variableValueText(variable, current ?? variable.value)}</Txt>
      <Icon name={open ? 'ChevronDown' : 'ChevronRight'} size={12} color={u.c.foregroundMuted} />
    </Pressable>
    {open && <View style={{ padding: 8, paddingTop: 2 }}><VariableForm id={`${scopeId}-${variable.name}`} variable={variable} siblings={siblings} users={users} current={current} disabled={disabled}
      resetCurrent={holder ? () => { try { c.learning.setVariable(holder, variable.name, null, true); } catch (error) { c.fail(error); } } : undefined}
      save={(next, from) => scopeEdit(c, scopeId, from, next, from === next.name ? 'Edit variable' : 'Rename variable')} remove={() => { void scopeEdit(c, scopeId, variable.name, null, 'Delete variable').catch(c.fail); }} /></View>}
  </View>;
}
/**
 * The Variables section of the Lienzo or of a Frame: every shared value declared there, as rows a person opens to
 * edit, and "Add a variable". Controls show them; a shader parameter with the same name uses them.
 */
export function VariablesEditor({ controller: c, scopeId, disabled: blocked }: { controller: CanvasController; scopeId: string; disabled?: boolean }) {
  const disabled = editorsOff(c, blocked);
  const u = useUI(), doc = c.view!.document, list = scopeVariables(doc, scopeId), [open, setOpen] = useState<string | null>(null);
  const add = (type: VariableType) => {
    const taken = [...doc.variables ?? [], ...doc.groups.flatMap(g => g.variables ?? [])].map(v => v.name), variable = newVariable(type, taken);
    if (list.length >= 24) { c.fail(plainError('At most 24 variables here.')); return; }
    void c.edit(variableOperations(doc, scopeId, [...list, variable], {}, controlsTypesOf(c)), 'Add variable').then(next => { if (next) setOpen(variable.name); });
  };
  return <View nativeID={`lienzo-variables-${scopeId === DOCUMENT_SCOPE ? 'document' : scopeId}`} style={{ gap: 6 }}>
    {!list.length && <Txt kind="small" muted>{scopeId === DOCUMENT_SCOPE ? 'Values the whole Lienzo shares. A Controls block moves them; shaders and mini apps read them.' : 'Values this Frame shares with what is inside it. A Controls block moves them.'}</Txt>}
    {list.map((variable, i) => <VariableRow key={variable.name} c={c} scopeId={scopeId} variable={variable} index={i} open={open === variable.name} onToggle={() => setOpen(o => o === variable.name ? null : variable.name)} disabled={disabled} />)}
    <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
      <Button label="Number" icon="Plus" small disabled={disabled} onPress={() => add('number')} />
      <Button label="On / off" icon="Plus" small disabled={disabled} onPress={() => add('boolean')} />
      <Button label="Choice" icon="Plus" small disabled={disabled} onPress={() => add('choice')} />
    </View>
  </View>;
}

// ---- Controls ---------------------------------------------------------------------------------------------------------

function ControlsEditor({ c, block, disabled }: { c: CanvasController; block: CanvasBlock; disabled?: boolean }) {
  const u = useUI(), doc = c.view!.document, names = Array.isArray(block.data.variables) ? block.data.variables as string[] : [], scopes = scopesOf(doc, block.id);
  const [open, setOpen] = useState<string | null>(null), [creating, setCreating] = useState<{ label: string; type: VariableType; scope: string } | null>(null);
  const resolve = (name: string) => { for (const [i, scope] of scopes.entries()) { const index = scope.variables.findIndex(v => v.name === name); if (index >= 0) return { scope, variable: scope.variables[index], index, nearest: i }; } return null; };
  const setNames = (next: string[], label: string) => c.edit([{ type: 'block.update', id: block.id, patch: { data: { variables: next } } }], label);
  const available = scopes.flatMap(scope => scope.variables.filter(v => !names.includes(v.name) && resolve(v.name)?.scope.id === scope.id).map(v => ({ value: v.name, label: v.label || v.name, detail: `${variableTypeLabels[variableTypeOf(v)]} · ${scope.label}` })));
  const create = () => {
    if (!creating) return; const latest = c.current.current?.document ?? doc, scopeId = creating.scope;
    const taken = [...latest.variables ?? [], ...latest.groups.flatMap(g => g.variables ?? [])].map(v => v.name);
    const variable = { ...newVariable(creating.type, taken, oneLine(creating.label).trim() || undefined) }, list = scopeVariables(latest, scopeId);
    const ops: CanvasOperation[] = [...variableOperations(latest, scopeId, [...list, variable], {}, controlsTypesOf(c)), { type: 'block.update', id: block.id, patch: { data: { variables: [...names, variable.name] } } }];
    void c.edit(ops, 'Add variable').then(next => { if (next) { setCreating(null); setOpen(variable.name); } });
  };
  return <View nativeID="lienzo-properties-controls" style={{ gap: 6 }}>
    <Label text="Variables shown" help={names.length ? undefined : 'Pick what these controls move. Each becomes a slider, a switch or a set of choices.'} trailing={<Txt kind="label" muted>{names.length} of 4</Txt>} />
    {names.map((name, i) => {
      const found = resolve(name), mark = found ? seriesMark(u, found.index) : undefined;
      return <View key={name} style={{ borderRadius: P.rowRadius, borderWidth: 1, borderColor: open === name ? u.c.border : 'transparent' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: u.compact ? 44 : P.row + 4, paddingLeft: 8 }}>
          {mark ? <Swatch color={mark.color} shape={mark.shape} /> : <Icon name="TriangleAlert" size={12} color={u.c.statusDanger} />}
          <Pressable accessibilityRole="button" accessibilityLabel={`${found?.variable.label || name}: edit`} accessibilityState={{ expanded: open === name }} disabled={!found} onPress={() => setOpen(o => o === name ? null : name)} style={{ flex: 1, minWidth: 0 }}>
            <Txt numberOfLines={1}>{found?.variable.label || name}</Txt>
            <Txt kind="small" muted={!!found} numberOfLines={1} style={found ? undefined : { color: u.c.statusDanger }}>{found ? `${variableTypeLabels[variableTypeOf(found.variable)]} · ${found.scope.label}` : `${name} is not declared here or on the Lienzo`}</Txt>
          </Pressable>
          <Mini icon="ArrowUp" label="Move up" disabled={disabled || i === 0} onPress={() => { void setNames(move(names, i, -1), 'Reorder controls'); }} />
          <Mini icon="ArrowDown" label="Move down" disabled={disabled || i === names.length - 1} onPress={() => { void setNames(move(names, i, 1), 'Reorder controls'); }} />
          <Mini icon="X" label={`Stop showing ${found?.variable.label || name}`} danger disabled={disabled} onPress={() => { void setNames(names.filter(n => n !== name), 'Remove control'); }} />
        </View>
        {open === name && found && <View style={{ padding: 8, paddingTop: 0 }}><VariableForm id={`${block.id}-${name}`} variable={found.variable} siblings={found.scope.variables.filter(v => v.name !== name)} users={variableUsers(doc, found.scope.id, name, controlsTypesOf(c)).length} disabled={disabled}
          save={(next, from) => scopeEdit(c, found.scope.id, from, next, from === next.name ? 'Edit variable' : 'Rename variable').then(r => { if (r && from !== next.name) setOpen(next.name); return r; })} remove={() => { void scopeEdit(c, found.scope.id, name, null, 'Delete variable').catch(c.fail); }} /></View>}
      </View>;
    })}
    {names.length < 4 && !creating && <View style={{ gap: 6 }}>
      {available.length > 0 && <Picker nativeID="lienzo-controls-add" label="Show a variable" placeholder="Show a variable…" options={available} disabled={disabled} onChange={name => { void setNames([...names, name], 'Add control'); }} />}
      <Button label="New variable" icon="Plus" small disabled={disabled} style={{ alignSelf: 'flex-start' }} onPress={() => setCreating({ label: '', type: 'number', scope: scopes[0].id })} />
    </View>}
    {creating && <View nativeID="lienzo-controls-new" style={{ gap: 8, padding: 8, borderRadius: P.rowRadius, borderWidth: 1, borderColor: u.c.border }}>
      <Label text="New variable" />
      <Input label="Label of the new variable" placeholder="Speed, Gravity, Show labels…" value={creating.label} onChange={label => setCreating({ ...creating, label })} onSubmit={create} />
      <Segments value={creating.type} options={VARIABLE_TYPES.map(t => ({ value: t, label: variableTypeLabels[t] }))} onChange={type => setCreating({ ...creating, type })} />
      {scopes.length > 1 && <View style={{ gap: 4 }}><Txt kind="label" muted>Shared by</Txt><Segments value={creating.scope} options={scopes.slice(0, 1).concat(scopes.slice(-1)).map(s => ({ value: s.id, label: s.id === DOCUMENT_SCOPE ? 'The Lienzo' : 'This Frame' }))} onChange={scope => setCreating({ ...creating, scope })} /></View>}
      <View style={{ flexDirection: 'row', gap: 6 }}><Button label="Create" variant="primary" small disabled={disabled} onPress={create} /><Button label="Cancel" small variant="ghost" onPress={() => setCreating(null)} /></View>
    </View>}
  </View>;
}

// ---- Animated flow ------------------------------------------------------------------------------------------------

const KINDS: { value: AnimatedFlowEvent['kind']; label: string }[] = [{ value: 'message', label: 'Message' }, { value: 'signal', label: 'Signal' }, { value: 'value', label: 'Value' }];
function FlowEventsEditor({ data, document, save, disabled, check }: { data: AnimatedFlowData; document: CanvasDocument; save(events: AnimatedFlowEvent[]): Promise<unknown>; disabled?: boolean; check(events: AnimatedFlowEvent[]): string | null }) {
  const u = useUI(), d = useDraft(data.events, events => save(events), { check }), routes = flowRoutes(document), events = d.draft;
  const set = (i: number, patch: Partial<AnimatedFlowEvent>, now = false) => d.set(events.map((e, j) => j === i ? { ...e, ...patch } : e), now);
  return <View nativeID="lienzo-properties-flow-events" style={{ gap: 6 }}>
    <Label text="Events" help={routes.length ? 'Each event leaves at a moment and travels along a link.' : undefined} trailing={<Txt kind="label" muted>{events.length}</Txt>} />
    {!routes.length && <Txt kind="small" muted>Connect two cards first: events travel along the links of this Lienzo.</Txt>}
    {events.map((event, i) => {
      const route = routes.find(r => r.id === event.linkId) ?? routes.find(r => r.from === event.from && r.to === event.to);
      return <View key={i} style={{ gap: 6, padding: 8, borderRadius: P.rowRadius, borderWidth: 1, borderColor: u.c.border }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6 }}>
          <NumberBox label="At" unit="s" value={Number(secondsText(event.t))} width={64} disabled={disabled} onChange={s => set(i, { t: Math.max(0, toMs(s)) })} />
          <View style={{ flex: 1, gap: 2 }}><Txt kind="label" muted>Along</Txt><Picker label={`Event ${i + 1} link`} value={route?.id} placeholder={route ? undefined : 'Pick a link'} disabled={disabled} options={routes.map(r => ({ value: r.id, label: r.label }))} onChange={id => { const r = routes.find(x => x.id === id)!; set(i, { from: r.from, to: r.to, linkId: r.id }, true); }} /></View>
          <Mini icon="X" label={`Remove event ${i + 1}`} danger disabled={disabled} onPress={() => d.set(events.filter((_, j) => j !== i), true)} />
        </View>
        <Segments value={event.kind} disabled={disabled} options={KINDS} onChange={kind => set(i, { kind, payload: flowPayload(kind, String(event.payload)) }, true)} />
        <Input label={`Event ${i + 1} carries`} placeholder={event.kind === 'value' ? 'A number, such as 5' : 'What it carries'} value={String(event.payload)} readOnly={disabled} mono={typeof event.payload === 'number'} style={rowInput(u)} onChange={text => set(i, { payload: flowPayload(event.kind, oneLine(text).slice(0, 160)) })} onBlur={() => { void d.commit(); }} />
      </View>;
    })}
    <Button label="Add event" icon="Plus" small disabled={disabled || !routes.length || events.length >= 64} style={{ alignSelf: 'flex-start' }} onPress={() => { const next = newFlowEvent({ events, duration: data.duration }, document); if (next) d.set([...events, next], true); }} />
    <SaveState pending={d.pending} error={d.error} onRetry={() => { void d.commit(); }} />
  </View>;
}
function FlowLinksEditor({ data, document, save, disabled }: { data: AnimatedFlowData; document: CanvasDocument; save(patch: Record<string, unknown>): Promise<unknown>; disabled?: boolean }) {
  const u = useUI(), routes = flowRoutes(document), d = useDraft(data.links, links => save({ links: replacePatch(data.links, links) }));
  const entries = Object.entries(d.draft), unused = routes.filter(r => !Object.hasOwn(d.draft, r.id));
  return <View nativeID="lienzo-properties-flow-links" style={{ gap: 6 }}>
    <Label text="Sign and delay per link" help="A link can flip a value (−) and hold it for a while before it travels." />
    {entries.map(([id, meta]) => <View key={id} style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6 }}>
      <View style={{ flex: 1, minWidth: 0, gap: 4 }}><Txt kind="small" numberOfLines={1}>{routes.find(r => r.id === id)?.label ?? `${id} (missing link)`}</Txt><Segments value={meta.sign === 1 ? 'plus' : 'minus'} disabled={disabled} options={[{ value: 'plus', label: '+ keeps' }, { value: 'minus', label: '− flips' }]} onChange={sign => d.set({ ...d.draft, [id]: { ...meta, sign: sign === 'plus' ? 1 : -1 } }, true)} /></View>
      <NumberBox label="Delay" unit="s" value={Number(secondsText(meta.delay))} width={60} disabled={disabled} onChange={s => d.set({ ...d.draft, [id]: { ...meta, delay: Math.max(0, toMs(s)) } })} />
      <Mini icon="X" label="Remove this setting" danger disabled={disabled} onPress={() => { const { [id]: _gone, ...rest } = d.draft; d.set(rest, true); }} />
    </View>)}
    {unused.length > 0 && <Picker label="Set a link" placeholder="Set a link…" disabled={disabled} options={unused.map(r => ({ value: r.id, label: r.label }))} onChange={id => d.set({ ...d.draft, [id]: { sign: 1, delay: 0 } }, true)} />}
    <SaveState pending={d.pending} error={d.error} onRetry={() => { void d.commit(); }} />
  </View>;
}
function FlowPropagationEditor({ data, save, disabled }: { data: AnimatedFlowData; save(value: AnimatedFlowData['propagation'] | null): Promise<unknown>; disabled?: boolean }) {
  const on = !!data.propagation, p = data.propagation ?? { maxEvents: Math.max(64, data.events.length), horizon: data.duration };
  return <View nativeID="lienzo-properties-flow-propagation" style={{ gap: 6 }}>
    <CheckRow label="Values keep travelling along the links they reach" checked={on} disabled={disabled} onPress={() => { void save(on ? null : p); }} />
    {on && <View style={{ flexDirection: 'row', gap: 8 }}>
      <NumberBox label="At most" unit="events" value={p.maxEvents} width={96} disabled={disabled} onChange={n => { if (Number.isInteger(n) && n >= Math.max(1, data.events.length) && n <= 256) void save({ ...p, maxEvents: n }); }} />
      <NumberBox label="Until" unit="s" value={Number(secondsText(p.horizon))} width={80} disabled={disabled} onChange={s => { const horizon = toMs(s); if (horizon >= 0 && horizon <= data.duration) void save({ ...p, horizon }); }} />
    </View>}
  </View>;
}

// ---- GLSL parameters ----------------------------------------------------------------------------------------------

function UniformsEditor({ data, document, block, save, disabled }: { data: GlslShaderData; document: CanvasDocument; block: CanvasBlock; save(patch: Record<string, unknown>): Promise<unknown>; disabled?: boolean }) {
  const u = useUI(), keyed = data.uniforms.map(uniform => ({ key: uniform.name, uniform }));
  const d = useDraft(keyed, rows => { const renamed = Object.fromEntries(rows.filter(r => data.uniforms.some(x => x.name === r.key) && r.key !== r.uniform.name).map(r => [r.key, r.uniform.name])); return save(uniformsPatch(data.fragmentSource, data.uniforms, rows.map(r => r.uniform), renamed)); },
    { check: rows => { const names = rows.map(r => r.uniform.name); if (new Set(names).size !== names.length) return 'Two parameters have the same name.'; for (const r of rows) { if (!r.uniform.label.trim()) return 'Every parameter needs a label.'; if (!(r.uniform.min < r.uniform.max)) return `${r.uniform.label}: the lowest value must be below the highest.`; if (r.uniform.value < r.uniform.min || r.uniform.value > r.uniform.max) return `${r.uniform.label}: the starting value must be in its range.`; } return null; } });
  const [open, setOpen] = useState<number>(-1), rows = d.draft, scopes = scopesOf(document, block.id);
  const set = (i: number, patch: Partial<GlslUniform>, now = false) => d.set(rows.map((r, j) => j === i ? { ...r, uniform: { ...r.uniform, ...patch } } : r), now);
  return <View nativeID="lienzo-properties-glsl-uniforms" style={{ gap: 6 }}>
    <Label text="Parameters" help="Each one is a slider under the picture. Adding or renaming one changes the code too." trailing={<Txt kind="label" muted>{rows.length} of 4</Txt>} />
    {rows.map(({ uniform: p }, i) => {
      const shared = scopes.find(s => s.variables.some(v => v.name === p.name));
      return <View key={i} style={{ borderRadius: P.rowRadius, borderWidth: 1, borderColor: open === i ? u.c.border : 'transparent' }}>
        <Pressable accessibilityRole="button" accessibilityLabel={`${p.label}: edit`} accessibilityState={{ expanded: open === i }} onPress={() => setOpen(o => o === i ? -1 : i)} style={{ minHeight: u.compact ? 44 : P.row + 4, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1, minWidth: 0 }}><Txt numberOfLines={1}>{p.label}</Txt><Txt kind="small" muted numberOfLines={1}>{shared ? `Uses the variable ${p.name} of ${shared.label.replace('The whole Lienzo', 'the Lienzo')}` : `${p.min} to ${p.max} · ${p.name}`}</Txt></View>
          <Txt kind="code">{Number(p.value.toPrecision(5))}{p.unit ? ` ${p.unit}` : ''}</Txt><Icon name={open === i ? 'ChevronDown' : 'ChevronRight'} size={12} color={u.c.foregroundMuted} />
        </Pressable>
        {open === i && <View style={{ padding: 8, paddingTop: 0, gap: 8 }}>
          <View style={{ gap: 2 }}><Txt kind="label" muted>Label</Txt><Input label="Parameter label" value={p.label} readOnly={disabled} style={rowInput(u)} onChange={label => set(i, { label: oneLine(label).slice(0, 80) })} /></View>
          <View style={{ flexDirection: 'row', gap: 6 }}>
            <NumberBox label="Lowest" value={p.min} disabled={disabled} width={60} onChange={min => set(i, { min, value: Math.max(min, p.value) })} />
            <NumberBox label="Highest" value={p.max} disabled={disabled} width={60} onChange={max => set(i, { max, value: Math.min(max, p.value) })} />
            <NumberBox label="Step" value={p.step ?? 0} disabled={disabled} width={52} onChange={step => set(i, step > 0 ? { step } : { step: undefined })} />
            <View style={{ flex: 1, gap: 2 }}><Txt kind="label" muted>Unit</Txt><Input label="Parameter unit" value={p.unit ?? ''} readOnly={disabled} style={[rowInput(u), { paddingHorizontal: 8 }]} onChange={unit => set(i, { unit: oneLine(unit).slice(0, 24) || undefined })} /></View>
          </View>
          {p.min < p.max && <View style={{ gap: 2 }}><Txt kind="label" muted>Starts at</Txt><WebRange id={`uniform-${block.id}-${i}`} label={`${p.label}: starts at`} min={p.min} max={p.max} step={p.step ?? 'any'} value={p.value} disabled={!!disabled} color={u.c.accent} onChange={value => set(i, { value })} onSettle={value => set(i, { value }, true)} /></View>}
          <View style={{ gap: 2 }}><Txt kind="label" muted>Name in code</Txt><Input label="Parameter name in code" value={p.name} mono readOnly={disabled} style={rowInput(u)} onChange={name => set(i, { name: name.replace(/\s+/g, '_') })} /></View>
          {scopes.some(s => s.variables.length) && <Picker label="Use a shared variable" placeholder="Use a shared variable…" disabled={disabled} value={shared ? p.name : undefined} options={scopes.flatMap(s => s.variables.filter(v => variableTypeOf(v) === 'number' || v.type === 'boolean' || v.type === 'choice').map(v => ({ value: v.name, label: v.label || v.name, detail: s.label })))} onChange={name => { const v = scopes.flatMap(s => s.variables).find(x => x.name === name)!; set(i, { name, label: p.label || v.label || name, ...(v.min < v.max ? { min: v.min, max: v.max, value: v.value } : {}) }, true); }} />}
          {usesIdentifier(data.fragmentSource, p.name) && <Txt kind="small" muted>Removing it also removes its declaration; the code that uses it must change too.</Txt>}
          <Button label="Remove parameter" icon="Trash2" small variant="danger" disabled={disabled} style={{ alignSelf: 'flex-start' }} onPress={() => { d.set(rows.filter((_, j) => j !== i), true); setOpen(-1); }} />
        </View>}
      </View>;
    })}
    {rows.length < 4 && <Button label="Add parameter" icon="Plus" small disabled={disabled} style={{ alignSelf: 'flex-start' }} onPress={() => { const next = newUniform(rows.map(r => r.uniform)); d.set([...rows, { key: 'new:' + next.name, uniform: next }], true); setOpen(rows.length); }} />}
    <SaveState pending={d.pending} error={d.error} onRetry={() => { void d.commit(); }} />
  </View>;
}

// ---- Raw data -----------------------------------------------------------------------------------------------------

/** The whole data object as JSON, for people who know the structure and for anything no editor covers. */
function RawData({ type, data, save, disabled }: { type: BlockType; data: Data; save(patch: Record<string, unknown>): Promise<unknown>; disabled?: boolean }) {
  const u = useUI(), stored = JSON.stringify(data, null, 2), [text, setText] = useState(stored), [error, setError] = useState(''), [busy, setBusy] = useState(false), [dirty, setDirty] = useState(false);
  useEffect(() => { if (!dirty) setText(stored); }, [stored, dirty]);
  let parsed: Data | null = null, issue = '';
  try { const value = JSON.parse(text); if (!value || typeof value !== 'object' || Array.isArray(value)) issue = 'The data is one JSON object: { … }.'; else { parsed = value; issue = dataIssue(type, value) ?? ''; } } catch (e) { issue = 'Not valid JSON yet' + (e instanceof Error && /position \d+/.test(e.message) ? ` (${e.message.match(/position \d+/)![0]})` : '') + '.'; }
  const apply = async () => { if (!parsed || issue) return; setBusy(true); setError(''); try { const result = await save(replacePatch(data, parsed)); if (!result) throw new Error('The change was not applied.'); setDirty(false); } catch (e) { setError(friendlyError(e)); } finally { setBusy(false); } };
  return <View nativeID="lienzo-properties-raw" style={{ gap: 6 }}>
    <Txt kind="small" muted>Exactly what the agent reads and writes. Changes apply when you press Apply.</Txt>
    <Input label="Raw data (JSON)" value={text} multiline mono readOnly={disabled} style={{ minHeight: 140, maxHeight: 360 }} onChange={next => { setText(next); setDirty(next !== stored); setError(''); }} />
    {dirty && <Txt kind="small" style={{ color: issue ? u.c.statusDanger : u.c.foregroundMuted }}>{issue || 'Looks right.'}</Txt>}
    {!!error && <Txt kind="small" style={{ color: u.c.statusDanger }}>Not saved · {error}</Txt>}
    <View style={{ flexDirection: 'row', gap: 6 }}><Button label="Apply" small variant="primary" disabled={disabled || !dirty || !!issue || busy} onPress={() => { void apply(); }} /><Button label="Revert" small variant="ghost" disabled={!dirty || busy} onPress={() => { setText(stored); setDirty(false); setError(''); }} /></View>
  </View>;
}

// ---- The Content section of a block ----------------------------------------------------------------------------------

const CODE_FIELDS: Record<string, readonly string[]> = { code: ['code'], 'glsl-shader': ['fragmentSource'], html: ['html'] };
const ONE_LINE = new Set(['url', 'caption', 'root', 'language', 'kind', 'mediaKind']);
const MEDIA_LABELS: Record<string, string> = { reference: 'From the link', image: 'Image', video: 'Video', audio: 'Sound' };
/** Fields a structured editor writes together with another one, so they never show on their own. */
const hiddenField = (renderer: string | undefined, key: string) => renderer === 'file-tree' && key === 'collapsed';

/**
 * Everything a person edits about one block: its title, the fields that matter up front, the rest under
 * "More options", and the raw JSON at the bottom. Each change is one labelled transaction with undo.
 */
export function BlockContent({ controller: c, block, type, disabled: blocked }: { controller: CanvasController; block: CanvasBlock; type: BlockType; disabled: boolean }) {
  const disabled = editorsOff(c, blocked);
  const doc = c.view!.document, renderer = type.renderer;
  const save: SaveData = (patch, label) => {
    if (disabled) return Promise.resolve(undefined);
    const latest = (c.current.current?.document ?? doc).blocks.find(b => b.id === block.id);
    if (!latest) return Promise.reject(plainError('The block changed. Select it again.'));
    const issue = dataIssue(type, applyPatch(latest.data, patch));
    if (issue) return Promise.reject(plainError(issue));
    return c.edit([{ type: 'block.update', id: block.id, patch: { data: patch as Data } }], label);
  };
  const field = (p: Property) => <PropertyEditor key={block.id + ':' + p.key} property={p} c={c} block={block} type={type} document={doc} save={save} disabled={disabled} />;
  const { primary, more } = splitProperties(type, block.data, p => hiddenField(renderer, p.key));
  return <View nativeID="lienzo-properties-content" style={{ gap: 12 }}>
    <Field key={block.id + ':title'} label="Title" value={block.title} placeholder="Untitled" disabled={disabled} onSave={title => c.edit([{ type: 'block.update', id: block.id, patch: { title: oneLine(title).slice(0, 300) } }], 'Edit title')} />
    {primary.map(field)}
    {more.length > 0 && <Disclosure nativeID="lienzo-properties-more" label="More options" count={more.length}>{more.map(field)}</Disclosure>}
    <Disclosure label="Raw data (JSON)"><RawData type={type} data={block.data} save={patch => save(patch, 'Edit raw data')} disabled={disabled} /></Disclosure>
  </View>;
}
function PropertyEditor({ property: p, c, block, type, document, save, disabled }: { property: Property; c: CanvasController; block: CanvasBlock; type: BlockType; document: CanvasDocument; save: SaveData; disabled: boolean }) {
  const renderer = type.renderer ?? '', value = block.data[p.key], set = (v: unknown) => save({ [p.key]: v }, 'Edit ' + p.label.toLowerCase());
  if (renderer === 'checklist' && p.key === 'items') return <ChecklistEditor value={value} disabled={disabled} save={items => save({ items }, 'Edit checklist')} />;
  if (renderer === 'file-tree' && p.key === 'entries') return <FileTreeEditor data={block.data as Partial<FileTreeData>} document={document} selfId={block.id} disabled={disabled} save={patch => save(patch, 'Edit file tree')} />;
  if (renderer === 'controls' && p.key === 'variables') return <ControlsEditor c={c} block={block} disabled={disabled} />;
  if (renderer === 'animated-flow') {
    const data = block.data as unknown as AnimatedFlowData;
    if (p.key === 'events') return <FlowEventsEditor data={data} document={document} disabled={disabled} save={events => save({ events }, 'Edit flow events')} check={events => dataIssue(type, { ...block.data, events } as Data)} />;
    if (p.key === 'duration') return <SecondsField id={block.id + '-duration'} label="Duration" help="How long the timeline runs." ms={typeof value === 'number' ? value : 10_000} min={Math.max(1, ...data.events.map(e => e.t))} max={600_000} disabled={disabled} save={duration => save({ duration, ...(data.propagation && data.propagation.horizon > duration ? { propagation: { horizon: duration } } : {}) }, 'Edit duration')} />;
    if (p.key === 'travelMs') return <SecondsField id={block.id + '-travel'} label={p.label} help={p.help} ms={typeof value === 'number' ? value : 1000} min={1} max={10_000} disabled={disabled} save={travelMs => save({ travelMs }, 'Edit travel time')} />;
    if (p.key === 'links') return <FlowLinksEditor data={data} document={document} disabled={disabled} save={patch => save(patch, 'Edit link settings')} />;
    if (p.key === 'propagation') return <FlowPropagationEditor data={data} disabled={disabled} save={propagation => save({ propagation }, 'Edit propagation')} />;
  }
  if (renderer === 'glsl-shader') {
    const data = block.data as unknown as GlslShaderData;
    if (p.key === 'uniforms') return <UniformsEditor data={data} document={document} block={block} disabled={disabled} save={patch => save(patch, 'Edit shader parameters')} />;
    if (p.key === 'builtins') { const b = data.builtins ?? { resolution: true, time: false }; return <View style={{ gap: 2 }}><Label text={p.label} help="Turning one on declares it in the code." />
      <CheckRow label="Canvas size (u_resolution)" checked={b.resolution} disabled={disabled} onPress={() => { void save(builtinsPatch(data.fragmentSource, { ...b, resolution: !b.resolution }), 'Edit shader inputs').catch(c.fail); }} />
      <CheckRow label="Time after Play (u_time)" checked={b.time} disabled={disabled} onPress={() => { void save(builtinsPatch(data.fragmentSource, { ...b, time: !b.time }), 'Edit shader inputs').catch(c.fail); }} /></View>; }
  }
  if (renderer === 'node' && p.key === 'status') return <StatusField property={p} value={typeof value === 'string' ? value : ''} disabled={disabled} save={next => set(next)} />;
  if (p.kind === 'text' && p.options?.length) return <ChoiceField label={p.label} help={p.help} value={typeof value === 'string' ? value : ''} options={p.key === 'kind' || p.key === 'status' ? suggestions(p, document, type.id) : p.options} labels={p.key === 'mediaKind' ? MEDIA_LABELS : undefined} mono={p.key === 'language'} required={p.required} disabled={disabled} save={next => set(next)} />;
  if (p.kind === 'boolean') return <CheckRow label={p.label} checked={value === true} disabled={disabled} onPress={() => { void set(value !== true).catch(c.fail); }} />;
  if (p.kind === 'number') return <View style={{ gap: 2 }}><NumberPropertyField label={p.label} value={value === undefined ? '' : String(value)} required={p.required} disabled={disabled} save={n => set(n).catch(() => undefined)} />{!!p.help && <Txt kind="small" muted>{p.help}</Txt>}</View>;
  if (p.kind === 'json') return <Field label={p.label} helper={p.help ?? 'JSON.'} required={p.required} value={JSON.stringify(value ?? null, null, 2)} multiline mono inputStyle={{ minHeight: 100 }} disabled={disabled} onSave={text => { let parsed: unknown; try { parsed = JSON.parse(text); } catch { throw plainError('Not valid JSON yet.'); } return set(parsed); }} />;
  const code = (CODE_FIELDS[renderer] ?? []).includes(p.key), single = ONE_LINE.has(p.key);
  return <Field label={p.label} helper={p.help} required={p.required && !hasValue(value)} value={typeof value === 'string' ? value : value === undefined ? '' : JSON.stringify(value)} multiline={!single} mono={code} inputStyle={code ? { minHeight: 140 } : undefined} placeholder={p.key === 'url' ? 'https://…' : undefined} disabled={disabled}
    onSave={text => { const next = single ? oneLine(text).trim() : text; if (p.key === 'url' && next && !safeUrl(next)) throw plainError('Use an HTTP or HTTPS address.'); return set(next); }} />;
}
