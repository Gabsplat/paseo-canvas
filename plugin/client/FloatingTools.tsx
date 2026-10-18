import React, { useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Icon, ScrollView } from './host';
import { WB_COLORS, WB_SCALE, type WbShape, type WbRenderer } from '../shared/whiteboard';
import { tokens } from './tokens';
import { withAlpha } from './color';
import { Button, IconButton, Input, Modal, Tooltip, Txt, useUI } from './ui';
import { islandStyle, wbColor, wbFont } from './whiteboard-visuals';
import type { CanvasTool, SvgInsertOptions, ToolStyle } from './whiteboard-tools';
export type SelectionKind = WbRenderer | 'line';
export type StyleIslandProps = { tool: CanvasTool; selectionKinds: ReadonlySet<SelectionKind>; value: ToolStyle; onChange(patch: Partial<ToolStyle>): void; orientation: 'vertical' | 'horizontal'; touch?: boolean; disabled?: boolean;
  /** Inside the right panel: no island of its own, full width, every option shown. */
  bare?: boolean;
  /** Stroke layer reset (§18.12): how many of the learner's own strokes exist, and the action that removes only those. */
  myStrokes?: number; onClearMyStrokes?(): void };
export function StyleIsland({ tool, selectionKinds, value, onChange, orientation, touch = false, disabled = false, myStrokes = 0, onClearMyStrokes, bare = false }: StyleIslandProps) {
  const u = useUI(), [more, setMore] = useState(false), horizontal = orientation === 'horizontal' && !bare;
  const text = selectionKinds.has('wb-text') || tool === 'text', shape = selectionKinds.has('wb-shape') || selectionKinds.has('line') || tool === 'shape', line = selectionKinds.has('line') || tool === 'shape' && value.shape === 'line';
  const pencil = tool === 'draw' || tool === 'eraser';
  if (!selectionKinds.size && !['text','shape','draw','eraser'].includes(tool)) return null;
  const reset = pencil && onClearMyStrokes ? <Pressable key="Clear my strokes" accessibilityRole="button" accessibilityLabel="Clear my strokes" accessibilityHint="Keeps the agent's strokes and the author's" accessibilityState={{ disabled: disabled || !myStrokes }} disabled={disabled || !myStrokes} onPress={e => { e.stopPropagation(); onClearMyStrokes(); }} style={{ minHeight: touch ? 44 : 32, paddingHorizontal: 8, borderRadius: 6, flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: u.c.border, opacity: disabled || !myStrokes ? .45 : 1 }}><Icon name="RotateCcw" size={14} color={u.c.foreground} /><Txt kind="small" numberOfLines={1} style={{ fontWeight: '600' }}>Clear my strokes</Txt></Pressable> : null;
  const choose = (label: string, active: boolean, content: React.ReactNode, press: () => void, wide = false) => <Pressable key={label} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: active, disabled }} disabled={disabled} onPress={e => { e.stopPropagation(); press(); }} style={{ minWidth: wide ? 44 : 32, height: touch ? 44 : 32, paddingHorizontal: wide ? 6 : 0, borderRadius: 6, justifyContent: 'center', alignItems: 'center', backgroundColor: active ? withAlpha(u.c.accent, .14) : 'transparent', opacity: disabled ? .45 : 1 }}><Tooltip label={label} style={{ alignItems: 'center', justifyContent: 'center', alignSelf: 'stretch', flex: 1 }}>{content}</Tooltip></Pressable>;
  const section = (label: string, content: React.ReactNode) => <View key={label} style={{ gap: 4 }}><Txt kind="label" muted>{label}</Txt><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 2 }}>{content}</View></View>;
  const extras = <>
      {shape && !line && section('Fill', (['none','wash','solid'] as const).map(fill => choose({ none:'No fill',wash:'Soft',solid:'Solid' }[fill], value.fill === fill, <View style={{ width: 16, height: 16, borderRadius: 4, borderWidth: 1.5, borderColor: wbColor(value.color,u), backgroundColor: fill === 'none' ? 'transparent' : withAlpha(wbColor(value.fillColor ?? value.color,u), fill === 'wash' ? .14 : 1) }} />, () => onChange({ fill }))))}
      {shape && !line && section('Fill colour', WB_COLORS.map(color => { const on = value.fill !== 'none' && (value.fillColor ?? value.color) === color; return choose(`Fill ${tokens.whiteboard.colors.find(c => c.id === color)!.label}`, on, <View style={{ width: 18, height: 18, borderRadius: 4, borderWidth: on ? 2 : 0, borderColor: u.c.accent, backgroundColor: wbColor(color, u) }} />, () => onChange({ fillColor: color, ...(value.fill === 'none' ? { fill: 'solid' as const } : {}) })); }))}
      {shape && section('Stroke', (['solid','dashed','dotted'] as const).map(stroke => choose({solid:'Solid',dashed:'Dashed',dotted:'Dotted'}[stroke], value.stroke === stroke, <Icon name={{solid:'Minus',dashed:'MoreHorizontal',dotted:'Ellipsis'}[stroke]} size={16} color={u.c.foreground} />, () => onChange({ stroke }))))}
      {text && section('Font', (['sans','serif','mono'] as const).map(font => choose(font, value.font === font, <Txt kind="small" style={{ fontFamily: wbFont(font) }}>{font === 'sans' ? 'Sans' : font === 'serif' ? 'Serif' : 'Mono'}</Txt>, () => onChange({ font }), true)))}
      {text && section('Alignment', (['left','center','right'] as const).map(align => choose(align, value.align === align, <Icon name={{left:'AlignLeft',center:'AlignCenter',right:'AlignRight'}[align]} size={16} color={u.c.foreground} />, () => onChange({ align }))))}
      {line && section('Ends', (['none','end','both'] as const).map(heads => choose({none:'No arrowhead',end:'Arrow',both:'Both ends'}[heads], value.heads === heads, <Icon name={{none:'Minus',end:'ArrowRight',both:'ArrowLeftRight'}[heads]} size={16} color={u.c.foreground} />, () => onChange({ heads }))))}
  </>;
  const body = <View style={{ flexDirection: horizontal ? 'row' : 'column', gap: 8 }}>
    {tool !== 'eraser' && section('Colour', WB_COLORS.map(color => choose(tokens.whiteboard.colors.find(c => c.id === color)!.label, value.color === color, <View style={{ width: 24, height: 24, borderRadius: 12, borderWidth: value.color === color ? 2 : 0, borderColor: u.c.accent, alignItems: 'center', justifyContent: 'center' }}><View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: wbColor(color, u) }} /></View>, () => onChange({ color }))))}
    {(text || shape || tool === 'draw' || selectionKinds.has('wb-draw')) && tool !== 'eraser' && section('Size', WB_SCALE.map(scale => choose(scale.toUpperCase(), value.scale === scale, <Txt kind="label">{scale.toUpperCase()}</Txt>, () => onChange({ scale }))))}
    {horizontal ? (text || shape ? choose('More style', false, <Icon name="SlidersHorizontal" size={16} color={u.c.foreground} />, () => setMore(true)) : null) : extras}
    {reset && (horizontal ? reset : <View style={{ gap: 4 }}><Txt kind="label" muted>My strokes</Txt>{reset}</View>)}
  </View>;
  if (bare) return <View nativeID="lienzo-style" style={{ gap: 8 }}>{body}</View>;
  return <View style={[islandStyle(u), { padding: 8, width: horizontal ? undefined : 168, maxWidth: horizontal ? '100%' : undefined }]}>{horizontal ? <ScrollView horizontal contentContainerStyle={{ gap: 8 }}>{body}</ScrollView> : body}{horizontal && (text || shape) && <Modal open={more} onOpenChange={setMore} title="Style"><Modal.Content><View style={{gap:8}}>{extras}</View></Modal.Content></Modal>}</View>;
}
export { LibraryPopover, type LibraryPopoverProps } from './IconLibrary';
