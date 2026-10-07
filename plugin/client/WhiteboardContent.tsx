import React from 'react';
import { Icon } from '@getpaseo/plugin/client/react-native';
import { Pressable, View, type GestureResponderEvent } from 'react-native';
import type { CanvasBlock } from '../shared/model';
import { wbTextDataSchema, wbShapeDataSchema, wbSvgDataSchema, wbDrawDataSchema, type WbRenderer } from '../shared/whiteboard';
import { Txt, useUI } from './ui';
import { WebSvg, WebVectors, type CanvasPointer, type VectorPath } from './web';
import { shapePath, strokePath, arrowPath, lineEnds } from './whiteboard-geometry';
import { wbColor, wbWeight, wbFont, shapeLook } from './whiteboard-visuals';
import { tokens } from './tokens';
/** Whiteboard content takes the cursor of the tool in hand from the canvas, not a button's pointer. */
const inheritCursor = { cursor: 'inherit' } as object;
export function whiteboardLabel(block: CanvasBlock, kind: WbRenderer): string {
  if (block.title) return block.title;
  if (kind === 'wb-text') return String(block.data.text || 'Texto libre');
  if (kind === 'wb-svg') return String(block.data.caption || 'Imagen SVG');
  if (kind === 'wb-draw') return `Dibujo${block.data.author === 'assistant' ? ' del asistente' : block.data.author === 'learner' ? ' propio' : ''} (${Array.isArray(block.data.strokes) ? block.data.strokes.length : 0} trazos)`;
  return String(block.data.text || tokens.whiteboard.shapes.items.find(s => s.id === block.data.shape)?.label || 'Forma');
}
export type WhiteboardContentProps = { block: CanvasBlock; kind: WbRenderer; width: number; height: number; scale?: number; outline?: boolean; editing?: boolean; onSelect(event?: GestureResponderEvent): void; onHover?(inside: boolean): void; onMeasure?(height: number): void };
export function WhiteboardContent({ block, kind, width, height, scale = 1, outline, editing, onSelect, onHover, onMeasure }: WhiteboardContentProps) {
  const u = useUI(), label = whiteboardLabel(block,kind);
  const press = (p?: CanvasPointer) => onSelect(p ? { nativeEvent: {shiftKey:p.shift,metaKey:p.command},stopPropagation(){} } as unknown as GestureResponderEvent : undefined);
  if (outline) return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onSelect} style={{minHeight:36,flexDirection:'row',alignItems:'center',gap:8}}><Icon name={tokens.whiteboard.types[kind].icon} size={16} color={u.c.foregroundMuted}/><Txt numberOfLines={1}>{label}</Txt></Pressable>;
  if (kind === 'wb-text') {
    const parsed = wbTextDataSchema.safeParse(block.data); if (!parsed.success) return <Txt kind="small">Texto no válido</Txt>;
    const data=parsed.data, t=tokens.whiteboard.text[data.scale];
    return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onSelect} onHoverIn={()=>onHover?.(true)} onHoverOut={()=>onHover?.(false)} style={{width:'100%',...inheritCursor}}><Txt onLayout={e=>onMeasure?.(e.nativeEvent.layout.height)} style={{fontFamily:wbFont(data.font),fontSize:t.fontSize+(data.font==='mono'?-1:0),lineHeight:t.lineHeight,fontWeight:'400',color:wbColor(data.color,u),textAlign:data.align}}>{data.text}</Txt></Pressable>;
  }
  if (kind === 'wb-svg') {
    const parsed=wbSvgDataSchema.safeParse(block.data);if(!parsed.success)return <Txt kind="small">SVG no válido</Txt>;const data=parsed.data;
    return <Pressable accessibilityRole="button" accessibilityLabel={label} onPress={onSelect} onHoverIn={()=>onHover?.(true)} onHoverOut={()=>onHover?.(false)} style={{width:'100%',height:'100%',...inheritCursor}}>{u.layout.platform==='web'?<WebSvg svg={data.svg} color={wbColor(data.color,u)} label={label}/>:<View style={{flex:1,borderStyle:'dashed',borderWidth:1,borderColor:u.c.foregroundMuted,justifyContent:'center'}}><Txt kind="small">{label}. Imagen SVG; se ve en la versión web</Txt></View>}{!!data.caption&&<View pointerEvents="none" style={{position:'absolute',top:'100%',left:0,right:0,paddingTop:4}}><Txt kind="small" muted numberOfLines={1} style={{textAlign:'center'}}>{data.caption}</Txt></View>}</Pressable>;
  }
  let paths: VectorPath[]=[];
  if (kind === 'wb-draw') {
    const parsed=wbDrawDataSchema.safeParse(block.data);if(!parsed.success)return <Txt kind="small">Dibujo no válido</Txt>;const data=parsed.data;
    // Authorship is drawn, not only stored: the assistant's strokes are dashed and carry its name.
    const assistant=data.author==='assistant';
    paths=data.strokes.map(s=>{const weight=wbWeight(s.weight);return{d:strokePath(s.points.map((v,i)=>v*(i%2?height/data.extent.height:width/data.extent.width))),color:wbColor(s.color,u),weight,...(assistant?{dash:tokens.whiteboard.dash.dashed.map(n=>n*weight/2.5).join(' ')}:{})};});
    if(u.layout.platform!=='web')return <Pressable onPress={onSelect} style={{height:'100%',borderWidth:1,borderStyle:'dashed',borderColor:u.c.foregroundMuted}}><Txt kind="small">{label}; se ve en la versión web</Txt></Pressable>;
    return <>{assistant&&<View pointerEvents="none" style={{position:'absolute',left:0,bottom:'100%',marginBottom:2,paddingHorizontal:4,borderRadius:4,backgroundColor:u.c.surface1,borderWidth:1,borderColor:u.c.border}}><Txt kind="label" muted numberOfLines={1}>Asistente</Txt></View>}<WebVectors width={width} height={height} paths={paths} label={label} scale={scale} onPress={press} onHover={onHover}/></>;
  }
  const parsed=wbShapeDataSchema.safeParse(block.data);if(!parsed.success)return <Txt kind="small">Forma no válida</Txt>;const data=parsed.data,look=shapeLook(data,u),color=look.stroke,weight=look.weight,fill=look.fill;
  const dash=data.stroke==='solid'?undefined:tokens.whiteboard.dash[data.stroke].map(n=>n*weight/2.5).join(' ');
  paths=[{d:shapePath(data,width,height),color,weight,fill,dash},{d:arrowPath(data,width,height,weight),color,weight,hit:false}];
  let visual:React.ReactNode;
  if(u.layout.platform==='web')visual=<WebVectors width={width} height={height} paths={paths} label={label} scale={scale} onPress={press} onHover={onHover}/>;
  else if(['rect','rounded','ellipse','diamond'].includes(data.shape))visual=<Pressable onPress={onSelect} style={{width:'100%',height:'100%',borderWidth:weight,borderColor:color,borderStyle:data.stroke==='solid'?'solid':'dashed',borderRadius:data.shape==='ellipse'?Math.max(width,height):data.shape==='rounded'?16:0,backgroundColor:fill==='none'?'transparent':fill,transform:data.shape==='diamond'?[{rotate:'45deg'},{scale:.707}]:undefined}}/>;
  else if(data.shape==='line'){const [a,b]=lineEnds(data,width,height);visual=<Pressable onPress={onSelect} style={{width:'100%',height:'100%',justifyContent:'center'}}><View style={{position:'absolute',left:a.x,top:a.y,width:Math.hypot(b.x-a.x,b.y-a.y),height:weight,backgroundColor:color,transformOrigin:'top left',transform:[{rotate:`${Math.atan2(b.y-a.y,b.x-a.x)*180/Math.PI}deg`}]}}/></Pressable>;}
  else visual=<Pressable onPress={onSelect} style={{height:'100%',borderWidth:1,borderStyle:'dashed',borderColor:color}}><Txt kind="small">{label}; se ve en la versión web</Txt></Pressable>;
  return <View pointerEvents="box-none" style={{width:'100%',height:'100%'}}>{visual}{!!data.text&&!editing&&data.shape!=='line'&&<View pointerEvents="box-none" style={{position:'absolute',left:look.padding,right:look.padding,top:0,bottom:0,alignItems:'center',justifyContent:'center',overflow:'hidden'}}><Pressable onPress={onSelect} style={inheritCursor}><Txt style={{fontSize:look.fontSize,lineHeight:look.lineHeight,fontWeight:'500',textAlign:'center',color:look.text}}>{data.text}</Txt></Pressable></View>}</View>;
}
