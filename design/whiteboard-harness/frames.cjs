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
 await ev(`__panelQA.seed([{type:'block.create',block:{id:'site',typeId:'preview',title:'Sitio QA',data:{description:'Web local de ejemplo',url:'http://127.0.0.1:8765/fixtures/frame.html'},position:{x:780,y:300},size:{width:420,height:330}}}])`);
 await wait('!!document.querySelector("#lienzo-entity-site iframe")');
 await ev(`window.__frameMessages=[];addEventListener('message',e=>{if(e.data?.kind==='qa-frame')__frameMessages.push(e.data)})`);
 const frameSelector='#lienzo-entity-site iframe';
 await check('inactive iframe shield permits body drag and preserves its content',async()=>{
  const before=await ev('__panelQA.doc().blocks.find(b=>b.id==="site").position');await drag('#lienzo-entity-site',60,36,'left',{x:90,y:160});await wait('__panelQA.doc().blocks.find(b=>b.id==="site").position.x>'+before.x);assert.equal(await ev('document.querySelector("#lienzo-entity-site [data-lienzo-interacting]").dataset.lienzoInteracting'),'false');
 });
 await check('middle button and wheel pan over an inactive iframe without changing document',async()=>{
  const before=await box('#lienzo-entity-site'),rev=await ev('__panelQA.doc().revision');await drag('#lienzo-entity-site',55,25,'middle',{x:80,y:160});const after=await box('#lienzo-entity-site');assert.ok(after.x>before.x+40);assert.equal(await ev('__panelQA.doc().revision'),rev);
  const f=await box(frameSelector);await call('Input.dispatchMouseEvent',{type:'mouseWheel',x:f.x+100,y:f.y+80,deltaY:45,deltaX:0});await wait(`document.querySelector('#lienzo-entity-site').getBoundingClientRect().y<${after.y-35}`);assert.equal(await ev('__panelQA.doc().revision'),rev);
 });
 await check('interaction mode opens the live iframe for form entry and scroll; its exit restores the shield',async()=>{
  await click('#lienzo-grab-site-header',{x:80,y:10});await click(label('Interactuar'));await wait('!!document.querySelector("#lienzo-interaction-exit-site")');assert.equal(await ev('document.querySelector("#lienzo-entity-site [data-lienzo-interacting]").dataset.lienzoInteracting'),'true');assert.equal(await ev(`!!document.querySelector(${JSON.stringify(label('Preguntar'))})`),false);
  const f=await box(frameSelector),pos=await ev('__panelQA.doc().blocks.find(b=>b.id==="site").position');await mouse('mousePressed',f.x+150,f.y+34,'left',1);await mouse('mouseReleased',f.x+150,f.y+34);await call('Input.insertText',{text:'Web interactiva'});await mouse('mousePressed',f.x+52,f.y+90,'left',1);await mouse('mouseReleased',f.x+52,f.y+90);await wait('__frameMessages.some(e=>e.value==="Web interactiva")');
  await call('Input.dispatchMouseEvent',{type:'mouseWheel',x:f.x+80,y:f.y+180,deltaY:95,deltaX:0});await new Promise(r=>setTimeout(r,150));assert.deepEqual(await ev('__panelQA.doc().blocks.find(b=>b.id==="site").position'),pos);await click(label('Salir del modo interacción'));await wait('!document.querySelector("#lienzo-interaction-exit-site")');assert.equal(await ev('document.querySelector("#lienzo-entity-site [data-lienzo-interacting]").dataset.lienzoInteracting'),'false');
 });
 await shot('frames');
 fs.writeFileSync('/tmp/lienzo-wb-frames.json',JSON.stringify({checks,uncaught},null,2));assert.deepEqual(uncaught,[]);
 }finally{fs.writeFileSync('/tmp/lienzo-wb-frames-result.json',JSON.stringify({checks,uncaught},null,2));ws.close();}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
