/**
 * The shared language of the screens around the canvas (docs/redesign-2026-10.md, "Shared language for screens"):
 * one large floating sheet over the dimmed canvas, an optional rail of sections, cards that lift on hover, small-caps
 * section labels and a short staggered entrance. Lienzos, Settings, Extensions, History and the guide use it.
 */
import React, { useEffect, useRef } from 'react';
import { Animated, Pressable, View, type StyleProp, type ViewStyle } from 'react-native';
import { Icon, ScrollView, TextInput } from './host';
import { isDark, withAlpha } from './color';
import { NATIVE, easeOut, reducedMotion, useReducedMotion } from './motion';
import { tokens } from './tokens';
import { IconButton, Txt, useUI } from './ui';
import { onEscapeKey } from './web';

const S = tokens.face.screens;
/** CSS transitions on web (react-native-web passes them through); ignored on native. */
const transition = (property: string) => ({ transitionProperty: property, transitionDuration: `${S.card.hoverMs}ms`, transitionTimingFunction: 'cubic-bezier(0.22, 1, 0.36, 1)' }) as object;

export function sheetShadow(u: ReturnType<typeof useUI>) {
  const dark = isDark(u.c.surface0);
  return S.shadow[dark ? 'dark' : 'light'].map(([x, y, blur, spread, alpha]) => `${x}px ${y}px ${blur}px ${spread}px ${withAlpha(dark ? '#000000' : u.c.foreground, alpha)}`).join(', ');
}
/** The sheet's frame for a panel of this size: centred, up to 960 × 680, 24 from the edges; full screen when compact. */
export function sheetFrame(panel: { width: number; height: number }, compact: boolean) {
  if (compact) return { left: 0, top: 0, width: panel.width, height: panel.height };
  const width = Math.max(0, Math.min(S.maxWidth, panel.width - 2 * S.margin)), height = Math.max(0, Math.min(S.maxHeight, panel.height - 2 * S.margin));
  return { left: (panel.width - width) / 2, top: (panel.height - height) / 2, width, height };
}

export type RailItem = { id: string; label: string; icon: string; detail?: string };
export function Screen({ open, onClose, panel, nativeID, label, rail, active, onRail, children, footer }: {
  open: boolean; onClose(): void; panel: { width: number; height: number }; nativeID: string; label: string;
  rail?: readonly RailItem[]; active?: string; onRail?(id: string): void; children: React.ReactNode; footer?: React.ReactNode;
}) {
  const u = useUI(), motion = useReducedMotion(), shown = useRef(new Animated.Value(0)).current, close = useRef(onClose); close.current = onClose;
  useEffect(() => {
    if (!open) return; shown.setValue(motion.current ? 1 : 0);
    if (!motion.current) Animated.timing(shown, { toValue: 1, duration: S.enterMs, easing: easeOut, useNativeDriver: NATIVE }).start();
    return onEscapeKey(() => { close.current(); return true; });
  }, [open]);
  if (!open) return null;
  const frame = sheetFrame(panel, u.compact), dark = isDark(u.c.surface0), railShown = !!rail?.length && !u.compact;
  return <View pointerEvents="box-none" style={{ position: 'absolute', inset: 0, zIndex: 200 }}>
    <Animated.View pointerEvents="none" style={{ position: 'absolute', inset: 0, opacity: shown, backgroundColor: withAlpha(dark ? '#000000' : u.c.foreground, S.dim) }} />
    <Pressable accessibilityLabel={`Close ${label}`} onPress={onClose} style={{ position: 'absolute', inset: 0, ...({ cursor: 'default' } as object) }} />
    <Animated.View nativeID={nativeID} accessibilityRole={'dialog' as never} accessibilityLabel={label} style={{ position: 'absolute', ...frame, borderRadius: u.compact ? 0 : S.radius, borderWidth: u.compact ? 0 : 1, borderColor: u.c.border, backgroundColor: u.c.surface1, overflow: 'hidden',
      boxShadow: u.compact ? undefined : sheetShadow(u), elevation: 12, opacity: shown, transform: [{ scale: shown.interpolate({ inputRange: [0, 1], outputRange: [S.enterScale, 1] }) }] } as ViewStyle}>
      <View style={{ flex: 1, flexDirection: railShown ? 'row' : 'column', minHeight: 0 }}>
        {railShown && <Rail items={rail!} active={active} onPick={id => onRail?.(id)} title={label} />}
        {u.compact && !!rail?.length && <CompactRail items={rail} active={active} onPick={id => onRail?.(id)} />}
        <View style={{ flex: 1, minWidth: 0, minHeight: 0 }}>{children}</View>
      </View>
      {footer}
      <View style={{ position: 'absolute', top: u.compact ? 8 : 14, right: u.compact ? 8 : 14 }}><IconButton icon="X" label={`Close ${label}`} shortcut="Esc" onPress={onClose} /></View>
    </Animated.View>
  </View>;
}
function Rail({ items, active, onPick, title }: { items: readonly RailItem[]; active?: string; onPick(id: string): void; title: string }) {
  const u = useUI();
  return <View nativeID="lienzo-screen-rail" accessibilityRole={'tablist' as never} style={{ width: S.rail, borderRightWidth: 1, borderColor: u.c.border, backgroundColor: u.c.surface0, paddingHorizontal: 12, paddingTop: 22, paddingBottom: 12, gap: 2 }}>
    <Txt kind="label" muted style={{ ...labelStyle, paddingHorizontal: 10, paddingBottom: 10 }}>{title}</Txt>
    {items.map(item => { const on = item.id === active;
      return <Pressable key={item.id} nativeID={`lienzo-rail-${item.id}`} accessibilityRole={'tab' as never} accessibilityLabel={item.label} accessibilityState={{ selected: on }} onPress={() => onPick(item.id)}
        style={({ pressed, ...state }) => ({ minHeight: S.railRow, paddingHorizontal: 10, borderRadius: 8, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: on ? withAlpha(u.c.accent, S.railWash) : pressed ? withAlpha(u.c.foreground, .08) : (state as { hovered?: boolean }).hovered ? withAlpha(u.c.foreground, .05) : 'transparent', ...transition('background-color') })}>
        <Icon name={item.icon} size={16} color={on ? u.c.accent : u.c.foregroundMuted} /><Txt numberOfLines={1} style={{ flex: 1, fontWeight: on ? '600' : '400' }}>{item.label}</Txt>
      </Pressable>; })}
  </View>;
}
/** On a compact panel the rail becomes a row of chips under the top edge. */
function CompactRail({ items, active, onPick }: { items: readonly RailItem[]; active?: string; onPick(id: string): void }) {
  const u = useUI();
  return <View style={{ borderBottomWidth: 1, borderColor: u.c.border, paddingTop: 52 }}><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 10, gap: 6 }}>
    {items.map(item => { const on = item.id === active; return <Pressable key={item.id} nativeID={`lienzo-rail-${item.id}`} accessibilityRole={'tab' as never} accessibilityLabel={item.label} accessibilityState={{ selected: on }} onPress={() => onPick(item.id)} style={{ minHeight: 36, paddingHorizontal: 12, borderRadius: 18, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: on ? withAlpha(u.c.accent, S.railWash) : u.c.surface2 }}>
      <Icon name={item.icon} size={14} color={on ? u.c.accent : u.c.foregroundMuted} /><Txt kind="small" style={{ fontWeight: '600' }}>{item.label}</Txt></Pressable>; })}
  </ScrollView></View>;
}
export const labelStyle = { textTransform: 'uppercase', letterSpacing: S.label.size * S.label.tracking, fontWeight: '600', fontSize: S.label.size } as const;
/** Small-caps muted section label (11 px, 0.06 em tracking). */
export function SectionLabel({ children, style, right }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; right?: React.ReactNode }) {
  return <View style={[{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 20 }, style]}><Txt kind="label" muted style={[labelStyle, { flex: 1 }]}>{children}</Txt>{right}</View>;
}
/** The top of a screen's content: one serif display title, one muted line saying what the screen is for, actions on the right. */
export function ScreenHeader({ title, subtitle, actions, children }: { title: string; subtitle: string; actions?: React.ReactNode; children?: React.ReactNode }) {
  const u = useUI(), pad = u.compact ? 16 : S.padding;
  // The title row keeps clear of the close button in the corner; the subtitle and the controls under it use the full width.
  return <View style={{ paddingHorizontal: pad, paddingTop: u.compact ? 14 : 28, paddingBottom: 16, gap: 4 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginRight: 44, minHeight: 36 }}>
      <Txt kind="display" accessibilityRole="header" numberOfLines={1} style={{ flex: 1, fontSize: u.compact ? 24 : S.title.size, lineHeight: u.compact ? 30 : S.title.lineHeight, letterSpacing: S.title.letterSpacing }}>{title}</Txt>
      {actions && !u.compact && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>{actions}</View>}
    </View>
    <Txt muted numberOfLines={2}>{subtitle}</Txt>
    {actions && u.compact && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>{actions}</View>}
    {children && <View style={{ marginTop: 14 }}>{children}</View>}
  </View>;
}
/** The scrolling body of a screen, with the screen's padding. */
export function ScreenBody({ children, gap = S.gap }: { children: React.ReactNode; gap?: number }) {
  const u = useUI(), pad = u.compact ? 16 : S.padding;
  return <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: pad, paddingBottom: pad, gap }}>{children}</ScrollView>;
}
/** A 12 px card on surface0. Pressable when `onPress` is given: the border lifts to foreground@20 % and it rises 1 px. */
export function Card({ children, onPress, label, selected, style, nativeID, padding = S.card.padding, onHoverChange }: { children: React.ReactNode; onPress?(): void; label?: string; selected?: boolean; style?: StyleProp<ViewStyle>; nativeID?: string; padding?: number; onHoverChange?(hovered: boolean): void }) {
  const u = useUI();
  const base = (hovered: boolean, pressed: boolean): ViewStyle => ({ borderRadius: S.card.radius, borderWidth: selected ? 2 : 1, padding: selected ? padding - 1 : padding,
    borderColor: selected ? u.c.accent : hovered ? withAlpha(u.c.foreground, S.card.hoverBorder) : u.c.border, backgroundColor: u.c.surface0,
    transform: [{ translateY: hovered && !pressed && !reducedMotion.current ? -S.card.lift : 0 }], ...(selected ? { boxShadow: `0 0 0 3px ${withAlpha(u.c.accent, .18)}` } : {}), ...transition('border-color, transform, box-shadow') });
  if (!onPress) return <View nativeID={nativeID} style={[base(false, false), style]}>{children}</View>;
  return <Pressable nativeID={nativeID} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: !!selected }} onPress={onPress} onHoverIn={() => onHoverChange?.(true)} onHoverOut={() => onHoverChange?.(false)}
    style={({ pressed, ...state }) => [base(!!(state as { hovered?: boolean }).hovered, pressed), style]}>{children}</Pressable>;
}
/** Fades and lifts a list item in, 30 ms after the one before it. Instant under reduced motion. */
export function Stagger({ index, children, style }: { index: number; children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const t = useRef(new Animated.Value(reducedMotion.current ? 1 : 0)).current;
  useEffect(() => { if (reducedMotion.current) { t.setValue(1); return; } const run = Animated.timing(t, { toValue: 1, duration: S.enterMs, delay: Math.min(index, S.staggerMax) * S.staggerMs, easing: easeOut, useNativeDriver: NATIVE }); run.start(); return () => run.stop(); }, []);
  return <Animated.View style={[style, { opacity: t, transform: [{ translateY: t.interpolate({ inputRange: [0, 1], outputRange: [6, 0] }) }] }]}>{children}</Animated.View>;
}
/** A short, centred empty state inside a screen. */
export function ScreenEmpty({ title, detail, art, children }: { title: string; detail?: string; art?: React.ReactNode; children?: React.ReactNode }) {
  return <View style={{ alignItems: 'center', justifyContent: 'center', paddingVertical: 64, gap: 10 }}>{art}<Txt kind="title" style={{ textAlign: 'center' }}>{title}</Txt>{detail && <Txt muted style={{ textAlign: 'center', maxWidth: 420 }}>{detail}</Txt>}{children}</View>;
}
/** A compact search field with its icon, for the top of a screen. */
export function SearchField({ value, onChange, placeholder, nativeID }: { value: string; onChange(v: string): void; placeholder: string; nativeID?: string }) {
  const u = useUI();
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, height: u.compact ? 44 : 36, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1, borderColor: u.c.border, backgroundColor: u.c.surface0, flex: 1, minWidth: 160 }}>
    <Icon name="Search" size={14} color={u.c.foregroundMuted} />
    <TextInput nativeID={nativeID} accessibilityLabel={placeholder} value={value} onChangeText={onChange} placeholder={placeholder} placeholderTextColor={u.c.foregroundMuted} autoCorrect={false} style={[u.font('body'), { flex: 1, height: '100%', ...({ outlineStyle: 'none' } as object) }]} />
    {!!value && <Pressable accessibilityRole="button" accessibilityLabel="Clear the search" onPress={() => onChange('')} hitSlop={6}><Icon name="X" size={14} color={u.c.foregroundMuted} /></Pressable>}
  </View>;
}
