import React, { useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Icon, ScrollView } from './host';
import type { WbShape } from '../shared/whiteboard';
import { tokens } from './tokens';
import { withAlpha } from './color';
import { Txt, useTooltip, useUI, type TooltipContent } from './ui';
import { islandStyle } from './whiteboard-visuals';

/** The tools in the bottom toolbar. Frame and Window act once (they add one) instead of staying in hand. */
export type ToolId = 'select' | 'hand' | 'pencil' | 'shape' | 'text' | 'arrow' | 'eraser' | 'marco' | 'ventana';
export const GLOSSARY = {
  lienzo: 'Lienzo — this canvas and each document in it (Spanish for canvas).',
  marco: 'A frame that holds things together.',
  hoja: 'A chapter the agent adds while explaining.',
  lente: 'A way to colour the same canvas.',
  ventana: 'A window onto a web page, a video or a mini app.',
} as const;
type ToolDef = { id: ToolId; label: string; icon: string; shortcut: string; detail?: string };
export const TOOLS: readonly ToolDef[] = [
  { id: 'select', label: 'Select', icon: 'MousePointer2', shortcut: 'tool.select' },
  { id: 'hand', label: 'Hand', icon: 'Hand', shortcut: 'tool.hand' },
  { id: 'pencil', label: 'Pencil', icon: 'Pencil', shortcut: 'tool.pencil' },
  { id: 'shape', label: 'Shape', icon: 'Square', shortcut: 'tool.rectangle' },
  { id: 'text', label: 'Text', icon: 'Type', shortcut: 'tool.text' },
  { id: 'arrow', label: 'Arrow', icon: 'MoveUpRight', shortcut: 'tool.arrow' },
  { id: 'eraser', label: 'Eraser', icon: 'Eraser', shortcut: 'tool.eraser' },
  { id: 'marco', label: 'Frame', icon: 'SquareDashed', shortcut: 'tool.marco', detail: GLOSSARY.marco },
  { id: 'ventana', label: 'Window', icon: 'AppWindow', shortcut: 'tool.ventana', detail: GLOSSARY.ventana },
];
const GROUPS: readonly (readonly ToolId[])[] = [['select', 'hand'], ['pencil', 'shape', 'text', 'arrow', 'eraser'], ['marco', 'ventana']];
/** The shape flyout: rectangle and ellipse have their own keys. */
export const SHAPE_CHOICES: readonly { shape: WbShape; label: string; icon: string; shortcut?: string }[] = [
  { shape: 'rect', label: 'Rectangle', icon: 'Square', shortcut: 'tool.rectangle' }, { shape: 'ellipse', label: 'Ellipse', icon: 'Circle', shortcut: 'tool.ellipse' },
  { shape: 'diamond', label: 'Diamond', icon: 'Diamond' }, { shape: 'triangle', label: 'Triangle', icon: 'Triangle' }, { shape: 'line', label: 'Line', icon: 'Minus' },
];
export const shapeIcon = (shape: WbShape) => SHAPE_CHOICES.find(s => s.shape === shape)?.icon ?? tokens.whiteboard.shapes.items.find(s => s.id === shape)?.icon ?? 'Square';
export type PinnedTool = { id: string; label: string; icon: string; color?: string; detail?: string; active?: boolean; onPress(): void };
export type ToolbarProps = {
  active: ToolId | null; shape: WbShape; locked: boolean; disabled: boolean;
  onTool(id: ToolId): void; onShape(shape: WbShape): void; onLock(locked: boolean): void;
  pinned: readonly PinnedTool[]; onAdd(): void; addOpen: boolean;
  /** The shortcut shown for a registry id, already formatted for this platform. */
  keyLabel(id: string): string | undefined;
  /** Compact: a horizontal scroller with touch-sized buttons. */
  scroll?: boolean;
  addRef?: React.RefObject<View | null>;
};
const F = tokens.face.toolbar;

function ToolButton({ icon, active, disabled, tip, onPress, touch, badge, chevron, color, nativeID, pressed: held }: { icon: string; active: boolean; disabled: boolean; tip: TooltipContent; onPress(): void; touch: boolean; badge?: string; chevron?: boolean; color?: string; nativeID?: string; pressed?: boolean }) {
  const u = useUI(), t = useTooltip(tip), size = touch ? F.buttonTouch : F.button;
  return <Pressable ref={t.ref} nativeID={nativeID} accessibilityRole="button" accessibilityLabel={tip.label} accessibilityHint={tip.detail} accessibilityState={{ selected: active, disabled }} aria-pressed={active} disabled={disabled}
    onPress={e => { e.stopPropagation(); onPress(); }} onPressIn={t.onPressIn} onHoverIn={t.onHoverIn} onHoverOut={t.onHoverOut} onLongPress={touch ? t.onLongPress : undefined}
    style={({ pressed, ...state }) => ({ width: size, height: size, borderRadius: F.radius, alignItems: 'center', justifyContent: 'center', opacity: disabled ? .45 : 1,
      backgroundColor: active || held ? withAlpha(u.c.accent, F.activeWash) : pressed ? withAlpha(u.c.foreground, .1) : (state as { hovered?: boolean }).hovered ? withAlpha(u.c.foreground, .06) : 'transparent' })}>
    <Icon name={icon} size={F.icon} color={color ?? (active || held ? u.c.accent : u.c.foreground)} />
    {chevron && <View pointerEvents="none" style={{ position: 'absolute', right: 2, bottom: 3 }}><Icon name="ChevronUp" size={F.chevron} color={u.c.foregroundMuted} /></View>}
    {!!badge && <View pointerEvents="none" style={{ position: 'absolute', right: 3, bottom: 2 }}><Txt kind="keys" style={{ fontSize: F.pinBadge, lineHeight: F.pinBadge + 2, color: u.c.foregroundMuted }}>{badge}</Txt></View>}
  </Pressable>;
}
const Divider = () => { const u = useUI(); return <View style={{ width: F.divider.width, height: F.divider.height, marginHorizontal: F.divider.marginH, backgroundColor: u.c.border }} />; };

/**
 * The bottom toolbar: Select, Hand | Pencil, Shape (with its flyout), Text, Arrow, Eraser | Frame, Window |
 * pinned tools | +. A double press on the tool in hand keeps it (the lock dot); Esc or V lets go.
 */
export function Toolbar({ active, shape, locked, disabled, onTool, onShape, onLock, pinned, onAdd, addOpen, keyLabel, scroll = false, addRef }: ToolbarProps) {
  const u = useUI(), [flyout, setFlyout] = useState(false), last = useRef<{ id: string; time: number } | null>(null), touch = scroll || u.compact;
  const press = (id: ToolId) => {
    const now = Date.now(), twice = last.current?.id === id && now - last.current.time < 300; last.current = { id, time: now };
    if (twice && active === id && !['marco', 'ventana'].includes(id)) { onLock(!locked); return; }
    if (id === 'shape' && active === 'shape') { setFlyout(open => !open); return; }
    setFlyout(false); onTool(id);
  };
  const tool = (id: ToolId) => { const def = TOOLS.find(t => t.id === id)!, blocked = disabled && id !== 'select' && id !== 'hand';
    return <View key={id}>
      <ToolButton nativeID={`lienzo-tool-${id}`} icon={id === 'shape' ? shapeIcon(shape) : def.icon} active={active === id} disabled={blocked} touch={touch} chevron={id === 'shape'} tip={{ label: id === 'shape' ? 'Shape' : def.label, shortcut: keyLabel(id === 'shape' ? (shape === 'ellipse' ? 'tool.ellipse' : 'tool.rectangle') : def.shortcut), detail: id === 'shape' ? 'Press again for rectangle, ellipse, diamond, triangle or line.' : def.detail }} onPress={() => press(id)} />
      {locked && active === id && <View pointerEvents="none" style={{ position: 'absolute', bottom: 2, alignSelf: 'center', width: tokens.whiteboard.tools.lockDot.size, height: tokens.whiteboard.tools.lockDot.size, borderRadius: 2, backgroundColor: u.c.accent }} />}
    </View>; };
  const shapes = flyout && <View nativeID="lienzo-shape-flyout" accessibilityRole="menu" style={[islandStyle(u, true), { position: 'absolute', bottom: (touch ? F.buttonTouch : F.button) + 2 * tokens.island.padding + 8, left: scroll ? 0 : (touch ? F.buttonTouch : F.button) * 2 + F.gap * 3, width: tokens.face.shapes.width, padding: 4, zIndex: 20 }]}>
    {SHAPE_CHOICES.map(choice => <Pressable key={choice.shape} accessibilityRole="menuitem" accessibilityLabel={choice.label} accessibilityState={{ selected: shape === choice.shape }} onPress={e => { e.stopPropagation(); setFlyout(false); onShape(choice.shape); }}
      style={({ pressed, ...state }) => ({ minHeight: touch ? 44 : tokens.face.shapes.row, paddingHorizontal: 8, borderRadius: 6, flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: shape === choice.shape && active === 'shape' ? withAlpha(u.c.accent, F.activeWash) : pressed ? withAlpha(u.c.foreground, .1) : (state as { hovered?: boolean }).hovered ? withAlpha(u.c.foreground, .06) : 'transparent' })}>
      <Icon name={choice.icon} size={16} color={u.c.foreground} /><Txt style={{ flex: 1 }}>{choice.label}</Txt>{!!choice.shortcut && !!keyLabel(choice.shortcut) && <Txt kind="keys" muted>{keyLabel(choice.shortcut)}</Txt>}
    </Pressable>)}
  </View>;
  const row = <>
    {GROUPS.map((group, i) => <React.Fragment key={i}>{i > 0 && <Divider />}{group.map(tool)}</React.Fragment>)}
    {pinned.length > 0 && <Divider />}
    {pinned.slice(0, F.maxPinned).map((item, i) => <ToolButton key={item.id} nativeID={`lienzo-pinned-${item.id}`} icon={item.icon} color={item.color} active={!!item.active} disabled={disabled} touch={touch} badge={String(i + 1)} tip={{ label: item.label, shortcut: keyLabel(`pinned.${i + 1}`), detail: item.detail }} onPress={() => { setFlyout(false); item.onPress(); }} />)}
    <Divider />
    <View ref={addRef} collapsable={false}><ToolButton nativeID="lienzo-tool-add" icon="Plus" active={false} pressed={addOpen} disabled={false} touch={touch} tip={{ label: 'More tools', detail: 'Shapes, embeds, blocks and extensions. Pin the ones you use.' }} onPress={() => { setFlyout(false); onAdd(); }} /></View>
  </>;
  return <View pointerEvents="box-none" style={{ alignItems: scroll ? 'stretch' : 'center' }}>
    {shapes}
    <View nativeID="lienzo-toolbar" accessibilityRole="toolbar" accessibilityLabel="Tools" style={[islandStyle(u), { height: (touch ? F.buttonTouch : F.button) + 2 * tokens.island.padding, flexDirection: 'row', alignItems: 'center', gap: 0, maxWidth: '100%' }]}>
      {scroll ? <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ flexDirection: 'row', alignItems: 'center', gap: F.gap }}>{row}</ScrollView> : <View style={{ flexDirection: 'row', alignItems: 'center', gap: F.gap }}>{row}</View>}
    </View>
  </View>;
}
