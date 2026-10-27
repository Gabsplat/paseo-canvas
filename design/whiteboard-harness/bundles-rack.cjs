// Link bundles dressed like a rack (docs/design.md §46), by real pointer and key events on example data, at 2× for crisp
// screenshots: (a) four sources wired to four targets by eight links, (b) two cards stacked close with three links (one
// card) and three sources over one target, (c) a long sideways bundle across a wide gap, (d) its exit tie dragged off
// the axis, (e) frames in the middle of the bundling morph. Light (`papel`) and dark (`oscuro`).
// Ports: CDP=9222, HTTP=8765, OUT=/tmp unless set.
const assert=require('node:assert/strict');const fs=require('node:fs');
const CDP=process.env.CDP||9222,HTTP=process.env.HTTP||8765,OUT=process.env.OUT||'/tmp',theme=process.argv[2]||'papel',only=process.argv[3]||'';
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
 const ALT=1,SHIFT=8;
 const mouse=(type,x,y,modifiers=0,buttons=0,clickCount=1)=>call('Input.dispatchMouseEvent',{type,x,y,modifiers,button:type==='mouseMoved'&&!buttons?'none':'left',buttons,clickCount});
 const click=async(x,y,modifiers=0)=>{await mouse('mouseMoved',x,y,modifiers);await mouse('mousePressed',x,y,modifiers,1);await mouse('mouseReleased',x,y,modifiers,0);await pause(260);};
 const dragFrom=async(x,y,dx,dy,modifiers=0,mid,settle=600)=>{await mouse('mouseMoved',x,y,modifiers);await mouse('mousePressed',x,y,modifiers,1);for(let i=1;i<=14;i++){await mouse('mouseMoved',x+dx*i/14,y+dy*i/14,modifiers,1);await pause(16);}if(mid)await mid();await mouse('mouseReleased',x+dx,y+dy,modifiers);if(settle)await pause(settle);};
 const box=sel=>ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)return null;const r=e.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height,cx:r.x+r.width/2,cy:r.y+r.height/2}})()`);
 const key=async(k,code,modifiers=0)=>{const vk=k.length===1?k.toUpperCase().charCodeAt(0):({Escape:27}[k]??0);await call('Input.dispatchKeyEvent',{type:'rawKeyDown',key:k,code,modifiers,windowsVirtualKeyCode:vk});await call('Input.dispatchKeyEvent',{type:'keyUp',key:k,code,modifiers,windowsVirtualKeyCode:vk});await pause(250);};
 const shot=async(name,clip)=>{const r=await call('Page.captureScreenshot',{format:'png',...(clip?{clip:{...clip,scale:1}}:{})});const file=`${OUT}/rack-${name}-${theme}.png`;fs.writeFileSync(file,Buffer.from(r.data,'base64'));console.log('shot '+file);};
 const doc=()=>ev('__panelQA.doc()');
 // An empty spot of canvas (nothing but the board under it, away from the links), then a press there clears the selection.
 const empty=async()=>{await key('Escape','Escape');const p=await ev(`(()=>{for(let y=780;y>80;y-=40)for(let x=60;x<1220;x+=40){const e=document.elementFromPoint(x,y);if(e&&!e.closest('[id^="lienzo-entity-"],[id^="lienzo-bundle-"],[role="toolbar"],[role="dialog"],[id^="lienzo-interactive-"],button,svg,[data-link-key]')&&e.getBoundingClientRect().width>600)return{x,y};}return{x:1150,y:770};})()`);await click(p.x,p.y);};
 const checks=[];const check=async(name,run)=>{if(only&&!name.startsWith(only))return;try{await run();checks.push({name,result:'pass'});console.log('PASS '+name);}catch(error){checks.push({name,result:'fail',error:error.message});console.log('FAIL '+name+': '+error.message);}};
 const card=(id,title,x,y)=>({type:'block.create',block:{id,typeId:'node',title,data:{summary:'Example data'},position:{x,y}}});
 const fresh=async(ops)=>{
  await call('Page.navigate',{url:`http://127.0.0.1:${HTTP}/?theme=${theme}`});await wait('!!window.__panelQA&&__panelQA.doc().blocks.length>0','panel');await pause(600);
  await ev(`__panelQA.seed(${JSON.stringify([{type:'block.delete',id:'server'},{type:'block.delete',id:'note'},{type:'group.delete',id:'frame'},...ops])})`);
  await wait(`!!document.querySelector("#lienzo-entity-${ops[0].block.id}")`,'cards');await pause(700);
 };
 /** Region around the given cards, in CSS pixels, for a tight screenshot. */
 const around=async(ids,pad=40)=>{const bs=[];for(const id of ids)bs.push(await box('#lienzo-entity-'+id));const x=Math.max(0,Math.min(...bs.map(b=>b.x))-pad),y=Math.max(0,Math.min(...bs.map(b=>b.y))-pad);return{x,y,width:Math.min(1280-x,Math.max(...bs.map(b=>b.x+b.w))+pad-x),height:Math.min(820-y,Math.max(...bs.map(b=>b.y+b.h))+pad-y)};};
 /** Straight lanes: every path of a bundle, sampled; returns the min distance between two different lanes, as a check that nothing touches. */
 const laneStats=bundle=>ev(`(()=>{const gs=[...document.querySelectorAll('[data-link-key]')].filter(g=>g.getAttribute('data-link-key').startsWith(${JSON.stringify(bundle)}+'~'));
  const pts=gs.map(g=>{const p=g.querySelector('path'),L=p.getTotalLength(),out=[];for(let i=0;i<=200;i++){const q=p.getPointAtLength(L*i/200);out.push([q.x,q.y]);}return out;});
  let min=Infinity;for(let a=0;a<pts.length;a++)for(let b=a+1;b<pts.length;b++)for(const p of pts[a].slice(8,-8))for(const q of pts[b].slice(8,-8))min=Math.min(min,Math.hypot(p[0]-q[0],p[1]-q[1]));return{lanes:gs.length,min};})()`);
 try{
  await call('Runtime.enable');await call('Page.enable');await call('Emulation.setDeviceMetricsOverride',{width:1280,height:820,deviceScaleFactor:2,mobile:false});
  await check('a: four sources to four targets, eight links, Shift-click + ⌘B',async()=>{
   const wires=[['s1','t1','flow','acento'],['s1','t3','depends','violeta'],['s2','t2','flow','turquesa'],['s2','t1','flow','aviso'],['s3','t3','flow','acento'],['s3','t4','reference','turquesa'],['s4','t4','flow','violeta'],['s4','t2','depends','aviso']];
   await fresh([card('s1','Sensor A',-160,110),card('s2','Sensor B',-160,240),card('s3','Sensor C',-160,370),card('s4','Sensor D',-160,500),card('t1','Store',600,90),card('t2','Alerts',600,220),card('t3','Dashboard',600,350),card('t4','Archive',600,480),...wires.map(([from,to,kind,tone],i)=>({type:'link.create',link:{id:'w'+(i+1),from,to,kind,tone}}))]);
   const a=await box('#lienzo-entity-s1'),t=await box('#lienzo-entity-t1'),x=(a.x+a.w+t.x)/2;
   await dragFrom(x,720,0,-640,ALT,null,0);
   let n=0;for(const ms of [95,70,70]){await pause(ms);await shot('e-morph-'+(++n),await around(['s1','s4','t1','t4']));}
   await wait(`(__panelQA.doc().bundles||[]).length===1`,'bundle');await pause(700);await empty();await pause(300);
   await shot('a-four-by-four',await around(['s1','s4','t1','t4']));
   const id=(await doc()).bundles[0].id,stats=await laneStats(id);console.log('lanes',JSON.stringify(stats));assert.equal(stats.lanes,8);
   const s=await box(`#lienzo-bundle-spine-${id}-0`);await click(s.cx,s.cy);await pause(500);await shot('a-selected',await around(['s1','s4','t1','t4']));
   await empty();
  });
  await check('b: two cards stacked close, three links between them',async()=>{
   await fresh([card('up','Certificado de origen',100,100),card('down','Despachante y permiso',100,330),{type:'link.create',link:{id:'b1',from:'up',to:'down',kind:'flow',tone:'violeta'}},{type:'link.create',link:{id:'b2',from:'up',to:'down',kind:'depends',tone:'acento'}},{type:'link.create',link:{id:'b3',from:'up',to:'down',kind:'reference',tone:'turquesa'}}]);
   const u=await box('#lienzo-entity-up'),d=await box('#lienzo-entity-down');console.log('gap px',d.y-u.y-u.h);
   await shot('b-before',await around(['up','down'],60));
   const y=(u.y+u.h+d.y)/2;await dragFrom(u.x-60,y,u.w+120,0,ALT);
   await wait(`(__panelQA.doc().bundles||[]).length===1`,'bundle');await pause(600);await empty();await pause(300);
   await shot('b-stacked',await around(['up','down'],60));
   const id=(await doc()).bundles[0].id,c=await box(`#lienzo-bundle-clip-${id}-0`);assert.ok(c,'one tie');assert.equal(await ev(`document.querySelectorAll('[data-bundle-tie]').length`),1,'a short bundle folds to one tie');
   await click(c.cx,c.cy);await pause(600);await shot('b-selected',await around(['up','down'],170));
   await empty();
  });
  await check('b2: three sources over one target, close',async()=>{
   await fresh([card('l','Factura',-200,100),card('m','Certificado',100,100),card('r','Lista de empaque',400,100),card('down','Despachante y permiso',100,330),{type:'link.create',link:{id:'c1',from:'l',to:'down',kind:'flow',tone:'violeta'}},{type:'link.create',link:{id:'c2',from:'m',to:'down',kind:'flow',tone:'acento'}},{type:'link.create',link:{id:'c3',from:'r',to:'down',kind:'flow',tone:'turquesa'}}]);
   const u=await box('#lienzo-entity-m'),d=await box('#lienzo-entity-down'),l=await box('#lienzo-entity-l'),r=await box('#lienzo-entity-r');
   const y=(u.y+u.h+d.y)/2;await dragFrom(l.x,y,r.x+r.w-l.x,0,ALT);
   await wait(`(__panelQA.doc().bundles||[]).length===1`,'bundle');await pause(600);await empty();await pause(300);
   await shot('b2-three-sources',await around(['l','r','down'],40));
  });
  await check('c: a long sideways bundle across a wide gap; d: its exit tie dragged off the axis',async()=>{
   await fresh([card('a1','Ingest',-300,120),card('a2','Parse',-300,250),card('a3','Validate',-300,380),card('z1','Warehouse',700,140),card('z2','Search index',700,270),card('z3','Audit log',700,400),
    ...[['a1','z1','acento'],['a2','z2','violeta'],['a3','z3','turquesa'],['a1','z2','aviso']].map(([from,to,tone],i)=>({type:'link.create',link:{id:'h'+(i+1),from,to,kind:'flow',tone}}))]);
   const a=await box('#lienzo-entity-a1'),z=await box('#lienzo-entity-z1'),x=(a.x+a.w+z.x)/2;
   await dragFrom(x,720,0,-640,ALT);await wait(`(__panelQA.doc().bundles||[]).length===1`,'bundle');await pause(600);await empty();await pause(300);
   await shot('c-long',await around(['a1','a3','z1','z3']));
   const id=(await doc()).bundles[0].id,stats=await laneStats(id);console.log('lanes',JSON.stringify(stats));
   const c=await box(`#lienzo-bundle-clip-${id}-1`);await dragFrom(c.cx,c.cy,0,70,0,async()=>{await pause(60);await shot('d-dragging',await around(['a1','a3','z1','z3']));});
   await empty();await pause(300);await shot('d-off-axis',await around(['a1','a3','z1','z3']));
   const c0=await box(`#lienzo-bundle-clip-${id}-0`);await dragFrom(c0.cx,c0.cy,0,-14,0);await empty();await pause(300);await shot('d-small-step',await around(['a1','a3','z1','z3']));
  });
  await check('f: unbundle reverses the morph',async()=>{
   await fresh([card('s1','Sensor A',-160,110),card('s2','Sensor B',-160,240),card('t1','Store',600,90),card('t2','Alerts',600,220),...[['s1','t1','acento'],['s1','t2','violeta'],['s2','t2','turquesa']].map(([from,to,tone],i)=>({type:'link.create',link:{id:'u'+(i+1),from,to,kind:'flow',tone}}))]);
   const a=await box('#lienzo-entity-s1'),t=await box('#lienzo-entity-t1'),x=(a.x+a.w+t.x)/2;
   await dragFrom(x,720,0,-640,ALT);await wait(`(__panelQA.doc().bundles||[]).length===1`,'bundle');await pause(700);
   const id=(await doc()).bundles[0].id,c=await box(`#lienzo-bundle-clip-${id}-0`);await click(c.cx,c.cy);await mouse('mousePressed',c.cx,c.cy,0,1,2);await mouse('mouseReleased',c.cx,c.cy,0,0,2);
   await wait(`!__panelQA.doc().bundles`,'unbundled');await pause(90);await shot('f-unbundling',await around(['s1','s2','t1','t2']));await pause(600);await shot('f-unbundled',await around(['s1','s2','t1','t2']));
  });
  assert.equal(await ev('__panelQA.actions.length'),0,'nothing sent to an agent');
  assert.deepEqual(uncaught,[],'no uncaught exceptions');
 }finally{fs.writeFileSync(`${OUT}/rack-${theme}.json`,JSON.stringify({checks,uncaught:uncaught.length},null,1));ws.close();}
 if(checks.some(c=>c.result==='fail'))process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
