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
  await call('Page.navigate',{url:'http://127.0.0.1:8765/?compact&theme='+theme});await wait('!!document.querySelector("#lienzo-toolbar")&&!!document.querySelector("#lienzo-outline")');
  await check('compact '+theme+' shows Lista, a scrolling toolbar above the composer, and creates free text',async()=>{
   const bar=await box('#lienzo-toolbar'),composer=await box('#lienzo-composer');assert.ok(bar.y+bar.h<=composer.y+1,'toolbar above the composer');assert.ok(bar.x>=0&&bar.x+bar.w<=390,'within the panel');
   assert.equal(await ev(`Math.round(document.querySelector('#lienzo-tool-text').getBoundingClientRect().height)`),44,'touch-sized tools');
   assert.equal(await ev(`!!document.querySelector('[aria-label="Change view"],[aria-label="Cambiar vista"]')`),false,'no view switcher');
   await shot('compact-list-'+theme);
   await click('#lienzo-tool-text');await wait('!!document.querySelector("#lienzo-canvas-viewport")','a drawing tool shows the canvas');
   await mouse('mousePressed',200,320,'left',1);await mouse('mouseReleased',200,320);await wait('!!document.querySelector("#lienzo-editor textarea")');await call('Input.insertText',{text:'Free text '+theme});await key('Enter','Enter',2);await wait('__panelQA.doc().blocks.some(b=>b.data.text==="Free text '+theme+'")');assert.equal(await ev('__panelQA.errors.length'),0);await shot('compact-'+theme);
   await click('#lienzo-tool-select');await wait('!!document.querySelector("#lienzo-outline")','Select goes back to Lista');
  });
 }
 await call('Emulation.setDeviceMetricsOverride',{width:760,height:920,deviceScaleFactor:1,mobile:false});await call('Page.navigate',{url:'http://127.0.0.1:8765/?theme=papel'});await wait('!!document.querySelector("#lienzo-toolbar")');await click('#lienzo-tool-shape');
 await check('medium width keeps the toolbar and composer inside, the shape options in Properties, and a reduced zoom',async()=>{
  const tool=await box('#lienzo-toolbar'),composer=await box('#lienzo-composer');assert.ok(tool.x>=0&&tool.x+tool.w<=760);assert.ok(composer.x>=0&&composer.x+composer.w<=760);
  await wait('!!document.querySelector("#lienzo-tool-options")','shape options in the right panel');assert.ok(await ev(`!!document.querySelector('#lienzo-right-panel [aria-label="No fill"]')`));
  const zoom=await box('#lienzo-tools-zoom');assert.ok(zoom.w<64);await click(label('Zoom options'));await wait(`!!document.querySelector(${JSON.stringify(label('Zoom in'))})`);await click(label('Zoom in'));await wait('!document.querySelector("#lienzo-interactive-zoom-menu")');await shot('medium');
 });
 await call('Emulation.clearDeviceMetricsOverride');
 fs.writeFileSync('/tmp/lienzo-wb-compact.json',JSON.stringify({checks,uncaught},null,2));assert.deepEqual(uncaught,[]);
 }finally{await call('Emulation.clearDeviceMetricsOverride');fs.writeFileSync('/tmp/lienzo-wb-compact-result.json',JSON.stringify({checks,uncaught},null,2));ws.close();}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
