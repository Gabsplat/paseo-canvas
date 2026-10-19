// Bindings in Properties (docs/design.md §38): each property a block can tie to a variable, with a chain-link button
// that opens the bind form in place. A bound property shows its variable as a pill and what it gives now. Editing a
// binding is one labelled transaction; the value it follows moves at runtime and is never saved by moving it.
import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Pressable, View } from 'react-native';
import { Icon } from './host';
import type { BlockType, CanvasBlock } from '../shared/model';
import { DOCUMENT_SCOPE, type ScopeVariable } from '../shared/learning';
import { WB_COLORS, type WbColor } from '../shared/whiteboard';
import { bindablesFor, bindingOutput, bindingStates, expressionIssue, transformValue, type Bindable, type Binding, type BindingState } from '../shared/bindings';
import type { CanvasController } from './useCanvas';
import { Button, CheckRow, Input, Segments, Txt, useUI } from './ui';
import { Disclosure, seriesMark, useDraft } from './PropertyEditors';
import { newVariable, scopesOf, variableOperations, variableValueText } from './property-model';
import { boundColor, wbColor } from './whiteboard-visuals';
import { withAlpha } from './color';
import { tokens } from './tokens';

const B = tokens.face.bindings, P = tokens.face.properties;
type UI = ReturnType<typeof useUI>;
type Choice = { variable: ScopeVariable; scopeId: string; scopeLabel: string; index: number };
const PRIMARY = new Set(['size.width', 'size.height', 'stroke.color', 'fill.color', 'text.template']);
const round = (n: number) => Number(n.toPrecision(4));

type Step = 's' | 'm' | 'l' | 'xl';
/** What a property is when nothing binds it, for the row and as the start of a new mapping. */
function storedValue(def: Bindable, block: CanvasBlock, renderer: string | undefined, rect?: { width: number; height: number }): number | string {
  const d = block.data, step = (v: unknown): Step => v === 's' || v === 'l' || v === 'xl' ? v : 'm', scale = step(d.scale), weight = step(d.weight);
  switch (def.path) {
    case 'size.width': return Math.round(rect?.width ?? block.size?.width ?? 160);
    case 'size.height': return Math.round(rect?.height ?? block.size?.height ?? 104);
    case 'offset.x': case 'offset.y': case 'rotation': return 0;
    case 'opacity': return 1;
    case 'stroke.width': return tokens.whiteboard.weight[weight];
    case 'corner.radius': return d.shape === 'rounded' ? 16 : 0;
    case 'text.size': return renderer === 'wb-text' ? tokens.whiteboard.text[scale].fontSize : renderer === 'wb-shape' ? tokens.whiteboard.shape.label.sizes[weight].fontSize : renderer === 'node' ? tokens.font.style.small.size : tokens.font.style.body.size;
    case 'text.template': return String(renderer === 'node' ? d.summary ?? '' : d.text ?? '');
    case 'stroke.color': return typeof d.color === 'string' ? d.color : 'tinta';
    case 'fill.color': return typeof d.fillColor === 'string' ? d.fillColor : typeof d.color === 'string' ? d.color : 'tinta';
  }
  return 0;
}
function valueText(def: Bindable, value: number | string): string {
  if (typeof value === 'string') return def.kind === 'text' ? `“${value.length > 24 ? value.slice(0, 23) + '…' : value}”` : value;
  if (def.path === 'opacity') return `${Math.round(value * 100)}%`;
  return `${round(value)}${def.unit === '°' ? '°' : def.unit ? ` ${def.unit}` : ''}`;
}
/** A first mapping that does something visible: the variable's whole range onto a sensible span of the property. */
function newBinding(def: Bindable, choice: Choice, stored: number | string): Binding {
  const { min, max } = choice.variable, from: [number, number] = [min, max === min ? min + 1 : max], n = typeof stored === 'number' ? stored : 0;
  if (def.kind === 'text') return { variable: choice.variable.name, template: `${choice.variable.label || choice.variable.name}: {v}${choice.variable.unit ? ' ' + choice.variable.unit : ''}` };
  if (def.kind === 'color') return { variable: choice.variable.name, hue: { from, to: [200, 0] } };
  const spans: Record<string, [number, number]> = { 'offset.x': [0, 200], 'offset.y': [0, 200], rotation: [0, 360], opacity: [0.2, 1], 'stroke.width': [1, 12], 'corner.radius': [0, 48], 'text.size': [12, 48] };
  const to = spans[def.path] ?? [Math.max(def.min ?? 8, Math.round(n * .5)), Math.min(def.max ?? 4096, Math.round(n * 1.5))];
  return { variable: choice.variable.name, map: { from, to } };
}
/** The variables a block can see, nearest scope first; a name declared nearer hides the same name further out. */
function choices(c: CanvasController, block: CanvasBlock): Choice[] {
  const out: Choice[] = [], seen = new Set<string>();
  for (const scope of scopesOf(c.view!.document, block.id)) scope.variables.forEach((variable, index) => { if (seen.has(variable.name)) return; seen.add(variable.name); out.push({ variable, scopeId: scope.id, scopeLabel: scope.label, index }); });
  return out;
}

function Pill({ u, choice, missing, name }: { u: UI; choice?: Choice; missing?: boolean; name: string }) {
  const mark = choice ? seriesMark(u, choice.index) : null, color = missing ? u.c.statusWarning : mark?.color ?? u.c.accent;
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, height: B.pill.height, maxWidth: 132, paddingHorizontal: B.pill.paddingH, borderRadius: B.pill.radius, backgroundColor: withAlpha(color, B.pill.wash) }}>
    {missing ? <Icon name="TriangleAlert" size={11} color={color} /> : <View style={{ width: B.pill.dot, height: B.pill.dot, borderRadius: B.pill.dot / 2, backgroundColor: color }} />}
    <Txt kind="small" numberOfLines={1} style={{ color: missing ? u.c.statusWarning : u.c.foreground, fontWeight: '600', flexShrink: 1 }}>{choice?.variable.label || name}</Txt>
  </View>;
}
function Swatch({ u, color, size = 14 }: { u: UI; color: string; size?: number }) {
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color, borderWidth: 1, borderColor: withAlpha(u.c.foreground, .18) }} />;
}
function OutputView({ u, def, value }: { u: UI; def: Bindable; value: number | string }) {
  if (def.kind === 'color') { const color = boundColor(value, u); return color ? <Swatch u={u} color={color} /> : null; }
  return <Txt kind="code" numberOfLines={1} style={{ flexShrink: 1 }}>{valueText(def, value)}</Txt>;
}

/** The Bindings section of a selected block. */
export function BindingsEditor({ controller: c, block, type, disabled, rect }: { controller: CanvasController; block: CanvasBlock; type: BlockType; disabled: boolean; rect?: { width: number; height: number } }) {
  const u = useUI(), runtime = useSyncExternalStore(c.learning.subscribe, c.learning.getSnapshot, c.learning.getSnapshot), [open, setOpen] = useState<string | null>(null);
  const doc = c.view!.document, defs = bindablesFor(type.renderer), states = new Map(bindingStates(doc, block, runtime, type.renderer).map(s => [s.path, s])), visible = choices(c, block);
  const save = (path: string, next: Binding | null, label: string) => {
    const latest = (c.current.current?.document ?? doc).blocks.find(b => b.id === block.id); if (!latest) return Promise.resolve(undefined);
    const all = { ...latest.bindings ?? {} }; if (next) all[path] = next; else delete all[path];
    return c.edit([{ type: 'block.update', id: block.id, patch: { bindings: Object.keys(all).length ? all : null } }], label);
  };
  const row = (def: Bindable) => <BindingRow key={def.path} u={u} c={c} def={def} block={block} renderer={type.renderer} rect={rect} state={states.get(def.path as BindingState['path'])} binding={block.bindings?.[def.path]} visible={visible} open={open === def.path} disabled={disabled}
    onToggle={() => setOpen(o => o === def.path ? null : def.path)} save={(next, label) => save(def.path, next, label)} />;
  const primary = defs.filter(d => PRIMARY.has(d.path) || block.bindings?.[d.path]), more = defs.filter(d => !primary.includes(d));
  return <View nativeID="lienzo-properties-bindings" style={{ gap: 2 }}>
    <Txt kind="small" muted style={{ marginBottom: 6 }}>Tie a property to a variable: it follows the slider, and moving it saves nothing.</Txt>
    {primary.map(row)}
    {more.length > 0 && <Disclosure label="More properties" count={more.length}>{<View style={{ gap: 2, marginTop: -6 }}>{more.map(row)}</View>}</Disclosure>}
  </View>;
}

function BindingRow({ u, c, def, block, renderer, rect, state, binding, visible, open, disabled, onToggle, save }: { u: UI; c: CanvasController; def: Bindable; block: CanvasBlock; renderer?: string; rect?: { width: number; height: number }; state?: BindingState; binding?: Binding; visible: Choice[]; open: boolean; disabled: boolean; onToggle(): void; save(next: Binding | null, label: string): Promise<unknown> }) {
  const choice = binding ? visible.find(v => v.variable.name === binding.variable) : undefined, stored = storedValue(def, block, renderer, rect);
  const label = `${def.label}${binding ? `, bound to ${choice?.variable.label || binding.variable}` : ''}`;
  return <View style={{ borderRadius: P.rowRadius, borderWidth: 1, borderColor: open ? u.c.border : 'transparent', backgroundColor: open ? u.c.surface1 : 'transparent' }}>
    <View style={{ minHeight: u.compact ? 44 : P.row + 2, paddingLeft: 8, paddingRight: 2, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Txt numberOfLines={1} style={{ flex: 1, minWidth: 0 }}>{def.label}</Txt>
      {binding ? <>
        <Pill u={u} choice={choice} missing={!!state?.issue && !choice} name={binding.variable} />
        {state?.output !== undefined ? <OutputView u={u} def={def} value={state.output} /> : <Txt kind="small" style={{ color: u.c.statusWarning }}>inert</Txt>}
      </> : <Txt kind="code" muted numberOfLines={1} style={{ flexShrink: 1, maxWidth: 120 }}>{def.kind === 'color' ? '' : valueText(def, stored)}</Txt>}
      {!binding && def.kind === 'color' && typeof stored === 'string' && <Swatch u={u} color={boundColor(stored, u) ?? u.c.foreground} />}
      <Pressable nativeID={`lienzo-bind-${block.id}-${def.path.replace('.', '-')}`} accessibilityRole="button" accessibilityLabel={binding ? `${label}: edit` : `Bind ${def.label} to a variable`} accessibilityState={{ expanded: open, disabled }} disabled={disabled} hitSlop={4}
        onPress={e => { e.stopPropagation(); onToggle(); }}
        style={({ pressed, ...state }) => ({ width: u.compact ? 44 : B.button, height: u.compact ? 44 : B.button, borderRadius: P.rowRadius, alignItems: 'center', justifyContent: 'center', opacity: disabled ? .4 : 1,
          backgroundColor: open || binding ? withAlpha(u.c.accent, pressed ? .22 : .12) : pressed ? withAlpha(u.c.foreground, .1) : (state as { hovered?: boolean }).hovered ? withAlpha(u.c.foreground, .06) : 'transparent' })}>
        <Icon name={B.icon} size={14} color={binding || open ? u.c.accent : u.c.foregroundMuted} />
      </Pressable>
    </View>
    {open && <BindForm u={u} c={c} def={def} block={block} stored={stored} binding={binding} state={state} visible={visible} disabled={disabled} save={save} close={onToggle} />}
  </View>;
}

function BindForm({ u, c, def, block, stored, binding, state, visible, disabled, save, close }: { u: UI; c: CanvasController; def: Bindable; block: CanvasBlock; stored: number | string; binding?: Binding; state?: BindingState; visible: Choice[]; disabled: boolean; save(next: Binding | null, label: string): Promise<unknown>; close(): void }) {
  const d = useDraft<Binding | null>(binding ?? null, next => save(next, next ? `Bind ${def.label.toLowerCase()}` : `Unbind ${def.label.toLowerCase()}`), { check: next => next?.expr ? expressionIssue(next.expr) : null });
  const b = d.draft, choice = b ? visible.find(v => v.variable.name === b.variable) : undefined, now = choice ? state?.value ?? choice.variable.value : undefined;
  const pick = (next: Choice) => d.set(b ? { ...b, variable: next.variable.name } : newBinding(def, next, stored), true);
  const addVariable = () => {
    const doc = c.current.current?.document ?? c.view!.document, taken = [...doc.variables ?? [], ...doc.groups.flatMap(g => g.variables ?? [])].map(v => v.name);
    const variable = newVariable('number', taken), list = [...doc.variables ?? []];
    if (list.length >= 24) { c.fail(new Error('At most 24 variables on the Lienzo.')); return; }
    const next = newBinding(def, { variable, scopeId: DOCUMENT_SCOPE, scopeLabel: '', index: list.length }, stored), all = { ...block.bindings ?? {}, [def.path]: next };
    void c.edit([...variableOperations(doc, DOCUMENT_SCOPE, [...list, variable], {}, new Set()), { type: 'block.update', id: block.id, patch: { bindings: all } }], `Bind ${def.label.toLowerCase()} to a new variable`);
  };
  const set = (patch: Partial<Binding>, now = false) => { if (b) d.set({ ...b, ...patch }, now); };
  const preview = b && now !== undefined ? bindingOutput(def.path, b, now) : undefined;
  return <View nativeID="lienzo-bind-popover" style={{ padding: B.popover.padding, paddingTop: 2, gap: B.popover.gap }}>
    <View style={{ gap: 4 }}>
      <Txt kind="label" muted>{b ? 'Follows' : `Bind ${def.label.toLowerCase()} to`}</Txt>
      {!visible.length && <Txt kind="small" muted>No variables here yet. Variables live on the Lienzo and on Frames; a Controls block shows them as sliders.</Txt>}
      <View accessibilityRole="radiogroup" accessibilityLabel="Variable" style={{ gap: 2 }}>{visible.map(v => { const on = b?.variable === v.variable.name, mark = seriesMark(u, v.index);
        return <Pressable key={v.variable.name} accessibilityRole="radio" accessibilityLabel={`${v.variable.label || v.variable.name}, ${v.scopeLabel}`} accessibilityState={{ checked: on, disabled }} disabled={disabled} onPress={e => { e.stopPropagation(); pick(v); }}
          style={({ pressed, ...st }) => ({ minHeight: u.compact ? 44 : P.row, paddingHorizontal: 8, borderRadius: P.rowRadius - 2, flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1, borderColor: on ? withAlpha(u.c.accent, .5) : 'transparent', backgroundColor: on ? withAlpha(u.c.accent, .1) : pressed ? withAlpha(u.c.foreground, .08) : (st as { hovered?: boolean }).hovered ? withAlpha(u.c.foreground, .04) : 'transparent' })}>
          <View style={{ width: P.dot, height: P.dot, borderRadius: P.dot / 2, backgroundColor: mark.color }} />
          <View style={{ flex: 1, minWidth: 0 }}><Txt numberOfLines={1}>{v.variable.label || v.variable.name}</Txt><Txt kind="label" muted numberOfLines={1}>{v.scopeLabel.replace('The whole Lienzo', 'Lienzo')} · {v.variable.name}</Txt></View>
          <Txt kind="code" muted>{variableValueText(v.variable, v.variable.name === b?.variable && now !== undefined ? now : v.variable.value)}</Txt>
        </Pressable>; })}</View>
      {b && !choice && <Txt kind="small" style={{ color: u.c.statusWarning }}>{b.variable} is not declared on this block’s Frames or the Lienzo any more, so this does nothing. Pick another variable or unbind it.</Txt>}
      {!b && <Button label="New variable" icon="Plus" small variant="ghost" disabled={disabled} style={{ alignSelf: 'flex-start' }} onPress={addVariable} />}
    </View>
    {b && <MappingFields u={u} def={def} b={b} choice={choice} disabled={disabled} set={set} />}
    {b && choice && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: 8, borderRadius: P.rowRadius, backgroundColor: u.c.surface2 }}>
      <Txt kind="small" muted numberOfLines={1} style={{ flexShrink: 1 }}>Now {choice.variable.label || choice.variable.name} {variableValueText(choice.variable, now!)} →</Txt>
      {preview !== undefined ? <OutputView u={u} def={def} value={preview} /> : <Txt kind="small" style={{ color: u.c.statusWarning }}>no usable value</Txt>}
    </View>}
    {!!d.error && <Txt kind="small" accessibilityLiveRegion="polite" style={{ color: u.c.statusDanger }}>Not saved · {d.error}</Txt>}
    {d.pending && <Txt kind="small" muted>Saving…</Txt>}
    <View style={{ flexDirection: 'row', gap: 6, justifyContent: 'flex-end' }}>
      {b && <Button label="Unbind" icon="Unlink" small variant="ghost" disabled={disabled} onPress={() => { d.set(null, true); close(); }} />}
      <Button label="Done" small onPress={() => { void d.commit(); close(); }} />
    </View>
  </View>;
}

/** A number in a small box, named for assistive tech only: the sentence around it is its visible label. */
function Num({ value, onChange, label, disabled, width = B.popover.field, unit }: { value: number; onChange(n: number): void; label: string; disabled?: boolean; width?: number; unit?: string }) {
  const u = useUI(), [text, setText] = useState(String(value)), focused = useRef(false);
  useEffect(() => { if (!focused.current) setText(String(value)); }, [value]);
  return <View style={{ width, flexDirection: 'row', alignItems: 'center' }}>
    <Input label={label} value={text} readOnly={disabled} mono style={{ height: u.compact ? 44 : P.row, paddingVertical: 0, paddingHorizontal: 6, paddingRight: unit ? 22 : 6, flex: 1, minWidth: 0 }} onChange={next => { focused.current = true; setText(next); const n = Number(next.replace(',', '.')); if (next.trim() !== '' && Number.isFinite(n)) onChange(n); }} onBlur={() => { focused.current = false; setText(String(value)); }} />
    {!!unit && <View pointerEvents="none" style={{ position: 'absolute', right: 6 }}><Txt kind="label" muted>{unit === 'deg' ? '°' : unit}</Txt></View>}
  </View>;
}
function Range({ label, unit, value, disabled, onChange, idPrefix }: { label: string; unit?: string; value: [number, number]; disabled: boolean; onChange(next: [number, number]): void; idPrefix: string }) {
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
    <Txt kind="small" numberOfLines={2} style={{ flex: 1, minWidth: 0 }}>{label}</Txt>
    <Num label={`${idPrefix} from`} value={value[0]} unit={unit} disabled={disabled} onChange={n => onChange([n, value[1]])} />
    <Txt kind="small" muted>to</Txt>
    <Num label={`${idPrefix} to`} value={value[1]} unit={unit} disabled={disabled} onChange={n => onChange([value[0], n])} />
  </View>;
}

function MappingFields({ u, def, b, choice, disabled, set }: { u: UI; def: Bindable; b: Binding; choice?: Choice; disabled: boolean; set(patch: Partial<Binding>, now?: boolean): void }) {
  const name = choice?.variable.label || b.variable, vmin = choice?.variable.min ?? 0, vmax = choice?.variable.max ?? 10, range: [number, number] = [vmin, vmax === vmin ? vmin + 1 : vmax];
  const unit = def.unit === '°' ? 'deg' : def.unit;
  const formula = <Disclosure label="Formula instead" defaultOpen={!!b.expr}>
    <View style={{ gap: 4 }}>
      <Input label="Formula of v" mono placeholder="v * 20 + 40" value={b.expr ?? ''} readOnly={disabled} onChange={expr => set(expr.trim() ? { expr, map: undefined } : { expr: undefined })} />
      <Txt kind="small" style={{ color: b.expr && expressionIssue(b.expr) ? u.c.statusDanger : u.c.foregroundMuted }}>{(b.expr && expressionIssue(b.expr)) || 'v is the value; use + - * / %, ( ), min, max, clamp, round, floor, ceil, abs, sqrt, sin, cos and pi. It replaces the range above.'}</Txt>
    </View>
  </Disclosure>;
  if (def.kind === 'text') return <View style={{ gap: 8 }}>
    <View style={{ gap: 4 }}><Txt kind="label" muted>Text</Txt><Input label="Text with the value" placeholder="Speed: {v}" value={b.template ?? ''} readOnly={disabled} onChange={template => set({ template })} />
      <Txt kind="small" muted>{'{v}'} is the value; {'{v:1}'} keeps one decimal.</Txt></View>
    {formula}
  </View>;
  if (def.kind === 'color') {
    const mode = b.steps ? 'steps' : 'hue';
    return <View style={{ gap: 8 }}>
      <Segments value={mode} disabled={disabled} options={[{ value: 'hue', label: 'Hue along a range' }, { value: 'steps', label: 'By thresholds' }]} onChange={next => set(next === 'hue' ? { steps: undefined, hue: { from: range, to: [200, 0] } } : { hue: undefined, steps: [{ at: range[0], color: 'verde' }, { at: round(range[0] + (range[1] - range[0]) * .5), color: 'naranja' }, { at: round(range[0] + (range[1] - range[0]) * .8), color: 'rojo' }] }, true)} />
      {b.hue && <>
        <Range idPrefix={`${name} range`} label={`When ${name} goes from`} value={b.hue.from} disabled={disabled} onChange={from => from[0] !== from[1] && set({ hue: { ...b.hue!, from } })} />
        <Range idPrefix="Hue" label="the hue goes from" unit="deg" value={b.hue.to} disabled={disabled} onChange={to => set({ hue: { ...b.hue!, to } })} />
        <View accessibilityLabel="Hue preview" style={{ flexDirection: 'row', height: 10, borderRadius: 5, overflow: 'hidden' }}>{Array.from({ length: B.hue.ramp }, (_, i) => { const h = b.hue!.to[0] + (b.hue!.to[1] - b.hue!.to[0]) * i / (B.hue.ramp - 1); return <View key={i} style={{ flex: 1, backgroundColor: boundColor(`hue:${Math.round(((h % 360) + 360) % 360)}`, u) }} />; })}</View>
      </>}
      {b.steps && <View style={{ gap: 6 }}>
        {b.steps.map((step, i) => <View key={i} style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Txt kind="small" muted style={{ width: 34 }}>From</Txt><Num label={`Step ${i + 1}: from ${name}`} value={step.at} disabled={disabled} onChange={at => { const steps = b.steps!.map((s, j) => j === i ? { ...s, at } : s); if (steps.every((s, j) => !j || s.at > steps[j - 1].at)) set({ steps }); }} />
          <View accessibilityRole="radiogroup" accessibilityLabel={`Colour from ${step.at}`} style={{ flex: 1, flexDirection: 'row', flexWrap: 'wrap', gap: 2 }}>{WB_COLORS.map(color => { const on = step.color === color;
            return <Pressable key={color} accessibilityRole="radio" accessibilityLabel={tokens.whiteboard.colors.find(x => x.id === color)?.label ?? color} accessibilityState={{ checked: on, disabled }} disabled={disabled} onPress={e => { e.stopPropagation(); set({ steps: b.steps!.map((s, j) => j === i ? { ...s, color } : s) }, true); }}
              style={{ width: 20, height: 20, borderRadius: 10, alignItems: 'center', justifyContent: 'center', borderWidth: on ? 2 : 0, borderColor: u.c.accent }}><Swatch u={u} color={wbColor(color as WbColor, u)} size={14} /></Pressable>; })}</View>
          {b.steps!.length > 1 && <Pressable accessibilityRole="button" accessibilityLabel={`Remove the step from ${step.at}`} disabled={disabled} hitSlop={4} onPress={e => { e.stopPropagation(); set({ steps: b.steps!.filter((_, j) => j !== i) }, true); }} style={{ width: 22, height: 30, alignItems: 'center', justifyContent: 'center' }}><Icon name="X" size={12} color={u.c.foregroundMuted} /></Pressable>}
        </View>)}
        <Txt kind="small" muted>Below the first step, the first colour.</Txt>
        {b.steps.length < 8 && <Button label="Add a step" icon="Plus" small variant="ghost" disabled={disabled} style={{ alignSelf: 'flex-start' }} onPress={() => { const last = b.steps![b.steps!.length - 1]; set({ steps: [...b.steps!, { at: round(last.at + Math.max(1, (range[1] - range[0]) / 4)), color: 'violeta' }] }, true); }} />}
      </View>}
    </View>;
  }
  const map = b.map ?? { from: range, to: [0, 1] as [number, number] };
  return <View style={{ gap: 8 }}>
    {!b.expr && <>
      <Range idPrefix={`${name} range`} label={`When ${name} goes from`} value={map.from} disabled={disabled} onChange={from => from[0] !== from[1] && set({ map: { ...map, from } })} />
      <Range idPrefix={def.label} label={`${def.label.toLowerCase()} goes from`} unit={unit} value={map.to} disabled={disabled} onChange={to => set({ map: { ...map, to } })} />
      <CheckRow label="Stay inside that range" checked={map.clamp !== false} disabled={disabled} onPress={() => set({ map: { ...map, clamp: map.clamp === false ? undefined : false } }, true)} />
    </>}
    {formula}
    {b.expr && choice && <Txt kind="small" muted>At {round(choice.variable.min)}: {round(transformValue(b, choice.variable.min))} · at {round(choice.variable.max)}: {round(transformValue(b, choice.variable.max))}</Txt>}
  </View>;
}
