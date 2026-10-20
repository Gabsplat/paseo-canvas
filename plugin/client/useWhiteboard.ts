import { useEffect, useRef, useState } from 'react';
import type { CanvasBlock, CanvasOperation } from '../shared/model';
import { fitStrokes, isWhiteboardRenderer, layerFits, simplifyStroke, wbDrawDataSchema, wbShapeDataSchema, wbSvgDataSchema, wbTextDataSchema, withoutStrokes, WB_LAYER_LIMIT_MESSAGE, WB_LIMITS } from '../shared/whiteboard';
import { newId } from './logic';
import { dropTarget, type Point, type Rect, type CanvasLayout } from './logic';
import type { CanvasController } from './useCanvas';
import { DEFAULT_TOOL_STYLE, type CanvasTool, type SvgInsertOptions, type ToolStyle } from './whiteboard-tools';
import type { CanvasPointer } from './web';
import { appendPreviewPoint, erasedStrokes } from './whiteboard-geometry';
export type WbPreview = { block: CanvasBlock; rect: Rect } | null;
export class WhiteboardPreviewStore {
  current: WbPreview = null; listeners = new Set<() => void>();
  subscribe = (listener:()=>void) => { this.listeners.add(listener);return()=>{this.listeners.delete(listener);}; };
  snapshot = () => this.current;
  set(value:WbPreview) {this.current=value;this.listeners.forEach(fn=>fn());}
}
/** Strokes the eraser has touched in the gesture under way, per drawing: they fade until the release removes them. */
export class FadingStore {
  current:ReadonlyMap<string,ReadonlySet<number>>=new Map(); listeners=new Set<()=>void>();
  subscribe=(listener:()=>void)=>{this.listeners.add(listener);return()=>{this.listeners.delete(listener);};};
  of=(id:string)=>this.current.get(id);
  set(value:ReadonlyMap<string,ReadonlySet<number>>){if(value===this.current||!value.size&&!this.current.size)return;this.current=value;this.listeners.forEach(fn=>fn());}
}
export type TextSession = { documentId:string; blockId?:string; block:CanvasBlock; kind:'wb-text'|'wb-shape'; at:Point; width:number; height:number; value:string };
type Environment = { controller:CanvasController; layout:CanvasLayout; world(p:CanvasPointer):Point; center():Point; scale():number; tool():CanvasTool; choose(tool:CanvasTool):void; style():ToolStyle; locked():boolean; pan(dx:number,dy:number):void; onSvg?():void };
type Gesture = { documentId:string; tool:CanvasTool; start:Point; last:Point; page:CanvasPointer; parent:string|null; anchor:string|null; points:number[]; style:ToolStyle; erased:Map<string,Set<number>> };
export function useWhiteboard(environment:Environment) {
  const env=useRef(environment);env.current=environment;
  const gesture=useRef<Gesture|null>(null), store=useRef(new WhiteboardPreviewStore()).current, fading=useRef(new FadingStore()).current;
  const [editor,setEditor]=useState<TextSession|null>(null),[editorError,setEditorError]=useState(''),[saving,setSaving]=useState(false);
  const documentId=environment.controller.view?.document.id;
  function cancel(){gesture.current=null;store.set(null);fading.set(new Map());setEditor(null);setEditorError('');}
  useEffect(()=>{cancel();},[documentId]);
  // Changing tool ends any stroke in progress. Strokes are stored as wb-draw blocks: the agent reads them like any block.
  useEffect(()=>{gesture.current=null;store.set(null);fading.set(new Map());},[environment.tool()]);
  const context=()=>{const e=env.current,c=e.controller,doc=c.view?.document;return {e,c,doc};};
  const parentPoint=(point:Point,parent:string|null)=>{const r=parent?env.current.layout.rects.get(parent):null;return{x:point.x-(r?.x??0),y:point.y-(r?.y??0)};};
  function afterCreate(id:string){const {e,c}=context();void c.select([id]);if(!e.locked()&&!['draw','eraser'].includes(e.tool()))e.choose('select');}
  function edit(id?:string, initial?:string) {
    const {e,c,doc}=context();if(!doc||c.offline||c.busy)return;const block=doc.blocks.find(b=>b.id===(id??c.selection[0]));if(!block)return;
    const renderer=c.catalog?.blockTypes.find(t=>t.id===block.typeId)?.renderer;if(renderer!=='wb-text'&&renderer!=='wb-shape')return;
    const r=e.layout.rects.get(block.id);if(!r)return;
    setEditorError('');setEditor({documentId:doc.id,blockId:block.id,block,kind:renderer,at:{x:r.x,y:r.y},width:r.width,height:r.height,value:initial??String(block.data.text??'')});
  }
  async function saveText(value:string):Promise<boolean>{
    if(!editor||saving)return false;const session=editor,{c,doc}=context();if(!doc||doc.id!==session.documentId||c.offline||c.busy)return false;
    const data={...session.block.data,text:value};let operations:CanvasOperation[];
    if(session.kind==='wb-text'&&!value.trim())operations=session.blockId?[{type:'block.delete',id:session.blockId}]:[];
    else if(session.blockId)operations=value===String(session.block.data.text??'')?[]:[{type:'block.update',id:session.blockId,patch:{data:{text:value}}}];
    else operations=[{type:'block.create',block:{...session.block,data:wbTextDataSchema.parse(data)}}];
    if(!operations.length){setEditor(null);if(!session.blockId)env.current.choose('select');return true;}
    setSaving(true);setEditorError('');try{const result=await c.edit(operations,session.kind==='wb-text'&&!value.trim()?'Delete text':session.blockId?'Edit text':'Create text');if(!result){setEditorError('Not saved. Try again or cancel the edit.');return false;}if(env.current.controller.view?.document.id===session.documentId){setEditor(null);if(!session.blockId)afterCreate(session.block.id);}return true;}catch{setEditorError('Not saved. Try again or cancel the edit.');return false;}finally{setSaving(false);}
  }
  async function insertSvg(svg:string,options:SvgInsertOptions={}):Promise<boolean>{
    const {e,c,doc}=context();if(!doc||c.busy||c.offline)return false;
    try{const data=wbSvgDataSchema.parse({svg,color:e.style().color,caption:options.caption??'',...(options.source?{source:options.source}:{}),...(options.license?{license:options.license}:{})});
      const selectedGroup=c.selection.length===1?doc.groups.find(g=>g.id===c.selection[0]&&!g.collapsed):null;
      const pointerAt=options.atPage?e.world({...options.atPage,pointerId:0,shift:false,command:false}):undefined;
      const parent=pointerAt?dropTarget(doc,e.layout,[],pointerAt,null,0):options.parentGroupId!==undefined?options.parentGroupId:selectedGroup?.id??null;
      const group=parent?e.layout.rects.get(parent):null,at=pointerAt??options.at??(group?{x:group.x+group.width/2,y:group.y+group.height/2}:e.center());
      const ratio=data.viewBox[2]/data.viewBox[3],size={width:Math.max(24,ratio>=1?96:96*ratio),height:Math.max(24,ratio>=1?96/ratio:96)};
      const block:CanvasBlock={id:newId('svg'),typeId:'wb-svg',title:'',data,position:parentPoint({x:at.x-size.width/2,y:at.y-size.height/2},parent),parentGroupId:parent,size};
      const next=await c.edit([{type:'block.create',block}],'Insertar SVG');if(!next)return false;if(env.current.controller.view?.document.id===doc.id)afterCreate(block.id);return true;
    }catch(error){c.fail(error);return false;}
  }
  function box(g:Gesture,at:Point,shift=false):{position:Point;size:{width:number;height:number};from:'nw'|'ne'|'sw'|'se'}{
    let dx=at.x-g.start.x,dy=at.y-g.start.y;
    if(shift&&g.style.shape==='line'){const angle=Math.round(Math.atan2(dy,dx)/(Math.PI/12))*Math.PI/12,length=Math.hypot(dx,dy);dx=Math.cos(angle)*length;dy=Math.sin(angle)*length;}
    else if(shift){const side=Math.max(Math.abs(dx),Math.abs(dy));dx=Math.sign(dx||1)*side;dy=Math.sign(dy||1)*side;}
    const click=Math.hypot(dx,dy)<4/env.current.scale(),min=g.style.shape==='line'?8:24;
    return{position:click?{x:g.start.x-80,y:g.start.y-52}:{x:g.start.x+Math.min(0,dx),y:g.start.y+Math.min(0,dy)},size:click?{width:160,height:104}:{width:Math.min(4096,Math.max(min,Math.abs(dx))),height:Math.min(4096,Math.max(min,Math.abs(dy)))},from:`${dy<0?'s':'n'}${dx<0?'e':'w'}` as 'nw'|'ne'|'sw'|'se'};
  }
  function erase(g:Gesture,at:Point){const {e,doc,c}=context();let changed=false;for(const b of doc?.blocks??[]){if(c.catalog?.blockTypes.find(t=>t.id===b.typeId)?.renderer!=='wb-draw')continue;const r=e.layout.rects.get(b.id);if(!r||r.hidden)continue;const parsed=wbDrawDataSchema.safeParse(b.data);if(!parsed.success)continue;const hit=erasedStrokes(parsed.data,{x:at.x-r.x,y:at.y-r.y},r,10/e.scale(),{x:g.last.x-r.x,y:g.last.y-r.y});const known=g.erased.get(b.id);if(hit.some(i=>!known?.has(i))){g.erased.set(b.id,new Set([...known??[],...hit]));changed=true;}}if(changed)fading.set(new Map(g.erased));}
  function preview(g:Gesture,p:CanvasPointer){
    const at=env.current.world(p);if(g.tool==='shape'){const b=box(g,at,p.shift),data=wbShapeDataSchema.parse({shape:g.style.shape,color:g.style.color,fill:g.style.fill,...(g.style.fillColor&&g.style.shape!=='line'?{fillColor:g.style.fillColor}:{}),stroke:g.style.stroke,weight:g.style.scale,text:'',...(g.style.shape==='line'?{from:b.from,heads:g.style.heads}:{})});store.set({block:{id:'preview',typeId:'wb-shape',title:'',data,size:b.size},rect:{...b.position,...b.size,depth:0,hidden:false}});}
    else if(g.tool==='draw'){const xs=g.points.filter((_,i)=>i%2===0),ys=g.points.filter((_,i)=>i%2===1),x=Math.min(...xs),y=Math.min(...ys),width=Math.max(8,Math.max(...xs)-x),height=Math.max(8,Math.max(...ys)-y);if(width<=4096&&height<=4096)store.set({block:{id:'preview',typeId:'wb-draw',title:'',data:{extent:{width,height},strokes:[{points:g.points.map((v,i)=>v-(i%2?y:x)),color:g.style.color,weight:g.style.scale}]}},rect:{x,y,width,height,depth:0,hidden:false}});}
  }
  function begin(p:CanvasPointer):boolean{
    const {e,c,doc}=context(),tool=e.tool();if(!doc||tool==='select'||tool==='svg'||editor)return false;if(tool!=='hand'&&(c.offline||c.busy&&tool!=='draw'))return false;
    const start=e.world(p),parent=dropTarget(doc,e.layout,[],start,null,0);
    // A stroke that starts on a card annotates that card and will follow it.
    const card=tool==='draw'?[...doc.blocks].reverse().find(b=>{if((b.parentGroupId??null)!==parent||isWhiteboardRenderer(c.catalog?.blockTypes.find(t=>t.id===b.typeId)?.renderer))return false;const r=e.layout.rects.get(b.id);return !!r&&!r.hidden&&start.x>=r.x&&start.x<=r.x+r.width&&start.y>=r.y&&start.y<=r.y+r.height;}):undefined;
    gesture.current={documentId:doc.id,tool,start,last:start,page:p,parent,anchor:card?.id??null,points:[start.x,start.y,start.x,start.y],style:{...e.style()},erased:new Map()};if(tool==='eraser')erase(gesture.current,start);if(tool==='shape'||tool==='draw')preview(gesture.current,p);return true;
  }
  function move(p:CanvasPointer){const g=gesture.current;if(!g)return;const {e,c,doc}=context();if(doc?.id!==g.documentId||g.tool!=='hand'&&(c.offline||c.busy&&g.tool!=='draw')){cancel();return;}const at=e.world(p);if(g.tool==='hand')e.pan(p.x-g.page.x,p.y-g.page.y);else if(g.tool==='draw'){appendPreviewPoint(g.points,at,WB_LIMITS.inputPointsPerStroke);preview(g,p);}else if(g.tool==='shape')preview(g,p);else if(g.tool==='eraser')erase(g,at);g.last=at;g.page=p;}
  async function finish(p:CanvasPointer,cancelled:boolean){const g=gesture.current;gesture.current=null;store.set(null);if(cancelled)fading.set(new Map());if(!g||cancelled||g.tool==='hand')return;const {e,c,doc}=context();if(!doc||doc.id!==g.documentId||c.offline||c.busy&&g.tool!=='draw')return;const at=e.world(p);let operations:CanvasOperation[]=[],id='';
    try{
      if(g.tool==='text'){const width=Math.abs(at.x-g.start.x)>=24?Math.min(4096,Math.abs(at.x-g.start.x)):undefined,position={x:Math.min(at.x,g.start.x),y:Math.min(at.y,g.start.y)},block:CanvasBlock={id:newId('text'),typeId:'wb-text',title:'',position:parentPoint(position,g.parent),parentGroupId:g.parent,data:wbTextDataSchema.parse({text:'',color:g.style.color,scale:g.style.scale,font:g.style.font,align:g.style.align,...(width?{width}:{})})};setEditor({documentId:doc.id,block,kind:'wb-text',at:position,width:width??240,height:52,value:''});return;}
      if(g.tool==='shape'){const b=box(g,at,p.shift);id=newId('shape');operations=[{type:'block.create',block:{id,typeId:'wb-shape',title:'',parentGroupId:g.parent,position:parentPoint(b.position,g.parent),size:b.size,data:wbShapeDataSchema.parse({shape:g.style.shape,color:g.style.color,weight:g.style.scale,fill:g.style.fill,...(g.style.fillColor&&g.style.shape!=='line'?{fillColor:g.style.fillColor}:{}),stroke:g.style.stroke,text:'',...(g.style.shape==='line'?{from:b.from,heads:g.style.heads}:{})})}}];}
      else if(g.tool==='draw'){
        appendPreviewPoint(g.points,at,WB_LIMITS.inputPointsPerStroke);const origin=e.layout.rects.get(g.anchor??g.parent??''),points=simplifyStroke(g.points).map((v,i)=>v-(origin?(i%2?origin.y:origin.x):0));
        // Every stroke is its own drawing: it selects, moves and erases on its own. One transaction, one undo step.
        const next=fitStrokes([{points,color:g.style.color,weight:g.style.scale}],{author:'learner',...(g.anchor?{anchor:g.anchor}:{})});
        if(!layerFits(doc,next))throw new Error(WB_LAYER_LIMIT_MESSAGE);
        id=newId('draw');operations=[{type:'block.create',block:{id,typeId:'wb-draw',title:'',parentGroupId:g.parent,...next}}];
      }else if(g.tool==='eraser'){erase(g,at);fading.set(new Map());operations=eraseOperations(doc.blocks,g.erased);}
      if(!operations.length)return;const result=await c.edit(operations,g.tool==='draw'?'Draw stroke':g.tool==='eraser'?'Erase strokes':'Create shape');if(!result)return;
      if(env.current.controller.view?.document.id!==doc.id)return;if(id&&g.tool!=='draw')afterCreate(id);
    }catch(error){c.fail(g.tool==='draw'?new Error(WB_LAYER_LIMIT_MESSAGE):error);}
  }
  return {store,fading,editor,editorError,saving,cancel,edit,saveText,insertSvg,begin,move,finish};
}
/**
 * What an eraser gesture removes, as one transaction: a drawing that loses every stroke is deleted; one that keeps some
 * (an agent's illustration, an older multi-stroke drawing) is refitted around what is left, so it stays where it was.
 */
export function eraseOperations(blocks:readonly CanvasBlock[],erased:ReadonlyMap<string,ReadonlySet<number>>):CanvasOperation[]{
  return [...erased].flatMap(([id,removed]):CanvasOperation[]=>{
    const b=blocks.find(b=>b.id===id),parsed=b?.position&&b.size?wbDrawDataSchema.safeParse(b.data):undefined;if(!b||!removed.size||!parsed?.success)return[];
    const left=withoutStrokes({position:b.position!,size:b.size!,data:parsed.data},removed);
    return [left?{type:'block.update',id,patch:{position:left.position,size:left.size,data:{extent:left.data.extent,strokes:left.data.strokes}}}:{type:'block.delete',id}];
  });
}
