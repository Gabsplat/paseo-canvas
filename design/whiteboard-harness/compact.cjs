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
 await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
 for(const theme of ['papel','tinta']){
  await call('Page.navigate',{url:'http://127.0.0.1:8765/?compact&theme='+theme});await wait('!!document.querySelector("[aria-label=Herramientas]")');
  await check('compact '+theme+' exposes tools sheet and usable free text creation',async()=>{
   await click(label('Herramientas'));await wait(`!!document.querySelector(${JSON.stringify(label('Texto (T)'))})`);assert.equal(await ev(`document.querySelector('#lienzo-tools').getBoundingClientRect().width`),200);assert.equal(await ev(`document.querySelectorAll('#lienzo-tools [role=button]').length`),8);assert.equal(await ev(`new Set(Array.from(document.querySelectorAll('#lienzo-tools [role=button]'),e=>Math.round(e.getBoundingClientRect().top))).size`),2);await shot('compact-tools-'+theme);await click(label('Texto (T)'));await wait(`!document.querySelector(${JSON.stringify(label('Cerrar modal'))})`);await mouse('mousePressed',200,320,'left',1);await mouse('mouseReleased',200,320);await wait('!!document.querySelector("#lienzo-editor textarea")');await call('Input.insertText',{text:'Texto libre '+theme});await key('Enter','Enter',2);await wait('__panelQA.doc().blocks.some(b=>b.data.text==="Texto libre '+theme+'")');assert.equal(await ev('__panelQA.errors.length'),0);await shot('compact-'+theme);
  });
 }
 await call('Emulation.setDeviceMetricsOverride',{width:760,height:920,deviceScaleFactor:1,mobile:false});await call('Page.navigate',{url:'http://127.0.0.1:8765/?theme=papel'});await wait('!!document.querySelector("#lienzo-tools")');await click(label('Forma (R)'));
 await check('medium width keeps horizontal style above composer with no dead strip',async()=>{
  const tool=await box('#lienzo-tools'),composer=await box('#lienzo-composer');assert.ok(tool.x>=0&&tool.x+tool.w<=760);assert.ok(composer.x>=0&&composer.x+composer.w<=760);await click(label('Más estilo'));await wait(`!!document.querySelector(${JSON.stringify(label('Sin relleno'))})`);await click(label('Cerrar modal'));const zoom=await box('#lienzo-tools-zoom');assert.ok(zoom.w<64);assert.ok(composer.x+composer.w<zoom.x);await click(label('Opciones de zoom'));await wait(`!!document.querySelector(${JSON.stringify(label('Acercar'))})`);await click(label('Acercar'));await wait('!document.querySelector("#lienzo-interactive-zoom-menu")');await shot('medium');
 });
 await call('Emulation.clearDeviceMetricsOverride');
 fs.writeFileSync('/tmp/lienzo-wb-compact.json',JSON.stringify({checks,uncaught},null,2));assert.deepEqual(uncaught,[]);
 }finally{await call('Emulation.clearDeviceMetricsOverride');fs.writeFileSync('/tmp/lienzo-wb-compact-result.json',JSON.stringify({checks,uncaught},null,2));ws.close();}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
