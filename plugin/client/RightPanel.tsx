import React, { createContext, useContext, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Icon, ScrollView } from '@getpaseo/plugin/client/react-native';
import { tokens } from './tokens';
import { withAlpha } from './color';
import { IconButton, Modal, Txt, useUI } from './ui';
import { islandStyle } from './whiteboard-visuals';

export type PanelTab = { id: string; label: string; icon: string; content: React.ReactNode; scroll?: boolean };
const R = tokens.face.rightPanel;
/** Sections remember being folded per panel, by title, while the panel lives. */
const Folded = createContext<{ folded: ReadonlySet<string>; toggle(title: string): void; open?: string } | null>(null);

/** A collapsible section with a 12 px header, the way Figma groups properties. */
export function PanelSection({ title, children, trailing, defaultOpen = true }: { title: string; children: React.ReactNode; trailing?: React.ReactNode; defaultOpen?: boolean }) {
  const u = useUI(), ctx = useContext(Folded), [local, setLocal] = useState(!defaultOpen);
  const folded = ctx ? ctx.open === title ? false : ctx.folded.has(title) !== !defaultOpen : local, toggle = () => ctx ? ctx.toggle(title) : setLocal(v => !v);
  return <View style={{ borderTopWidth: 1, borderColor: u.c.border }}>
    <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityState={{ expanded: !folded }} onPress={e => { e.stopPropagation(); toggle(); }}
      style={({ pressed, ...state }) => ({ minHeight: R.sectionHeader, paddingHorizontal: R.padding, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: pressed ? withAlpha(u.c.foreground, .08) : (state as { hovered?: boolean }).hovered ? withAlpha(u.c.foreground, .04) : 'transparent' })}>
      <Txt style={{ flex: 1, fontSize: R.sectionLabel, lineHeight: R.sectionLabel + 4, fontWeight: '600', color: u.c.foregroundMuted, letterSpacing: .2 }}>{title}</Txt>{trailing}
      <Icon name={folded ? 'ChevronRight' : 'ChevronDown'} size={12} color={u.c.foregroundMuted} />
    </Pressable>
    {!folded && <View style={{ paddingHorizontal: R.padding, paddingBottom: R.padding, gap: 10 }}>{children}</View>}
  </View>;
}

/**
 * The floating right panel (Properties). It shows when something is selected or the tool in hand has options,
 * with a tab per source. The pin keeps it open; ⌘\ toggles it. On a compact panel it is a sheet.
 */
export function RightPanel({ tabs, active, onTab, pinned, onPin, onClose, top, maxHeight, title, open = true, shortcut, focusSection }: { tabs: readonly PanelTab[]; active: string; onTab(id: string): void; pinned: boolean; onPin(pinned: boolean): void; onClose(): void; top: number; maxHeight: number; title?: string; open?: boolean; shortcut?: string; focusSection?: string }) {
  const u = useUI(), [folded, setFolded] = useState<ReadonlySet<string>>(new Set()), tab = tabs.find(t => t.id === active) ?? tabs[0];
  const folding = { folded, open: focusSection, toggle: (name: string) => setFolded(prev => { const next = new Set(prev); if (next.has(name)) next.delete(name); else next.add(name); return next; }) };
  if (!tab) return null;
  const header = <View style={{ minHeight: R.header, paddingLeft: tabs.length > 1 ? 4 : R.padding, paddingRight: 4, flexDirection: 'row', alignItems: 'center', gap: 2, borderBottomWidth: tabs.length > 1 ? 1 : 0, borderColor: u.c.border }}>
    {tabs.length > 1 ? <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>{tabs.map(t => <Pressable key={t.id} nativeID={`lienzo-panel-tab-${t.id}`} accessibilityRole="tab" accessibilityLabel={t.label} accessibilityState={{ selected: t.id === tab.id }} onPress={e => { e.stopPropagation(); onTab(t.id); }}
      style={({ pressed }) => ({ height: R.tabs - 8, paddingHorizontal: 8, borderRadius: 6, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: t.id === tab.id ? u.c.surface2 : pressed ? withAlpha(u.c.foreground, .08) : 'transparent' })}>
      <Icon name={t.icon} size={14} color={t.id === tab.id ? u.c.foreground : u.c.foregroundMuted} /><Txt kind="small" numberOfLines={1} style={{ fontWeight: '600', color: t.id === tab.id ? u.c.foreground : u.c.foregroundMuted, maxWidth: 140 }}>{t.label}</Txt>
    </Pressable>)}</ScrollView> : <Txt kind="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>{title ?? tab.label}</Txt>}
    {!u.compact && <IconButton icon={pinned ? 'PinOff' : 'Pin'} label={pinned ? 'Unpin panel' : 'Keep panel open'} active={pinned} detail={pinned ? undefined : 'Stays open when nothing is selected.'} onPress={() => onPin(!pinned)} />}
    {!u.compact && <IconButton icon="PanelRightClose" label="Hide panel" shortcut={shortcut} onPress={onClose} />}
  </View>;
  const body = <Folded.Provider value={folding}>{tab.scroll === false ? <View style={{ flexShrink: 1, minHeight: 0 }}>{tab.content}</View> : <ScrollView style={{ flexShrink: 1 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 4 }} keyboardShouldPersistTaps="handled">{tab.content}</ScrollView>}</Folded.Provider>;
  if (u.compact) return <Modal title={title ?? tab.label} open={open} onOpenChange={value => { if (!value) onClose(); }}><Modal.Content scrollable={false} contentContainerStyle={{ padding: 0, gap: 0 }}><View nativeID="lienzo-right-panel" style={{ maxHeight, minHeight: 240 }}>{tabs.length > 1 && header}{body}</View></Modal.Content></Modal>;
  return <View nativeID="lienzo-right-panel" accessibilityLabel={title ?? tab.label} style={[islandStyle(u, true), { position: 'absolute', right: R.inset, top, width: R.width, maxHeight, padding: 0, gap: 0, overflow: 'hidden', zIndex: 25 }]}>
    {header}{body}
  </View>;
}
