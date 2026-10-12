import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Icon, ScrollView } from '@getpaseo/plugin/client/react-native';
import { onCanvasIntent, takeCanvasIntent, type CanvasIntent } from './copilot/intent';
import type { Point, Rect } from './logic';
import { currentHoja, hojasOf, type Hoja } from './hojas-model';
export type { Hoja } from './hojas-model';
import { reducedMotion } from './motion';
import { tokens } from './tokens';
import { IconButton, Tooltip, Txt, useUI } from './ui';
import type { CanvasController } from './useCanvas';
import { islandStyle } from './whiteboard-visuals';

/** How long what the agent just added glows, in ms. */
export const GLOW_MS = 3000;
type Geometry = { rects: Map<string, Rect>; center: Point };
export type CopilotCanvas = {
  hojas: Hoja[]; current: number; follow: boolean; glowIds: string[]; unseen: boolean; menuOpen: boolean;
  setMenuOpen(open: boolean): void; toggleFollow(): void; goToLatest(): boolean; goToHoja(index: number): boolean; step(direction: 1 | -1): boolean; userMoved(): void;
};
/**
 * The canvas side of the copilot. While following, every new transaction of the agent flies the camera to what it
 * changed and makes it glow; moving the camera yourself lets go, and "Agent's latest" (or G) takes you back and
 * follows again. Hojas are walked with [ and ], and the pill in the conversation hands its intent over on open.
 */
export function useCopilotCanvas({ c, fly, geometry, center, active }: { c: CanvasController; fly(ids: string[]): void; geometry: React.MutableRefObject<Geometry>; center(): Point | undefined; active: boolean }): CopilotCanvas {
  const doc = c.view?.document, latest = c.view?.latestAgent ?? null, hojas = useMemo(() => hojasOf(doc?.groups ?? []), [doc?.groups]);
  const [follow, setFollow] = useState(true), [glowIds, setGlowIds] = useState<string[]>([]), [unseen, setUnseen] = useState(false), [menuOpen, setMenuOpen] = useState(false), [current, setCurrent] = useState(-1);
  const seen = useRef<{ doc: string | null; tx: string | null }>({ doc: null, tx: null }), timer = useRef<ReturnType<typeof setTimeout> | null>(null), intent = useRef<CanvasIntent | null>(null);
  const glow = (ids: string[]) => { if (timer.current) clearTimeout(timer.current); setGlowIds(ids); timer.current = setTimeout(() => setGlowIds([]), reducedMotion.current ? GLOW_MS / 2 : GLOW_MS); };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const land = (ids: string[]) => { if (!ids.length) return false; fly(ids); glow(ids); moved.current = true; setTimeout(look, 900); return true; };
  // A new agent transaction on the open document. The first one seen after opening is history, not news.
  useEffect(() => {
    if (!doc) return; const tx = latest?.transactionId ?? null;
    if (seen.current.doc !== doc.id) { seen.current = { doc: doc.id, tx }; setUnseen(false); return; }
    if (!tx || tx === seen.current.tx) return; seen.current.tx = tx;
    if (follow && active && latest!.ids.length) { land(latest!.ids); setUnseen(false); } else if (latest!.ids.length) setUnseen(true);
  }, [doc?.id, latest?.transactionId, active]);
  // What the chip in the conversation asked for: open its Lienzo and, for "latest", go there.
  useEffect(() => {
    const claim = () => { const next = takeCanvasIntent(c.workspaceId); if (next) intent.current = next; settle(); };
    const settle = () => {
      const want = intent.current; if (!want) return;
      if (c.current.current?.document.id !== want.documentId) { if (!c.loading && !c.busy) void c.open(want.documentId); return; }
      intent.current = null; if (want.kind === 'latest') { setFollow(true); setUnseen(false); setTimeout(() => land(want.ids), 120); }
    };
    claim(); const stop = onCanvasIntent(claim); settleRef.current = settle; return stop;
  }, [c.workspaceId]);
  const settleRef = useRef<() => void>(() => {}); useEffect(() => { settleRef.current(); }, [doc?.id]);
  // Where the camera is, read live: the geometry ref only changes with the layout. After a jump the camera is still
  // flying, so the Hoja we jumped to stands until the person moves the camera themselves.
  const moved = useRef(true);
  const look = () => { const g = geometry.current, i = currentHoja(hojas, g.rects, center() ?? g.center); setCurrent(i); return i; };
  useEffect(() => { if (moved.current) look(); }, [hojas, doc?.revision]);
  const goToHoja = (index: number) => { const h = hojas[index]; if (!h) return false; setFollow(false); setCurrent(index); moved.current = false; fly([h.id]); setMenuOpen(false); return true; };
  return {
    hojas, current, follow, glowIds, unseen, menuOpen, setMenuOpen,
    toggleFollow: () => { const next = !follow; setFollow(next); if (next && unseen && latest) { land(latest.ids); setUnseen(false); } },
    goToLatest: () => { if (!latest?.ids.length) return false; setFollow(true); setUnseen(false); return land(latest.ids); },
    goToHoja, step: direction => { if (!hojas.length) return false; const at = moved.current || current < 0 ? look() : current; return goToHoja(at < 0 ? (direction > 0 ? 0 : hojas.length - 1) : Math.max(0, Math.min(hojas.length - 1, at + direction))); },
    userMoved: () => { if (follow) setFollow(false); moved.current = true; setTimeout(look, 0); },
  };
}

/** "Hoja 3 of 7 ▾" and the magnet that follows the agent, for the top island. */
export function HojaControls({ copilot, shortcut }: { copilot: CopilotCanvas; shortcut(id: string): string | undefined }) {
  const u = useUI(), { hojas, current } = copilot, H = tokens.face.hojas;
  return <View style={{ flexDirection: 'row', alignItems: 'center' }}>
    {!!hojas.length && <Tooltip label="Hojas" detail="Each Hoja is a chapter the agent added while explaining (Spanish for sheet)." shortcut={shortcut('hoja.jump')}><Pressable nativeID="lienzo-hoja-menu" accessibilityRole="button" accessibilityLabel={`Hoja ${current + 1 || '–'} of ${hojas.length}`} onPress={() => copilot.setMenuOpen(!copilot.menuOpen)}
      style={({ pressed, ...state }) => ({ flexDirection: 'row', alignItems: 'center', gap: 4, height: H.button, paddingHorizontal: 10, borderRadius: 8, backgroundColor: copilot.menuOpen || pressed ? u.c.surface2 : (state as { hovered?: boolean }).hovered ? u.c.surface2 : 'transparent' })}>
      <Txt kind="small" style={{ fontWeight: '600' }}>Hoja {current >= 0 ? current + 1 : '–'}</Txt><Txt kind="small" muted>of {hojas.length}</Txt><Icon name="ChevronDown" size={12} color={u.c.foregroundMuted} />
    </Pressable></Tooltip>}
    <IconButton icon="Magnet" label={copilot.follow ? 'Following the agent' : 'Follow the agent'} detail={copilot.follow ? 'The camera goes wherever the agent draws. Move it yourself to let go.' : 'Stick to the agent: the camera goes wherever it draws.'} shortcut={shortcut('agent.follow')} size={36} active={copilot.follow} onPress={copilot.toggleFollow} />
  </View>;
}
/** The list behind "Hoja 3 of 7". */
export function HojaMenu({ copilot, left, top, maxHeight }: { copilot: CopilotCanvas; left: number; top: number; maxHeight: number }) {
  const u = useUI(), H = tokens.face.hojas;
  if (!copilot.menuOpen) return null;
  return <><Pressable accessibilityLabel="Close Hojas" onPress={() => copilot.setMenuOpen(false)} style={{ position: 'absolute', inset: 0, zIndex: 40 }} />
    <View nativeID="lienzo-hoja-list" accessibilityRole="menu" style={[islandStyle(u, true), { position: 'absolute', left, top, width: H.menuWidth, maxHeight, zIndex: 41, padding: 6 }]}>
      <ScrollView>{copilot.hojas.map((h, i) => <Pressable key={h.id} accessibilityRole="menuitem" accessibilityLabel={`Hoja ${h.number}: ${h.title}`} onPress={() => copilot.goToHoja(i)}
        style={({ pressed, ...state }) => ({ flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: H.row, paddingHorizontal: 8, borderRadius: 6, backgroundColor: i === copilot.current ? u.wash('acento') : pressed || (state as { hovered?: boolean }).hovered ? u.c.surface2 : 'transparent' })}>
        <Txt kind="label" muted style={{ width: 22, textAlign: 'right' }}>{h.number}</Txt><Txt kind="small" numberOfLines={1} style={{ flex: 1, fontWeight: i === copilot.current ? '600' : '400' }}>{h.title}</Txt>
      </Pressable>)}</ScrollView>
    </View></>;
}
/** When you are not following and the agent drew somewhere else: one press takes you there. */
export function LatestPill({ copilot, bottom, label }: { copilot: CopilotCanvas; bottom: number; label?: string }) {
  const u = useUI();
  if (!copilot.unseen || copilot.follow) return null;
  return <View pointerEvents="box-none" style={{ position: 'absolute', left: 0, right: 0, bottom, alignItems: 'center', zIndex: 20 }}>
    <Pressable nativeID="lienzo-agent-latest" accessibilityRole="button" accessibilityLabel="Go to the agent's latest" onPress={() => copilot.goToLatest()}
      style={({ pressed }) => [islandStyle(u), { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, height: 36, borderRadius: 18, opacity: pressed ? .8 : 1 }]}>
      <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: u.c.accent }} /><Txt kind="small" style={{ fontWeight: '600' }}>Agent's latest</Txt>{!!label && <Txt kind="small" muted numberOfLines={1} style={{ maxWidth: 220 }}>{label}</Txt>}<Icon name="ArrowRight" size={14} color={u.c.foreground} />
    </Pressable>
  </View>;
}
