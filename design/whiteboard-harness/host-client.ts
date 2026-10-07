// QA-only host transport. Uses real RPC schemas and reducer, with explicitly simulated delivery.
import { useCallback, useMemo, useState } from 'react';
import { builtinTypes, builtinTemplates, builtinPacks } from '../../plugin/shared/builtins';
import { documentViewSchema, documentSummarySchema, documentContentSchema, type CanvasDocument } from '../../plugin/shared/model';
import { reduce } from '../../plugin/server/reducer';
export type PluginHostProps = any; export type PluginWorkspacePanelProps = any;
const catalog = { revision: 0, blockTypes: builtinTypes, templates: builtinTemplates, packs: builtinPacks };
const communication = { instructions: '', intent: '', audience: '' };
let doc: CanvasDocument = {
 id:'qa-board',workspaceId:'qa-workspace',title:'Pizarra de prueba',description:'Datos de ejemplo para QA, sin asistente conectado.',example:true,
 revision:1,createdAt:'2026-10-06T00:00:00.000Z',updatedAt:'2026-10-06T00:00:00.000Z',selectedIds:[],communication,layout:{mode:'free'},
 blocks:[{id:'server',typeId:'node',title:'Servidor de prueba',data:{kind:'MODULE',status:'ready',summary:'Arrastrar desde esta descripción.'},position:{x:64,y:96}},
 {id:'note',typeId:'note',title:'Nota de prueba',data:{text:'Contenido para comprobar el arrastre.'},position:{x:440,y:96}}],
 groups:[{id:'frame',title:'Grupo de prueba',description:'',blockIds:[],groupIds:[],position:{x:64,y:352},layout:{mode:'free'}}],
 links:[{id:'qa-link',from:'server',to:'note',kind:'flow'}]
};
let selectionVersion=0, runtimeVersion=0, runtime={blocks:{},scopes:{}}, fail=false;
const undo:CanvasDocument[]=[], redo:CanvasDocument[]=[], log:any[]=[], errors:any[]=[], actions:any[]=[], history:any[]=[];
const snapshot=()=>structuredClone(documentViewSchema.parse({document:doc,connection:null,canUndo:!!undo.length,canRedo:!!redo.length,selectionVersion,runtimeVersion,runtime}));
// `seed` stands in for another author; `seedAgent` runs the reducer as the assistant actor. `actions` records what
// would be delivered: nothing here reaches an assistant.
(globalThis as any).__panelQA={setHistory:(entries:any[])=>{history.splice(0,history.length,...entries);},doc:()=>structuredClone(doc),log,errors,actions,runtime:()=>structuredClone(runtime),failNext:()=>{fail=true;},catalog,seed:(operations:any[])=>{doc={...reduce(doc,operations,catalog),revision:doc.revision+1};},seedAgent:(operations:any[])=>{doc={...reduce(doc,operations,catalog,'agent'),revision:doc.revision+1};},view:snapshot};
async function invoke(contract:any, raw:any) {
 const input=contract.input.parse(raw), name=contract.name;
 let output:any;
 if(name==='canvas.list'){const {id,workspaceId,title,description,example,revision,updatedAt}=doc;output={documents:[documentSummarySchema.parse({id,workspaceId,title,description,example,revision,updatedAt})]};}
 else if(name==='canvas.catalog.read') output=catalog;
 else if(name==='canvas.read') output=snapshot();
 else if(name==='canvas.watch') output={revision:doc.revision,runtimeVersion,...(input.knownRevision!==doc.revision?{view:snapshot()}:{})};
 else if(name==='canvas.agent.events') output={events:[]};
 else if(name==='canvas.selection.set'){if(input.expectedSelectionVersion!==selectionVersion)throw Error('selection version conflict');doc={...doc,selectedIds:input.ids};selectionVersion++;output=snapshot();}
 else if(name==='canvas.mutate'){
   await new Promise(r=>setTimeout(r,45));
   if(fail){fail=false;throw Error('QA simulated rejected save');}
   if(input.expectedRevision!==doc.revision)throw Error('REVISION_CONFLICT');
   const next=reduce(doc,input.operations,catalog);undo.push(structuredClone(doc));redo.length=0;
   doc={...next,revision:doc.revision+1};log.push({name,...input,simulated:true});output=snapshot();
 } else if(name==='canvas.undo'||name==='canvas.redo'){
   const src=name==='canvas.undo'?undo:redo,dest=name==='canvas.undo'?redo:undo;
   const next=src.pop();if(next){dest.push(structuredClone(doc));doc={...next,revision:doc.revision+1};}output=snapshot();
 } else if(name==='canvas.history') output={revision:doc.revision,transactions:structuredClone(history)};
 else if(name==='canvas.create'){doc={...input.content,id:'qa-new',workspaceId:'qa-workspace',revision:1,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};output=snapshot();}
 else if(name==='canvas.runtime.set'){
   const blocks:any={...runtime.blocks},scopes:any={...runtime.scopes};
   for(const entry of input.blocks){if(entry.state)blocks[entry.id]=entry.state;else delete blocks[entry.id];}
   for(const entry of input.scopes){const values:any={...(scopes[entry.id]??{})};for(const [key,value] of Object.entries(entry.values)){if(value===null)delete values[key];else values[key]=value;}scopes[entry.id]=values;}
   runtime={blocks,scopes};runtimeVersion++;output={runtime,runtimeVersion};
 }
 else if(name==='canvas.agent.action'){
   const {id:_id,workspaceId:_w,revision:_r,createdAt:_c,updatedAt:_u,...content}=doc as any;
   output={id:input.eventId,documentId:doc.id,agentId:null,workspaceId:doc.workspaceId,createdAt:new Date().toISOString(),revision:doc.revision,action:input.action,context:documentContentSchema.parse(content),status:'pending'};
   actions.push({...input.action,simulated:true});
 }
 else throw Error('QA host does not implement '+name);
 return contract.output.parse(output);
}
export function useRpc(contract:any){return useCallback((raw:any)=>invoke(contract,raw).catch(error=>{errors.push({name:contract.name,error:String(error)});throw error;}),[contract]);}
export function useAgent(){return null;}
const paseo={agents:{list:async()=>({entries:[]}),subscribe:()=>()=>{}},providers:{list:async()=>[]}};
export const usePaseo=()=>paseo;
export const openExternalUrl=async (_url:string)=>{};
export function useSettings(){
 const [values,setValues]=useState({guideSeen:true});
 return useMemo(()=>({status:'ready',values,saving:false,saveError:null,setValues,set:async(v:any)=>setValues(v),save:async(v:any)=>{setValues(v);return v;}}),[values]);
}
