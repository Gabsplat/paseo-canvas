/**
 * Help: the in-app wiki (docs/design.md §35.7). A rail of every topic grouped by section, with search across every
 * page, and the page itself: what it is for, how to do it by hand, what to say to an agent, tips, its keys and a small
 * picture. The words come from shared/wiki, the same pages the agent reads with canvas_catalog help. Installed
 * extensions add their own pages under Extensions.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Icon, ScrollView, copyText } from './host';
import { allWikiPages, getWikiPage, HOME_PAGE, searchWiki, wikiOutline, WIKI_SECTIONS, type DocumentedExtension, type WikiPage } from '../shared/wiki';
import type { ResolvedShortcut } from './shortcuts';
import { SHORTCUT_GROUPS } from './shortcuts';
import { withAlpha } from './color';
import { tokens } from './tokens';
import { Markdown } from './Markdown';
import { WikiArt } from './WikiArt';
import { Card, SearchField, SectionLabel, labelStyle } from './Screen';
import { Button, Chip, IconButton, Txt, useUI } from './ui';

const W = tokens.face.wiki, S = tokens.face.screens;
type Props = { width: number; page: string; onPage(id: string): void; extensions: readonly DocumentedExtension[]; shortcuts: readonly ResolvedShortcut[]; chips(combo: string): string[]; onTour?(): void };

function Keys({ combo, chips }: { combo: string; chips(combo: string): string[] }) {
  const u = useUI();
  return <View style={{ flexDirection: 'row', gap: 3 }}>{chips(combo).map((part, i) => <View key={i} style={{ minWidth: 22, height: 22, paddingHorizontal: 6, borderRadius: 5, borderWidth: 1, borderBottomWidth: 2, borderColor: u.c.border, backgroundColor: u.c.surface1, alignItems: 'center', justifyContent: 'center' }}><Txt kind="keys">{part}</Txt></View>)}</View>;
}
function RailRow({ page, active, onPress }: { page: WikiPage; active: boolean; onPress(): void }) {
  const u = useUI();
  return <Pressable nativeID={`lienzo-help-item-${page.id}`} accessibilityRole={'tab' as never} accessibilityLabel={page.title} accessibilityState={{ selected: active }} onPress={onPress}
    style={({ pressed, ...state }) => ({ minHeight: W.railRow, paddingHorizontal: 10, borderRadius: 8, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: active ? withAlpha(u.c.accent, S.railWash) : pressed ? withAlpha(u.c.foreground, .08) : (state as { hovered?: boolean }).hovered ? withAlpha(u.c.foreground, .05) : 'transparent' })}>
    <Icon name={page.icon} size={15} color={active ? u.c.accent : u.c.foregroundMuted} /><Txt numberOfLines={1} style={{ flex: 1, fontWeight: active ? '600' : '400' }}>{page.title}</Txt>
  </Pressable>;
}
/** The topics: every section with its pages, or the search results while there is a query. */
function Topics({ pages, page, query, onPage }: { pages: readonly WikiPage[]; page: string; query: string; onPage(id: string): void }) {
  const u = useUI(), results = useMemo(() => searchWiki(pages, query), [pages, query]), outline = useMemo(() => wikiOutline(pages), [pages]);
  if (query.trim()) return <View nativeID="lienzo-help-results" style={{ gap: 2 }}>
    <Txt kind="label" muted style={{ ...labelStyle, paddingHorizontal: 10, paddingVertical: 8 }}>{results.length ? `${results.length} ${results.length === 1 ? 'page' : 'pages'}` : 'No pages'}</Txt>
    {results.map(p => <RailRow key={p.id} page={p} active={p.id === page} onPress={() => onPage(p.id)} />)}
    {!results.length && <Txt kind="small" muted style={{ paddingHorizontal: 10 }}>Nothing matches “{query.trim()}”. Try fewer words, or ask your agent.</Txt>}
  </View>;
  return <View style={{ gap: 14 }}>{outline.map(section => <View key={section.id} style={{ gap: 1 }}>
    <Txt kind="label" muted style={{ ...labelStyle, paddingHorizontal: 10, paddingBottom: 4, color: u.c.foregroundMuted }}>{section.title}</Txt>
    {section.pages.map(p => <RailRow key={p.id} page={p} active={p.id === page} onPress={() => onPage(p.id)} />)}
  </View>)}</View>;
}

function Steps({ steps }: { steps: readonly string[] }) {
  const u = useUI();
  return <View style={{ gap: 10 }}>{steps.map((step, i) => <View key={i} style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
    <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: u.wash('acento'), alignItems: 'center', justifyContent: 'center', marginTop: -1 }}><Txt kind="small" style={{ fontWeight: '600', color: u.c.accent }}>{i + 1}</Txt></View>
    <Txt style={{ flex: 1, lineHeight: 21 }}>{step}</Txt>
  </View>)}</View>;
}
function Prompt({ text }: { text: string }) {
  const u = useUI(), [copied, setCopied] = useState(false);
  useEffect(() => { if (!copied) return; const t = setTimeout(() => setCopied(false), 1600); return () => clearTimeout(t); }, [copied]);
  return <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 14, paddingRight: 4, paddingVertical: 6, borderRadius: 10, borderWidth: 1, borderColor: u.c.border, backgroundColor: u.c.surface0 }}>
    <Icon name="MessageSquare" size={14} color={u.c.foregroundMuted} />
    <Txt selectable style={{ flex: 1, lineHeight: 20 }}>“{text}”</Txt>
    <IconButton icon={copied ? 'Check' : 'Copy'} label={copied ? 'Copied' : 'Copy the prompt'} onPress={() => { void copyText(text).then(() => setCopied(true)); }} />
  </View>;
}
function ShortcutTable({ shortcuts, chips }: { shortcuts: readonly ResolvedShortcut[]; chips(combo: string): string[] }) {
  const u = useUI();
  return <View nativeID="lienzo-help-shortcuts" style={{ gap: 16 }}>{SHORTCUT_GROUPS.map(group => { const rows = shortcuts.filter(s => s.group === group && !s.id.startsWith('pinned.')); if (!rows.length) return null;
    return <View key={group} style={{ gap: 2 }}><SectionLabel>{group}</SectionLabel>{rows.map(s => <View key={s.id} style={{ flexDirection: 'row', alignItems: 'center', minHeight: 34, gap: 12, borderBottomWidth: 1, borderColor: withAlpha(u.c.border, .6) }}>
      <Txt style={{ flex: 1 }} numberOfLines={1}>{s.label}</Txt>
      {s.assigned.length ? <View style={{ flexDirection: 'row', gap: 6 }}>{s.assigned.map(combo => <Keys key={combo} combo={combo} chips={chips} />)}</View> : <Txt kind="small" muted>Unassigned</Txt>}
    </View>)}</View>; })}</View>;
}

function Page({ page, pages, width, onPage, shortcuts, chips, extension, onTour }: { page: WikiPage; pages: readonly WikiPage[]; width: number; onPage(id: string): void; shortcuts: readonly ResolvedShortcut[]; chips(combo: string): string[]; extension?: DocumentedExtension; onTour?(): void }) {
  const u = useUI(), pad = u.compact ? 16 : S.padding, inner = Math.min(W.pageMax, Math.max(0, width - 2 * pad)), wide = inner >= W.sideBySide;
  const section = WIKI_SECTIONS.find(s => s.id === page.section), keys = page.shortcut ? shortcuts.find(s => s.id === page.shortcut) : undefined, related = (page.related ?? []).map(id => getWikiPage(id, pages)).filter((p): p is WikiPage => !!p);
  const art = <Card padding={14} style={{ alignSelf: wide ? 'flex-start' : 'stretch', alignItems: 'center' }}><WikiArt id={page.art} width={wide ? W.art : Math.min(inner - 30, W.art * 1.4)} nativeID={`lienzo-help-art-${page.id}`} /></Card>;
  const heading = (title: string) => <Txt kind="heading" accessibilityRole="header" style={{ marginTop: 6 }}>{title}</Txt>;
  return <View nativeID={`lienzo-help-page-${page.id}`} style={{ width: inner, gap: 14 }}>
    {/* The picture keeps clear of the sheet's close button in the corner. */}
    <View style={{ flexDirection: wide ? 'row' : 'column-reverse', gap: 20, alignItems: wide ? 'flex-start' : 'stretch', marginRight: wide && !u.compact ? 36 : 0 }}>
      <View style={{ flex: wide ? 1 : undefined, gap: 6, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><Icon name={section?.icon ?? 'BookOpen'} size={13} color={u.c.accent} /><Txt kind="label" style={{ ...labelStyle, color: u.c.accent }}>{section?.title ?? 'Help'}</Txt></View>
        <Txt kind="display" accessibilityRole="header" style={{ fontSize: u.compact ? 24 : S.title.size, lineHeight: u.compact ? 30 : S.title.lineHeight, letterSpacing: S.title.letterSpacing, marginRight: u.compact ? 40 : 0 }}>{page.title}</Txt>
        <Txt muted style={{ fontSize: 15, lineHeight: 22 }}>{page.summary}</Txt>
        {keys && keys.assigned[0] && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 }}><Txt kind="small" muted>Shortcut</Txt><Keys combo={keys.assigned[0]} chips={chips} /></View>}
        {extension && <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>{extension.permissions.length ? extension.permissions.map(p => <Chip key={p} label={p === 'edit' ? 'Changes the canvas' : p === 'view' ? 'Moves the view' : 'Loads from the internet'} tone={p === 'network' ? 'aviso' : 'acento'} />) : <Chip label="Reads and selects only" icon="Eye" />}</View>}
      </View>
      {art}
    </View>
    <Txt style={{ lineHeight: 22, fontSize: 14 }}>{page.purpose}</Txt>
    {!!page.byHand?.length && <>{heading('By hand')}<Steps steps={page.byHand} /></>}
    {!!page.askAgent?.length && <>{heading('Ask your agent')}<Txt kind="small" muted>Say it in your agent’s chat. The canvas never sends anything to the agent; it reads what you select.</Txt><View style={{ gap: 8 }}>{page.askAgent.map(text => <Prompt key={text} text={text} />)}</View></>}
    {!!page.tips?.length && <>{heading('Tips')}<View style={{ gap: 8 }}>{page.tips.map(tip => <View key={tip} style={{ flexDirection: 'row', gap: 10 }}><Icon name="Lightbulb" size={14} color={u.tone('aviso')} /><Txt style={{ flex: 1, lineHeight: 21 }}>{tip}</Txt></View>)}</View></>}
    {page.id === 'shortcuts.keys' && <ShortcutTable shortcuts={shortcuts} chips={chips} />}
    {!!page.body && <View style={{ marginTop: 6 }}><Markdown source={page.body} onHelp={onPage} nativeID={`lienzo-help-body-${page.id}`} /></View>}
    {extension && !page.body && <Card style={{ gap: 6 }}><Txt kind="bodyStrong">This extension has no guide of its own.</Txt><Txt muted>Its maker can add one: a short Markdown page in its manifest’s docs field. See Make your own.</Txt></Card>}
    {page.id === 'start.lienzo' && onTour && <View style={{ flexDirection: 'row', marginTop: 4 }}><Button label="Play the four-scene tour" icon="Play" onPress={onTour} /></View>}
    {!!related.length && <>{heading('Related')}<View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>{related.map(p => <Pressable key={p.id} nativeID={`lienzo-help-related-${p.id}`} accessibilityRole="link" accessibilityLabel={p.title} onPress={() => onPage(p.id)}
      style={({ pressed, ...state }) => ({ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, minHeight: 32, borderRadius: 16, borderWidth: 1, borderColor: (state as { hovered?: boolean }).hovered ? withAlpha(u.c.foreground, .3) : u.c.border, backgroundColor: pressed ? u.c.surface2 : u.c.surface0 })}>
      <Icon name={p.icon} size={13} color={u.c.foregroundMuted} /><Txt kind="small" style={{ fontWeight: '600' }}>{p.title}</Txt></Pressable>)}</View></>}
  </View>;
}

export function WikiContent({ width, page: requested, onPage, extensions, shortcuts, chips, onTour }: Props) {
  const u = useUI(), [query, setQuery] = useState(''), [index, setIndex] = useState(false), scroll = useRef<React.ComponentRef<typeof ScrollView>>(null);
  const pages = useMemo(() => allWikiPages(extensions), [extensions]);
  const page = getWikiPage(requested, pages) ?? getWikiPage(HOME_PAGE, pages)!;
  const extension = page.id.startsWith('ext:') ? extensions.find(e => 'ext:' + e.id === page.id) : undefined;
  useEffect(() => { scroll.current?.scrollTo({ y: 0, animated: false }); }, [page.id]);
  const go = (id: string) => { setIndex(false); onPage(id); };
  const search = <SearchField nativeID="lienzo-help-search" value={query} onChange={setQuery} placeholder="Search Help" />;
  if (u.compact) {
    if (index) return <View nativeID="lienzo-help" style={{ flex: 1, minHeight: 0 }}>
      <View style={{ paddingHorizontal: 16, paddingTop: 14, paddingBottom: 10, gap: 10 }}><Txt kind="display" style={{ fontSize: 24, lineHeight: 30, marginRight: 44 }}>Help</Txt><View style={{ flexDirection: 'row' }}>{search}</View></View>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 6, paddingBottom: 24 }}><Topics pages={pages} page={page.id} query={query} onPage={go} /></ScrollView>
    </View>;
    return <View nativeID="lienzo-help" style={{ flex: 1, minHeight: 0 }}>
      <View style={{ paddingHorizontal: 8, paddingTop: 8, minHeight: 52, flexDirection: 'row', alignItems: 'center' }}><Button label="All topics" icon="ChevronLeft" variant="ghost" onPress={() => setIndex(true)} /></View>
      <ScrollView ref={scroll} style={{ flex: 1 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 32 }}><Page page={page} pages={pages} width={width} onPage={go} shortcuts={shortcuts} chips={chips} extension={extension} onTour={onTour} /></ScrollView>
    </View>;
  }
  return <View nativeID="lienzo-help" style={{ flex: 1, minHeight: 0, flexDirection: 'row' }}>
    <View nativeID="lienzo-help-rail" accessibilityRole={'tablist' as never} style={{ width: W.rail, borderRightWidth: 1, borderColor: u.c.border, backgroundColor: u.c.surface0 }}>
      <View style={{ paddingHorizontal: 12, paddingTop: 22, paddingBottom: 10, gap: 10 }}>
        <Txt kind="label" muted style={{ ...labelStyle, paddingHorizontal: 10 }}>Help</Txt>
        <View style={{ flexDirection: 'row' }}>{search}</View>
      </View>
      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 12, paddingBottom: 16 }}><Topics pages={pages} page={page.id} query={query} onPage={go} /></ScrollView>
    </View>
    <ScrollView ref={scroll} style={{ flex: 1 }} showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: S.padding, paddingTop: 28, paddingBottom: S.padding }}>
      <Page page={page} pages={pages} width={width - W.rail} onPage={go} shortcuts={shortcuts} chips={chips} extension={extension} onTour={onTour} />
    </ScrollView>
  </View>;
}
