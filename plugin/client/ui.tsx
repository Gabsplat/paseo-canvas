import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Platform, Pressable, Text, View, type TextStyle, type StyleProp, type ViewStyle } from 'react-native';
import { Icon, Modal as HostModal, ScrollView, TextInput, copyText, useToast, capabilities } from './host';
import type { HostProps } from './host';
import { toneColor, withAlpha, type Tone } from './color';
import { tokens } from './tokens';
import { downloadJson, useKeyboardFocus } from './web';
import { usePressScale, useReducedMotion } from './motion';
import { useContentSelectionAllowed } from './interaction';
const errorMessages = {
  REVISION_CONFLICT: 'The Lienzo changed. Try the change again on the current version.',
  NOT_FOUND: 'That is no longer available. Open the Lienzo again.',
  VALIDATION: 'Check the data and try again.',
  INVARIANT: 'That change cannot be applied. Check what is selected.',
  UNKNOWN_TYPE: 'A block type is missing from this Lienzo’s catalog.',
  UNDO_BLOCKED: 'Later changes depend on this one. Check the history.',
  FORBIDDEN: 'You have no access to that in this workspace.',
  TOO_LARGE: 'That is over the size limit. Make it smaller and try again.',
  UNAVAILABLE: `${capabilities.name} is not available. Try again in a moment.`,
} as const;
export function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  // Properties checks data before sending it and says what is wrong in words (property-model plainError).
  if (error instanceof Error && error.name === 'LienzoPlainError') return message;
  const code = message.match(/\b(REVISION_CONFLICT|NOT_FOUND|VALIDATION|INVARIANT|UNKNOWN_TYPE|UNDO_BLOCKED|FORBIDDEN|TOO_LARGE|UNAVAILABLE)\b/)?.[1] as keyof typeof errorMessages | undefined;
  if (code) return errorMessages[code];
  if (Object.values(errorMessages).some(value => value === message)) return message;
  if (/revision conflict|latest revision|Expected revision|selection version/i.test(message)) return errorMessages.REVISION_CONFLICT;
  if (error instanceof SyntaxError || /ZodError|Invalid input|invalid_type|invalid_format/.test(message)) return 'Check the JSON format and the required fields.';
  // Only client-authored validation messages may pass through unchanged.
  const local = ['Invalid JSON', 'Invalid number', 'Up to 200 characters.', 'The change was not applied.', 'The file is larger than 1 MB.', 'The block changed. Select it again.', 'The Lienzo changed before the action finished.', 'Write a title of up to 300 characters.', 'The form was not saved.', 'The layer reached its size limit. The previous drawing is kept.', 'Not reset: the document or the selection changed.', 'Not reset: open the Frame and wait for the block to appear.'];
  if (local.includes(message)) return message;
  if (/network|fetch|connection|offline|socket|timeout/i.test(message)) return `Could not reach ${capabilities.name}. Try again in a moment.`;
  return 'That did not work. Try again.';
}
type Font = keyof typeof tokens.font.style;
const Context = createContext<HostProps | null>(null);
export function UIProvider({ children, ...props }: HostProps & { children: React.ReactNode }) { useReducedMotion(); return <Context.Provider value={props}>{children}</Context.Provider>; }
export function useHostId(): string | undefined { return useContext(Context)?.host.id; }
export function useUI() {
  const props = useContext(Context); if (!props) throw new Error('Lienzo UI context unavailable');
  const { theme, layout } = props;
  return useMemo(() => ({ ...props, c: theme.colors, compact: layout.compact,
    tone: (t: Tone) => toneColor(t, theme), wash: (t: Tone) => withAlpha(toneColor(t, theme), tokens.alpha.toneWash),
    washStrong: (t: Tone) => withAlpha(toneColor(t, theme), tokens.alpha.toneWashStrong), toneBorder: (t: Tone) => withAlpha(toneColor(t, theme), tokens.alpha.toneBorder), groupFill: (t: Tone) => withAlpha(toneColor(t, theme), tokens.alpha.groupFill), halo: withAlpha(theme.colors.accent, .2),
    font: (f: Font = 'body', muted = false): TextStyle => {
      const s = tokens.font.style[f]; const family = s.family === 'mono' ? Platform.select({ ios: 'Menlo', android: 'monospace', default: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace' }) : s.family === 'serif' ? Platform.select({ ios: 'Georgia', android: 'serif', default: 'Georgia, "Iowan Old Style", "Times New Roman", serif' }) : undefined;
      return { color: muted ? theme.colors.foregroundMuted : theme.colors.foreground, fontFamily: family, fontSize: layout.compact && f === 'body' ? 14 : layout.compact && f === 'button' ? 14 : layout.compact && f === 'small' ? 13 : s.size, lineHeight: layout.compact && f === 'body' ? 21 : layout.compact && f === 'small' ? 18 : s.lineHeight, fontWeight: s.weight, letterSpacing: s.letterSpacing };
    },
  }), [theme, layout, props.host]);
}
// The compact host sheet can mount its body in a separate portal root. Capture
// the plugin context here and carry an explicit provider into Content's children.
// Keep the real SDK Content element so host sheet/layout handling stays intact.
export const Modal: typeof HostModal = Object.assign(function ContextModal({ children, ...props }: React.ComponentProps<typeof HostModal>) {
  const { theme, layout, host } = useUI();
  const provide = (content: React.ReactNode) => <UIProvider theme={theme} layout={layout} host={host}>{content}</UIProvider>;
  const content = React.Children.map(children, child => {
    if (!React.isValidElement<React.ComponentProps<typeof HostModal.Content>>(child) || child.type !== HostModal.Content) return child;
    return React.cloneElement(child, undefined, provide(child.props.children));
  });
  return <HostModal {...props} icon={props.icon === undefined ? undefined : provide(props.icon)}>{content}</HostModal>;
}, { Content: HostModal.Content });
export function Txt({ children, kind = 'body', muted = false, style, selectable, ...props }: React.ComponentProps<typeof Text> & { kind?: Font; muted?: boolean }) {
  const u = useUI(), selectionAllowed = useContentSelectionAllowed();
  return <Text {...props} selectable={selectionAllowed ? selectable : false} style={[u.font(kind, muted), style, !selectionAllowed && { userSelect: 'none' }]}>{children}</Text>;
}
export function Button({ label, icon, onPress, disabled = false, variant = 'secondary', small = false, active = false, style }: { label: string; icon?: string; onPress: () => void; disabled?: boolean; variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; small?: boolean; active?: boolean; style?: StyleProp<ViewStyle> }) {
  const u = useUI(), [focused, setFocus] = useState(false), keyboardFocus = useKeyboardFocus(u.layout.platform === 'web'), focus = focused && keyboardFocus; const color = variant === 'primary' ? disabled ? u.c.foregroundMuted : u.c.accentForeground : variant === 'danger' ? u.c.statusDanger : u.c.foreground;
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled, selected: active }} disabled={disabled} onPress={e => { e.stopPropagation(); onPress(); }} onFocus={() => setFocus(true)} onBlur={() => setFocus(false)} hitSlop={u.compact ? 6 : 0}
    style={({ pressed, ...state }) => [{ minHeight: u.compact ? 44 : small ? 26 : 32, minWidth: u.compact ? 44 : undefined, paddingHorizontal: (variant === 'ghost' ? 8 : 12) - (focus ? 1 : 0), borderRadius: 6, borderWidth: focus ? 2 : 1, borderColor: focus ? u.c.accent : variant === 'danger' ? withAlpha(u.c.statusDanger, .38) : variant === 'secondary' ? u.c.border : 'transparent', backgroundColor: variant === 'primary' ? disabled ? u.c.surface2 : u.c.accent : active || variant === 'secondary' ? u.c.surface2 : pressed ? withAlpha(u.c.foreground, .1) : (state as { hovered?: boolean }).hovered ? withAlpha(u.c.foreground, .06) : 'transparent', opacity: disabled ? variant === 'primary' ? .7 : .45 : pressed ? .85 : 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }, style]}>
    {icon && <Icon name={icon} size={14} color={color} />}<Txt kind={small ? 'small' : 'button'} style={{ color, fontWeight: '600' }}>{label}</Txt>
  </Pressable>;
}
/**
 * Tooltips (docs/redesign-2026-10.md, "Tooltips"). One layer per panel draws them above everything, so a control
 * never clips its own label. Name first, then the shortcut in muted monospace. They appear after 500 ms; once one
 * has shown, the next appears at once for 800 ms. They sit away from the nearest panel edge and never cover the
 * control. On touch, a long press shows one.
 */
export type TooltipContent = { label: string; shortcut?: string; detail?: string };
type Measurable = { measureInWindow?(callback: (x: number, y: number, width: number, height: number) => void): void };
type TipRect = { x: number; y: number; width: number; height: number };
type TipState = (TooltipContent & { rect: TipRect; root: { width: number; height: number }; key: number }) | null;
type TipStore = { get(): TipState; subscribe(listener: () => void): () => void; enter(content: TooltipContent, target: unknown): void; leave(): void; touch(content: TooltipContent, target: unknown): void; dismiss(): void };
const T = tokens.tooltip;
function createTipStore(root: React.RefObject<View | null>): TipStore {
  let state: TipState = null, timer: ReturnType<typeof setTimeout> | undefined, warmUntil = 0, serial = 0;
  const listeners = new Set<() => void>(), emit = () => listeners.forEach(l => l());
  const clear = () => { if (timer) clearTimeout(timer); timer = undefined; };
  const show = (content: TooltipContent, target: unknown, ttl?: number) => {
    const node = target as Measurable | null, frame = root.current as unknown as Measurable | null, id = ++serial;
    if (!node?.measureInWindow || !frame?.measureInWindow) return;
    frame.measureInWindow((rx, ry, rw, rh) => node.measureInWindow!((x, y, width, height) => {
      if (id !== serial || !width || !height) return;
      state = { ...content, rect: { x: x - rx, y: y - ry, width, height }, root: { width: rw, height: rh }, key: id }; emit();
      if (ttl) { clear(); timer = setTimeout(() => { state = null; warmUntil = Date.now() + T.warmMs; emit(); }, ttl); }
    }));
  };
  return {
    get: () => state,
    subscribe: listener => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    enter: (content, target) => { clear(); if (state || Date.now() < warmUntil) show(content, target); else { const id = serial; timer = setTimeout(() => { if (id === serial) show(content, target); }, T.delayMs); } },
    leave: () => { clear(); serial++; if (state) { state = null; warmUntil = Date.now() + T.warmMs; emit(); } },
    touch: (content, target) => { clear(); show(content, target, 1600); },
    dismiss: () => { clear(); serial++; if (state) { state = null; emit(); } },
  };
}
const TooltipContext = createContext<TipStore | null>(null);
/** Wrap the panel's root once. `root` is the view the tooltips are positioned in. */
export function TooltipProvider({ root, children }: { root: React.RefObject<View | null>; children: React.ReactNode }) {
  const store = useRef<TipStore | null>(null); store.current ??= createTipStore(root);
  return <TooltipContext.Provider value={store.current}>{children}</TooltipContext.Provider>;
}
/** Handlers for a Pressable that should show a tooltip: spread them on it and attach `ref`. */
export function useTooltip(content: TooltipContent | null) {
  const store = useContext(TooltipContext), ref = useRef<View | null>(null), latest = useRef(content); latest.current = content;
  useEffect(() => () => { store?.leave(); }, [store]);
  return useMemo(() => ({
    ref,
    onHoverIn: () => { if (latest.current) store?.enter(latest.current, ref.current); },
    onHoverOut: () => store?.leave(),
    onPressIn: () => store?.dismiss(),
    onLongPress: () => { if (latest.current) store?.touch(latest.current, ref.current); },
  }), [store]);
}
/** The shared tooltip for any icon-only control that is not an IconButton. Wraps one control. */
export function Tooltip({ label, shortcut, detail, children, style }: TooltipContent & { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const tip = useTooltip({ label, shortcut, detail }), press = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const touch = (e: { nativeEvent?: { pointerType?: string } }) => e.nativeEvent?.pointerType === 'touch';
  return <View ref={tip.ref} collapsable={false} style={style}
    onPointerEnter={e => { if (!touch(e)) tip.onHoverIn(); }} onPointerLeave={e => { if (!touch(e)) tip.onHoverOut(); }}
    onPointerDown={e => { if (touch(e)) { clearTimeout(press.current); press.current = setTimeout(tip.onLongPress, 500); } else tip.onPressIn(); }}
    onPointerUp={() => clearTimeout(press.current)} onPointerCancel={() => clearTimeout(press.current)}>{children}</View>;
}
/** Draws the current tooltip. Render it last inside the provider's root view. */
export function TooltipLayer() {
  const store = useContext(TooltipContext), u = useUI(), [tip, setTip] = useState<TipState>(null), [size, setSize] = useState<{ key: number; width: number; height: number } | null>(null);
  useEffect(() => store?.subscribe(() => setTip(store.get())), [store]);
  if (!tip) return null;
  const { rect, root } = tip, gap = T.offset, measured = size?.key === tip.key ? size : null, w = measured?.width ?? 0, h = measured?.height ?? 0;
  // Away from the nearest edge: a control at the bottom gets its label above, one at the right edge to its left.
  const edges = { top: rect.y, bottom: root.height - rect.y - rect.height, left: rect.x, right: root.width - rect.x - rect.width };
  const nearest = (Object.keys(edges) as (keyof typeof edges)[]).sort((a, b) => edges[a] - edges[b])[0];
  const clampX = (x: number) => Math.max(4, Math.min(root.width - w - 4, x)), clampY = (y: number) => Math.max(4, Math.min(root.height - h - 4, y));
  const cx = rect.x + rect.width / 2 - w / 2, cy = rect.y + rect.height / 2 - h / 2;
  const at = nearest === 'bottom' ? { left: clampX(cx), top: rect.y - gap - h } : nearest === 'top' ? { left: clampX(cx), top: rect.y + rect.height + gap }
    : nearest === 'right' ? { left: rect.x - gap - w, top: clampY(cy) } : { left: rect.x + rect.width + gap, top: clampY(cy) };
  return <View pointerEvents="none" nativeID="lienzo-tooltip" accessibilityRole="none" onLayout={e => { const { width, height } = e.nativeEvent.layout; if (size?.key !== tip.key || size.width !== width || size.height !== height) setSize({ key: tip.key, width, height }); }}
    style={{ position: 'absolute', ...at, zIndex: 300, maxWidth: T.maxWidth, opacity: measured ? 1 : 0, backgroundColor: u.c.foreground, borderRadius: T.radius, paddingHorizontal: T.paddingH, paddingVertical: T.paddingV, gap: 2 }}>
    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: T.key.gap }}><Txt kind="small" style={{ color: u.c.surface1, fontWeight: '600', flexShrink: 1 }}>{tip.label}</Txt>{!!tip.shortcut && <Txt kind="keys" style={{ color: withAlpha(u.c.surface1, T.key.alpha) }}>{tip.shortcut}</Txt>}</View>
    {!!tip.detail && <Txt kind="small" style={{ color: withAlpha(u.c.surface1, .82) }}>{tip.detail}</Txt>}
  </View>;
}
/** One action of a menu: icon, name, and an optional shortcut or state on the right. Rows share one left edge. */
export function MenuRow({ icon, label, hint, trailing, onPress, disabled = false, danger = false }: { icon: string; label: string; hint?: string; trailing?: React.ReactNode; onPress: () => void; disabled?: boolean; danger?: boolean }) {
  const u = useUI(), color = danger ? u.c.statusDanger : u.c.foreground;
  return <Pressable accessibilityRole="menuitem" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={e => { e.stopPropagation(); onPress(); }}
    style={({ pressed, ...state }) => ({ minHeight: u.compact ? 44 : 34, paddingHorizontal: 10, borderRadius: 6, flexDirection: 'row', alignItems: 'center', gap: 10, opacity: disabled ? .4 : 1, backgroundColor: pressed ? withAlpha(u.c.foreground, .1) : (state as { hovered?: boolean }).hovered ? withAlpha(u.c.foreground, .06) : 'transparent' })}>
    <Icon name={icon} size={16} color={danger ? color : u.c.foregroundMuted} /><Txt numberOfLines={1} style={{ flex: 1, color }}>{label}</Txt>{trailing}{!!hint && <Txt kind="label" muted style={{ textTransform: 'none', letterSpacing: 0 }}>{hint}</Txt>}
  </Pressable>;
}
export function MenuDivider() { const u = useUI(); return <View style={{ height: 1, marginVertical: 4, marginHorizontal: 10, backgroundColor: u.c.border }} />; }
export function IconButton({ icon, label, onPress, active, disabled, shortcut, detail, tooltip = true, size }: { icon: string; label: string; onPress: () => void; active?: boolean; disabled?: boolean; shortcut?: string; detail?: string; tooltip?: boolean; size?: number }) {
  const u = useUI(), [focused, setFocus] = useState(false), [hovered, setHovered] = useState(false), [pressed, setPressed] = useState(false), keyboardFocus = useKeyboardFocus(u.layout.platform === 'web'), focus = focused && keyboardFocus, feedback = usePressScale();
  const tip = useTooltip(tooltip ? { label, shortcut, detail } : null), box = u.compact ? 44 : size ?? 32;
  // The hit area stays put; the visual inside it scales on press (tokens.motion.press).
  return <Pressable ref={tip.ref} accessibilityRole="button" accessibilityLabel={label} accessibilityHint={detail} accessibilityState={{ disabled: !!disabled, selected: !!active }} disabled={disabled} onPress={e => { e.stopPropagation(); onPress(); }} onLongPress={u.compact && tooltip ? tip.onLongPress : undefined} onPressIn={() => { tip.onPressIn(); setPressed(true); feedback.press(true); }} onPressOut={() => { setPressed(false); feedback.press(false); }} onHoverIn={() => { setHovered(true); tip.onHoverIn(); }} onHoverOut={() => { setHovered(false); tip.onHoverOut(); }} onFocus={() => setFocus(true)} onBlur={() => setFocus(false)} hitSlop={6} style={{ width: box, height: box, opacity: disabled ? .45 : 1 }}>
    <Animated.View style={{ flex: 1, borderRadius: 6, borderWidth: focus ? 2 : 0, borderColor: u.c.accent, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? withAlpha(u.c.foreground, .1) : active ? u.c.surface2 : hovered && !disabled ? withAlpha(u.c.foreground, .06) : 'transparent', transform: [{ scale: feedback.scale }] }}><Icon name={icon} size={16} color={active ? u.c.foreground : u.c.foregroundMuted} /></Animated.View>
  </Pressable>;
}
export function Chip({ label, tone = 'neutro', icon, center = false, style }: { label: string; tone?: Tone; icon?: string; center?: boolean; style?: StyleProp<ViewStyle> }) {
  const u = useUI(); return <View style={[{ alignSelf: center ? 'center' : 'flex-start', flexShrink: 1, minHeight: 20, paddingHorizontal: 6, borderRadius: 4, backgroundColor: u.wash(tone), flexDirection: 'row', alignItems: 'center', gap: 4 }, style]}>{icon && <Icon name={icon} size={12} color={u.tone(tone)} />}<Txt kind="label" muted numberOfLines={1} style={{ flexShrink: 1 }}>{label}</Txt></View>;
}
export function Segments<T extends string>({ value, options, onChange, disabled }: { value: T; options: readonly { value: T; label: string }[]; onChange: (v: T) => void; disabled?: boolean }) {
  const u = useUI(); return <View style={{ flexDirection: 'row', backgroundColor: u.c.surface2, padding: 2, borderRadius: 6, gap: 2 }}>{options.map(o => <Pressable key={o.value} accessibilityRole="button" accessibilityLabel={o.label} accessibilityState={{ selected: value === o.value, disabled: !!disabled }} disabled={disabled} hitSlop={u.compact ? 4 : 0} onPress={() => onChange(o.value)} style={{ flex: 1, minHeight: u.compact ? 36 : 28, paddingHorizontal: 6, justifyContent: 'center', alignItems: 'center', borderRadius: 4, backgroundColor: value === o.value ? u.c.surface1 : 'transparent', borderWidth: 1, borderColor: value === o.value ? u.c.border : 'transparent', opacity: disabled ? .45 : 1 }}><Txt kind="small" numberOfLines={1} muted={value !== o.value} style={{ fontWeight: '600' }}>{o.label}</Txt></Pressable>)}</View>;
}
export function Input({ value, onChange, onBlur, onFocus, onSubmit, placeholder, multiline = false, mono = false, readOnly = false, label, style }: { value: string; onChange?: (v: string) => void; onBlur?: () => void; onFocus?: () => void; onSubmit?: () => void; placeholder?: string; multiline?: boolean; mono?: boolean; readOnly?: boolean; label?: string; style?: StyleProp<TextStyle> }) {
  const u = useUI(), [focused, setFocused] = useState(false), keyboardFocus = useKeyboardFocus(u.layout.platform === 'web'), focus = focused && keyboardFocus;
  return <TextInput accessibilityLabel={label ?? placeholder} value={value} onChangeText={onChange} onBlur={() => { setFocused(false); onBlur?.(); }} onFocus={() => { setFocused(true); onFocus?.(); }} onSubmitEditing={onSubmit} placeholder={placeholder} placeholderTextColor={u.c.foregroundMuted} multiline={multiline} editable={!readOnly} selectTextOnFocus={readOnly} autoCapitalize={mono ? 'none' : 'sentences'} autoCorrect={!mono} style={[u.font(mono ? 'code' : 'body'), { minHeight: multiline ? 64 : undefined, height: multiline ? undefined : u.compact ? 44 : 32, textAlignVertical: multiline ? 'top' : 'center', paddingHorizontal: focus ? 9 : 10, paddingVertical: multiline ? focus ? 7 : 8 : 0, backgroundColor: u.c.surface2, borderRadius: 6, borderWidth: focus ? 2 : 1, borderColor: focus ? u.c.accent : u.c.border }, style]} />;
}
export function Field({ label, value, onSave, multiline, mono, disabled, helper, placeholder, required, counterMax, onDraft, hideLabel, inputStyle }: { label: string; value: string; onSave: (v: string) => unknown | Promise<unknown>; multiline?: boolean; mono?: boolean; disabled?: boolean; helper?: string; placeholder?: string; required?: boolean; counterMax?: number; onDraft?: (v: string) => void; hideLabel?: boolean; inputStyle?: StyleProp<TextStyle> }) {
  const u = useUI(), [draft, setDraft] = useState(value), [dirty, setDirty] = useState(false), [pending, setPending] = useState(false), [error, setError] = useState('');
  const saveRef = React.useRef(onSave); saveRef.current = onSave;
  const saving = React.useRef(false), draftRef = React.useRef(draft);
  React.useEffect(() => { if (!dirty) { setDraft(value); draftRef.current = value; } }, [value, dirty]);
  const commit = async () => {
    if (!dirty || draft === value || saving.current || disabled) return;
    saving.current = true; const submitted = draftRef.current; setPending(true); setError('');
    try { const result = await saveRef.current(submitted); if (result === undefined || result === false) throw new Error('The change was not applied.'); if (draftRef.current === submitted) setDirty(false); }
    catch (e) { setError(friendlyError(e)); }
    finally { saving.current = false; setPending(false); }
  };
  React.useEffect(() => { if (!dirty || error || pending) return; const timer = setTimeout(() => { void commit(); }, 600); return () => clearTimeout(timer); }, [draft, dirty, disabled, pending]);
  return <View style={{ gap: 4 }}>{!hideLabel && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><Txt kind="small" style={{ fontWeight: '600' }}>{label}{required ? ' *' : ''}</Txt>{pending && <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: u.c.statusWarning }} />}</View>}<Input style={inputStyle} label={label} placeholder={placeholder} value={draft} onChange={s => { setDraft(s); draftRef.current = s; onDraft?.(s); setDirty(true); setError(''); }} readOnly={disabled} multiline={multiline} mono={mono} onBlur={() => { void commit(); }} />{counterMax && <Txt kind="small" muted>{draft.length}/{counterMax}</Txt>}{error ? <View style={{ gap: 4 }}><Txt kind="small" style={{ color: u.c.statusDanger }}>Not saved · {error}</Txt><Button label="Retry" small variant="ghost" onPress={() => { void commit(); }} /></View> : helper ? <Txt kind="small" muted>{helper}</Txt> : null}</View>;
}
export function CheckRow({ label, checked, onPress, disabled, tone = 'acento', strike }: { label: string; checked: boolean; onPress: () => void; disabled?: boolean; tone?: Tone; strike?: boolean }) {
  const u = useUI(); return <Pressable accessibilityRole="checkbox" accessibilityLabel={label} accessibilityState={{ checked, disabled: !!disabled }} onPress={e => { e.stopPropagation(); onPress(); }} disabled={disabled} style={({ pressed, ...state }) => ({ minHeight: u.compact ? 44 : 28, flexDirection: 'row', alignItems: 'flex-start', gap: 8, paddingVertical: u.compact ? 11 : 5, paddingHorizontal: 6, marginHorizontal: -6, borderRadius: 6, backgroundColor: pressed ? withAlpha(u.c.foreground, tokens.alpha.pressedFill) : (state as { hovered?: boolean }).hovered && !disabled ? withAlpha(u.c.foreground, tokens.alpha.hoverFill) : 'transparent', opacity: disabled ? .45 : 1 })}><View style={{ width: 16, height: 16, marginTop: 1.5, borderRadius: 4, borderWidth: 1.5, borderColor: checked ? u.tone(tone) : withAlpha(u.c.foregroundMuted, tokens.alpha.glyphRing), backgroundColor: checked ? u.tone(tone) : 'transparent', alignItems: 'center', justifyContent: 'center' }}>{checked && <Icon name="Check" size={12} color={u.c.surface1} />}</View><Txt muted={strike} style={{ flex: 1, textDecorationLine: strike ? 'line-through' : 'none' }}>{label}</Txt></Pressable>;
}
export function OptionRow({ label, selected, onPress, disabled, tone = 'violeta', children }: { label: string; selected: boolean; onPress: () => void; disabled?: boolean; tone?: Tone; children?: React.ReactNode }) {
  const u = useUI(); return <Pressable accessibilityRole="radio" accessibilityLabel={label} accessibilityState={{ checked: selected, disabled: !!disabled }} disabled={disabled} onPress={e => { e.stopPropagation(); onPress(); }} style={({ pressed, ...state }) => ({ flexDirection: 'row', gap: 8, alignItems: 'center', paddingVertical: 8, paddingHorizontal: selected ? 9.5 : 10, minHeight: u.compact ? 44 : 36, borderWidth: selected ? 1.5 : 1, borderColor: selected ? u.tone(tone) : (state as { hovered?: boolean }).hovered && !disabled ? withAlpha(u.c.foregroundMuted, .5) : u.c.border, backgroundColor: selected ? u.washStrong(tone) : pressed ? withAlpha(u.c.foreground, tokens.alpha.pressedFill) : 'transparent', borderRadius: 6, opacity: disabled ? .45 : 1 })}><View style={{ width: 16, height: 16, borderRadius: 8, borderWidth: 1.5, borderColor: selected ? u.tone(tone) : withAlpha(u.c.foregroundMuted, tokens.alpha.glyphRing), alignItems: 'center', justifyContent: 'center' }}>{selected && <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: u.tone(tone) }} />}</View>{children ? <View style={{ flex: 1, minWidth: 0 }}>{children}</View> : <Txt style={{ flex: 1 }}>{label}</Txt>}</Pressable>;
}
export function Section({ title, children, onLayout }: { title: string; children: React.ReactNode; onLayout?: React.ComponentProps<typeof View>['onLayout'] }) {
  const u = useUI(); return <View onLayout={onLayout} style={{ gap: 12, paddingTop: 20, borderTopWidth: 1, borderColor: u.c.border }}><Txt kind="label" muted>{title}</Txt>{children}</View>;
}
export function JsonPreview({ value, filename = 'lienzo.json' }: { value: unknown; filename?: string }) {
  const u = useUI(), toast = useToast(), text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  const copy = () => { void copyText(text).then(() => toast.show('Copied', { variant: 'success' })).catch(() => toast.error('Could not copy. Select the text and copy it by hand.')); };
  return <View style={{ gap: 8 }}><View style={{ backgroundColor: u.c.surface2, borderRadius: 6, padding: 10 }}><ScrollView style={{ maxHeight: 220 }}><Txt kind="code" selectable>{text}</Txt></ScrollView></View><Txt kind="label" muted>{(encodeURIComponent(text).replace(/%[A-F\d]{2}|./gi, 'x').length / 1024).toFixed(1)} KB</Txt>{u.layout.platform === 'web' && <Button label="Download JSON" variant="primary" icon="Download" onPress={() => { if (!downloadJson(value, filename)) copy(); }} />}<Button label={u.layout.platform === 'web' ? 'Copy' : 'Copy JSON'} variant={u.layout.platform === 'web' ? 'secondary' : 'primary'} icon="Copy" onPress={copy} />{u.layout.platform !== 'web' && <Txt kind="small" muted>Phones do not download files here: copy the JSON or select it.</Txt>}</View>;
}
