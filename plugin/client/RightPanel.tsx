import React, { createContext, useContext, useEffect, useState, useSyncExternalStore } from 'react';
import { Pressable, View } from 'react-native';
import { Icon, ScrollView } from './host';
import { tokens } from './tokens';
import { withAlpha } from './color';
import { IconButton, Modal, Txt, useUI } from './ui';
import { islandStyle } from './whiteboard-visuals';
import { useKeyboardFocus } from './web';
import { sectionMemory } from './property-model';

/** `help` puts a "?" in the panel's header that opens the Help page of what the tab shows. */
export type PanelTab = { id: string; label: string; icon: string; content: React.ReactNode; scroll?: boolean; help?: () => void };
const R = tokens.face.rightPanel;
/** The panel's sections: collapsed by default, remembered by title for the session (property-model sectionMemory). */
const Folding = createContext<{ scope: string; open?: string } | null>(null);

/**
 * A collapsible section with a 12 px header, the way Figma groups properties. It starts collapsed; `defaultOpen` is
 * for the rare panel whose only content it is. When folded, `summary` says what is inside (a count, "Written").
 */
export function PanelSection({ title, children, trailing, summary, defaultOpen = false }: { title: string; children: React.ReactNode; trailing?: React.ReactNode; summary?: string; defaultOpen?: boolean }) {
  const u = useUI(), ctx = useContext(Folding), [local, setLocal] = useState(defaultOpen), [focused, setFocused] = useState(false), ring = useKeyboardFocus(u.layout.platform === 'web') && focused;
  useSyncExternalStore(sectionMemory.subscribe, sectionMemory.version, sectionMemory.version);
  const open = ctx ? ctx.open === title || sectionMemory.isOpen(title, defaultOpen, ctx.scope) : local;
  const toggle = () => ctx ? sectionMemory.toggle(title, defaultOpen, ctx.scope) : setLocal(v => !v);
  return <View nativeID={`lienzo-section-${title.toLowerCase().replace(/[^a-z]+/g, '-')}`} style={{ borderTopWidth: 1, borderColor: u.c.border }}>
    <Pressable accessibilityRole="button" accessibilityLabel={title} accessibilityHint={open ? 'Collapse' : 'Expand'} accessibilityState={{ expanded: open }} aria-expanded={open} onPress={e => { e.stopPropagation(); toggle(); }} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)}
      style={({ pressed, ...state }) => ({ minHeight: R.sectionHeader, paddingHorizontal: R.padding, flexDirection: 'row', alignItems: 'center', gap: 6, outlineStyle: 'none', boxShadow: ring ? `inset 0 0 0 2px ${u.c.accent}` : undefined, backgroundColor: pressed ? withAlpha(u.c.foreground, .08) : (state as { hovered?: boolean }).hovered ? withAlpha(u.c.foreground, .04) : 'transparent' } as never)}>
      <View style={{ width: 12, height: 12, transform: [{ rotate: open ? '90deg' : '0deg' }] }}><Icon name="ChevronRight" size={12} color={u.c.foregroundMuted} /></View>
      <Txt numberOfLines={1} style={{ flex: 1, fontSize: R.sectionLabel, lineHeight: R.sectionLabel + 4, fontWeight: '600', color: open ? u.c.foreground : u.c.foregroundMuted, letterSpacing: .2 }}>{title}</Txt>
      {!open && !!summary && <Txt kind="small" muted numberOfLines={1} style={{ fontSize: R.sectionLabel, lineHeight: R.sectionLabel + 4, maxWidth: 120 }}>{summary}</Txt>}
      {trailing}
    </Pressable>
    {open && <View style={{ paddingHorizontal: R.padding, paddingBottom: R.padding, gap: 10 }}>{children}</View>}
  </View>;
}

/**
 * The floating right panel (Properties). It shows when something is selected or the tool in hand has options,
 * with a tab per source. The pin keeps it open; ⌘\ toggles it. On a compact panel it is a sheet.
 */
export function RightPanel({ tabs, active, onTab, pinned, onPin, onClose, top, maxHeight, title, open = true, shortcut, focusSection, scope = '' }: { tabs: readonly PanelTab[]; active: string; onTab(id: string): void; pinned: boolean; onPin(pinned: boolean): void; onClose(): void; top: number; maxHeight: number; title?: string; open?: boolean; shortcut?: string; focusSection?: string; scope?: string }) {
  const u = useUI(), tab = tabs.find(t => t.id === active) ?? tabs[0];
  // A section asked for by name (Instructions from the menu) opens for the selection it was asked for.
  useEffect(() => { if (focusSection) sectionMemory.force(focusSection, scope); }, [focusSection, scope]);
  const folding = { scope, open: focusSection };
  if (!tab) return null;
  const header = <View style={{ minHeight: R.header, paddingLeft: tabs.length > 1 ? 4 : R.padding, paddingRight: 4, flexDirection: 'row', alignItems: 'center', gap: 2, borderBottomWidth: tabs.length > 1 ? 1 : 0, borderColor: u.c.border }}>
    {tabs.length > 1 ? <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>{tabs.map(t => <Pressable key={t.id} nativeID={`lienzo-panel-tab-${t.id}`} accessibilityRole="tab" accessibilityLabel={t.label} accessibilityState={{ selected: t.id === tab.id }} onPress={e => { e.stopPropagation(); onTab(t.id); }}
      style={({ pressed }) => ({ height: R.tabs - 8, paddingHorizontal: 8, borderRadius: 6, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: t.id === tab.id ? u.c.surface2 : pressed ? withAlpha(u.c.foreground, .08) : 'transparent' })}>
      <Icon name={t.icon} size={14} color={t.id === tab.id ? u.c.foreground : u.c.foregroundMuted} /><Txt kind="small" numberOfLines={1} style={{ fontWeight: '600', color: t.id === tab.id ? u.c.foreground : u.c.foregroundMuted, maxWidth: 140 }}>{t.label}</Txt>
    </Pressable>)}</ScrollView> : <Txt kind="bodyStrong" numberOfLines={1} style={{ flex: 1 }}>{title ?? tab.label}</Txt>}
    {tab.help && <IconButton icon="CircleHelp" label={`Help: ${tab.label}`} detail="How it works and what to ask your agent." onPress={tab.help} />}
    {!u.compact && <IconButton icon={pinned ? 'PinOff' : 'Pin'} label={pinned ? 'Unpin panel' : 'Keep panel open'} active={pinned} detail={pinned ? undefined : 'Stays open when nothing is selected.'} onPress={() => onPin(!pinned)} />}
    {!u.compact && <IconButton icon="PanelRightClose" label="Hide panel" shortcut={shortcut} onPress={onClose} />}
  </View>;
  const body = <Folding.Provider value={folding}>{tab.scroll === false ? <View style={{ flexShrink: 1, minHeight: 0 }}>{tab.content}</View> : <ScrollView style={{ flexShrink: 1 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingBottom: 4 }} keyboardShouldPersistTaps="handled">{tab.content}</ScrollView>}</Folding.Provider>;
  if (u.compact) return <Modal title={title ?? tab.label} open={open} onOpenChange={value => { if (!value) onClose(); }}><Modal.Content scrollable={false} contentContainerStyle={{ padding: 0, gap: 0 }}><View nativeID="lienzo-right-panel" style={{ maxHeight, minHeight: 240 }}>{(tabs.length > 1 || tab.help) && header}{body}</View></Modal.Content></Modal>;
  return <View nativeID="lienzo-right-panel" accessibilityLabel={title ?? tab.label} style={[islandStyle(u, true), { position: 'absolute', right: R.inset, top, width: R.width, maxHeight, padding: 0, gap: 0, overflow: 'hidden', zIndex: 25 }]}>
    {header}{body}
  </View>;
}
