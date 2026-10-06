import { useEffect, useRef, useState } from 'react';
import type { CanvasBlock, CanvasOperation } from '../shared/model';
import { appendStroke, isWhiteboardRenderer, simplifyStroke, wbDrawDataSchema, wbShapeDataSchema, wbSvgDataSchema, wbTextDataSchema, WB_LIMITS, type WbDrawing } from '../shared/whiteboard';
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
export type TextSession = { documentId:string; blockId?:string; block:CanvasBlock; kind:'wb-text'|'wb-shape'; at:Point; width:number; height:number; value:string };
type Environment = { controller:CanvasController; layout:CanvasLayout; world(p:CanvasPointer):Point; center():Point; scale():number; tool():CanvasTool; choose(tool:CanvasTool):void; style():ToolStyle; locked():boolean; pan(dx:number,dy:number):void; onSvg?():void };
type Gesture = { documentId:string; tool:CanvasTool; start:Point; last:Point; page:CanvasPointer; parent:string|null; points:number[]; style:ToolStyle; erased:Map<string,Set<number>> };
export function useWhiteboard(environment:Environment) {
  const env=useRef(environment);env.current=environment;
  const gesture=useRef<Gesture|null>(null), drawing=useRef<{id:string;parent:string|null;documentId:string}|null>(null), store=useRef(new WhiteboardPreviewStore()).current;
  const [editor,setEditor]=useState<TextSession|null>(null),[editorError,setEditorError]=useState(''),[saving,setSaving]=useState(false);
  const documentId=environment.controller.view?.document.id;
  function cancel(){gesture.current=null;store.set(null);setEditor(null);setEditorError('');}
  useEffect(()=>{cancel();drawing.current=null;},[documentId]);
  useEffect(()=>{drawing.current=null;gesture.current=null;store.set(null);},[environment.tool()]);
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
    setSaving(true);setEditorError('');try{const result=await c.edit(operations,session.kind==='wb-text'&&!value.trim()?'Eliminar texto':session.blockId?'Editar texto':'Crear texto');if(!result){setEditorError('No se guardó. Reintentá o cancelá la edición.');return false;}if(env.current.controller.view?.document.id===session.documentId){setEditor(null);if(!session.blockId)afterCreate(session.block.id);}return true;}catch{setEditorError('No se guardó. Reintentá o cancelá la edición.');return false;}finally{setSaving(false);}
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
  function erase(g:Gesture,at:Point){const {e,doc,c}=context();for(const b of doc?.blocks??[]){if(c.catalog?.blockTypes.find(t=>t.id===b.typeId)?.renderer!=='wb-draw')continue;const r=e.layout.rects.get(b.id);if(!r||r.hidden)continue;const parsed=wbDrawDataSchema.safeParse(b.data);if(!parsed.success)continue;const hit=erasedStrokes(parsed.data,{x:at.x-r.x,y:at.y-r.y},r,10/e.scale(),{x:g.last.x-r.x,y:g.last.y-r.y});if(hit.length){const set=g.erased.get(b.id)??new Set<number>();hit.forEach(i=>set.add(i));g.erased.set(b.id,set);}}}
  function preview(g:Gesture,p:CanvasPointer){
    const at=env.current.world(p);if(g.tool==='shape'){const b=box(g,at,p.shift),data=wbShapeDataSchema.parse({shape:g.style.shape,color:g.style.color,fill:g.style.fill,stroke:g.style.stroke,weight:g.style.scale,text:'',...(g.style.shape==='line'?{from:b.from,heads:g.style.heads}:{})});store.set({block:{id:'preview',typeId:'wb-shape',title:'',data,size:b.size},rect:{...b.position,...b.size,depth:0,hidden:false}});}
    else if(g.tool==='draw'){const xs=g.points.filter((_,i)=>i%2===0),ys=g.points.filter((_,i)=>i%2===1),x=Math.min(...xs),y=Math.min(...ys),width=Math.max(8,Math.max(...xs)-x),height=Math.max(8,Math.max(...ys)-y);if(width<=4096&&height<=4096)store.set({block:{id:'preview',typeId:'wb-draw',title:'',data:{extent:{width,height},strokes:[{points:g.points.map((v,i)=>v-(i%2?y:x)),color:g.style.color,weight:g.style.scale}]}},rect:{x,y,width,height,depth:0,hidden:false}});}
  }
  function begin(p:CanvasPointer):boolean{
    const {e,c,doc}=context(),tool=e.tool();if(!doc||tool==='select'||tool==='svg'||editor)return false;if(tool!=='hand'&&(c.offline||c.busy))return false;
    const start=e.world(p),parent=dropTarget(doc,e.layout,[],start,null,0);
    gesture.current={documentId:doc.id,tool,start,last:start,page:p,parent,points:[start.x,start.y,start.x,start.y],style:{...e.style()},erased:new Map()};if(tool==='eraser')erase(gesture.current,start);if(tool==='shape'||tool==='draw')preview(gesture.current,p);return true;
  }
  function move(p:CanvasPointer){const g=gesture.current;if(!g)return;const {e,c,doc}=context();if(doc?.id!==g.documentId||g.tool!=='hand'&&(c.busy||c.offline)){cancel();return;}const at=e.world(p);if(g.tool==='hand')e.pan(p.x-g.page.x,p.y-g.page.y);else if(g.tool==='draw'){appendPreviewPoint(g.points,at,WB_LIMITS.inputPointsPerStroke);preview(g,p);}else if(g.tool==='shape')preview(g,p);else if(g.tool==='eraser')erase(g,at);g.last=at;g.page=p;}
  async function finish(p:CanvasPointer,cancelled:boolean){const g=gesture.current;gesture.current=null;store.set(null);if(!g||cancelled||g.tool==='hand')return;const {e,c,doc}=context();if(!doc||doc.id!==g.documentId||c.offline||c.busy)return;const at=e.world(p);let operations:CanvasOperation[]=[],id='';
    try{
      if(g.tool==='text'){const width=Math.abs(at.x-g.start.x)>=24?Math.min(4096,Math.abs(at.x-g.start.x)):undefined,position={x:Math.min(at.x,g.start.x),y:Math.min(at.y,g.start.y)},block:CanvasBlock={id:newId('text'),typeId:'wb-text',title:'',position:parentPoint(position,g.parent),parentGroupId:g.parent,data:wbTextDataSchema.parse({text:'',color:g.style.color,scale:g.style.scale,font:g.style.font,align:g.style.align,...(width?{width}:{})})};setEditor({documentId:doc.id,block,kind:'wb-text',at:position,width:width??240,height:52,value:''});return;}
      if(g.tool==='shape'){const b=box(g,at,p.shift);id=newId('shape');operations=[{type:'block.create',block:{id,typeId:'wb-shape',title:'',parentGroupId:g.parent,position:parentPoint(b.position,g.parent),size:b.size,data:wbShapeDataSchema.parse({shape:g.style.shape,color:g.style.color,weight:g.style.scale,fill:g.style.fill,stroke:g.style.stroke,text:'',...(g.style.shape==='line'?{from:b.from,heads:g.style.heads}:{})})}}];}
      else if(g.tool==='draw'){
        appendPreviewPoint(g.points,at,WB_LIMITS.inputPointsPerStroke);const points=simplifyStroke(g.points).map((v,i)=>v-(g.parent?(i%2?e.layout.rects.get(g.parent)?.y??0:e.layout.rects.get(g.parent)?.x??0):0));
        const session=drawing.current,old=session?.parent===g.parent&&session.documentId===doc.id?doc.blocks.find(b=>b.id===session.id):undefined;let next:WbDrawing;
        if(old&&old.size&&old.position){try{next=appendStroke({position:old.position,size:old.size,data:wbDrawDataSchema.parse(old.data)},points,{color:g.style.color,weight:g.style.scale});id=old.id;}catch{next=newDrawing(points,g.style);}}
        else next=newDrawing(points,g.style);
        if(!id)id=newId('draw');operations=old?.id===id?[{type:'block.update',id,patch:next}]:[{type:'block.create',block:{id,typeId:'wb-draw',title:'',parentGroupId:g.parent,...next}}];
      }else if(g.tool==='eraser'){erase(g,at);for(const [blockId,removed]of g.erased){const b=doc.blocks.find(b=>b.id===blockId);if(!b)continue;const data=wbDrawDataSchema.parse(b.data),strokes=data.strokes.filter((_,i)=>!removed.has(i));operations.push(strokes.length?{type:'block.update',id:blockId,patch:{data:{strokes}}}:{type:'block.delete',id:blockId});}}
      if(!operations.length)return;const result=await c.edit(operations,g.tool==='draw'?'Dibujar trazo':g.tool==='eraser'?'Borrar trazos':'Crear forma');if(!result)return;
      if(env.current.controller.view?.document.id!==doc.id)return;if(g.tool==='draw')drawing.current={id,parent:g.parent,documentId:doc.id};if(id)afterCreate(id);
    }catch(error){c.fail(error);}
  }
  return {store,editor,editorError,saving,cancel,edit,saveText,insertSvg,begin,move,finish};
}
function newDrawing(points:number[],style:ToolStyle):WbDrawing{
  const xs=points.filter((_,i)=>i%2===0),ys=points.filter((_,i)=>i%2===1),x=Math.floor(Math.min(...xs)*2)/2,y=Math.floor(Math.min(...ys)*2)/2,width=Math.max(8,Math.ceil((Math.max(...xs)-x)*2)/2),height=Math.max(8,Math.ceil((Math.max(...ys)-y)*2)/2);
  return{position:{x,y},size:{width,height},data:wbDrawDataSchema.parse({extent:{width,height},strokes:[{points:points.map((v,i)=>v-(i%2?y:x)),color:style.color,weight:style.scale}]})};
}
