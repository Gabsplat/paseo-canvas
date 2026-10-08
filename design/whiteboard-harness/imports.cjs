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
 const fill=async(name,text)=>{await click(label(name));await key('a','KeyA',2);await call('Input.insertText',{text});};
 const openImport=async()=>{await click(label('Biblioteca'));await click(label('Importar SVG…'));await wait(`!!document.querySelector(${JSON.stringify(label('Pegar código SVG'))})`);};
 await check('pasted SVG saves sanitized markup and authoritative viewBox',async()=>{
  await openImport();await fill('Pegar código SVG','<svg viewBox="0 0 120 80" xmlns="http://www.w3.org/2000/svg"><rect width="120" height="80" fill="currentColor"/></svg>');await click(label('Insertar código SVG'));await wait('__panelQA.doc().blocks.filter(b=>b.typeId==="wb-svg").length===1');assert.deepEqual(await ev('__panelQA.doc().blocks.find(b=>b.typeId==="wb-svg").data.viewBox'),[0,0,120,80]);await wait(`!document.querySelector(${JSON.stringify(label('Pegar código SVG'))})`);
 });
 await check('active SVG is rejected without persisting or inserting inline markup',async()=>{
  await openImport();const rev=await ev('__panelQA.doc().revision');await fill('Pegar código SVG','<svg viewBox="0 0 100 100"><script>window.hacked=true</script><rect width="100" height="100"/></svg>');await click(label('Insertar código SVG'));await wait('document.body.innerText.includes("No se guardó el SVG")||document.body.innerText.includes("contiene contenido activo")');assert.equal(await ev('__panelQA.doc().revision'),rev);assert.equal(await ev('window.hacked'),undefined);await click(label('Cerrar modal'));
 });
 await check('SVG URL fetch is bounded and persists a validated static resource',async()=>{
  await openImport();await fill('URL del SVG','http://127.0.0.1:8765/fixtures/icon.svg');await click(label('Cargar URL'));await wait('__panelQA.doc().blocks.filter(b=>b.typeId==="wb-svg").length===2');await wait(`!document.querySelector(${JSON.stringify(label('Pegar código SVG'))})`);assert.equal(await ev('__panelQA.doc().blocks.filter(b=>b.typeId==="wb-svg").at(-1).data.svg.includes("<linearGradient")'),true);
 });
 await check('SVG file picker loads a static file and saves through the ordinary reducer',async()=>{
  await openImport();await call('Page.setInterceptFileChooserDialog',{enabled:true});let chooser;const seen=e=>{const r=JSON.parse(e.data);if(r.method==='Page.fileChooserOpened')chooser=r.params;};ws.addEventListener('message',seen);await click(label('Elegir archivo SVG'));for(let i=0;i<50&&!chooser;i++)await new Promise(r=>setTimeout(r,30));assert.ok(chooser);await call('DOM.setFileInputFiles',{files:[require('node:path').resolve(__dirname,'fixtures/icon.svg')],backendNodeId:chooser.backendNodeId});ws.removeEventListener('message',seen);await wait('__panelQA.doc().blocks.filter(b=>b.typeId==="wb-svg").length===3');await wait(`!document.querySelector(${JSON.stringify(label('Pegar código SVG'))})`);
 });
 await shot('imports');
 fs.writeFileSync('/tmp/lienzo-wb-imports.json',JSON.stringify({checks,uncaught},null,2));assert.deepEqual(uncaught,[]);
 }finally{fs.writeFileSync('/tmp/lienzo-wb-imports-result.json',JSON.stringify({checks,uncaught},null,2));ws.close();}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
