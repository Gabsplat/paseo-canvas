import React, { useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import { Icon, ScrollView } from '@getpaseo/plugin/client/react-native';
import { WB_COLORS, WB_SCALE, type WbShape, type WbRenderer } from '../shared/whiteboard';
import { tokens } from './tokens';
import { withAlpha } from './color';
import { Button, IconButton, Input, Modal, Txt, useUI } from './ui';
import { WebSvg, fetchSvgUrl, pickSvgFile, attachLibraryDrag } from './web';
import { SVG_LIBRARY } from './SvgLibrary';
import { islandStyle, wbColor, wbFont } from './whiteboard-visuals';
import type { CanvasTool, SvgInsertOptions, ToolStyle } from './whiteboard-tools';
export type ToolIslandProps = {
  tool: CanvasTool; onToolChange(tool: CanvasTool): void; locked?: boolean; onLockChange?(locked: boolean): void;
  shape?: WbShape; onOpenShapes(): void; onOpenLibrary(): void; onOpenPicker(): void;
  width: number; touch?: boolean; disabled?: boolean; grid?: boolean;
};
export function ToolIsland({ tool, onToolChange, locked = false, onLockChange, onOpenShapes, onOpenLibrary, onOpenPicker, width, touch = false, disabled = false, grid = false }: ToolIslandProps) {
  const u = useUI(), last = useRef<{ tool: string; time: number } | null>(null), narrow = width < 560;
  const order = grid ? tokens.whiteboard.tools.order.filter(id => id !== '|') : narrow ? tokens.whiteboard.tools.narrowOrder : tokens.whiteboard.tools.order;
  return <View nativeID="lienzo-tools" style={grid ? { flexDirection: 'row', flexWrap: 'wrap', width: 200, gap: 8 } : [islandStyle(u), { flexDirection: 'row', alignItems: 'center' }]}>
    {order.map((id, i) => {
      if (id === '|') return <View key={`divider-${i}`} style={{ width: 1, height: 20, marginHorizontal: 4, backgroundColor: u.c.border }} />;
      const item = tokens.whiteboard.tools.items[id], active = tool === id, blocked = disabled && id !== 'select' && id !== 'hand';
      return <Pressable key={id} accessibilityRole="button" accessibilityLabel={`${item.label}${'key' in item ? ` (${item.key})` : ''}`} accessibilityState={{ selected: active, disabled: blocked }} disabled={blocked} onPress={e => {
        e.stopPropagation();
        if (id === 'library') { onOpenLibrary(); return; } if (id === 'add') { onOpenPicker(); return; }
        const now = Date.now(), double = last.current?.tool === id && now - last.current.time < 300; last.current = { tool: id, time: now };
        if (double && active) onLockChange?.(!locked); else { if (tool !== id) onLockChange?.(false); if (id === 'shape' && active) onOpenShapes(); else onToolChange(id as CanvasTool); }
      }} style={({ pressed, ...state }) => ({ width: grid || touch ? 44 : 40, height: grid || touch ? 44 : 40, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: active ? withAlpha(u.c.accent, .14) : pressed ? withAlpha(u.c.foreground, .1) : (state as { hovered?: boolean }).hovered ? withAlpha(u.c.foreground, .06) : 'transparent', opacity: blocked ? .45 : 1 })}>
        <Icon name={item.icon} size={20} color={active ? u.c.accent : u.c.foreground} />
        {id === 'shape' && <View pointerEvents="none" style={{ position: 'absolute', right: 3, bottom: 4 }}><Icon name="ChevronDown" size={10} color={u.c.foregroundMuted} /></View>}
        {locked && active && <View pointerEvents="none" style={{ position: 'absolute', bottom: 3, width: 4, height: 4, borderRadius: 2, backgroundColor: u.c.accent }} />}
      </Pressable>;
    })}
  </View>;
}
export const FloatingTools = ToolIsland;
export type SelectionKind = WbRenderer | 'line';
export type StyleIslandProps = { tool: CanvasTool; selectionKinds: ReadonlySet<SelectionKind>; value: ToolStyle; onChange(patch: Partial<ToolStyle>): void; orientation: 'vertical' | 'horizontal'; touch?: boolean; disabled?: boolean;
  /** Stroke layer reset (§18.12): how many of the learner's own strokes exist, and the action that removes only those. */
  myStrokes?: number; onClearMyStrokes?(): void };
export function StyleIsland({ tool, selectionKinds, value, onChange, orientation, touch = false, disabled = false, myStrokes = 0, onClearMyStrokes }: StyleIslandProps) {
  const u = useUI(), [more, setMore] = useState(false), horizontal = orientation === 'horizontal';
  const text = selectionKinds.has('wb-text') || tool === 'text', shape = selectionKinds.has('wb-shape') || selectionKinds.has('line') || tool === 'shape', line = selectionKinds.has('line') || tool === 'shape' && value.shape === 'line';
  const pencil = tool === 'draw' || tool === 'eraser';
  if (!selectionKinds.size && !['text','shape','draw','eraser'].includes(tool)) return null;
  const reset = pencil && onClearMyStrokes ? <Pressable key="Borrar mis trazos" accessibilityRole="button" accessibilityLabel="Borrar mis trazos" accessibilityHint="Conserva los trazos del asistente y los del autor" accessibilityState={{ disabled: disabled || !myStrokes }} disabled={disabled || !myStrokes} onPress={e => { e.stopPropagation(); onClearMyStrokes(); }} style={{ minHeight: touch ? 44 : 32, paddingHorizontal: 8, borderRadius: 6, flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: u.c.border, opacity: disabled || !myStrokes ? .45 : 1 }}><Icon name="RotateCcw" size={14} color={u.c.foreground} /><Txt kind="small" numberOfLines={1} style={{ fontWeight: '600' }}>Borrar mis trazos</Txt></Pressable> : null;
  const choose = (label: string, active: boolean, content: React.ReactNode, press: () => void, wide = false) => <Pressable key={label} accessibilityRole="button" accessibilityLabel={label} accessibilityState={{ selected: active, disabled }} disabled={disabled} onPress={e => { e.stopPropagation(); press(); }} style={{ minWidth: wide ? 44 : 32, height: touch ? 44 : 32, paddingHorizontal: wide ? 6 : 0, borderRadius: 6, justifyContent: 'center', alignItems: 'center', backgroundColor: active ? withAlpha(u.c.accent, .14) : 'transparent', opacity: disabled ? .45 : 1 }}>{content}</Pressable>;
  const section = (label: string, content: React.ReactNode) => <View key={label} style={{ gap: 4 }}><Txt kind="label" muted>{label}</Txt><View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 2 }}>{content}</View></View>;
  const extras = <>
      {shape && !line && section('Relleno', (['none','wash','solid'] as const).map(fill => choose({ none:'Sin relleno',wash:'Suave',solid:'Sólido' }[fill], value.fill === fill, <View style={{ width: 16, height: 16, borderRadius: 4, borderWidth: 1.5, borderColor: wbColor(value.color,u), backgroundColor: fill === 'none' ? 'transparent' : withAlpha(wbColor(value.color,u), fill === 'wash' ? .14 : 1) }} />, () => onChange({ fill }))))}
      {shape && section('Trazo', (['solid','dashed','dotted'] as const).map(stroke => choose({solid:'Continuo',dashed:'Discontinuo',dotted:'Punteado'}[stroke], value.stroke === stroke, <Icon name={{solid:'Minus',dashed:'MoreHorizontal',dotted:'Ellipsis'}[stroke]} size={16} color={u.c.foreground} />, () => onChange({ stroke }))))}
      {text && section('Fuente', (['sans','serif','mono'] as const).map(font => choose(font, value.font === font, <Txt kind="small" style={{ fontFamily: wbFont(font) }}>{font === 'sans' ? 'Sans' : font === 'serif' ? 'Serif' : 'Mono'}</Txt>, () => onChange({ font }), true)))}
      {text && section('Alineación', (['left','center','right'] as const).map(align => choose(align, value.align === align, <Icon name={{left:'AlignLeft',center:'AlignCenter',right:'AlignRight'}[align]} size={16} color={u.c.foreground} />, () => onChange({ align }))))}
      {line && section('Puntas', (['none','end','both'] as const).map(heads => choose({none:'Sin punta',end:'Flecha',both:'Doble'}[heads], value.heads === heads, <Icon name={{none:'Minus',end:'ArrowRight',both:'ArrowLeftRight'}[heads]} size={16} color={u.c.foreground} />, () => onChange({ heads }))))}
  </>;
  const body = <View style={{ flexDirection: horizontal ? 'row' : 'column', gap: 8 }}>
    {tool !== 'eraser' && section('Color', WB_COLORS.map(color => choose(tokens.whiteboard.colors.find(c => c.id === color)!.label, value.color === color, <View style={{ width: 24, height: 24, borderRadius: 12, borderWidth: value.color === color ? 2 : 0, borderColor: u.c.accent, alignItems: 'center', justifyContent: 'center' }}><View style={{ width: 18, height: 18, borderRadius: 9, backgroundColor: wbColor(color, u) }} /></View>, () => onChange({ color }))))}
    {(text || shape || tool === 'draw' || selectionKinds.has('wb-draw')) && tool !== 'eraser' && section('Tamaño', WB_SCALE.map(scale => choose(scale.toUpperCase(), value.scale === scale, <Txt kind="label">{scale.toUpperCase()}</Txt>, () => onChange({ scale }))))}
    {horizontal ? (text || shape ? choose('Más estilo', false, <Icon name="SlidersHorizontal" size={16} color={u.c.foreground} />, () => setMore(true)) : null) : extras}
    {reset && (horizontal ? reset : <View style={{ gap: 4 }}><Txt kind="label" muted>Mis trazos</Txt>{reset}</View>)}
  </View>;
  return <View style={[islandStyle(u), { padding: 8, width: horizontal ? undefined : 168, maxWidth: horizontal ? '100%' : undefined }]}>{horizontal ? <ScrollView horizontal contentContainerStyle={{ gap: 8 }}>{body}</ScrollView> : body}{horizontal && (text || shape) && <Modal open={more} onOpenChange={setMore} title="Estilo"><Modal.Content><View style={{gap:8}}>{extras}</View></Modal.Content></Modal>}</View>;
}
export type ShapePopoverProps = { value: WbShape; heads?: ToolStyle['heads']; onPick(shape: WbShape, heads: ToolStyle['heads']): void; onClose(): void };
export function ShapePopover({ value, heads = 'none', onPick, onClose }: ShapePopoverProps) {
  const u = useUI(); return <View style={[islandStyle(u,true), { width: 184, padding: 8, gap: 8 }]}><View style={{ flexDirection:'row', alignItems:'center' }}><Txt kind="label" style={{flex:1}}>Formas</Txt><IconButton icon="X" label="Cerrar formas" onPress={onClose} /></View><View style={{flexDirection:'row',flexWrap:'wrap',gap:2}}>{tokens.whiteboard.shapes.items.map(item => <Pressable key={item.id} accessibilityRole="button" accessibilityLabel={item.label} accessibilityState={{selected:value === item.id && heads === 'none'}} onPress={() => { onPick(item.id,'none'); onClose(); }} style={{width:40,height:40,alignItems:'center',justifyContent:'center',borderRadius:8,backgroundColor:value===item.id&&heads==='none'?withAlpha(u.c.accent,.14):'transparent'}}><Icon name={'fallbackIcon' in item ? item.fallbackIcon : item.icon} size={20} color={u.c.foreground} /></Pressable>)}</View><Button label="Flecha" icon="MoveUpRight" small variant="ghost" onPress={() => { onPick('line','end'); onClose(); }} /></View>;
}
export type LibraryPopoverProps = { onInsert(svg: string, meta: SvgInsertOptions): unknown; onImport(): void; error?: string; busy?: boolean; onClose(): void };
export function LibraryPopover({ onInsert, onImport, error, busy = false, onClose }: LibraryPopoverProps) {
  const u = useUI(), host = useRef<View>(null), latest = useRef({ onInsert, busy, color: u.c.foreground }); latest.current = { onInsert, busy, color: u.c.foreground };
  useEffect(() => attachLibraryDrag(host.current, { enabled: () => !latest.current.busy, preview: id => { const entry = SVG_LIBRARY.find(entry => entry.id === id); return entry ? { svg: entry.svg, color: latest.current.color } : undefined; }, drop: (id, atPage) => { const entry = SVG_LIBRARY.find(entry => entry.id === id); if (entry) void latest.current.onInsert(entry.svg, { caption: entry.caption, source: entry.source, license: entry.license, atPage }); } }), []);
  return <View ref={host} style={[islandStyle(u,true),{width:304,padding:8,gap:8}]}><View style={{flexDirection:'row',alignItems:'center'}}><Txt kind="label" style={{flex:1}}>Arquitectura</Txt><IconButton icon="X" label="Cerrar biblioteca" onPress={onClose} /></View><View style={{flexDirection:'row',flexWrap:'wrap',gap:2}}>{SVG_LIBRARY.map(entry => <Pressable key={entry.id} nativeID={`lienzo-library-icon-${entry.id}`} disabled={busy} accessibilityRole="button" accessibilityLabel={`Insertar ${entry.caption}`} onPress={() => { void onInsert(entry.svg,{caption:entry.caption,source:entry.source,license:entry.license}); }} style={{width:68,height:64,alignItems:'center',justifyContent:'center',gap:4,opacity:busy?.45:1}}><View style={{width:28,height:28}}>{u.layout.platform==='web'?<WebSvg svg={entry.svg} color={u.c.foreground} label={entry.caption} />:<Icon name={tokens.whiteboard.types['wb-svg'].icon} size={28} color={u.c.foreground} />}</View><Txt kind="small" muted numberOfLines={1}>{entry.caption}</Txt></Pressable>)}</View>{!!error&&<Txt kind="small" style={{color:u.c.statusDanger}}>{error}</Txt>}<Button label="Importar SVG…" icon="Upload" variant="ghost" small disabled={busy} onPress={onImport} /><Txt kind="small" muted>Iconos Tabler · licencia MIT</Txt></View>;
}
export type SvgImportDialogProps = { open: boolean; onClose(): void; onInsert(svg: string, meta?: SvgInsertOptions): Promise<boolean> };
export function SvgImportDialog({ open, onClose, onInsert }: SvgImportDialogProps) {
  const u = useUI(), [text,setText]=useState(''),[url,setUrl]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const submit = async (load:()=>Promise<string|null>) => { setBusy(true);setError('');try {const svg=await load(); if(svg && await onInsert(svg)) onClose(); else if(svg) setError('No se guardó el SVG. Revisa el aviso del lienzo.');}catch{setError('Este SVG contiene contenido activo o enlaces externos, supera el límite o no se pudo cargar.');}finally{setBusy(false);} };
  return <Modal open={open} onOpenChange={next=>{if(!next)onClose();}} title="Importar SVG"><Modal.Content><View style={{gap:12}}><Txt kind="small" muted>Pegá SVG estático, elegí un archivo o cargá una URL. Los enlaces externos dentro del SVG no se admiten.</Txt><Input label="Pegar código SVG" multiline mono value={text} onChange={setText} readOnly={busy}/><Button label="Insertar código SVG" disabled={busy||!text.trim()} onPress={()=>{void submit(async()=>text);}}/>{u.layout.platform==='web'&&<><Button label="Elegir archivo SVG" icon="Upload" disabled={busy} onPress={()=>{void submit(pickSvgFile);}}/><Input label="URL del SVG" value={url} onChange={setUrl} readOnly={busy}/><Button label="Cargar URL" disabled={busy||!url.trim()} onPress={()=>{void submit(()=>fetchSvgUrl(url));}}/></>}{!!error&&<Txt kind="small" style={{color:u.c.statusDanger}}>{error}</Txt>}{busy&&<Txt kind="small" muted>Cargando SVG…</Txt>}</View></Modal.Content></Modal>;
}
