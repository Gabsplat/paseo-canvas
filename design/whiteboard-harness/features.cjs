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
 await check('floating tools and composer use small islands over the complete canvas',async()=>{
  const toolBox=await box('#lienzo-tools'),composer=await box('#lienzo-composer');assert.ok(toolBox.w<480);assert.ok(composer.w<720);assert.ok(composer.y>700);
  assert.equal(await ev('document.elementFromPoint(1600,350).closest("#lienzo-tools,#lienzo-composer")'),null);
 });
 await check('free text is a local draft until confirmation and saves as an ordinary chrome-free block',async()=>{
  await click(label('Texto (T)'));await mouse('mousePressed',1120,550,'left',1);await mouse('mouseReleased',1120,550);await wait('!!document.querySelector("#lienzo-editor textarea")');
  assert.equal(await ev('__panelQA.log.length'),0);await call('Input.insertText',{text:'Servidor principal\nAPI y cola'});await key('Enter','Enter',2);
  await wait('__panelQA.doc().blocks.some(b=>b.typeId==="wb-text")');await wait('!document.querySelector("#lienzo-editor")');
  const block=await ev('__panelQA.doc().blocks.find(b=>b.typeId==="wb-text")');assert.equal(block.title,'');assert.equal(block.size,undefined);assert.equal(block.data.text,'Servidor principal\nAPI y cola');
  assert.ok(block.position);assert.equal(await ev('__panelQA.log.length'),1);assert.ok(await ev('!!document.querySelector("#lienzo-entity-'+block.id+'")'));
 });
 await check('text editing is reversible and Escape cancels an empty new draft',async()=>{
  await click(label('Deshacer'));await wait('!__panelQA.doc().blocks.some(b=>b.typeId==="wb-text")');await click(label('Rehacer'));await wait('__panelQA.doc().blocks.some(b=>b.typeId==="wb-text")');
  await click(label('Texto (T)'));await mouse('mousePressed',1300,650,'left',1);await mouse('mouseReleased',1300,650);await wait('!!document.querySelector("#lienzo-editor textarea")');await key('Escape','Escape');
  await wait('!document.querySelector("#lienzo-editor")');assert.equal(await ev('__panelQA.doc().blocks.filter(b=>b.typeId==="wb-text").length'),1);
 });
 await check('shape drag creates a box and free placements leave cards unchanged',async()=>{
  const positions=await ev('__panelQA.doc().blocks.filter(b=>["note","server"].includes(b.id)).map(b=>b.position)');await click(label('Forma (R)'));
  await mouse('mousePressed',1050,290,'left',1);for(let i=1;i<=16;i++){await mouse('mouseMoved',1050+i*11,290+i*7,'left',1);}await mouse('mouseReleased',1226,402);
  await wait('__panelQA.doc().blocks.some(b=>b.typeId==="wb-shape")');const block=await ev('__panelQA.doc().blocks.find(b=>b.typeId==="wb-shape")');assert.equal(block.data.shape,'rect');assert.ok(block.size.width>=170);assert.ok(block.size.height>=105);
  assert.deepEqual(await ev('__panelQA.doc().blocks.filter(b=>["note","server"].includes(b.id)).map(b=>b.position)'),positions);
 });
 await check('shape style changes persist and a corner resize uses one complete transaction',async()=>{
  await wait('!!document.querySelector("[aria-label=Azul]")');await click(label('Azul'));await wait('__panelQA.doc().blocks.find(b=>b.typeId==="wb-shape").data.color==="azul"');await click(label('Suave'));await wait('__panelQA.doc().blocks.find(b=>b.typeId==="wb-shape").data.fill==="wash"');
  const id=await ev('__panelQA.doc().blocks.find(b=>b.typeId==="wb-shape").id'),before=await ev('__panelQA.doc().blocks.find(b=>b.typeId==="wb-shape").size'),count=await ev('__panelQA.log.length');
  await drag('#lienzo-interactive-resize-'+id+'-se',70,50,'left',{x:10,y:10});await wait('__panelQA.log.length>'+count);assert.equal(await ev('__panelQA.log.length'),count+1);const size=await ev('__panelQA.doc().blocks.find(b=>b.typeId==="wb-shape").size');assert.ok(size.width>before.width+50);assert.ok(size.height>before.height+30);
 });
 await check('pencil appends consecutive strokes; eraser removes only the crossed stroke and undo restores it',async()=>{
  await click(label('Lápiz (D)'));await mouse('mousePressed',1250,600,'left',1);for(let i=1;i<=22;i++){await mouse('mouseMoved',1250+i*6,600+Math.sin(i/5)*26,'left',1);}await mouse('mouseReleased',1382,575);
  await wait('__panelQA.doc().blocks.some(b=>b.typeId==="wb-draw")');const id=await ev('__panelQA.doc().blocks.find(b=>b.typeId==="wb-draw").id');
  await mouse('mousePressed',1250,710,'left',1);for(let i=1;i<=22;i++){await mouse('mouseMoved',1250+i*6,710+Math.sin(i/5)*24,'left',1);}await mouse('mouseReleased',1382,687);
  await wait('__panelQA.doc().blocks.find(b=>b.typeId==="wb-draw").data.strokes.length===2');assert.equal(await ev('__panelQA.doc().blocks.filter(b=>b.typeId==="wb-draw").length'),1);
  await click(label('Goma (E)'));await mouse('mousePressed',1250,600,'left',1);await mouse('mouseMoved',1280,610,'left',1);await mouse('mouseReleased',1280,610);
  await wait('__panelQA.doc().blocks.find(b=>b.typeId==="wb-draw").data.strokes.length===1');await click(label('Deshacer'));await wait('__panelQA.doc().blocks.find(b=>b.typeId==="wb-draw").data.strokes.length===2');assert.equal(await ev('__panelQA.doc().blocks.find(b=>b.typeId==="wb-draw").id'),id);
 });
 await check('architecture library inserts a safe SVG with caption and license; imported markup stays outside DOM',async()=>{
  await click(label('Biblioteca'));await wait(`!!document.querySelector(${JSON.stringify(label('Insertar Servidor'))})`);await click(label('Insertar Servidor'));await wait('__panelQA.doc().blocks.some(b=>b.typeId==="wb-svg")');
  const b=await ev('__panelQA.doc().blocks.find(b=>b.typeId==="wb-svg")');assert.equal(b.data.caption,'Servidor');assert.equal(b.data.license,'MIT · Tabler Icons');assert.equal(b.data.source,'tabler:server');await wait('!!document.querySelector("#lienzo-entity-'+b.id+' img")');
  assert.ok(await ev('document.querySelector("#lienzo-entity-'+b.id+' img").src.startsWith("data:image/svg+xml")'));assert.equal(await ev('document.querySelectorAll("#lienzo-entity-'+b.id+' svg").length'),0);await wait(`!document.querySelector(${JSON.stringify(label('Cerrar biblioteca'))})`);
 });
 await check('new text created inside a group stores a parent-relative position',async()=>{
  const frame=await box('#lienzo-entity-frame');await click(label('Texto (T)'));await mouse('mousePressed',frame.x+80,frame.y+70,'left',1);await mouse('mouseReleased',frame.x+80,frame.y+70);await wait('!!document.querySelector("#lienzo-editor textarea")');await call('Input.insertText',{text:'Nota dentro del grupo'});await key('Enter','Enter',2);
  await wait('__panelQA.doc().blocks.some(b=>b.data.text==="Nota dentro del grupo")');const block=await ev('__panelQA.doc().blocks.find(b=>b.data.text==="Nota dentro del grupo")');assert.equal(block.parentGroupId,'frame');assert.ok(block.position.x>=0&&block.position.x<250);assert.ok(block.position.y>=0&&block.position.y<180);
 });
 await shot('features');assert.deepEqual(await ev('__panelQA.errors'),[]);
 fs.writeFileSync('/tmp/lienzo-wb-features.json',JSON.stringify({checks,uncaught},null,2));assert.deepEqual(uncaught,[]);
 }finally{fs.writeFileSync('/tmp/lienzo-wb-features-result.json',JSON.stringify({checks,uncaught},null,2));ws.close();}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
