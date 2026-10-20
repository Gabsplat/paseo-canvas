// Frames move only by their header (docs/design.md §6.4), with real pointer events on example data. A Frame holds a
// card, a hollow rectangle, a drawing and a text. Dragging each child moves that child and never the Frame; a drag on the
// Frame's empty body draws a selection box; a click there clears the selection; the header moves and selects the Frame.
// A locked Frame does not move from its header nor with the arrow keys, and shows a lock in its header.
// Usage: node frame-drag.cjs [papel|dark]. CDP, HTTP and OUT override the debug port, page port and output prefix.
const assert=require('node:assert/strict');const fs=require('node:fs');
const CDP=process.env.CDP||'9222',HTTP=process.env.HTTP||'8765',theme=process.argv[2]||'papel',OUT=(process.env.OUT||'/tmp/lienzo-frame-drag')+'-'+theme;
(async()=>{
 const pages=await(await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
 const page=pages.find(p=>p.type==='page'&&p.url.startsWith(`http://127.0.0.1:${HTTP}/`));if(!page)throw Error('QA page missing');
 const ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((ok,no)=>{ws.addEventListener('open',ok,{once:true});ws.addEventListener('error',no,{once:true});});
 let seq=0;const pending=new Map(),uncaught=[];
 ws.addEventListener('message',e=>{const r=JSON.parse(e.data);if(r.method==='Runtime.exceptionThrown')uncaught.push(r.params.exceptionDetails);if(r.id){const p=pending.get(r.id);if(!p)return;pending.delete(r.id);clearTimeout(p.timer);r.error?p.no(Error(JSON.stringify(r.error))):p.ok(r.result);}});
 const call=(method,params={})=>new Promise((ok,no)=>{const id=++seq;const timer=setTimeout(()=>{pending.delete(id);no(Error('Timeout '+method));},15000);pending.set(id,{ok,no,timer});ws.send(JSON.stringify({id,method,params}));});
 const ev=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails).slice(0,600));return r.result?.value;};
 const wait=async(expression,what=expression)=>{for(let n=0;n<150;n++){if(await ev(expression))return;await new Promise(r=>setTimeout(r,50));}throw Error('Timed out: '+what);};
 const pause=ms=>new Promise(r=>setTimeout(r,ms));
 const settle=()=>ev('new Promise(r=>setTimeout(()=>requestAnimationFrame(()=>requestAnimationFrame(r)),150))');
 const box=async selector=>ev(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing '+${JSON.stringify(selector)});const r=e.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height}})()`);
 const mouse=(type,x,y,buttons=0,modifiers=0)=>call('Input.dispatchMouseEvent',{type,x,y,modifiers,button:type==='mouseMoved'&&!buttons?'none':'left',buttons,clickCount:1});
 const tap=async(x,y)=>{await mouse('mouseMoved',x,y);await mouse('mousePressed',x,y,1);await mouse('mouseReleased',x,y);await pause(250);};
 const drag=async(x,y,dx,dy,hold)=>{await mouse('mouseMoved',x,y);await mouse('mousePressed',x,y,1);for(let i=1;i<=12;i++){await mouse('mouseMoved',x+dx*i/12,y+dy*i/12,1);await pause(16);}if(hold)await hold();await mouse('mouseReleased',x+dx,y+dy);await pause(600);};
 const key=async(k,code,modifiers=0)=>{const vk={ArrowRight:39,Escape:27}[k]??(k.length===1?k.toUpperCase().charCodeAt(0):0);await call('Input.dispatchKeyEvent',{type:'rawKeyDown',key:k,code,modifiers,windowsVirtualKeyCode:vk});await call('Input.dispatchKeyEvent',{type:'keyUp',key:k,code,modifiers,windowsVirtualKeyCode:vk});await pause(200);};
 const shot=async name=>{await settle();const r=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(`${OUT}-${name}.png`,Buffer.from(r.data,'base64'));};
 const checks=[];const check=async(name,run)=>{try{await run();checks.push({name,result:'pass'});console.log('PASS '+name);}catch(error){checks.push({name,result:'fail',error:error.message});console.log('FAIL '+name+': '+error.message);}};
 const at=id=>ev(`(()=>{const d=__panelQA.doc(),e=[...d.blocks,...d.groups].find(e=>e.id===${JSON.stringify(id)});return e&&e.position})()`);
 // A bare spot of the canvas, away from every entity and island: a click there clears the selection.
 const blank=async()=>{const p=await ev(`(()=>{const v=document.querySelector('#lienzo-canvas-viewport').getBoundingClientRect();for(let y=v.y+v.height-120;y>v.y+80;y-=24)for(let x=v.x+v.width/2;x>v.x+80;x-=24){const e=document.elementFromPoint(x,y);if(e&&!e.closest('[id^="lienzo-entity-"],[role],button,a,input,[id^="lienzo-tools"],[id^="lienzo-interactive-"]'))return{x,y};}return null})()`);assert.ok(p,'a bare spot');await tap(p.x,p.y);await wait('__panelQA.doc().selectedIds.length===0','cleared');};
 const frameAt=()=>at('frame'),selected=()=>ev('__panelQA.doc().selectedIds');
 // The entity a point belongs to, as the page sees it: the topmost lienzo-entity under it.
 const owner=(x,y)=>ev(`(()=>{const e=document.elementFromPoint(${x},${y});return e?.closest('[id^="lienzo-entity-"]')?.id.slice(14)??null})()`);
 try{
 await call('Runtime.enable');await call('Page.enable');await call('Emulation.setDeviceMetricsOverride',{width:1280,height:860,deviceScaleFactor:1,mobile:false});
 await call('Page.navigate',{url:`http://127.0.0.1:${HTTP}/?theme=${theme}`});await wait('!!window.__panelQA&&__panelQA.doc().blocks.length>0','panel');await pause(600);
 await ev(`__panelQA.seed([
  {type:'block.create',block:{id:'fc',typeId:'node',title:'Card in a Frame (example)',data:{summary:'Example data'},position:{x:24,y:56}}},
  {type:'block.create',block:{id:'fshape',typeId:'wb-shape',title:'',position:{x:400,y:56},size:{width:220,height:140},data:{shape:'rect',fill:'none',text:''}}},
  {type:'block.create',block:{id:'fdraw',typeId:'wb-draw',title:'',position:{x:40,y:300},size:{width:180,height:80},data:{extent:{width:180,height:80},strokes:[{points:[0,40,45,0,90,40,135,80,180,40]}]}}},
  {type:'block.create',block:{id:'ftext',typeId:'wb-text',title:'',position:{x:400,y:300},data:{text:'Text in a Frame'}}},
  {type:'group.update',id:'frame',patch:{blockIds:['fc','fshape','fdraw','ftext'],position:{x:64,y:280}}}])`);
 await wait('!!document.querySelector("#lienzo-entity-ftext")&&!!document.querySelector("#lienzo-entity-fdraw path")','children');await pause(800);
 await shot('start');
 const still=async(before,what)=>{const now=await frameAt();assert.deepEqual(now,before,what+': the Frame moved '+JSON.stringify([before,now]));};
 const moved=async(id,before)=>{await wait(`JSON.stringify((()=>{const d=__panelQA.doc();return [...d.blocks,...d.groups].find(e=>e.id==='${id}').position})())!==${JSON.stringify(JSON.stringify(before))}`,id+' moves');};

 await check('dragging a card inside a Frame moves the card, not the Frame',async()=>{
  const f=await frameAt(),c=await at('fc'),b=await box('#lienzo-entity-fc');await drag(b.x+b.w/2,b.y+b.h/2,50,30);await moved('fc',c);await still(f,'card drag');
 });
 await check('dragging a hollow shape by its outline moves the shape, not the Frame',async()=>{
  const f=await frameAt(),s=await at('fshape'),b=await box('#lienzo-entity-fshape'),x=b.x+2,y=b.y+b.h/2;
  assert.equal(await owner(x,y),'fshape','the outline is the shape');await drag(x,y,30,40);await moved('fshape',s);await still(f,'outline drag');
 });
 await check('a drawing inside a Frame is hit on its stroke and drags alone',async()=>{
  const f=await frameAt(),d=await at('fdraw');
  const p=await ev(`(()=>{const path=document.querySelector('#lienzo-entity-fdraw path');const svg=path.ownerSVGElement,pt=path.getPointAtLength(path.getTotalLength()/2),m=svg.getScreenCTM();return{x:pt.x*m.a+m.e,y:pt.y*m.d+m.f}})()`);
  assert.equal(await owner(p.x,p.y),'fdraw','the stroke is the drawing');await drag(p.x,p.y,40,20);await moved('fdraw',d);await still(f,'drawing drag');
 });
 await check('dragging a text inside a Frame moves the text, not the Frame',async()=>{
  const f=await frameAt(),t=await at('ftext'),b=await box('#lienzo-entity-ftext');assert.equal(await owner(b.x+b.w/2,b.y+b.h/2),'ftext','the text is on top');await drag(b.x+b.w/2,b.y+b.h/2,30,30);await moved('ftext',t);await still(f,'text drag');
 });
 // An empty spot of the body: inside the Frame, below its header, owned by the Frame, and not inside the hollow shape.
 const emptySpot=async()=>ev(`(()=>{const f=document.querySelector('#lienzo-entity-frame').getBoundingClientRect(),s=document.querySelector('#lienzo-entity-fshape').getBoundingClientRect();
  for(let y=f.y+f.height-14;y>f.y+50;y-=8)for(let x=f.x+14;x<f.x+f.width-14;x+=8){const e=document.elementFromPoint(x,y);if(e?.closest('[id^="lienzo-entity-"]')?.id!=='lienzo-entity-frame'||e.closest('[id^="lienzo-frame-header-"]'))continue;if(x>s.x-12&&x<s.right+12&&y>s.y-12&&y<s.bottom+12)continue;return{x,y};}return null})()`);
 await check('a click on the empty body clears the selection and does not select the Frame',async()=>{
  await tap((await box('#lienzo-entity-fc')).x+20,(await box('#lienzo-entity-fc')).y+20);await wait(`__panelQA.doc().selectedIds.includes('fc')`,'card selected');
  const p=await emptySpot();assert.ok(p,'an empty spot');await tap(p.x,p.y);await wait('__panelQA.doc().selectedIds.length===0','nothing selected');
 });
 await check('a drag on the empty body draws a selection box and leaves the Frame where it is',async()=>{
  const f=await frameAt(),p=await emptySpot(),c=await box('#lienzo-entity-fc');
  // From below-right of the card, up and left past it: the box takes the card.
  const sx=c.x+c.w+16,sy=c.y+c.h+16,start=await owner(sx,sy)==='frame'?{x:sx,y:sy}:p;
  await drag(start.x,start.y,c.x-8-start.x,c.y-8-start.y,async()=>{await settle();assert.ok(await ev('Number(getComputedStyle(document.querySelector("#lienzo-marquee")).opacity)>0'),'the selection box shows');await shot('body-marquee');});
  await still(f,'body drag');const s=await selected();assert.ok(!s.includes('frame'),'the Frame is not selected: '+s);assert.ok(s.includes('fc'),'the card is in the box: '+s);
 });
 await check('inside a hollow shape in a Frame: a click selects the shape, a drag draws a box, the Frame stays',async()=>{
  const f=await frameAt(),s=await at('fshape'),b=await box('#lienzo-entity-fshape');await tap(b.x+b.w/2,b.y+b.h/2);await wait(`JSON.stringify(__panelQA.doc().selectedIds)==='["fshape"]'`,'shape selected');
  await blank();await drag(b.x+b.w/2,b.y+b.h/2,40,30);await still(f,'interior drag');assert.deepEqual(await at('fshape'),s,'the shape stays');
 });
 await check('the header moves the Frame and selects it; its cursor is the open hand, the body has none',async()=>{
  const f=await frameAt(),h=await box('#lienzo-frame-header-frame');
  // Lienzo draws its own cursors: the header shows the hand a card shows; the body shows the tool's arrow, as the canvas does.
  const look=await ev(`(()=>{const c=e=>getComputedStyle(e).cursor,p=${JSON.stringify(await emptySpot())};return{header:c(document.querySelector('#lienzo-frame-header-frame')),title:c(document.querySelector('#lienzo-grab-frame-title')),card:c(document.querySelector('#lienzo-grab-fc')??document.querySelector('[id^="lienzo-grab-fc"]')),body:c(document.elementFromPoint(p.x,p.y)),canvas:c(document.querySelector('#lienzo-canvas-viewport'))}})()`);
  assert.equal(look.header,look.card,'the header shows the hand');assert.equal(look.title,look.card);assert.notEqual(look.body,look.card,'no hand on the body');assert.equal(look.body,look.canvas,'the body shows what the canvas shows');
  await tap(h.x+h.w-60,h.y+h.h/2);await wait(`JSON.stringify(__panelQA.doc().selectedIds)==='["frame"]'`,'header click selects the Frame');
  await drag(h.x+90,h.y+h.h/2,60,40);await moved('frame',f);
 });
 await check('Shift-drag from the header keeps one axis; arrow keys nudge the selected Frame',async()=>{
  const f=await frameAt(),h=await box('#lienzo-frame-header-frame');
  await mouse('mouseMoved',h.x+90,h.y+h.h/2);await mouse('mousePressed',h.x+90,h.y+h.h/2,1,8);for(let i=1;i<=12;i++){await mouse('mouseMoved',h.x+90+80*i/12,h.y+h.h/2+12*i/12,1,8);await pause(16);}await mouse('mouseReleased',h.x+170,h.y+h.h/2+12,0,8);await pause(600);
  await moved('frame',f);const g=await frameAt();assert.equal(g.y,f.y,'Shift kept the row');
  await key('ArrowRight','ArrowRight');await pause(700);await wait(`__panelQA.doc().groups.find(g=>g.id==='frame').position.x===${g.x+1}`,'nudged');
 });
 await check('Alt-drag from the header leaves the Frame and drops a copy; ⌘D duplicates it',async()=>{
  const f=await frameAt(),n=await ev('__panelQA.doc().groups.length'),h=await box('#lienzo-frame-header-frame'),x=h.x+90,y=h.y+h.h/2;
  await mouse('mouseMoved',x,y);await mouse('mousePressed',x,y,1,1);for(let i=1;i<=12;i++){await mouse('mouseMoved',x+40*i/12,y+260*i/12,1,1);await pause(16);}await mouse('mouseReleased',x+40,y+260,0,1);
  await wait(`__panelQA.doc().groups.length===${n+1}`,'a copy');await still(f,'Alt-drag');
  await blank();const h2=await box('#lienzo-frame-header-frame');await tap(h2.x+h2.w-60,h2.y+h2.h/2);await wait(`JSON.stringify(__panelQA.doc().selectedIds)==='["frame"]'`,'selected');
  await key('d','KeyD',2);await wait(`__panelQA.doc().groups.length===${n+2}`,'⌘D copy');await still(f,'⌘D');
  // Back to one Frame for the rest.
  await ev(`(()=>{const d=__panelQA.doc();__panelQA.seed(d.groups.filter(g=>g.id!=='frame'&&!g.parentGroupId).map(g=>({type:'group.delete',id:g.id})))})()`);await wait(`__panelQA.doc().groups.length===${n}`,'copies gone');await settle();
 });
 await check('a locked Frame shows a lock and moves neither from its header nor with the arrow keys; its children still move',async()=>{
  await ev(`__panelQA.seed([{type:'group.update',id:'frame',patch:{locked:true}}])`);await wait('!!document.querySelector("#lienzo-frame-lock-frame")','lock glyph');
  const f=await frameAt(),h=await box('#lienzo-frame-header-frame');await tap(h.x+h.w-60,h.y+h.h/2);await wait(`JSON.stringify(__panelQA.doc().selectedIds)==='["frame"]'`,'still selectable');
  const look=await ev(`(()=>{const c=e=>getComputedStyle(e).cursor;return{header:c(document.querySelector('#lienzo-frame-header-frame')),card:c(document.querySelector('[id^="lienzo-grab-fc"]'))}})()`);assert.notEqual(look.header,look.card,'no hand on a locked header');
  await shot('locked');
  await drag(h.x+90,h.y+h.h/2,80,50);await still(f,'locked header drag');await key('ArrowRight','ArrowRight');await pause(800);await still(f,'locked nudge');
  const c=await at('fc'),b=await box('#lienzo-entity-fc');await drag(b.x+b.w/2,b.y+b.h/2,24,16);await moved('fc',c);await still(f,'child of a locked Frame');
 });
 await check('Unlock from the selection bar: the header moves the Frame again',async()=>{
  await blank();const h=await box('#lienzo-frame-header-frame');await tap(h.x+h.w-60,h.y+h.h/2);await wait(`JSON.stringify(__panelQA.doc().selectedIds)==='["frame"]'`,'selected');
  const u=await box('#lienzo-selection-lock');await tap(u.x+u.w/2,u.y+u.h/2);await wait(`!__panelQA.doc().groups.find(g=>g.id==='frame').locked`,'unlocked');await wait('!document.querySelector("#lienzo-frame-lock-frame")','lock gone');
  const f=await frameAt(),h2=await box('#lienzo-frame-header-frame');await drag(h2.x+90,h2.y+h2.h/2,-40,30);await moved('frame',f);await shot('end');
 });
 fs.writeFileSync(OUT+'-results.json',JSON.stringify({checks,uncaught},null,2));
 assert.deepEqual(uncaught,[]);assert.ok(checks.every(c=>c.result==='pass'),'every check passes');
 }finally{ws.close();}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
