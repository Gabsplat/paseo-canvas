import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, View } from 'react-native';
import { Icon } from './host';
import { tokens } from './tokens';
import { Txt, useUI } from './ui';
import { WebVectors, type VectorPath } from './web';
import { NATIVE, reducedMotion, useReducedMotion } from './motion';
import { islandStyle } from './whiteboard-visuals';

/**
 * Small Argentine details nobody needs in order to use Lienzo (docs/redesign-2026-10.md, "Argentine flavour"): a
 * mate in the empty canvas, a kettle when ⌘K hears "mate", and now and then a Sol de Mayo or a tango step while
 * something loads. They never sit over content and stay still, or away, under reduced motion.
 */
const E = tokens.face.eggs;
const line = (d: string, color: string, weight = 1.6): VectorPath => ({ d, color, weight, hit: false });
const MATE = ['M29 42 C 21 57, 24 81, 50 89 C 76 81, 79 57, 71 42', 'M28 42 C 40 35, 61 35, 72 42 C 61 48, 40 48, 28 42', 'M36 42 C 40 39, 45 44, 50 40 C 55 37, 60 43, 64 41', 'M39 88 C 44 93, 57 93, 62 88', 'M58 43 L 73 13', 'M71 12 C 74 11, 77 13, 78 15'];
const STEAM = ['M43 31 C 38 25, 47 21, 42 13', 'M53 29 C 49 23, 57 19, 52 10'];
const KETTLE = ['M24 76 C 19 58, 31 44, 50 44 C 69 44, 81 58, 76 76 Z', 'M40 44 C 42 36, 58 36, 60 44', 'M47 35 L 53 35', 'M75 60 C 85 58, 89 50, 94 41', 'M31 46 C 31 26, 69 26, 69 46', 'M18 76 L 82 76'];
const SUN = (() => { const out = ['M50 38 A 12 12 0 1 0 50.01 38']; for (let i = 0; i < 16; i++) { const a = i * Math.PI / 8, c = Math.cos(a), s = Math.sin(a), r1 = 16, r2 = i % 2 ? 26 : 30;
  out.push(i % 2 ? `M${50 + c * r1} ${50 + s * r1} Q ${50 + c * (r1 + 5) + s * 3} ${50 + s * (r1 + 5) - c * 3} ${50 + c * r2} ${50 + s * r2}` : `M${50 + c * r1} ${50 + s * r1} L ${50 + c * r2} ${50 + s * r2}`); } return out; })();
const FOOT = 'M0 0 C -4 -8, -4 -20, 0 -24 C 5 -20, 5 -8, 0 0 M -1 4 C -3 8, 3 8, 1 4';

function Drawing({ paths, color, size, label }: { paths: readonly string[]; color: string; size: number; label: string }) {
  return <View style={{ width: size, height: size }}><WebVectors width={100} height={100} label={label} paths={paths.map(d => line(d, color))} /></View>;
}

/** The hand-drawn mate with its rising steam (still under reduced motion). */
export function MateDrawing({ size = E.mate, color }: { size?: number; color?: string }) {
  const u = useUI(), motion = useReducedMotion(), rise = useRef(new Animated.Value(0)).current, still = motion.current, ink = color ?? u.c.foregroundMuted;
  useEffect(() => { if (still) return; const loop = Animated.loop(Animated.timing(rise, { toValue: 1, duration: E.steamMs, easing: Easing.inOut(Easing.quad), useNativeDriver: NATIVE })); loop.start(); return () => loop.stop(); }, [still]);
  if (u.layout.platform !== 'web') return <Icon name="Coffee" size={32} color={ink} />;
  return <View pointerEvents="none" style={{ width: size, height: size }}>
    <Drawing paths={MATE} color={ink} size={size} label="A mate, drawn by hand" />
    {!still && <Animated.View style={{ position: 'absolute', inset: 0, opacity: rise.interpolate({ inputRange: [0, .3, 1], outputRange: [0, .9, 0] }), transform: [{ translateY: rise.interpolate({ inputRange: [0, 1], outputRange: [6, -6] }) }] }}><Drawing paths={STEAM} color={ink} size={size} label="" /></Animated.View>}
  </View>;
}
/** The empty canvas: the mate and one line of copy. Pointer events pass through. */
export function EmptyMate() {
  return <View nativeID="lienzo-empty-mate" pointerEvents="none" style={{ alignItems: 'center', gap: 10 }}>
    <MateDrawing />
    <Txt kind="display" style={{ textAlign: 'center' }}>Empty. Pour yourself a mate.</Txt>
    <Txt muted style={{ textAlign: 'center' }}>Then draw, write, or press + to add something. ⌘K finds everything.</Txt>
  </View>;
}

/** The kettle ⌘K boils when someone types "mate". It sits in the bottom-right corner, above the zoom, and leaves. */
export function Kettle({ serial, bottom }: { serial: number; bottom: number }) {
  const u = useUI(), [shown, setShown] = useState(0), puff = useRef(new Animated.Value(0)).current;
  useReducedMotion();
  useEffect(() => {
    if (!serial || reducedMotion.current) return;
    setShown(serial); puff.setValue(0);
    const loop = Animated.loop(Animated.timing(puff, { toValue: 1, duration: 700, easing: Easing.out(Easing.quad), useNativeDriver: NATIVE })); loop.start();
    const done = setTimeout(() => setShown(0), E.kettleMs);
    return () => { loop.stop(); clearTimeout(done); };
  }, [serial]);
  if (!shown || u.layout.platform !== 'web') return null;
  return <View nativeID="lienzo-kettle" pointerEvents="none" style={[islandStyle(u), { position: 'absolute', right: tokens.island.inset, bottom, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 10, zIndex: 20 }]}>
    <View style={{ width: E.kettle, height: E.kettle }}>
      <Drawing paths={KETTLE} color={u.c.foreground} size={E.kettle} label="A kettle heating water" />
      <Animated.View style={{ position: 'absolute', right: -2, top: 2, opacity: puff.interpolate({ inputRange: [0, .5, 1], outputRange: [0, 1, 0] }), transform: [{ translateY: puff.interpolate({ inputRange: [0, 1], outputRange: [4, -8] }) }, { scale: puff.interpolate({ inputRange: [0, 1], outputRange: [.6, 1.2] }) }] }}>
        <View style={{ width: 10, height: 10, borderRadius: 5, borderWidth: 1.5, borderColor: u.c.foregroundMuted }} />
      </Animated.View>
    </View>
    <Txt kind="small" muted>80 °C. Never boiling, for mate.</Txt>
  </View>;
}

/** Now and then, beside a loading line: a small Sol de Mayo turning, or a tango step. Otherwise nothing. */
export function LoadingEgg() {
  const u = useUI(), motion = useReducedMotion(), [kind] = useState<'sun' | 'tango' | null>(() => Math.random() < E.loaderChance ? Math.random() < .5 ? 'sun' : 'tango' : null), t = useRef(new Animated.Value(0)).current;
  useEffect(() => { if (!kind || motion.current) return; const loop = Animated.loop(Animated.timing(t, { toValue: 1, duration: E.loaderMs, easing: Easing.linear, useNativeDriver: NATIVE })); loop.start(); return () => loop.stop(); }, [kind]);
  if (!kind || motion.current || u.layout.platform !== 'web') return null;
  const size = E.loader;
  if (kind === 'sun') return <Animated.View nativeID="lienzo-egg-sun" pointerEvents="none" style={{ width: size, height: size, transform: [{ rotate: t.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '45deg'] }) }] }}><Drawing paths={SUN} color={u.c.statusWarning} size={size} label="Sol de Mayo" /></Animated.View>;
  return <View nativeID="lienzo-egg-tango" pointerEvents="none" style={{ width: size * 1.6, height: size, flexDirection: 'row' }}>
    {[0, 1].map(i => <Animated.View key={i} style={{ width: size * .8, height: size, opacity: t.interpolate({ inputRange: [0, .5, 1], outputRange: i ? [.25, 1, .25] : [1, .25, 1] }), transform: [{ translateY: t.interpolate({ inputRange: [0, .5, 1], outputRange: i ? [2, -2, 2] : [-2, 2, -2] }) }] }}>
      <View style={{ width: size * .8, height: size }}><WebVectors width={20} height={30} label={i ? '' : 'A tango step'} paths={[line(`${FOOT.replace(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g, (_, x: string, y: string) => `${Number(x) + 10} ${Number(y) + 27}`)}`, u.c.foregroundMuted, 1.4)]} /></View>
    </Animated.View>)}
  </View>;
}
