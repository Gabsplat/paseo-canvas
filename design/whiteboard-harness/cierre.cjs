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
 const probe=`(() => { const Real = window.AudioContext; if (!Real) return; const audio = window.__audio = { contexts: [], starts: 0 };
  window.AudioContext = class extends Real { constructor(...a) { super(...a); audio.contexts.push(this); } };
  const start = OscillatorNode.prototype.start; OscillatorNode.prototype.start = function (...a) { audio.starts++; return start.apply(this, a); }; })();`;
 const pause=ms=>new Promise(r=>setTimeout(r,ms));
 const rectOf=async id=>box('#lienzo-entity-'+id);
 const draws=()=>ev('__panelQA.doc().blocks.filter(b=>b.typeId==="wb-draw").map(b=>({id:b.id,author:b.data.author??null,anchor:b.data.anchor??null,strokes:b.data.strokes.length,parent:b.parentGroupId??null}))');
 const selected=text=>ev(`document.querySelector(${JSON.stringify(label(text))})?.getAttribute('aria-pressed')`);
 const stroke=async(x,y,dx=120)=>{await mouse('mouseMoved',x,y);await mouse('mousePressed',x,y,'left',1);for(let i=1;i<=14;i++){await mouse('mouseMoved',x+dx*i/14,y+Math.sin(i/3)*10,'left',1);await pause(8);}await mouse('mouseReleased',x+dx,y);};
 const soft=async(name,run)=>{try{await run();checks.push({name,result:'pass'});console.log('PASS '+name);}catch(error){const state=await ev('JSON.stringify({tool:[...document.querySelectorAll("#lienzo-tools [aria-pressed=true]")].map(e=>e.getAttribute("aria-label")),focus:document.activeElement.getAttribute("aria-label")||document.activeElement.id||document.activeElement.tagName,selected:__panelQA.doc().selectedIds,errors:__panelQA.errors,banner:[...document.querySelectorAll("[role=alert]")].map(e=>e.innerText).join("|").slice(0,200)})').catch(()=>'');await mouse('mouseReleased',5,5).catch(()=>{});checks.push({name,result:'fail',error:error.message,state});console.log('FAIL '+name+': '+error.message+' '+state);}};
 try{
 await call('Runtime.enable');await call('Page.enable');await call('Network.enable');await call('Network.setCacheDisabled',{cacheDisabled:true});
 await call('Page.addScriptToEvaluateOnNewDocument',{source:probe});
 await call('Page.navigate',{url:'http://127.0.0.1:8765/?theme=papel'});await wait('!!document.querySelector("#lienzo-entity-note")');await pause(400);
 // ---- Trazos (§18.12) ---------------------------------------------------------------------------------------------
 await soft('pencil strokes are signed as the learner; one that starts on a card is anchored to it',async()=>{
  await click(label('Lápiz (D)'));const note=await rectOf('note');
  await stroke(note.x+30,note.y+note.h-24,110);await wait('__panelQA.doc().blocks.some(b=>b.typeId==="wb-draw")');
  await stroke(1300,640,140);await wait('__panelQA.doc().blocks.filter(b=>b.typeId==="wb-draw").length===2');
  const list=await draws();assert.deepEqual(list.map(d=>[d.author,d.anchor,d.strokes]),[['learner','note',1],['learner',null,1]]);
  assert.equal(await ev('__panelQA.actions.length'),0,'no event per stroke');
 });
 await soft('an assistant drawing cannot be signed as the learner and is shown dashed and labelled',async()=>{
  await ev(`__panelQA.seedAgent([{type:'block.create',block:{id:'hint',typeId:'wb-draw',title:'',position:{x:24,y:150},size:{width:140,height:40},data:{extent:{width:140,height:40},strokes:[{points:[0,0,70,40,140,0],color:'azul',weight:'m'}],anchor:'server',author:'learner'}}}])`);
  await wait('!!document.querySelector("#lienzo-entity-hint")');
  assert.equal(await ev('__panelQA.doc().blocks.find(b=>b.id==="hint").data.author'),'assistant');
  assert.ok(await ev('!!document.querySelector("#lienzo-entity-hint path[stroke-dasharray]")'));assert.ok(await ev('document.querySelector("#lienzo-entity-hint").innerText.includes("Asistente")'));
  const mine=(await draws())[0].id;assert.equal(await ev('!!document.querySelector("#lienzo-entity-'+mine+' path[stroke-dasharray]")'),false);
  assert.equal(await ev('document.querySelector("#lienzo-entity-'+mine+'").innerText.includes("Asistente")'),false);await shot('cierre-strokes-authors');
 });
 await soft('leaving the pencil settles exactly one bounded summary without points',async()=>{
  await key('Escape','Escape');await wait('__panelQA.actions.length===1');await pause(300);
  const actions=await ev('__panelQA.actions');assert.equal(actions.length,1);assert.equal(actions[0].kind,'whiteboard.strokes');assert.equal(actions[0].delivery,'batched');assert.equal(actions[0].settled,true);
  assert.deepEqual(actions[0].payload.learner,{drawings:2,strokes:2});assert.deepEqual(actions[0].payload.assistant,{strokes:1});assert.equal(JSON.stringify(actions).includes('points'),false);
 });
 await soft('dragging the card carries its annotation live and commits a single card move',async()=>{
  const mine=(await draws())[0].id,card=await rectOf('note'),ink=await rectOf(mine),count=await ev('__panelQA.log.length');
  const x=card.x+card.w/2,y=card.y+18;await mouse('mouseMoved',x,y);await mouse('mousePressed',x,y,'left',1);for(let i=1;i<=16;i++){await mouse('mouseMoved',x+i*10,y+i*6,'left',1);await pause(10);}
  // The lifted card is scaled about its centre, so its box grows evenly; alignment guides may nudge the drop. The drawing is not scaled.
  const midCard=await rectOf('note'),midInk=await rectOf(mine);await mouse('mouseReleased',x+160,y+96);
  const dx=midCard.x-card.x+(midCard.w-card.w)/2,dy=midCard.y-card.y+(midCard.h-card.h)/2;assert.ok(dx>120&&dy>60,'the card is being dragged');
  assert.ok(Math.abs((midInk.x-ink.x)-dx)<1.5&&Math.abs((midInk.y-ink.y)-dy)<1.5,'the drawing rides with the card during the drag');
  await wait('__panelQA.log.length>'+count);await pause(500);
  const ops=await ev('__panelQA.log.at(-1).operations.filter(o=>o.type==="entity.move").map(o=>o.id)');assert.deepEqual(ops,['note']);
  const endCard=await rectOf('note'),endInk=await rectOf(mine);assert.ok(Math.abs((endInk.x-endCard.x)-(ink.x-card.x))<2&&Math.abs((endInk.y-endCard.y)-(ink.y-card.y))<2,'same offset after saving');await shot('cierre-strokes-followed');
 });
 await soft('"Borrar mis trazos" removes only the learner layers in one undoable transaction',async()=>{
  await click(label('Lápiz (D)'));await wait(`!!document.querySelector(${JSON.stringify(label('Borrar mis trazos'))})`);await shot('cierre-strokes-reset');
  const count=await ev('__panelQA.log.length');await click(label('Borrar mis trazos'));await wait('__panelQA.log.length>'+count);
  assert.equal(await ev('__panelQA.log.at(-1).label'),'Borrar mis trazos');assert.deepEqual((await draws()).map(d=>d.id),['hint']);assert.equal(await ev('__panelQA.log.length'),count+1);
  await wait(`document.querySelector(${JSON.stringify(label('Borrar mis trazos'))})?.getAttribute('aria-disabled')==='true'`);
  await click(label('Deshacer'));await wait('__panelQA.doc().blocks.filter(b=>b.typeId==="wb-draw").length===3');await key('Escape','Escape');await pause(200);
 });
 await soft('deleting a card removes its annotations with it, and undo restores both',async()=>{
  const card=await rectOf('note');await mouse('mousePressed',card.x+card.w/2,card.y+18,'left',1);await mouse('mouseReleased',card.x+card.w/2,card.y+18);await wait('__panelQA.doc().selectedIds.includes("note")');
  await key('Delete','Delete');await wait('!__panelQA.doc().blocks.some(b=>b.id==="note")');
  assert.deepEqual((await draws()).map(d=>d.anchor),[null,'server']);
  await click(label('Deshacer'));await wait('__panelQA.doc().blocks.some(b=>b.id==="note")');assert.equal((await draws()).filter(d=>d.anchor==='note').length,1);
 });
 // ---- Secuenciador inside the v7 Panel ------------------------------------------------------------------------------
 const cell=(row,step)=>`[id="lienzo-interactive-sequencer-cell-seq-${row}-${step}"]`,seq='#lienzo-interactive-renderer-seq ';
 const pattern=()=>ev('__panelQA.runtime().blocks.seq?.pattern ?? null');
 await ev(`__panelQA.seed([{type:'block.create',block:{id:'seq',typeId:'step-sequencer',title:'Secuenciador de ejemplo',position:{x:860,y:330},size:{width:560,height:460},data:{}}}])`);
 await wait(`!!document.querySelector(${JSON.stringify(cell(0,0))})`);await pause(400);
 await soft('a short click on a cell toggles it without Interactuar and without moving the card',async()=>{
  const count=await ev('__panelQA.log.length');await click(cell(0,1));await wait('!!__panelQA.runtime().blocks.seq');
  assert.equal((await pattern())[0],'.x......');assert.equal(await ev('__panelQA.log.length'),count);await shot('cierre-sequencer-panel');
 });
 await soft('tool shortcuts and Space typed on a focused cell stay in the sequencer',async()=>{
  await ev(`document.querySelector(${JSON.stringify(cell(0,3))}).focus()`);
  for(const k of ['d','t','r','e','h','v'])await key(k,'Key'+k.toUpperCase());await pause(150);
  assert.notEqual(await selected('Lápiz (D)'),'true');assert.notEqual(await selected('Goma (E)'),'true');assert.notEqual(await selected('Mano (H)'),'true');assert.equal(await ev('!!document.querySelector("#lienzo-editor")'),false);
  await call('Input.dispatchKeyEvent',{type:'keyDown',key:' ',code:'Space',windowsVirtualKeyCode:32,text:' '});await call('Input.dispatchKeyEvent',{type:'keyUp',key:' ',code:'Space',windowsVirtualKeyCode:32});await pause(150);
  assert.equal((await pattern())[0],'.x.x....');
  await call('Input.dispatchKeyEvent',{type:'keyDown',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39});await call('Input.dispatchKeyEvent',{type:'keyUp',key:'ArrowRight',code:'ArrowRight',windowsVirtualKeyCode:39});await pause(100);
  assert.equal(await ev('document.activeElement.id'),'lienzo-interactive-sequencer-cell-seq-0-4');assert.deepEqual(await ev('__panelQA.doc().blocks.find(b=>b.id==="seq").position'),{x:860,y:330},'arrows did not nudge the card');
  await ev('document.activeElement.blur()');
 });
 await soft('a drag that starts on a cell moves the card and does not toggle the cell',async()=>{
  const before=await pattern(),count=await ev('__panelQA.log.length'),b=await box(cell(2,5)),x=b.x+b.w/2,y=b.y+b.h/2;
  await mouse('mouseMoved',x,y);await mouse('mousePressed',x,y,'left',1);for(let i=1;i<=12;i++){await mouse('mouseMoved',x+i*5,y+i*3,'left',1);await pause(10);}await mouse('mouseReleased',x+60,y+36);
  await wait('__panelQA.log.length>'+count);await pause(400);assert.deepEqual(await ev('__panelQA.log.at(-1).operations.filter(o=>o.type==="entity.move").map(o=>o.id)'),['seq']);assert.deepEqual(await pattern(),before);
 });
 await soft('with the pencil active the grid is drawing surface: no toggle, and the stroke is anchored to the sequencer card',async()=>{
  const before=await pattern();await click(label('Lápiz (D)'));const b=await box(cell(3,2));await stroke(b.x+4,b.y+b.h/2,90);
  await wait('__panelQA.doc().blocks.some(b=>b.typeId==="wb-draw"&&b.data.anchor==="seq")');assert.deepEqual(await pattern(),before);
  // The stroke now lies over cells 2 to 4 and takes presses there, as any whiteboard drawing does, and the Estilo island
  // floats over the card's right edge while the drawing is selected. A clear cell on the left toggles.
  await key('Escape','Escape');await pause(200);await click(cell(3,0));await pause(200);assert.notDeepEqual(await pattern(),before,'back in Seleccionar a cell toggles again');await shot('cierre-sequencer-annotated');
 });
 await soft('listening is credited to the music that sounded: edit then immediate pause is unheard; a full cycle of the final pattern is heard',async()=>{
  const last=()=>ev('__panelQA.actions.filter(a=>a.kind==="step-sequencer.pattern").at(-1)?.payload ?? null');
  await click(seq+label('Reproducir'));await wait('window.__audio.contexts.at(-1)?.state==="running"');await wait('window.__audio.starts>0');
  await pause(3200);await click(cell(4,6));await click(seq+label('Pausar'));
  assert.equal(await ev('window.__audio.contexts.at(-1).state'),'closed');await pause(900);
  const afterEdit=await last();assert.ok(afterEdit,'the edit settled');assert.equal(afterEdit.heard,false,'pattern B never completed a cycle');
  await click(seq+label('Reproducir'));await wait('window.__audio.contexts.at(-1)?.state==="running"');await pause(1200);await click(seq+label('Pausar'));await pause(400);
  assert.equal((await last()).heard,false,'less than one cycle of B');
  await click(seq+label('Reproducir'));await wait('window.__audio.contexts.at(-1)?.state==="running"');await pause(3200);await click(seq+label('Pausar'));
  await wait('__panelQA.actions.filter(a=>a.kind==="step-sequencer.pattern").at(-1)?.payload.heard===true');
  assert.equal(await ev('window.__audio.contexts.filter(c=>c.state!=="closed").length'),0);
  assert.equal(await ev('__panelQA.actions.some(a=>"step" in a.payload||"playhead" in a.payload)'),false);
 });
 await shot('cierre-final');assert.deepEqual(await ev('__panelQA.errors'),[]);
 }finally{checks.push({name:'Uncaught page errors',result:uncaught.length?'fail':'pass',...(uncaught.length?{error:JSON.stringify(uncaught).slice(0,600)}:{})});fs.writeFileSync('/tmp/lienzo-wb-cierre-result.json',JSON.stringify({checks},null,2));console.log(checks.filter(c=>c.result==='pass').length+'/'+checks.length+' checks passed');ws.close();process.exitCode=checks.some(c=>c.result==='fail')?1:0;}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
