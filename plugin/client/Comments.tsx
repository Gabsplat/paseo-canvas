import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Icon, ScrollView, TextInput, useToast } from './host';
import { COMMENT_LIMITS, pinPoint, type CommentAnchor, type CommentAuthor, type CommentThread, type CommentsView } from '../shared/comments';
import type { CanvasOverlay } from './Canvas';
import type { CanvasController } from './useCanvas';
import { errorText } from './useCanvas';
import type { Point } from './logic';
import { tokens } from './tokens';
import { withAlpha } from './color';
import { Button, IconButton, Segments, Txt, friendlyError, useUI } from './ui';
import { islandStyle } from './whiteboard-visuals';
import { authorName, commentTarget, relativeTime, visibleThreads, type CommentFilter } from './comment-logic';

/**
 * Comments (docs/design.md §38): the person's notes pinned on the canvas, read by the agent with canvas_comments when
 * the person asks. Nothing here sends anything to the agent. A thread lives beside the drawing: no revision, no undo.
 */
const K = tokens.face.comments;
/** What is open over the canvas: a thread, or a new one being written at a spot (not saved until it is sent). */
export type OpenComment = { kind: 'thread'; id: string } | { kind: 'draft'; anchor: CommentAnchor; at: Point } | null;
const hovered = (state: object) => !!(state as { hovered?: boolean }).hovered;

/** The comments of the open Lienzo: read when it opens and again whenever its commentsVersion moves (the watch). */
export function useComments(c: CanvasController) {
  const toast = useToast(), documentId = c.view?.document.id, version = c.view?.commentsVersion ?? 0;
  const [data, setData] = useState<{ documentId: string; version: number; threads: CommentThread[] } | null>(null);
  const [open, setOpen] = useState<OpenComment>(null), [placing, setPlacing] = useState(false), [filter, setFilter] = useState<CommentFilter>('open');
  const [pins, setPins] = useState(true), [listOpen, setListOpen] = useState(false), [busy, setBusy] = useState(false);
  const live = useRef(documentId); live.current = documentId;
  const accept = (view: CommentsView) => {
    if (view.documentId !== live.current) return;
    setData(old => old && old.documentId === view.documentId && old.version > view.commentsVersion ? old : { documentId: view.documentId, version: view.commentsVersion, threads: view.threads });
  };
  const load = () => { const id = live.current; if (id) void c.api.comments({ workspaceId: c.workspaceId, documentId: id }).then(accept).catch(() => {}); };
  useEffect(() => { setOpen(null); setPlacing(false); setData(null); load(); }, [documentId]);
  useEffect(() => { if (data && data.documentId === documentId && version !== data.version) load(); }, [version]);
  const threads = data && data.documentId === documentId ? data.threads : [];
  // A thread that disappeared (deleted elsewhere) closes its popover.
  useEffect(() => { if (open?.kind === 'thread' && data && !threads.some(t => t.id === open.id)) setOpen(null); }, [threads, open]);
  async function run(call: (documentId: string) => Promise<CommentsView>, failure: string): Promise<CommentsView | null> {
    const id = live.current; if (!id) return null;
    if (c.offline) { toast.error('No connection: the comment was not saved.'); return null; }
    setBusy(true);
    try { const view = await call(id); accept(view); return view; }
    catch (error) { toast.error(`${failure} ${friendlyError(errorText(error))}`); return null; }
    finally { setBusy(false); }
  }
  const scope = (documentId: string) => ({ workspaceId: c.workspaceId, documentId });
  // Where pins on cards were drawn, sent once per change: the server keeps a thread there if its card is deleted.
  const located = useRef(new Map<string, string>()), pending = useRef(new Map<string, Point>()), timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useEffect(() => { located.current.clear(); pending.current.clear(); }, [documentId]);
  const locate = (thread: CommentThread, at: Point) => {
    if (thread.anchor.kind === 'point') return;
    const key = `${Math.round(at.x)},${Math.round(at.y)}`, stored = thread.anchor.at && `${Math.round(thread.anchor.at.x)},${Math.round(thread.anchor.at.y)}`;
    if (located.current.get(thread.id) === key || stored === key && !located.current.has(thread.id)) return;
    located.current.set(thread.id, key); pending.current.set(thread.id, at);
    if (timer.current || c.offline) return;
    timer.current = setTimeout(() => {
      timer.current = null; const id = live.current, points = [...pending.current].map(([threadId, p]) => ({ threadId, x: Math.round(p.x), y: Math.round(p.y) })); pending.current.clear();
      if (id && points.length) void c.api.commentLocate({ ...scope(id), points }).catch(() => {});
    }, 1200);
  };
  return {
    threads, loaded: !!data && data.documentId === documentId, busy, open, setOpen, placing, setPlacing, filter, setFilter, pins, setPins, listOpen, setListOpen, locate,
    openCount: threads.filter(t => t.status === 'open').length, resolvedCount: threads.filter(t => t.status === 'resolved').length,
    create: (anchor: CommentAnchor, text: string) => run(id => c.api.commentCreate({ ...scope(id), anchor, text }), 'The comment was not saved.'),
    reply: (threadId: string, text: string) => run(id => c.api.commentReply({ ...scope(id), threadId, text }), 'The reply was not saved.'),
    resolve: (threadId: string) => run(id => c.api.commentResolve({ ...scope(id), threadId }), 'The thread was not resolved.'),
    reopen: (threadId: string) => run(id => c.api.commentReopen({ ...scope(id), threadId }), 'The thread was not reopened.'),
    remove: (threadId: string) => run(id => c.api.commentDelete({ ...scope(id), threadId }), 'The thread was not deleted.'),
  };
}
export type CommentsState = ReturnType<typeof useComments>;

/** Who wrote it, as a round avatar: the person in ink with a small figure, the agent in the accent with its spark. */
export function Avatar({ author, size }: { author: CommentAuthor; size: number }) {
  const u = useUI();
  if (author.kind === 'agent') return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: u.c.accent, alignItems: 'center', justifyContent: 'center' }}><Icon name="Sparkles" size={Math.round(size * .56)} color={u.c.accentForeground} /></View>;
  const head = Math.round(size * .32), body = Math.round(size * .58);
  return <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: u.c.foreground, alignItems: 'center', overflow: 'hidden' }}>
    <View style={{ width: head, height: head, borderRadius: head / 2, marginTop: Math.round(size * .2), backgroundColor: u.c.surface1 }} />
    <View style={{ width: body, height: body, borderRadius: body / 2, marginTop: Math.max(1, Math.round(size * .06)), backgroundColor: u.c.surface1 }} />
  </View>;
}

/** A pin: a speech bubble whose square corner points at what it is about. Fixed screen size, never under the cursor's drag. */
function Pin({ thread, x, y, active, onPress, dim }: { thread: CommentThread; x: number; y: number; active: boolean; onPress(): void; dim: boolean }) {
  const u = useUI(), author = thread.messages[0].author, agent = author.kind === 'agent', size = K.pin, replies = thread.messages.length - 1, [hover, setHover] = useState(false);
  const fill = agent ? u.c.accent : u.c.foreground, resolved = thread.status === 'resolved';
  const label = `Comment by ${agent ? author.label + ' (your agent)' : 'you'}: ${thread.messages[0].text.slice(0, 80)}${replies ? `, ${replies} ${replies === 1 ? 'reply' : 'replies'}` : ''}${resolved ? ', resolved' : ''}`;
  return <View pointerEvents="box-none" style={{ position: 'absolute', left: x, top: y - size, zIndex: active ? 3 : hover ? 2 : 1 }}>
    <Pressable nativeID={`lienzo-interactive-comment-pin-${thread.id}`} accessibilityRole="button" accessibilityLabel={label} onPress={e => { e.stopPropagation(); onPress(); }} onHoverIn={() => setHover(true)} onHoverOut={() => setHover(false)} hitSlop={(K.hit - size) / 2}
      style={({ pressed }) => ({ width: size, height: size, borderRadius: size / 2, borderBottomLeftRadius: 3, backgroundColor: fill, borderWidth: K.pinRing, borderColor: active ? u.c.accent : u.c.surface1, alignItems: 'center', justifyContent: 'center', opacity: resolved || dim ? K.resolvedAlpha : 1,
        boxShadow: `0 1px 2px ${withAlpha('#000000', .18)}, 0 4px 12px ${withAlpha('#000000', active || hover ? .22 : .12)}`, transform: [{ scale: pressed ? .94 : active ? 1.1 : hover ? 1.05 : 1 }], ...({ cursor: 'pointer', transitionProperty: 'transform', transitionDuration: `${K.enterMs}ms` } as object) })}>
      {resolved ? <Icon name="Check" size={K.pinGlyph} color={agent ? u.c.accentForeground : u.c.surface1} /> : <Avatar author={author} size={size - 2 * K.pinRing - 2} />}
    </Pressable>
    {replies > 0 && !resolved && <View pointerEvents="none" style={{ position: 'absolute', left: size - 9, top: -5, minWidth: K.badge, height: K.badge, paddingHorizontal: 3, borderRadius: K.badge / 2, backgroundColor: u.c.surface1, borderWidth: 1, borderColor: u.c.border, alignItems: 'center', justifyContent: 'center' }}><Txt style={{ fontSize: 9, lineHeight: 11, fontWeight: '700', color: u.c.foreground }}>{replies + 1}</Txt></View>}
    {hover && !active && <View pointerEvents="none" style={[islandStyle(u, true), { position: 'absolute', left: size + 8, top: -2, width: 220, paddingHorizontal: 10, paddingVertical: 8, gap: 2 }]}>
      <Txt kind="label" muted numberOfLines={1}>{agent ? `${author.label} · your agent` : 'You'} · {relativeTime(thread.updatedAt)}</Txt>
      <Txt kind="small" numberOfLines={2}>{thread.messages[0].text}</Txt>
    </View>}
  </View>;
}

/**
 * Pins, the Comment tool's surface and the open thread, over the canvas. It follows the camera itself (a frame per
 * move, no document render). Pins and the popover sit in their own layer, so pressing them never starts a card drag.
 */
export function CommentLayer({ state, view, groups, titleOf, hidden = false, clear = { top: 0, bottom: 0, right: 0 } }: { state: CommentsState; view: CanvasOverlay; groups: ReadonlySet<string>; titleOf(id: string): string; hidden?: boolean;
  /** Screen edges the popover keeps clear of: the top islands, the toolbar, the right panel. */
  clear?: { top: number; bottom: number; right: number } }) {
  const u = useUI(), [, setTick] = useState(0), [aim, setAim] = useState<{ kind: 'block' | 'group'; id: string } | null>(null), [popHeight, setPopHeight] = useState(240), draftText = useRef('');
  useEffect(() => {
    let frame: number | null = null;
    const stop = view.subscribe(() => { if (frame === null) frame = requestAnimationFrame(() => { frame = null; setTick(t => t + 1); }); });
    return () => { stop(); if (frame !== null) cancelAnimationFrame(frame); };
  }, [view.subscribe]);
  useEffect(() => { if (!state.placing) setAim(null); }, [state.placing]);
  const cam = view.camera(), screen = (p: Point) => ({ x: cam.offset.x + p.x * cam.scale, y: cam.offset.y + p.y * cam.scale });
  const openId = state.open?.kind === 'thread' ? state.open.id : undefined;
  const shown = visibleThreads(state.threads, { pins: state.pins && !hidden, filter: state.filter, listOpen: state.listOpen, openId });
  // Pins on one entity stand side by side, like a stack of avatars, outside its top-right corner.
  const stacks = new Map<string, number>();
  const placed = shown.flatMap(thread => {
    const anchor = thread.anchor, rect = anchor.kind === 'point' ? undefined : view.rects.get(anchor.id);
    if (rect?.hidden) return [];
    const world = pinPoint(anchor, id => view.rects.get(id)); if (!world) return [];
    if (rect) state.locate(thread, world);
    const key = anchor.kind === 'point' ? '' : anchor.id, index = key ? stacks.get(key) ?? 0 : 0; if (key) stacks.set(key, index + 1);
    const s = screen(world), entity = anchor.kind !== 'point' && !!rect;
    return [{ thread, x: s.x + (entity ? K.pinOffset + index * K.stack : 0), y: s.y - (entity ? K.pinOffset : 0) }];
  });
  const draft = state.open?.kind === 'draft' ? state.open : null;
  const anchorOf = (): Point | null => {
    if (draft) {
      const a = draft.anchor, r = a.kind === 'point' ? undefined : view.rects.get(a.id), s = screen(pinPoint(a, id => view.rects.get(id)) ?? draft.at);
      return r && a.kind !== 'point' ? { x: s.x + K.pinOffset + (stacks.get(a.id) ?? 0) * K.stack, y: s.y - K.pinOffset } : s;
    }
    const pin = placed.find(p => p.thread.id === openId); return pin ? { x: pin.x, y: pin.y } : null;
  };
  const tip = state.open ? anchorOf() : null, P = K.popover, width = Math.min(P.width, view.size.width - 2 * P.edge);
  const minTop = Math.max(P.edge, clear.top), maxBottom = view.size.height - Math.max(P.edge, clear.bottom), maxRight = view.size.width - Math.max(P.edge, clear.right);
  let left = 0, top = 0;
  if (tip) {
    // Beside the pin, on the right when it fits, else on the left; never under the islands, the toolbar or the panel.
    left = tip.x + K.pin + P.offset; if (left + width > maxRight) left = Math.max(P.edge, Math.min(tip.x - width - P.offset, maxRight - width));
    top = Math.max(minTop, Math.min(tip.y - K.pin - 4, maxBottom - popHeight));
  }
  const page = (e: { nativeEvent: unknown }) => { const n = e.nativeEvent as { pageX?: number; pageY?: number; clientX?: number; clientY?: number }; return { x: n.pageX ?? n.clientX ?? 0, y: n.pageY ?? n.clientY ?? 0 }; };
  const place = (e: { nativeEvent: unknown }) => {
    const world = view.toWorld(page(e)), target = commentTarget(world, view.rects, groups);
    const anchor: CommentAnchor = target ? { kind: target.kind, id: target.id, dx: 0, dy: 0 } : { kind: 'point', x: Math.round(world.x), y: Math.round(world.y) };
    draftText.current = ''; state.setPlacing(false); state.setOpen({ kind: 'draft', anchor, at: world });
  };
  const aimRect = aim && view.rects.get(aim.id), aimScreen = aimRect && screen(aimRect), close = () => { if (draft && draftText.current.trim()) return; state.setOpen(null); };
  const draftAnchor = draft && draft.anchor.kind !== 'point' ? view.rects.get(draft.anchor.id) : undefined;
  return <View nativeID="lienzo-tools-comments" pointerEvents="box-none" style={{ position: 'absolute', inset: 0, zIndex: 12 }}>
    {state.placing && <Pressable nativeID="lienzo-comment-surface" accessibilityRole="button" accessibilityLabel="Place a comment: press a card, a Frame or an empty spot" onPress={place}
      {...({ onPointerMove: (e: { nativeEvent: unknown }) => { const t = commentTarget(view.toWorld(page(e)), view.rects, groups); setAim(old => old?.id === t?.id ? old : t); } } as object)}
      style={{ position: 'absolute', inset: 0, ...({ cursor: 'crosshair' } as object) }} />}
    {aimRect && aimScreen && state.placing && <View pointerEvents="none" style={{ position: 'absolute', left: aimScreen.x - K.placing.outset, top: aimScreen.y - K.placing.outset, width: aimRect.width * cam.scale + 2 * K.placing.outset, height: aimRect.height * cam.scale + 2 * K.placing.outset, borderRadius: tokens.radius.block + K.placing.outset, borderWidth: K.placing.outline, borderColor: withAlpha(u.c.accent, .7), borderStyle: 'dashed' }} />}
    {state.placing && <View pointerEvents="none" style={{ position: 'absolute', top: K.placing.hintTop, left: 0, right: 0, alignItems: 'center' }}><View style={[islandStyle(u), { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, height: 32 }]}><Icon name="MessageSquarePlus" size={14} color={u.c.accent} /><Txt kind="small">{aim ? `Comment on “${titleOf(aim.id)}”` : 'Press a card, a Frame or an empty spot'}</Txt><Txt kind="keys" muted>Esc</Txt></View></View>}
    {state.open && tip && <Pressable accessible={false} focusable={false} onPress={close} style={{ position: 'absolute', inset: 0 }} />}
    {placed.map(p => <Pin key={p.thread.id} thread={p.thread} x={p.x} y={p.y} active={p.thread.id === openId} dim={false} onPress={() => state.setOpen(openId === p.thread.id ? null : { kind: 'thread', id: p.thread.id })} />)}
    {draft && tip && <View pointerEvents="none" style={{ position: 'absolute', left: tip.x, top: tip.y - K.pin, width: K.pin, height: K.pin, borderRadius: K.pin / 2, borderBottomLeftRadius: 3, backgroundColor: u.c.foreground, borderWidth: K.pinRing, borderColor: u.c.accent, alignItems: 'center', justifyContent: 'center', zIndex: 3 }}><Icon name="Plus" size={K.pinGlyph} color={u.c.surface1} /></View>}
    {draft && draftAnchor && (() => { const s = screen(draftAnchor); return <View pointerEvents="none" style={{ position: 'absolute', left: s.x - K.placing.outset, top: s.y - K.placing.outset, width: draftAnchor.width * cam.scale + 2 * K.placing.outset, height: draftAnchor.height * cam.scale + 2 * K.placing.outset, borderRadius: tokens.radius.block + K.placing.outset, borderWidth: K.placing.outline, borderColor: withAlpha(u.c.accent, .55) }} />; })()}
    {state.open && tip && <View nativeID="lienzo-interactive-comment-thread" onLayout={e => setPopHeight(e.nativeEvent.layout.height)} style={[islandStyle(u, true), { position: 'absolute', left, top, width, maxHeight: Math.max(160, Math.min(P.maxHeight, maxBottom - minTop)), padding: 0, gap: 0, overflow: 'hidden', zIndex: 4 }]}>
      {draft ? <ThreadView key="draft" state={state} draft={draft.anchor} titleOf={titleOf} onDraft={text => { draftText.current = text; }} onClose={() => state.setOpen(null)} />
        : (() => { const thread = state.threads.find(t => t.id === openId); return thread ? <ThreadView key={openId} state={state} thread={thread} titleOf={titleOf} onClose={() => state.setOpen(null)} /> : null; })()}
    </View>}
  </View>;
}

function where(anchor: CommentAnchor, thread: CommentThread | undefined, titleOf: (id: string) => string) {
  const place = anchor.kind !== 'point' ? `On “${titleOf(anchor.id)}”` : thread?.orphanedFrom ? `Was on “${thread.orphanedFrom.title}”, since deleted` : 'On the canvas';
  // A thread that came in a .lienzo file: its authors wrote it on another computer.
  return thread?.imported ? `${place} · Imported` : place;
}

/** A thread: header with its actions, the messages, and a reply box. The same view in the popover and in the list. */
export function ThreadView({ state, thread, draft, titleOf, onClose, onBack, onDraft }: { state: CommentsState; thread?: CommentThread; draft?: CommentAnchor; titleOf(id: string): string; onClose(): void; onBack?(): void; onDraft?(text: string): void }) {
  const u = useUI(), [text, setText] = useState(''), [lines, setLines] = useState(K.composer.minHeight - 8), [menu, setMenu] = useState(false), [confirm, setConfirm] = useState(false), input = useRef<{ focus?(): void } | null>(null), scroll = useRef<{ scrollToEnd?(o?: { animated?: boolean }): void } | null>(null);
  const resolved = thread?.status === 'resolved', anchor = thread?.anchor ?? draft!;
  useEffect(() => { onDraft?.(text); }, [text]);
  useEffect(() => { const timer = setTimeout(() => scroll.current?.scrollToEnd?.({ animated: false }), 0); return () => clearTimeout(timer); }, [thread?.messages.length]);
  async function send() {
    const value = text.trim(); if (!value || state.busy || value.length > COMMENT_LIMITS.text) return;
    if (thread) { if (await state.reply(thread.id, value)) setText(''); return; }
    const view = await state.create(draft!, value);
    if (view?.threadId) { setText(''); onDraft?.(''); state.setOpen({ kind: 'thread', id: view.threadId }); }
  }
  const keys = (e: { nativeEvent: { key?: string; shiftKey?: boolean }; preventDefault?(): void }) => {
    if (e.nativeEvent.key === 'Enter' && !e.nativeEvent.shiftKey) { e.preventDefault?.(); void send(); }
    else if (e.nativeEvent.key === 'Escape') { e.preventDefault?.(); onClose(); }
  };
  const over = text.length > COMMENT_LIMITS.text * .9;
  return <View style={{ flexShrink: 1, minHeight: 0 }}>
    <View style={{ minHeight: 44, paddingLeft: onBack ? 4 : K.popover.padding, paddingRight: 4, flexDirection: 'row', alignItems: 'center', gap: 2, borderBottomWidth: 1, borderColor: u.c.border }}>
      {onBack && <IconButton icon="ChevronLeft" label="All comments" onPress={onBack} />}
      <View style={{ flex: 1, minWidth: 0 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><Txt kind="heading">{thread ? 'Comment' : 'New comment'}</Txt>{resolved && <View style={{ paddingHorizontal: 6, height: 18, borderRadius: 9, justifyContent: 'center', backgroundColor: u.wash('exito') }}><Txt kind="label" style={{ color: u.c.statusSuccess, fontWeight: '600' }}>Resolved</Txt></View>}</View>
        <Txt kind="label" muted numberOfLines={1}>{where(anchor, thread, titleOf)}</Txt>
      </View>
      {thread && <IconButton icon="Ellipsis" label="More" active={menu} onPress={() => { setMenu(m => !m); setConfirm(false); }} />}
      {thread && (resolved ? <IconButton icon="RotateCcw" label="Reopen" detail="Back to the open comments." disabled={state.busy} onPress={() => { void state.reopen(thread.id); }} />
        : <IconButton icon="Check" label="Resolve" detail="Done: the pin hides. Find it again under Resolved." disabled={state.busy} onPress={() => { void state.resolve(thread.id).then(view => { if (view) onClose(); }); }} />)}
      <IconButton icon="X" label="Close" shortcut="Esc" onPress={onClose} />
    </View>
    {menu && thread && <View style={{ padding: 8, gap: 6, borderBottomWidth: 1, borderColor: u.c.border, backgroundColor: u.c.surface2 }}>
      {confirm ? <><Txt kind="small">Delete this thread and its {thread.messages.length} {thread.messages.length === 1 ? 'message' : 'messages'}? This cannot be undone.</Txt>
        <View style={{ flexDirection: 'row', gap: 8 }}><Button label="Delete" variant="danger" small disabled={state.busy} onPress={() => { void state.remove(thread.id).then(view => { if (view) onClose(); }); }} /><Button label="Cancel" variant="ghost" small onPress={() => { setConfirm(false); setMenu(false); }} /></View></>
        : <Pressable accessibilityRole="menuitem" accessibilityLabel="Delete thread" onPress={() => setConfirm(true)} style={({ pressed, ...s }) => ({ minHeight: 32, paddingHorizontal: 8, borderRadius: 6, flexDirection: 'row', alignItems: 'center', gap: 8, backgroundColor: pressed ? withAlpha(u.c.foreground, .1) : hovered(s) ? withAlpha(u.c.foreground, .06) : 'transparent' })}><Icon name="Trash2" size={14} color={u.c.statusDanger} /><Txt style={{ color: u.c.statusDanger }}>Delete thread</Txt></Pressable>}
    </View>}
    {thread && <ScrollView ref={scroll as never} style={{ flexShrink: 1, maxHeight: K.popover.messages }} contentContainerStyle={{ padding: K.popover.padding, gap: K.popover.gap }}>
      {thread.messages.map(m => <View key={m.id} style={{ flexDirection: 'row', gap: 10 }}>
        <Avatar author={m.author} size={K.avatar} />
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
            <Txt kind="bodyStrong" numberOfLines={1} style={{ flexShrink: 1 }}>{authorName(m.author)}</Txt>
            {m.author.kind === 'agent' && <Txt kind="label" style={{ color: u.c.accent, fontWeight: '600' }}>by your agent</Txt>}
            {m.author.kind === 'person' && m.author.via && <Txt kind="label" muted>via {m.author.via}</Txt>}
            <Txt kind="label" muted>{relativeTime(m.createdAt)}</Txt>
          </View>
          <Txt selectable style={{ ...u.font('body'), color: u.c.foreground }}>{m.text}</Txt>
        </View>
      </View>)}
    </ScrollView>}
    <View style={{ padding: K.popover.padding, paddingTop: thread ? 0 : K.popover.padding, gap: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 6, borderWidth: 1, borderColor: u.c.border, borderRadius: K.composer.radius, backgroundColor: u.c.surface0, paddingLeft: 10, paddingRight: 4, paddingVertical: 4 }}>
        <TextInput ref={input as never} nativeID={thread ? `lienzo-comment-reply-${thread.id}` : 'lienzo-comment-new'} accessibilityLabel={thread ? 'Reply' : 'New comment'} autoFocus multiline numberOfLines={1} value={text} onChangeText={value => { setText(value); if (!value) setLines(K.composer.minHeight - 8); }} onKeyPress={keys as never}
          onContentSizeChange={e => { const h = Math.ceil(e.nativeEvent.contentSize.height); setLines(Math.max(K.composer.minHeight - 8, Math.min(K.composer.maxHeight, h))); }}
          placeholder={thread ? (resolved ? 'Reply to reopen…' : 'Reply…') : 'Add a comment…'} placeholderTextColor={u.c.foregroundMuted} editable={!state.busy || !!text}
          style={{ ...u.font('body'), flex: 1, height: lines, paddingVertical: 6, color: u.c.foreground, ...({ outlineStyle: 'none', resize: 'none' } as object) }} />
        <Pressable nativeID="lienzo-comment-send" accessibilityRole="button" accessibilityLabel={thread ? 'Send reply' : 'Comment'} disabled={!text.trim() || state.busy || text.length > COMMENT_LIMITS.text} onPress={() => { void send(); }}
          style={({ pressed }) => ({ width: 28, height: 28, borderRadius: 14, marginBottom: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: text.trim() ? u.c.accent : withAlpha(u.c.foreground, .08), opacity: pressed ? .8 : 1 })}>
          <Icon name="ArrowUp" size={15} color={text.trim() ? u.c.accentForeground : u.c.foregroundMuted} />
        </Pressable>
      </View>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
        <Txt kind="label" muted numberOfLines={1} style={{ flexShrink: 1 }}>{u.compact ? 'Your agent reads these when you ask.' : 'Enter to send · Shift+Enter for a new line'}</Txt>
        {over && <Txt kind="label" style={{ color: text.length > COMMENT_LIMITS.text ? u.c.statusDanger : u.c.foregroundMuted }}>{text.length}/{COMMENT_LIMITS.text}</Txt>}
      </View>
    </View>
  </View>;
}

/** The Comments tab of the right panel: open or resolved, newest activity first; a press flies there and opens it. */
export function CommentsList({ state, titleOf, onGo, inline }: { state: CommentsState; titleOf(id: string): string; onGo(thread: CommentThread): void; inline: boolean }) {
  const u = useUI(), [reading, setReading] = useState<string | null>(null), L = K.list;
  const list = useMemo(() => state.threads.filter(t => t.status === state.filter).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), [state.threads, state.filter]);
  const current = inline && reading ? state.threads.find(t => t.id === reading) : undefined;
  if (current) return <View nativeID="lienzo-comments-list" style={{ minHeight: 240 }}><ThreadView state={state} thread={current} titleOf={titleOf} onClose={() => setReading(null)} onBack={() => setReading(null)} /></View>;
  const openId = state.open?.kind === 'thread' ? state.open.id : null;
  return <View nativeID="lienzo-comments-list" style={{ paddingBottom: 6 }}>
    <View style={{ paddingHorizontal: tokens.face.rightPanel.padding, paddingTop: 10, paddingBottom: 8, gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <View style={{ flex: 1 }}><Segments value={state.filter} onChange={state.setFilter} options={[{ value: 'open', label: `Open${state.openCount ? ` ${state.openCount}` : ''}` }, { value: 'resolved', label: `Resolved${state.resolvedCount ? ` ${state.resolvedCount}` : ''}` }]} /></View>
        <IconButton icon={state.pins ? 'Eye' : 'EyeOff'} label={state.pins ? 'Hide pins' : 'Show pins'} detail="On the canvas. The comments stay here." active={!state.pins} onPress={() => state.setPins(v => !v)} />
      </View>
    </View>
    {!state.loaded ? <Txt kind="small" muted style={{ paddingHorizontal: tokens.face.rightPanel.padding, paddingVertical: 12 }}>Loading comments…</Txt>
      : !list.length ? <View style={{ alignItems: 'center', paddingHorizontal: 20, paddingVertical: 24, gap: 8 }}>
        <View style={{ width: 40, height: 40, borderRadius: 20, borderBottomLeftRadius: 5, backgroundColor: u.wash('acento'), alignItems: 'center', justifyContent: 'center' }}><Icon name={state.filter === 'open' ? 'MessageSquarePlus' : 'CheckCheck'} size={18} color={u.c.accent} /></View>
        <Txt kind="bodyStrong" style={{ textAlign: 'center' }}>{state.filter === 'open' ? 'No open comments' : 'Nothing resolved yet'}</Txt>
        <Txt kind="small" muted style={{ textAlign: 'center' }}>{state.filter === 'open' ? 'Press C, then a card, a Frame or an empty spot. Ask your agent to look at the comments when you are ready.' : 'Resolve a thread with ✓ when it is handled; it waits here.'}</Txt>
      </View>
      : list.map(thread => { const first = thread.messages[0], last = thread.messages[thread.messages.length - 1], agentReplied = thread.messages.some(m => m.author.kind === 'agent');
        return <Pressable key={thread.id} nativeID={`lienzo-comment-row-${thread.id}`} accessibilityRole="button" accessibilityLabel={`${authorName(first.author)}: ${first.text.slice(0, 80)}`} onPress={() => { if (inline) setReading(thread.id); else onGo(thread); }}
          style={({ pressed, ...s }) => ({ minHeight: L.row, marginHorizontal: 6, paddingHorizontal: 8, paddingVertical: 8, borderRadius: 8, flexDirection: 'row', gap: 10, backgroundColor: openId === thread.id ? withAlpha(u.c.accent, .1) : pressed ? withAlpha(u.c.foreground, .08) : hovered(s) ? withAlpha(u.c.foreground, .04) : 'transparent' })}>
          <View style={{ paddingTop: 1 }}><Avatar author={first.author} size={L.avatar} /></View>
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}><Txt kind="bodyStrong" numberOfLines={1} style={{ flexShrink: 1 }}>{authorName(first.author)}</Txt><Txt kind="label" muted numberOfLines={1}>{relativeTime(thread.updatedAt)}</Txt></View>
            <Txt kind="small" numberOfLines={L.excerptLines}>{first.text}</Txt>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Txt kind="label" muted numberOfLines={1} style={{ flexShrink: 1 }}>{where(thread.anchor, thread, titleOf)}</Txt>
              {thread.messages.length > 1 && <Txt kind="label" style={{ color: agentReplied ? u.c.accent : u.c.foregroundMuted }}>· {thread.messages.length - 1} {thread.messages.length === 2 ? 'reply' : 'replies'}{last.author.kind === 'agent' ? ' · agent answered' : ''}</Txt>}
            </View>
          </View>
        </Pressable>; })}
  </View>;
}
