// Motion for the canvas (docs/design.md §16). Every number comes from tokens.motion; nothing here reads the DOM.
import React, { useEffect, useRef } from 'react';
import { AccessibilityInfo, Animated, Easing, Platform, type StyleProp, type ViewStyle } from 'react-native';
import { tokens } from './tokens';
const M = tokens.motion;
/** Transform and opacity run on the native driver where there is one; the web build of Animated is JS either way. */
export const NATIVE = Platform.OS !== 'web';
export const easeOut = Easing.bezier(...M.curve.out);
export const frame = (run: () => void): number => requestAnimationFrame(run);
/** The system "reduce motion" setting, shared by everything that moves. Read `.current` at the moment of animating. */
export const reducedMotion = { current: false };
let watchers = 0, stopWatching: (() => void) | undefined;
export function useReducedMotion() {
  useEffect(() => {
    watchers++;
    if (!stopWatching) {
      let active = true, changed = false;
      const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', value => { changed = true; reducedMotion.current = value; });
      void AccessibilityInfo.isReduceMotionEnabled().then(value => { if (active && !changed) reducedMotion.current = value; }).catch(() => {});
      stopWatching = () => { active = false; subscription.remove(); };
    }
    return () => { if (--watchers === 0) { stopWatching?.(); stopWatching = undefined; } };
  }, []);
  return reducedMotion;
}
type Done = (finished: boolean) => void;
/** Ease-out to a value: for anything the layout or a control decides. */
export function glide(value: Animated.Value, toValue: number, options: { ms?: number; native?: boolean; reduced?: boolean; done?: Done } = {}) {
  value.stopAnimation();
  if (options.reduced ?? reducedMotion.current) { value.setValue(toValue); options.done?.(true); return; }
  Animated.timing(value, { toValue, duration: options.ms ?? M.layout.ms, easing: easeOut, useNativeDriver: options.native ?? false }).start(result => options.done?.(result.finished));
}
/** Spring to a value carrying the hand's velocity (px/s): for anything that was just let go. Interruptible by design. */
export function settle(value: Animated.Value, toValue: number, options: { velocity?: number; native?: boolean; reduced?: boolean; done?: Done } = {}) {
  value.stopAnimation();
  if (options.reduced ?? reducedMotion.current) { value.setValue(toValue); options.done?.(true); return; }
  const S = M.spring, velocity = Math.max(-S.velocityMax, Math.min(S.velocityMax, options.velocity ?? 0));
  Animated.spring(value, { toValue, velocity, stiffness: S.stiffness, damping: S.damping, mass: S.mass, restDisplacementThreshold: S.restDistance, restSpeedThreshold: S.restSpeed, useNativeDriver: options.native ?? false }).start(result => options.done?.(result.finished));
}
/** Press feedback for a control: its visual gives a little under the finger. Scale only; the layout box never changes. */
export function usePressScale() {
  const scale = useRef(new Animated.Value(1)).current;
  return { scale, press: (down: boolean) => glide(scale, down ? M.press.scale : 1, { ms: M.press.ms, native: NATIVE }) };
}
/** Fades its children in once, on mount. For feedback that appears because of a gesture (a drop target, a guide). */
export function Appear({ children, style, ms = M.drag.targetFadeMs, interactive = false }: { children?: React.ReactNode; style?: StyleProp<ViewStyle>; ms?: number; interactive?: boolean }) {
  const opacity = useRef(new Animated.Value(reducedMotion.current ? 1 : 0)).current;
  useEffect(() => { glide(opacity, 1, { ms, native: NATIVE }); }, []);
  return <Animated.View pointerEvents={interactive ? 'auto' : 'none'} style={[style, { opacity }]}>{children}</Animated.View>;
}
