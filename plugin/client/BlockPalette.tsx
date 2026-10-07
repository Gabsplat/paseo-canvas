import React, { useEffect, useRef, useState } from 'react';
import { Animated, Pressable, View } from 'react-native';
import { Icon } from '@getpaseo/plugin/client/react-native';
import type { BlockType } from '../shared/model';
import { isWhiteboardRenderer } from '../shared/whiteboard';
import { visual } from './Blocks';
import { withAlpha, type Tone } from './color';
import { NATIVE, easeOut, reducedMotion } from './motion';
import { getClientRenderer } from './renderers';
import { tokens } from './tokens';
import { Txt, useUI } from './ui';
import { islandStyle } from './whiteboard-visuals';

type Item = { key: string; name: string; label: string; description: string; icon: string; tone: Tone; onPress(): void };
export type PaletteExtra = { label: string; icon: string; description?: string; onPress(): void };
const P = tokens.island.palette;

/** One column of the palette. It slides out from under the tool column, each column a beat after the one before. */
function Column({ index, children }: { index: number; children: React.ReactNode }) {
  const u = useUI(), enter = useRef(new Animated.Value(reducedMotion.current ? 1 : 0)).current;
  useEffect(() => { if (!reducedMotion.current) Animated.timing(enter, { toValue: 1, duration: P.enterMs, delay: index * P.staggerMs, easing: easeOut, useNativeDriver: NATIVE }).start(); }, []);
  return <Animated.View style={[islandStyle(u), { opacity: enter, transform: [{ translateX: enter.interpolate({ inputRange: [0, 1], outputRange: [-P.offset * (index + 1), 0] }) }] }]}>{children}</Animated.View>;
}

/**
 * Blocks as icon-only columns beside the docked tools: basics first, interactive ones next. Pointing at an icon
 * names it and says what it is for; pressing adds it. Whiteboard types are left out because the tools already draw them.
 */
export function BlockPalette({ types, extras, insert, onMore, disabled, maxRows }: { types: readonly BlockType[]; extras: readonly PaletteExtra[]; insert(type: BlockType): void; onMore(): void; disabled: boolean; maxRows: number }) {
  const u = useUI(), [hint, setHint] = useState<{ item: Item; column: number; row: number } | null>(null);
  const items = types.filter(type => !isWhiteboardRenderer(type.renderer)).map(type => { const v = visual(type); return { key: type.id, name: type.name, label: `Añadir ${type.name}`, description: type.description, icon: v.icon, tone: v.tone as Tone, onPress: () => insert(type), interactive: !!getClientRenderer(type.renderer) }; });
  const more: Item = { key: 'more', name: 'Catálogo completo', label: 'Catálogo completo', description: 'Buscar, plantillas, colecciones y tipos propios.', icon: 'Ellipsis', tone: 'neutro', onPress: onMore };
  const rows = Math.max(3, maxRows), fit = (list: Item[], reserve = 0) => list.slice(0, rows - reserve);
  const columns: Item[][] = [
    fit([...items.filter(item => !item.interactive), ...extras.map((extra): Item => ({ key: extra.label, name: extra.label.replace('…', ''), label: extra.label, description: extra.description ?? '', icon: extra.icon, tone: 'neutro', onPress: extra.onPress }))]),
    [...fit(items.filter(item => item.interactive), 1), more],
  ].filter(column => column.length);
  const size = P.button, left = columns.length * (size + 2 * tokens.island.padding + 2) + (columns.length - 1) * P.gap + P.hintGap;
  // Columns share their vertical centre with the tools, so the hint is placed from the tallest column's top.
  const tallest = Math.max(...columns.map(column => column.length)), top = (column: number, row: number) => ((tallest - columns[column].length) / 2 + row) * size + tokens.island.padding;
  return <View nativeID="lienzo-interactive-blocks" accessibilityRole="toolbar" accessibilityLabel="Bloques" style={{ flexDirection: 'row', alignItems: 'center', gap: P.gap }}>
    {columns.map((column, c) => <Column key={c} index={c}>{column.map((item, r) => <Pressable key={item.key} accessibilityRole="button" accessibilityLabel={item.label} accessibilityHint={item.description} disabled={disabled && item.key !== 'more'} onPress={e => { e.stopPropagation(); item.onPress(); }}
      onHoverIn={() => setHint({ item, column: c, row: r })} onHoverOut={() => setHint(current => current?.item.key === item.key ? null : current)} onFocus={() => setHint({ item, column: c, row: r })} onBlur={() => setHint(null)}
      style={({ pressed, ...state }) => ({ width: size, height: size, borderRadius: 8, alignItems: 'center', justifyContent: 'center', opacity: disabled && item.key !== 'more' ? .45 : 1, backgroundColor: pressed ? withAlpha(u.c.foreground, .1) : (state as { hovered?: boolean }).hovered ? withAlpha(u.c.foreground, .06) : 'transparent' })}>
      <Icon name={item.icon} size={P.icon} color={item.tone === 'neutro' ? u.c.foreground : u.tone(item.tone)} />
    </Pressable>)}</Column>)}
    {hint && <View pointerEvents="none" style={{ position: 'absolute', left, top: top(hint.column, hint.row), width: P.hintWidth, ...islandStyle(u, true), paddingHorizontal: 10, paddingVertical: 8, gap: 2 }}>
      <Txt kind="bodyStrong" numberOfLines={1}>{hint.item.name}</Txt>{!!hint.item.description && <Txt kind="small" muted numberOfLines={3}>{hint.item.description}</Txt>}
    </View>}
  </View>;
}
