import React, { useEffect, useRef } from 'react';
import { Animated, View } from 'react-native';
import type { Point } from './logic';
import { easeOut, NATIVE, reducedMotion } from './motion';
import { tokens } from './tokens';
import { useUI } from './ui';

/** Four small marks, emitted once on acquisition. No glow, particle loop or canvas-wide effect. */
export function MagnetCue({ x, y, origin, scale, pulse, active }: { x: Animated.Value; y: Animated.Value; origin: Point; scale: Animated.Value; pulse: number; active: boolean }) {
  const u = useUI(), progress = useRef(new Animated.Value(1)).current, M = tokens.motion.magnet;
  useEffect(() => {
    progress.stopAnimation(); progress.setValue(1);
    if (!pulse || reducedMotion.current) return;
    progress.setValue(0); Animated.timing(progress, { toValue: 1, duration: M.sparkMs, easing: easeOut, useNativeDriver: NATIVE }).start();
    return () => progress.stopAnimation();
  }, [pulse]);
  return <Animated.View pointerEvents="none" style={{ position: 'absolute', left: 0, top: 0, width: 1, height: 1, zIndex: 6, opacity: active ? 1 : 0, transform: [{ translateX: Animated.subtract(x, origin.x) }, { translateY: Animated.subtract(y, origin.y) }, { scale: Animated.divide(1, scale) }] }}>
    <View nativeID={active ? 'lienzo-magnet-port' : undefined} style={{ position: 'absolute', left: -5, top: -5, width: 10, height: 10, borderRadius: 5, borderWidth: 1.5, borderColor: u.c.accent, backgroundColor: u.c.surface1 }} />
    {[[1, 0], [0, 1], [-1, 0], [0, -1]].slice(0, M.sparkCount).map(([dx, dy], i) => <Animated.View key={i} style={{ position: 'absolute', left: -M.sparkSize / 2, top: -M.sparkSize, width: M.sparkSize, height: M.sparkSize * 2, borderRadius: 1, backgroundColor: u.c.accent, opacity: progress.interpolate({ inputRange: [0, .15, 1], outputRange: [0, 1, 0] }), transform: [{ translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [dx * 6, dx * (6 + M.sparkTravel)] }) }, { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [dy * 6, dy * (6 + M.sparkTravel)] }) }, { rotate: dx ? '90deg' : '0deg' }] }} />)}
  </Animated.View>;
}
