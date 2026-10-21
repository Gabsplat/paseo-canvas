import React, { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Pressable, View } from 'react-native';
import { EXTENSION_API, EXTENSION_FORBIDDEN_OPERATIONS, EXTENSION_LIMITS, EXTENSION_TONES, extensionDocument, extensionVariables, extensionVariableTarget, isExtensionKey, routeExtensionKey, type ExtensionTone, type ExtensionView } from '../shared/extensions';
import type { CanvasOperation, CatalogExtension, ExtensionPermission } from '../shared/model';
import type { CommentAnchor, CommentsView } from '../shared/comments';
import { isDark, withAlpha } from './color';
import { hideRequest, presentationInputIssue, resolvePresentation, type ResolvedPresentation } from '../shared/presentation';
import { closesOnEscape, takesPointer, type Box, type SurfacePlacement } from './extension-ui';
import { tokens } from './tokens';
import { islandStyle } from './whiteboard-visuals';
import { Icon } from './host';
import { layoutCanvas } from './logic';
import { Button, IconButton, Txt, useUI } from './ui';
import { capabilities } from './host';
import type { CanvasController } from './useCanvas';
import { listenExtensionKeys, WebExtension, type ExtensionCall } from './web';
import { ContextChannel, ViewPump, contextDocument, contextEntities, isContextDocumentMode, type ContextDocumentMode, type ContextPart } from '../shared/extension-context';
import { EMPTY_SAFE_AREA, useSafeRect, type SafeArea, type SafeAreaRegistry } from './safe-area';

const PERMISSION: Record<ExtensionPermission, string> = { edit: 'change the canvas', network: 'load things from the internet', view: 'move the view of the canvas', variables: 'move the values of variables' };
export const extensionIcon = (extension: CatalogExtension) => extension.icon ?? 'Puzzle';
const TONE_NAMES = { accent: 'acento', success: 'exito', warning: 'aviso', violet: 'violeta' } as const;
/** The colour of an extension's icon, title tile and overlay chip: its manifest accent, else Lienzo's accent. */
export const extensionAccent = (extension: Pick<CatalogExtension, 'presentation'>, u: ReturnType<typeof useUI>) => {
  const a = extension.presentation?.accent; return !a ? u.c.accent : a.startsWith('#') ? a : u.tone(TONE_NAMES[a as keyof typeof TONE_NAMES] ?? 'acento');
};
const X = tokens.extensionUi;
const list = (items: string[]) => items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;

/**
 * What an open extension may see and do beside the document, given by the panel: the camera (with "view"), and a
 * highlight on the canvas that is never saved and goes when the tool closes.
 */
export type ExtensionStage = {
  view(): ExtensionView | null; fit(ids: string[], options?: { padding?: number; animate?: boolean }): boolean; subscribe(listener: () => void): () => void;
  highlight(owner: string, next: { ids: string[]; dim: boolean; tone: ExtensionTone } | null): void;
  /** lienzo.hide / lienzo.show: things off this screen for an effect, per extension, back when it closes. */
  hide(owner: string, ids: string[], ms: number | null): void; show(owner: string, ids: string[] | null): void;
  /** lienzo.view.snapshot: a picture of those things as drawn, where the host can take one (the desktop app). */
  snapshot: ((ids: string[]) => Promise<{ url: string; rect: Box } | null>) | null;
  /** The raw camera (scale and the world rect on screen), for the per-frame messages; null before the canvas measured. */
  camera(): { scale: number; bounds: Box } | null;
  /** What Lienzo's own UI covers (safe-area.ts), and lienzo.ui.immersive: Hide all UI for this owner, plus the window's full screen. */
  safeArea: SafeAreaRegistry | null;
  immersive(owner: string, on: boolean): Promise<boolean>;
  /** Leaves an owner's immersive mode (Esc in its page); false when it did not hold it. */
  exitImmersive(owner: string): boolean;
  /** Whether Lienzo's UI is hidden now (⌘. or an extension), and who asked. */
  chrome(): { hidden: boolean; owner: string | null };
};
/** One open extension: how it shows now, whether an overlay holds the pointer, and what an agent handed it. */
export type OpenExtension = { id: string; ui: ResolvedPresentation; capturing: boolean; input?: { value: unknown; seq: number }; anchorId?: string };
/** What lienzo.ui.state says: the presentation, where the frame is on the canvas area, what Lienzo's UI covers there, and whether it is hidden. */
type UiState = ResolvedPresentation & { capturing: boolean; canSnapshot: boolean; anchorId: string | null; rect: Box; safeArea: SafeArea; immersive: boolean };
const NO_REGISTRY = { subscribe: () => () => {}, area: () => EMPTY_SAFE_AREA({ width: 0, height: 0 }) };
const frameLater = (run: () => void): unknown => { const raf = (globalThis as { requestAnimationFrame?: (f: () => void) => number }).requestAnimationFrame; return raf ? raf(run) : setTimeout(run, 16); };
const cancelFrame = (id: unknown) => { const cancel = (globalThis as { cancelAnimationFrame?: (id: number) => void }).cancelAnimationFrame; if (cancel) cancel(id as number); else clearTimeout(id as ReturnType<typeof setTimeout>); };
/**
 * One extension running: its frame, the context it is told, and the answers to what it asks for. Everything an
 * extension does goes through here, so what it may do is decided in one place: reading and selecting are always
 * allowed, editing only with the permission, and an imported one holds none until granted. Nothing reaches the agent.
 */
function ExtensionFrame({ extension, controller: c, stage, onOpen, onClose, entry, rect, onEntry, onEscape, onHover, transparent, surface }: { extension: CatalogExtension; controller: CanvasController; stage?: ExtensionStage; onOpen(id: string): void; onClose?(): void;
  entry?: OpenExtension; rect?: Box; onEntry?(patch: Partial<OpenExtension>): void; onEscape?(): void; onHover?(inside: boolean): void; transparent?: boolean; surface?: string }) {
  const u = useUI(), doc = c.view!.document, allowed = extension.granted ? extension.permissions : [], sees = allowed.includes('view') && !!stage;
  const channel = useRef<((message: Record<string, unknown>) => void) | null>(null), [keys, setKeys] = useState<string[]>([]);
  const send = (message: Record<string, unknown>) => channel.current?.(message), live = useRef({ stage, sees }); live.current = { stage, sees };
  // The camera, to an extension holding "view" (docs/extensions.md, "Cost model"): while it moves, one small camera
  // message per animation frame to a page that listens; once still, the exact view. Moving the camera never touches the document.
  const pump = useRef<ViewPump | null>(null);
  pump.current ??= new ViewPump({ frame: frameLater, cancel: cancelFrame, now: () => Date.now(), camera: () => live.current.stage?.camera() ?? null, view: () => live.current.stage?.view() ?? null, send: m => { if (live.current.sees) send(m); } });
  useEffect(() => { if (!sees) return; const stop = stage!.subscribe(() => pump.current!.moved()); return () => { stop(); pump.current!.stop(); }; }, [sees, stage]);
  useEffect(() => { if (sees) pump.current!.moved(); }, [doc.revision, sees]);
  useEffect(() => () => { stage?.highlight(extension.id, null); stage?.show(extension.id, null); void stage?.immersive(extension.id, false); }, [stage, extension.id]);
  // lienzo.ui.state, sent when it changes; and input from an agent, once per open (lienzo.input, lienzo.onInput).
  const registry = stage?.safeArea ?? NO_REGISTRY, safeArea = useSyncExternalStore(registry.subscribe.bind(registry), () => registry.area(extension.id)), chrome = stage?.chrome() ?? { hidden: false, owner: null };
  const ui: UiState | null = entry ? { ...entry.ui, capturing: entry.capturing && entry.ui.mode === 'overlay', canSnapshot: sees && !!stage?.snapshot, anchorId: entry.anchorId ?? null, rect: rect ?? { x: 0, y: 0, width: 0, height: 0 }, safeArea, immersive: chrome.hidden } : null;
  const uiKey = JSON.stringify(ui), uiSent = useRef(''), inputSent = useRef(-1), sendUi = useRef<() => void>(() => {});
  sendUi.current = () => {
    if (ui && uiKey !== uiSent.current) { uiSent.current = uiKey; channel.current?.({ type: 'ui', ui }); }
    const input = entry?.input; if (input && input.seq !== inputSent.current && !presentationInputIssue(input.value)) { inputSent.current = input.seq; channel.current?.({ type: 'input', input: input.value }); }
  };
  useEffect(() => { sendUi.current(); }, [uiKey, entry?.input?.seq]);
  // Variables, to a page that asked with lienzo.variables.onChange: now, and at most every 50 ms while values or
  // declarations change. Runtime values never write a revision.
  const [watching, setWatching] = useState(false), varTimer = useRef<ReturnType<typeof setTimeout> | null>(null), varsSent = useRef('');
  const sendVariables = useRef<() => void>(() => {});
  sendVariables.current = () => { const now = c.view?.document; if (!now) return; const variables = extensionVariables(now, c.learning.getSnapshot()), key = JSON.stringify(variables); if (key === varsSent.current) return; varsSent.current = key; channel.current?.({ type: 'variables', variables }); };
  useEffect(() => {
    if (!watching) return; varsSent.current = ''; sendVariables.current();
    const stop = c.learning.subscribe(() => { if (!varTimer.current) varTimer.current = setTimeout(() => { varTimer.current = null; sendVariables.current(); }, EXTENSION_LIMITS.variablesMs); });
    return () => { stop(); if (varTimer.current) clearTimeout(varTimer.current); varTimer.current = null; };
  }, [watching, c.learning]);
  useEffect(() => { if (watching) sendVariables.current(); }, [doc.revision, watching]);
  // Keys the page bound reach it from anywhere in Lienzo while this tool is open, before the canvas' shortcuts.
  useEffect(() => { if (!keys.length) return; const bound = new Set(keys); return listenExtensionKeys((event, typing) => routeExtensionKey(event, bound, typing), key => channel.current?.({ type: 'key', key })); }, [keys.join()]);
  const source = useMemo(() => extensionDocument(extension, extension.granted), [extension.html, extension.granted, extension.permissions.join()]);
  // The context: whole once per page load, then only the parts that changed (shared/extension-context.ts). The document
  // part goes again only for a new revision (or mode), the layout only when it can have changed, a selection alone is a
  // few bytes. Keys are compared every render; values are built only for what changed.
  const [mode, setMode] = useState<ContextDocumentMode>(extension.context?.document ?? 'full');
  const contexts = useRef<ContextChannel | null>(null); contexts.current ??= new ContextChannel(m => send(m));
  const theme = { dark: isDark(u.c.surface0), colors: { background: u.c.surface0, surface: u.c.surface1, foreground: u.c.foreground, muted: u.c.foregroundMuted, border: u.c.border, accent: u.c.accent, flow: u.tone('acento'), needs: u.tone('violeta'), mentions: u.tone('turquesa'), areas: [u.tone('acento'), u.tone('turquesa'), u.tone('violeta'), u.tone('exito'), u.tone('aviso')] } };
  const layoutKey = `${doc.id}:${doc.revision}:${c.catalog?.revision ?? -1}`, layoutMemo = useRef<{ key: string; value: Record<string, Box> } | null>(null);
  const layout = () => {
    if (layoutMemo.current?.key !== layoutKey) layoutMemo.current = { key: layoutKey, value: Object.fromEntries([...layoutCanvas(doc, {}, c.catalog).rects].filter(([, r]) => !r.hidden).map(([id, r]) => [id, { x: r.x, y: r.y, width: r.width, height: r.height }])) };
    return layoutMemo.current.value;
  };
  const parts = (): Record<string, ContextPart> => ({
    api: [EXTENSION_API, () => EXTENSION_API],
    extension: [`${extension.id}\n${extension.kind}\n${extension.name}\n${allowed.join()}`, () => ({ id: extension.id, kind: extension.kind, name: extension.name, permissions: allowed })],
    theme: [JSON.stringify(theme), () => theme],
    document: [`${layoutKey}:${mode}`, () => contextDocument(doc, c.catalog, mode)],
    layout: [layoutKey, layout],
    selection: [c.selection.join('\n'), () => [...c.selection]],
  });
  const pushContext = useRef<() => void>(() => {}); pushContext.current = () => { contexts.current!.push(parts()); };
  useEffect(() => { pushContext.current(); });
  const known = (id: unknown): id is string => typeof id === 'string' && [...doc.blocks, ...doc.groups].some(e => e.id === id);
  const need = (permission: ExtensionPermission) => { if (!allowed.includes(permission)) throw new Error(extension.permissions.includes(permission) ? 'This extension has no permission yet: allow it on the canvas first.' : `The extension did not declare the “${permission}” permission.`); };
  const onCall = async ({ method, args }: ExtensionCall): Promise<unknown> => {
    // Local first, and the answer before the work: this page is told the new selection (a patch) and gets its result at
    // once; the canvas applies it on the next task, so the result is not queued behind the render of a big Lienzo; the
    // server keeps it after (useCanvas.select). docs/extensions.md, "Cost model".
    if (method === 'select') { const ids = [...new Set((Array.isArray(args.ids) ? args.ids : []).filter(known))].slice(0, EXTENSION_LIMITS.selection); contexts.current!.push({ ...parts(), selection: [ids.join('\n'), () => [...ids]] }); setTimeout(() => { void c.select(ids); }, 0); return { ids }; }
    if (method === 'read') { const ids = (Array.isArray(args.ids) ? args.ids : []).filter((id): id is string => typeof id === 'string').slice(0, EXTENSION_LIMITS.selection); return contextEntities(c.current.current?.document ?? doc, c.catalog, ids); }
    if (method === 'context.set') { if (!isContextDocumentMode(args.document)) throw new Error('lienzo.setContext({ document }): document is "full", "outline" or "none".'); setMode(args.document); return { document: args.document }; }
    if (method === 'view.watch') { need('view'); pump.current!.watching = args.on === true; return { watching: pump.current!.watching }; }
    if (method === 'ui.immersive') { need('view'); if (!stage) throw new Error('lienzo.ui.immersive is not available here.'); return { immersive: await stage.immersive(extension.id, args.on === true) }; }
    if (method === 'open') { if (!known(args.id)) throw new Error('That is not on the canvas.'); onOpen(args.id); if (sees) stage!.fit([args.id]); return null; }
    if (method === 'view.get') { need('view'); return stage?.view() ?? null; }
    if (method === 'view.fit') {
      need('view'); const ids = (Array.isArray(args.ids) ? args.ids : []).filter(known).slice(0, EXTENSION_LIMITS.selection);
      const padding = typeof args.padding === 'number' && Number.isFinite(args.padding) ? Math.max(0, Math.min(EXTENSION_LIMITS.padding, args.padding)) : undefined;
      return !!stage && ids.length > 0 && stage.fit([...new Set(ids)], { padding, animate: args.animate !== false });
    }
    if (method === 'highlight') {
      const ids = [...new Set((Array.isArray(args.ids) ? args.ids : []).filter(known))].slice(0, EXTENSION_LIMITS.selection), tone = (EXTENSION_TONES as readonly unknown[]).includes(args.tone) ? args.tone as ExtensionTone : 'accent';
      stage?.highlight(extension.id, ids.length ? { ids, dim: args.dim === true, tone } : null); return { ids };
    }
    if (method === 'keys') { const next = (Array.isArray(args.keys) ? args.keys : []).filter((k): k is string => typeof k === 'string' && isExtensionKey(k)).slice(0, EXTENSION_LIMITS.keys); setKeys(next); return { keys: next }; }
    if (method === 'storage.get' || method === 'storage.set') {
      if (c.offline) throw new Error(`No connection to ${capabilities.name}.`);
      const set = method === 'storage.set', value = set ? args.value ?? null : null;
      if (set && value !== null && new TextEncoder().encode(JSON.stringify(value)).length > EXTENSION_LIMITS.storage) throw new Error(`lienzo.storage holds at most ${EXTENSION_LIMITS.storage / 1024} KiB of JSON.`);
      return (await c.api.extensionStorage({ workspaceId: c.workspaceId, documentId: doc.id, extensionId: extension.id, action: set ? 'set' : 'get', value: value as never })).value;
    }
    if (method === 'variables.get') return extensionVariables(doc, c.learning.getSnapshot());
    if (method === 'variables.watch') { setWatching(args.on === true); return null; }
    if (method === 'variables.set') {
      if (!allowed.includes('variables') && !allowed.includes('edit')) need('variables');
      const latest = c.current.current?.document ?? doc, target = extensionVariableTarget(latest, args.name, args.value, args.scope, c.selection);
      if ('error' in target) throw new Error(target.error);
      c.learning.setScopeVariable(target.scope, args.name as string, target.value);
      return { name: args.name, scope: target.scope, value: extensionVariables(latest, c.learning.getSnapshot()).find(v => v.scope === target.scope && v.name === args.name)?.value ?? null };
    }
    if (method.startsWith('comments.')) {
      // The person's notes on the canvas. Reading is free; writing needs "edit" and is signed by the person, via this extension.
      if (c.offline) throw new Error(`No connection to ${capabilities.name}.`);
      const scope = { workspaceId: c.workspaceId, documentId: doc.id }, text = typeof args.text === 'string' ? args.text : '', threadId = typeof args.threadId === 'string' ? args.threadId : '';
      const shape = (view: CommentsView) => view.threads.map(t => ({ id: t.id, status: t.status, anchor: t.anchor.kind === 'point' ? { kind: 'point', x: t.anchor.x, y: t.anchor.y } : { kind: t.anchor.kind, id: t.anchor.id }, messages: t.messages.map(m => ({ author: m.author.kind, name: m.author.kind === 'agent' ? m.author.label : 'You', text: m.text, at: m.createdAt })) }));
      if (method === 'comments.list') { const status = args.status === 'resolved' || args.status === 'all' ? args.status : 'open'; return shape(await c.api.comments(scope)).filter(t => status === 'all' || t.status === status); }
      need('edit'); const via = extension.name.slice(0, 80);
      if (method === 'comments.create') { const a = args.anchor as { kind?: unknown; id?: unknown; x?: unknown; y?: unknown } | undefined;
        const anchor: CommentAnchor | null = a?.kind === 'point' && typeof a.x === 'number' && typeof a.y === 'number' ? { kind: 'point' as const, x: a.x, y: a.y } : (a?.kind === 'block' || a?.kind === 'group') && known(a.id) ? { kind: a.kind as 'block' | 'group', id: a.id, dx: 0, dy: 0 } : null;
        if (!anchor) throw new Error('lienzo.comments.create(anchor, text): anchor is { kind: "block" | "group", id } of something on the canvas, or { kind: "point", x, y }.');
        return { id: (await c.api.commentCreate({ ...scope, anchor, text, via })).threadId }; }
      if (method === 'comments.reply') { await c.api.commentReply({ ...scope, threadId, text, via }); return { id: threadId }; }
      if (method === 'comments.resolve') { await c.api.commentResolve({ ...scope, threadId }); return { id: threadId }; }
    }
    if (method === 'close') { onClose?.(); return null; }
    if (method === 'ui.set') {
      if (!entry || !onEntry) throw new Error('lienzo.ui is not available here.');
      const next = resolvePresentation(extension.presentation, entry.ui, args.patch), { ignored, ...state } = next;
      onEntry({ ui: state, ...(state.mode !== 'overlay' ? { capturing: false } : {}) });
      return { ...state, capturing: entry.capturing && state.mode === 'overlay', canSnapshot: sees && !!stage?.snapshot, anchorId: entry.anchorId ?? null, rect: rect ?? null, safeArea, immersive: chrome.hidden, ignored };
    }
    if (method === 'ui.capture') { if (!entry || !onEntry) throw new Error('lienzo.ui is not available here.'); const on = args.on === true && entry.ui.mode === 'overlay'; onEntry({ capturing: on }); return { capturing: on }; }
    if (method === 'hide' || method === 'show') {
      if (method === 'show' && (args.ids === null || args.ids === undefined)) { stage?.show(extension.id, null); return { ids: [] }; }
      const { ids, ms } = hideRequest(args, known);
      if (method === 'hide') stage?.hide(extension.id, ids, ms); else stage?.show(extension.id, ids);
      return { ids, ...(method === 'hide' && ms !== null ? { ms } : {}) };
    }
    if (method === 'view.snapshot') {
      need('view'); const ids = [...new Set((Array.isArray(args.ids) ? args.ids : []).filter(known))].slice(0, EXTENSION_LIMITS.selection);
      return ids.length && stage?.snapshot ? stage.snapshot(ids) : null;
    }
    if (method === 'edit') {
      need('edit'); const operations = args.operations;
      if (!Array.isArray(operations) || !operations.length || operations.length > EXTENSION_LIMITS.operations) throw new Error(`Expected 1 to ${EXTENSION_LIMITS.operations} operations.`);
      if (operations.some(o => !o || typeof o !== 'object' || (EXTENSION_FORBIDDEN_OPERATIONS as readonly string[]).includes((o as { type?: string }).type ?? ''))) throw new Error('An extension cannot change the saved selection or the agent instructions with edit.');
      if (c.offline) throw new Error(`No connection to ${capabilities.name}.`);
      const label = typeof args.label === 'string' && args.label.trim() ? args.label.trim().slice(0, 200) : extension.name, next = await c.edit(operations as CanvasOperation[], `${extension.name}: ${label}`.slice(0, 300));
      if (!next) throw new Error(c.failure?.message ?? 'The canvas rejected the change.'); return { revision: next.document.revision };
    }
    throw new Error(`lienzo.${method} does not exist in API ${EXTENSION_API}.`);
  };
  if (u.layout.platform !== 'web') return <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}><Txt kind="small" muted>Extensions run in the web and desktop apps.</Txt></View>;
  // Esc in the page leaves an immersive mode it asked for first; then it does what the presentation says.
  const escape = () => { if (stage?.exitImmersive(extension.id)) return; onEscape?.(); };
  return <WebExtension id={extension.id} source={source} title={extension.name} surface={transparent ? 'transparent' : surface ?? u.c.surface0} passThrough={!!entry && !takesPointer(entry.ui, entry.capturing)} onCall={onCall} channel={channel} onEscape={onEscape || chrome.owner === extension.id ? escape : undefined} onHover={onHover}
    onReady={() => { setKeys([]); setWatching(false); pump.current!.watching = false; contexts.current!.reset(); pushContext.current(); uiSent.current = ''; inputSent.current = -1; sendUi.current(); if (sees) pump.current!.settle(); }} />;
}
/** An imported extension asks before it does more than read: what it wants, in words, and one press to allow it. */
function Grant({ extension, controller: c, inline }: { extension: CatalogExtension; controller: CanvasController; inline?: boolean }) {
  const u = useUI(), [error, setError] = useState('');
  if (extension.granted || !extension.permissions.length) return null;
  const allow = () => { setError(''); void c.task(async () => { const catalog = await c.api.catalog({}); c.setCatalog(await c.api.catalogMutate({ expectedRevision: catalog.revision, action: { type: 'extension.grant', id: extension.id, granted: true } })); }).catch(() => setError('The permission could not be saved.')); };
  if (inline) return <Button label={error ? 'Retry' : 'Allow'} small variant="primary" onPress={allow} />;
  return <View nativeID={`lienzo-extension-grant-${extension.id}`} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 8, borderBottomWidth: 1, borderColor: u.c.border, backgroundColor: u.wash('aviso') }}>
    <Txt kind="small" style={{ flex: 1 }}>It came in the file “{c.catalog?.packs.find(p => p.id === extension.source)?.name ?? extension.source}” and asks to {list(extension.permissions.map(p => PERMISSION[p]))}. Without your permission it can only read and select.{error ? ` ${error}` : ''}</Txt>
    <Button label="Allow" small variant="primary" onPress={allow} />
  </View>;
}
/** A small round ✕ in the corner: always there for a minimal panel; for chromeless ones and fullscreen, on hover or focus. */
function CloseDot({ name, onPress, visible }: { name: string; onPress(): void; visible: boolean }) {
  const u = useUI(), [focus, setFocus] = useState(false), [hover, setHover] = useState(false), shown = visible || focus || hover || u.compact;
  return <Pressable nativeID="lienzo-extension-close" accessibilityRole="button" accessibilityLabel={`Close ${name}`} onPress={e => { e.stopPropagation(); onPress(); }} onFocus={() => setFocus(true)} onBlur={() => setFocus(false)} onHoverIn={() => setHover(true)} onHoverOut={() => setHover(false)} hitSlop={6}
    style={{ position: 'absolute', top: X.close.inset, right: X.close.inset, width: X.close.size, height: X.close.size, borderRadius: X.close.size / 2, alignItems: 'center', justifyContent: 'center', zIndex: 3, opacity: shown ? 1 : X.close.idleAlpha,
      backgroundColor: hover ? u.c.surface2 : withAlpha(u.c.surface1, .94), borderWidth: focus ? 2 : 1, borderColor: focus ? u.c.accent : u.c.border, transitionProperty: 'opacity, background-color', transitionDuration: '160ms' } as object}>
    <Icon name="X" size={X.close.icon} color={u.c.foreground} />
  </Pressable>;
}
/** The name of whatever draws over the canvas, and its close button. Its ring turns accent while the page holds the pointer. */
function OverlayChip({ extension, controller, capturing, onClose, top }: { extension: CatalogExtension; controller: CanvasController; capturing: boolean; onClose(): void; top: number }) {
  const u = useUI(), accent = extensionAccent(extension, u), restricted = !extension.granted && extension.permissions.length > 0, safe = useSafeRect('pill', { owner: extension.id });
  return <View pointerEvents="box-none" style={{ position: 'absolute', top, left: 0, right: 0, alignItems: 'center', zIndex: X.chip.z }}>
    <View ref={safe.ref} onLayout={safe.onLayout} nativeID={`lienzo-extension-chip-${extension.id}`} accessibilityLabel={`${extension.name} draws over the canvas${capturing ? ' and takes the pointer' : ''}`} style={[islandStyle(u), { flexDirection: 'row', alignItems: 'center', gap: 8, height: X.chip.height, maxWidth: X.chip.maxWidth, paddingLeft: 6, paddingRight: 2, paddingVertical: 0, borderRadius: X.chip.height / 2, borderWidth: capturing ? 1.5 : 1, borderColor: capturing ? accent : u.c.border }]}>
      <View style={{ width: X.chip.tile, height: X.chip.tile, borderRadius: X.chip.tile / 2, backgroundColor: withAlpha(accent, .16), alignItems: 'center', justifyContent: 'center' }}><Icon name={extensionIcon(extension)} size={X.chip.icon} color={accent} /></View>
      <Txt kind="small" numberOfLines={1} style={{ flexShrink: 1 }}>{extension.name}</Txt>
      {restricted && <Grant extension={extension} controller={controller} inline />}
      <IconButton icon="X" label={`Close ${extension.name}`} detail="Esc" size={26} onPress={onClose} />
    </View>
  </View>;
}
/**
 * An open extension, the way its presentation asks (docs/design.md §45): one box whose style follows the mode, so
 * lienzo.ui.set never reloads the page. Panels get Lienzo's island look with a title bar (full), only a ✕ (minimal) or
 * nothing at all (none); a popover points at its anchor; an overlay is clear and lets the pointer through; fullscreen
 * covers the Lienzo area.
 */
export function ExtensionSurface({ extension, controller, stage, entry, place, canvas, chipTop, onEntry, onOpen, onClose, onHelp }: { extension: CatalogExtension; controller: CanvasController; stage: ExtensionStage; entry: OpenExtension; place: SurfacePlacement; canvas: Box; chipTop: number;
  onEntry(patch: Partial<OpenExtension>): void; onOpen(id: string): void; onClose(): void; onHelp?(): void }) {
  const u = useUI(), ui = entry.ui, accent = extensionAccent(extension, u);
  // A panel, popover or full screen covers the canvas for every other extension (not for itself: it is its own frame).
  const safe = useSafeRect(ui.mode === 'popover' ? 'popover' : 'panel', { owner: extension.id, on: ui.mode !== 'overlay' });
  const card = ui.mode === 'popover' || ui.mode === 'panel' && ui.chrome !== 'none', bare = ui.mode === 'overlay' || ui.mode === 'panel' && ui.chrome === 'none';
  const [hover, setHover] = useState(false), hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hovering = (inside: boolean) => { if (hoverTimer.current) clearTimeout(hoverTimer.current); if (inside) setHover(true); else hoverTimer.current = setTimeout(() => setHover(false), X.close.hideMs); };
  useEffect(() => () => { if (hoverTimer.current) clearTimeout(hoverTimer.current); }, []);
  const z = place.z === 'overlay' ? 0 : place.z === 'fullscreen' ? X.fullscreen.z : place.z === 'popover' ? X.popover.z : X.panel.z;
  const frameRect = { x: place.x - canvas.x, y: place.y - canvas.y, width: place.width, height: place.height };
  const header = ui.mode === 'panel' && ui.chrome === 'full', dot = ui.mode === 'fullscreen' || ui.mode === 'popover' || ui.mode === 'panel' && ui.chrome !== 'full';
  const box = { position: 'absolute', left: place.x, top: place.y, width: place.width, height: place.height, zIndex: z } as const;
  const look = card ? { ...islandStyle(u, true), padding: 0, gap: 0, overflow: 'visible' as const, borderColor: ui.mode === 'popover' ? withAlpha(accent, .45) : u.c.border } : ui.mode === 'fullscreen' ? { backgroundColor: u.c.surface0 } : { backgroundColor: 'transparent' };
  const escape = closesOnEscape(ui) ? onClose : undefined;
  return <>
    {ui.dimCanvas > 0 && <View pointerEvents="none" nativeID={`lienzo-extension-scrim-${extension.id}`} style={{ position: 'absolute', left: canvas.x, top: canvas.y, width: canvas.width, height: canvas.height, zIndex: z, backgroundColor: withAlpha(X.scrim.ink, ui.dimCanvas) }} />}
    <View ref={safe.ref} onLayout={safe.onLayout} nativeID={`lienzo-extension-tool-${extension.id}`} accessibilityLabel={extension.name} pointerEvents={ui.mode === 'overlay' ? 'box-none' : 'auto'} {...{ dataSet: { mode: ui.mode, chrome: ui.chrome } }} style={[box, look]}>
      {ui.mode === 'popover' && place.arrow && <View pointerEvents="none" style={{ position: 'absolute', left: place.arrow.x - X.popover.arrow, [place.arrow.side === 'top' ? 'top' : 'bottom']: -X.popover.arrow, width: 2 * X.popover.arrow, height: 2 * X.popover.arrow, backgroundColor: u.c.surface1, borderColor: withAlpha(accent, .45),
        borderTopWidth: place.arrow.side === 'top' ? 1 : 0, borderLeftWidth: place.arrow.side === 'top' ? 1 : 0, borderBottomWidth: place.arrow.side === 'bottom' ? 1 : 0, borderRightWidth: place.arrow.side === 'bottom' ? 1 : 0, transform: [{ rotate: '45deg' }], zIndex: 2 }} />}
      <View pointerEvents={ui.mode === 'overlay' ? 'box-none' : 'auto'} style={{ flex: 1, minHeight: 0, borderRadius: card ? tokens.island.radius : 0, overflow: 'hidden' }}>
        {header && <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 8, paddingRight: 4, height: X.panel.header, borderBottomWidth: 1, borderColor: u.c.border }}>
          <View style={{ width: X.panel.tile, height: X.panel.tile, borderRadius: 7, backgroundColor: withAlpha(accent, .14), alignItems: 'center', justifyContent: 'center' }}><Icon name={extensionIcon(extension)} size={X.panel.tileIcon} color={accent} /></View>
          <Txt kind="bodyStrong" numberOfLines={1} style={{ flex: 1, minWidth: 0 }}>{extension.name}</Txt>
          {onHelp && <IconButton icon="CircleHelp" label={`Help: ${extension.name}`} detail={extension.description || undefined} onPress={onHelp} />}
          <IconButton icon="X" label={`Close ${extension.name}`} onPress={onClose} />
        </View>}
        {ui.mode !== 'overlay' && <Grant extension={extension} controller={controller} />}
        <View pointerEvents={ui.mode === 'overlay' ? 'box-none' : 'auto'} style={{ flex: 1, minHeight: 0 }}><ExtensionFrame extension={extension} controller={controller} stage={stage} onOpen={onOpen} onClose={onClose} entry={entry} rect={frameRect} onEntry={onEntry} onEscape={escape} onHover={dot ? hovering : undefined} transparent={bare} surface={card ? u.c.surface1 : undefined} /></View>
      </View>
      {dot && <CloseDot name={extension.name} onPress={onClose} visible={ui.chrome === 'minimal' && ui.mode === 'panel' || hover} />}
    </View>
    {ui.mode === 'overlay' && <OverlayChip extension={extension} controller={controller} capturing={entry.capturing} onClose={onClose} top={chipTop} />}
  </>;
}
