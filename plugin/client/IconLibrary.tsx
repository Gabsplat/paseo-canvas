/**
 * The icon library popover (docs/design.md §36.2): search, categories, recent icons, a paged grid of the curated
 * Lucide set that ships offline, and, for anything else, Iconify's open-licence sets searched online. Every icon is
 * inserted as a static SVG drawing that keeps its set and licence. Click to add at the centre, or drag onto the canvas.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Icon, ScrollView, TextInput } from './host';
import { tokens } from './tokens';
import { withAlpha } from './color';
import { Button, IconButton, Txt, useUI } from './ui';
import { WebSvg, attachLibraryDrag, focusFirstField, onEscapeKey } from './web';
import { ICON_CATEGORIES, ICON_PAGE, insertMeta, offlineIcons, recentEntries, rememberIcon, searchIcons, searchIconify, visibleIcons, type IconEntry, type RecentIcon } from './icon-library';
import { islandStyle } from './whiteboard-visuals';
import { labelStyle } from './Screen';
import type { SvgInsertOptions } from './whiteboard-tools';

const I = tokens.face.icons;
type Online = { status: 'idle' } | { status: 'loading'; entries: IconEntry[] } | { status: 'done'; entries: IconEntry[]; more: boolean; page: number } | { status: 'error'; message: string; entries: IconEntry[] };
export type LibraryPopoverProps = {
  onInsert(svg: string, meta: SvgInsertOptions): unknown; onImport(): void; error?: string; busy?: boolean; onClose(): void;
  /** Recent icons, newest first, from the host's interface settings; `onRecent` stores the new list. */
  recent?: readonly RecentIcon[]; onRecent?(list: RecentIcon[]): void;
  /** Whether the network may be tried (false while the Lienzo is offline). */
  online?: boolean; maxHeight?: number;
};

function Cell({ entry, busy, onPick, onHover }: { entry: IconEntry; busy: boolean; onPick(entry: IconEntry): void; onHover(entry: IconEntry | null): void }) {
  const u = useUI(), web = u.layout.platform === 'web';
  return <Pressable nativeID={`lienzo-library-icon-${entry.id}`} disabled={busy} accessibilityRole="button" accessibilityLabel={`Insert ${entry.label}`} accessibilityHint={`${entry.set} · ${entry.license}`}
    onPress={() => onPick(entry)} onHoverIn={() => onHover(entry)} onHoverOut={() => onHover(null)} onFocus={() => onHover(entry)}
    style={({ pressed, ...state }) => ({ width: I.cell, height: I.cell, borderRadius: 8, alignItems: 'center', justifyContent: 'center', opacity: busy ? .45 : 1,
      backgroundColor: pressed ? withAlpha(u.c.foreground, .12) : (state as { hovered?: boolean }).hovered ? withAlpha(u.c.foreground, .07) : 'transparent', ...({ cursor: 'grab' } as object) })}>
    <View pointerEvents="none" style={{ width: I.glyph, height: I.glyph }}>{web ? <WebSvg svg={entry.svg} color={u.c.foreground} label={entry.label} /> : <Icon name={tokens.whiteboard.types['wb-svg'].icon} size={I.glyph} color={u.c.foreground} />}</View>
  </Pressable>;
}
function Grid({ entries, busy, onPick, onHover }: { entries: readonly IconEntry[]; busy: boolean; onPick(entry: IconEntry): void; onHover(entry: IconEntry | null): void }) {
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 2 }}>{entries.map(entry => <Cell key={entry.id} entry={entry} busy={busy} onPick={onPick} onHover={onHover} />)}</View>;
}
function Heading({ children, right }: { children: React.ReactNode; right?: React.ReactNode }) {
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 22, marginTop: 6 }}><Txt kind="label" muted style={[labelStyle, { flex: 1 }]}>{children}</Txt>{right}</View>;
}

export function LibraryPopover({ onInsert, onImport, error, busy = false, onClose, recent = [], onRecent, online = true, maxHeight }: LibraryPopoverProps) {
  const u = useUI(), host = useRef<View>(null), [query, setQuery] = useState(''), [category, setCategory] = useState<string>(recent.length ? 'Recent' : 'All'), [pages, setPages] = useState(1);
  const [hovered, setHovered] = useState<IconEntry | null>(null), [remote, setRemote] = useState<Online>({ status: 'idle' }), known = useRef(new Map<string, IconEntry>()), asked = useRef(0);
  const all = offlineIcons(), recents = useMemo(() => recentEntries(recent), [recent]);
  const used = (entry: IconEntry) => onRecent?.(rememberIcon(latest.current.recent, entry));
  const pick = (entry: IconEntry) => { used(entry); void latest.current.onInsert(entry.svg, insertMeta(entry)); };
  const latest = useRef({ onInsert, busy, color: u.c.foreground, recent, used }); latest.current = { onInsert, busy, color: u.c.foreground, recent, used };
  useEffect(() => attachLibraryDrag(host.current, { enabled: () => !latest.current.busy, preview: id => { const entry = known.current.get(id); return entry ? { svg: entry.svg, color: latest.current.color } : undefined; }, drop: (id, atPage) => { const entry = known.current.get(id); if (entry) { latest.current.used(entry); void latest.current.onInsert(entry.svg, { ...insertMeta(entry), atPage }); } } }), []);
  useEffect(() => { focusFirstField(host.current); return onEscapeKey(() => { onClose(); return true; }, true); }, []);
  // Offline results at once; online ones after a short pause in typing, newest question only.
  const trimmed = query.trim(), searching = trimmed.length > 0;
  const local = useMemo(() => searching ? searchIcons(all, trimmed, category === 'All' || category === 'Recent' ? undefined : category) : searchIcons(all, '', category === 'All' || category === 'Recent' ? undefined : category), [trimmed, category, recents]);
  const fetchPage = (page: number) => {
    const ticket = ++asked.current, before = page ? remote.status === 'done' ? remote.entries : [] : [];
    setRemote({ status: 'loading', entries: before });
    void searchIconify(trimmed, page).then(result => { if (asked.current === ticket) setRemote({ status: 'done', entries: [...before, ...result.entries.filter(e => !before.some(b => b.id === e.id))], more: result.more, page }); })
      .catch(e => { if (asked.current === ticket) setRemote({ status: 'error', entries: before, message: e instanceof Error && /reach the internet/.test(e.message) ? e.message : 'Could not reach Iconify. Check the connection; the icons above work offline.' }); });
  };
  useEffect(() => {
    setPages(1); asked.current++;
    if (trimmed.length < 2 || !online) { setRemote({ status: 'idle' }); return; }
    setRemote({ status: 'loading', entries: [] });
    const timer = setTimeout(() => fetchPage(0), I.searchDebounceMs); return () => clearTimeout(timer);
  }, [trimmed, online]);
  useEffect(() => { setPages(1); }, [category]);
  const shown = visibleIcons(local, pages), remoteEntries = remote.status === 'idle' ? [] : remote.entries;
  for (const entry of [...shown, ...recents, ...remoteEntries]) known.current.set(entry.id, entry);
  const first = shown[0] ?? remoteEntries[0];
  const chips = [...(recents.length ? ['Recent'] : []), 'All', ...ICON_CATEGORIES];
  const footer = hovered ? <View style={{ flex: 1, minWidth: 0 }}><Txt kind="small" numberOfLines={1} style={{ fontWeight: '600' }}>{hovered.label}</Txt><Txt kind="small" muted numberOfLines={1}>{hovered.set} · {hovered.license.split(' · ')[0]}</Txt></View>
    : <Txt kind="small" muted numberOfLines={2} style={{ flex: 1 }}>{busy ? 'Adding…' : 'Click to add, or drag onto the canvas.'}</Txt>;
  return <View ref={host} nativeID="lienzo-icon-library" accessibilityRole={'dialog' as never} accessibilityLabel="Icons" style={[islandStyle(u, true), { width: u.compact ? '100%' : I.width, maxWidth: '100%', height: Math.min(I.height, maxHeight ?? I.height), padding: 0, overflow: 'hidden' }]}>
    <View style={{ paddingHorizontal: 12, paddingTop: 10, gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Txt kind="heading">Icons</Txt><Txt kind="small" muted numberOfLines={1} style={{ flex: 1 }}>{all.length} offline · open sets online</Txt>
        <IconButton icon="X" label="Close icons" shortcut="Esc" onPress={onClose} />
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, height: u.compact ? 44 : 36, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1, borderColor: u.c.border, backgroundColor: u.c.surface0 }}>
        <Icon name="Search" size={14} color={u.c.foregroundMuted} />
        <TextInput nativeID="lienzo-icon-search" accessibilityLabel="Search icons" value={query} onChangeText={setQuery} placeholder="Search icons: server, user, postgres…" placeholderTextColor={u.c.foregroundMuted} autoCorrect={false} autoCapitalize="none"
          onSubmitEditing={() => { if (first && !busy) pick(first); }} blurOnSubmit={false} style={[u.font('body'), { flex: 1, height: '100%', ...({ outlineStyle: 'none' } as object) }]} />
        {!!query && <Pressable accessibilityRole="button" accessibilityLabel="Clear the search" onPress={() => setQuery('')} hitSlop={6}><Icon name="X" size={14} color={u.c.foregroundMuted} /></Pressable>}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 4, paddingBottom: 8 }}>
        {chips.map(name => { const on = (searching && category === 'Recent' ? 'All' : category) === name; return <Pressable key={name} nativeID={`lienzo-icon-chip-${name.toLowerCase().replace(/[^a-z]+/g, '-')}`} accessibilityRole="button" accessibilityLabel={name} accessibilityState={{ selected: on }} onPress={() => setCategory(name)}
          style={({ ...state }) => ({ height: 26, paddingHorizontal: 10, borderRadius: 13, flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: on ? withAlpha(u.c.accent, .16) : (state as { hovered?: boolean }).hovered ? withAlpha(u.c.foreground, .07) : u.c.surface2 })}>
          {name === 'Recent' && <Icon name="History" size={12} color={on ? u.c.accent : u.c.foregroundMuted} />}<Txt kind="small" style={{ fontWeight: '600', color: on ? u.c.accent : u.c.foregroundMuted }}>{name}</Txt></Pressable>; })}
      </ScrollView>
    </View>
    <ScrollView nativeID="lienzo-icon-grid" showsVerticalScrollIndicator={false} style={{ flex: 1, borderTopWidth: 1, borderColor: u.c.border }} contentContainerStyle={{ paddingHorizontal: 10, paddingTop: 4, paddingBottom: 12, gap: 4 }}>
      {searching && <Heading right={<Txt kind="label" muted>{local.length}</Txt>}>In Lienzo</Heading>}
      {!searching && category === 'Recent' && <><Heading>Recent</Heading>{recents.length ? <Grid entries={recents} busy={busy} onPick={pick} onHover={setHovered} /> : <Txt kind="small" muted style={{ paddingVertical: 6 }}>Icons you add appear here.</Txt>}<Heading right={<Txt kind="label" muted>{all.length}</Txt>}>All icons</Heading></>}
      {searching && !local.length && <Txt kind="small" muted style={{ paddingVertical: 6 }}>No icon in the offline set matches “{trimmed}”.</Txt>}
      <Grid entries={shown} busy={busy} onPick={pick} onHover={setHovered} />
      {local.length > shown.length && <Button label={`Show ${Math.min(ICON_PAGE, local.length - shown.length)} more`} small variant="ghost" style={{ alignSelf: 'center' }} onPress={() => setPages(p => p + 1)} />}
      {searching && <>
        <Heading right={remote.status === 'loading' ? <Txt kind="label" muted>Searching…</Txt> : remote.status === 'done' ? <Txt kind="label" muted>{remote.entries.length}{remote.more ? '+' : ''}</Txt> : undefined}>Online · Iconify</Heading>
        {!online && <Txt kind="small" muted>Online search waits for the connection to come back.</Txt>}
        {online && trimmed.length < 2 && <Txt kind="small" muted>Type two letters or more to search 200,000+ open icons.</Txt>}
        {remote.status === 'error' && <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}><Icon name="CloudOff" size={14} color={u.c.statusWarning} /><Txt kind="small" style={{ flex: 1 }}>{remote.message}</Txt><Button label="Retry" small variant="ghost" onPress={() => fetchPage(0)} /></View>}
        {remote.status === 'done' && !remote.entries.length && <Txt kind="small" muted>Nothing online for “{trimmed}”.</Txt>}
        {!!remoteEntries.length && <Grid entries={remoteEntries} busy={busy} onPick={pick} onHover={setHovered} />}
        {remote.status === 'done' && remote.more && <Button label="Load more" small variant="ghost" style={{ alignSelf: 'center' }} onPress={() => fetchPage(remote.page + 1)} />}
        {remote.status === 'loading' && !remoteEntries.length && <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 2 }}>{Array.from({ length: 16 }, (_, i) => <View key={i} style={{ width: I.cell, height: I.cell, borderRadius: 8, backgroundColor: withAlpha(u.c.foreground, .04 + (i % 3) * .01) }} />)}</View>}
      </>}
    </ScrollView>
    {!!error && <Txt kind="small" style={{ color: u.c.statusDanger, paddingHorizontal: 12, paddingBottom: 6 }}>{error}</Txt>}
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 52, paddingHorizontal: 12, paddingVertical: 8, borderTopWidth: 1, borderColor: u.c.border, backgroundColor: u.c.surface0 }}>
      {footer}
      <Button label="Import SVG…" icon="Upload" variant="ghost" small disabled={busy} onPress={onImport} />
    </View>
  </View>;
}
