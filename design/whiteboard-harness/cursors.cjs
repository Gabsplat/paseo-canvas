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
 // What the pointer really shows: the cursor of the element under an empty spot of the canvas, not of the container.
 const under=()=>ev(`(()=>{for(const [x,y] of [[1400,700],[1300,820],[1500,300]]){const e=document.elementFromPoint(x,y);if(e&&!e.closest('[id^="lienzo-entity-"]')&&e.closest('#lienzo-canvas-viewport'))return getComputedStyle(e).cursor;}throw Error('no empty canvas spot')})()`);
 try{
 await call('Runtime.enable');await call('Page.enable');await call('Network.enable');await call('Network.setCacheDisabled',{cacheDisabled:true});
 await call('Page.navigate',{url:'http://127.0.0.1:8765/?theme=oscuro'});await wait('!!document.querySelector("#lienzo-entity-note")');await new Promise(r=>setTimeout(r,700));
 const V='#lienzo-canvas-viewport',card='#lienzo-grab-note-header';
 const own=(value,fallback)=>{assert.ok(value.startsWith('url("data:image/svg+xml')&&value.endsWith(', '+fallback),fallback+' <- '+value.slice(0,40)+'…'+value.slice(-20));return value;};
 const arrow=own(await at(V),'default');assert.equal(await under(),arrow,'empty canvas shows the arrow');const open=own(await at(card),'grab');assert.notEqual(arrow,open);
 await click('Mano (H)');assert.equal(await at(V),open);assert.equal(await under(),open);assert.equal(await at(card),open,'the hand shows through cards');
 await mouse('mousePressed',1400,700,1);const closed=own(await at(V),'grabbing');await mouse('mouseReleased',1400,700);assert.equal(await at(V),open);assert.notEqual(closed,open);
 await click('Texto (T)');const text=own(await at(V),'text');assert.equal(await at(card),text);
 await click('Forma (R)');const cross=own(await at(V),'crosshair');assert.equal(await under(),cross);
 await click('Lápiz (D)');const dot=own(await at(V),'crosshair');assert.notEqual(dot,cross);
 await click('Goma (E)');own(await at(V),'cell');assert.equal(await under(),await at(V));
 await click('Seleccionar (V)');assert.equal(await at(V),arrow);assert.equal(await at(card),open);
 // Sweep the whole canvas: areas, shapes, free text and cards must all show a Lienzo cursor. Only real buttons,
 // links and the minimap may show the system pointer.
 await ev(`__panelQA.seed([{type:'block.create',block:{id:'n1',typeId:'node',title:'Ejemplo uno',data:{summary:'Texto de ejemplo.'}}},{type:'group.create',group:{id:'g',title:'Ejemplo · área',description:'',blockIds:['n1'],groupIds:[],layout:{mode:'graph'}}},
  {type:'block.create',block:{id:'shape',typeId:'wb-shape',title:'',position:{x:900,y:420},size:{width:200,height:120},data:{shape:'rect',color:'naranja',fill:'solid',text:'Ejemplo'}}},{type:'block.create',block:{id:'txt',typeId:'wb-text',title:'',position:{x:900,y:600},data:{text:'Texto libre de ejemplo'}}}])`);
 await wait('!!document.querySelector("#lienzo-entity-txt")');await new Promise(r=>setTimeout(r,1200));
 const sweep=()=>ev(`(()=>{const bad=new Set(),vp=document.querySelector('#lienzo-canvas-viewport');for(let y=70;y<innerHeight-10;y+=11)for(let x=70;x<innerWidth-10;x+=11){const e=document.elementFromPoint(x,y);if(!e||!vp.contains(e))continue;const c=getComputedStyle(e).cursor;if(!c.startsWith('url(')&&c!=='pointer')bad.add(c+' on '+(e.closest('[id^="lienzo-entity-"]')?.id||'fondo'));}return [...bad]})()`);
 assert.deepEqual(await sweep(),[]);assert.equal(await ev(`getComputedStyle(document.elementFromPoint(...(()=>{const r=document.querySelector('#lienzo-entity-shape').getBoundingClientRect();return[r.x+20,r.y+20]})())).cursor`),open,'a shape shows the open hand');
 await click('Mano (H)');assert.deepEqual(await sweep(),[]);await click('Seleccionar (V)');
 console.log('PASS cursor follows the tool');assert.deepEqual(uncaught,[]);
 }finally{ws.close();}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
