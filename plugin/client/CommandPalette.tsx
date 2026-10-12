import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Icon, ScrollView, TextInput } from '@getpaseo/plugin/client/react-native';
import { tokens } from './tokens';
import { withAlpha } from './color';
import { Txt, useUI } from './ui';
import { islandStyle } from './whiteboard-visuals';
import { flatten, paletteSections, type PaletteItem } from './palette';

const P = tokens.face.palette;
export function KeyChips({ parts, inverse = false }: { parts: readonly string[]; inverse?: boolean }) {
  const u = useUI();
  return <View style={{ flexDirection: 'row', gap: 3 }}>{parts.map((part, i) => <View key={i} style={{ minWidth: 20, height: 20, paddingHorizontal: 5, borderRadius: 4, borderWidth: 1, borderColor: inverse ? withAlpha(u.c.surface1, .4) : u.c.border, backgroundColor: inverse ? 'transparent' : u.c.surface2, alignItems: 'center', justifyContent: 'center' }}><Txt kind="keys" muted>{part}</Txt></View>)}</View>;
}
/**
 * ⌘K. Centred, 640 px wide, its top at 18 % of the panel. Search, then results under small headers, Recent when the
 * query is empty, and "Ask the agent: ‹query›" always last. ↵ runs and closes, ⌘↵ runs and stays, Esc closes.
 */
export function CommandPalette({ open, items, recent, onRun, onClose, width, height, chips, onQuery }: {
  open: boolean; items: (query: string) => readonly PaletteItem[]; recent: readonly string[]; onRun(item: PaletteItem, background: boolean): void; onClose(): void;
  width: number; height: number; chips(combo: string): string[]; onQuery?(query: string): void;
}) {
  const u = useUI(), [query, setQuery] = useState(''), [cursor, setCursor] = useState(0), list = useRef<React.ComponentRef<typeof ScrollView>>(null), rows = useRef(new Map<string, number>());
  useEffect(() => { if (open) { setQuery(''); setCursor(0); } }, [open]);
  const sections = useMemo(() => open ? paletteSections(items(query), query, recent, P.perGroup) : [], [open, items, query, recent]);
  const flat = flatten(sections), active = flat[Math.min(cursor, flat.length - 1)];
  useEffect(() => { if (active) { const y = rows.current.get(active.id); if (y !== undefined) list.current?.scrollTo({ y: Math.max(0, y - P.row * 2), animated: false }); } }, [active?.id]);
  if (!open) return null;
  const run = (item: PaletteItem | undefined, background: boolean) => { if (!item || item.disabled) return; if (!background) onClose(); onRun(item, background); };
  const w = Math.min(P.width, Math.max(0, width - 24)), top = Math.round(height * P.top), maxList = Math.min(P.maxHeight, Math.max(160, height - top - P.search - P.footer - 24));
  let y = 0;
  return <View pointerEvents="box-none" style={{ position: 'absolute', inset: 0, zIndex: 60 }}>
    <Pressable accessibilityLabel="Close the command palette" onPress={onClose} style={{ position: 'absolute', inset: 0, backgroundColor: withAlpha(u.c.surface0, P.scrim) }} />
    <View nativeID="lienzo-palette" accessibilityRole="search" style={[islandStyle(u, true), { position: 'absolute', top, left: Math.max(12, (width - w) / 2), width: w, padding: 0, gap: 0, overflow: 'hidden' }]}>
      <View style={{ height: P.search, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: 1, borderColor: u.c.border }}>
        <Icon name="Search" size={18} color={u.c.foregroundMuted} />
        <TextInput nativeID="lienzo-palette-input" autoFocus accessibilityLabel="Search commands, tools and Lienzos" placeholder="Search tools, actions, Lienzos… or ask the agent" placeholderTextColor={u.c.foregroundMuted} value={query}
          onChangeText={value => { setQuery(value); setCursor(0); onQuery?.(value); }}
          onKeyPress={e => {
            const event = e.nativeEvent as unknown as { key: string; metaKey?: boolean; ctrlKey?: boolean }, key = event.key;
            if (key === 'ArrowDown' || key === 'ArrowUp') { e.preventDefault(); setCursor(c => { const from = Math.min(c, flat.length - 1); return Math.max(0, Math.min(flat.length - 1, from + (key === 'ArrowDown' ? 1 : -1))); }); }
            else if (key === 'Enter') { e.preventDefault(); run(active, !!(event.metaKey || event.ctrlKey)); }
            else if (key === 'Escape') { e.preventDefault(); onClose(); }
          }}
          style={[u.font('title'), { flex: 1, height: P.search - 8, borderWidth: 0, backgroundColor: 'transparent', ...({ outlineStyle: 'none' } as object) }]} />
      </View>
      <ScrollView ref={list} showsVerticalScrollIndicator={false} style={{ maxHeight: maxList }} contentContainerStyle={{ padding: 6 }} keyboardShouldPersistTaps="handled">
        {!flat.length && <Txt muted style={{ padding: 16 }}>Type to search.</Txt>}
        {sections.map(section => { y += P.header; return <View key={section.group}>
          <Txt kind="label" muted style={{ height: P.header, lineHeight: P.header, paddingHorizontal: 10, textTransform: 'uppercase', letterSpacing: .8, fontSize: 11 }}>{section.group}</Txt>
          {section.items.map(item => { const at = y; y += P.row; rows.current.set(item.id, at); const on = item === active;
            return <Pressable key={section.group + ':' + item.id} nativeID={`lienzo-palette-item-${item.id}`} accessibilityRole="menuitem" accessibilityLabel={item.title} accessibilityHint={item.subtitle} accessibilityState={{ selected: on, disabled: !!item.disabled }} disabled={item.disabled}
              onHoverIn={() => setCursor(flat.indexOf(item))} onPress={e => { e.stopPropagation(); run(item, false); }}
              style={{ height: P.row, paddingHorizontal: 10, borderRadius: 8, flexDirection: 'row', alignItems: 'center', gap: 12, opacity: item.disabled ? .45 : 1, backgroundColor: on ? withAlpha(u.c.accent, P.activeWash) : 'transparent' }}>
              <Icon name={item.icon} size={16} color={on ? u.c.accent : u.c.foregroundMuted} />
              <Txt numberOfLines={1} style={{ flexShrink: 1, fontWeight: on ? '600' : '400' }}>{item.title}</Txt>
              {!!item.subtitle && <Txt kind="small" muted numberOfLines={1} style={{ flex: 1 }}>{item.subtitle}</Txt>}
              {!item.subtitle && <View style={{ flex: 1 }} />}
              {!!item.shortcut && <KeyChips parts={chips(item.shortcut)} />}
            </Pressable>; })}
        </View>; })}
      </ScrollView>
      <View style={{ height: P.footer, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 8, borderTopWidth: 1, borderColor: u.c.border, backgroundColor: u.c.surface2 }}>
        <Txt kind="small" muted style={{ flex: 1 }} numberOfLines={1}>↵ Open · {chips('mod+enter').join(chips('mod+enter')[0] === '⌘' ? '' : '+')} Run in background · Esc Close</Txt>
        {active && <Txt kind="small" style={{ fontWeight: '600' }} numberOfLines={1}>{active.verb ?? 'Open'} ↵</Txt>}
      </View>
    </View>
  </View>;
}
