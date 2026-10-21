// QA-only host transport. Uses real RPC schemas and reducer, with explicitly simulated delivery.
import { useCallback, useMemo, useState } from 'react';
import { builtinTypes } from '../../plugin/shared/builtins';
import { documentViewSchema, documentSummarySchema, type CanvasDocument } from '../../plugin/shared/model';
import { reduce } from '../../plugin/server/reducer';
export type PluginHostProps = any; export type PluginWorkspacePanelProps = any;
import { findAndReplace } from '../../tests/fixtures/find-replace';
import { SNAP_EXTENSION } from '../../plugin/shared/wiki/snap';
import { fromBase64, mediaRef, parseMediaRef, prepareImage, toBase64 } from '../../plugin/shared/media';
// Images from the computer, kept in memory by content hash as the server keeps them on disk (plugin/server/media.ts).
const media=new Map<string,string>();
const sha256=async(bytes:Uint8Array)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes as unknown as ArrayBuffer)),b=>b.toString(16).padStart(2,'0')).join('');
// Example data: one tool "made here", the contract-test extension. Nothing ships with the app.
const catalog: any = { revision: 0, blockTypes: builtinTypes, packs: [], extensions: [{ ...findAndReplace, source: 'local', granted: true }] };
const communication = { instructions: '', intent: '', audience: '' };
let doc: CanvasDocument = {
 id:'qa-board',workspaceId:'qa-workspace',title:'Pizarra de prueba',description:'Datos de ejemplo para QA, sin asistente conectado.',example:true,
 revision:1,createdAt:'2026-10-06T00:00:00.000Z',updatedAt:'2026-10-06T00:00:00.000Z',selectedIds:[],communication,layout:{mode:'free'},
 blocks:[{id:'server',typeId:'node',title:'Servidor de prueba',data:{kind:'MODULE',status:'ready',summary:'Arrastrar desde esta descripción.'},position:{x:64,y:96}},
 {id:'note',typeId:'note',title:'Nota de prueba',data:{text:'Contenido para comprobar el arrastre.'},position:{x:440,y:96}}],
 groups:[{id:'frame',title:'Grupo de prueba',description:'',blockIds:[],groupIds:[],position:{x:64,y:352},layout:{mode:'free'}}],
 links:[{id:'qa-link',from:'server',to:'note',kind:'flow'}]
};
// Other Lienzos of the QA workspace (example data), by id; reading one makes it the open document.
const others=new Map<string,CanvasDocument>();
const summaryOf=(d:CanvasDocument)=>({...documentSummarySchema.parse({id:d.id,workspaceId:d.workspaceId,title:d.title,description:d.description,example:d.example,revision:d.revision,updatedAt:d.updatedAt}),blockCount:d.blocks.length,groupCount:d.groups.filter((g:any)=>!g.sheet).length,hojaCount:d.groups.filter((g:any)=>g.sheet).length,agentId:agents.get(d.id)??null});
const agents=new Map<string,string>();
let created=0;const gone=new Set<string>();
// lienzo.storage stand-in: per document and extension, in memory (the server keeps it beside the document).
const extensionStorage=new Map<string,unknown>();
/** Makes another Lienzo the open one, as reading it in the real server would let the panel do. */
const kept=new Map<string,{selectionVersion:number;undo:CanvasDocument[];redo:CanvasDocument[]}>();
function focus(id:string){if(id===doc.id)return;const next=others.get(id);if(!next)throw Error('NOT_FOUND');kept.set(doc.id,{selectionVersion,undo:[...undo],redo:[...redo]});others.delete(next.id);others.set(doc.id,doc);doc=next;const k=kept.get(id);selectionVersion=k?.selectionVersion??0;undo.splice(0,undo.length,...(k?.undo??[]));redo.splice(0,redo.length,...(k?.redo??[]));}
let selectionVersion=0, runtimeVersion=0, runtime={blocks:{},scopes:{}}, fail=false;
const undo:CanvasDocument[]=[], redo:CanvasDocument[]=[], log:any[]=[], errors:any[]=[], actions:any[]=[], history:any[]=[];
// What the agent's last transaction changed, as the server derives it from history (stand-in: the ids the operations name).
let latestAgent:any=null,agentTx=0;
const opIds=(operations:any[])=>[...new Set(operations.map((o:any)=>o.block?.id??o.group?.id??o.link?.from??o.id).filter((id:any)=>typeof id==='string'&&[...doc.blocks,...doc.groups].some((e:any)=>e.id===id)))];
// Comments stand-in (example data): per document, a counter and threads, never a revision. The real server keeps them in state.json.
const comments=new Map<string,{version:number;threads:any[]}>();let commentSeq=0;
const commentsOf=(id:string)=>{let c=comments.get(id);if(!c){c={version:0,threads:[]};comments.set(id,c);}return c;};
const commentsView=(threadId?:string)=>({documentId:doc.id,commentsVersion:commentsOf(doc.id).version,threads:structuredClone(commentsOf(doc.id).threads),...(threadId?{threadId}:{})});
const commentThread=(anchor:any,messages:any[],status='open')=>{const now=new Date().toISOString();return {id:'qa-thread-'+(++commentSeq),anchor,status,createdAt:messages[0]?.createdAt??now,updatedAt:messages[messages.length-1]?.createdAt??now,...(status==='resolved'?{resolvedAt:now}:{}),messages:messages.map((m:any)=>({id:'qa-msg-'+(++commentSeq),createdAt:now,...m}))};};
const snapshot=()=>structuredClone(documentViewSchema.parse({document:doc,connection:null,canUndo:!!undo.length,canRedo:!!redo.length,selectionVersion,runtimeVersion,runtime,latestAgent,commentsVersion:commentsOf(doc.id).version}));
// `seed` stands in for another author; `seedAgent` runs the reducer as the assistant actor. `actions` stays empty:
// the canvas is one-way and has no RPC that sends to an agent (a call to one throws "does not implement").
// Requests an agent made with canvas_extension_open / _close (server/extension-ui.ts), as the watch hands them out.
const uiRequests:any[]=[];
(globalThis as any).__panelQA={snap:SNAP_EXTENSION,uiRequest:(r:any)=>{uiRequests.push({id:'qa-ui-'+(uiRequests.length+1),...r,seq:uiRequests.length+1});return uiRequests.length;},addDocument:(d:any,agent?:string)=>{if(agent)agents.set(d.id,agent);others.set(d.id,{workspaceId:'qa-workspace',description:'',example:false,selectedIds:[],communication,links:[],groups:[],blocks:[],revision:1,createdAt:'2026-10-01T00:00:00.000Z',updatedAt:new Date().toISOString(),...d});},documents:()=>[doc,...others.values()].map(d=>d.id),setHistory:(entries:any[])=>{history.splice(0,history.length,...entries);},doc:()=>structuredClone(doc),log,errors,actions,runtime:()=>structuredClone(runtime),failNext:()=>{fail=true;},catalog,addExtension:(extension:any,source='local')=>{catalog.extensions=[...catalog.extensions.filter((e:any)=>e.id!==extension.id),{description:'',permissions:[],...extension,source,granted:source==='local'}];catalog.revision++;},seed:(operations:any[])=>{doc={...reduce(doc,operations,catalog),revision:doc.revision+1};},seedAgent:(operations:any[])=>{doc={...reduce(doc,operations,catalog,'agent'),revision:doc.revision+1};agentTx++;latestAgent={transactionId:'qa-tx-'+agentTx,revision:doc.revision,at:new Date().toISOString(),label:'Example agent edit '+agentTx,kind:'edit',ids:opIds(operations),removed:[]};},view:snapshot,
 // A thread as the person or an agent left it: seedComment({kind:'block',id:'server'}, [{author:{kind:'person'},text:'…'}]).
 seedComment:(anchor:any,messages:any[],status='open')=>{const c=commentsOf(doc.id),t=commentThread(anchor.kind==='point'?anchor:{dx:0,dy:0,...anchor},messages,status);c.threads.push(t);c.version++;return t.id;},
 comments:()=>structuredClone(commentsOf(doc.id)),media:()=>[...media.keys()]};
async function invoke(contract:any, raw:any) {
 const input=contract.input.parse(raw), name=contract.name;
 // Every call names its Lienzo; the stand-in keeps one open at a time and swaps the rest in and out.
 if(input&&typeof input.documentId==='string'&&name!=='canvas.delete'&&input.documentId!==doc.id&&others.has(input.documentId))focus(input.documentId);
 let output:any;
 if(name==='canvas.list'){output={documents:[doc,...others.values()].filter(d=>!gone.has(d.id)).map(summaryOf)};}
 else if(name==='canvas.about') output={version:'0.1.0',dataFile:'/home/example/.paseo/canvas/state.json',host:'paseo'};
 else if(name==='canvas.delete'){if(input.documentId===doc.id){const next=[...others.values()][0];if(next){others.delete(next.id);doc=next;}else gone.add(doc.id);}else others.delete(input.documentId);output={deleted:true};}
 else if(name==='canvas.pack.validate'){const ok=input.pack&&Array.isArray(input.pack.extensions)&&input.pack.extensions.length&&!input.pack.blockTypes?.length&&!input.pack.templates?.length&&!input.pack.documents?.length;output={valid:!!ok,issues:ok?[]:['An extension file carries extensions only.']};}
 else if(name==='canvas.pack.import'){const pack=input.pack,old=catalog.packs.find((p:any)=>p.id===pack.id);if(old&&!input.replace)throw Error('VALIDATION already installed');const diff={added:pack.extensions.filter((e:any)=>!old?.extensions.some((o:any)=>o.id===e.id)).map((e:any)=>e.id),replaced:[],unchanged:pack.extensions.filter((e:any)=>old?.extensions.some((o:any)=>o.id===e.id)).map((e:any)=>e.id)};if(!input.dryRun){catalog.packs=[...catalog.packs.filter((p:any)=>p.id!==pack.id),pack];catalog.extensions=[...catalog.extensions.filter((e:any)=>e.source!==pack.id),...pack.extensions.map((e:any)=>({description:'',permissions:[],...e,source:pack.id,granted:false}))];catalog.revision++;}output={catalog,diff,committed:!input.dryRun};}
 else if(name==='canvas.catalog.read') output=catalog;
 else if(name==='canvas.catalog.mutate'){
   // Only what the extension UI needs: saving a local one, removing it, and granting an imported one.
   const a=input.action;if(a.type==='extension.put')catalog.extensions=[...catalog.extensions.filter((e:any)=>e.id!==a.extension.id),{...a.extension,source:'local',granted:true}];
   else if(a.type==='extension.remove')catalog.extensions=catalog.extensions.filter((e:any)=>e.id!==a.id);
   else if(a.type==='pack.remove'){catalog.packs=catalog.packs.filter((p:any)=>p.id!==a.id);catalog.extensions=catalog.extensions.filter((e:any)=>e.source!==a.id);}
   else if(a.type==='extension.grant')catalog.extensions=catalog.extensions.map((e:any)=>e.id===a.id?{...e,granted:a.granted}:e);
   else throw Error('QA host does not implement catalog '+a.type);
   catalog.revision++;output=catalog;
 }
 else if(name==='canvas.read'){if(input.documentId!==doc.id)throw Error('NOT_FOUND');output=snapshot();}
 else if(name==='canvas.watch'){const cv=commentsOf(doc.id).version,ui=input.knownUiSeq===undefined?[]:uiRequests.filter(r=>r.seq>input.knownUiSeq);output={revision:doc.revision,runtimeVersion,commentsVersion:cv,uiSeq:uiRequests.length,...(ui.length?{ui}:{}),...(input.knownRevision!==doc.revision||input.knownCommentsVersion!==undefined&&input.knownCommentsVersion!==cv?{view:snapshot()}:{})};}
 else if(name.startsWith('canvas.comments.')){
   const c=commentsOf(doc.id),thread=input.threadId?c.threads.find((t:any)=>t.id===input.threadId):undefined,now=new Date().toISOString();
   if(input.threadId&&!thread)throw Error('NOT_FOUND thread');
   if(name==='canvas.comments.list')output=commentsView();
   else if(name==='canvas.comments.locate'){for(const p of input.points){const t=c.threads.find((t:any)=>t.id===p.threadId);if(t&&t.anchor.kind!=='point')t.anchor.at={x:p.x,y:p.y};}output={updated:input.points.length};}
   else{await new Promise(r=>setTimeout(r,45));
     if(name==='canvas.comments.create'){const t=commentThread(input.anchor,[{author:{kind:'person'},text:input.text}]);c.threads.push(t);c.version++;output=commentsView(t.id);}
     else if(name==='canvas.comments.reply'){thread.messages.push({id:'qa-msg-'+(++commentSeq),author:{kind:'person'},text:input.text,createdAt:now});thread.updatedAt=now;thread.status='open';delete thread.resolvedAt;c.version++;output=commentsView(thread.id);}
     else if(name==='canvas.comments.resolve'||name==='canvas.comments.reopen'){thread.status=name.endsWith('resolve')?'resolved':'open';thread.updatedAt=now;c.version++;output=commentsView(thread.id);}
     else if(name==='canvas.comments.delete'){c.threads=c.threads.filter((t:any)=>t.id!==thread.id);c.version++;output=commentsView();}
     else throw Error('QA host does not implement '+name);}
 }
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
 else if(name==='canvas.create'){others.set(doc.id,doc);doc={...input.content,id:'qa-new-'+(++created),workspaceId:'qa-workspace',revision:1,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString()};output=snapshot();}
 else if(name==='canvas.runtime.set'){
   const blocks:any={...runtime.blocks},scopes:any={...runtime.scopes};
   for(const entry of input.blocks){if(entry.state)blocks[entry.id]=entry.state;else delete blocks[entry.id];}
   for(const entry of input.scopes){const values:any={...(scopes[entry.id]??{})};for(const [key,value] of Object.entries(entry.values)){if(value===null)delete values[key];else values[key]=value;}scopes[entry.id]=values;}
   runtime={blocks,scopes};runtimeVersion++;output={runtime,runtimeVersion};
 }
 else if(name==='canvas.extension.storage'){const key=doc.id+'\u0000'+input.extensionId;if(input.action==='set'){if(input.value===null)extensionStorage.delete(key);else extensionStorage.set(key,structuredClone(input.value));}output={value:extensionStorage.has(key)?structuredClone(extensionStorage.get(key)):null};}
 else if(name==='canvas.media.put'){const bytes=fromBase64(input.data);if(!bytes)throw Error('VALIDATION not base64');let image;try{image=prepareImage(bytes);}catch(e:any){throw Error((e.code??'VALIDATION')+': '+e.message);}const url=mediaRef(await sha256(image.bytes),image.extension),existed=media.has(url);media.set(url,toBase64(image.bytes));output={url,mime:image.mime,bytes:image.bytes.length,existed};}
 else if(name==='canvas.media.read'){const data=media.get(input.url),ref=parseMediaRef(input.url);if(!data||!ref)throw Error('NOT_FOUND: That image is not stored on this computer.');output={mime:ref.mime,data,bytes:Math.floor(data.length*3/4)};}
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
