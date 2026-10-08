// Extensions (example data): a view and a tool made outside the plugin run sandboxed, share the selection, edit only
// with permission, and an imported one must be granted first. Nothing here reaches an assistant.
const assert=require('node:assert/strict');const fs=require('node:fs');
(async()=>{
 const pages=await(await fetch('http://127.0.0.1:9222/json/list')).json();
 const page=pages.find(p=>p.type==='page'&&p.url.startsWith('http://127.0.0.1:8765/'));if(!page)throw Error('QA page missing');
 const ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((ok,no)=>{ws.addEventListener('open',ok,{once:true});ws.addEventListener('error',no,{once:true});});
 let seq=0;const pending=new Map(),uncaught=[];
 ws.addEventListener('message',e=>{const r=JSON.parse(e.data);if(r.method==='Runtime.exceptionThrown')uncaught.push(r.params.exceptionDetails);if(r.id){const p=pending.get(r.id);if(!p)return;pending.delete(r.id);r.error?p.no(Error(JSON.stringify(r.error))):p.ok(r.result);}});
 const call=(method,params={})=>new Promise((ok,no)=>{const id=++seq;pending.set(id,{ok,no});ws.send(JSON.stringify({id,method,params}));});
 const ev=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result?.value;};
 const wait=async expression=>{for(let n=0;n<150;n++){if(await ev(expression))return;await new Promise(r=>setTimeout(r,50));}throw Error('Condition timed out: '+expression);};
 const mouse=(type,x,y,buttons=0)=>call('Input.dispatchMouseEvent',{type,x,y,button:'left',buttons,clickCount:1});
 const press=async(x,y)=>{await mouse('mouseMoved',x,y);await mouse('mousePressed',x,y,1);await mouse('mouseReleased',x,y);await new Promise(r=>setTimeout(r,900));};
 const click=async sel=>{const p=await ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)throw Error('Missing '+${JSON.stringify(sel)});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);await press(p.x,p.y);};
 const shot=async name=>{const r=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync('/tmp/lienzo-ext-'+name+'.png',Buffer.from(r.data,'base64'));};
 const view=async name=>{await click('[aria-label="Cambiar vista"]');await wait('!!document.querySelector("#lienzo-interactive-views")');await click('#lienzo-interactive-views [aria-label="'+name+'"]');};
 const pause=ms=>new Promise(r=>setTimeout(r,ms));
 const rect=sel=>ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;const r=e.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height}})()`);
 const tap=async(x,y)=>{await mouse('mouseMoved',x,y);await mouse('mousePressed',x,y,1);await mouse('mouseReleased',x,y);await pause(250);};
 const has=t=>ev('document.body.innerText.includes('+JSON.stringify(t)+')');
 const tool=async name=>{await click('[aria-label="Herramientas propias"]');await wait('!!document.querySelector("#lienzo-interactive-extension-tools")');await click('#lienzo-interactive-extension-tools [aria-label="'+name+'"]');};
 const frame=id=>rect('[id="lienzo-extension-'+id+'"] iframe');
 try{
 await call('Runtime.enable');await call('Page.enable');await call('Network.enable');await call('Network.setCacheDisabled',{cacheDisabled:true});
 await call('Page.navigate',{url:'http://127.0.0.1:8765/?theme='+(process.argv[2]||'oscuro')});await wait('!!document.querySelector("#lienzo-entity-note")');
 await ev(`(()=>{const ops=[],areas=[['a','Ejemplo · entradas',4],['b','Ejemplo · motor',5],['c','Ejemplo · datos',3]];for(const [g,title,n] of areas){const ids=[];for(let i=0;i<n;i++){ids.push(g+i);ops.push({type:'block.create',block:{id:g+i,typeId:'node',title:'Ejemplo '+g+i,data:{summary:'Dato de ejemplo.'}}});}ops.push({type:'group.create',group:{id:'area-'+g,title,description:'',blockIds:ids,groupIds:[],layout:{mode:'grid'}}});}
  [['a0','b0','flow'],['a1','b0','flow'],['b0','b1','flow'],['b1','c0','depends'],['b2','c1','depends'],['a2','b3','reference']].forEach(([from,to,kind],i)=>ops.push({type:'link.create',link:{id:'x'+i,from,to,kind}}));__panelQA.seed(ops);})()`);
 await wait('!!document.querySelector("#lienzo-entity-c2")');await pause(800);const rev0=await ev('__panelQA.doc().revision');
 // 1. A shipped example view, built on the kit, is listed next to the built-in views and shares the selection.
 await view('Ejemplo · Mosaico');await wait(`!!document.querySelector('[id="lienzo-extension-ejemplos.mosaico"] iframe')`);await pause(900);await shot('view');
 const f=await frame('ejemplos.mosaico');assert.ok(f.w>400&&f.h>300,'the view fills the panel');let picked=null;
 for(let gy=0;gy<14&&!picked;gy++)for(let gx=0;gx<18&&!picked;gx++){const x=f.x+60+gx*(f.w-120)/18,y=f.y+40+gy*(f.h-200)/14;await tap(x,y);const ids=await ev('__panelQA.doc().selectedIds');if(ids.length===1)picked={x,y,id:ids[0]};}
 assert.ok(picked,'pressing a card in the view selects it in the document');await shot('view-selected');
 await tap(f.x+8,f.y+8);await pause(200);assert.deepEqual(await ev('__panelQA.doc().selectedIds'),[],'pressing nothing clears the selection');
 await mouse('mouseMoved',f.x+12,f.y+12);await mouse('mousePressed',f.x+12,f.y+12,1);await mouse('mouseMoved',f.x+f.w*.6,f.y+f.h*.5,1);await mouse('mouseMoved',f.x+f.w-12,f.y+f.h-140,1);await shot('view-box');await mouse('mouseReleased',f.x+f.w-12,f.y+f.h-140);await pause(400);
 const boxed=await ev('__panelQA.doc().selectedIds.length');assert.ok(boxed>=5,'a drag over nothing box-selects: '+boxed);
 await call('Input.dispatchMouseEvent',{type:'mouseWheel',x:f.x+f.w/2,y:f.y+f.h/2,deltaX:0,deltaY:-260,modifiers:2});await pause(300);await shot('view-zoomed');
 await tap(f.x+8,f.y+8);assert.equal(await ev('__panelQA.doc().revision'),rev0,'a view without the edit permission never writes');
 // 2. A shipped example tool edits through the same transactions as everything else, over whatever view is open.
 await tool('Ejemplo · Buscar y reemplazar');await wait(`!!document.querySelector('[id="lienzo-extension-ejemplos.reemplazar"] iframe')`);await pause(700);
 const t=await frame('ejemplos.reemplazar');await tap(t.x+t.w/2,t.y+44);await call('Input.insertText',{text:'Ejemplo'});await tap(t.x+t.w/2,t.y+100);await call('Input.insertText',{text:'Caso'});await pause(300);await shot('tool');
 const logged=await ev('__panelQA.log.length');let done=false;for(const dy of [164,150,178,136,192]){await tap(t.x+t.w/2,t.y+dy);await pause(500);if(await ev('__panelQA.log.length')>logged){done=true;break;}}
 assert.ok(done,'the tool wrote one transaction');const titles=await ev('__panelQA.doc().blocks.map(b=>b.title).join("|")');assert.ok(titles.includes('Caso a0')&&!titles.includes('Ejemplo a0'),titles);
 const entry=await ev('JSON.stringify(__panelQA.log.at(-1))');assert.ok(entry.includes('Ejemplo · Buscar y reemplazar: ')&&entry.includes('block.update'),entry.slice(0,300));await pause(500);await shot('tool-done');
 await click('[aria-label="Deshacer"]');await pause(500);assert.ok((await ev('__panelQA.doc().blocks.map(b=>b.title).join("|")')).includes('Ejemplo a0'),'what a tool did can be undone');
 await click('[aria-label="Cerrar Ejemplo · Buscar y reemplazar"]');
 // 3. One the assistant has just saved is there the next time the menu opens, and its request is a real canvas action.
 const big=inner=>'<button style="position:fixed;inset:0;width:100%;height:100%;font:16px system-ui" onclick="'+inner+'">Probar</button>';
 await ev('__panelQA.addExtension('+JSON.stringify({id:'qa-pedir',kind:'tool',api:1,name:'QA · Pedir',permissions:['agent'],html:big("lienzo.ask('hecho',{n:1},'Pedido de prueba')")})+')');
 await tool('QA · Pedir');await wait(`!!document.querySelector('[id="lienzo-extension-qa-pedir"] iframe')`);await pause(600);const a=await frame('qa-pedir'),actions=await ev('__panelQA.actions.length');
 await tap(a.x+a.w/2,a.y+a.h/2);await wait('__panelQA.actions.length>'+actions);const act=await ev('JSON.stringify(__panelQA.actions.at(-1))');assert.ok(act.includes('extension.event')&&act.includes('"extension":"qa-pedir"')&&act.includes('"event":"hecho"'),act);
 await click('[aria-label="Cerrar QA · Pedir"]');
 // 4. One that came in someone else's pack can read and select, but edits nothing until the person allows it.
 await ev('__panelQA.addExtension('+JSON.stringify({id:'ajeno.editar',kind:'tool',api:1,name:'QA · Ajena',permissions:['edit'],html:big("lienzo.edit([{type:'document.update',title:'Cambiado por la extensión'}],'Renombrar')")})+',"ajeno")');
 await tool('QA · Ajena');await wait(`!!document.querySelector('[id="lienzo-extension-ajeno.editar"] iframe')`);await pause(600);assert.ok(await has('pide cambiar el lienzo'),'it says what it asks for');await shot('grant');
 let g=await frame('ajeno.editar');const before=await ev('__panelQA.doc().revision');await tap(g.x+g.w/2,g.y+g.h/2);await pause(600);assert.equal(await ev('__panelQA.doc().revision'),before,'no permission, no edit');
 await click('[id="lienzo-extension-grant-ajeno.editar"] [aria-label="Permitir"]');await wait(`!document.querySelector('[id="lienzo-extension-grant-ajeno.editar"]')`);await pause(500);
 g=await frame('ajeno.editar');await tap(g.x+g.w/2,g.y+g.h/2);await wait('__panelQA.doc().title==="Cambiado por la extensión"');
 assert.deepEqual(uncaught.map(u=>u.exception?.description||u.text),[],'something threw');assert.ok(!/Plugin failed|Minified React/.test(await ev('document.body.innerText')));
 console.log('PASS extensions run sandboxed, share the selection, edit with permission and ask before an imported one does');
 }finally{ws.close();}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
