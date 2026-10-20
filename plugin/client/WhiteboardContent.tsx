import React, { useEffect, useState, useSyncExternalStore } from 'react';
import { Icon } from './host';
import { Pressable, View, type Animated, type GestureResponderEvent } from 'react-native';
import type { CanvasBlock } from '../shared/model';
import { wbTextDataSchema, wbShapeDataSchema, wbSvgDataSchema, wbDrawDataSchema, type WbRenderer } from '../shared/whiteboard';
import { Txt, useUI } from './ui';
import { WebSvg, WebVectors, type CanvasPointer, type VectorPath } from './web';
import { shapePath, strokePath, arrowPath, lineEnds } from './whiteboard-geometry';
import { wbColor, wbWeight, wbFont, boundShapeLook, boundText } from './whiteboard-visuals';
import { tokens } from './tokens';
import type { FadingStore } from './useWhiteboard';
/** Whiteboard content takes the cursor of the tool in hand from the canvas, not a button's pointer. */
const inheritCursor = { cursor: 'inherit' } as object;
/** Canvas text is never selected by a press: pressing and dragging moves the box; the label is edited by double-click or Enter. */
const noSelect = { userSelect: 'none', WebkitUserSelect: 'none' } as object;
export function whiteboardLabel(block: CanvasBlock, kind: WbRenderer): string {
  if (block.title) return block.title;
  if (kind === 'wb-text') return String(block.data.text || 'Free text');
  if (kind === 'wb-svg') return String(block.data.caption || 'Imagen SVG');
  if (kind === 'wb-draw') return `${block.data.author === 'assistant' ? 'Agent drawing' : block.data.author === 'learner' ? 'Your drawing' : 'Drawing'} (${Array.isArray(block.data.strokes) ? block.data.strokes.length : 0} strokes)`;
  return String(block.data.text || tokens.whiteboard.shapes.items.find(s => s.id === block.data.shape)?.label || 'Shape');
}
/** `selected`: a hollow shape's inside then takes the pointer, so it drags and double-clicks from anywhere inside. `fading`: the eraser's live preview. */
export type WhiteboardContentProps = { block: CanvasBlock; kind: WbRenderer; width: number; height: number; scale?: number; outline?: boolean; editing?: boolean; selected?: boolean; fading?: FadingStore; onSelect(event?: GestureResponderEvent): void; onHover?(inside: boolean): void; onMeasure?(height: number): void };
export function WhiteboardContent({ block, kind, width, height, scale = 1, outline, editing, selected, fading, onSelect, onHover, onMeasure }: WhiteboardContentProps) {
  const u = useUI(), label = whiteboardLabel(block,kind);
  const press = (p?: CanvasPointer) => onSelect(p ? { nativeEvent: {shiftKey:p.shift,metaKey:p.command},stopPropagation(){} } as unknown as GestureResponderEvent : undefined);
  if (outline) return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onSelect} style={{minHeight:36,flexDirection:'row',alignItems:'center',gap:8}}><Icon name={tokens.whiteboard.types[kind].icon} size={16} color={u.c.foregroundMuted}/><Txt numberOfLines={1}>{label}</Txt></Pressable>;
  if (kind === 'wb-text') {
    const parsed = wbTextDataSchema.safeParse(block.data); if (!parsed.success) return <Txt kind="small">Invalid text</Txt>;
    const data=parsed.data, t=tokens.whiteboard.text[data.scale], shown=boundText(block,data.text,t.fontSize+(data.font==='mono'?-1:0),t.lineHeight);
    return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onSelect} onHoverIn={()=>onHover?.(true)} onHoverOut={()=>onHover?.(false)} style={{width:'100%',...inheritCursor,...noSelect}}><Txt selectable={false} onLayout={e=>onMeasure?.(e.nativeEvent.layout.height)} style={{...noSelect,fontFamily:wbFont(data.font),fontSize:shown.fontSize,lineHeight:shown.lineHeight,fontWeight:'400',color:wbColor(data.color,u),textAlign:data.align}}>{shown.text}</Txt></Pressable>;
  }
  if (kind === 'wb-svg') {
    const parsed=wbSvgDataSchema.safeParse(block.data);if(!parsed.success)return <Txt kind="small">Invalid SVG</Txt>;const data=parsed.data;
    return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onSelect} onHoverIn={()=>onHover?.(true)} onHoverOut={()=>onHover?.(false)} style={{width:'100%',height:'100%',...inheritCursor}}>{u.layout.platform==='web'?<WebSvg svg={data.svg} color={wbColor(data.color,u)} label={label}/>:<View style={{flex:1,borderStyle:'dashed',borderWidth:1,borderColor:u.c.foregroundMuted,justifyContent:'center'}}><Txt kind="small">{label}. SVG image; shown in the web app</Txt></View>}{!!data.caption&&<View pointerEvents="none" style={{position:'absolute',top:'100%',left:0,right:0,paddingTop:4}}><Txt kind="small" muted numberOfLines={1} style={{textAlign:'center'}}>{data.caption}</Txt></View>}</Pressable>;
  }
  let paths: VectorPath[]=[];
  if (kind === 'wb-draw') {
    const parsed=wbDrawDataSchema.safeParse(block.data);if(!parsed.success)return <Txt kind="small">Invalid drawing</Txt>;const data=parsed.data;
    // Authorship is drawn, not only stored: the assistant's strokes are dashed and carry its name.
    const assistant=data.author==='assistant';
    paths=data.strokes.map(s=>{const weight=wbWeight(s.weight);return{d:strokePath(s.points.map((v,i)=>v*(i%2?height/data.extent.height:width/data.extent.width))),color:wbColor(s.color,u),weight,...(assistant?{dash:tokens.whiteboard.dash.dashed.map(n=>n*weight/2.5).join(' ')}:{})};});
    if(u.layout.platform!=='web')return <Pressable onPress={onSelect} style={{height:'100%',borderWidth:1,borderStyle:'dashed',borderColor:u.c.foregroundMuted}}><Txt kind="small">{label}; shown in the web app</Txt></Pressable>;
    return <>{assistant&&<View pointerEvents="none" style={{position:'absolute',left:0,bottom:'100%',marginBottom:2,paddingHorizontal:4,borderRadius:4,backgroundColor:u.c.surface1,borderWidth:1,borderColor:u.c.border}}><Txt kind="label" muted numberOfLines={1}>Agent</Txt></View>}<FadingVectors id={block.id} fading={fading} width={width} height={height} paths={paths} label={label} scale={scale} onPress={press} onHover={onHover}/></>;
  }
  const parsed=wbShapeDataSchema.safeParse(block.data);if(!parsed.success)return <Txt kind="small">Invalid shape</Txt>;const data=parsed.data,look=boundShapeLook(block,data,u),color=look.stroke,weight=look.weight,fill=look.fill;
  const dash=data.stroke==='solid'?undefined:tokens.whiteboard.dash[data.stroke].map(n=>n*weight/2.5).join(' ');
  paths=[{d:shapePath(data,width,height,look.radius),color,weight,fill,dash,area:selected&&data.shape!=='line'},{d:arrowPath(data,width,height,weight),color,weight,hit:false}];
  let visual:React.ReactNode;
  if(u.layout.platform==='web')visual=<WebVectors width={width} height={height} paths={paths} label={label} scale={scale} onPress={press} onHover={onHover}/>;
  else if(['rect','rounded','ellipse','diamond'].includes(data.shape))visual=<Pressable onPress={onSelect} style={{width:'100%',height:'100%',borderWidth:weight,borderColor:color,borderStyle:data.stroke==='solid'?'solid':'dashed',borderRadius:data.shape==='ellipse'?Math.max(width,height):look.radius??(data.shape==='rounded'?16:0),backgroundColor:fill==='none'?'transparent':fill,transform:data.shape==='diamond'?[{rotate:'45deg'},{scale:.707}]:undefined}}/>;
  else if(data.shape==='line'){const [a,b]=lineEnds(data,width,height);visual=<Pressable onPress={onSelect} style={{width:'100%',height:'100%',justifyContent:'center'}}><View style={{position:'absolute',left:a.x,top:a.y,width:Math.hypot(b.x-a.x,b.y-a.y),height:weight,backgroundColor:color,transformOrigin:'top left',transform:[{rotate:`${Math.atan2(b.y-a.y,b.x-a.x)*180/Math.PI}deg`}]}}/></Pressable>;}
  else visual=<Pressable onPress={onSelect} style={{height:'100%',borderWidth:1,borderStyle:'dashed',borderColor:color}}><Txt kind="small">{label}; shown in the web app</Txt></Pressable>;
  return <View pointerEvents="box-none" style={{width:'100%',height:'100%'}}>{visual}{!!look.label&&!editing&&data.shape!=='line'&&<View pointerEvents="box-none" style={{position:'absolute',left:look.padding,right:look.padding,top:0,bottom:0,alignItems:'center',justifyContent:'center',overflow:'hidden'}}><Pressable onPress={onSelect} style={[inheritCursor,noSelect]}><Txt selectable={false} style={{...noSelect,fontSize:look.fontSize,lineHeight:look.lineHeight,fontWeight:'500',textAlign:'center',color:look.text}}>{look.label}</Txt></Pressable></View>}</View>;
}
const never = () => () => {};
/** A drawing's strokes; those the eraser is over fade, and only this drawing redraws as the set grows. */
function FadingVectors({ id, fading, paths, ...props }: { id: string; fading?: FadingStore; paths: VectorPath[] } & Omit<React.ComponentProps<typeof WebVectors>, 'paths'>) {
  const faded = useSyncExternalStore(fading?.subscribe ?? never, () => fading?.of(id), () => undefined);
  return <WebVectors {...props} paths={faded ? paths.map((p, i) => faded.has(i) ? { ...p, opacity: tokens.whiteboard.draw.eraserFade } : p) : paths} />;
}
/**
 * The content of a whiteboard box drawn at the box's live size. While a handle is held (and while the box springs to
 * its saved size) the box's Animated width and height move ahead of the stored size; the drawing follows them so
 * its fill, stroke and label fill the box at every frame instead of staying fitted at the old proportions.
 */
export function LiveWhiteboardContent({ w, h, width, height, ...props }: WhiteboardContentProps & { w: Animated.Value; h: Animated.Value }) {
  const [live, setLive] = useState<{ width: number; height: number } | null>(null);
  useEffect(() => {
    let lw = width, lh = height;
    const update = () => setLive(old => Math.abs(lw - width) <= .5 && Math.abs(lh - height) <= .5 ? null : old && old.width === lw && old.height === lh ? old : { width: lw, height: lh });
    const a = w.addListener(({ value }) => { lw = value; update(); }), b = h.addListener(({ value }) => { lh = value; update(); });
    setLive(null);
    return () => { w.removeListener(a); h.removeListener(b); };
  }, [w, h, width, height]);
  return <WhiteboardContent {...props} width={live?.width ?? width} height={live?.height ?? height} />;
}
