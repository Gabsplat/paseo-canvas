// Link bundles (docs/design.md §46), by real pointer and key events on example data: four source cards wired to four
// targets by eight links; Shift-click picks them, ⌘B bundles them, a clip and a card are dragged, a lane is hovered,
// Unbundle releases them, an Alt-drag cut gathers them again and a double-click on a clip lets go. Light and dark.
// Ports: CDP=9222, HTTP=8765, OUT=/tmp unless set.
const assert=require('node:assert/strict');const fs=require('node:fs');
const CDP=process.env.CDP||9222,HTTP=process.env.HTTP||8765,OUT=process.env.OUT||'/tmp',theme=process.argv[2]||'papel';
(async()=>{
 const pages=await(await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
 const page=pages.find(p=>p.type==='page');if(!page)throw Error('QA page missing');
 const ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((ok,no)=>{ws.addEventListener('open',ok,{once:true});ws.addEventListener('error',no,{once:true});});
 let seq=0;const pending=new Map(),uncaught=[];
 ws.addEventListener('message',e=>{const r=JSON.parse(e.data);if(r.method==='Runtime.exceptionThrown')uncaught.push(r.params.exceptionDetails);if(r.id){const p=pending.get(r.id);if(!p)return;pending.delete(r.id);clearTimeout(p.timer);r.error?p.no(Error(JSON.stringify(r.error))):p.ok(r.result);}});
 const call=(method,params={})=>new Promise((ok,no)=>{const id=++seq;const timer=setTimeout(()=>{pending.delete(id);no(Error('Timeout '+method));},20000);pending.set(id,{ok,no,timer});ws.send(JSON.stringify({id,method,params}));});
 const ev=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails).slice(0,600));return r.result?.value;};
 const wait=async(expression,what=expression)=>{for(let n=0;n<160;n++){if(await ev(expression))return;await new Promise(r=>setTimeout(r,50));}throw Error('Timed out: '+what);};
 const pause=ms=>new Promise(r=>setTimeout(r,ms));
 const ALT=1,CTRL=2,SHIFT=8;
 const mouse=(type,x,y,modifiers=0,buttons=0,clickCount=1)=>call('Input.dispatchMouseEvent',{type,x,y,modifiers,button:type==='mouseMoved'&&!buttons?'none':'left',buttons,clickCount});
 const click=async(x,y,modifiers=0,clickCount=1)=>{await mouse('mouseMoved',x,y,modifiers);await mouse('mousePressed',x,y,modifiers,1,clickCount);await mouse('mouseReleased',x,y,modifiers,0,clickCount);await pause(260);};
 const dragFrom=async(x,y,dx,dy,modifiers=0,mid)=>{await mouse('mouseMoved',x,y,modifiers);await mouse('mousePressed',x,y,modifiers,1);for(let i=1;i<=14;i++){await mouse('mouseMoved',x+dx*i/14,y+dy*i/14,modifiers,1);await pause(16);}if(mid)await mid();await mouse('mouseReleased',x+dx,y+dy,modifiers);await pause(600);};
 const box=sel=>ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;const r=e.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height,cx:r.x+r.width/2,cy:r.y+r.height/2}})()`);
 // A point along a link's drawn path, in screen pixels, near the fraction `at` of its length where nothing covers it
 // (the selection bar floats over the canvas). `exact` keeps the fraction even when covered (for geometry checks).
 const along=(linkId,at,exact=false)=>ev(`(()=>{const l=__panelQA.doc().links.find(l=>l.id===${JSON.stringify(linkId)});const key=[...document.querySelectorAll('[data-link-key]')].map(g=>g.getAttribute('data-link-key')).find(k=>k.endsWith('~'+l.id)||k===l.from+'>'+l.to);const g=document.querySelector('[data-link-key="'+key+'"]'),p=g.querySelector('path'),len=p.getTotalLength(),m=p.getScreenCTM();
  const screen=f=>{const pt=p.getPointAtLength(len*f);return{x:pt.x*m.a+pt.y*m.c+m.e,y:pt.x*m.b+pt.y*m.d+m.f};};if(${exact})return screen(${at});
  for(const d of [0,.04,-.04,.08,-.08,.12,-.12,.2,-.2,.3,-.3]){const f=Math.min(.98,Math.max(.02,${at}+d)),q=screen(f),hit=document.elementFromPoint(q.x,q.y);if(hit&&g.contains(hit))return q;}return screen(${at});})()`);
 const key=async(k,code,modifiers=0)=>{const vk=k.length===1?k.toUpperCase().charCodeAt(0):({Escape:27}[k]??0);await call('Input.dispatchKeyEvent',{type:'rawKeyDown',key:k,code,modifiers,windowsVirtualKeyCode:vk});await call('Input.dispatchKeyEvent',{type:'keyUp',key:k,code,modifiers,windowsVirtualKeyCode:vk});await pause(250);};
 const shot=async name=>{const r=await call('Page.captureScreenshot',{format:'png'});const file=`${OUT}/lienzo-bundles-${name}-${theme}.png`;fs.writeFileSync(file,Buffer.from(r.data,'base64'));console.log('shot '+file);};
 const doc=()=>ev('__panelQA.doc()');
 const empty=async()=>{await key('Escape','Escape');await click(1200,640);};
 const checks=[];const check=async(name,run)=>{try{await run();checks.push({name,result:'pass'});console.log('PASS '+name);}catch(error){checks.push({name,result:'fail',error:error.message});console.log('FAIL '+name+': '+error.message);}};
 try{
  await call('Runtime.enable');await call('Page.enable');await call('Emulation.setDeviceMetricsOverride',{width:1280,height:820,deviceScaleFactor:1,mobile:false});
  await call('Page.navigate',{url:`http://127.0.0.1:${HTTP}/?theme=${theme}`});await wait('!!window.__panelQA&&__panelQA.doc().blocks.length>0','panel');await pause(700);
  const card=(id,title,x,y)=>({type:'block.create',block:{id,typeId:'node',title,data:{summary:'Example data'},position:{x,y}}});
  const wires=[['s1','t1','flow','acento'],['s1','t3','depends','violeta'],['s2','t2','flow','turquesa'],['s2','t1','flow','aviso'],['s3','t3','flow','acento'],['s3','t4','reference','turquesa'],['s4','t4','flow','violeta'],['s4','t2','depends','aviso']];
  await ev(`__panelQA.seed(${JSON.stringify([{type:'block.delete',id:'server'},{type:'block.delete',id:'note'},{type:'group.delete',id:'frame'},
   card('s1','Sensor A',-160,110),card('s2','Sensor B',-160,240),card('s3','Sensor C',-160,370),card('s4','Sensor D',-160,500),
   card('t1','Store',600,90),card('t2','Alerts',600,220),card('t3','Dashboard',600,350),card('t4','Archive',600,480),
   ...wires.map(([from,to,kind,tone],i)=>({type:'link.create',link:{id:'w'+(i+1),from,to,kind,tone}}))])})`);
  await wait('!!document.querySelector("#lienzo-entity-t4")','cards');await pause(900);
  await shot('before');
  let bundleId;
  await check('Shift-click eight links, ⌘B bundles them into one strand between two clips',async()=>{
   for(let i=1;i<=8;i++){const p=await along('w'+i,.12);await click(p.x,p.y,i>1?SHIFT:0);}
   await wait(`!!document.querySelector('#lienzo-selection-bundle')`,'Bundle button');
   assert.match(await ev(`document.querySelector('#lienzo-interactive-selection-toolbar').textContent`),/8 links/);
   await shot('picked');
   await key('b','KeyB',CTRL);await wait(`(__panelQA.doc().bundles||[]).length===1`,'a bundle');await pause(700);
   const d=await doc();bundleId=d.bundles[0].id;assert.ok(d.links.every(l=>l.bundleId===bundleId));
   assert.ok(await ev(`!!document.querySelector('#lienzo-bundle-clip-${bundleId}-0')&&!!document.querySelector('#lienzo-bundle-clip-${bundleId}-1')`),'two clips');
   assert.equal(await ev(`document.querySelectorAll('[data-bundle-tie]').length`),2);
   await shot('bundled');
   await empty();await pause(300);await shot('bundled-rest');
  });
  await check('Drag a clip: it follows live, one write on release',async()=>{
   const before=(await doc()).bundles[0].points,rev=(await doc()).revision,c=await box(`#lienzo-bundle-clip-${bundleId}-0`);
   await dragFrom(c.cx,c.cy,-60,110,0,async()=>{await pause(120);assert.equal((await doc()).revision,rev,'nothing written while held');await shot('clip-held');});
   await wait(`__panelQA.doc().revision===${rev+1}`,'one write');const after=(await doc()).bundles[0].points;
   assert.ok(Math.abs(after[0].x-before[0].x+60)<=3&&Math.abs(after[0].y-before[0].y-110)<=3,JSON.stringify([before,after]));assert.deepEqual(after[1],before[1],'the other clip stays');
   await shot('clip-moved');
  });
  await check('Drag the spine: both clips move',async()=>{
   const before=(await doc()).bundles[0].points,s=await box(`#lienzo-bundle-spine-${bundleId}-0`);
   await dragFrom(s.cx,s.cy,30,-70);const after=(await doc()).bundles[0].points;
   for(const i of [0,1])assert.ok(Math.abs(after[i].x-before[i].x-30)<=3&&Math.abs(after[i].y-before[i].y+70)<=3,JSON.stringify([before,after]));
  });
  await check('Moving a card re-routes its lanes live',async()=>{
   await empty();const b=await box('#lienzo-entity-s1'),before=await along('w1',.02,true);
   await dragFrom(b.cx,b.y+20,-20,-50,0,async()=>{await pause(100);const live=await along('w1',.02,true);assert.ok(Math.abs(live.y-before.y+50)<8,'live: '+JSON.stringify([before,live]));await shot('card-held');});
   await shot('card-moved');
  });
  await check('Hovering a lane lights that whole link',async()=>{
   await empty();const p=await along('w4',.9);await mouse('mouseMoved',p.x,p.y);await pause(400);
   const lit=await ev(`(()=>{const g=[...document.querySelectorAll('[data-link-key]')].find(g=>g.getAttribute('data-link-key').endsWith('~w4'));return +g.querySelector('path').getAttribute('opacity')})()`);
   assert.equal(lit,1);await shot('hover-lane');await mouse('mouseMoved',1200,640);await pause(300);
  });
  await check('Click the strand selects the bundle; Unbundle releases the links',async()=>{
   const s=await box(`#lienzo-bundle-spine-${bundleId}-0`);await click(s.cx,s.cy);
   await wait(`!!document.querySelector('#lienzo-selection-bundle')`,'bundle bar');assert.match(await ev(`document.querySelector('#lienzo-interactive-selection-toolbar').textContent`),/Bundle · 8 links/);
   await shot('bundle-selected');
   const u=await box('#lienzo-selection-bundle');await click(u.cx,u.cy);await wait(`!__panelQA.doc().bundles`,'unbundled');await pause(500);
   assert.ok((await doc()).links.every(l=>!l.bundleId));assert.equal((await doc()).links.length,8,'the links stay');
   await empty();await shot('unbundled');
  });
  await check('Alt-drag a cut across the links gathers them; double-click a clip lets go',async()=>{
   await empty();const a=await box('#lienzo-entity-s1'),t=await box('#lienzo-entity-t1'),x=(a.x+a.w+t.x)/2;
   await dragFrom(x,640,0,-600,ALT,async()=>{await pause(80);await shot('cut-held');});
   await wait(`(__panelQA.doc().bundles||[]).length===1`,'cut bundle');await pause(600);const d=await doc();assert.equal(d.links.filter(l=>l.bundleId).length,8);
   await shot('cut-bundled');
   const id=d.bundles[0].id,c=await box(`#lienzo-bundle-clip-${id}-1`);await click(c.cx,c.cy);await click(c.cx,c.cy,0,2);
   await wait(`!__panelQA.doc().bundles`,'released by double-click');
  });
  assert.equal(await ev('__panelQA.actions.length'),0,'nothing sent to an agent');
  assert.deepEqual(uncaught,[],'no uncaught exceptions');
 }finally{fs.writeFileSync(`${OUT}/lienzo-bundles-${theme}.json`,JSON.stringify({checks,uncaught:uncaught.length},null,1));ws.close();}
 if(checks.some(c=>c.result==='fail'))process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
