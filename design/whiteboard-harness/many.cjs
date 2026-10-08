const assert=require('node:assert/strict');const fs=require('node:fs');
(async()=>{
 const pages=await(await fetch('http://127.0.0.1:9222/json/list')).json();
 const page=pages.find(p=>p.type==='page'&&p.url.startsWith('http://127.0.0.1:8765/'));if(!page)throw Error('QA page missing');
 const ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((ok,no)=>{ws.addEventListener('open',ok,{once:true});ws.addEventListener('error',no,{once:true});});
 let seq=0;const pending=new Map(),uncaught=[];
 ws.addEventListener('message',e=>{const r=JSON.parse(e.data);if(r.method==='Runtime.exceptionThrown')uncaught.push(r.params.exceptionDetails);if(r.id){const p=pending.get(r.id);if(!p)return;pending.delete(r.id);clearTimeout(p.timer);r.error?p.no(Error(JSON.stringify(r.error))):p.ok(r.result);}});
 const call=(method,params={})=>new Promise((ok,no)=>{const id=++seq;const timer=setTimeout(()=>{pending.delete(id);no(Error('Timeout '+method));},15000);pending.set(id,{ok,no,timer});ws.send(JSON.stringify({id,method,params}));});
 const ev=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result?.value;};
 const wait=async expression=>{for(let n=0;n<150;n++){if(await ev(expression))return;await new Promise(r=>setTimeout(r,50));}throw Error('Condition timed out: '+expression);};
 const box=async selector=>{const r=await ev(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing '+${JSON.stringify(selector)});const r=e.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height}})()`);return r;};
 const mouse=(type,x,y,button='left',buttons=0)=>call('Input.dispatchMouseEvent',{type,x,y,button,buttons,clickCount:1});
 const click=async(selector,offset)=>{await wait(`document.querySelector(${JSON.stringify(selector)})?.getAttribute('aria-disabled')!=='true'`);await ev('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');const b=await box(selector),x=b.x+(offset?.x??b.w/2),y=b.y+(offset?.y??b.h/2);await mouse('mousePressed',x,y,'left',1);await mouse('mouseReleased',x,y);};
 const drag=async(selector,dx,dy,button='left',offset)=>{const b=await box(selector),x=b.x+(offset?.x??70),y=b.y+(offset?.y??b.h-20),bits=button==='middle'?4:1;await mouse('mouseMoved',x,y);await mouse('mousePressed',x,y,button,bits);for(let i=1;i<=20;i++){await mouse('mouseMoved',x+dx*i/20,y+dy*i/20,button,bits);await new Promise(r=>setTimeout(r,9));}if(button==='middle')await new Promise(r=>setTimeout(r,120));await mouse('mouseReleased',x+dx,y+dy,button);};
 const key=async(key,code,modifiers=0)=>{await call('Input.dispatchKeyEvent',{type:'keyDown',key,code,modifiers});await call('Input.dispatchKeyEvent',{type:'keyUp',key,code,modifiers});};
 const label=text=>'[aria-label='+JSON.stringify(text)+']';
 const shot=async name=>{const r=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync('/tmp/lienzo-wb-'+name+'.png',Buffer.from(r.data,'base64'));};
 const checks=[];const check=async(name,run)=>{try{await run();checks.push({name,result:'pass'});console.log('PASS '+name);}catch(error){checks.push({name,result:'fail',error:error.message});console.log('FAIL '+name+': '+error.message);throw error;}};
 try{
 await call('Runtime.enable');await call('Page.enable');await call('Network.enable');await call('Network.setCacheDisabled',{cacheDisabled:true});
 await call('Page.navigate',{url:'http://127.0.0.1:8765/?theme=papel'});await wait('!!document.querySelector("#lienzo-entity-note")');
 await ev(`__panelQA.seed(Array.from({length:148},(_,i)=>({type:'block.create',block:{id:'many-'+i,typeId:'node',title:'Nodo '+i,data:{kind:'MODULE',status:'ready',summary:'Documento de ejemplo con 150 bloques.'},position:{x:64+(i%15)*260,y:96+Math.floor(i/15)*128}}})))`);
 await wait('__panelQA.doc().blocks.length===150&&!!document.querySelector("#lienzo-entity-many-147")');await new Promise(r=>setTimeout(r,800));await click(label('Ajustar al lienzo'));await new Promise(r=>setTimeout(r,700));
 let measurements;
 await check('150-block scene supports passive body drag with one persistence transaction',async()=>{
  const id='many-80',before=await ev('__panelQA.doc().blocks.find(b=>b.id==="'+id+'").position');
  await ev(`window.__frames=[];window.__measure=true;let previous=performance.now();const step=now=>{if(!__measure)return;__frames.push(now-previous);previous=now;requestAnimationFrame(step)};requestAnimationFrame(step)`);
  const b=await box('#lienzo-entity-'+id),x=b.x+20,y=b.y+b.h-9;await mouse('mousePressed',x,y,'left',1);for(let i=1;i<=60;i++){await mouse('mouseMoved',x+i*.9,y+i*.45,'left',1);await new Promise(r=>setTimeout(r,12));}await mouse('mouseReleased',x+54,y+27);await wait('__panelQA.log.length===1');await new Promise(r=>setTimeout(r,600));await ev('__measure=false');
  assert.notDeepEqual(await ev('__panelQA.doc().blocks.find(b=>b.id==="'+id+'").position'),before);measurements=await ev(`(()=>{const a=__frames.sort((a,b)=>a-b);return{frames:a.length,median:a[Math.floor(a.length*.5)],p95:a[Math.floor(a.length*.95)],max:a.at(-1)}})()`);assert.ok(measurements.frames>35);console.log('FRAME_TIMES '+JSON.stringify(measurements));
 });
 await shot('many');fs.writeFileSync('/tmp/lienzo-wb-many-perf.json',JSON.stringify(measurements,null,2));
 fs.writeFileSync('/tmp/lienzo-wb-many.json',JSON.stringify({checks,uncaught},null,2));assert.deepEqual(uncaught,[]);
 }finally{fs.writeFileSync('/tmp/lienzo-wb-many-result.json',JSON.stringify({checks,uncaught},null,2));ws.close();}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
