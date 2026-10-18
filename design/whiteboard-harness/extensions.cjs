// Extensions (example data): tools made outside the plugin are listed in the + catalog, open as a tab of the right
// panel, run sandboxed, share the selection, edit only with permission, and an imported one must be granted first.
// Extension views are gone: nothing offers one. Nothing here reaches an assistant.
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

 const pause=ms=>new Promise(r=>setTimeout(r,ms));
 const rect=sel=>ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;const r=e.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height}})()`);
 const tap=async(x,y)=>{await mouse('mouseMoved',x,y);await mouse('mousePressed',x,y,1);await mouse('mouseReleased',x,y);await pause(250);};
 const has=t=>ev('document.body.innerText.includes('+JSON.stringify(t)+')');
 const key=async(key,code,modifiers=0)=>{await call('Input.dispatchKeyEvent',{type:'keyDown',key,code,modifiers});await call('Input.dispatchKeyEvent',{type:'keyUp',key,code,modifiers});await pause(150);};
 const tool=async id=>{await click('#lienzo-tool-add');await wait('!!document.querySelector("#lienzo-add-menu")');await ev(`document.querySelector('[id="lienzo-add-ext.${id}"]').scrollIntoView({block:'center'})`);await click('[id="lienzo-add-ext.'+id+'"]');await wait('!!document.querySelector("#lienzo-right-panel")');};
 const frame=id=>rect('[id="lienzo-extension-'+id+'"] iframe');
 try{
 await call('Runtime.enable');await call('Page.enable');await call('Network.enable');await call('Network.setCacheDisabled',{cacheDisabled:true});
 await call('Page.navigate',{url:'http://127.0.0.1:8765/?theme='+(process.argv[2]||'oscuro')});await wait('!!document.querySelector("#lienzo-entity-note")');
 await ev(`(()=>{const ops=[],areas=[['a','Ejemplo · entradas',4],['b','Ejemplo · motor',5],['c','Ejemplo · datos',3]];for(const [g,title,n] of areas){const ids=[];for(let i=0;i<n;i++){ids.push(g+i);ops.push({type:'block.create',block:{id:g+i,typeId:'node',title:'Ejemplo '+g+i,data:{summary:'Dato de ejemplo.'}}});}ops.push({type:'group.create',group:{id:'area-'+g,title,description:'',blockIds:ids,groupIds:[],layout:{mode:'grid'}}});}
  [['a0','b0','flow'],['a1','b0','flow'],['b0','b1','flow'],['b1','c0','depends'],['b2','c1','depends'],['a2','b3','reference']].forEach(([from,to,kind],i)=>ops.push({type:'link.create',link:{id:'x'+i,from,to,kind}}));__panelQA.seed(ops);})()`);
 await wait('!!document.querySelector("#lienzo-entity-c2")');await pause(800);const rev0=await ev('__panelQA.doc().revision');
 // 1. No views: no extension view is offered anywhere; the catalog lists extension tools only.
 await click('#lienzo-tool-add');await wait('!!document.querySelector("#lienzo-add-menu")');const listed=await ev(`document.querySelector('#lienzo-add-menu').innerText`);
 assert.ok(listed.includes('Extensions')&&listed.includes('Find and replace'),'a tool made here is in the Extensions section');assert.ok(!listed.includes('Example · Mosaic'),'no extension view is offered');
 await shot('catalog');await click('[aria-label="Close the catalog"]');
 // 2. A tool made here (the find-and-replace contract example) edits through the same transactions as everything else, as a tab of the right panel.
 await tool('find-replace');await wait(`!!document.querySelector('[id="lienzo-extension-find-replace"] iframe')`);await pause(700);
 const t=await frame('find-replace');await tap(t.x+t.w/2,t.y+44);await call('Input.insertText',{text:'Ejemplo'});await tap(t.x+t.w/2,t.y+100);await call('Input.insertText',{text:'Caso'});await pause(300);await shot('tool');
 const logged=await ev('__panelQA.log.length');let done=false;for(const dy of [164,150,178,136,192]){await tap(t.x+t.w/2,t.y+dy);await pause(500);if(await ev('__panelQA.log.length')>logged){done=true;break;}}
 assert.ok(done,'the tool wrote one transaction');const titles=await ev('__panelQA.doc().blocks.map(b=>b.title).join("|")');assert.ok(titles.includes('Caso a0')&&!titles.includes('Ejemplo a0'),titles);
 const entry=await ev('JSON.stringify(__panelQA.log.at(-1))');assert.ok(entry.includes('Find and replace: ')&&entry.includes('block.update'),entry.slice(0,300));await pause(500);await shot('tool-done');
 await click('#lienzo-document-island [aria-label="Menu"]');await click('#lienzo-interactive-menu [aria-label="Undo"]');await pause(500);await click('[aria-label="Close the menu"]');assert.ok((await ev('__panelQA.doc().blocks.map(b=>b.title).join("|")')).includes('Ejemplo a0'),'what a tool did can be undone');
 await click('[aria-label="Close Find and replace"]');
 // 3. One the assistant has just saved is there the next time the menu opens. It has no way to the agent: lienzo.ask is
 // gone, so the page falls back to selecting, and nothing is sent.
 const big=inner=>'<button style="position:fixed;inset:0;width:100%;height:100%;font:16px system-ui" onclick="'+inner+'">Probar</button>';
 const target=await ev('__panelQA.doc().blocks[0].id');
 await ev('__panelQA.addExtension('+JSON.stringify({id:'qa-pedir',kind:'tool',api:1,name:'QA · Pedir',permissions:[],html:big("if(typeof lienzo.ask==='function')lienzo.ask('hecho',{n:1});else lienzo.select(['"+target+"'])")})+')');
 await tool('qa-pedir');await wait(`!!document.querySelector('[id="lienzo-extension-qa-pedir"] iframe')`);await pause(600);const a=await frame('qa-pedir'),actions=await ev('__panelQA.actions.length');
 await tap(a.x+a.w/2,a.y+a.h/2);await wait('JSON.stringify(__panelQA.doc().selectedIds)==='+JSON.stringify(JSON.stringify([target])),'no lienzo.ask: the page selected instead');
 assert.equal(await ev('__panelQA.actions.length'),actions,'nothing was sent to an agent');
 assert.ok(!(await has('ask the agent for things')),'no agent permission is described');
 await click('[aria-label="Close QA · Pedir"]');
 // 4. One that came in someone else's pack can read and select, but edits nothing until the person allows it.
 await ev('__panelQA.addExtension('+JSON.stringify({id:'ajeno.editar',kind:'tool',api:1,name:'QA · Ajena',permissions:['edit'],html:big("lienzo.edit([{type:'document.update',title:'Cambiado por la extensión'}],'Renombrar')")})+',"ajeno")');
 await tool('ajeno.editar');await wait(`!!document.querySelector('[id="lienzo-extension-ajeno.editar"] iframe')`);await pause(600);assert.ok(await has('asks to change the canvas'),'it says what it asks for');await shot('grant');
 let g=await frame('ajeno.editar');const before=await ev('__panelQA.doc().revision');await tap(g.x+g.w/2,g.y+g.h/2);await pause(600);assert.equal(await ev('__panelQA.doc().revision'),before,'no permission, no edit');
 await click('[id="lienzo-extension-grant-ajeno.editar"] [aria-label="Allow"]');await wait(`!document.querySelector('[id="lienzo-extension-grant-ajeno.editar"]')`);await pause(500);
 g=await frame('ajeno.editar');await tap(g.x+g.w/2,g.y+g.h/2);await wait('__panelQA.doc().title==="Cambiado por la extensión"');
 assert.deepEqual(uncaught.map(u=>u.exception?.description||u.text),[],'something threw');assert.ok(!/Plugin failed|Minified React/.test(await ev('document.body.innerText')));
 console.log('PASS extension tools come from the catalog, open in the right panel, run sandboxed, edit with permission, cannot reach the agent, and ask before an imported one does');
 }finally{ws.close();}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
