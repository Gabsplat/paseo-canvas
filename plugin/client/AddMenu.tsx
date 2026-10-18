import React, { useMemo, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Icon, ScrollView, TextInput } from './host';
import { tokens } from './tokens';
import { withAlpha, type Tone } from './color';
import { Txt, useTooltip, useUI } from './ui';
import { islandStyle } from './whiteboard-visuals';
import { itemScore } from './palette';

export type AddSection = 'Shapes & drawing' | 'Embeds' | 'Blocks' | 'Extensions';
export const ADD_SECTIONS: readonly AddSection[] = ['Shapes & drawing', 'Embeds', 'Blocks', 'Extensions'];
/** One thing the `+` catalog can add or start. The same entries feed pinned tools and the command palette. */
export type ToolEntry = { id: string; section: AddSection; name: string; description: string; icon: string; tone?: Tone; shortcut?: string; keywords?: string; disabled?: boolean; active?: boolean; run(): void };
const A = tokens.face.catalog;

function PinToggle({ pinned, name, visible, onPress }: { pinned: boolean; name: string; visible: boolean; onPress(): void }) {
  const u = useUI(), tip = useTooltip({ label: pinned ? 'Unpin from toolbar' : 'Pin to toolbar', detail: pinned ? undefined : 'Pinned tools get keys 1–9.' });
  return <Pressable ref={tip.ref} accessibilityRole="button" accessibilityLabel={(pinned ? 'Unpin ' : 'Pin ') + name} accessibilityState={{ selected: pinned }} onPress={e => { e.stopPropagation(); onPress(); }} onHoverIn={tip.onHoverIn} onHoverOut={tip.onHoverOut} onPressIn={tip.onPressIn} hitSlop={6}
    style={({ pressed }) => ({ width: 24, height: 24, borderRadius: 6, alignItems: 'center', justifyContent: 'center', opacity: visible || pinned ? 1 : 0, backgroundColor: pressed ? withAlpha(u.c.foreground, .1) : 'transparent' })}>
    <Icon name={pinned ? 'PinOff' : 'Pin'} size={A.pinIcon} color={pinned ? u.c.accent : u.c.foregroundMuted} />
  </Pressable>;
}
function Row({ entry, pinned, active, onRun, onPin, onHover }: { entry: ToolEntry; pinned: boolean; active: boolean; onRun(): void; onPin(): void; onHover(): void }) {
  const u = useUI(), [hovered, setHovered] = useState(false), tone = entry.tone ?? 'neutro';
  return <Pressable nativeID={`lienzo-add-${entry.id}`} accessibilityRole="menuitem" accessibilityLabel={entry.name} accessibilityHint={entry.description} accessibilityState={{ disabled: !!entry.disabled, selected: active }} disabled={entry.disabled}
    onPress={e => { e.stopPropagation(); onRun(); }} onHoverIn={() => { setHovered(true); onHover(); }} onHoverOut={() => setHovered(false)}
    style={({ pressed }) => ({ minHeight: u.compact ? 48 : A.row, paddingHorizontal: 8, borderRadius: 8, flexDirection: 'row', alignItems: 'center', gap: 10, opacity: entry.disabled ? .45 : 1, backgroundColor: pressed ? withAlpha(u.c.foreground, .1) : active ? withAlpha(u.c.accent, tokens.face.palette.activeWash) : 'transparent' })}>
    <View style={{ width: A.tile, height: A.tile, borderRadius: 6, backgroundColor: u.wash(tone), alignItems: 'center', justifyContent: 'center' }}><Icon name={entry.icon} size={A.tileIcon} color={tone === 'neutro' ? u.c.foreground : u.tone(tone)} /></View>
    <View style={{ flex: 1, minWidth: 0 }}><Txt numberOfLines={1} style={{ fontWeight: '600' }}>{entry.name}</Txt>{!!entry.description && <Txt kind="small" muted numberOfLines={1}>{entry.description}</Txt>}</View>
    {!!entry.shortcut && <Txt kind="keys" muted>{entry.shortcut}</Txt>}
    <PinToggle pinned={pinned} name={entry.name} visible={hovered || active || u.compact} onPress={onPin} />
  </Pressable>;
}

/**
 * The `+` catalog: search on top, then Pinned, Shapes & drawing, Embeds, Blocks and Extensions, and "Manage
 * extensions…" at the bottom. Arrow keys move, Enter adds, Esc closes. Hovering a row shows its pin.
 */
export function AddMenu({ entries, pinned, onPin, onClose, onManage, maxHeight, width = A.width }: { entries: readonly ToolEntry[]; pinned: readonly string[]; onPin(id: string): void; onClose(): void; onManage(): void; maxHeight: number; width?: number }) {
  const u = useUI(), [query, setQuery] = useState(''), [cursor, setCursor] = useState(0);
  const sections = useMemo(() => {
    const q = query.trim();
    const match = (e: ToolEntry) => !q || itemScore(q, { title: e.name, keywords: e.keywords, subtitle: e.description }) !== null;
    const pinnedEntries = pinned.map(id => entries.find(e => e.id === id)).filter((e): e is ToolEntry => !!e && match(e));
    return [{ title: 'Pinned', items: pinnedEntries }, ...ADD_SECTIONS.map(title => ({ title, items: entries.filter(e => e.section === title && match(e)).sort((a, b) => q ? (itemScore(q, { title: b.name, keywords: b.keywords }) ?? -1e9) - (itemScore(q, { title: a.name, keywords: a.keywords }) ?? -1e9) : 0) }))].filter(s => s.items.length);
  }, [entries, pinned, query]);
  const flat = sections.flatMap(s => s.items.map(item => ({ item, section: s.title }))), active = Math.min(cursor, Math.max(0, flat.length - 1));
  const run = (entry: ToolEntry) => { if (entry.disabled) return; onClose(); entry.run(); };
  return <View nativeID="lienzo-add-menu" accessibilityRole="menu" accessibilityLabel="Add to the canvas" style={[islandStyle(u, true), { width, maxHeight, padding: 0, overflow: 'hidden' }]}>
    <View style={{ padding: 8, borderBottomWidth: 1, borderColor: u.c.border, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Icon name="Search" size={16} color={u.c.foregroundMuted} />
      <TextInput nativeID="lienzo-add-search" autoFocus accessibilityLabel="Search tools and blocks" placeholder="Search tools, embeds, blocks…" placeholderTextColor={u.c.foregroundMuted} value={query} onChangeText={value => { setQuery(value); setCursor(0); }}
        onSubmitEditing={() => { const hit = flat[active]?.item; if (hit) run(hit); }}
        onKeyPress={e => { const key = e.nativeEvent.key; if (key === 'ArrowDown' || key === 'ArrowUp') { e.preventDefault?.(); setCursor(Math.max(0, Math.min(flat.length - 1, active + (key === 'ArrowDown' ? 1 : -1)))); } else if (key === 'Escape') onClose(); }}
        style={[u.font('body'), { flex: 1, height: A.search, borderWidth: 0, backgroundColor: 'transparent', ...({ outlineStyle: 'none' } as object) }]} />
    </View>
    <ScrollView showsVerticalScrollIndicator={false} style={{ maxHeight: Math.max(120, maxHeight - A.search - 16 - 44) }} contentContainerStyle={{ padding: 6, paddingTop: 2 }} keyboardShouldPersistTaps="handled">
      {!flat.length && <Txt kind="small" muted style={{ padding: 12 }}>Nothing matches “{query.trim()}”. Try ⌘K to search everything.</Txt>}
      {sections.map(section => <View key={section.title}>
        <Txt kind="label" muted style={{ paddingHorizontal: 8, height: A.sectionHeader, lineHeight: A.sectionHeader, marginTop: 2 }}>{section.title}</Txt>
        {section.items.map(item => { const index = flat.findIndex(f => f.item === item && f.section === section.title);
          return <Row key={section.title + ':' + item.id} entry={item} pinned={pinned.includes(item.id)} active={index === active && (!!query.trim() || cursor > 0)} onRun={() => run(item)} onPin={() => onPin(item.id)} onHover={() => setCursor(index)} />; })}
      </View>)}
    </ScrollView>
    <Pressable nativeID="lienzo-add-manage" accessibilityRole="menuitem" accessibilityLabel="Manage extensions…" onPress={e => { e.stopPropagation(); onClose(); onManage(); }}
      style={({ pressed, ...state }) => ({ minHeight: 40, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 10, borderTopWidth: 1, borderColor: u.c.border, backgroundColor: pressed ? withAlpha(u.c.foreground, .1) : (state as { hovered?: boolean }).hovered ? withAlpha(u.c.foreground, .06) : 'transparent' })}>
      <Icon name="Package" size={16} color={u.c.foregroundMuted} /><Txt style={{ flex: 1 }}>Manage extensions…</Txt><Txt kind="small" muted>Collections and packs</Txt>
    </Pressable>
  </View>;
}
