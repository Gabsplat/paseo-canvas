// Two fixes for narrow windows (example data). 1. Selecting a mini app on a canvas too narrow for Properties beside it
// does not open Properties over it; the Properties button still opens it, and a wide canvas keeps opening it by itself.
// 2. Delete on a Lienzo card asks in a popover from its ⋯ button: the card and the grid do not move; Escape and a press
// outside cancel without opening the Lienzo.
// Run with: node compact-ui.cjs [oscuro|papel] [width]. LIENZO_CDP and LIENZO_HTTP pick other ports.
// Captures go to $LIENZO_SHOTS (default /tmp)/lienzo-compact-ui-<theme>-<width>-*.png.
const assert=require('node:assert/strict');const fs=require('node:fs');
const cdp=process.env.LIENZO_CDP||'9222',origin=`http://127.0.0.1:${process.env.LIENZO_HTTP||'8765'}/`,theme=process.argv[2]||'oscuro',W=Number(process.argv[3]||900),H=800;
const out=(process.env.LIENZO_SHOTS||'/tmp')+`/lienzo-compact-ui-${theme==='papel'?'light':'dark'}-${W}-`,narrow=W<1004;
(async()=>{
 const pages=await(await fetch(`http://127.0.0.1:${cdp}/json/list`)).json();
 const page=pages.find(p=>p.type==='page'&&p.url.startsWith(origin));if(!page)throw Error('QA page missing');
 const ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((ok,no)=>{ws.addEventListener('open',ok,{once:true});ws.addEventListener('error',no,{once:true});});
 let seq=0;const pending=new Map(),uncaught=[];
 ws.addEventListener('message',e=>{const r=JSON.parse(e.data);if(r.method==='Runtime.exceptionThrown')uncaught.push(r.params.exceptionDetails);if(r.id){const p=pending.get(r.id);if(!p)return;pending.delete(r.id);r.error?p.no(Error(JSON.stringify(r.error))):p.ok(r.result);}});
 const call=(method,params={})=>new Promise((ok,no)=>{const id=++seq;pending.set(id,{ok,no});ws.send(JSON.stringify({id,method,params}));});
 const ev=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result?.value;};
 const pause=ms=>new Promise(r=>setTimeout(r,ms));
 const wait=async(expression,what=expression)=>{for(let n=0;n<160;n++){if(await ev(expression))return;await pause(50);}throw Error('Condition timed out: '+what);};
 const mouse=(type,x,y,buttons=0,clickCount=1)=>call('Input.dispatchMouseEvent',{type,x,y,button:type==='mouseMoved'&&!buttons?'none':'left',buttons,clickCount});
 const tap=async(x,y)=>{await mouse('mouseMoved',x,y);await mouse('mousePressed',x,y,1);await mouse('mouseReleased',x,y);await pause(300);};
 const q=s=>JSON.stringify(s),L=s=>'[aria-label='+q(s)+']';
 const rect=sel=>ev(`(()=>{const e=document.querySelector(${q(sel)});if(!e)return null;const r=e.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height}})()`);
 const click=async sel=>{await wait(`!!document.querySelector(${q(sel)})`,sel);const r=await rect(sel);await tap(r.x+r.w/2,r.y+r.h/2);};
 const hover=async sel=>{const r=await rect(sel);await mouse('mouseMoved',r.x+r.w/2,r.y+r.h/2);await pause(250);};
 const key=async(key,code)=>{await call('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode:key==='Escape'?27:0});await call('Input.dispatchKeyEvent',{type:'keyUp',key,code});await pause(250);};
 const has=sel=>ev(`!!document.querySelector(${q(sel)})`);
 const shots=[];const shot=async name=>{await pause(300);const r=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(out+name+'.png',Buffer.from(r.data,'base64'));shots.push(out+name+'.png');};
 try{
 await call('Runtime.enable');await call('Page.enable');await call('Network.enable');await call('Network.setCacheDisabled',{cacheDisabled:true});
 await call('Emulation.setDeviceMetricsOverride',{width:W,height:H,deviceScaleFactor:1,mobile:false});
 await call('Page.navigate',{url:`${origin}?theme=${theme}`});await wait('!!document.querySelector("#lienzo-toolbar")');await pause(700);
 // 1. A mini app (example data), alone in view.
 const app=`<!doctype html><meta charset="utf-8"><style>body{margin:0;height:100vh;display:grid;place-items:center;font:16px system-ui;background:#123;color:#fff}button{font:inherit;padding:10px 16px;border-radius:999px;border:0;background:#f90}</style><button id="b">Example: count</button><script>let n=0;b.onclick=()=>{n++;b.textContent='Example: '+n;}</script>`;
 await ev(`__panelQA.seed([{type:'block.create',block:{id:'app',typeId:'html',title:'Example: counter',position:{x:900,y:380},data:{html:${q(app)},height:320}}}])`);
 await wait('!!document.querySelector("#lienzo-entity-app iframe")');await pause(600);
 await click('[aria-label="Fit all"]');await pause(900);
 const frame=await rect('#lienzo-entity-app iframe');assert.ok(frame,'the mini app is drawn');
 await tap(frame.x+frame.w/2,frame.y+frame.h*.8);await pause(700);
 const selected=await ev('JSON.stringify(__panelQA.doc().selectedIds??null)');
 if(narrow){
  assert.equal(await has('#lienzo-right-panel'),false,'a narrow canvas does not open Properties over the mini app: selected '+selected);
  await shot('selected');
  // Into the mini app and press its button: still nothing covers it.
  const x=frame.x+frame.w/2,y=frame.y+frame.h/2;await mouse('mousePressed',x,y,1,1);await mouse('mouseReleased',x,y,0,1);await mouse('mousePressed',x,y,1,2);await mouse('mouseReleased',x,y,0,2);await pause(500);
  await tap(x,y);assert.equal(await has('#lienzo-right-panel'),false,'interacting does not open Properties');
  // Asking for it opens it.
  await click('#lienzo-top-right [aria-label="Properties"]');await wait('!!document.querySelector("#lienzo-right-panel")','the Properties button opens it');await shot('asked');
  await click('#lienzo-top-right [aria-label="Properties"]');await wait('!document.querySelector("#lienzo-right-panel")','and closes it');
 }else{
  await wait('!!document.querySelector("#lienzo-right-panel")','a wide canvas opens Properties beside the selection: '+selected);await shot('selected');
 }
 await key('Escape','Escape');
 // 2. Lienzos: delete asks in a popover.
 await ev(`__panelQA.addDocument({id:'qa-jejox',title:'Jejox',updatedAt:new Date().toISOString(),blocks:[{id:'n',typeId:'note',title:'Example',data:{text:'Example data.'},position:{x:0,y:0}}],groups:[],links:[]})`);
 await click('#lienzo-document-island [aria-label="Menu"]');await click('#lienzo-interactive-menu '+L('Lienzos'));await wait('!!document.querySelector("#lienzo-card-qa-jejox")');await pause(800);
 const cards=()=>ev(`JSON.stringify([...document.querySelectorAll('[id^=lienzo-card-]:not([id^=lienzo-card-menu])')].map(e=>{const r=e.getBoundingClientRect();return[e.id,Math.round(r.x),Math.round(r.y),Math.round(r.width),Math.round(r.height)]}))`);
 const before=await cards();
 const ask=async()=>{await hover('#lienzo-card-qa-jejox');await click(L('More for Jejox'));await wait('!!document.querySelector("#lienzo-card-menu-qa-jejox")');await click('#lienzo-card-menu-qa-jejox [aria-label="Delete…"]');await wait('!!document.querySelector("#lienzo-delete-qa-jejox")');await pause(200);};
 await ask();
 assert.equal(await cards(),before,'the cards do not move');
 assert.match(await ev(`document.querySelector('#lienzo-delete-qa-jejox').innerText`),/Delete “Jejox” and its history\? This cannot be undone\./);
 assert.equal(await ev(`document.activeElement?.getAttribute('aria-label')`),'Cancel','Cancel has the focus');
 const pop=await rect('#lienzo-delete-qa-jejox');assert.ok(pop.x>=0&&pop.x+pop.w<=W&&pop.y+pop.h<=H,'the popover is on screen '+JSON.stringify(pop));
 await shot('delete');
 await key('Escape','Escape');await wait('!document.querySelector("#lienzo-delete-qa-jejox")','Escape cancels');assert.ok(await has('#lienzo-lienzos'),'and leaves the Lienzos screen open');
 await ask();const head=await rect('#lienzo-lienzos-search');await tap(head.x+head.w+60,head.y-40);
 await wait('!document.querySelector("#lienzo-delete-qa-jejox")','a press outside cancels');assert.ok(await has('#lienzo-card-qa-jejox'),'nothing was deleted');
 await ask();const card=await rect('#lienzo-card-qa-jejox');await tap(card.x+20,card.y+20);await wait('!document.querySelector("#lienzo-delete-qa-jejox")');assert.ok(await has('#lienzo-lienzos'),'a press on the card cancels without opening it');
 await ask();await click('#lienzo-delete-qa-jejox [aria-label="Delete"]');await wait('!document.querySelector("#lienzo-card-qa-jejox")','Delete deletes');
 assert.deepEqual(uncaught,[]);console.log('PASS compact-ui',theme,W,'\n'+shots.join('\n'));
 }finally{await call('Emulation.clearDeviceMetricsOverride').catch(()=>{});ws.close();}
})().catch(e=>{console.error(e);process.exit(1);});
