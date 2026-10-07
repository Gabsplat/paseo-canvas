// File tree block (example data): renders folders with notes, opens and closes locally without writing the document.
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
 const mouse=(type,x,y,button='left',buttons=0)=>call('Input.dispatchMouseEvent',{type,x,y,button,buttons,clickCount:1});
 const click=async sel=>{const p=await ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)throw Error('Missing '+${JSON.stringify(sel)});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);await mouse('mouseMoved',p.x,p.y);await mouse('mousePressed',p.x,p.y,'left',1);await mouse('mouseReleased',p.x,p.y);await new Promise(r=>setTimeout(r,350));};
 try{
 await call('Runtime.enable');await call('Page.enable');await call('Network.enable');await call('Network.setCacheDisabled',{cacheDisabled:true});
 await call('Page.navigate',{url:'http://127.0.0.1:8765/?theme='+(process.argv[2]||'oscuro')});await wait('!!document.querySelector("#lienzo-entity-note")');
 await ev(`__panelQA.seed([{type:'block.create',block:{id:'tree',typeId:'file-tree',title:'Ejemplo: el repo de un vistazo',position:{x:900,y:120},data:{root:'ejemplo/',entries:[
  {path:'bin/',note:'comandos de terminal'},{path:'bin/brain.mjs'},{path:'mcp/',note:'la entrada para agentes'},{path:'mcp/server.mjs',highlight:true,note:'12 herramientas'},
  {path:'lib/',note:'toda la lógica'},{path:'lib/db.mjs'},{path:'lib/service.mjs'},{path:'lib/tools/context.mjs'},{path:'ui/',note:'la pantalla'},{path:'ui/index.html'},
  {path:'node_modules/',muted:true,note:'dependencias'},{path:'node_modules/zod/index.js'},{path:'README.md'}],collapsed:['node_modules/']}}}])`);
 await wait('!!document.querySelector("#lienzo-entity-tree")');await new Promise(r=>setTimeout(r,800));
 const text=()=>ev(`document.querySelector('#lienzo-entity-tree').innerText`);
 let t=await text();assert.ok(t.includes('server.mjs')&&t.includes('12 herramientas')&&t.includes('ejemplo/'));assert.ok(!t.includes('zod'),'collapsed directory starts closed');assert.ok(!/[├└│]/.test(t));
 const rev=await ev('__panelQA.doc().revision'),log=await ev('__panelQA.log.length');
 await click('[aria-label^="Carpeta node_modules"]');t=await text();assert.ok(t.includes('zod'),'opens on click');
 await click('[aria-label^="Carpeta lib:"]');t=await text();assert.ok(!t.includes('db.mjs'),'closes on click');
 assert.equal(await ev('__panelQA.doc().revision'),rev);assert.equal(await ev('__panelQA.log.length'),log);
 const r=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync('/tmp/lienzo-tree.png',Buffer.from(r.data,'base64'));
 console.log('PASS file tree renders, toggles locally, writes nothing');assert.deepEqual(uncaught,[]);
 }finally{ws.close();}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
