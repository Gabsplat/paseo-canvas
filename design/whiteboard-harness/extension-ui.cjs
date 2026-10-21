// Extension presentation (example data, docs/design.md §45): the Snap example opened by an agent request (the watch
// carries canvas_extension_open) turns two cards to dust in an overlay, asks, and deletes them; a chromeless centred
// panel; a popover anchored to a card; a minimal panel switched to fullscreen and back by lienzo.ui.set. Nothing here
// reaches an assistant. Start Chromium with --disable-site-isolation-trials so the frames stay in the page.
// Ports and output: CDP (default 9352), HTTP (8792), OUT (/tmp). Usage: node extension-ui.cjs [papel|oscuro]
const assert=require('node:assert/strict');const fs=require('node:fs');
const CDP=process.env.CDP||9352,HTTP=process.env.HTTP||8792,OUT=process.env.OUT||'/tmp',THEME=process.argv[2]||'oscuro';
(async()=>{
 const pages=await(await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
 const page=pages.find(p=>p.type==='page'&&p.url.startsWith(`http://127.0.0.1:${HTTP}/`));if(!page)throw Error('QA page missing');
 const ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((ok,no)=>{ws.addEventListener('open',ok,{once:true});ws.addEventListener('error',no,{once:true});});
 let seq=0;const pending=new Map(),uncaught=[];
 ws.addEventListener('message',e=>{const r=JSON.parse(e.data);if(r.method==='Runtime.exceptionThrown')uncaught.push(r.params.exceptionDetails);if(r.id){const p=pending.get(r.id);if(!p)return;pending.delete(r.id);r.error?p.no(Error(JSON.stringify(r.error))):p.ok(r.result);}});
 const call=(method,params={})=>new Promise((ok,no)=>{const id=++seq;pending.set(id,{ok,no});ws.send(JSON.stringify({id,method,params}));});
 const ev=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result?.value;};
 const pause=ms=>new Promise(r=>setTimeout(r,ms));
 const wait=async(expression,what=expression,n=200)=>{for(let i=0;i<n;i++){if(await ev(expression))return;await pause(50);}throw Error('Condition timed out: '+what);};
 const mouse=(type,x,y,buttons=0)=>call('Input.dispatchMouseEvent',{type,x,y,button:'left',buttons,clickCount:1});
 const press=async(x,y)=>{await mouse('mouseMoved',x,y);await mouse('mousePressed',x,y,1);await mouse('mouseReleased',x,y);await pause(400);};
 const box=sel=>ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;const r=e.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height}})()`);
 const shot=async name=>{const r=await call('Page.captureScreenshot',{format:'png'});const file=`${OUT}/lienzo-extui-${name}-${THEME}.png`;fs.writeFileSync(file,Buffer.from(r.data,'base64'));console.log('screenshot',file);};
 const key=async(key,code=key,vk=0)=>{await call('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode:vk});await call('Input.dispatchKeyEvent',{type:'keyUp',key,code,windowsVirtualKeyCode:vk});await pause(300);};
 // A frame's own document, through an isolated world (its origin is opaque).
 const inFrame=async(test,expression)=>{const tree=await call('Page.getFrameTree');const all=[];const walk=n=>(n.childFrames||[]).forEach(c=>{all.push(c.frame);walk(c);});walk(tree.frameTree);
  for(const f of all){const {executionContextId}=await call('Page.createIsolatedWorld',{frameId:f.id});const r=await call('Runtime.evaluate',{expression:`(()=>{try{return ${test}?(${expression}):undefined}catch(e){return undefined}})()`,contextId:executionContextId,returnByValue:true});if(r.result&&r.result.value!==undefined)return r.result.value;}return undefined;};
 const ui=async request=>{await ev(`__panelQA.uiRequest(${JSON.stringify(request)})`);};
 try{
 await call('Runtime.enable');await call('Page.enable');
 await call('Page.navigate',{url:`http://127.0.0.1:${HTTP}/?theme=${THEME}`});await wait('!!document.querySelector("#lienzo-entity-note")');
 // Example cards, in a Frame of their own.
 const cards=[['idea-1','Weekly digest','Example: a summary mail every Monday.'],['idea-2','Dark mode','Example: follow the system theme.'],['idea-3','Offline drafts','Example: keep edits while the network is down.'],['idea-4','Share links','Example: a read-only link to one Sheet.']];
 await ev(`__panelQA.seed(${JSON.stringify([{type:'block.delete',id:'server'},{type:'block.delete',id:'note'},{type:'group.delete',id:'frame'},
  ...cards.map(([id,title,summary])=>({type:'block.create',block:{id,typeId:'node',title,data:{summary}}})),
  {type:'group.create',group:{id:'ideas',title:'Example ideas',description:'Example data for the presentation check.',blockIds:cards.map(c=>c[0]),groupIds:[],position:{x:80,y:80},layout:{mode:'graph',direction:'right'}}}])})`);
 await wait('!!document.querySelector("#lienzo-entity-idea-4")');await pause(400);
 const fit=await box('[aria-label="Fit all"]');await press(fit.x+fit.w/2,fit.y+fit.h/2);await pause(900);
 await ev('__panelQA.addExtension(__panelQA.snap)');
 const rev0=await ev('__panelQA.doc().revision');

 // 1. An agent opens Snap on two cards (canvas_extension_open, through the watch): an overlay, cards hidden, dust.
 await ui({action:'open',extension:'snap',input:{ids:['idea-2','idea-3']}});
 await wait(`!!document.querySelector('[id="lienzo-extension-snap"] iframe')`,'Snap opened by the request');
 assert.equal(await ev(`document.querySelector('[id="lienzo-extension-tool-snap"]').dataset.mode`),'overlay');
 assert.ok(await ev('!!document.querySelector("#lienzo-extension-chip-snap")'),'the chip names who draws over the canvas');
 await wait('!document.querySelector("#lienzo-entity-idea-2")&&!document.querySelector("#lienzo-entity-idea-3")','the two cards are hidden');
 assert.ok(await ev('!!document.querySelector("#lienzo-entity-idea-1")&&!!document.querySelector("#lienzo-entity-idea-4")'),'the others stay');
 assert.equal(await ev(`getComputedStyle(document.querySelector('[id="lienzo-extension-snap"] iframe')).pointerEvents`),'none','the overlay lets the pointer through');
 await pause(380);await shot('snap-mid');
 // 2. The dust settles; Snap asks, taking the pointer while it does.
 await wait(`getComputedStyle(document.querySelector('[id="lienzo-extension-snap"] iframe')).pointerEvents==='auto'`,'Snap takes the pointer to ask');
 await pause(250);await shot('snap-ask');
 assert.equal(await ev('__panelQA.doc().revision'),rev0,'hiding and the effect made no revision');
 const del=await inFrame(`!!document.getElementById('del')`,`(()=>{const r=document.getElementById('del').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
 const frameAt=await box('[id="lienzo-extension-snap"] iframe');
 await press(frameAt.x+del.x,frameAt.y+del.y);
 await wait(`!__panelQA.doc().blocks.some(b=>b.id==='idea-2'||b.id==='idea-3')`,'Delete removed the two cards');
 assert.equal(await ev('__panelQA.doc().revision'),rev0+1,'one undoable transaction');
 await wait(`getComputedStyle(document.querySelector('[id="lienzo-extension-snap"] iframe')).pointerEvents==='none'`,'the pointer goes back to the canvas');
 await pause(500);await shot('snap-after');
 // Esc closes the overlay.
 const canvasAt=await box('#lienzo-canvas-viewport');await press(canvasAt.x+canvasAt.w-120,canvasAt.y+canvasAt.h/2);
 await key('Escape','Escape',27);await wait('!document.querySelector("#lienzo-extension-tool-snap")','Esc closes the overlay');

 // 3. A chromeless centred panel that draws its own card, over a dimmed canvas.
 const own=`<style>html,body{margin:0;height:100%;background:transparent;font:13px/1.45 system-ui,sans-serif}.c{box-sizing:border-box;height:100%;border-radius:20px;padding:22px 24px;display:flex;flex-direction:column;gap:10px}.n{font:600 44px/1 system-ui;letter-spacing:-.02em}.r{display:flex;gap:8px;margin-top:auto}button{font:inherit;font-weight:600;padding:7px 14px;border-radius:10px;border:1px solid;cursor:pointer}</style>
<div class="c" id="c"><div id="l">Focus timer · example</div><div class="n">24:59</div><div id="s">A tool that draws its whole surface. Lienzo adds only a ✕ on hover and Esc.</div><div class="r"><button id="go">Pause</button><button id="x">Done</button></div></div>
<script>lienzo.onContext(function(c){var k=c.theme.colors,e=document.getElementById('c');e.style.background='linear-gradient(140deg,'+k.accent+','+k.needs+')';e.style.color=k.background;document.getElementById('s').style.opacity=.85;
[].forEach.call(document.querySelectorAll('button'),function(b,i){b.style.background=i?'transparent':k.background;b.style.color=i?k.background:k.foreground;b.style.borderColor=k.background})});document.getElementById('x').onclick=function(){lienzo.close()};<\/script>`;
 await ev(`__panelQA.addExtension(${JSON.stringify({id:'qa-own',kind:'tool',api:1,name:'QA · Focus timer',description:'Example data: a chromeless panel.',icon:'Timer',presentation:{mode:'panel',chrome:'none',position:'center',width:360,height:220,dimCanvas:.25,accent:'violet'},html:own})})`);
 await ui({action:'open',extension:'qa-own'});await wait(`!!document.querySelector('[id="lienzo-extension-qa-own"] iframe')`);await pause(700);
 assert.ok(await ev('!!document.querySelector("#lienzo-extension-scrim-qa-own")'),'the canvas is dimmed');
 assert.equal(await ev(`getComputedStyle(document.querySelector('[id="lienzo-extension-qa-own"]')).backgroundColor`),'rgba(0, 0, 0, 0)','chromeless: Lienzo paints nothing behind the page');
 await shot('chromeless');
 const own1=await box('[id="lienzo-extension-qa-own"]');await mouse('mouseMoved',own1.x+own1.w/2,own1.y+own1.h/2);await pause(350);
 assert.equal(await ev(`getComputedStyle(document.querySelector('#lienzo-extension-close')).opacity`),'1','hovering shows the ✕');
 await shot('chromeless-hover');
 await press(own1.x+own1.w-8-12,own1.y+8+12);await wait('!document.querySelector("#lienzo-extension-tool-qa-own")','the ✕ closes it');

 // 4. A popover pointing at a card.
 const pop=`<style>html,body{margin:0;font:13px/1.45 system-ui,sans-serif}.p{padding:12px 14px}b{display:block;font-size:13px;margin-bottom:4px}.r{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}span{padding:3px 9px;border-radius:999px;border:1px solid}</style>
<div class="p"><b id="t">…</b><div id="d"></div><div class="r" id="r"></div></div>
<script>function draw(){var c=lienzo.context;if(!c)return;var k=c.theme.colors,id=(lienzo.ui.state&&lienzo.ui.state.anchorId)||c.selection[0],b=c.document.blocks.filter(function(x){return x.id===id})[0];document.body.style.color=k.foreground;
document.getElementById('t').textContent=b?b.title:'Nothing selected';document.getElementById('d').style.color=k.muted;document.getElementById('d').textContent=b?(b.data.summary||''):'';
document.getElementById('r').innerHTML=['Now','Next','Later'].map(function(x,i){return '<span style="border-color:'+(i?k.border:k.areas[3])+';color:'+(i?k.muted:k.areas[3])+'">'+x+'</span>'}).join('')}lienzo.onContext(draw);lienzo.ui.onChange(draw);<\/script>`;
 await ev(`__panelQA.addExtension(${JSON.stringify({id:'qa-pop',kind:'tool',api:1,name:'QA · Triage',description:'Example data: a popover at a card.',icon:'Flag',presentation:{mode:'popover',accent:'success',height:128},html:pop})})`);
 await ui({action:'open',extension:'qa-pop',anchorId:'idea-4'});await wait(`!!document.querySelector('[id="lienzo-extension-qa-pop"] iframe')`);await pause(700);
 const card=await box('#lienzo-entity-idea-4'),bubble=await box('[id="lienzo-extension-tool-qa-pop"]');
 assert.ok(bubble.y+bubble.h<=card.y||bubble.y>=card.y+card.h,'the bubble sits above or below its card');
 assert.ok(Math.abs((bubble.x+bubble.w/2)-(card.x+card.w/2))<2||bubble.x<=4||bubble.x+bubble.w>=card.x,'centred on it unless the edge stops it');
 await shot('popover');
 // The camera moves: the bubble follows the card.
 const z=await box('[aria-label="Zoom out"]');await press(z.x+z.w/2,z.y+z.h/2);await pause(700);
 const card2=await box('#lienzo-entity-idea-4'),bubble2=await box('[id="lienzo-extension-tool-qa-pop"]');
 assert.ok(Math.abs((bubble2.x+bubble2.w/2)-(card2.x+card2.w/2))<3||bubble2.x<=14,'still pointing at the card after zooming');
 assert.equal(await inFrame(`!!document.getElementById('t')`,`document.getElementById('t').textContent`),'Share links','the page knows its anchor');
 await press(canvasAt.x+canvasAt.w-120,canvasAt.y+canvasAt.h-160);await key('Escape','Escape',27);await wait('!document.querySelector("#lienzo-extension-tool-qa-pop")','Esc closes a popover');

 // 5. A panel with its title bar and accent; lienzo.ui.set switches it to fullscreen and back without a reload.
 const sw=`<style>html,body{margin:0;height:100%;font:13px/1.45 system-ui,sans-serif}.p{padding:14px}button{font:inherit;padding:6px 12px;border-radius:8px;border:1px solid;cursor:pointer}</style><div class="p"><p id="n"></p><button id="f">Fullscreen</button></div>
<script>var loads=(window.loads=(window.loads||0)+1),mode='';lienzo.onContext(function(c){var k=c.theme.colors;document.body.style.background=k.surface;document.body.style.color=k.foreground});
lienzo.ui.onChange(function(s){mode=s.mode;document.getElementById('n').textContent='Mode: '+s.mode+' · '+s.width+'×'+s.height+' · loaded once: '+(loads===1)});
document.getElementById('f').onclick=function(){lienzo.ui.set({mode:mode==='fullscreen'?'panel':'fullscreen'})};lienzo.keys.bind('f',function(){document.getElementById('f').click()});<\/script>`;
 await ev(`__panelQA.addExtension(${JSON.stringify({id:'qa-switch',kind:'tool',api:1,name:'QA · Switcher',description:'Example data: switches its own mode.',icon:'Maximize2',presentation:{mode:'panel',width:300,height:200,accent:'#d97706'},html:sw})})`);
 await ui({action:'open',extension:'qa-switch'});await wait(`!!document.querySelector('[id="lienzo-extension-qa-switch"] iframe')`);await pause(600);
 await shot('panel-full');
 await press(canvasAt.x+canvasAt.w/2,canvasAt.y+canvasAt.h-200);await key('f','KeyF',70);await pause(600);
 assert.equal(await ev(`document.querySelector('[id="lienzo-extension-tool-qa-switch"]').dataset.mode`),'fullscreen');
 let text=await inFrame(`!!document.getElementById('n')`,`document.getElementById('n').textContent`);assert.match(text,/Mode: fullscreen/);assert.match(text,/loaded once: true/,'switching mode does not reload the page');
 await shot('fullscreen');
 await key('Escape','Escape',27);await wait('!document.querySelector("#lienzo-extension-tool-qa-switch")','Esc closes fullscreen');
 assert.deepEqual(await ev('__panelQA.actions'),[],'nothing was sent to an assistant');
 assert.deepEqual(uncaught.map(u=>u.exception?.description||u.text),[],'something threw');
 console.log('extension ui: ok');
 }finally{ws.close();}
})().catch(e=>{console.error(e);process.exit(1);});
