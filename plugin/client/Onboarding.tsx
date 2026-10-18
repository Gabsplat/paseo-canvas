/**
 * The Lienzo guide (docs/redesign-2026-10.md, "Onboarding"): four short scenes that play by themselves on a large
 * stage, with the words on the right. Nothing on the stage is clickable: it is a picture of how Lienzo works, drawn
 * with Animated views in the theme's colours. Under reduced motion each scene shows its last frame and waits.
 */
import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, View, type ViewStyle } from 'react-native';
import { Icon, capabilities } from './host';
import { withAlpha } from './color';
import { reducedMotion, useReducedMotion } from './motion';
import { Button, Txt, useUI } from './ui';
import { Screen, labelStyle } from './Screen';
import { guideScenes, type GuideScene } from './guide';
import { tokens } from './tokens';

const O = tokens.face.screens.onboarding;
/** The stage is drawn in a fixed 560 × 420 space and scaled to fit. */
const W = 560, H = 420;
type T = Animated.Value;
type AnimatedNumber = Animated.AnimatedInterpolation<number> | Animated.Value;
const seg = (t: T, a: number, b: number, out: number[] = [0, 1]) => t.interpolate({ inputRange: out.length === 2 ? [a, b] : out.map((_, i) => a + (b - a) * i / (out.length - 1)), outputRange: out, extrapolate: 'clamp' });
const appear = (t: T, a: number, b = a + .08) => ({ opacity: seg(t, a, b), transform: [{ translateY: seg(t, a, b, [8, 0]) }, { scale: seg(t, a, b, [.94, 1]) }] });

/** Text that types itself out between two moments of the scene. */
function useTyped(t: T, text: string, a: number, b: number) {
  const [n, setN] = useState(reducedMotion.current ? text.length : 0);
  useEffect(() => { if (reducedMotion.current) { setN(text.length); return; } const id = t.addListener(({ value }) => { const k = Math.round(Math.max(0, Math.min(1, (value - a) / (b - a))) * text.length); setN(p => p === k ? p : k); }); return () => t.removeListener(id); }, [t, text]);
  return text.slice(0, n);
}
/** A value that steps with the scene's time (the "Hoja 2 of 3" pill). */
function useStep<V>(t: T, pick: (value: number) => V) {
  const [v, setV] = useState(() => pick(reducedMotion.current ? 1 : 0));
  useEffect(() => { const id = t.addListener(({ value }) => { const next = pick(value); setV(p => p === next ? p : next); }); return () => t.removeListener(id); }, [t]);
  return v;
}

function MiniCard({ x, y, w = 168, h = 60, title, lines = 2, tone, style, ring }: { x: number; y: number; w?: number; h?: number; title: string; lines?: number; tone: string; style?: object; ring?: AnimatedNumber }) {
  const u = useUI();
  return <Animated.View style={[{ position: 'absolute', left: x, top: y, width: w, height: h }, style]}>
    {ring && <Animated.View style={{ position: 'absolute', left: -6, top: -6, right: -6, bottom: -6, borderRadius: 14, borderWidth: 2, borderColor: u.c.accent, opacity: ring, boxShadow: `0 0 0 4px ${withAlpha(u.c.accent, .16)}` } as object} />}
    <View style={{ flex: 1, borderRadius: 10, borderWidth: 1, borderColor: u.c.border, backgroundColor: u.c.surface1, paddingLeft: 14, paddingRight: 10, paddingVertical: 10, gap: 7, overflow: 'hidden', boxShadow: `0 6px 16px ${withAlpha('#000000', .1)}` } as object}>
      <View style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, backgroundColor: tone }} />
      <Txt kind="small" numberOfLines={1} style={{ fontWeight: '700' }}>{title}</Txt>
      {Array.from({ length: lines }, (_, i) => <View key={i} style={{ height: 5, width: i ? '58%' : '86%', borderRadius: 3, backgroundColor: withAlpha(u.c.foregroundMuted, .22) }} />)}
    </View>
  </Animated.View>;
}
/** A straight line from one point to another that draws itself as `progress` goes 0 → 1, with an optional head. */
function Line({ x1, y1, x2, y2, progress, color, dashed = false, head = true, weight = 1.5 }: { x1: number; y1: number; x2: number; y2: number; progress: AnimatedNumber; color: string; dashed?: boolean; head?: boolean; weight?: number }) {
  const length = Math.hypot(x2 - x1, y2 - y1), angle = Math.atan2(y2 - y1, x2 - x1);
  return <View pointerEvents="none" style={{ position: 'absolute', left: (x1 + x2) / 2 - length / 2, top: (y1 + y2) / 2 - 6, width: length, height: 12, transform: [{ rotate: `${angle}rad` }] }}>
    <Animated.View style={{ position: 'absolute', left: 0, top: 6 - weight / 2, height: dashed ? 0 : weight, width: (progress as Animated.Value).interpolate({ inputRange: [0, 1], outputRange: [0, length - (head ? 3 : 0)] }),
      ...(dashed ? { borderTopWidth: weight, borderStyle: 'dashed', borderColor: color } : { backgroundColor: color, borderRadius: weight }) } as ViewStyle} />
    {head && <Animated.View style={{ position: 'absolute', right: 0, top: 1.5, width: 0, height: 0, borderTopWidth: 4.5, borderBottomWidth: 4.5, borderLeftWidth: 8, borderTopColor: 'transparent', borderBottomColor: 'transparent', borderLeftColor: color, opacity: (progress as Animated.Value).interpolate({ inputRange: [0, .9, 1], outputRange: [0, 0, 1] }) }} />}
  </View>;
}
function Bubble({ x, y, w, text, mine = false, style, small }: { x: number; y: number; w: number; text: string; mine?: boolean; style?: object; small?: React.ReactNode }) {
  const u = useUI();
  return <Animated.View style={[{ position: 'absolute', left: x, top: y, width: w, alignItems: mine ? 'flex-end' : 'flex-start', gap: 6 }, style]}>
    <View style={{ maxWidth: w, paddingHorizontal: 12, paddingVertical: 9, borderRadius: 14, borderBottomRightRadius: mine ? 4 : 14, borderBottomLeftRadius: mine ? 14 : 4, backgroundColor: mine ? u.c.accent : u.c.surface2 }}>
      <Txt kind="small" style={{ color: mine ? u.c.accentForeground : u.c.foreground, lineHeight: 18 }}>{text || ' '}</Txt>
    </View>
    {small}
  </Animated.View>;
}
/** The surface a scene's canvas sits on: the paper colour, a hairline and a faint grid of dots. */
function CanvasPane({ x, y, w, h, children }: { x: number; y: number; w: number; h: number; children: React.ReactNode }) {
  const u = useUI(), dots: React.ReactNode[] = [];
  for (let i = 1; i < w / 28; i++) for (let j = 1; j < h / 28; j++) dots.push(<View key={`${i}:${j}`} style={{ position: 'absolute', left: i * 28, top: j * 28, width: 2, height: 2, borderRadius: 1, backgroundColor: withAlpha(u.c.foregroundMuted, .16) }} />);
  return <View style={{ position: 'absolute', left: x, top: y, width: w, height: h, borderRadius: 14, borderWidth: 1, borderColor: u.c.border, backgroundColor: u.c.surface0, overflow: 'hidden' }}>{dots}{children}</View>;
}
function Pill({ children, style }: { children: React.ReactNode; style?: object }) {
  const u = useUI();
  return <Animated.View style={[{ flexDirection: 'row', alignItems: 'center', gap: 6, height: 28, paddingHorizontal: 10, borderRadius: 14, borderWidth: 1, borderColor: u.c.border, backgroundColor: u.c.surface1, boxShadow: `0 4px 12px ${withAlpha('#000000', .12)}` } as object, style]}>{children}</Animated.View>;
}

/** 1. A sentence types in the chat; on the canvas, cards and arrows appear one by one and the camera settles on them. */
function SceneDraws({ t }: { t: T }) {
  const u = useUI(), text = useTyped(t, 'A request goes from the browser to the API, which reads the database.', .02, .5);
  const drawing = useStep(t, v => v < .85);
  const tones = [u.tone('acento'), u.tone('violeta'), u.tone('turquesa')];
  return <>
    <View style={{ position: 'absolute', left: 16, top: 16, width: 170, bottom: 16, borderRadius: 14, backgroundColor: u.c.surface1, borderWidth: 1, borderColor: u.c.border, padding: 12, gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><Icon name="MessageSquare" size={12} color={u.c.foregroundMuted} /><Txt kind="label" muted style={labelStyle}>Conversation</Txt></View>
    </View>
    <Bubble x={16 + 12} y={56} w={146} text="How does a request reach the data?" mine style={appear(t, 0, .04)} />
    <Bubble x={16 + 12} y={120} w={146} text={text} style={appear(t, .02, .06)} />
    <Animated.View style={[{ position: 'absolute', left: 28, bottom: 30 }, appear(t, .08, .14)]}><Pill><View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: drawing ? u.c.accent : u.c.statusSuccess }} /><Txt kind="small" style={{ fontWeight: '600' }}>{capabilities.runsAgents ? 'Lienzo' : 'Agent'}</Txt><Txt kind="small" muted>{drawing ? 'drawing' : capabilities.runsAgents ? 'on' : 'done'}</Txt></Pill></Animated.View>
    <CanvasPane x={202} y={16} w={342} h={388}>
      <Animated.View style={{ position: 'absolute', left: 0, top: 0, width: 342, height: 388, transform: [{ translateX: seg(t, .12, .8, [34, 0]) }, { translateY: seg(t, .12, .8, [96, 0]) }, { scale: seg(t, .12, .8, [1.3, 1]) }] }}>
        <MiniCard x={87} y={40} title="Browser" tone={tones[0]} style={appear(t, .14)} />
        <Line x1={171} y1={102} x2={171} y2={160} color={u.c.foregroundMuted} progress={seg(t, .3, .4)} />
        <MiniCard x={87} y={162} title="API" tone={tones[1]} style={appear(t, .38)} />
        <Line x1={171} y1={224} x2={171} y2={282} color={u.c.foregroundMuted} progress={seg(t, .52, .62)} />
        <MiniCard x={87} y={284} title="Database" tone={tones[2]} style={appear(t, .6)} />
      </Animated.View>
      <Animated.View style={{ position: 'absolute', left: 12, top: 12, opacity: seg(t, .12, .2) }}><Txt kind="label" muted style={labelStyle}>Lienzo</Txt></Animated.View>
    </CanvasPane>
  </>;
}

/** 2. Three Hojas slide in along a strip; the pill counts them and the magnet glows while the camera follows. */
function SceneHojas({ t }: { t: T }) {
  const u = useUI(), pill = useStep(t, v => `Hoja ${v < .32 ? 1 : v < .66 ? 2 : 3} of ${v < .24 ? 1 : v < .58 ? 2 : 3}`);
  const following = Animated.add(seg(t, .26, .3, [0, 1]), Animated.multiply(seg(t, .4, .46, [0, 1]), -1)).interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: 'clamp' });
  const following2 = Animated.add(seg(t, .6, .64), Animated.multiply(seg(t, .74, .8), -1)).interpolate({ inputRange: [0, 1], outputRange: [0, 1], extrapolate: 'clamp' });
  const glow = Animated.add(following, following2);
  const hojas = [{ title: 'The request', cards: ['Browser', 'API'] }, { title: 'The cache', cards: ['Cache hit', 'Cache miss'] }, { title: 'When it fails', cards: ['Timeout', 'Retry'] }];
  const tones = [u.tone('acento'), u.tone('turquesa'), u.tone('aviso')];
  const at = [0, .24, .58];
  return <CanvasPane x={16} y={16} w={528} h={388}>
    <Animated.View style={{ position: 'absolute', left: 0, top: 0, width: 1200, height: 388, transform: [{ translateX: Animated.add(seg(t, .3, .44, [124, 124 - 330]), seg(t, .64, .78, [0, -330])) }] }}>
      {hojas.map((h, i) => <Animated.View key={i} style={[{ position: 'absolute', left: i * 330, top: 84, width: 280, height: 250, borderRadius: 14, borderWidth: 1.5, borderColor: withAlpha(tones[i], .6), backgroundColor: withAlpha(tones[i], .05) }, i ? { opacity: seg(t, at[i], at[i] + .08), transform: [{ translateX: seg(t, at[i], at[i] + .1, [60, 0]) }] } : null]}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 14, paddingTop: 12 }}>
          <View style={{ paddingHorizontal: 7, height: 20, borderRadius: 6, justifyContent: 'center', backgroundColor: withAlpha(tones[i], .16) }}><Txt kind="label" style={{ color: tones[i], fontWeight: '700' }}>Hoja {i + 1}</Txt></View>
          <Txt kind="groupTitle" numberOfLines={1}>{h.title}</Txt>
        </View>
        <MiniCard x={20} y={56} w={240} h={66} title={h.cards[0]} tone={tones[i]} style={i ? appear(t, at[i] + .08) : appear(t, .04)} />
        <MiniCard x={20} y={146} w={240} h={66} title={h.cards[1]} tone={tones[i]} style={i ? appear(t, at[i] + .16) : appear(t, .1)} />
      </Animated.View>)}
    </Animated.View>
    <View style={{ position: 'absolute', top: 16, left: 0, right: 0, alignItems: 'center' }}>
      <Pill><Icon name="BookOpen" size={13} color={u.c.foregroundMuted} /><Txt kind="small" style={{ fontWeight: '600' }}>{pill}</Txt><Icon name="ChevronDown" size={12} color={u.c.foregroundMuted} />
        <View style={{ width: 1, height: 16, backgroundColor: u.c.border, marginHorizontal: 2 }} />
        <View style={{ width: 22, height: 22, alignItems: 'center', justifyContent: 'center' }}>
          <Animated.View style={{ position: 'absolute', width: 22, height: 22, borderRadius: 11, backgroundColor: withAlpha(u.c.accent, .22), opacity: glow, transform: [{ scale: glow.interpolate({ inputRange: [0, 1], outputRange: [.6, 1.25] }) }] }} />
          <Icon name="Magnet" size={13} color={u.c.accent} />
        </View>
      </Pill>
    </View>
  </CanvasPane>;
}

/** 3. A cursor selects a card; "mirá esto" arrives in the chat outside the canvas; a line shows the agent reading it. */
function ScenePoint({ t }: { t: T }) {
  const u = useUI(), reply = useTyped(t, 'Reading your selection: “Cache”. It only answers repeated requests…', .66, .92);
  const ring = seg(t, .3, .36);
  const tones = [u.tone('acento'), u.tone('turquesa'), u.tone('violeta')];
  return <>
    <CanvasPane x={16} y={16} w={528} h={226}>
      <View style={{ position: 'absolute', left: 14, top: 12 }}><Txt kind="label" muted style={labelStyle}>Lienzo</Txt></View>
      <MiniCard x={28} y={70} w={140} title="Browser" tone={tones[0]} />
      <Line x1={170} y1={100} x2={192} y2={100} progress={new Animated.Value(1)} color={u.c.foregroundMuted} />
      <MiniCard x={194} y={70} w={140} title="Cache" tone={tones[1]} ring={ring} />
      <Line x1={336} y1={100} x2={358} y2={100} progress={new Animated.Value(1)} color={u.c.foregroundMuted} />
      <MiniCard x={360} y={70} w={140} title="Database" tone={tones[2]} />
      <Animated.View style={{ position: 'absolute', left: 0, top: 0, transform: [{ translateX: seg(t, .04, .28, [430, 262]) }, { translateY: seg(t, .04, .28, [190, 104]) }, { scale: seg(t, .3, .36, [1, .82, 1]) }] }}>
        <Icon name="MousePointer2" size={22} color={u.c.foreground} />
      </Animated.View>
      <Animated.View style={{ position: 'absolute', left: 240, top: 44, opacity: seg(t, .34, .4) }}><Txt kind="label" style={{ color: u.c.accent, fontWeight: '700' }}>Selected</Txt></Animated.View>
    </CanvasPane>
    <View style={{ position: 'absolute', left: 16, top: 256, width: 528, height: 148, borderRadius: 14, borderWidth: 1, borderColor: u.c.border, backgroundColor: u.c.surface1 }}>
      <View style={{ position: 'absolute', left: 14, top: 12, flexDirection: 'row', alignItems: 'center', gap: 6 }}><Icon name="MessageSquare" size={12} color={u.c.foregroundMuted} /><Txt kind="label" muted style={labelStyle}>Your chat</Txt></View>
    </View>
    <Bubble x={300} y={282} w={230} text="mirá esto" mine style={appear(t, .44, .5)} />
    <Bubble x={30} y={326} w={300} text={reply} style={appear(t, .64, .68)} small={<Animated.View style={{ opacity: seg(t, .6, .66), flexDirection: 'row', alignItems: 'center', gap: 4 }}><Icon name="Bot" size={11} color={u.c.foregroundMuted} /><Txt kind="label" muted>Agent · canvas_selection</Txt></Animated.View>} />
    <Line x1={300} y1={132} x2={52} y2={328} dashed head color={u.c.accent} progress={seg(t, .52, .64)} />
  </>;
}

/** 4. A little code card types out, folds into an icon and drops into the toolbar; then the two places it runs. */
function SceneTools({ t }: { t: T }) {
  const u = useUI(), code = useTyped(t, "lienzo.edit([\n  { type: 'block.create',\n    block: timer }\n], 'Add a timer')", .02, .42);
  const fold = seg(t, .48, .6);
  const toolbar = ['MousePointer2', 'Hand', 'Pencil', 'Square', 'Type', 'MoveUpRight'];
  // The toolbar is centred in the 528-wide pane once the new slot has opened: 4 + 6 × 36 + 9 (divider) + 40 + 4.
  const barWidth = 4 + toolbar.length * 36 + 9 + 40 + 4, barTop = 296, slotX = (528 - barWidth) / 2 + 4 + toolbar.length * 36 + 9 + 2, slotY = barTop + 4;
  return <CanvasPane x={16} y={16} w={528} h={388}>
    <Animated.View style={{ position: 'absolute', left: 60, top: 40, width: 300, opacity: seg(t, .5, .6, [1, 0]), transform: [{ translateX: seg(t, .48, .6, [0, slotX + 18 - 210]) }, { translateY: seg(t, .48, .6, [0, slotY + 18 - 120]) }, { scale: seg(t, .48, .6, [1, .14]) }] }}>
      <View style={{ borderRadius: 12, borderWidth: 1, borderColor: u.c.border, backgroundColor: u.c.surface1, overflow: 'hidden', boxShadow: `0 10px 28px ${withAlpha('#000000', .16)}` } as object}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, height: 30, borderBottomWidth: 1, borderColor: u.c.border }}>
          {[0, 1, 2].map(i => <View key={i} style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: withAlpha(u.c.foregroundMuted, .3) }} />)}
          <Txt kind="label" muted style={{ marginLeft: 6 }}>timer.html</Txt>
        </View>
        <View style={{ padding: 14, minHeight: 112 }}><Txt kind="code" style={{ color: u.c.foreground }}>{code}<Txt kind="code" style={{ color: u.c.accent }}>▍</Txt></Txt></View>
      </View>
    </Animated.View>
    <Animated.View style={{ position: 'absolute', zIndex: 2, left: slotX, top: 0, width: 36, height: 36, borderRadius: 9, alignItems: 'center', justifyContent: 'center', backgroundColor: withAlpha(u.c.accent, .18), borderWidth: 1.5, borderColor: u.c.accent,
      opacity: seg(t, .56, .6), transform: [{ translateY: seg(t, .58, .78, [slotY - 150, slotY + 6, slotY - 3, slotY + 1, slotY]) }] }}>
      <Icon name="Timer" size={18} color={u.c.accent} />
    </Animated.View>
    <View style={{ position: 'absolute', left: 0, right: 0, top: barTop, alignItems: 'center' }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 0, height: 44, paddingHorizontal: 4, borderRadius: 12, borderWidth: 1, borderColor: u.c.border, backgroundColor: u.c.surface1, boxShadow: `0 6px 18px ${withAlpha('#000000', .12)}` } as object}>
        {toolbar.map((name, i) => <View key={name} style={{ width: 36, height: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 8, backgroundColor: i === 0 ? u.c.surface2 : 'transparent' }}><Icon name={name} size={17} color={i === 0 ? u.c.foreground : u.c.foregroundMuted} /></View>)}
        <View style={{ width: 1, height: 20, marginHorizontal: 4, backgroundColor: u.c.border }} />
        <Animated.View style={{ width: seg(t, .6, .7, [0, 40]) }} />
      </View>
    </View>
    <Animated.View style={[{ position: 'absolute', right: 20, top: 40, gap: 8, alignItems: 'flex-end' }, appear(t, .8, .86)]}>
      <Pill><Icon name="Sparkles" size={13} color={u.c.accent} /><Txt kind="small" style={{ fontWeight: '600' }}>Works in Paseo</Txt></Pill>
      <Pill style={{ opacity: seg(t, .84, .9) }}><Icon name="Monitor" size={13} color={u.c.accent} /><Txt kind="small" style={{ fontWeight: '600' }}>and the desktop app</Txt></Pill>
    </Animated.View>
    <Animated.View style={{ position: 'absolute', left: 60, top: 196, opacity: seg(t, .42, .62, [0, 1, 1, 1, 0]), transform: [{ translateY: fold.interpolate({ inputRange: [0, 1], outputRange: [0, 6] }) }] }}>
      <Txt kind="small" muted>Your agent wrote it. Lienzo installs it.</Txt>
    </Animated.View>
  </CanvasPane>;
}

const SCENES: Record<GuideScene['id'], (props: { t: T }) => React.ReactElement> = { draws: SceneDraws, hojas: SceneHojas, point: ScenePoint, tools: SceneTools };

/** The stage, scaled to whatever room it gets. */
function Stage({ scene, t }: { scene: GuideScene; t: T }) {
  const u = useUI(), [box, setBox] = useState({ width: 0, height: 0 }), k = box.width ? Math.min(box.width / W, box.height / H) : 0, Scene = SCENES[scene.id];
  return <View nativeID="lienzo-guide-stage" accessibilityLabel={`Animation: ${scene.title}`} pointerEvents="none" onLayout={e => setBox({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })} style={{ flex: 1, overflow: 'hidden', backgroundColor: withAlpha(u.c.foreground, .03) }}>
    {k > 0 && <View style={{ position: 'absolute', left: (box.width - W) / 2, top: (box.height - H) / 2, width: W, height: H, transform: [{ scale: k }] }}><Scene key={scene.id} t={t} /></View>}
  </View>;
}

export function Onboarding({ open, close, panel }: { open: boolean; close: () => void; panel: { width: number; height: number } }) {
  const u = useUI(), motion = useReducedMotion(), scenes = guideScenes(), [step, setStep] = useState(0), t = useRef(new Animated.Value(0)).current, [, rerender] = useState(0);
  useEffect(() => { if (open) setStep(0); }, [open]);
  useEffect(() => {
    if (!open) return;
    if (motion.current) { t.setValue(1); rerender(n => n + 1); return; }
    t.setValue(0);
    const run = Animated.timing(t, { toValue: 1, duration: O.sceneMs, easing: Easing.linear, useNativeDriver: false });
    run.start(({ finished }) => { if (finished) setStep(s => s < scenes.length - 1 && s === step ? s + 1 : s); });
    return () => run.stop();
  }, [open, step]);
  const scene = scenes[step], last = step === scenes.length - 1;
  const go = (next: number) => setStep(Math.max(0, Math.min(scenes.length - 1, next)));
  const copy = <View style={{ flex: u.compact ? undefined : 1, padding: u.compact ? 20 : 36, paddingTop: u.compact ? 18 : 64, gap: 18, justifyContent: 'space-between' }}>
    <View style={{ gap: 18 }}>
      <View accessibilityLabel={`Scene ${step + 1} of ${scenes.length}`} style={{ flexDirection: 'row', gap: 6 }}>{scenes.map((s, i) => <View key={s.id} style={{ flex: 1, height: 3, borderRadius: 2, backgroundColor: withAlpha(u.c.foreground, .12), overflow: 'hidden' }}>
        <Animated.View style={{ height: 3, backgroundColor: u.c.accent, width: i < step ? '100%' : i > step ? '0%' : t.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] }) }} />
      </View>)}</View>
      <Animated.View key={scene.id} style={{ gap: 10, opacity: motion.current ? 1 : t.interpolate({ inputRange: [0, .04], outputRange: [0, 1], extrapolate: 'clamp' }), transform: [{ translateY: motion.current ? 0 : t.interpolate({ inputRange: [0, .05], outputRange: [8, 0], extrapolate: 'clamp' }) }] }}>
        <Txt kind="label" style={{ ...labelStyle, color: u.c.accent }}>{`${step + 1} of ${scenes.length} · ${scene.kicker}`}</Txt>
        <Txt kind="display" accessibilityRole="header" style={{ fontSize: u.compact ? 24 : 30, lineHeight: u.compact ? 30 : 36, letterSpacing: -.4 }}>{scene.title}</Txt>
        <Txt muted style={{ fontSize: 14, lineHeight: 21 }}>{scene.body}</Txt>
      </Animated.View>
    </View>
    <View style={{ gap: 14 }}>
      <View style={{ flexDirection: 'row', gap: 6, justifyContent: 'center' }}>{scenes.map((s, i) => <View key={s.id} accessibilityLabel={`Scene ${i + 1}`} style={{ width: i === step ? 18 : 6, height: 6, borderRadius: 3, backgroundColor: i === step ? u.c.accent : withAlpha(u.c.foreground, .2) }} />)}</View>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Button label="Skip" variant="ghost" onPress={close} />
        <View style={{ flex: 1 }} />
        <Button label="Back" disabled={!step} onPress={() => go(step - 1)} />
        <Button label={last ? 'Dale, let’s start' : 'Next'} variant="primary" onPress={() => last ? close() : go(step + 1)} />
      </View>
    </View>
  </View>;
  return <Screen open={open} onClose={close} panel={panel} nativeID="lienzo-guide" label="Lienzo guide">
    <View style={{ flex: 1, flexDirection: u.compact ? 'column' : 'row', minHeight: 0 }}>
      <View style={u.compact ? { height: Math.max(220, panel.height * .46) } : { flex: O.stage, borderRightWidth: 1, borderColor: u.c.border }}><Stage scene={scene} t={t} /></View>
      <View style={{ flex: u.compact ? 1 : 1 - O.stage, minWidth: 0 }}>{copy}</View>
    </View>
  </Screen>;
}
