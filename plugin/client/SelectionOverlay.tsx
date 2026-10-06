import React, { createContext, useEffect, useRef, useState } from 'react';
import { Animated, View } from 'react-native';
import { TextInput } from '@getpaseo/plugin/client/react-native';
import { Button, Txt, useUI } from './ui';
import { attachEditorKeys, focusInput } from './web';
import { toolbarPosition } from './panel-actions';
import { tokens } from './tokens';
import type { Camera, Point, Rect } from './logic';
import { glide, NATIVE, reducedMotion } from './motion';
function ToolbarEntrance({ children, above }: { children: React.ReactNode; above: boolean }) {
  const progress = useRef(new Animated.Value(reducedMotion.current ? 1 : 0)).current;
  useEffect(() => { glide(progress, 1, { ms: tokens.toolbar.enterMs, native: NATIVE }); return () => progress.stopAnimation(); }, []);
  return <Animated.View pointerEvents="box-none" style={{ opacity: progress, transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [tokens.toolbar.enterOffset * (above ? -1 : 1), 0] }) }] }}>{children}</Animated.View>;
}
export const SelectionGeometry = createContext<{ top: number; height: number } | null>(null);
export function SelectionOverlay({ children, box, link, camera, subscribe, busy, viewport, pointer }: { children: React.ReactNode; box: Pick<Rect, 'x' | 'y' | 'width' | 'height'>; link: boolean; camera(): Camera; subscribe(listener: () => void): () => void; busy(): boolean; viewport: { width: number; height: number }; pointer?: Point | null }) {
  const [width, setWidth] = useState(360), [shown, setShown] = useState(false), [, redraw] = useState(0), latest = useRef({ busy, box }); latest.current = { busy, box };
  useEffect(() => {
    setShown(false);
    let settled = 0, visible = false;
    const check = () => { if (latest.current.busy()) { settled = 0; if (visible) { visible = false; setShown(false); } } else { settled ||= Date.now(); if (!visible && Date.now() - settled >= tokens.toolbar.showDelayMs) { visible = true; setShown(true); } } };
    const timer = setInterval(check, 40), cleanup = subscribe(() => { check(); redraw(v => v + 1); });
    return () => { clearInterval(timer); cleanup(); };
  }, [subscribe, box.x, box.y, box.width, box.height]);
  const position = toolbarPosition(camera(), box, viewport, width, link, pointer);
  if (!shown) return null;
  const cam = camera(), above = position.top < cam.offset.y + cam.scale * box.y;
  return <View pointerEvents="box-none" style={{ position: 'absolute', zIndex: 10, ...position, maxWidth: Math.max(0, viewport.width - 16) }}><ToolbarEntrance above={above}><View pointerEvents="box-none" onLayout={e => setWidth(e.nativeEvent.layout.width)} style={{ maxWidth: Math.max(0, viewport.width - 16) }}><SelectionGeometry.Provider value={{ top: position.top, height: viewport.height }}>{children}</SelectionGeometry.Provider></View></ToolbarEntrance></View>;
}
export type LinkLabelSession = { documentId: string; linkId: string; value: string };
export function LinkLabelEditor({ session, at, save, cancel, disabled }: { session: LinkLabelSession; at: Point; save(value: string): Promise<boolean>; cancel(): void; disabled: boolean }) {
  const u = useUI(), [draft, setDraft] = useState(session.value), [error, setError] = useState(''), [saving, setSaving] = useState(false), host = useRef<View>(null), cancelled = useRef(false), flight = useRef(false), value = useRef(draft);
  const submit = async () => { if (cancelled.current || flight.current || disabled) return; if (value.current === session.value) { cancel(); return; } flight.current = true; setSaving(true); setError(''); try { if (!(await save(value.current))) setError('No se guardó. Reintentar.'); } finally { flight.current = false; setSaving(false); } };
  const stop = () => { cancelled.current = true; cancel(); };
  useEffect(() => { focusInput(host.current); return attachEditorKeys(host.current, () => { void submit(); }, stop); }, []);
  return <View ref={host} nativeID="lienzo-interactive-link-label-editor" style={{ position: 'absolute', left: at.x - 120, top: at.y - 16, width: 240, zIndex: 20, backgroundColor: u.c.surface1 }}>
    <TextInput autoFocus accessibilityLabel="Etiqueta del enlace" placeholder="Qué pasa por aquí" placeholderTextColor={u.c.foregroundMuted} value={draft} editable={!disabled && !saving} maxLength={200} onChangeText={text => { value.current = text; setDraft(text); }} onBlur={() => { void submit(); }} onSubmitEditing={() => { void submit(); }} onKeyPress={event => { if (event.nativeEvent.key === 'Escape') stop(); }} style={[u.font('body'), { minHeight: 32, padding: 6, borderWidth: 1.5, borderColor: u.c.accent, backgroundColor: u.c.surface1 }]} />
    {!!error && <View style={{ padding: 6 }}><Txt kind="small" style={{ color: u.c.statusDanger }}>{error}</Txt><Button label="Reintentar" small disabled={disabled || saving} onPress={() => { void submit(); }} /><Button label="Cancelar" small variant="ghost" onPress={stop} /></View>}
  </View>;
}
