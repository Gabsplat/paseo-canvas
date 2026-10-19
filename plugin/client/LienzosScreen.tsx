/**
 * Lienzos, the home of the app (docs/redesign-2026-10.md, "Lienzos"): every Lienzo as a card with a live thumbnail of
 * its real layout, searchable and sortable. Choosing one opens it and closes the sheet.
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Icon, TextInput, capabilities, useAgent } from './host';
import type { CanvasDocument } from '../shared/model';
import type { CanvasController } from './useCanvas';
import { withAlpha, type Tone } from './color';
import { visual } from './Blocks';
import { documentContent } from './logic';
import { Button, Chip, IconButton, Segments, Txt, friendlyError, useUI } from './ui';
import { MateDrawing } from './Eggs';
import { Card, ScreenBody, ScreenEmpty, ScreenHeader, SearchField, Stagger, useScreenRoot } from './Screen';
import { filterLienzos, lienzoMeta, thumbnailModel, type LienzoSort, type LienzoSummary } from './screens';
import { tokens } from './tokens';
import { islandStyle } from './whiteboard-visuals';
import { attachConfirm, attachZoomMenu } from './web';

const S = tokens.face.screens;
/** Documents read for thumbnails, by host scope and id, kept while the revision is the same. */
const thumbCache = new Map<string, { revision: number; document: CanvasDocument }>();
/** When a card's menu or confirmation last closed by a press outside it: that press does not also open a Lienzo. */
let dismissedAt = 0;

/** Reads the listed Lienzos one at a time for their thumbnails; the open one comes from the controller. */
function useThumbnailDocuments(c: CanvasController, list: readonly LienzoSummary[], enabled: boolean) {
  const [, tick] = useState(0), key = (id: string) => `${c.workspaceId}:${id}`;
  const wanted = list.map(d => `${d.id}@${d.revision}`).join('|') + '#' + (c.view?.document.id ?? '');
  useEffect(() => {
    if (!enabled) return; let live = true;
    void (async () => {
      for (const d of list) {
        if (!live) return; const cached = thumbCache.get(key(d.id));
        if (d.id === c.view?.document.id || cached?.revision === d.revision) continue;
        try { const view = await c.api.read({ workspaceId: c.workspaceId, documentId: d.id }); thumbCache.set(key(d.id), { revision: view.document.revision, document: view.document }); if (live) tick(n => n + 1); }
        catch { /* A thumbnail that cannot be read stays a placeholder. */ }
      }
    })();
    return () => { live = false; };
  }, [enabled, wanted]);
  const open = c.view?.document; if (open) thumbCache.set(key(open.id), { revision: open.revision, document: open });
  return (id: string) => thumbCache.get(key(id))?.document;
}

/** The Lienzo drawn small: Frames as outlines, cards as marks in their tones, links as thin lines. */
export function Thumbnail({ document, c, width, height }: { document?: CanvasDocument; c: CanvasController; width: number; height: number }) {
  const u = useUI();
  const model = useMemo(() => document && width > 0 ? thumbnailModel(document, c.catalog, { width, height }, { padding: u.compact ? 10 : S.thumb.padding, toneOf: typeId => visual(c.catalog?.blockTypes.find(t => t.id === typeId)).tone as Tone }) : null, [document, c.catalog, width, height]);
  const muted = u.c.foregroundMuted;
  return <View pointerEvents="none" style={{ width, height, overflow: 'hidden' }}>
    {!model ? <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><View style={{ width: width * .5, height: 6, borderRadius: 3, backgroundColor: withAlpha(muted, .14) }} /></View>
      : model.empty ? <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6 }}><Icon name="Frame" size={18} color={withAlpha(muted, .6)} /><Txt kind="label" muted>Empty</Txt></View>
      : <>
        {model.links.map(l => { const dx = l.x2 - l.x1, dy = l.y2 - l.y1, length = Math.hypot(dx, dy);
          return <View key={l.id} style={{ position: 'absolute', left: (l.x1 + l.x2) / 2 - length / 2, top: (l.y1 + l.y2) / 2 - .5, width: length, height: 1, backgroundColor: withAlpha(muted, .7), transform: [{ rotate: `${Math.atan2(dy, dx)}rad` }] }} />; })}
        {model.items.map(item => <View key={item.id} style={{ position: 'absolute', left: item.x, top: item.y, width: item.width, height: item.height,
          ...(item.kind === 'marco' || item.kind === 'hoja' ? { borderWidth: 1, borderRadius: 3, borderColor: item.kind === 'hoja' ? withAlpha(u.c.accent, .7) : withAlpha(muted, .6), backgroundColor: withAlpha(item.kind === 'hoja' ? u.c.accent : muted, .06) }
            : item.kind === 'drawing' ? { borderRadius: 2, backgroundColor: withAlpha(muted, .22) }
            : { borderRadius: 2, backgroundColor: item.tone === 'neutro' ? withAlpha(u.c.foreground, .34) : withAlpha(u.tone(item.tone), .7) }) }} />)}
      </>}
  </View>;
}

function AgentTag({ agentId }: { agentId: string }) {
  const u = useUI(), agent = useAgent(agentId, a => ({ title: a.title, status: a.status }));
  const name = agent?.title || (agentId.startsWith('mcp:') ? agentId.slice(4) : 'Agent'), working = capabilities.runsAgents && agent?.status === 'running';
  return <View accessibilityLabel={`${name}${working ? ', working on it' : ''}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, minWidth: 0 }}>
    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: working ? u.c.accent : capabilities.runsAgents && agent?.status === 'idle' ? u.c.statusSuccess : u.c.foregroundMuted }} />
    <Txt kind="small" muted numberOfLines={1} style={{ flexShrink: 1 }}>{name}{working ? ' · working' : ''}</Txt>
  </View>;
}

type Mode = 'idle' | 'menu' | 'rename' | 'delete';
function LienzoCard({ summary, document, c, open, current, width, index, firstColumn, onOpen, onExport }: { summary: LienzoSummary; document?: CanvasDocument; c: CanvasController; open: boolean; current: boolean; width: number; index: number; firstColumn: boolean; onOpen(): void; onExport(): void }) {
  const u = useUI(), [hover, setHover] = useState(false), [mode, setMode] = useState<Mode>('idle'), [draft, setDraft] = useState(summary.title), [error, setError] = useState('');
  const busy = c.busy || c.offline, thumbWidth = Math.max(0, width - 2), thumbHeight = u.compact ? 104 : S.thumb.height;
  const trigger = useRef<View>(null), floating = useRef<View>(null), dismiss = () => { dismissedAt = Date.now(); setMode('idle'); };
  useEffect(() => { if (mode === 'rename') setDraft(summary.title); setError(''); }, [mode]);
  // The menu and the delete confirmation float from the ⋯ button: a press outside or Escape closes them, nothing moves.
  useEffect(() => { if (mode === 'menu') return attachZoomMenu(floating.current, trigger.current, dismiss); if (mode === 'delete') return attachConfirm(floating.current, trigger.current, dismiss); }, [mode]);
  const rename = async () => {
    const title = draft.trim(); if (!title || title.length > 300) { setError('Write a title of up to 300 characters.'); return; }
    if (title === summary.title) { setMode('idle'); return; }
    try {
      if (current) { const next = await c.edit([{ type: 'document.update', title }], 'Rename Lienzo'); if (!next) return; }
      else { const read = await c.api.read({ workspaceId: c.workspaceId, documentId: summary.id }); await c.api.mutate({ workspaceId: c.workspaceId, documentId: summary.id, expectedRevision: read.document.revision, operations: [{ type: 'document.update', title }], label: 'Rename Lienzo' }); await c.refreshList(); }
      setMode('idle');
    } catch (e) { setError(friendlyError(e)); }
  };
  const duplicate = async () => {
    setMode('idle');
    try { const source = current ? c.view!.document : (await c.api.read({ workspaceId: c.workspaceId, documentId: summary.id })).document, content = documentContent(source, true);
      content.title = content.title.slice(0, 300); content.selectedIds = []; await c.api.create({ workspaceId: c.workspaceId, content }); await c.refreshList(); }
    catch (e) { c.fail(e); }
  };
  const remove = async () => { setMode('idle'); await c.remove(summary.id); };
  const actions = hover || mode !== 'idle' || u.compact, P = tokens.popover, confirmWidth = Math.min(P.width.small, Math.max(width, 200));
  // Beside the ⋯ button; a first-column card narrower than the popover lines it up with its own left edge instead.
  const anchor = { ...(u.compact ? { bottom: 54 } : { top: 46 }), ...(firstColumn && width - 8 < confirmWidth ? { left: 0 } : { right: u.compact ? 6 : 8 }) };
  return <Stagger index={index} style={{ width, zIndex: mode === 'menu' || mode === 'delete' ? 10 : 0 }}>
    <View onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)}>
    {/* The actions sit beside the card, not inside its pressable, so pressing them never opens the Lienzo. */}
    <Card nativeID={`lienzo-card-${summary.id}`} label={`Open ${summary.title}`} selected={open} padding={0} onPress={mode === 'idle' ? () => { if (Date.now() - dismissedAt > 400) onOpen(); } : undefined}>
      <View style={{ height: thumbHeight, borderTopLeftRadius: S.card.radius - 1, borderTopRightRadius: S.card.radius - 1, backgroundColor: withAlpha(u.c.foreground, .025), borderBottomWidth: 1, borderColor: u.c.border, overflow: 'hidden' }}>
        <Thumbnail document={document} c={c} width={thumbWidth} height={thumbHeight} />
      </View>
      <View style={{ paddingHorizontal: 14, paddingTop: 12, paddingBottom: 14, gap: 4, minHeight: 92 }}>
        {mode === 'rename' ? <View style={{ gap: 6 }}>
          <TextInput nativeID={`lienzo-rename-${summary.id}`} accessibilityLabel="Lienzo title" autoFocus value={draft} onChangeText={setDraft} onSubmitEditing={() => { void rename(); }} onBlur={() => { void rename(); }} selectTextOnFocus
            style={[u.font('title'), { paddingHorizontal: 8, height: 34, borderRadius: 6, borderWidth: 2, borderColor: u.c.accent, backgroundColor: u.c.surface1 }]} />
          {!!error && <Txt kind="small" style={{ color: u.c.statusDanger }}>{error}</Txt>}
        </View> : <Txt kind="title" numberOfLines={2}>{summary.title}</Txt>}
        <View style={{ flexDirection: u.compact ? 'column' : 'row', alignItems: u.compact ? 'flex-start' : 'center', gap: u.compact ? 4 : 6, paddingRight: u.compact ? 36 : 0 }}><Txt kind="small" muted numberOfLines={u.compact ? 2 : 1} style={{ flexShrink: 1 }}>{lienzoMeta(summary)}</Txt>{summary.example && <Chip label="Example" tone="aviso" />}</View>
        {!!summary.agentId && <AgentTag agentId={summary.agentId} />}
      </View>
    </Card>
      {actions && mode !== 'rename' && <View ref={trigger} style={{ position: 'absolute', borderRadius: 8, borderColor: u.c.border, ...(u.compact ? { bottom: 6, right: 6, borderWidth: 0, backgroundColor: 'transparent' } : { top: 8, right: 8, borderWidth: 1, backgroundColor: u.c.surface1 }) }}>
        <IconButton icon="Ellipsis" label={`More for ${summary.title}`} active={mode === 'menu' || mode === 'delete'} onPress={() => setMode(m => m === 'idle' ? 'menu' : 'idle')} />
      </View>}
      {mode === 'menu' && <View ref={floating} nativeID={`lienzo-card-menu-${summary.id}`} accessibilityRole="menu" style={{ position: 'absolute', ...(u.compact ? { bottom: 54, right: 6 } : { top: 46, right: 8 }), width: 168, padding: 4, borderRadius: 10, borderWidth: 1, borderColor: u.c.border, backgroundColor: u.c.surface1, zIndex: 5, boxShadow: `0 12px 28px ${withAlpha('#000000', .18)}` } as object}>
        {([['Rename', 'Pencil', () => setMode('rename')], ['Duplicate', 'CopyPlus', () => { void duplicate(); }], ['Export…', 'FileOutput', () => { setMode('idle'); onExport(); }], ['Delete…', 'Trash2', () => setMode('delete')]] as const).map(([label, icon, run]) =>
          <Pressable key={label} accessibilityRole="menuitem" accessibilityLabel={label} disabled={busy} onPress={e => { e.stopPropagation(); run(); }} style={({ pressed, ...state }) => ({ minHeight: 32, paddingHorizontal: 10, borderRadius: 6, flexDirection: 'row', alignItems: 'center', gap: 10, opacity: busy ? .45 : 1, backgroundColor: pressed ? withAlpha(u.c.foreground, .1) : (state as { hovered?: boolean }).hovered ? withAlpha(u.c.foreground, .06) : 'transparent' })}>
            <Icon name={icon} size={14} color={label === 'Delete…' ? u.c.statusDanger : u.c.foregroundMuted} /><Txt style={{ color: label === 'Delete…' ? u.c.statusDanger : u.c.foreground }}>{label}</Txt></Pressable>)}
      </View>}
      {mode === 'delete' && <View ref={floating} nativeID={`lienzo-delete-${summary.id}`} accessibilityRole="alert" style={[islandStyle(u, true), { position: 'absolute', ...anchor, width: confirmWidth, padding: P.padding, gap: P.gap, zIndex: 5 }]}>
        <View style={{ flexDirection: 'row', gap: 10, alignItems: 'flex-start' }}>
          <View style={{ width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: u.wash('riesgo') }}><Icon name="Trash2" size={14} color={u.c.statusDanger} /></View>
          <Txt kind="small" style={{ flex: 1, paddingTop: 4 }}>Delete <Txt kind="small" style={{ fontWeight: '600' }}>“{summary.title}”</Txt> and its history? This cannot be undone.</Txt>
        </View>
        <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'flex-end' }}><Button label="Cancel" small variant="ghost" onPress={() => setMode('idle')} /><Button label="Delete" small variant="danger" disabled={busy} onPress={() => { void remove(); }} /></View>
      </View>}
    </View>
  </Stagger>;
}

export function LienzosScreen({ c, width, onOpen, onNew, onExport, onImport, open }: { c: CanvasController; width: number; onOpen(id: string): void; onNew(): void; onExport(id: string): void; onImport(): void; open: boolean }) {
  const u = useUI(), root = useScreenRoot(), [grid, setGrid] = useState(0), [query, setQuery] = useState(''), [sort, setSort] = useState<LienzoSort>('recent'), [loading, setLoading] = useState(false), [error, setError] = useState('');
  const list = useMemo(() => filterLienzos(c.documents, query, sort), [c.documents, query, sort]);
  const documentOf = useThumbnailDocuments(c, c.documents, open);
  useEffect(() => { if (!open) return; setLoading(true); setError(''); void c.refreshList().catch(e => setError(friendlyError(e))).finally(() => setLoading(false)); }, [open]);
  const pad = u.compact ? 16 : S.padding, inner = grid || Math.max(0, width - 2 - 2 * pad), gap = u.compact ? 12 : S.gap;
  const minColumn = u.compact ? 150 : S.thumb.minColumn, columns = Math.max(1, Math.min(4, Math.floor((inner + gap) / (minColumn + gap)))), cardWidth = Math.floor((inner - gap * (columns - 1)) / columns);
  const has = c.documents.length > 0;
  return <View nativeID="lienzo-lienzos" style={root}>
    <ScreenHeader title="Lienzos" subtitle="Every canvas you and your agents drew in. Pick one to open it, or drop a .lienzo file here to import it."
      actions={has ? <><Button label="Import…" icon="FileInput" disabled={c.offline} onPress={onImport} /><Button label="New Lienzo" icon="Plus" variant="primary" disabled={c.busy || c.offline} onPress={onNew} /></> : undefined}>
      {has && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <SearchField nativeID="lienzo-lienzos-search" value={query} onChange={setQuery} placeholder="Search Lienzos" />
        <View style={{ width: 168 }}><Segments value={sort} options={[{ value: 'recent', label: 'Recent' }, { value: 'name', label: 'Name' }]} onChange={setSort} /></View>
      </View>}
    </ScreenHeader>
    <ScreenBody>
      {!!error && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><Txt kind="small" style={{ color: u.c.statusDanger, flex: 1 }}>{error}</Txt><Button label="Retry" small onPress={() => { setError(''); void c.refreshList().catch(e => setError(friendlyError(e))); }} /></View>}
      {!has && !loading && <ScreenEmpty art={<MateDrawing size={104} />} title="No Lienzos yet." detail="Start one, or ask your agent to draw something.">
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}><Button label="New Lienzo" icon="Plus" variant="primary" disabled={c.busy || c.offline} onPress={onNew} /><Button label="Import…" icon="FileInput" disabled={c.offline} onPress={onImport} /></View>
      </ScreenEmpty>}
      {!has && loading && <Txt muted>Loading Lienzos…</Txt>}
      {has && !list.length && <ScreenEmpty title={`Nothing matches “${query.trim()}”.`} detail="Try another word, or clear the search."><Button label="Clear the search" variant="ghost" onPress={() => setQuery('')} /></ScreenEmpty>}
      {!!list.length && <View onLayout={e => setGrid(Math.floor(e.nativeEvent.layout.width))} style={{ flexDirection: 'row', flexWrap: 'wrap', gap }}>
        {list.map((d, i) => <LienzoCard key={d.id} index={i} summary={d} document={documentOf(d.id)} c={c} width={cardWidth} firstColumn={i % columns === 0} open={d.id === c.view?.document.id} current={d.id === c.view?.document.id} onOpen={() => onOpen(d.id)} onExport={() => onExport(d.id)} />)}
      </View>}
    </ScreenBody>
  </View>;
}
