/**
 * Extensions (docs/redesign-2026-10.md, "Extensions (replaces collections)"): the installed tools as cards, adding one
 * from a file with a review of the code and permissions it brings, exporting, and how to write your own. The pack
 * format is only the file's container (docs/extensions.md, "Sharing"). Shown on its own and inside Settings.
 */
import React, { useState } from 'react';
import { View } from 'react-native';
import { Icon, capabilities, openExternalUrl } from './host';
import type { CanvasPack, CatalogExtension } from '../shared/model';
import type { CanvasController } from './useCanvas';
import { Button, CheckRow, Chip, Segments, Txt, friendlyError, useUI } from './ui';
import { downloadJson, pickJsonFile } from './web';
import { Card, ScreenBody, ScreenHeader, SectionLabel, Stagger, useScreenRoot } from './Screen';
import { PERMISSION_WORDS, exportAllMine, exportOne, EXTENSION_MESSAGES, extensionActions, extensionOrigin, fileName, publishPlan, type ExtensionReview as Review, type PublishPlan } from './screens';
import { DiscoverTab, PublishCard } from './Discover';
import { extensionIcon } from './Extensions';

export const EXTENSIONS_DOCS = 'https://github.com/Gabsplat/paseo-canvas/blob/master/docs/extensions.md';
function Permissions({ extension }: { extension: Pick<CatalogExtension, 'permissions'> }) {
  return <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
    {extension.permissions.length ? extension.permissions.map(p => <Chip key={p} label={PERMISSION_WORDS[p] ?? p} tone={p === 'network' ? 'aviso' : 'acento'} icon={p === 'network' ? 'Globe' : 'PenLine'} />) : <Chip label="Reads and selects only" icon="Eye" />}
  </View>;
}

function ExtensionCard({ extension, c, width, index, busy, onExport, onRemove, onAllow, onPublish, onHelp }: { extension: CatalogExtension; c: CanvasController; width: number; index: number; busy: boolean; onExport(): void; onRemove(): void; onAllow(): void; onPublish?(): void; onHelp?(): void }) {
  const u = useUI(), [confirm, setConfirm] = useState(false), pack = extension.source !== 'local' ? c.catalog?.packs.find(p => p.id === extension.source) : undefined;
  const keepsTypes = !!pack?.blockTypes.length, siblings = pack ? pack.extensions.length - 1 : 0, waiting = !extension.granted && extension.permissions.length > 0;
  return <Stagger index={index} style={{ width }}><Card nativeID={`lienzo-extension-card-${extension.id}`} style={{ gap: 12, minHeight: 172 }}>
    <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
      <View style={{ width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: u.wash('acento') }}><Icon name={extensionIcon(extension)} size={20} color={u.c.accent} /></View>
      <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
        <Txt kind="title" numberOfLines={1}>{extension.name}</Txt>
        <Txt kind="small" muted numberOfLines={1}>{extensionOrigin(extension, c.catalog)}</Txt>
      </View>
    </View>
    <Txt muted numberOfLines={3} style={{ flexGrow: 1 }}>{extension.description || 'No description.'}</Txt>
    <Permissions extension={extension} />
    {waiting && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, padding: 8, borderRadius: 8, backgroundColor: u.wash('aviso') }}><Txt kind="small" style={{ flex: 1 }}>Not allowed yet: until you allow it, it can only read and select.</Txt><Button label="Allow" small variant="primary" disabled={busy} onPress={onAllow} /></View>}
    {confirm ? <View style={{ gap: 8, padding: 10, borderRadius: 8, backgroundColor: u.wash('riesgo') }}>
      <Txt kind="small">{pack ? siblings > 0 ? `Remove the file “${pack.name}” and its ${siblings + 1} extensions?` : `Remove “${extension.name}” and the file it came in?` : `Remove “${extension.name}”? Export it first to keep a copy.`}</Txt>
      <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'flex-end' }}><Button label="Cancel" small variant="ghost" onPress={() => setConfirm(false)} /><Button label="Remove" small variant="danger" disabled={busy} onPress={() => { setConfirm(false); onRemove(); }} /></View>
    </View> : <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
      <Button label="Export" icon="FileOutput" small variant="ghost" style={{ marginLeft: -8 }} onPress={onExport} />
      {onPublish && <Button label="Publish…" icon="GitPullRequest" small variant="ghost" onPress={onPublish} />}
      {onHelp && <Button label="Help" icon="CircleHelp" small variant="ghost" onPress={onHelp} />}
      <View style={{ flex: 1 }} />
      {keepsTypes ? <Txt kind="small" muted numberOfLines={2} style={{ flexShrink: 1, textAlign: 'right' }}>Kept: its file also has block types in use.</Txt> : <Button label="Remove" icon="Trash2" small variant="ghost" disabled={busy} onPress={() => setConfirm(true)} />}
    </View>}
  </Card></Stagger>;
}

/** The review before anything is saved: what code the file brings and what each extension asks for. */
function ReviewCard({ review, busy, onInstall, onCancel }: { review: Review; busy: boolean; onInstall(replace: boolean): void; onCancel(): void }) {
  const u = useUI(), [replace, setReplace] = useState(false), status = (id: string) => review.diff.added.includes(id) ? 'New' : review.diff.replaced.includes(id) ? 'Replaces the installed one' : 'Already installed, unchanged';
  return <Card nativeID="lienzo-extension-review" style={{ gap: 14, borderColor: u.c.accent }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}><Icon name="ShieldCheck" size={18} color={u.c.accent} /><Txt kind="title" style={{ flex: 1 }}>Review “{review.pack.name}”</Txt></View>
    <Txt muted>{review.pack.extensions.length === 1 ? 'This file brings one extension.' : `This file brings ${review.pack.extensions.length} extensions.`} Each runs isolated in its own frame, with no access to {capabilities.name}, your files or other sites’ data. Until you allow what it asks for, it can only read the Lienzo and select.</Txt>
    <View style={{ gap: 10 }}>{review.pack.extensions.map(e => <View key={e.id} style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
      <Icon name={e.icon ?? 'Puzzle'} size={16} color={u.c.foregroundMuted} />
      <View style={{ flex: 1, gap: 4 }}><View style={{ flexDirection: 'row', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}><Txt kind="bodyStrong">{e.name}</Txt><Txt kind="small" muted>{status(e.id)}</Txt></View>{!!e.description && <Txt kind="small" muted>{e.description}</Txt>}<Permissions extension={e} /></View>
    </View>)}</View>
    {review.installed && <View style={{ gap: 4 }}><CheckRow label="Replace the installed file" checked={replace} onPress={() => setReplace(!replace)} />{!replace && <Txt kind="small" muted>This file is already installed. Tick the box to replace it; permissions you gave to changed code are asked again.</Txt>}</View>}
    <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'flex-end' }}><Button label="Cancel" variant="ghost" onPress={onCancel} /><Button label={busy ? 'Installing…' : 'Install'} variant="primary" disabled={busy || (review.installed && !replace)} onPress={() => onInstall(replace)} /></View>
  </Card>;
}

export function ExtensionsContent({ c, width, embedded = false, onHelp }: { c: CanvasController; width: number; embedded?: boolean; onHelp?(id: string): void }) {
  const u = useUI(), root = useScreenRoot(), actions = extensionActions(c as unknown as Parameters<typeof extensionActions>[0]), [review, setReview] = useState<Review | null>(null), [error, setError] = useState(''), [pending, setPending] = useState(false), [note, setNote] = useState('');
  const [tab, setTab] = useState<'installed' | 'discover'>('installed'), [publish, setPublish] = useState<{ plan: PublishPlan; saved: boolean } | null>(null);
  const installed = c.catalog?.extensions ?? [], mine = exportAllMine(c.catalog), busy = pending || c.offline, web = u.layout.platform === 'web';
  const run = async (work: () => Promise<unknown>) => { setPending(true); setError(''); setNote(''); try { await work(); } catch (e) { const message = e instanceof Error ? e.message : ''; setError((Object.values(EXTENSION_MESSAGES) as string[]).includes(message) ? message : friendlyError(e)); } finally { setPending(false); } };
  const pick = () => run(async () => { const text = await pickJsonFile(); if (text !== null) setReview(await actions.review(text)); });
  const save = (pack: CanvasPack, name = fileName(pack)) => { if (!downloadJson(pack, name)) { setError('This device cannot save files here.'); return false; } setNote(`Saved ${name}.`); return true; };
  // Publish… checks the extension and saves its file at once; GitHub opens only when the person asks.
  const startPublish = (e: CatalogExtension) => { setReview(null); const plan = publishPlan(e); setPublish({ plan, saved: !plan.issues.length && save(plan.file, plan.fileName) }); };
  const fromCatalog = async (text: string) => { await run(async () => { setPublish(null); setReview(await actions.review(text)); }); };
  const pad = u.compact ? 16 : 32, inner = Math.max(0, width - 2 - 2 * pad), columns = inner >= 560 ? 2 : 1, cardWidth = Math.floor((inner - 16 * (columns - 1)) / columns);
  const toolbar = <>
    {web && <Button label="Add from file…" icon="FileInput" variant="primary" disabled={busy} onPress={() => { void pick(); }} />}
    {web && <Button label="Export all mine" icon="FileOutput" disabled={!mine} onPress={() => { if (mine) save(mine); }} />}
  </>;
  const body = <>
    {!!error && <View nativeID="lienzo-extension-error" style={{ flexDirection: 'row', gap: 8, alignItems: 'center', padding: 10, borderRadius: 8, backgroundColor: u.wash('riesgo') }}><Icon name="CircleAlert" size={14} color={u.c.statusDanger} /><Txt kind="small" style={{ flex: 1 }}>{error}</Txt></View>}
    {!!note && <Txt kind="small" muted>{note}</Txt>}
    {!web && <Txt kind="small" muted>Extensions run in the web and desktop apps. Add and export them there.</Txt>}
    {publish && <PublishCard plan={publish.plan} saved={publish.saved} onSave={() => setPublish(p => p && { ...p, saved: save(p.plan.file, p.plan.fileName) })} onClose={() => setPublish(null)} />}
    {review && <ReviewCard review={review} busy={busy} onCancel={() => setReview(null)} onInstall={replace => { void run(async () => { if (await actions.install(review, replace)) { setReview(null); setNote(`Installed “${review.pack.name}”.`); } }); }} />}
    {tab === 'discover' ? <DiscoverTab catalog={c.catalog} width={width} busy={busy} onFile={fromCatalog} onHelp={onHelp} /> : <>
    <SectionLabel>{installed.length ? `Installed · ${installed.length}` : 'Installed'}</SectionLabel>
    {!installed.length && <Card style={{ alignItems: 'center', paddingVertical: 32, gap: 8 }}><Icon name="Puzzle" size={22} color={u.c.foregroundMuted} /><Txt kind="title">No extensions yet</Txt><Txt muted style={{ textAlign: 'center', maxWidth: 420 }}>Ask your agent to write one (“make me a Lienzo tool that…”), or add a file someone shared with you.</Txt></Card>}
    {!!installed.length && <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 16 }}>{installed.map((e, i) => <ExtensionCard key={e.id} index={i} extension={e} c={c} width={cardWidth} busy={busy}
      onExport={() => save(exportOne(e))} onRemove={() => { void run(() => actions.remove(e)); }} onAllow={() => { void run(() => actions.allow(e)); }}
      onPublish={web && e.source === 'local' ? () => startPublish(e) : undefined} onHelp={onHelp ? () => onHelp('ext:' + e.id) : undefined} />)}</View>}
    <SectionLabel style={{ marginTop: 8 }}>Write your own</SectionLabel>
    <Card nativeID="lienzo-extension-write" style={{ flexDirection: u.compact ? 'column' : 'row', gap: 16, alignItems: u.compact ? 'stretch' : 'center' }}>
      <View style={{ flex: u.compact ? undefined : 1, gap: 6 }}>
        <Txt kind="bodyStrong">An extension is one small HTML page.</Txt>
        <Txt muted>It runs sandboxed and reaches the canvas through <Txt kind="code">window.lienzo</Txt>: read the Lienzo, select, and with permission, edit it in one undoable step. You or your agent write it; the same file works in Paseo and in the desktop app.</Txt>
      </View>
      <Button label={onHelp ? 'Make your own' : 'Read the guide'} icon="BookOpen" onPress={() => { if (onHelp) onHelp('make.overview'); else void openExternalUrl(EXTENSIONS_DOCS); }} />
    </Card>
    </>}
  </>;
  const tabs = <Segments value={tab} onChange={next => { setTab(next); setError(''); setNote(''); }} options={[{ value: 'installed', label: 'Installed' }, { value: 'discover', label: 'Discover' }]} />;
  if (embedded) return <View style={{ gap: 16 }}><View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}><View nativeID="lienzo-extension-tabs" style={{ width: 220 }}>{tabs}</View><View style={{ flex: 1 }} />{toolbar}</View>{body}</View>;
  return <View nativeID="lienzo-extensions" style={root}>
    <ScreenHeader title="Extensions" subtitle="Small tools for the + catalog and the Properties panel. Add them, discover what others made, share yours, or write your own." actions={toolbar}><View nativeID="lienzo-extension-tabs" style={{ width: 220 }}>{tabs}</View></ScreenHeader>
    <ScreenBody>{body}</ScreenBody>
  </View>;
}
