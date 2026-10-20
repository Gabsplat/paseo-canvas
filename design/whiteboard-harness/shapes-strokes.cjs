// Hollow shapes and separate strokes, with real mouse input. A rectangle without fill: a click inside selects it, a
// double-click inside edits its label, a press-and-drag on the label moves it (no text selection, no editor). The pencil
// makes one drawing per stroke: select one and delete it, drag the eraser across another (it fades, then goes).
// Usage: node shapes-strokes.cjs [papel|dark]. CDP, HTTP and OUT override the debug port, page port and output prefix.
const assert=require('node:assert/strict');const fs=require('node:fs');
const CDP=process.env.CDP||'9222',HTTP=process.env.HTTP||'8765',theme=process.argv[2]||'papel',OUT=(process.env.OUT||'/tmp/lienzo-strokes')+'-'+theme;
(async()=>{
 const pages=await(await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
 const page=pages.find(p=>p.type==='page'&&p.url.startsWith(`http://127.0.0.1:${HTTP}/`));if(!page)throw Error('QA page missing');
 const ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((ok,no)=>{ws.addEventListener('open',ok,{once:true});ws.addEventListener('error',no,{once:true});});
 let seq=0;const pending=new Map(),uncaught=[];
 ws.addEventListener('message',e=>{const r=JSON.parse(e.data);if(r.method==='Runtime.exceptionThrown')uncaught.push(r.params.exceptionDetails);if(r.id){const p=pending.get(r.id);if(!p)return;pending.delete(r.id);clearTimeout(p.timer);r.error?p.no(Error(JSON.stringify(r.error))):p.ok(r.result);}});
 const call=(method,params={})=>new Promise((ok,no)=>{const id=++seq;const timer=setTimeout(()=>{pending.delete(id);no(Error('Timeout '+method));},15000);pending.set(id,{ok,no,timer});ws.send(JSON.stringify({id,method,params}));});
 const ev=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result?.value;};
 const wait=async expression=>{for(let n=0;n<150;n++){if(await ev(expression))return;await new Promise(r=>setTimeout(r,50));}throw Error('Condition timed out: '+expression);};
 const settle=()=>ev('new Promise(r=>setTimeout(()=>requestAnimationFrame(()=>requestAnimationFrame(r)),150))');
 const box=async selector=>ev(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing '+${JSON.stringify(selector)});const r=e.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height}})()`);
 const mouse=(type,x,y,buttons=0,clickCount=1)=>call('Input.dispatchMouseEvent',{type,x,y,button:'left',buttons,clickCount});
 const tap=async(x,y)=>{await mouse('mousePressed',x,y,1);await mouse('mouseReleased',x,y);};
 const dbl=async(x,y)=>{await mouse('mousePressed',x,y,1,1);await mouse('mouseReleased',x,y,0,1);await mouse('mousePressed',x,y,1,2);await mouse('mouseReleased',x,y,0,2);};
 const drag=async(points,hold)=>{const [a,...rest]=points;await mouse('mousePressed',a[0],a[1],1);for(const [x,y] of rest)await mouse('mouseMoved',x,y,1);if(hold)await hold();const z=points.at(-1);await mouse('mouseReleased',z[0],z[1]);};
 const line=(x0,y0,x1,y1,n=16)=>Array.from({length:n+1},(_,i)=>[x0+(x1-x0)*i/n,y0+(y1-y0)*i/n]);
 const click=async selector=>{await settle();const b=await box(selector);await tap(b.x+b.w/2,b.y+b.h/2);};
 const key=async(key,code,modifiers=0)=>{const vk={Enter:13,Escape:27,Delete:46}[key]??0;await call('Input.dispatchKeyEvent',{type:'keyDown',key,code,modifiers,windowsVirtualKeyCode:vk});await call('Input.dispatchKeyEvent',{type:'keyUp',key,code,modifiers});};
 const shot=async name=>{await settle();const r=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(`${OUT}-${name}.png`,Buffer.from(r.data,'base64'));};
 const checks=[];const check=async(name,run)=>{try{await run();checks.push({name,result:'pass'});console.log('PASS '+name);}catch(error){checks.push({name,result:'fail',error:error.message});console.log('FAIL '+name+': '+error.message);throw error;}};
 const shape='__panelQA.doc().blocks.find(b=>b.typeId==="wb-shape")',draws='__panelQA.doc().blocks.filter(b=>b.typeId==="wb-draw")',selected='__panelQA.doc().selectedIds';
 const editorValue='document.querySelector("#lienzo-editor textarea")?.value';
 try{
 await call('Runtime.enable');await call('Page.enable');await call('Network.enable');await call('Network.setCacheDisabled',{cacheDisabled:true});
 await call('Page.navigate',{url:`http://127.0.0.1:${HTTP}/?theme=${theme}`});await wait('!!document.querySelector("#lienzo-entity-note")');
 const view=await box('#lienzo-canvas-viewport'),X=view.x+view.w*.55,Y=view.y+view.h*.42;let id,s;
 await check('a click inside a hollow rectangle selects it, a double-click inside edits its label, visibly',async()=>{
  await click('#lienzo-tool-shape');await drag(line(X,Y,X+260,Y+170));await wait(shape);id=await ev(shape+'.id');
  assert.equal(await ev(shape+'.data.fill'),'none');
  await key('Escape','Escape');await tap(X+130,Y+260);await wait(selected+'.length===0');
  await tap(X+60,Y+50);await wait(`${selected}.includes("${id}")`);
  await tap(X+130,Y+260);await wait(selected+'.length===0');
  await dbl(X+70,Y+120);await wait('!!document.querySelector("#lienzo-editor textarea")');
  const look=await ev(`(()=>{const t=document.querySelector('#lienzo-editor textarea'),s=getComputedStyle(t);return{placeholder:t.placeholder,caret:s.caretColor,wash:getComputedStyle(t.parentElement).backgroundColor}})()`);
  assert.equal(look.placeholder,'Label');assert.notEqual(look.wash,'rgba(0, 0, 0, 0)','a hollow shape gets a wash behind the label line');
  await shot('hollow-editor-empty');
  await call('Input.insertText',{text:'Inside'});await shot('hollow-editing');
  await key('Enter','Enter',2);await wait(shape+'.data.text==="Inside"');await wait('!document.querySelector("#lienzo-editor")');
  await shot('hollow-label');
 });
 await check('press and drag on the label moves the shape: no text selection, no editor; double-click on it edits',async()=>{
  s=await box('#lienzo-entity-'+id);const before=await ev(shape+'.position'),cx=s.x+s.w/2,cy=s.y+s.h/2;
  await drag(line(cx,cy,cx+90,cy+40,12));await wait(`${shape}.position.x!==${before.x}`);
  const after=await ev(shape+'.position');assert.ok(Math.abs(after.x-before.x-90)<=2&&Math.abs(after.y-before.y-40)<=2,JSON.stringify([before,after]));
  assert.equal(await ev('String(getSelection())'),'','no text was selected');assert.equal(await ev('!!document.querySelector("#lienzo-editor")'),false,'no editor opened');
  const userSelect=await ev(`(()=>{const n=[...document.querySelectorAll('#lienzo-entity-${id} div')].find(e=>e.children.length===0&&e.textContent==='Inside');return getComputedStyle(n).userSelect})()`);assert.equal(userSelect,'none');
  await settle();s=await box('#lienzo-entity-'+id);await dbl(s.x+s.w/2,s.y+s.h/2);await wait('!!document.querySelector("#lienzo-editor textarea")');
  assert.equal(await ev(editorValue),'Inside');await key('Escape','Escape');await wait('!document.querySelector("#lienzo-editor")');
 });
 await check('three pen strokes are three drawings, one undo step each',async()=>{
  await tap(X+130,Y+300);await click('#lienzo-tool-pencil');const base=await ev('__panelQA.log.length');
  const SY=Y-150;for(let i=0;i<3;i++)await drag(Array.from({length:21},(_,k)=>[X-260+k*12,SY+i*42+Math.sin(k/3)*10]));
  await wait(draws+'.length===3');assert.deepEqual(await ev(draws+'.map(b=>b.data.strokes.length)'),[1,1,1]);
  assert.equal(await ev('__panelQA.log.length')-base,3);await shot('three-strokes');
 });
 await check('select one stroke and delete it',async()=>{
  await key('Escape','Escape');const ids=await ev(draws+'.map(b=>b.id)'),b=await box('#lienzo-entity-'+ids[1]);
  const p=await ev(`(()=>{const path=document.querySelector('#lienzo-entity-${ids[1]} path');const svg=path.ownerSVGElement,pt=path.getPointAtLength(path.getTotalLength()/2),m=svg.getScreenCTM();return{x:pt.x*m.a+m.e,y:pt.y*m.d+m.f}})()`);
  await tap(p.x,p.y);await wait(`${selected}.length===1&&${selected}[0]==="${ids[1]}"`);await shot('stroke-selected');
  await key('Delete','Delete');await wait(draws+'.length===2');assert.deepEqual(await ev(draws+'.map(b=>b.id)'),[ids[0],ids[2]]);
 });
 await check('the eraser fades the stroke it crosses and removes it on release, in one step',async()=>{
  const ids=await ev(draws+'.map(b=>b.id)'),b=await box('#lienzo-entity-'+ids[1]);await click('#lienzo-tool-eraser');const base=await ev('__panelQA.log.length');
  const cx=b.x+b.w/2;await drag(line(cx,b.y-30,cx+10,b.y+b.h+20,10),async()=>{await settle();
   const opacity=await ev(`document.querySelector('#lienzo-entity-${ids[1]} path').getAttribute('opacity')`);assert.equal(Number(opacity),.22,'fading while held');
   assert.equal(await ev(`document.querySelector('#lienzo-entity-${ids[0]} path').getAttribute('opacity')`),null,'untouched stroke stays');await shot('eraser-fading');});
  await wait(draws+'.length===1');assert.deepEqual(await ev(draws+'.map(b=>b.id)'),[ids[0]]);assert.equal(await ev('__panelQA.log.length')-base,1);
  await key('Escape','Escape');await shot('after-erase');
 });
 fs.writeFileSync(OUT+'-results.json',JSON.stringify({checks,uncaught},null,2));assert.deepEqual(uncaught,[]);
 }finally{ws.close();}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
