// Power commands (docs/design.md §42), by real pointer and key events with modifiers, on example data: Alt-drag
// duplicate of two linked cards, Shift-drag on one axis, ⌘D, copy and paste, align left of three, the align row of the
// selection bar, and Settings → Shortcuts opened with ?. Ports: CDP=9222, HTTP=8765, OUT=/tmp unless set.
const assert=require('node:assert/strict');const fs=require('node:fs');
const CDP=process.env.CDP||9222,HTTP=process.env.HTTP||8765,OUT=process.env.OUT||'/tmp',theme=process.argv[2]||'papel';
(async()=>{
 const pages=await(await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
 const page=pages.find(p=>p.type==='page'&&p.url.startsWith(`http://127.0.0.1:${HTTP}/`));if(!page)throw Error('QA page missing');
 const ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((ok,no)=>{ws.addEventListener('open',ok,{once:true});ws.addEventListener('error',no,{once:true});});
 let seq=0;const pending=new Map(),uncaught=[];
 ws.addEventListener('message',e=>{const r=JSON.parse(e.data);if(r.method==='Runtime.exceptionThrown')uncaught.push(r.params.exceptionDetails);if(r.id){const p=pending.get(r.id);if(!p)return;pending.delete(r.id);clearTimeout(p.timer);r.error?p.no(Error(JSON.stringify(r.error))):p.ok(r.result);}});
 const call=(method,params={})=>new Promise((ok,no)=>{const id=++seq;const timer=setTimeout(()=>{pending.delete(id);no(Error('Timeout '+method));},20000);pending.set(id,{ok,no,timer});ws.send(JSON.stringify({id,method,params}));});
 const ev=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails).slice(0,600));return r.result?.value;};
 const wait=async(expression,what=expression)=>{for(let n=0;n<160;n++){if(await ev(expression))return;await new Promise(r=>setTimeout(r,50));}throw Error('Timed out: '+what);};
 const pause=ms=>new Promise(r=>setTimeout(r,ms));
 // CDP modifiers: Alt 1, Ctrl 2, Meta 4, Shift 8.
 const ALT=1,CTRL=2,SHIFT=8;
 const mouse=(type,x,y,modifiers=0,buttons=0)=>call('Input.dispatchMouseEvent',{type,x,y,modifiers,button:type==='mouseMoved'&&!buttons?'none':'left',buttons,clickCount:1});
 const box=id=>ev(`(()=>{const e=document.querySelector('#lienzo-entity-'+${JSON.stringify(id)});if(!e)return null;const r=e.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height}})()`);
 const clickEntity=async(id,modifiers=0)=>{const b=await box(id);const x=b.x+b.w/2,y=b.y+Math.min(22,b.h/2);await mouse('mouseMoved',x,y,modifiers);await mouse('mousePressed',x,y,modifiers,1);await mouse('mouseReleased',x,y,modifiers);await pause(250);};
 const drag=async(id,dx,dy,modifiers=0,mid)=>{const b=await box(id);const x=b.x+b.w/2,y=b.y+Math.min(22,b.h/2);await mouse('mouseMoved',x,y,modifiers);await mouse('mousePressed',x,y,modifiers,1);for(let i=1;i<=12;i++){await mouse('mouseMoved',x+dx*i/12,y+dy*i/12,modifiers,1);await pause(16);}if(mid)await mid();await mouse('mouseReleased',x+dx,y+dy,modifiers);await pause(500);};
 const key=async(k,code,modifiers=0,commands)=>{const vk=k.length===1?k.toUpperCase().charCodeAt(0):({ArrowLeft:37,ArrowUp:38,ArrowRight:39,ArrowDown:40,Escape:27}[k]??0);await call('Input.dispatchKeyEvent',{type:'rawKeyDown',key:k,code,modifiers,windowsVirtualKeyCode:vk,...(commands?{commands}:{})});await call('Input.dispatchKeyEvent',{type:'keyUp',key:k,code,modifiers,windowsVirtualKeyCode:vk});await pause(200);};
 const shot=async name=>{const r=await call('Page.captureScreenshot',{format:'png'});const file=`${OUT}/lienzo-power-${name}-${theme}.png`;fs.writeFileSync(file,Buffer.from(r.data,'base64'));console.log('shot '+file);};
 const doc=()=>ev('__panelQA.doc()'),block=async id=>(await doc()).blocks.find(b=>b.id===id),selection=()=>ev('__panelQA.view().selection??__panelQA.doc().selectedIds');
 const checks=[];const check=async(name,run)=>{try{await run();checks.push({name,result:'pass'});console.log('PASS '+name);}catch(error){checks.push({name,result:'fail',error:error.message});console.log('FAIL '+name+': '+error.message);}};
 try{
  await call('Runtime.enable');await call('Page.enable');await call('Emulation.setDeviceMetricsOverride',{width:1280,height:820,deviceScaleFactor:1,mobile:false});
  await call('Browser.grantPermissions',{permissions:['clipboardReadWrite','clipboardSanitizedWrite'],origin:`http://127.0.0.1:${HTTP}`}).catch(()=>{});
  await call('Page.navigate',{url:`http://127.0.0.1:${HTTP}/?theme=${theme}`});await wait('!!window.__panelQA&&__panelQA.doc().blocks.length>0','panel');await pause(700);
  await ev(`__panelQA.seed([{type:'block.create',block:{id:'third',typeId:'node',title:'Third card (example)',data:{summary:'Example data'},position:{x:620,y:450}}},{type:'group.update',id:'frame',patch:{position:{x:64,y:620}}}])`);
  await wait('!!document.querySelector("#lienzo-entity-third")','third card');await pause(600);
  const original=await doc();

  await check('Alt-drag two linked cards: copies with their link land where let go; the originals stay',async()=>{
   await clickEntity('server');await clickEntity('note',SHIFT);
   await drag('server',40,220,ALT,async()=>{await pause(150);assert.ok(await ev(`!!document.querySelector('#lienzo-copy-ghost-server')&&!!document.querySelector('#lienzo-copy-ghost-note')`),'dashed outlines mark the originals');await shot('alt-drag-held');});
   await wait(`__panelQA.doc().blocks.length===${original.blocks.length+2}`,'two copies');await pause(500);
   const d=await doc(),copies=d.blocks.filter(b=>!original.blocks.some(o=>o.id===b.id));
   for(const id of ['server','note'])assert.deepEqual(d.blocks.find(b=>b.id===id).position,original.blocks.find(b=>b.id===id).position,id+' stays');
   assert.equal(copies.length,2);const s=copies.find(b=>b.title==='Servidor de prueba'),n=copies.find(b=>b.title==='Nota de prueba');
   assert.ok(s&&n,'copies keep their titles');assert.ok(s.position.y-original.blocks.find(b=>b.id==='server').position.y>150,'copy dropped lower');
   assert.ok(d.links.some(l=>l.from===s.id&&l.to===n.id),'the link between the copies is copied');
   assert.ok(!await ev(`!!document.querySelector('#lienzo-copy-ghost-server')`),'outline gone after the drop');
   await shot('alt-drag-dropped');
  });
  await check('Shift-drag keeps the larger axis',async()=>{
   await key('Escape','Escape');await clickEntity('third');const before=(await block('third')).position;
   await drag('third',-180,46,SHIFT);await pause(300);const after=(await block('third')).position;
   assert.equal(after.y,before.y,'no vertical movement');assert.ok(before.x-after.x>150,'moved left: '+JSON.stringify([before,after]));
  });
  await check('⌘D duplicates in place, 16 units down and right, and selects the copy',async()=>{
   const before=await doc(),src=before.blocks.find(b=>b.id==='third');
   await key('d','KeyD',CTRL);await wait(`__panelQA.doc().blocks.length===${before.blocks.length+1}`,'a copy');await pause(400);
   const copy=(await doc()).blocks.find(b=>!before.blocks.some(o=>o.id===b.id));
   assert.deepEqual(copy.position,{x:src.position.x+16,y:src.position.y+16});
   await shot('mod-d');
  });
  await check('⌘C then ⌘V pastes a copy under the pointer with fresh ids',async()=>{
   await key('Escape','Escape');await clickEntity('note');const before=await doc();
   await key('c','KeyC',CTRL,['copy']);await pause(300);
   await mouse('mouseMoved',980,640);await pause(100);
   await key('v','KeyV',CTRL,['paste']);await wait(`__panelQA.doc().blocks.length===${before.blocks.length+1}`,'pasted');await pause(500);
   const pasted=(await doc()).blocks.find(b=>!before.blocks.some(o=>o.id===b.id)),b=await box(pasted.id);
   assert.equal(pasted.title,'Nota de prueba');assert.ok(Math.abs(b.x+b.w/2-980)<12&&Math.abs(b.y+b.h/2-640)<40,'centred under the pointer: '+JSON.stringify(b));
   await shot('paste');
  });
  await check('Align left of three things with ⌥A, from the selection bar row too',async()=>{
   await key('Escape','Escape');await clickEntity('server');await clickEntity('note',SHIFT);await clickEntity('third',SHIFT);
   await key('a','KeyA',ALT);await pause(700);
   let d=await doc(),xs=['server','note','third'].map(id=>d.blocks.find(b=>b.id===id).position.x);
   assert.equal(new Set(xs).size,1,'one left edge: '+xs);
   await shot('aligned-left');
   await wait(`!!document.querySelector('#lienzo-selection-align')`,'align button');
   const b=await ev(`(()=>{const r=document.querySelector('#lienzo-selection-align').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
   await mouse('mouseMoved',b.x,b.y);await mouse('mousePressed',b.x,b.y,0,1);await mouse('mouseReleased',b.x,b.y);await wait(`!!document.querySelector('#lienzo-selection-arrange')`,'align row');await pause(300);
   await shot('align-row');
   const right=await ev(`(()=>{const r=document.querySelector('#lienzo-arrange-alignRight').getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
   await mouse('mouseMoved',right.x,right.y);await mouse('mousePressed',right.x,right.y,0,1);await mouse('mouseReleased',right.x,right.y);await pause(800);
   const edges=[];for(const id of ['server','note','third']){const b=await box(id);edges.push(Math.round(b.x+b.w));}
   assert.ok(Math.max(...edges)-Math.min(...edges)<=1,'one right edge from the row: '+edges);
   await shot('aligned-right');
  });
  await check('? opens Settings → Shortcuts, with the Arrange and Pointer groups',async()=>{
   await key('Escape','Escape');await mouse('mouseMoved',1000,700);await mouse('mousePressed',1000,700,0,1);await mouse('mouseReleased',1000,700);await pause(300);
   await key('?','Slash',SHIFT);await wait(`!!document.querySelector('#lienzo-settings-shortcuts')`,'shortcuts');await pause(400);
   const text=await ev(`document.querySelector('#lienzo-settings-shortcuts').textContent`);
   for(const word of ['Arrange','Align left','Distribute horizontally','Pointer','Duplicate while dragging','Paste in place','Copy'])assert.ok(text.includes(word),word);
   await ev(`(()=>{const e=[...document.querySelectorAll('#lienzo-settings-shortcuts *')].find(e=>e.textContent==='Arrange');e?.scrollIntoView({block:'start'});})()`);await pause(300);
   await shot('shortcuts');
  });
  assert.equal(await ev('__panelQA.actions.length'),0,'nothing sent to an agent');
  assert.deepEqual(uncaught,[],'no uncaught exceptions');
 }finally{fs.writeFileSync(`${OUT}/lienzo-power-${theme}.json`,JSON.stringify({checks,uncaught:uncaught.length},null,1));ws.close();}
 if(checks.some(c=>c.result==='fail'))process.exitCode=1;
})().catch(e=>{console.error(e);process.exitCode=1;});
