// Minimap and selection beacon (example data): the map moves the view without writing; a file tree row whose card
// is out of sight raises an edge chip that takes you to it.
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
 const rect=sel=>ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;const r=e.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height}})()`);
 const press=async(x,y)=>{await mouse('mouseMoved',x,y);await mouse('mousePressed',x,y,'left',1);await mouse('mouseReleased',x,y);await new Promise(r=>setTimeout(r,500));};
 const click=async sel=>{const r=await rect(sel);if(!r)throw Error('Missing '+sel);await press(r.x+r.w/2,r.y+r.h/2);};
 const shot=async name=>{const r=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync('/tmp/lienzo-way-'+name+'.png',Buffer.from(r.data,'base64'));};
 const onScreen=sel=>ev(`(()=>{const r=document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect();return r.right>0&&r.left<innerWidth&&r.bottom>0&&r.top<innerHeight})()`);
 try{
 await call('Runtime.enable');await call('Page.enable');await call('Network.enable');await call('Network.setCacheDisabled',{cacheDisabled:true});
 await call('Page.navigate',{url:'http://127.0.0.1:8765/?theme='+(process.argv[2]||'oscuro')});await wait('!!document.querySelector("#lienzo-entity-note")');
 await ev(`__panelQA.seed([{type:'block.create',block:{id:'tree',typeId:'file-tree',title:'Ejemplo: repo',position:{x:80,y:520},data:{entries:[{path:'lib/',note:'la lógica'},{path:'lib/db.mjs'},{path:'ui/',note:'la pantalla'}]}}},
  {type:'block.create',block:{id:'far',typeId:'node',title:'lib/',position:{x:5200,y:2600},data:{summary:'Ejemplo: tarjeta lejana.'}}},
  {type:'block.create',block:{id:'near',typeId:'node',title:'ui/',position:{x:520,y:560},data:{summary:'Ejemplo: tarjeta cercana.'}}}])`);
 await wait('!!document.querySelector("#lienzo-entity-far")&&!!document.querySelector("#lienzo-interactive-minimap")');await new Promise(r=>setTimeout(r,900));
 const rev=await ev('__panelQA.doc().revision'),log=await ev('__panelQA.log.length');
 assert.equal(await onScreen('#lienzo-entity-far'),false);
 // A row whose card is in sight: no chip, the card is selected.
 await click('[aria-label^="Carpeta ui"]');await wait('__panelQA.doc().selectedIds.includes("near")');assert.equal(await rect('[aria-label^="Ir a"]'),null);
 // A row whose card is far away: the chip appears on the edge and takes you there.
 await click('[aria-label^="Carpeta lib"]');await wait('__panelQA.doc().selectedIds.includes("far")');await wait('!!document.querySelector("[aria-label^=\\"Ir a\\"]")');
 const chip=await rect('[aria-label^="Ir a"]');assert.ok(chip.x>innerWidthGuess()/2,'chip on the side the card lies '+JSON.stringify(chip));await shot('chip');
 await click('[aria-label^="Ir a"]');await new Promise(r=>setTimeout(r,700));assert.equal(await onScreen('#lienzo-entity-far'),true);
 await wait('getComputedStyle(document.querySelector("[aria-label^=\\"Ir a\\"]").parentElement).opacity==="0"||!document.querySelector("[aria-label^=\\"Ir a\\"]")');
 // The minimap carries the view: pressing its top-left corner brings the first cards back.
 const map=await rect('#lienzo-interactive-minimap');await press(map.x+24,map.y+24);await new Promise(r=>setTimeout(r,500));
 assert.equal(await onScreen('#lienzo-entity-far'),false,'view moved away from the far card');await shot('map');
 assert.equal(await ev('__panelQA.doc().revision'),rev);assert.equal(await ev('__panelQA.log.length'),log);
 console.log('PASS minimap navigates and the beacon finds an off-screen selection, without writing');assert.deepEqual(uncaught,[]);
 }finally{ws.close();}
 function innerWidthGuess(){return 1600;}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
