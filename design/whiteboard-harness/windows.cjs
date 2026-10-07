// Windows (example data): a web page and a mini app are drawn without a card or a type label; the mini app talks to the canvas.
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
 const mouse=(type,x,y,buttons=0,count=1)=>call('Input.dispatchMouseEvent',{type,x,y,button:'left',buttons,clickCount:count});
 const rect=sel=>ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;const r=e.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height}})()`);
 try{
 await call('Runtime.enable');await call('Page.enable');await call('Network.enable');await call('Network.setCacheDisabled',{cacheDisabled:true});
 await call('Page.navigate',{url:'http://127.0.0.1:8765/?theme='+(process.argv[2]||'oscuro')});await wait('!!document.querySelector("#lienzo-entity-note")');
 const app=`<!doctype html><meta charset="utf-8"><style>body{margin:0;height:100vh;display:grid;place-items:center;font:16px system-ui;background:#123;color:#fff}button{font:inherit;padding:10px 16px;border-radius:999px;border:0;background:#f90}</style><button id="b">Ejemplo: contar</button><p id="s">sin contexto</p><script>let n=0;b.onclick=()=>{n++;b.textContent='Ejemplo: '+n;lienzo.send('count',{n})};lienzo.onContext(c=>{s.textContent=(c.theme.dark?'oscuro':'claro')+' · '+c.selection.length+' seleccionados · '+c.block.title});</script>`;
 await ev(`__panelQA.seed([{type:'block.create',block:{id:'app',typeId:'html',title:'Ejemplo: contador',position:{x:900,y:380},data:{html:${JSON.stringify(app)},height:220}}},
  {type:'block.create',block:{id:'web',typeId:'preview',title:'',position:{x:900,y:700},data:{url:'http://127.0.0.1:8765/fixtures/frame.html'}}}])`);
 await wait('!!document.querySelector("#lienzo-entity-app iframe")&&!!document.querySelector("#lienzo-entity-web")');await new Promise(r=>setTimeout(r,900));
 {const f=await rect('[aria-label="Ajustar al lienzo"]');await mouse('mousePressed',f.x+f.w/2,f.y+f.h/2,1);await mouse('mouseReleased',f.x+f.w/2,f.y+f.h/2);await new Promise(r=>setTimeout(r,900));}
 const text=id=>ev(`document.querySelector('#lienzo-entity-${id}').innerText`);
 assert.ok(!/Mini app|Vista previa/.test(await text('app')+await text('web')),'no type label on windows');assert.ok((await text('app')).includes('Ejemplo: contador'));assert.ok((await text('web')).includes('127.0.0.1'),'an untitled page is named by its host');
 const frame=await ev(`(()=>{const f=document.querySelector('#lienzo-entity-app iframe');return{sandbox:f.getAttribute('sandbox'),w:f.getBoundingClientRect().width,cardW:document.querySelector('#lienzo-entity-app').getBoundingClientRect().width}})()`);
 assert.ok(frame.sandbox.includes('allow-scripts')&&!frame.sandbox.includes('allow-same-origin'),frame.sandbox);assert.ok(frame.cardW-frame.w<=4,'content runs edge to edge '+JSON.stringify(frame));
 // Enter the window (double click), press its button: the page reports to the canvas as an agent event.
 const before=await ev('__panelQA.actions.length');
 const r=await rect('#lienzo-entity-app iframe'),x=r.x+r.w/2,y=r.y+r.h*.26;assert.ok(x<1590&&y<990,'window on screen '+JSON.stringify(r));
 await mouse('mousePressed',x,y,1,1);await mouse('mouseReleased',x,y,0,1);await mouse('mousePressed',x,y,1,2);await mouse('mouseReleased',x,y,0,2);
 await wait('document.querySelector("#lienzo-entity-app [data-lienzo-interacting]").getAttribute("data-lienzo-interacting")==="true"');
 for(const f of [.3,.3,.26,.3,.34,.3]){const yy=r.y+r.h*f;await mouse('mouseMoved',x,yy);await mouse('mousePressed',x,yy,1,1);await mouse('mouseReleased',x,yy,0,1);await new Promise(r=>setTimeout(r,200));}await new Promise(r=>setTimeout(r,900));
 await wait('__panelQA.actions.length>'+before);const sent=await ev(`JSON.stringify(__panelQA.actions.slice(-1))`);
 assert.ok(sent.includes('html.event')&&sent.includes('count'),'the mini app reached the canvas: '+sent.slice(0,300));
 const shot=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync('/tmp/lienzo-windows.png',Buffer.from(shot.data,'base64'));
 console.log('PASS windows are bare and the mini app talks to the canvas');assert.deepEqual(uncaught,[]);
 }finally{ws.close();}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
