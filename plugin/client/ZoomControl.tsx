import React, { useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Icon } from '@getpaseo/plugin/client/react-native';
import type { Camera } from './logic';
import { IconButton, Txt, useUI } from './ui';
import { tokens } from './tokens';
import { withAlpha } from './color';
import { islandStyle } from './whiteboard-visuals';
import { attachZoomMenu } from './web';
export type ZoomControlProps = { width: number; camera: React.RefObject<Camera>; subscribe(listener: () => void): () => void; onStep(direction: 1 | -1): void; onReset(): void; onFit(): void };
export function ZoomControl({ width, camera, subscribe, onStep, onReset, onFit }: ZoomControlProps) {
  const u = useUI(), [percent, setPercent] = useState(() => Math.round(camera.current.scale * 100)), [open, setOpen] = useState(false);
  const trigger = useRef<View>(null), menu = useRef<View>(null), narrow = !u.compact && width > 0 && width < 880;
  // Camera motion changes only this label, without re-rendering cards or document layout.
  useEffect(() => subscribe(() => setPercent(Math.round(camera.current.scale * 100))), []);
  useEffect(() => { if (open && narrow) return attachZoomMenu(menu.current, trigger.current, () => setOpen(false)); }, [open, narrow]);
  useEffect(() => { if (!narrow) setOpen(false); }, [narrow]);
  const row = (label: string, icon: string, action: () => void, disabled = false) => <Pressable key={label} accessibilityRole="menuitem" accessibilityLabel={label} accessibilityState={{ disabled }} disabled={disabled} onPress={event => { event.stopPropagation(); setOpen(false); action(); }} style={({ pressed, ...state }) => ({ minHeight: u.compact ? tokens.menu.row.heightTouch : tokens.menu.row.height, paddingHorizontal: tokens.menu.row.paddingH, borderRadius: tokens.menu.row.radius, flexDirection: 'row', alignItems: 'center', gap: tokens.menu.row.gap, opacity: disabled ? .45 : 1, backgroundColor: pressed || (state as { hovered?: boolean }).hovered ? withAlpha(u.c.foreground, .06) : 'transparent' })}><Icon name={icon} size={tokens.menu.row.icon} color={u.c.foregroundMuted} /><Txt numberOfLines={1}>{label}</Txt></Pressable>;
  return <View nativeID="lienzo-tools-zoom" style={{ position: 'absolute', right: 12, bottom: 12, padding: 2, backgroundColor: u.c.surface1, borderWidth: 1, borderColor: u.c.border, borderRadius: 8 }}>
    <View nativeID="lienzo-interactive-zoom" style={{ flexDirection: 'row', alignItems: 'center' }}>
      {!narrow && <IconButton icon="Minus" label="Alejar" disabled={percent <= tokens.canvas.zoomMin * 100} onPress={() => onStep(-1)} />}
      <Pressable ref={trigger} accessibilityRole="button" accessibilityLabel={narrow ? 'Opciones de zoom' : 'Restablecer zoom'} accessibilityState={narrow ? { expanded: open } : undefined} onPress={() => narrow ? setOpen(value => !value) : onReset()} style={({ pressed, ...state }) => ({ minWidth: 48, height: u.compact ? 44 : 32, paddingHorizontal: 4, borderRadius: 6, justifyContent: 'center', alignItems: 'center', backgroundColor: pressed ? withAlpha(u.c.foreground, tokens.alpha.pressedFill) : (state as { hovered?: boolean }).hovered ? withAlpha(u.c.foreground, tokens.alpha.hoverFill) : 'transparent' })}><Txt kind="label" muted>{percent}%</Txt></Pressable>
      {!narrow && <><IconButton icon="Plus" label="Acercar" disabled={percent >= tokens.canvas.zoomMax * 100} onPress={() => onStep(1)} /><View style={{ width: 1, height: 16, marginHorizontal: 2, backgroundColor: u.c.border }} /><IconButton icon="Maximize" label="Ajustar al lienzo" onPress={onFit} /></>}
    </View>
    {narrow && open && <View ref={menu} nativeID="lienzo-interactive-zoom-menu" accessibilityRole="menu" style={[islandStyle(u, true), { position: 'absolute', right: 0, bottom: 40, width: tokens.menu.width, padding: tokens.menu.padding, zIndex: 30 }]}>
      {row('Acercar', 'Plus', () => onStep(1), percent >= tokens.canvas.zoomMax * 100)}
      {row('Alejar', 'Minus', () => onStep(-1), percent <= tokens.canvas.zoomMin * 100)}
      {row('Ajustar al lienzo', 'Maximize', onFit)}
      {row('Tamaño real 100 %', 'Scan', onReset)}
    </View>}
  </View>;
}
