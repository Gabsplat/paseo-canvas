/**
 * The extensions catalog in the Extensions screen (shared/marketplace.ts): Discover lists what others published and
 * installs through the same review as a file; Publish prepares one's own extension as a pull request on GitHub, in the
 * person's browser. The app holds no GitHub token.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View } from 'react-native';
import { Icon, openExternalUrl } from './host';
import { cachedIndex, downloadEntry, loadIndex, marketplaceUrls, MarketplaceError, MARKETPLACE, type LoadedIndex, type MarketplaceDeps, type MarketplaceEntry } from '../shared/marketplace';
import type { CanvasCatalog } from '../shared/model';
import { entryStatus, filterEntries, type PublishPlan } from './screens';
import { Card, ScreenEmpty, SearchField, SectionLabel, Stagger } from './Screen';
import { Button, Chip, Txt, useUI } from './ui';
import { browserCache, fetchPublicText, sha256Hex } from './web';

export const marketplaceDeps: MarketplaceDeps = { fetchText: fetchPublicText, cache: browserCache('lienzo.marketplace.index.v1'), sha256: sha256Hex };
const ago = (at: number) => { const minutes = Math.max(0, Math.round((Date.now() - at) / 60000)); return minutes < 1 ? 'just now' : minutes < 60 ? `${minutes} min ago` : minutes < 1440 ? `${Math.round(minutes / 60)} h ago` : `${Math.round(minutes / 1440)} d ago`; };

function EntryCard({ entry, status, width, index, busy, onInstall }: { entry: MarketplaceEntry; status: 'new' | 'installed' | 'update'; width: number; index: number; busy: boolean; onInstall(): void }) {
  const u = useUI(), first = entry.extensions[0], permissions = [...new Set(entry.extensions.flatMap(e => e.permissions))];
  return <Stagger index={index} style={{ width }}><Card nativeID={`lienzo-discover-card-${entry.id}`} style={{ gap: 12, minHeight: 168 }}>
    <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
      <View style={{ width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: u.wash('turquesa') }}><Icon name={first.icon ?? 'Puzzle'} size={20} color={u.tone('turquesa')} /></View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Txt kind="title" numberOfLines={1}>{entry.name}</Txt>
        <Txt kind="small" muted numberOfLines={1}>{[entry.author ? `By ${entry.author}` : 'From the catalog', entry.extensions.length > 1 ? `${entry.extensions.length} tools` : '', entry.extensions.some(e => e.docs) ? 'Has a Help page' : ''].filter(Boolean).join(' · ')}</Txt>
      </View>
    </View>
    <Txt muted numberOfLines={3} style={{ flexGrow: 1 }}>{entry.description || first.description || 'No description.'}</Txt>
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>{permissions.length ? permissions.map(p => <Chip key={p} label={p === 'network' ? 'Loads from the internet' : 'Changes the canvas'} tone={p === 'network' ? 'aviso' : 'acento'} icon={p === 'network' ? 'Globe' : 'PenLine'} />) : <Chip label="Reads and selects only" icon="Eye" />}</View>
    <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
      <Button label="Source" icon="ExternalLink" small variant="ghost" style={{ marginLeft: -8 }} onPress={() => { void openExternalUrl(marketplaceUrls().folder(entry.id)); }} />
      <View style={{ flex: 1 }} />
      {status === 'installed' ? <Chip label="Installed" tone="exito" icon="Check" /> : <Button label={status === 'update' ? 'Update…' : 'Install…'} icon="Download" small variant="primary" disabled={busy} onPress={onInstall} />}
    </View>
  </Card></Stagger>;
}

/** Discover: the published list (kept for offline use), search, and Install, which ends in the usual review. */
export function DiscoverTab({ catalog, width, busy, deps = marketplaceDeps, onFile, onHelp }: { catalog: CanvasCatalog | null; width: number; busy: boolean; deps?: MarketplaceDeps; onFile(text: string): Promise<void>; onHelp?(id: string): void }) {
  const u = useUI(), [loaded, setLoaded] = useState<LoadedIndex | null>(() => cachedIndex(deps)), [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading'), [failure, setFailure] = useState(''), [query, setQuery] = useState(''), [installing, setInstalling] = useState<string | null>(null), [error, setError] = useState('');
  const alive = useRef(true); useEffect(() => () => { alive.current = false; }, []);
  const refresh = () => { setState('loading'); setFailure(''); void loadIndex(deps).then(next => { if (!alive.current) return; setLoaded(next); setState('ready'); }, (e: unknown) => { if (!alive.current) return; setFailure(e instanceof MarketplaceError ? e.message : 'The catalog could not be reached.'); setState('failed'); }); };
  useEffect(refresh, []);
  const entries = useMemo(() => filterEntries(loaded?.index.entries ?? [], query), [loaded, query]);
  const pad = u.compact ? 16 : 32, inner = Math.max(0, width - 2 - 2 * pad), columns = inner >= 560 ? 2 : 1, cardWidth = Math.floor((inner - 16 * (columns - 1)) / columns);
  const install = (entry: MarketplaceEntry) => { setInstalling(entry.id); setError(''); void downloadEntry(deps, entry).then(onFile).catch((e: unknown) => setError(e instanceof Error ? e.message : 'It could not be installed.')).finally(() => { if (alive.current) setInstalling(null); }); };
  if (u.layout.platform !== 'web') return <ScreenEmpty title="Discover runs in the web and desktop apps" detail="Extensions run there, so the catalog lives there too." />;
  return <View nativeID="lienzo-discover" style={{ gap: 16 }}>
    <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <SearchField nativeID="lienzo-discover-search" value={query} onChange={setQuery} placeholder="Search the catalog" />
      <Button label={state === 'loading' ? 'Reading…' : 'Refresh'} icon="RefreshCw" small variant="ghost" disabled={state === 'loading'} onPress={refresh} />
    </View>
    {!!error && <View nativeID="lienzo-discover-error" style={{ flexDirection: 'row', gap: 8, alignItems: 'center', padding: 10, borderRadius: 8, backgroundColor: u.wash('riesgo') }}><Icon name="CircleAlert" size={14} color={u.c.statusDanger} /><Txt kind="small" style={{ flex: 1 }}>{error}</Txt></View>}
    {loaded && (loaded.stale || state === 'failed') && <View nativeID="lienzo-discover-stale" style={{ flexDirection: 'row', gap: 8, alignItems: 'center', padding: 10, borderRadius: 8, backgroundColor: u.wash('aviso') }}>
      <Icon name="WifiOff" size={14} color={u.tone('aviso')} /><Txt kind="small" style={{ flex: 1 }}>Offline: showing the list read {ago(loaded.fetchedAt)}. {loaded.stale ?? failure}</Txt>
    </View>}
    {!loaded && state === 'loading' && <Card style={{ alignItems: 'center', paddingVertical: 32, gap: 8 }}><Icon name="Store" size={22} color={u.c.foregroundMuted} /><Txt muted>Reading the catalog…</Txt></Card>}
    {!loaded && state === 'failed' && <Card nativeID="lienzo-discover-offline" style={{ alignItems: 'center', paddingVertical: 32, gap: 10 }}><Icon name="WifiOff" size={22} color={u.c.foregroundMuted} /><Txt kind="title">The catalog is out of reach</Txt><Txt muted style={{ textAlign: 'center', maxWidth: 420 }}>{failure} Extensions you already installed keep working.</Txt><Button label="Try again" icon="RefreshCw" onPress={refresh} /></Card>}
    {loaded && <>
      <SectionLabel right={<Txt kind="small" muted>{MARKETPLACE.repository}</Txt>}>{query.trim() ? `${entries.length} of ${loaded.index.entries.length}` : `In the catalog · ${loaded.index.entries.length}`}</SectionLabel>
      {!entries.length && <Txt muted>{query.trim() ? `Nothing in the catalog matches “${query.trim()}”.` : 'The catalog is empty for now. Yours could be the first.'}</Txt>}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16 }}>{entries.map((entry, i) => <EntryCard key={entry.id} entry={entry} index={i} width={cardWidth} status={entryStatus(entry, catalog)} busy={busy || installing !== null} onInstall={() => install(entry)} />)}</View>
    </>}
    <Card nativeID="lienzo-discover-publish" style={{ flexDirection: u.compact ? 'column' : 'row', gap: 16, alignItems: u.compact ? 'stretch' : 'center' }}>
      <View style={{ flex: u.compact ? undefined : 1, gap: 6 }}><Txt kind="bodyStrong">Share yours here</Txt><Txt muted>Press Publish… on an extension you made: Lienzo checks it, saves its file and opens GitHub to propose it with a pull request. Once merged, it shows here for everyone.</Txt></View>
      <Button label="How publishing works" icon="BookOpen" onPress={() => { if (onHelp) onHelp('ext.publish'); else void openExternalUrl(marketplaceUrls().contributing); }} />
    </Card>
  </View>;
}

/** Publish…: the checks, the saved file, and the GitHub page that proposes it. */
export function PublishCard({ plan, saved, onSave, onClose }: { plan: PublishPlan; saved: boolean; onSave(): void; onClose(): void }) {
  const u = useUI(), blocked = plan.issues.length > 0, name = plan.file.extensions[0]?.name ?? plan.file.name;
  const step = (n: number, done: boolean, title: string, detail: string, action?: React.ReactNode) => <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
    <View style={{ width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: done ? u.wash('exito') : u.wash('acento') }}>{done ? <Icon name="Check" size={13} color={u.tone('exito')} /> : <Txt kind="small" style={{ fontWeight: '600', color: u.c.accent }}>{n}</Txt>}</View>
    <View style={{ flex: 1, gap: 4 }}><Txt kind="bodyStrong">{title}</Txt><Txt kind="small" muted>{detail}</Txt>{action}</View>
  </View>;
  return <Card nativeID="lienzo-extension-publish" style={{ gap: 14, borderColor: u.c.accent }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}><Icon name="GitPullRequest" size={18} color={u.c.accent} /><Txt kind="title" style={{ flex: 1 }}>Publish “{name}”</Txt></View>
    {blocked ? <View style={{ gap: 6, padding: 10, borderRadius: 8, backgroundColor: u.wash('riesgo') }}>{plan.issues.map(issue => <Txt key={issue} kind="small">{issue}</Txt>)}</View> : <>
      {step(1, true, 'Checked', plan.warnings.length ? `Ready, with ${plan.warnings.length === 1 ? 'a suggestion' : 'suggestions'}: ${plan.warnings.join(' ')}` : 'It is a valid extension file, ready for the catalog.')}
      {step(2, saved, saved ? `Saved ${plan.fileName}` : 'Save the file', `The catalog keeps it at ${plan.path}.`, !saved ? <View style={{ flexDirection: 'row' }}><Button label="Save the file" icon="FileOutput" small onPress={onSave} /></View> : undefined)}
      {step(3, false, 'Propose it on GitHub', plan.method === 'prefilled'
        ? 'GitHub opens with the file filled in. Sign in, press Commit changes, then Propose changes and Create pull request. GitHub makes your copy of the catalog for you.'
        : 'The file is too long for a link: GitHub opens the folder\'s upload page. Drag the saved extension.json in, then propose the change and create the pull request.',
        <View style={{ flexDirection: 'row' }}><Button label="Open GitHub" icon="ExternalLink" small variant="primary" onPress={() => { void openExternalUrl(plan.url); }} /></View>)}
      <Txt kind="small" muted>The catalog's checks run on the pull request. Lienzo never asks for a GitHub token: everything happens in your browser.</Txt>
    </>}
    <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}><Button label="Done" variant="ghost" onPress={onClose} /></View>
  </Card>;
}
