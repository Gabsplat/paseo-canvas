import React, { createContext, useContext, useMemo, useState } from 'react';
import { Animated, Platform, Pressable, Text, View, type TextStyle, type StyleProp, type ViewStyle } from 'react-native';
import { Icon, Modal as HostModal, ScrollView, TextInput, copyText, useToast } from '@getpaseo/plugin/client/react-native';
import type { PluginHostProps } from '@getpaseo/plugin/client';
import { toneColor, withAlpha, type Tone } from './color';
import { tokens } from './tokens';
import { downloadJson, useKeyboardFocus } from './web';
import { usePressScale, useReducedMotion } from './motion';
type Font = keyof typeof tokens.font.style;
const Context = createContext<PluginHostProps | null>(null);
export function UIProvider({ children, ...props }: PluginHostProps & { children: React.ReactNode }) { useReducedMotion(); return <Context.Provider value={props}>{children}</Context.Provider>; }
export function useHostId(): string | undefined { return useContext(Context)?.host.id; }
export function useUI() {
  const props = useContext(Context); if (!props) throw new Error('Lienzo UI context unavailable');
  const { theme, layout } = props;
  return useMemo(() => ({ ...props, c: theme.colors, compact: layout.compact,
    tone: (t: Tone) => toneColor(t, theme), wash: (t: Tone) => withAlpha(toneColor(t, theme), tokens.alpha.toneWash),
    washStrong: (t: Tone) => withAlpha(toneColor(t, theme), tokens.alpha.toneWashStrong), toneBorder: (t: Tone) => withAlpha(toneColor(t, theme), tokens.alpha.toneBorder), groupFill: (t: Tone) => withAlpha(toneColor(t, theme), tokens.alpha.groupFill), halo: withAlpha(theme.colors.accent, .2),
    font: (f: Font = 'body', muted = false): TextStyle => {
      const s = tokens.font.style[f]; const family = s.family === 'mono' ? Platform.select({ ios: 'Menlo', android: 'monospace', default: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace' }) : s.family === 'serif' ? Platform.select({ ios: 'Georgia', android: 'serif', default: 'Georgia, "Iowan Old Style", "Times New Roman", serif' }) : undefined;
      return { color: muted ? theme.colors.foregroundMuted : theme.colors.foreground, fontFamily: family, fontSize: layout.compact && f === 'body' ? 14 : layout.compact && f === 'button' ? 14 : layout.compact && f === 'small' ? 13 : s.size, lineHeight: layout.compact && f === 'body' ? 21 : layout.compact && f === 'small' ? 18 : s.lineHeight, fontWeight: s.weight, letterSpacing: s.letterSpacing, textTransform: f === 'label' ? 'uppercase' : undefined };
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
export function Txt({ children, kind = 'body', muted = false, style, ...props }: React.ComponentProps<typeof Text> & { kind?: Font; muted?: boolean }) {
  const u = useUI(); return <Text {...props} style={[u.font(kind, muted), style]}>{children}</Text>;
}
export function Button({ label, icon, onPress, disabled = false, variant = 'secondary', small = false, active = false, style }: { label: string; icon?: string; onPress: () => void; disabled?: boolean; variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; small?: boolean; active?: boolean; style?: StyleProp<ViewStyle> }) {
  const u = useUI(), [focused, setFocus] = useState(false), keyboardFocus = useKeyboardFocus(u.layout.platform === 'web'), focus = focused && keyboardFocus; const color = variant === 'primary' ? disabled ? u.c.foregroundMuted : u.c.accentForeground : variant === 'danger' ? u.c.statusDanger : u.c.foreground;
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled, selected: active }} disabled={disabled} onPress={e => { e.stopPropagation(); onPress(); }} onFocus={() => setFocus(true)} onBlur={() => setFocus(false)} hitSlop={u.compact ? 6 : 0}
    style={({ pressed, ...state }) => [{ minHeight: u.compact ? 44 : small ? 26 : 32, minWidth: u.compact ? 44 : undefined, paddingHorizontal: (variant === 'ghost' ? 8 : 12) - (focus ? 1 : 0), borderRadius: 6, borderWidth: focus ? 2 : 1, borderColor: focus ? u.c.accent : variant === 'danger' ? withAlpha(u.c.statusDanger, .38) : variant === 'secondary' ? u.c.border : 'transparent', backgroundColor: variant === 'primary' ? disabled ? u.c.surface2 : u.c.accent : active || variant === 'secondary' ? u.c.surface2 : pressed ? withAlpha(u.c.foreground, .1) : (state as { hovered?: boolean }).hovered ? withAlpha(u.c.foreground, .06) : 'transparent', opacity: disabled ? variant === 'primary' ? .7 : .45 : pressed ? .85 : 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }, style]}>
    {icon && <Icon name={icon} size={14} color={color} />}<Txt kind={small ? 'small' : 'button'} style={{ color, fontWeight: '600' }}>{label}</Txt>
  </Pressable>;
}
export function IconButton({ icon, label, onPress, active, disabled }: { icon: string; label: string; onPress: () => void; active?: boolean; disabled?: boolean }) {
  const u = useUI(), [focused, setFocus] = useState(false), [hovered, setHovered] = useState(false), [pressed, setPressed] = useState(false), keyboardFocus = useKeyboardFocus(u.layout.platform === 'web'), focus = focused && keyboardFocus, feedback = usePressScale();
  // The hit area stays put; the visual inside it scales on press (tokens.motion.press).
  return <Pressable accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ disabled: !!disabled, selected: !!active }} disabled={disabled} onPress={e => { e.stopPropagation(); onPress(); }} onPressIn={() => { setPressed(true); feedback.press(true); }} onPressOut={() => { setPressed(false); feedback.press(false); }} onHoverIn={() => setHovered(true)} onHoverOut={() => setHovered(false)} onFocus={() => setFocus(true)} onBlur={() => setFocus(false)} hitSlop={6} style={{ width: u.compact ? 44 : 32, height: u.compact ? 44 : 32, opacity: disabled ? .45 : 1 }}>
    <Animated.View style={{ flex: 1, borderRadius: 6, borderWidth: focus ? 2 : 0, borderColor: u.c.accent, alignItems: 'center', justifyContent: 'center', backgroundColor: pressed ? withAlpha(u.c.foreground, .1) : active ? u.c.surface2 : hovered && !disabled ? withAlpha(u.c.foreground, .06) : 'transparent', transform: [{ scale: feedback.scale }] }}><Icon name={icon} size={16} color={active ? u.c.foreground : u.c.foregroundMuted} /></Animated.View>
  </Pressable>;
}
export function Chip({ label, tone = 'neutro', icon, center = false, style }: { label: string; tone?: Tone; icon?: string; center?: boolean; style?: StyleProp<ViewStyle> }) {
  const u = useUI(); return <View style={[{ alignSelf: center ? 'center' : 'flex-start', flexShrink: 1, minHeight: 20, paddingHorizontal: 6, borderRadius: 4, backgroundColor: u.wash(tone), flexDirection: 'row', alignItems: 'center', gap: 4 }, style]}>{icon && <Icon name={icon} size={12} color={u.tone(tone)} />}<Txt kind="label" muted numberOfLines={1} style={{ flexShrink: 1 }}>{label}</Txt></View>;
}
export function Segments<T extends string>({ value, options, onChange, disabled }: { value: T; options: readonly { value: T; label: string }[]; onChange: (v: T) => void; disabled?: boolean }) {
  const u = useUI(); return <View style={{ flexDirection: 'row', backgroundColor: u.c.surface2, padding: 2, borderRadius: 6, gap: 2 }}>{options.map(o => <Pressable key={o.value} accessibilityRole="button" accessibilityLabel={o.label} accessibilityState={{ selected: value === o.value, disabled: !!disabled }} disabled={disabled} hitSlop={u.compact ? 4 : 0} onPress={() => onChange(o.value)} style={{ flex: 1, minHeight: u.compact ? 36 : 28, paddingHorizontal: 6, justifyContent: 'center', alignItems: 'center', borderRadius: 4, backgroundColor: value === o.value ? u.c.surface1 : 'transparent', borderWidth: 1, borderColor: value === o.value ? u.c.border : 'transparent', opacity: disabled ? .45 : 1 }}><Txt kind="small" numberOfLines={1} muted={value !== o.value} style={{ fontWeight: '600' }}>{o.label}</Txt></Pressable>)}</View>;
}
export function Input({ value, onChange, onBlur, placeholder, multiline = false, mono = false, readOnly = false, label, style }: { value: string; onChange?: (v: string) => void; onBlur?: () => void; placeholder?: string; multiline?: boolean; mono?: boolean; readOnly?: boolean; label?: string; style?: StyleProp<TextStyle> }) {
  const u = useUI(), [focused, setFocused] = useState(false), keyboardFocus = useKeyboardFocus(u.layout.platform === 'web'), focus = focused && keyboardFocus;
  return <TextInput accessibilityLabel={label ?? placeholder} value={value} onChangeText={onChange} onBlur={() => { setFocused(false); onBlur?.(); }} onFocus={() => setFocused(true)} placeholder={placeholder} placeholderTextColor={u.c.foregroundMuted} multiline={multiline} editable={!readOnly} selectTextOnFocus={readOnly} autoCapitalize={mono ? 'none' : 'sentences'} autoCorrect={!mono} style={[u.font(mono ? 'code' : 'body'), { minHeight: multiline ? 64 : undefined, height: multiline ? undefined : u.compact ? 44 : 32, textAlignVertical: multiline ? 'top' : 'center', paddingHorizontal: focus ? 9 : 10, paddingVertical: multiline ? focus ? 7 : 8 : 0, backgroundColor: u.c.surface2, borderRadius: 6, borderWidth: focus ? 2 : 1, borderColor: focus ? u.c.accent : u.c.border }, style]} />;
}
export function Field({ label, value, onSave, multiline, mono, disabled, helper, placeholder, required, counterMax, onDraft }: { label: string; value: string; onSave: (v: string) => unknown | Promise<unknown>; multiline?: boolean; mono?: boolean; disabled?: boolean; helper?: string; placeholder?: string; required?: boolean; counterMax?: number; onDraft?: (v: string) => void }) {
  const u = useUI(), [draft, setDraft] = useState(value), [dirty, setDirty] = useState(false), [pending, setPending] = useState(false), [error, setError] = useState('');
  const saveRef = React.useRef(onSave); saveRef.current = onSave;
  const saving = React.useRef(false), draftRef = React.useRef(draft);
  React.useEffect(() => { if (!dirty) { setDraft(value); draftRef.current = value; } }, [value, dirty]);
  const commit = async () => {
    if (!dirty || draft === value || saving.current || disabled) return;
    saving.current = true; const submitted = draftRef.current; setPending(true); setError('');
    try { const result = await saveRef.current(submitted); if (result === undefined || result === false) throw new Error('El cambio no se aplicó.'); if (draftRef.current === submitted) setDirty(false); }
    catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { saving.current = false; setPending(false); }
  };
  React.useEffect(() => { if (!dirty || error || pending) return; const timer = setTimeout(() => { void commit(); }, 600); return () => clearTimeout(timer); }, [draft, dirty, disabled, pending]);
  return <View style={{ gap: 4 }}><View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><Txt kind="small" style={{ fontWeight: '600' }}>{label}{required ? ' *' : ''}</Txt>{pending && <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: u.c.statusWarning }} />}</View><Input label={label} placeholder={placeholder} value={draft} onChange={s => { setDraft(s); draftRef.current = s; onDraft?.(s); setDirty(true); setError(''); }} readOnly={disabled} multiline={multiline} mono={mono} onBlur={() => { void commit(); }} />{counterMax && <Txt kind="small" muted>{draft.length}/{counterMax}</Txt>}{error ? <View style={{ gap: 4 }}><Txt kind="small" style={{ color: u.c.statusDanger }}>No se guardó · {error}</Txt><Button label="Reintentar" small variant="ghost" onPress={() => { void commit(); }} /></View> : helper ? <Txt kind="small" muted>{helper}</Txt> : null}</View>;
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
  const copy = () => { void copyText(text).then(() => toast.show('Copiado al portapapeles', { variant: 'success' })).catch(() => toast.error('No se pudo copiar. Selecciona el texto y cópialo a mano.')); };
  return <View style={{ gap: 8 }}><View style={{ backgroundColor: u.c.surface2, borderRadius: 6, padding: 10 }}><ScrollView style={{ maxHeight: 220 }}><Txt kind="code" selectable>{text}</Txt></ScrollView></View><Txt kind="label" muted>{(encodeURIComponent(text).replace(/%[A-F\d]{2}|./gi, 'x').length / 1024).toFixed(1).replace('.', ',')} KB</Txt>{u.layout.platform === 'web' && <Button label="Descargar JSON" variant="primary" icon="Download" onPress={() => { if (!downloadJson(value, filename)) copy(); }} />}<Button label={u.layout.platform === 'web' ? 'Copiar' : 'Copiar JSON'} variant={u.layout.platform === 'web' ? 'secondary' : 'primary'} icon="Copy" onPress={copy} />{u.layout.platform !== 'web' && <Txt kind="small" muted>En el móvil no se descargan archivos: copia el JSON o selecciónalo.</Txt>}</View>;
}
