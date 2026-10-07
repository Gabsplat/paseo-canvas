// The cursor follows the tool (example data).
const assert=require('node:assert/strict');
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
 const click=async label=>{const p=await ev(`(()=>{const r=document.querySelector('[aria-label=${JSON.stringify(label)}]').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);await mouse('mousePressed',p.x,p.y,1);await mouse('mouseReleased',p.x,p.y);await new Promise(r=>setTimeout(r,250));};
 const at=sel=>ev(`getComputedStyle(document.querySelector(${JSON.stringify(sel)})).cursor`);
 try{
 await call('Runtime.enable');await call('Page.enable');await call('Network.enable');await call('Network.setCacheDisabled',{cacheDisabled:true});
 await call('Page.navigate',{url:'http://127.0.0.1:8765/?theme=oscuro'});await wait('!!document.querySelector("#lienzo-entity-note")');await new Promise(r=>setTimeout(r,700));
 const V='#lienzo-canvas-viewport',card='#lienzo-grab-note-header';
 assert.equal(await at(V),'default');assert.equal(await at(card),'grab');
 await click('Mano (H)');assert.equal(await at(V),'grab');assert.notEqual(await at(card),'grab'+'bing');assert.equal(await at(card),'grab','hand shows through cards');
 await mouse('mousePressed',1400,700,1);assert.equal(await at(V),'grabbing');await mouse('mouseReleased',1400,700);assert.equal(await at(V),'grab');
 await click('Texto (T)');assert.equal(await at(V),'text');assert.equal(await at(card),'text');
 await click('Forma (R)');assert.equal(await at(V),'crosshair');
 await click('Lápiz (D)');assert.equal(await at(V),'crosshair');
 await click('Goma (E)');const eraser=await at(V);assert.ok(eraser.startsWith('url("data:image/svg+xml')&&eraser.endsWith('cell'),eraser.slice(0,60));
 await click('Seleccionar (V)');assert.equal(await at(V),'default');assert.equal(await at(card),'grab');
 console.log('PASS cursor follows the tool');assert.deepEqual(uncaught,[]);
 }finally{ws.close();}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
