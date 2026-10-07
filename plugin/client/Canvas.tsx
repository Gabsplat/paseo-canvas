import React, { useCallback, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Animated, PanResponder, Pressable, View, type GestureResponderEvent, type GestureResponderHandlers, type PanResponderGestureState } from 'react-native';
import { Icon, ScrollView } from '@getpaseo/plugin/client/react-native';
import type { CanvasBlock, CanvasDocument, CanvasGroup } from '../shared/model';
import type { CanvasController } from './useCanvas';
import { alignmentGuides, anchorCard, boundsOf, connectOperations, descriptionKey, dropTarget, edgePan, fitCamera, hasCommunication, initialCamera, layoutCanvas, linkFocus, linkMagnet, linkRoutes, manual, marqueeSelection, moveOperations, minimumBlockSize, resizeBlockSize, snap, topSelection, travellers, zoomAround, type Camera, type Guide, type Point, type Rect, type FrameShift, type MagnetTarget, type Side } from './logic';
import { tokens } from './tokens';
import { isDark, withAlpha } from './color';
import { BlockCard, ConnectionRows } from './Blocks';
import { usePresentation } from './usePresentation';
import { prepareLinkMotion } from './link-motion';
import { getClientRenderer } from './renderers';
import { LinkLayer, type LinkLayerHandle, type LinkDraft } from './Links';
import { MagnetCue } from './MagnetCue';
import { Chip, Txt, useUI } from './ui';
import { attachEntityDrag, attachMiddlePan, attachWheel, isDragHandle, isTextTarget, swallowClick, type CanvasPointer } from './web';
import { Appear, NATIVE, easeOut, frame, glide, reducedMotion, settle, useReducedMotion } from './motion';
import { DEFAULT_TOOL_STYLE, type CanvasTool, type CanvasToolProps, type SvgInsertOptions } from './whiteboard-tools';
import { isWhiteboardRenderer, whiteboardMinSize, type WbRenderer } from '../shared/whiteboard';
import { useWhiteboard } from './useWhiteboard';
import { WhiteboardContent } from './WhiteboardContent';
import { Minimap, SelectionBeacon } from './Wayfinding';
import { WhiteboardEditor, WhiteboardPreview } from './WhiteboardOverlay';
import { LinkLabelEditor, SelectionOverlay, type LinkLabelSession } from './SelectionOverlay';
import { ZoomControl } from './ZoomControl';
import { ContentInteractionProvider, needsContentInteraction } from './interaction';
import { resizeWhiteboardBox, resizeLineBox, lineEnds, type ResizeHandle } from './whiteboard-geometry';
import { islandStyle } from './whiteboard-visuals';
import { attachToolPointer, attachCanvasKeys } from './web';
export type { CanvasTool } from './whiteboard-tools';
export type { Camera } from './logic';
/** What the panel can ask of the canvas: camera moves, and "the next change is a keystroke, do not animate it". */
export type CanvasApi = { fit(): void; zoomToSelection(): void; zoomStep(direction: 1 | -1): void; zoomTo(scale: number): void; instant(): void; setTool(tool: CanvasTool): void; getTool(): CanvasTool; cancelGesture(): void; viewportCenter(): Point; insertSvg(svg: string, options?: SvgInsertOptions): Promise<boolean>; beginInteraction(id?: string): void; endInteraction(): void; editSelection(): void; editLinkLabel(): void; interactionId(): string | null };
const G = tokens.graph, M = tokens.motion, C = tokens.motion.camera;
type Page = { pageX?: number; pageY?: number; target?: unknown };
type Box = { x: number; y: number; width: number; height: number };
/**
 * Where a frame is drawn = where the layout puts it (`target`, a plain style) + `x`/`y`, an offset that is zero at rest.
 * A drag writes the offset directly; a layout change keeps the frame where it was and lets the offset run out.
 * `off` mirrors the offset so connectors can follow without asking Animated for its value.
 */
type Anim = { x: Animated.Value; y: Animated.Value; lift: Animated.Value; enter: Animated.Value; scale: Animated.AnimatedNode; w: Animated.Value; h: Animated.Value; off: Point; extent: { width: number; height: number }; target: Box | null; native: boolean; epoch: number };
function createAnim(native: boolean): Anim {
  const x = new Animated.Value(0), y = new Animated.Value(0), lift = new Animated.Value(0), enter = new Animated.Value(1), off = { x: 0, y: 0 };
  x.addListener(({ value }) => { off.x = value; }); y.addListener(({ value }) => { off.y = value; });
  const scale = Animated.multiply(lift.interpolate({ inputRange: [0, 1], outputRange: [1, M.drag.liftScale] }), enter.interpolate({ inputRange: [0, 1], outputRange: [M.enter.scale, 1] }));
  const w = new Animated.Value(0), h = new Animated.Value(0), extent = { width: 0, height: 0 };
  w.addListener(({ value }) => { extent.width = value; }); h.addListener(({ value }) => { extent.height = value; });
  return { x, y, lift, enter, scale, w, h, off, extent, target: null, native, epoch: 0 };
}
type Gesture = { documentId: string; epoch: number; id: string; ids: string[]; tops: string[]; moving: string[]; origin: Map<string, Point>; grab: Point; pointer: Point; vp: Point; measured: boolean; home: string | null; target: string | null; delta: Point; aligned: { x: boolean; y: boolean }; others: Box[]; grown: Set<string> };
type BlockItemProps = {
  interacting: boolean; block: CanvasBlock; left: number; top: number; width: number; height?: Animated.Value; resizeHandlers?: GestureResponderHandlers; anim: Anim; selected: boolean; lifted: boolean; dim: boolean; ringed: boolean; detailsSide: 'right' | 'bottom'; cursor?: string;
  handlers: GestureResponderHandlers; controller: CanvasController; accent: string; shadow: string;
  onSelect: (id: string, event?: GestureResponderEvent, multi?: boolean) => void; onInspect: () => void; onPacks: () => void; onReorder: (id: string, direction: number) => void; onHover: (id: string, inside: boolean) => void; onMeasure: (id: string, height: number) => void;
};
const lastEvent = (c: CanvasController, id: string) => { for (let i = c.events.length - 1; i >= 0; i--) if (c.events[i].action.targetIds?.includes(id)) return c.events[i]; return undefined; };
// A card re-renders for what it shows. Where it sits, whether it is dimmed, hover elsewhere, the camera and polls that
// brought nothing new for it are handled around it without touching its contents.
type CardProps = Pick<BlockItemProps, 'interacting' | 'block' | 'height' | 'selected' | 'lifted' | 'detailsSide' | 'cursor' | 'controller' | 'onSelect' | 'onInspect' | 'onPacks' | 'onReorder' | 'onHover' | 'onMeasure'>;
function sameCard(a: CardProps, b: CardProps) {
  const id = a.block.id, p = a.controller, n = b.controller, pe = lastEvent(p, id), ne = lastEvent(n, id);
  return a.interacting === b.interacting && a.block === b.block && a.selected === b.selected && a.lifted === b.lifted && a.height === b.height && a.detailsSide === b.detailsSide && a.cursor === b.cursor
    && (p.selection === n.selection || p.catalog?.blockTypes.find(t => t.id === a.block.typeId)?.renderer !== 'file-tree')
    && p.catalog === n.catalog && p.offline === n.offline && p.failure === n.failure && p.pendingIds.includes(id) === n.pendingIds.includes(id) && (!a.selected || (p.selection.length === 1) === (n.selection.length === 1))
    && (p.busy === n.busy || p.catalog?.blockTypes.find(t => t.id === a.block.typeId)?.renderer === 'node')
    && p.view?.document.example === n.view?.document.example && pe?.id === ne?.id && pe?.status === ne?.status && pe?.error === ne?.error;
}
const Card = React.memo(function Card({ interacting, block, height, selected, lifted, detailsSide, cursor, controller, onSelect, onInspect, onPacks, onReorder, onHover, onMeasure }: CardProps) {
  return <ContentInteractionProvider value={interacting}><BlockCard controller={controller} onSelect={onSelect} onInspect={onInspect} onPacks={onPacks} onReorder={onReorder} block={block} height={height} selected={selected} dragging={lifted} onHover={onHover} detailsSide={detailsSide} cursor={cursor} onMeasure={h => onMeasure(block.id, h)} /></ContentInteractionProvider>;
}, sameCard);
const BlockItem = React.memo(function BlockItem({ left, top, width, resizeHandlers, anim, dim, ringed, handlers, accent, shadow, ...card }: BlockItemProps) {
  return <Animated.View nativeID={`lienzo-entity-${card.block.id}`} {...handlers} style={{ position: 'absolute', left, top, width: anim.target ? anim.w : width, zIndex: card.lifted || card.selected ? 3 : 2, ...noSelect, opacity: anim.enter, transform: [{ translateX: anim.x }, { translateY: anim.y }, { scale: anim.scale }] }}>
    <Animated.View pointerEvents="none" style={{ position: 'absolute', inset: 0, borderRadius: tokens.radius.block, boxShadow: shadow, opacity: anim.lift }} />
    <View nativeID={card.interacting ? `lienzo-using-${card.block.id}` : undefined} style={{ opacity: dim && !card.lifted ? G.dim.node : 1 }}><Card {...card} /></View>
    {resizeHandlers && <View nativeID={`lienzo-interactive-resize-${card.block.id}`} {...resizeHandlers} style={{ position: 'absolute', right: -12, bottom: -12, width: tokens.canvas.resize.hit, height: tokens.canvas.resize.hit, zIndex: 4 }}><Pressable accessibilityRole="button" accessibilityLabel={`Redimensionar: ${card.block.title}`} accessibilityHint="Arrastra la esquina. Shift mantiene la proporción. Usa el inspector para escribir medidas exactas." onPress={e => { e.stopPropagation(); card.onInspect(); }} style={{ flex: 1, alignItems: 'center', justifyContent: 'center', ...({ cursor: 'nwse-resize' } as object) }}><View pointerEvents="none" style={{ width: tokens.canvas.resize.size, height: tokens.canvas.resize.size, borderRadius: tokens.canvas.resize.radius, borderWidth: 1.5, borderColor: accent }} /></Pressable></View>}

    {card.interacting && <View pointerEvents="none" style={{position:"absolute",inset:2,borderRadius:tokens.radius.block-2,borderWidth:2,borderColor:accent}}/>}
    {ringed && <View pointerEvents="none" style={{ position: 'absolute', inset: -4, borderRadius: tokens.radius.block + 4, borderWidth: 2, borderColor: accent }} />}
  </Animated.View>;
}, (a, b) => a.left === b.left && a.top === b.top && a.width === b.width && a.anim === b.anim && a.dim === b.dim && a.ringed === b.ringed && a.handlers === b.handlers && a.resizeHandlers === b.resizeHandlers && a.accent === b.accent && a.shadow === b.shadow && sameCard(a, b));
export function Canvas({ controller: c, mode, onInspect, onPacks, reorder, onGeometry, linkId, onLink, api, onRelease, tool, onToolChange, toolStyle = DEFAULT_TOOL_STYLE, toolLocked = false, onInteractionChange, selectionToolbar }: CanvasToolProps & { controller: CanvasController; mode: 'canvas' | 'outline'; onInspect: () => void; onPacks: () => void; reorder: (id: string, d: number) => void; onGeometry: (rects: Map<string, Rect>, center: Point) => void; linkId: string | null; onLink: (id: string | null) => void; api?: React.Ref<CanvasApi>; onRelease?: (ids: string[]) => void; onInteractionChange?: (id: string | null) => void; selectionToolbar?: React.ReactNode }) {
  const [interaction, setInteraction] = useState<string | null>(null), interactionRef = useRef<string | null>(null), interactionCallback = useRef(onInteractionChange); interactionCallback.current = onInteractionChange;
  const setInteractionMode = (id: string | null) => { interactionRef.current = id; setInteraction(id); interactionCallback.current?.(id); };
  const styleRef = useRef(toolStyle); styleRef.current = toolStyle; const lockedRef = useRef(toolLocked); lockedRef.current = toolLocked;
  const spaceTool = useRef<CanvasTool | null>(null);
  const [localTool, setLocalTool] = useState<CanvasTool>('select');
  const toolRef = useRef(tool ?? localTool); toolRef.current = tool ?? localTool;
  const toolCallback = useRef(onToolChange); toolCallback.current = onToolChange;
  const chooseTool = (next: CanvasTool) => { toolRef.current = next; setLocalTool(next); toolCallback.current?.(next); };
  const presentation = usePresentation(c), u = useUI(), doc = presentation?.document ?? c.view!.document, web = u.layout.platform === 'web', [size, setSize] = useState({ width: 0, height: 0 }), [heights, setHeights] = useState<Record<string, number>>({}), [multi, setMulti] = useState(false), [hover, setHover] = useState<string | null>(null), [linkHover, setLinkHover] = useState<string | null>(null), [linkDraft, setLinkDraft] = useState<{ from: string; to: Point; target: string | null } | null>(null);
  // `ids` stay raised and styled as lifted until they have settled; `live` is true only while the hand is down.
  const [drag, setDrag] = useState<{ ids: Set<string>; into: string | null; live: boolean } | null>(null);
  const [resizeId, setResizeId] = useState<string | null>(null);
  const resize = useRef<{ id: string; documentId: string; start: Box; pointer: Point; next: { width: number; height: number }; proportional: boolean; held: boolean; handle: ResizeHandle; nextPosition: Point; from?: string; parents: string[] } | null>(null);
  useReducedMotion();
  const motionSources = useMemo(() => c.catalog ? prepareLinkMotion(c.view!.document, c.catalog, getClientRenderer) : undefined, [c.view!.document, c.catalog]);
  const linkMotion = useCallback((epochMs: number) => motionSources?.(c.learning.getSnapshot(), epochMs, presentation?.hiddenBy ?? new Map()) ?? { tokens: [], playing: false }, [motionSources, c.learning, presentation?.hiddenBy]);
  const marquee = useRef<{ x: number; y: number; origin: Point; add: boolean } | null>(null), marqueeOn = useRef(false), box = useRef({ x: new Animated.Value(0), y: new Animated.Value(0), w: new Animated.Value(0), h: new Animated.Value(0), o: new Animated.Value(0) }).current;
  marqueeOn.current = web && !u.compact;
  /** The entity last selected by pressing it on the canvas; a selection that is not this one came from elsewhere. */
  const pressed = useRef<string | null>(null);
  const viewport = useRef<View>(null), marks = useRef<View>(null), links = useRef<LinkLayerHandle>(null), vp = useRef<Point | null>(null);
  const layout = useMemo(() => layoutCanvas(doc, heights, c.catalog, size.width || undefined), [doc, heights, c.catalog, size.width]), rects = layout.rects, index = layout.index;
  const roots = [...doc.groups, ...doc.blocks].filter(e => !e.parentGroupId).map(e => rects.get(e.id)!);
  const minX = Math.min(0, ...roots.map(r => r.x)), minY = Math.min(0, ...roots.map(r => r.y)), maxX = Math.max(0, ...roots.map(r => r.x + r.width)), maxY = Math.max(0, ...roots.map(r => r.y + r.height));
  const bound = { x: minX - 600, y: minY - 600, width: maxX - minX + 1200, height: maxY - minY + 1200 };
  const ready = doc.blocks.filter(b => !rects.get(b.id)?.hidden).every(b => !!b.size || ['wb-shape','wb-svg','wb-draw'].includes(c.catalog?.blockTypes.find(t => t.id === b.typeId)?.renderer ?? '') || heights[b.id] !== undefined), fitted = useRef('');
  const latest = useRef({ size, c, doc, layout, rects, bound, onLink, onGeometry, onRelease, linkDraft, linkId }); latest.current = { size, c, doc, layout, rects, bound, onLink, onGeometry, onRelease, linkDraft, linkId };
  // ---- Camera. `screen = scale · world + offset`. It lives in a ref and three Animated values, never in React state,
  // so panning, zooming and auto-panning do not render anything.
  const cam = useRef<Camera>({ scale: 1, offset: { x: 24, y: 24 } }), goal = useRef<Camera | null>(null), camSubs = useRef(new Set<() => void>());
  const camX = useRef(new Animated.Value(24)).current, camY = useRef(new Animated.Value(24)).current, camS = useRef(new Animated.Value(1)).current, travel = useRef(new Animated.Value(0)).current, shown = useRef(new Animated.Value(0)).current;
  const coast = useRef<number | null>(null), autoPan = useRef<number | null>(null), followFrame = useRef<number | null>(null), followUntil = useRef(0), raise = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftX = useRef(new Animated.Value(0)).current, draftY = useRef(new Animated.Value(0)).current, draftTo = useRef<Point>({ x: 0, y: 0 }), draftLive = useRef<LinkDraft | null>(null);
  const [sparkPulse, setSparkPulse] = useState(0), lastSpark = useRef(0);
  useEffect(() => {
    const update = () => { if (draftLive.current) { draftLive.current.to = { ...draftTo.current }; links.current?.preview(draftLive.current); } };
    const x = draftX.addListener(({ value }) => { draftTo.current.x = value; update(); }), y = draftY.addListener(({ value }) => { draftTo.current.y = value; update(); });
    return () => { draftX.stopAnimation(); draftY.stopAnimation(); draftX.removeListener(x); draftY.removeListener(y); };
  }, []);
  const [linkLabel, setLinkLabel] = useState<LinkLabelSession | null>(null);
  const selectionPointer = useRef<Point | null>(null);
  const busyHands = useRef(false), gesture = useRef<Gesture | null>(null), linkGesture = useRef<{ documentId: string; from: string; origin: Point; side: Side; grab: Point; viewport: Point; target: MagnetTarget | null } | null>(null), textGesture = useRef(false), panFrom = useRef<Point>({ x: 0, y: 0 });
  const anims = useRef(new Map<string, Anim>()), placed = useRef(false), instantUntil = useRef(0), dropped = useRef(new Map<string, number>()), gestureEpoch = useRef(0);
  const guideV = useRef({ x: new Animated.Value(0), y: new Animated.Value(0), length: new Animated.Value(0), thickness: new Animated.Value(1), opacity: new Animated.Value(0) }).current, guideH = useRef({ x: new Animated.Value(0), y: new Animated.Value(0), length: new Animated.Value(0), thickness: new Animated.Value(1), opacity: new Animated.Value(0) }).current;
  const animOf = (id: string, native: boolean) => { let a = anims.current.get(id); if (!a) { a = createAnim(native); anims.current.set(id, a); } return a; };
  const center = (): Point => ({ x: (latest.current.size.width / 2 - cam.current.offset.x) / cam.current.scale, y: (latest.current.size.height / 2 - cam.current.offset.y) / cam.current.scale });
  function setCam(next: Camera) {
    cam.current = next; camX.setValue(next.offset.x); camY.setValue(next.offset.y); camS.setValue(next.scale);
    camSubs.current.forEach(listener => listener()); latest.current.onGeometry(latest.current.rects, center());
    if (gesture.current) applyDrag(); // the world moved under a hand that did not
  }
  function halt() { if (coast.current !== null) { cancelAnimationFrame(coast.current); coast.current = null; } travel.stopAnimation(); travel.removeAllListeners(); goal.current = null; }
  /** Camera moves a control or a key asked for: ease-out, interruptible, anchored because scale and offset share one progress. */
  function flyTo(to: Camera, ms: number) {
    halt();
    if (reducedMotion.current || !ms) { setCam(to); return; }
    const from = cam.current; goal.current = to; travel.setValue(0);
    travel.addListener(({ value }) => setCam({ scale: from.scale + (to.scale - from.scale) * value, offset: { x: from.offset.x + (to.offset.x - from.offset.x) * value, y: from.offset.y + (to.offset.y - from.offset.y) * value } }));
    Animated.timing(travel, { toValue: 1, duration: ms, easing: easeOut, useNativeDriver: false }).start(({ finished }) => { if (finished && goal.current === to) goal.current = null; });
  }
  /** After a flick the canvas keeps going and slows down on its own. Velocity in px/ms. */
  function momentum(vx: number, vy: number) {
    if (reducedMotion.current || Math.hypot(vx, vy) < C.flickMin) return;
    let last = Date.now();
    const step = () => {
      const now = Date.now(), dt = Math.min(48, now - last); last = now;
      setCam({ scale: cam.current.scale, offset: { x: cam.current.offset.x + vx * dt, y: cam.current.offset.y + vy * dt } });
      const k = Math.pow(C.deceleration, dt); vx *= k; vy *= k;
      coast.current = Math.hypot(vx, vy) > C.stopBelow ? frame(step) : null;
    };
    coast.current = frame(step);
  }
  const zoomTo = (scale: number, anchor: Point = { x: latest.current.size.width / 2, y: latest.current.size.height / 2 }, ms: number = C.stepMs) => flyTo(zoomAround(goal.current ?? cam.current, scale, anchor), ms);
  const zoomStep = (direction: 1 | -1) => { const from = (goal.current ?? cam.current).scale, steps = tokens.canvas.zoomSteps; zoomTo(direction > 0 ? steps.find(s => s > from + .01) ?? tokens.canvas.zoomMax : [...steps].reverse().find(s => s < from - .01) ?? tokens.canvas.zoomMin); };
  const visible = (ids: string[]) => ids.map(id => latest.current.rects.get(id)).filter((r): r is Rect => !!r && !r.hidden);
  function fit(ids?: string[]) {
    const { size, doc } = latest.current; if (!size.width || !size.height) return;
    const box = boundsOf(visible(ids?.length ? ids : [...doc.groups, ...doc.blocks].filter(e => !e.parentGroupId).map(e => e.id))); if (box) flyTo(fitCamera(size, box, tokens.canvas.fitMax), C.fitMs);
  }
  useEffect(() => { if (ready && size.width && size.height && fitted.current !== doc.id) {
    const x = roots.length ? Math.min(...roots.map(r => r.x)) : 0, y = roots.length ? Math.min(...roots.map(r => r.y)) : 0;
    halt(); setCam(initialCamera(size.width, { x, y, width: roots.length ? Math.max(...roots.map(r => r.x + r.width)) - x : 0 }, u.compact)); fitted.current = doc.id; glide(shown, 1, { ms: M.fast, native: NATIVE });
  } }, [ready, size, doc.id]);
  useEffect(() => { onGeometry(rects, center()); }, [rects, size]);
  useEffect(() => () => { halt(); for (const id of [autoPan.current, followFrame.current]) if (id !== null) cancelAnimationFrame(id); if (raise.current) clearTimeout(raise.current); gesture.current = null; }, []);
  const measureViewport = () => { (viewport.current as unknown as { measure?: (done: (x: number, y: number, w: number, h: number, pageX: number, pageY: number) => void) => void } | null)?.measure?.((_x, _y, _w, _h, pageX, pageY) => { if (Number.isFinite(pageX) && Number.isFinite(pageY)) vp.current = { x: pageX, y: pageY }; }); };
  useEffect(() => { if (!web || mode !== 'canvas') return;
    const wheel = attachWheel(viewport.current, e => {
      if (!e.command) { halt(); setCam({ scale: cam.current.scale, offset: { x: cam.current.offset.x - e.dx, y: cam.current.offset.y - e.dy } }); return; }
      // A trackpad pinch arrives as many small steps and is followed exactly; a wheel notch is one big step and is eased.
      const from = goal.current ?? cam.current, next = zoomAround(from, from.scale * Math.exp(-e.dy * .002), e);
      if (Math.abs(e.dy) >= C.wheelNotch) flyTo(next, C.wheelMs); else { halt(); setCam(next); }
    });
    const middle = attachMiddlePan(viewport.current, e => { halt(); setCam({ scale: cam.current.scale, offset: { x: cam.current.offset.x + e.dx, y: cam.current.offset.y + e.dy } }); }, v => momentum(v.vx, v.vy));
    return () => { wheel(); middle(); };
  }, [mode, web]);
  // The background pans. It is an ancestor of every frame, so a drag that starts on a group's body pans too; blocks and
  // group headers sit deeper and claim their own drags first.
  const pan = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponderCapture: event => { textGesture.current = isTextTarget((event.nativeEvent as Page).target); halt(); return false; },
    // Claim only a movement. Taking the start here can prevent a child wrapper from ever seeing move negotiation
    // after its Pressable has been reparented. A separate background Pressable handles taps below the world.
    onStartShouldSetPanResponder: () => false,
    onMoveShouldSetPanResponder: (_, g) => toolRef.current === 'select' && !textGesture.current && !gesture.current && !resize.current && !linkGesture.current && Math.abs(g.dx) + Math.abs(g.dy) > M.drag.threshold,
    // With a pointer, dragging over the canvas with the select tool draws a selection box, as on a desktop; the
    // hand tool, Space, the middle button and the wheel move the view. Touch keeps one-finger panning.
    onPanResponderGrant: (event, g) => {
      busyHands.current = true; panFrom.current = cam.current.offset;
      if (!marqueeOn.current) return;
      measureViewport(); const origin = vp.current ?? { x: 0, y: 0 }, key = event.nativeEvent as unknown as { shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean };
      marquee.current = { x: g.x0 - origin.x, y: g.y0 - origin.y, origin, add: !!(key.shiftKey || key.metaKey || key.ctrlKey) }; box.o.setValue(1);
    },
    onPanResponderMove: (_, g) => {
      const m = marquee.current; if (!m) { setCam({ scale: cam.current.scale, offset: { x: panFrom.current.x + g.dx, y: panFrom.current.y + g.dy } }); return; }
      const x = g.moveX - m.origin.x, y = g.moveY - m.origin.y; box.x.setValue(Math.min(m.x, x)); box.y.setValue(Math.min(m.y, y)); box.w.setValue(Math.abs(x - m.x)); box.h.setValue(Math.abs(y - m.y));
    },
    onPanResponderTerminate: () => { busyHands.current = false; marquee.current = null; box.o.setValue(0); },
    onPanResponderRelease: (_, g) => { busyHands.current = false;
      const m = marquee.current; marquee.current = null; box.o.setValue(0); box.w.setValue(0); box.h.setValue(0);
      if (m && Math.abs(g.dx) + Math.abs(g.dy) >= M.drag.threshold) {
        const a = toWorld({ x: m.x + m.origin.x, y: m.y + m.origin.y }, m.origin), b = toWorld({ x: g.moveX, y: g.moveY }, m.origin), { doc, rects, c } = latest.current;
        const ids = marqueeSelection(doc, rects, { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(b.x - a.x), height: Math.abs(b.y - a.y) });
        swallowClick(); pressed.current = null; latest.current.onLink(null); void c.select(m.add ? [...new Set([...c.selection, ...ids])] : ids); return;
      }
      if (Math.abs(g.dx) + Math.abs(g.dy) < M.drag.threshold) { setMulti(false); latest.current.onLink(null); void latest.current.c.select([]); } else { swallowClick(); momentum(g.vx, g.vy); } },
  }), []);
  const nativeTwoPan = useRef(false);
  const toolEvent = (event: GestureResponderEvent, g: PanResponderGestureState): CanvasPointer => { const page = event.nativeEvent as Page; return { x: page.pageX ?? g.moveX, y: page.pageY ?? g.moveY, pointerId: 0, shift: false, command: false }; };
  const nativeTools = useMemo(() => PanResponder.create({
    onStartShouldSetPanResponderCapture: () => !web && toolRef.current !== 'select' && !wbRef.current.editor,
    onMoveShouldSetPanResponderCapture: (_, g) => !web && (g.numberActiveTouches > 1 || toolRef.current !== 'select') && !wbRef.current.editor,
    onPanResponderGrant: (event, g) => { nativeTwoPan.current = g.numberActiveTouches > 1; halt(); measureViewport(); if (nativeTwoPan.current) panFrom.current = cam.current.offset; else wbRef.current.begin(toolEvent(event, g)); },
    onPanResponderMove: (event, g) => { if (g.numberActiveTouches > 1 && !nativeTwoPan.current) { wbRef.current.cancel(); nativeTwoPan.current = true; panFrom.current = { x: cam.current.offset.x - g.dx, y: cam.current.offset.y - g.dy }; } if (nativeTwoPan.current) setCam({ scale: cam.current.scale, offset: { x: panFrom.current.x + g.dx, y: panFrom.current.y + g.dy } }); else wbRef.current.move(toolEvent(event, g)); },
    onPanResponderRelease: (event, g) => { if (!nativeTwoPan.current) void wbRef.current.finish(toolEvent(event, g), false); nativeTwoPan.current = false; },
    onPanResponderTerminate: () => { wbRef.current.cancel(); nativeTwoPan.current = false; },
  }), []);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Leaving is delayed a moment so the pointer can cross from a card to its handle, or to the next card, without a flash.
  const hovering = useCallback((id: string, inside: boolean) => { if (busyHands.current || gesture.current || resize.current) return; /* content sliding under a held pointer is not hovering */ if (hoverTimer.current) clearTimeout(hoverTimer.current); if (inside) setHover(id); else hoverTimer.current = setTimeout(() => setHover(old => old === id ? null : old), 90); }, []);
  useEffect(() => () => { if (hoverTimer.current) clearTimeout(hoverTimer.current); }, []);
  function select(id: string, event?: GestureResponderEvent, long = false) {
    event?.stopPropagation();
    const page = event?.nativeEvent as Page | undefined; selectionPointer.current = page?.pageX !== undefined && page.pageY !== undefined ? { x: page.pageX - (vp.current?.x ?? 0), y: page.pageY - (vp.current?.y ?? 0) } : null;
    const ev = event?.nativeEvent as unknown as { shiftKey?: boolean; metaKey?: boolean; ctrlKey?: boolean } | undefined;
    if (long) setMulti(true);
    pressed.current = id; onLink(null);
    if (interactionRef.current && interactionRef.current !== id) setInteractionMode(null);
    const add = long || multi || ev?.shiftKey || ev?.metaKey || ev?.ctrlKey;
    void c.select(add ? c.selection.includes(id) ? c.selection.filter(x => x !== id) : [...c.selection, id] : [id]);
  }
  // ---- Connectors follow whatever is off its place: called directly from the drag, and once per frame while frames glide.
  const shift = useCallback((id: string): FrameShift | undefined => {
    const a = anims.current.get(id); if (!a?.target) return undefined;
    const resized = Math.abs(a.extent.width - a.target.width) > .5 || Math.abs(a.extent.height - a.target.height) > .5;
    return resized || Math.abs(a.off.x) > .05 || Math.abs(a.off.y) > .05 ? { ...a.off, ...(resized ? a.extent : {}) } : undefined;
  }, []);
  function follow(ms: number) {
    followUntil.current = Math.max(followUntil.current, Date.now() + ms); if (followFrame.current !== null) return;
    const step = () => { links.current?.follow(); followFrame.current = Date.now() < followUntil.current ? frame(step) : null; };
    followFrame.current = frame(step);
  }
  // ---- Dragging. Nothing below sets React state per pointer move: offsets, guides, frames and connectors are written directly.
  const toWorld = (page: Point, origin: Point): Point => ({ x: (page.x - origin.x - cam.current.offset.x) / cam.current.scale, y: (page.y - origin.y - cam.current.offset.y) / cam.current.scale });
  const wb = useWhiteboard({ controller: c, layout, world: p => toWorld({ x: p.x, y: p.y }, vp.current ?? { x: 0, y: 0 }), center, scale: () => cam.current.scale, tool: () => toolRef.current, choose: chooseTool, style: () => styleRef.current, locked: () => lockedRef.current, pan: (dx, dy) => { halt(); setCam({ scale: cam.current.scale, offset: { x: cam.current.offset.x + dx, y: cam.current.offset.y + dy } }); } });
  const wbRef = useRef(wb); wbRef.current = wb;
  const cancelAll = () => { wbRef.current.cancel(); dragEnd(0, 0, true); resizeEnd(true); clearLinkGesture(); setInteractionMode(null); };
  const beginInteraction = (id?: string) => { const target = id ?? latest.current.c.selection[0]; if (!target) return; const block = latest.current.doc.blocks.find(b => b.id === target); if (!block) return; const renderer = latest.current.c.catalog?.blockTypes.find(t => t.id === block.typeId)?.renderer; if (isWhiteboardRenderer(renderer)) wbRef.current.edit(target); else if (needsContentInteraction(renderer)) setInteractionMode(target); };
  useImperativeHandle(api, () => ({ fit: () => fit(), zoomToSelection: () => fit(latest.current.c.selection), zoomStep, zoomTo: scale => zoomTo(scale), instant: () => { instantUntil.current = Date.now() + 600; }, setTool: next => { cancelAll(); chooseTool(next); }, getTool: () => toolRef.current, cancelGesture: cancelAll, viewportCenter: center, insertSvg: (svg, options) => {
    if (options?.atPage) { const point = options.atPage, origin = vp.current ?? { x: 0, y: 0 }, size = latest.current.size;
      if (point.x < origin.x || point.y < origin.y || point.x > origin.x + size.width || point.y > origin.y + size.height) return Promise.resolve(false);
    } return wbRef.current.insertSvg(svg, options);
  }, beginInteraction, endInteraction: () => setInteractionMode(null), editSelection: () => beginInteraction(), editLinkLabel: () => { const current = latest.current, link = current.doc.links.find(l => l.id === current.linkId); if (link && !current.c.busy && !current.c.offline) setLinkLabel({ documentId: current.doc.id, linkId: link.id, value: link.label ?? '' }); }, interactionId: () => interactionRef.current }), []);
  useEffect(() => { if (interactionRef.current && !c.selection.includes(interactionRef.current)) setInteractionMode(null); }, [c.selection, doc.id]);
  useEffect(() => { setLinkLabel(null); }, [doc.id, linkId]);
  useEffect(() => { setInteractionMode(null); dragEnd(0,0,true); resizeEnd(true); clearLinkGesture(); }, [doc.id]);
  useEffect(() => {
    if (!web || mode !== 'canvas') return;
    measureViewport();
    const tools = attachToolPointer(viewport.current, { begin: p => { measureViewport(); return wbRef.current.begin(p); }, move: p => wbRef.current.move(p), end: (p, cancelled) => { void wbRef.current.finish(p, cancelled); } });
    const keys = attachCanvasKeys(viewport.current, (key, typing) => {
      if (key === 'Escape') { cancelAll(); chooseTool('select'); return true; }
      if (key === 'Enter' || key === 'F2') { beginInteraction(); return latest.current.c.selection.length === 1; }
      const shortcuts: Record<string, CanvasTool> = { v: 'select', h: 'hand', t: 'text', r: 'shape', d: 'draw', e: 'eraser' };
      if (shortcuts[key.toLowerCase()]) { cancelAll(); chooseTool(shortcuts[key.toLowerCase()]); return true; }
      if (typing && latest.current.c.selection.length === 1) { const b = latest.current.doc.blocks.find(b => b.id === latest.current.c.selection[0]); if (b && ['wb-text','wb-shape'].includes(latest.current.c.catalog?.blockTypes.find(t => t.id === b.typeId)?.renderer ?? '')) { wbRef.current.edit(b.id, key); return true; } }
      return false;
    }, active => { if (active) { spaceTool.current = toolRef.current; chooseTool('hand'); } else if (spaceTool.current) { const old = spaceTool.current; spaceTool.current = null; chooseTool(old); } });
    return () => { tools(); keys(); };
  }, [web, mode, doc.id]);
  const pointer = (event: GestureResponderEvent, g: PanResponderGestureState): Point => { const page = event.nativeEvent as Page; return { x: page.pageX ?? g.moveX, y: page.pageY ?? g.moveY }; };
  function showGuides(guides: Guide[]) {
    const { bound } = latest.current;
    for (const [axis, line] of [['x', guideV], ['y', guideH]] as const) {
      const guide = guides.find(g => g.axis === axis); if (!guide) { line.opacity.setValue(0); continue; }
      line.x.setValue((axis === 'x' ? guide.at : guide.from) - bound.x); line.y.setValue((axis === 'x' ? guide.from : guide.at) - bound.y);
      line.length.setValue(Math.max(1, guide.to - guide.from)); line.thickness.setValue(M.guides.width / cam.current.scale); line.opacity.setValue(1);
    }
  }
  function applyDrag() {
    const g = gesture.current; if (!g) return;
    const { doc, layout } = latest.current, first = g.origin.get(g.id), primary = anims.current.get(g.id)?.target; if (!first || !primary) return;
    const at = toWorld(g.pointer, g.vp), delta = { x: at.x - g.grab.x, y: at.y - g.grab.y };
    // The pointer decides where it lands. Until the viewport has been measured, the card's top edge stands in for it.
    const target = dropTarget(doc, layout, g.ids, g.measured ? at : { x: first.x + delta.x + primary.width / 2, y: first.y + delta.y + 18 }, g.target, M.drag.targetSlack / cam.current.scale);
    if (target !== g.target) {
      g.target = target; const moving = new Set(g.moving);
      g.others = (target ? [...(layout.index.groups.get(target)?.blockIds ?? []), ...(layout.index.groups.get(target)?.groupIds ?? [])] : [...doc.groups, ...doc.blocks].filter(e => !e.parentGroupId).map(e => e.id)).filter(id => !moving.has(id)).map(id => layout.rects.get(id)).filter((r): r is Rect => !!r && !r.hidden);
      setDrag(old => old && { ...old, into: target !== g.home ? target : null });
    }
    const aligned = alignmentGuides({ x: first.x + delta.x, y: first.y + delta.y, width: primary.width, height: primary.height }, g.others, M.guides.threshold / cam.current.scale);
    delta.x += aligned.dx; delta.y += aligned.dy; g.delta = delta; g.aligned = { x: aligned.guides.some(guide => guide.axis === 'x'), y: aligned.guides.some(guide => guide.axis === 'y') }; showGuides(aligned.guides);
    for (const id of g.moving) { const a = anims.current.get(id), from = g.origin.get(id); if (a?.target && from) { a.x.setValue(from.x + delta.x - a.target.x); a.y.setValue(from.y + delta.y - a.target.y); } }
    // The frame it is over, and the frames around that one, make room while the hand is still down.
    const chain = target ? layout.index.chain(target).filter(Boolean) : [], pad = tokens.size.groupPadding;
    for (const id of g.grown) if (!chain.includes(id)) { const a = anims.current.get(id); if (a?.target) { glide(a.w, a.target.width, { ms: M.layout.frameMs }); glide(a.h, a.target.height, { ms: M.layout.frameMs }); } g.grown.delete(id); }
    const boxes = g.tops.map(id => { const a = anims.current.get(id)?.target, from = g.origin.get(id); return a && from ? { x: from.x + delta.x, y: from.y + delta.y, width: a.width, height: a.height } : null; }).filter((b): b is Box => !!b);
    chain.forEach((id, level) => {
      const a = anims.current.get(id), r = a?.target; if (!a || !r) return; const room = pad * (level + 1);
      const width = Math.max(r.width, ...boxes.map(b => b.x + b.width + room - r.x)), height = Math.max(r.height, ...boxes.map(b => b.y + b.height + room - r.y));
      if (width > r.width || height > r.height || g.grown.has(id)) { a.w.stopAnimation(); a.h.stopAnimation(); a.w.setValue(width); a.h.setValue(height); g.grown.add(id); }
    });
    links.current?.follow();
  }
  function dragStart(id: string, event: GestureResponderEvent, gs: PanResponderGestureState) {
    const { c, doc, layout } = latest.current;
    if (c.busy || c.offline || gesture.current || resize.current || linkGesture.current) return;
    const page = pointer(event, gs), ids = c.selection.includes(id) ? c.selection : [id];
    if (!c.selection.includes(id)) void c.select([id]);
    // A drawing anchored to a card that is also moving rides on that card's motion instead of its own.
    const all = new Set(travellers(doc, ids)), moving = [...all].filter(m => anims.current.get(m)?.target && !all.has(anchorCard(doc, doc.blocks.find(b => b.id === m), c.catalog)?.id ?? '')), home = layout.index.parent.get(id) || null, origin = vp.current ?? { x: 0, y: 0 };
    halt(); measureViewport();
    // Picked up from wherever it is drawn right now, so a card can be caught again while it is still settling.
    const epoch = ++gestureEpoch.current;
    gesture.current = { documentId: doc.id, epoch, id, ids, tops: topSelection(doc, ids).map(e => e.id), moving, origin: new Map(moving.map(m => { const a = anims.current.get(m)!; a.epoch = epoch; a.x.stopAnimation(); a.y.stopAnimation(); return [m, { x: a.target!.x + a.off.x, y: a.target!.y + a.off.y }]; })), grab: toWorld(page, origin), pointer: page, vp: origin, measured: !!vp.current, home, target: undefined as unknown as string | null, delta: { x: 0, y: 0 }, aligned: { x: false, y: false }, others: [], grown: new Set() };
    for (const m of moving) { const a = anims.current.get(m)!; glide(a.lift, 1, { ms: M.drag.liftMs, native: a.native }); }
    if (raise.current) clearTimeout(raise.current);
    setDrag({ ids: new Set(moving), into: null, live: true }); applyDrag();
    let last = Date.now();
    const step = () => {
      const g = gesture.current; if (!g) { autoPan.current = null; return; }
      const now = Date.now(), dt = Math.min(48, now - last); last = now;
      if (g.measured) { const v = edgePan({ x: g.pointer.x - g.vp.x, y: g.pointer.y - g.vp.y }, latest.current.size); if (v.x || v.y) setCam({ scale: cam.current.scale, offset: { x: cam.current.offset.x + v.x * dt / 1000, y: cam.current.offset.y + v.y * dt / 1000 } }); }
      autoPan.current = frame(step);
    };
    if (autoPan.current === null) autoPan.current = frame(step);
  }
  function dragMove(event: GestureResponderEvent, gs: PanResponderGestureState) { const g = gesture.current; if (!g) return; if (g.documentId !== latest.current.doc.id || latest.current.c.offline || latest.current.c.busy) { dragEnd(0, 0, true); return; } g.pointer = pointer(event, gs); applyDrag(); }
  function dragEnd(vx: number, vy: number, cancelled: boolean) {
    const g = gesture.current; if (!g) return; gesture.current = null; if (!cancelled) swallowClick();
    if (autoPan.current !== null) { cancelAnimationFrame(autoPan.current); autoPan.current = null; }
    glide(guideV.opacity, 0, { ms: M.guides.fadeMs, native: NATIVE }); glide(guideH.opacity, 0, { ms: M.guides.fadeMs, native: NATIVE });
    const { doc, rects, c } = latest.current, first = g.origin.get(g.id), rect = rects.get(g.id), frameOf = g.target ? rects.get(g.target) : null;
    let delta = g.delta, operations: ReturnType<typeof moveOperations> = [];
    if (first && rect && !cancelled && !c.offline && !c.busy && doc.id === g.documentId) {
      // Lands on the 8 px grid of its container, except along an axis where it is held by a guide.
      const local = { x: first.x + delta.x - (frameOf?.x ?? 0), y: first.y + delta.y - (frameOf?.y ?? 0) }, final = { x: g.aligned.x ? Math.round(local.x) : snap(local.x), y: g.aligned.y ? Math.round(local.y) : snap(local.y) };
      delta = { x: delta.x + final.x - local.x, y: delta.y + final.y - local.y };
      const fromRect = { x: first.x + delta.x - rect.x, y: first.y + delta.y - rect.y };
      if (Math.abs(fromRect.x) + Math.abs(fromRect.y) >= 1 || g.target !== g.home) operations = moveOperations(doc, rects, g.ids, fromRect, g.target === g.home ? undefined : g.target, { catalog: c.catalog, grid: false });
    }
    // Let go: a spring takes it from the hand to its place with the speed it had, and it comes back down.
    const scale = cam.current.scale, velocity = { x: vx * 1000 / scale, y: vy * 1000 / scale };
    for (const id of g.moving) {
      const a = anims.current.get(id), from = g.origin.get(id); if (!a?.target || !from) continue;
      const to = operations.length ? { x: from.x + delta.x - a.target.x, y: from.y + delta.y - a.target.y } : { x: 0, y: 0 };
      settle(a.x, to.x, { velocity: velocity.x, native: a.native }); settle(a.y, to.y, { velocity: velocity.y, native: a.native }); glide(a.lift, 0, { ms: M.drag.dropMs, native: a.native });
      if (operations.length) dropped.current.set(id, g.epoch);
    }
    for (const id of g.grown) { const a = anims.current.get(id); if (a?.target) { glide(a.w, a.target.width, { ms: M.layout.frameMs }); glide(a.h, a.target.height, { ms: M.layout.frameMs }); } }
    follow(700); setDrag(old => old && { ...old, into: null, live: false });
    raise.current = setTimeout(() => { raise.current = null; if (!gesture.current) setDrag(null); }, M.slow + 60);
    if (!operations.length) return;
    const entity = layoutEntity(g.id), into = g.target !== g.home ? g.target ? ` a «${layoutEntity(g.target)?.title || g.target}»` : ' al lienzo' : '';
    void c.edit(operations, (g.tops.length > 1 ? `Mover ${g.tops.length} elementos` : `Mover «${entity?.title || g.id}»`) + into).then(next => {
      for (const id of g.moving) if (dropped.current.get(id) === g.epoch) dropped.current.delete(id);
      // Not saved: nothing moved in the document, so the frames go back to where the document says they are.
      if (!next) { for (const id of g.moving) { const a = anims.current.get(id); if (a?.epoch === g.epoch && !gesture.current?.origin.has(id)) { settle(a.x, 0, { native: a.native }); settle(a.y, 0, { native: a.native }); } } follow(700); }
    });
  }
  const layoutEntity = (id: string) => latest.current.layout.index.entities.get(id);
  const fns = useRef({ dragStart, dragMove, dragEnd, select }); fns.current = { dragStart, dragMove, dragEnd, select };
  const held = useRef<{ id: string; event: GestureResponderEvent; state: PanResponderGestureState; long: boolean } | null>(null), holdTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearHold = () => { if (holdTimer.current) clearTimeout(holdTimer.current); holdTimer.current = null; held.current = null; };
  useEffect(() => () => clearHold(), []);
  const canDrag = !u.compact && !c.offline, canDragRef = useRef(canDrag); canDragRef.current = canDrag;
  useEffect(() => {
    if (!web || mode !== 'canvas') return;
    const event = (p: CanvasPointer) => ({ nativeEvent: { pageX: p.x, pageY: p.y, shiftKey: p.shift }, stopPropagation() {} }) as unknown as GestureResponderEvent;
    const state = { moveX: 0, moveY: 0, dx: 0, dy: 0 } as PanResponderGestureState;
    return attachEntityDrag(viewport.current, {
      enabled: () => canDragRef.current && !latest.current.c.busy && toolRef.current === 'select' && !gesture.current && !resize.current && !linkGesture.current,
      start: (id, p) => fns.current.dragStart(id, event(p), state), move: p => fns.current.dragMove(event(p), state),
      end: (cancelled, v) => fns.current.dragEnd(v.vx, v.vy, cancelled),
      edit: id => beginInteraction(id),
      // The whole card selects, not only its title: text and padding count too. Areas keep selecting from their header.
      press: (id, p) => { if (latest.current.doc.blocks.some(b => b.id === id) && !latest.current.c.selection.includes(id)) fns.current.select(id, { nativeEvent: { pageX: p.x, pageY: p.y, shiftKey: p.shift, metaKey: p.command }, stopPropagation() {} } as unknown as GestureResponderEvent); },
    });
  }, [web, mode, doc.id]);
  // One responder per frame for its whole life. It sits on a wrapper around the card, never on a Pressable: a Pressable
  // owns its own responder handlers and would swallow these.
  const responders = useRef(new Map<string, GestureResponderHandlers>());
  const dragHandlers = (id: string) => {
    if (web) return noHandlers;
    let handlers = responders.current.get(id); if (handlers) return handlers;
    handlers = PanResponder.create({
      onStartShouldSetPanResponderCapture: event => canDragRef.current && !textGesture.current && !gesture.current && !resize.current && !linkGesture.current && isDragHandle((event.nativeEvent as Page).target),
      onMoveShouldSetPanResponderCapture: (_, g) => canDragRef.current && !textGesture.current && !gesture.current && !resize.current && !linkGesture.current && Math.abs(g.dx) + Math.abs(g.dy) > M.drag.threshold,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (event, g) => {
        if (Math.abs(g.dx) + Math.abs(g.dy) > M.drag.threshold) { fns.current.dragStart(id, event, g); return; }
        event.persist(); held.current = { id, event, state: { ...g }, long: false };
        holdTimer.current = setTimeout(() => { const h = held.current; if (h?.id === id) { h.long = true; fns.current.select(id, h.event, true); } }, 500);
      },
      onPanResponderMove: (event, g) => {
        const h = held.current;
        if (h && Math.abs(g.dx) + Math.abs(g.dy) > M.drag.threshold) { clearHold(); fns.current.dragStart(id, h.event, h.state); }
        fns.current.dragMove(event, g);
      },
      onPanResponderRelease: (event, g) => { const h = held.current; clearHold(); if (h) { swallowClick(); if (!h.long) fns.current.select(id, event); } else fns.current.dragEnd(g.vx, g.vy, false); },
      onPanResponderTerminate: () => { clearHold(); fns.current.dragEnd(0, 0, true); },
    }).panHandlers;
    responders.current.set(id, handlers); return handlers;
  };
  // ---- Resize only the held card and its ancestor frames. Layout runs after the transaction succeeds.
  function resizeStart(id: string, event: GestureResponderEvent, g: PanResponderGestureState, handle: ResizeHandle = 'se') {
    const { c, doc, rects, layout } = latest.current, r = rects.get(id);
    if (!r || c.busy || c.offline || gesture.current || linkGesture.current || resize.current) return;
    halt(); measureViewport();
    const a = animOf(id, NATIVE); a.w.stopAnimation(); a.h.stopAnimation(); a.lift.stopAnimation(); a.lift.setValue(0);
    const start = { ...r, width: a.extent.width || r.width, height: a.extent.height || r.height };
    resize.current = { id, documentId: doc.id, start, pointer: pointer(event, g), next: { width: start.width, height: start.height }, proportional: false, held: true, handle, nextPosition: { x: start.x, y: start.y }, parents: layout.index.chain(id).slice(1).filter(Boolean) };
    busyHands.current = true; setResizeId(id); a.w.setValue(start.width); a.h.setValue(start.height);
  }
  function resizeMove(event: GestureResponderEvent, g: PanResponderGestureState) {
    const state = resize.current; if (!state?.held) return;
    const { c, doc, rects, layout } = latest.current, block = doc.blocks.find(b => b.id === state.id); if (!block || doc.id !== state.documentId || c.offline || c.busy) { resizeEnd(true); return; }
    const page = pointer(event, g), delta = { x: (page.x - state.pointer.x) / cam.current.scale, y: (page.y - state.pointer.y) / cam.current.scale };
    state.proportional = !!(event.nativeEvent as unknown as { shiftKey?: boolean }).shiftKey;
    const kind = c.catalog?.blockTypes.find(t => t.id === block.typeId)?.renderer;
    if (isWhiteboardRenderer(kind)) {
      if (kind === 'wb-shape' && block.data.shape === 'line' && (state.handle === 'start' || state.handle === 'end')) { const box = resizeLineBox(state.start, block.data as unknown as Parameters<typeof resizeLineBox>[1], delta, state.handle, state.proportional); state.next = box.size; state.nextPosition = box.position; state.from = box.from; }
      else { const box = resizeWhiteboardBox(state.start, delta, state.handle, whiteboardMinSize(kind, block.data), kind === 'wb-svg' || state.proportional && kind !== 'wb-text'); state.next = { width: box.width, height: kind === 'wb-text' ? state.start.height : box.height }; state.nextPosition = { x: box.x, y: kind === 'wb-text' ? state.start.y : box.y }; }
      const a = animOf(state.id, NATIVE); a.x.setValue(state.nextPosition.x - state.start.x); a.y.setValue(state.nextPosition.y - state.start.y);
    } else state.next = resizeBlockSize(state.start, delta, minimumBlockSize(block, c.catalog), state.proportional);
    const a = animOf(state.id, NATIVE); a.w.setValue(state.next.width); a.h.setValue(state.next.height);
    for (const id of state.parents) {
      const group = layout.index.groups.get(id), r = rects.get(id); if (!group || !r) continue;
      const pad = r.depth ? tokens.size.groupPaddingNested : tokens.size.groupPadding;
      const children = [...group.blockIds, ...group.groupIds].map(child => ({ r: rects.get(child), a: anims.current.get(child) }));
      const width = Math.ceil(Math.max(tokens.size.groupMinWidth, ...children.map(({ r: child, a: anim }) => child ? child.x - r.x + (anim?.extent.width || child.width) + pad : 0)) / 8) * 8;
      const height = Math.ceil(Math.max(tokens.size.groupHeader, ...children.map(({ r: child, a: anim }) => child ? child.y - r.y + (anim?.extent.height || child.height) + pad : 0)) / 8) * 8;
      const parent = animOf(id, false); parent.w.setValue(width); parent.h.setValue(height);
    }
    links.current?.follow();
  }
  function resizeEnd(cancelled: boolean) {
    const state = resize.current; if (!state?.held) return;
    state.held = false; busyHands.current = false; swallowClick();
    const { c, doc } = latest.current, block = doc.blocks.find(b => b.id === state.id), a = animOf(state.id, NATIVE);
    const changed = Math.abs(state.next.width - state.start.width) + Math.abs(state.next.height - state.start.height) + Math.abs(state.nextPosition.x - state.start.x) + Math.abs(state.nextPosition.y - state.start.y) >= 1 || !!state.from && state.from !== block?.data.from;
    const finish = (saved?: CanvasDocument) => {
      if (resize.current !== state) return;
      const settled = saved ? layoutCanvas(saved, heights, c.catalog, latest.current.size.width || undefined).rects : latest.current.rects;
      resize.current = null; setResizeId(null);
      const r = settled.get(state.id); if (r) { settle(a.w, r.width); settle(a.h, r.height); settle(a.x, 0, { native: a.native }); settle(a.y, 0, { native: a.native }); }
      for (const id of state.parents) { const parent = anims.current.get(id), r = settled.get(id); if (parent && r) { glide(parent.w, r.width, { ms: M.layout.frameMs }); glide(parent.h, r.height, { ms: M.layout.frameMs }); } }
      follow(700);
    };
    if (cancelled || !changed || !block || doc.id !== state.documentId || c.offline || c.busy) { finish(); return; }
    const kind = c.catalog?.blockTypes.find(t => t.id === block.typeId)?.renderer;
    if (isWhiteboardRenderer(kind)) {
      const card = anchorCard(doc, block, c.catalog), parent = card ? latest.current.rects.get(card.id) : block.parentGroupId ? latest.current.rects.get(block.parentGroupId) : null;
      const position = { x: state.nextPosition.x - (parent?.x ?? 0), y: state.nextPosition.y - (parent?.y ?? 0) };
      const patch: Partial<Omit<CanvasBlock, 'id'>> = kind === 'wb-text' ? { position, data: { width: state.next.width } } : { position, size: state.next, ...(state.from ? { data: { from: state.from } } : {}) };
      void c.edit([{ type: 'block.update', id: state.id, patch }], kind === 'wb-text' ? 'Redimensionar texto' : 'Redimensionar forma').then(next => finish(next?.document)); return;
    }
    const final = resizeBlockSize(state.next, { x: 0, y: 0 }, minimumBlockSize(block, c.catalog), state.proportional, true);
    settle(a.w, final.width); settle(a.h, final.height);
    void c.edit([{ type: 'block.update', id: state.id, patch: { size: final } }], `Redimensionar «${block.title}»`).then(next => finish(next?.document));
  }
  const resizeFns = useRef({ resizeStart, resizeMove, resizeEnd }); resizeFns.current = { resizeStart, resizeMove, resizeEnd };
  const resizeResponders = useRef(new Map<string, GestureResponderHandlers>());
  const resizeHandlers = (id: string, handle: ResizeHandle = 'se') => {
    const key = `${id}:${handle}`; const cached = resizeResponders.current.get(key); if (cached) return cached;
    const handlers = PanResponder.create({ onStartShouldSetPanResponderCapture: () => true, onStartShouldSetPanResponder: () => true, onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (e, g) => resizeFns.current.resizeStart(id, e, g, handle), onPanResponderMove: (e, g) => resizeFns.current.resizeMove(e, g),
      onPanResponderRelease: () => resizeFns.current.resizeEnd(false), onPanResponderTerminate: () => resizeFns.current.resizeEnd(true),
    }).panHandlers;
    resizeResponders.current.set(key, handlers); return handlers;
  };
  // ---- Layout changes glide. Each frame stays where it was drawn and its offset runs out; new frames come in from
  // where they belong (the node they hang from, or their group's header).
  useLayoutEffect(() => {
    const animate = placed.current && !reducedMotion.current && Date.now() > instantUntil.current, before = new Set([...anims.current].filter(([, a]) => a.target).map(([id]) => id));
    let moved = false, sprung = false;
    for (const [id, r] of rects) {
      const block = !index.groups.has(id), a = animOf(id, block && NATIVE), old = a.target;
      if (r.hidden) { a.target = null; continue; }
      a.target = { x: r.x, y: r.y, width: r.width, height: r.height };
      if (!old) {
        a.x.stopAnimation(); a.y.stopAnimation(); a.x.setValue(0); a.y.setValue(0); a.w.setValue(r.width); a.h.setValue(r.height); a.enter.setValue(1);
        if (!animate) continue;
        const link = doc.links.find(l => l.to === id && before.has(l.from) || l.from === id && before.has(l.to)), source = link ? rects.get(link.to === id ? link.from : link.to) : undefined, parent = index.parent.get(id);
        let from: Point | null = parent && before.has(parent) ? { x: 0, y: -M.enter.offset } : null;
        if (source) { const dx = source.x + source.width / 2 - r.x - r.width / 2, dy = source.y + source.height / 2 - r.y - r.height / 2, length = Math.hypot(dx, dy) || 1; from = { x: dx / length * M.enter.offset, y: dy / length * M.enter.offset }; }
        if (from) { a.x.setValue(from.x); a.y.setValue(from.y); glide(a.x, 0, { ms: M.enter.ms, native: a.native }); glide(a.y, 0, { ms: M.enter.ms, native: a.native }); }
        a.enter.setValue(0); glide(a.enter, 1, { ms: M.enter.ms, native: a.native }); moved = true; continue;
      }
      const dx = old.x - r.x, dy = old.y - r.y;
      if ((dx || dy) && !gesture.current?.origin.has(id)) {
        a.x.stopAnimation(); a.y.stopAnimation();
        if (!animate) { a.x.setValue(0); a.y.setValue(0); }
        else {
          a.x.setValue(a.off.x + dx); a.y.setValue(a.off.y + dy); moved = true;
          // What was just dropped keeps its spring; everything the layout moved in response eases.
          if (dropped.current.has(id)) { settle(a.x, 0, { native: a.native }); settle(a.y, 0, { native: a.native }); sprung = true; } else { glide(a.x, 0, { native: a.native }); glide(a.y, 0, { native: a.native }); }
        }
      }
      if (!gesture.current?.grown.has(id) && resize.current?.id !== id && !resize.current?.parents.includes(id)) {
        if (Math.abs(a.extent.width - r.width) > .5) { if (animate) { glide(a.w, r.width, { ms: M.layout.frameMs }); moved = true; } else { a.w.stopAnimation(); a.w.setValue(r.width); } }
        if (Math.abs(a.extent.height - r.height) > .5) { if (animate && (!block || doc.blocks.find(b => b.id === id)?.size)) { glide(a.h, r.height, { ms: M.layout.frameMs }); moved = true; } else { a.h.stopAnimation(); a.h.setValue(r.height); } }
      }
    }
    for (const [id, a] of anims.current) if (!rects.has(id)) { a.x.removeAllListeners(); a.y.removeAllListeners(); a.w.removeAllListeners(); a.h.removeAllListeners(); anims.current.delete(id); responders.current.delete(id); resizeResponders.current.delete(id); }
    if (gesture.current) applyDrag();
    if (moved) follow(sprung ? 700 : M.layout.ms + 80); else links.current?.follow();
    if (ready) placed.current = true;
  }, [layout, resizeId]);
  const title = (id: string) => index.entities.get(id)?.title || id;
  function connect(from: string, to: string) {
    const { existing, operations, id } = connectOperations(latest.current.doc, from, to);
    if (existing) { onLink(existing.id); void c.select([]); return; }
    if (operations.length) void c.edit(operations, `Conectar «${title(from)}» → «${title(to)}»`).then(next => { if (next && id) { onLink(id); void c.select([]); } });
  }
  // A link follows the pointer directly. Only a changed destination enters React; its endpoint springs to the port.
  function clearLinkGesture() {
    const active = !!linkGesture.current; linkGesture.current = null; busyHands.current = false; draftLive.current = null;
    draftX.stopAnimation(); draftY.stopAnimation(); links.current?.preview(null); setLinkDraft(null); if (active) swallowClick();
  }
  function linkHandle(id: string, origin: Point) {
    return PanResponder.create({ onStartShouldSetPanResponder: () => true, onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: (event, g) => {
        const { c, layout } = latest.current; if (c.busy || c.offline || resize.current || gesture.current) return;
        halt(); measureViewport(); busyHands.current = true;
        const page = pointer(event, g), viewport = vp.current ?? { x: page.x - origin.x * cam.current.scale - cam.current.offset.x, y: page.y - origin.y * cam.current.scale - cam.current.offset.y };
        const side = layout.index.direction(layout.index.parent.get(id) || null) === 'right' ? 'right' : 'bottom';
        linkGesture.current = { documentId: latest.current.doc.id, from: id, origin, side, grab: toWorld(page, viewport), viewport, target: null };
        draftX.setValue(origin.x); draftY.setValue(origin.y); draftTo.current = { ...origin };
        draftLive.current = { from: origin, to: origin, side, valid: false };
        setLinkDraft({ from: id, to: origin, target: null }); links.current?.preview(draftLive.current);
      },
      onPanResponderMove: (event, g) => {
        const state = linkGesture.current; if (!state) return;
        if (state.documentId !== latest.current.doc.id || latest.current.c.offline || latest.current.c.busy) { clearLinkGesture(); return; }
        const at = toWorld(pointer(event, g), state.viewport), to = { x: state.origin.x + at.x - state.grab.x, y: state.origin.y + at.y - state.grab.y };
        const target = linkMagnet(latest.current.layout, state.from, to, cam.current.scale, state.target, shift);
        const changed = state.target?.id !== target?.id || state.target?.side !== target?.side;
        state.target = target;
        if (draftLive.current) { draftLive.current.valid = !!target; draftLive.current.endSide = target?.side; }
        if (changed) {
          setLinkDraft({ from: state.from, to: target?.point ?? to, target: target?.id ?? null });
          if (target) {
            settle(draftX, target.point.x, { velocity: g.vx * 1000 / cam.current.scale }); settle(draftY, target.point.y, { velocity: g.vy * 1000 / cam.current.scale });
            if (Date.now() - lastSpark.current >= M.magnet.cooldownMs) { lastSpark.current = Date.now(); setSparkPulse(v => v + 1); }
          }
        }
        if (!target) { draftX.stopAnimation(); draftY.stopAnimation(); draftX.setValue(to.x); draftY.setValue(to.y); }
        links.current?.preview(draftLive.current);
      },
      onPanResponderRelease: () => { const state = linkGesture.current; clearLinkGesture(); if (state?.target && state.documentId === latest.current.doc.id && !latest.current.c.offline && !latest.current.c.busy) connect(state.from, state.target.id); },
      onPanResponderTerminate: clearLinkGesture,
    }).panHandlers;
  }
  const measure = useCallback((id: string, height: number) => {
    if (resize.current?.id === id || latest.current.doc.blocks.find(b => b.id === id)?.size) return;
    setHeights(old => Math.abs((old[id] ?? 0) - height) < 1 ? old : { ...old, [id]: height });
  }, []);
  // Cards are memoised, so what they call must keep its identity while always reaching the current closure.
  const calls = useRef({ select, onInspect, onPacks, reorder }); calls.current = { select, onInspect, onPacks, reorder };
  const stable = useMemo(() => ({ onSelect: (id: string, event?: GestureResponderEvent, long?: boolean) => calls.current.select(id, event, long), onInspect: () => calls.current.onInspect(), onPacks: () => calls.current.onPacks(), onReorder: (id: string, d: number) => calls.current.reorder(id, d) }), []);
  const blockProps = { controller: c, onSelect: select, onInspect, onPacks, onReorder: reorder };
  const routes = useMemo(() => mode === 'canvas' ? linkRoutes(doc, layout) : [], [doc, layout, mode]);
  // Focus, strongest first: a link under the pointer, a linked card under the pointer, the selected link, the selection.
  const focus = useMemo(() => {
    if (linkDraft || drag?.live) return null;
    const hovered = routes.find(r => r.key === linkHover);
    return hovered ? { lit: new Set([hovered.from, hovered.to, ...hovered.links.flatMap(l => [l.from, l.to])]), routes: new Set([hovered.key]), links: new Set(hovered.links.map(l => l.id)) } : (hover ? linkFocus(routes, [hover]) : null) ?? (linkId ? linkFocus(routes, [], linkId) : linkFocus(routes, c.selection));
  }, [routes, hover, linkHover, linkId, c.selection, linkDraft, drag?.live]);
  const lit = (id: string) => !focus || index.chain(id).some(x => focus.lit.has(x));
  const region = (g: CanvasGroup) => index.mode(g.id) === 'graph' || index.mode(g.parentGroupId ?? null) === 'graph';
  const pressLink = (key: string) => { const route = routes.find(r => r.key === key); if (!route) return; const at = route.links.findIndex(l => l.id === linkId); onLink(route.links[(at + 1) % route.links.length].id); void c.select([]); };
  const excludedLink = (id: string) => { const b = doc.blocks.find(b => b.id === id), kind = b && c.catalog?.blockTypes.find(t => t.id === b.typeId)?.renderer; return kind === 'wb-draw' || kind === 'wb-shape' && b?.data.shape === 'line'; };
  const handleFor = linkDraft?.from ?? (toolRef.current !== 'select' || u.compact || c.offline || c.busy || drag || resizeId ? null : hover && !excludedLink(hover) && doc.blocks.some(b => b.id === hover) ? hover : c.selection.length === 1 && !excludedLink(c.selection[0]) ? c.selection[0] : null);
  const handleRect = handleFor ? rects.get(handleFor) : undefined, handleSide = handleFor && index.direction(index.parent.get(handleFor) || null) === 'right' ? 'right' as const : 'bottom' as const;
  const handlePoint = handleRect && !handleRect.hidden ? handleSide === 'right' ? { x: handleRect.x + handleRect.width, y: handleRect.y + handleRect.height / 2 } : { x: handleRect.x + handleRect.width / 2, y: handleRect.y + handleRect.height } : null;
  // The pin: shown on the frame in focus when it holds a place of its own inside an automatic layout. Pressing it lets go.
  const pinFor = !linkDraft && handleFor && !isWhiteboardRenderer(c.catalog?.blockTypes.find(t => t.id === doc.blocks.find(b => b.id === handleFor)?.typeId)?.renderer) && handleRect && !handleRect.hidden && index.entities.get(handleFor)?.position && !manual(index.mode(index.parent.get(handleFor) || null)) ? handleFor : null;
  const worldX = useMemo(() => Animated.add(camX, Animated.multiply(camS, bound.x)), [bound.x]), worldY = useMemo(() => Animated.add(camY, Animated.multiply(camS, bound.y)), [bound.y]);
  const shadow = `${M.drag.shadow} ${withAlpha(isDark(u.c.surface0) ? u.c.surface0 : u.c.foreground, M.drag.shadowAlpha)}`, cursor = (lifted: boolean) => web && canDrag ? lifted ? 'grabbing' : 'grab' : undefined;
  function groupHeader(group: CanvasGroup, ordinal: number, outline = false, targeted = false, dashed = false) {
    const count = group.blockIds.length + group.groupIds.length, selected = c.selection.includes(group.id), template = c.catalog?.templates.find(t => t.id === group.templateId);
    return <View {...(!outline && canDrag ? dragHandlers(group.id) : {})} style={{ ...noSelect, flexDirection: 'row', height: outline ? 36 : group.parentGroupId ? tokens.size.groupHeaderNested : tokens.size.groupHeader, alignItems: 'center', paddingLeft: 8, paddingRight: 10, gap: 6, borderBottomWidth: !outline && !group.collapsed && !dashed ? 1 : 0, borderColor: targeted ? withAlpha(u.c.accent, tokens.alpha.toneBorder) : u.c.border }}>
      <Pressable accessibilityRole="button" accessibilityLabel={group.collapsed ? 'Expandir grupo' : 'Contraer grupo'} accessibilityState={{ disabled: c.offline || c.busy, expanded: !group.collapsed }} disabled={c.offline || c.busy} hitSlop={12} onPress={event => { event.stopPropagation(); void c.edit([{ type: 'group.update', id: group.id, patch: { collapsed: !group.collapsed } }], group.collapsed ? 'Expandir grupo' : 'Contraer grupo'); }} style={({ pressed, ...state }) => ({ width: 24, height: 24, alignItems: 'center', justifyContent: 'center', borderRadius: 4, backgroundColor: pressed ? withAlpha(u.c.foreground, tokens.alpha.pressedFill) : (state as { hovered?: boolean }).hovered ? withAlpha(u.c.foreground, tokens.alpha.hoverFill) : 'transparent', opacity: c.offline || c.busy ? .45 : 1 })}><Icon name={group.collapsed ? 'ChevronRight' : 'ChevronDown'} size={14} color={u.c.foregroundMuted} /></Pressable>
      <Pressable nativeID={`lienzo-grab-${group.id}-title`} accessibilityRole="button" accessibilityLabel={`Grupo: ${group.title}`} onPress={e => select(group.id, e)} onLongPress={e => select(group.id, e, true)} style={{ flex: 1, minWidth: 0, alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', gap: 8, ...(!outline ? { cursor: cursor(!!drag?.ids.has(group.id)) } as object : {}) }}>{!dashed && <Txt kind="label" muted>{String(ordinal + 1).padStart(2, '0')}</Txt>}<Txt kind="groupTitle" numberOfLines={1} style={{ flexShrink: 1, minWidth: 0 }}>{group.title}</Txt></Pressable>
      {targeted ? <Txt kind="label" style={{ color: u.c.accent }}>Soltar aquí</Txt> : <>{template && !u.compact && <Chip label={template.name} center style={{ maxWidth: 112 }} />}{hasCommunication(group.communication) && <Icon name="Compass" size={12} color={u.c.accent} />}<View accessibilityLabel={count === 1 ? '1 elemento' : `${count} elementos`} style={{ minWidth: 20, height: 18, paddingHorizontal: 5, borderRadius: 9, borderWidth: 1, borderColor: u.c.border, alignItems: 'center', justifyContent: 'center' }}><Txt kind="label" muted style={{ letterSpacing: 0 }}>{count}</Txt></View></>}{selected && !targeted && <Pressable accessibilityRole="button" accessibilityLabel="Inspeccionar grupo" hitSlop={12} onPress={event => { event.stopPropagation(); onInspect(); }} style={{ width: 20, height: 20, alignItems: 'center', justifyContent: 'center' }}><Icon name="PanelRight" size={14} color={u.c.foregroundMuted} /></Pressable>}
    </View>;
  }
  function outlineGroup(group: CanvasGroup, i: number): React.ReactNode {
    return <View key={group.id} style={{ gap: 8, marginLeft: group.parentGroupId ? 12 : 0, borderLeftWidth: group.parentGroupId ? 2 : 0, borderColor: u.c.border }}><View style={{ backgroundColor: c.selection.includes(group.id) ? u.halo : u.groupFill('neutro'), borderRadius: 10 }}>{groupHeader(group, i, true)}</View>{!group.collapsed && <>{group.description && <Txt kind="small" muted>{group.description}</Txt>}<ConnectionRows doc={doc} id={group.id} onOpen={id => select(id)} />{group.blockIds.map(id => { const b = doc.blocks.find(b => b.id === id); return b && <BlockCard key={id} {...blockProps} block={b} outline selected={c.selection.includes(id)} />; })}{group.groupIds.map((id, j) => { const g = doc.groups.find(g => g.id === id); return g && outlineGroup(g, j); })}{!group.blockIds.length && !group.groupIds.length && <Txt kind="small" muted>Grupo vacío. Añade un bloque desde el catálogo.</Txt>}</>}</View>;
  }
  if (mode === 'outline') return <ScrollView contentContainerStyle={{ padding: u.compact ? 12 : 16, gap: 16 }}><View style={{ width: '100%', maxWidth: 720, alignSelf: 'center', gap: 16 }}><View style={{ gap: 8 }}><Txt kind="display">{doc.title}</Txt>{doc.example && <Chip label="Ejemplo" tone="aviso" icon="FlaskConical" />}<Txt kind="small" muted>{doc.description}</Txt></View>{doc.groups.filter(g => !g.parentGroupId).map(outlineGroup)}{doc.blocks.some(b => !b.parentGroupId) && <Txt kind="label" muted>Sueltos</Txt>}{doc.blocks.filter(b => !b.parentGroupId).map(b => <BlockCard key={b.id} {...blockProps} block={b} outline selected={c.selection.includes(b.id)} />)}</View></ScrollView>;
  const wbKind = (b: CanvasBlock) => c.catalog?.blockTypes.find(t => t.id === b.typeId)?.renderer;
  function whiteboardItems(kinds: WbRenderer[]) {
    return doc.blocks.filter(b => !rects.get(b.id)?.hidden && kinds.includes(wbKind(b) as WbRenderer)).map(b => {
      const r = rects.get(b.id)!, a = animOf(b.id, NATIVE), kind = wbKind(b) as WbRenderer, card = kind === 'wb-draw' ? anchorCard(doc, b, c.catalog) : undefined, ride = card ? animOf(card.id, NATIVE) : null, selected = c.selection.includes(b.id), lifted = !!drag?.ids.has(b.id), line = kind === 'wb-shape' && b.data.shape === 'line';
      const handles: ResizeHandle[] = kind === 'wb-text' ? ['w','e'] : line ? ['start','end'] : ['nw','n','ne','e','se','s','sw','w'];
      const ends = line ? lineEnds(b.data as unknown as Parameters<typeof lineEnds>[0], r.width, r.height) : null;
      const hpos = (handle: ResizeHandle) => ends && (handle === 'start' || handle === 'end') ? { x: ends[handle === 'start' ? 0 : 1].x / r.width, y: ends[handle === 'start' ? 0 : 1].y / r.height } : { x: handle.includes('w') ? 0 : handle.includes('e') ? 1 : .5, y: handle.includes('n') ? 0 : handle.includes('s') ? 1 : .5 };
      return <Animated.View key={b.id} nativeID={`lienzo-entity-${b.id}`} pointerEvents="box-none" {...(!web && canDrag ? dragHandlers(b.id) : {})} style={{ position: 'absolute', left: r.x - bound.x, top: r.y - bound.y, width: a.target ? a.w : r.width, height: kind === 'wb-text' && resizeId !== b.id ? r.height : a.target ? a.h : r.height, zIndex: kind === 'wb-text' ? 4 : kind === 'wb-draw' ? 5 : 0, opacity: lifted ? .85 : 1, transform: [{ translateX: a.x }, { translateY: a.y }, ...(ride ? [{ translateX: ride.x }, { translateY: ride.y }] : [])] }}>
        <WhiteboardContent block={b} kind={kind} width={r.width} height={r.height} scale={cam.current.scale} editing={wb.editor?.blockId === b.id} onSelect={event => select(b.id,event)} onHover={inside => hovering(b.id,inside)} onMeasure={height => measure(b.id,height)} />
        {(selected || hover === b.id) && <View pointerEvents="none" style={{position:'absolute',inset:-4,borderWidth:selected?1.5:1,borderColor:selected?u.c.accent:withAlpha(u.c.foregroundMuted,.35)}}/>}
        {selected && canDrag && c.selection.length === 1 && cam.current.scale >= .25 && handles.map(handle => { const p = hpos(handle); return <View key={handle} nativeID={`lienzo-interactive-resize-${b.id}-${handle}`} {...resizeHandlers(b.id,handle)} style={{position:'absolute',left:`${p.x*100}%`,top:`${p.y*100}%`,width:20,height:20,marginLeft:-10,marginTop:-10,zIndex:8,alignItems:'center',justifyContent:'center',transform:[{scale:Animated.divide(1,camS)}]}}><View pointerEvents="none" style={{width:line?10:8,height:line?10:8,borderRadius:line?5:2,backgroundColor:u.c.surface1,borderColor:u.c.accent,borderWidth:1.5}}/></View>; })}
      </Animated.View>;
    });
  }
  // Wayfinding: the minimap in the corner, and a beacon for a selection that is out of sight or was chosen from elsewhere.
  const goTo = (world: Point, animate: boolean) => { const from = goal.current ?? cam.current, to = { scale: from.scale, offset: { x: size.width / 2 - world.x * from.scale, y: size.height / 2 - world.y * from.scale } }; if (animate) flyTo(to, C.stepMs); else { halt(); setCam(to); } };
  const subscribeCamera = useCallback((listener: () => void) => { camSubs.current.add(listener); return () => { camSubs.current.delete(listener); }; }, []);
  const selectedBounds = boundsOf(c.selection.map(id => rects.get(id)).filter((r): r is Rect => !!r && !r.hidden));
  const cameraSource = useMemo(() => ({ camera: () => cam.current, subscribe: subscribeCamera }), [subscribeCamera]);
  const mapItems = useMemo(() => [...doc.groups.map(g => ({ id: g.id, group: true })), ...doc.blocks.map(b => ({ id: b.id, group: false }))].flatMap(e => { const r = rects.get(e.id); return r && !r.hidden ? [{ id: e.id, group: e.group, box: r, lit: c.selection.includes(e.id) }] : []; }), [doc.groups, doc.blocks, rects, c.selection]);
  const mapMargin = Math.max(maxX - minX, maxY - minY) * tokens.canvas.minimap.margin, mapContent = { x: minX - mapMargin, y: minY - mapMargin, width: maxX - minX + 2 * mapMargin, height: maxY - minY + 2 * mapMargin };
  const beaconId = c.selection.length === 1 && !drag && !wb.editor ? c.selection[0] : null, beaconBox = beaconId ? rects.get(beaconId) : undefined;
  const wayfinding = mode === 'canvas' && size.width > 0 ? <>
    {beaconId && beaconBox && !beaconBox.hidden && <SelectionBeacon id={beaconId} title={title(beaconId)} box={beaconBox} remote={pressed.current !== beaconId} view={size} source={cameraSource} inset={tokens.canvas.beacon.inset} onGo={() => fit([beaconId])} />}
    {!u.compact && size.width >= tokens.canvas.minimap.minPanelWidth && mapItems.length >= tokens.canvas.minimap.minItems && <Minimap items={mapItems} content={mapContent} view={size} source={cameraSource} onNavigate={goTo} />}
  </> : null;
  const guideLine = (line: typeof guideV, vertical: boolean) => <Animated.View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, width: 1, height: 1, zIndex: 6, backgroundColor: u.c.accent, opacity: line.opacity, transformOrigin: 'top left', transform: [{ translateX: line.x }, { translateY: line.y }, { scaleX: vertical ? line.thickness : line.length }, { scaleY: vertical ? line.length : line.thickness }] }} />;
  return <View ref={viewport} nativeID="lienzo-canvas-viewport" onLayout={e => { setSize(e.nativeEvent.layout); measureViewport(); }} style={{ flex: 1, overflow: 'hidden', backgroundColor: u.c.surface0 }}>
    <View {...(web || toolRef.current === 'select' ? pan.panHandlers : nativeTools.panHandlers)} style={{ position: 'absolute', inset: 0 }}>
    <Pressable accessible={false} focusable={false} onPress={() => { if (toolRef.current !== 'select') return; setInteractionMode(null); setMulti(false); latest.current.onLink(null); void latest.current.c.select([]); }} style={{ position: 'absolute', inset: 0 }} />
    <Animated.View pointerEvents="box-none" style={{ position: 'absolute', left: 0, top: 0, width: bound.width, height: bound.height, opacity: shown, transformOrigin: 'top left', transform: [{ translateX: worldX }, { translateY: worldY }, { scale: camS }] }}>
      {doc.groups.filter(g => !rects.get(g.id)!.hidden).sort((a, b) => rects.get(a.id)!.depth - rects.get(b.id)!.depth).map(g => { const r = rects.get(g.id)!, a = animOf(g.id, false), lifted = !!drag?.ids.has(g.id), selected = c.selection.includes(g.id), targeted = drag?.into === g.id, nested = !!g.parentGroupId, dashed = region(g), radius = nested ? tokens.radius.block : tokens.radius.group, inset = nested ? tokens.size.groupPaddingNested : tokens.size.groupPadding;
        const siblings = g.parentGroupId ? doc.groups.find(parent => parent.id === g.parentGroupId)!.groupIds : doc.groups.filter(group => !group.parentGroupId).map(group => group.id);
        // The frame's size is the one animated layout property on the canvas: a scaled frame would bend its border and radius.
        return <Animated.View key={g.id} nativeID={`lienzo-entity-${g.id}`} {...(!web && canDrag ? dragHandlers(g.id) : {})} style={{ position: 'absolute', left: r.x - bound.x, top: r.y - bound.y, width: a.target ? a.w : r.width, height: a.target ? a.h : r.height, zIndex: lifted ? 2 : 0, opacity: a.enter, transform: [{ translateX: a.x }, { translateY: a.y }, { scale: a.scale }] }}>
        <Animated.View pointerEvents="none" style={{ position: 'absolute', inset: 0, borderRadius: radius, boxShadow: shadow, opacity: a.lift }} />
        <Pressable accessibilityRole="button" accessibilityLabel={`Grupo: ${g.title}`} onPress={e => select(g.id, e)} onHoverIn={() => hovering(g.id, true)} onHoverOut={() => hovering(g.id, false)} style={{ flex: 1, overflow: 'hidden', backgroundColor: linkDraft?.target === g.id ? u.halo : dashed ? withAlpha(u.c.foregroundMuted, G.region.fillAlpha) : u.groupFill('neutro'), borderRadius: radius, borderWidth: selected || targeted || linkDraft?.target === g.id ? tokens.border.selected : nested && !dashed ? tokens.border.hairline : tokens.border.group, borderStyle: targeted || dashed ? 'dashed' : 'solid', borderColor: selected || targeted || lifted || linkDraft?.target === g.id ? u.c.accent : hover === g.id ? withAlpha(u.c.foregroundMuted, .5) : dashed ? withAlpha(u.c.foregroundMuted, .45) : u.c.border, ...({ cursor: 'auto' } as object) }}>
        {targeted && <Appear style={{ position: 'absolute', inset: 0, backgroundColor: withAlpha(u.c.accent, M.drag.targetFillAlpha) }} />}
        {groupHeader(g, siblings.indexOf(g.id), false, targeted, dashed)}{!g.collapsed && <View pointerEvents="none" style={{ paddingHorizontal: inset, paddingTop: inset, gap: tokens.size.groupDescription.gap }}>{!!g.description && <Txt kind="small" muted numberOfLines={tokens.size.groupDescription.maxLines} onLayout={e => measure(descriptionKey(g.id), e.nativeEvent.layout.height)}>{g.description}</Txt>}{!g.blockIds.length && !g.groupIds.length && <View style={{ height: tokens.size.groupEmpty, borderWidth: 1, borderStyle: 'dashed', borderColor: targeted ? u.c.accent : u.c.border, borderRadius: tokens.radius.control, justifyContent: 'center', paddingHorizontal: 12 }}><Txt kind="small" muted numberOfLines={2}>Grupo vacío. Suelta un bloque o añade uno desde el catálogo.</Txt></View>}</View>}
        </Pressable>
        {selected && <View pointerEvents="none" style={{ position: 'absolute', inset: -3, borderRadius: radius + 3, borderWidth: 3, borderColor: u.halo }} />}
      </Animated.View>; })}
      {!drag && doc.groups.filter(g => g.layout?.mode === 'flow' && !g.collapsed && !rects.get(g.id)?.hidden).flatMap(g => [...g.blockIds, ...g.groupIds].filter(id => !index.entities.get(id)?.position).slice(0, -1).map(id => { const r = rects.get(id)!; return <View key={`${g.id}:${id}`} pointerEvents="none" style={{ position: 'absolute', left: r.x + r.width + 7 - bound.x, top: r.y + 20 - bound.y }}><Icon name="ChevronRight" size={14} color={u.c.foregroundMuted} /></View>; }))}
      {whiteboardItems(['wb-shape','wb-svg'])}
      <LinkLayer motion={linkMotion} handle={links} doc={doc} layout={layout} shift={shift} routes={routes} origin={bound} width={bound.width} height={bound.height} focus={focus} selected={routes.find(r => r.links.some(l => l.id === linkId))?.key ?? null} draft={draftLive.current} draftRef={draftLive} marks={marks} onPress={pressLink} onHover={setLinkHover} />
      {doc.blocks.filter(b => !rects.get(b.id)!.hidden && !isWhiteboardRenderer(c.catalog?.blockTypes.find(t => t.id === b.typeId)?.renderer)).map(b => { const r = rects.get(b.id)!, lifted = !!drag?.ids.has(b.id), a = animOf(b.id, NATIVE);
        return <BlockItem key={b.id} interacting={interaction === b.id} block={b} left={r.x - bound.x} top={r.y - bound.y} width={r.width} height={b.size || resizeId === b.id ? a.h : undefined} resizeHandlers={canDrag && !linkDraft && c.selection.length === 1 && c.selection.includes(b.id) ? resizeHandlers(b.id) : undefined} anim={a} selected={c.selection.includes(b.id)} lifted={lifted} dim={!lit(b.id)} ringed={linkDraft?.target === b.id} detailsSide={index.direction(b.parentGroupId ?? null) === 'right' ? 'bottom' : 'right'} cursor={cursor(lifted)} handlers={canDrag ? dragHandlers(b.id) : noHandlers} controller={c} accent={u.c.accent} shadow={shadow} {...stable} onHover={hovering} onMeasure={measure} />; })}
      {whiteboardItems(['wb-text'])}{whiteboardItems(['wb-draw'])}
      <WhiteboardPreview store={wb.store} origin={bound} />
      {wb.editor && <WhiteboardEditor key={`${wb.editor.documentId}:${wb.editor.block.id}`} session={wb.editor} origin={bound} error={wb.editorError} saving={wb.saving} onSave={wb.saveText} onCancel={wb.cancel} />}
      <View ref={marks} pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, width: bound.width, height: bound.height, zIndex: 4 }} />
      {guideLine(guideV, true)}{guideLine(guideH, false)}
      {pinFor && handleRect && <Pressable accessibilityRole="button" accessibilityLabel={`${tokens.canvas.pin.label}: «${title(pinFor)}» vuelve a ordenarse automáticamente`} hitSlop={8} onHoverIn={() => hovering(pinFor, true)} onHoverOut={() => hovering(pinFor, false)} onPress={event => { event.stopPropagation(); onRelease?.([pinFor]); }} style={({ pressed, ...state }) => ({ position: 'absolute', left: handleRect.x - bound.x + tokens.canvas.pin.offset, top: handleRect.y - bound.y + tokens.canvas.pin.offset, width: tokens.canvas.pin.size, height: tokens.canvas.pin.size, borderRadius: tokens.canvas.pin.size / 2, zIndex: 5, alignItems: 'center', justifyContent: 'center', backgroundColor: u.c.surface1, borderWidth: 1, borderColor: pressed || (state as { hovered?: boolean }).hovered ? u.c.accent : u.c.border, transform: [{ scale: pressed ? M.press.scale : 1 }] })}><Icon name={tokens.canvas.pin.icon} size={tokens.canvas.pin.iconSize} color={u.c.foregroundMuted} /></Pressable>}
      {handleFor && handlePoint && <Pressable nativeID={`lienzo-link-handle-${handleFor}`} accessibilityRole="button" accessibilityLabel={`Arrastra para conectar «${title(handleFor)}» con otro elemento`} accessibilityHint="Con teclado: selecciona dos elementos y pulsa L, o usa Conexiones en el inspector." onHoverIn={() => hovering(handleFor, true)} onHoverOut={() => hovering(handleFor, false)} style={{ position: 'absolute', left: handlePoint.x - bound.x - G.handle.hit / 2, top: handlePoint.y - bound.y - G.handle.hit / 2, width: G.handle.hit, height: G.handle.hit, alignItems: 'center', justifyContent: 'center', zIndex: 5 }}>
        <View {...linkHandle(handleFor, handlePoint)} style={{ width: G.handle.hit, height: G.handle.hit, alignItems: 'center', justifyContent: 'center' }}><View pointerEvents="none" style={{ width: G.handle.size, height: G.handle.size, borderRadius: G.handle.size / 2, backgroundColor: linkDraft ? u.c.accent : u.c.surface1, borderWidth: 1.5, borderColor: u.c.accent, alignItems: 'center', justifyContent: 'center' }}><Icon name={G.handle.icon} size={10} color={linkDraft ? u.c.accentForeground : u.c.accent} /></View></View>
      </Pressable>}
      {linkDraft && <><MagnetCue x={draftX} y={draftY} origin={bound} scale={camS} pulse={sparkPulse} active={!!linkDraft.target} /><Animated.View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, transform: [{ translateX: Animated.add(Animated.subtract(draftX, bound.x), 12) }, { translateY: Animated.add(Animated.subtract(draftY, bound.y), 12) }], zIndex: 6, paddingHorizontal: 6, minHeight: 20, justifyContent: 'center', borderRadius: tokens.radius.chip, backgroundColor: u.c.surface2, borderWidth: 1, borderColor: u.c.border }}><Txt kind="small" numberOfLines={1}>{linkDraft.target ? `Conectar con «${title(linkDraft.target)}»` : 'Acerca la punta a un bloque o grupo'}</Txt></Animated.View></>}
    </Animated.View>
    </View>
    {!ready && <View pointerEvents="none" style={{ position: 'absolute', inset: 24, gap: 16 }}><Txt kind="small" muted>Preparando el lienzo…</Txt><View style={{ width: 288, height: 96, backgroundColor: u.c.surface2, borderRadius: 10 }} /></View>}
    {interaction && rects.get(interaction) && <Animated.View style={{ position:'absolute', zIndex:20, transform:[{translateX:Animated.add(camX,Animated.multiply(camS,rects.get(interaction)!.x+rects.get(interaction)!.width))},{translateY:Animated.add(camY,Animated.multiply(camS,rects.get(interaction)!.y))}], marginTop:-30, marginLeft:-148 }}><Pressable nativeID={`lienzo-interaction-exit-${interaction}`} accessibilityRole="button" accessibilityLabel="Salir del modo interacción" onPress={() => setInteractionMode(null)} style={[islandStyle(u),{height:24,paddingHorizontal:8,justifyContent:'center',borderRadius:12}]}><Txt kind="label">Interactuando · Esc</Txt></Pressable></Animated.View>}
    {selectionToolbar && interaction === null && !linkLabel && !wb.editor && (selectedBounds || linkId) && (() => {
      const route = routes.find(r => r.links.some(l => l.id === linkId)), box = selectedBounds ?? (route ? { ...route.labelPoint, width: 0, height: 0, depth: 0 } : null);
      return box ? <SelectionOverlay box={box} link={!!route && !selectedBounds} camera={() => cam.current} subscribe={subscribeCamera} pointer={selectionPointer.current} busy={() => !!(busyHands.current || gesture.current || resize.current || linkGesture.current || goal.current || coast.current !== null || wbRef.current.store.snapshot())} viewport={size}>{selectionToolbar}</SelectionOverlay> : null;
    })()}
    {linkLabel && (() => { const route = routes.find(r => r.links.some(l => l.id === linkLabel.linkId)); if (!route) return null; return <LinkLabelEditor key={linkLabel.linkId} session={linkLabel} at={{ x: cam.current.offset.x + route.labelPoint.x * cam.current.scale, y: cam.current.offset.y + route.labelPoint.y * cam.current.scale }} disabled={c.offline || c.busy} cancel={() => setLinkLabel(null)} save={async label => {
      const controller = latest.current.c; await controller.settle(); if (controller.current.current?.document.id !== linkLabel.documentId || !controller.current.current.document.links.some(l => l.id === linkLabel.linkId)) return false;
      const next = await controller.edit([{ type: 'link.update', id: linkLabel.linkId, patch: { label } }], 'Editar etiqueta del enlace'); if (next) setLinkLabel(null); return !!next;
    }} />; })()}
    <Animated.View pointerEvents="none" nativeID="lienzo-marquee" style={{ position: 'absolute', left: box.x, top: box.y, width: box.w, height: box.h, opacity: box.o, zIndex: 18, borderWidth: 1, borderRadius: 2, borderColor: u.c.accent, backgroundColor: withAlpha(u.c.accent, tokens.canvas.marquee.fill) }} />
    {wayfinding}
    <ZoomControl width={size.width} camera={cam} subscribe={listener => { camSubs.current.add(listener); return () => { camSubs.current.delete(listener); }; }} onStep={zoomStep} onReset={() => zoomTo(1)} onFit={() => fit()} />
  </View>;
}
const noHandlers: GestureResponderHandlers = {};
// Text that is not marked selectable must not start a browser selection under a drag; selectable text keeps its own rule.
const noSelect = { userSelect: 'none' } as object;
