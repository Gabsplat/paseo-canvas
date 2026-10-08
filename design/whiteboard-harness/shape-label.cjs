// Shape label: edited in place at the centre of the shape, in the label's own colour; fill colour
// independent of the outline; S/M/L/XL sizes the label together with the outline.
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
 const box=async selector=>ev(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing '+${JSON.stringify(selector)});const r=e.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height}})()`);
 const mouse=(type,x,y,button='left',buttons=0)=>call('Input.dispatchMouseEvent',{type,x,y,button,buttons,clickCount:1});
 const click=async selector=>{await ev('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');const b=await box(selector),x=b.x+b.w/2,y=b.y+b.h/2;await mouse('mousePressed',x,y,'left',1);await mouse('mouseReleased',x,y);};
 const key=async(key,code,modifiers=0)=>{await call('Input.dispatchKeyEvent',{type:'keyDown',key,code,modifiers,windowsVirtualKeyCode:key==='Enter'?13:key==='Escape'?27:0});await call('Input.dispatchKeyEvent',{type:'keyUp',key,code,modifiers});};
 const label=text=>'[aria-label='+JSON.stringify(text)+']';
 const shot=async name=>{const r=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync('/tmp/lienzo-shape-'+name+'.png',Buffer.from(r.data,'base64'));};
 const checks=[];const check=async(name,run)=>{try{await run();checks.push({name,result:'pass'});console.log('PASS '+name);}catch(error){checks.push({name,result:'fail',error:error.message});console.log('FAIL '+name+': '+error.message);throw error;}};
 const shape='__panelQA.doc().blocks.find(b=>b.typeId==="wb-shape")';
 const centre=b=>({x:b.x+b.w/2,y:b.y+b.h/2});
 const labelInfo=`(()=>{const id=${shape}.id,root=document.querySelector('#lienzo-entity-'+id),text=${shape}.data.text;const node=[...root.querySelectorAll('div')].find(e=>e.children.length===0&&e.textContent===text);if(!node)return null;const r=node.getBoundingClientRect(),s=getComputedStyle(node);return{x:r.x,y:r.y,w:r.width,h:r.height,color:s.color,fontSize:s.fontSize}})()`;
 const editorInfo=`(()=>{const t=document.querySelector('#lienzo-editor textarea');if(!t)return null;const r=t.getBoundingClientRect(),s=getComputedStyle(t);return{x:r.x,y:r.y,w:r.width,h:r.height,color:s.color,background:s.backgroundColor,border:s.borderTopWidth,fontSize:s.fontSize,align:s.textAlign}})()`;
 try{
 await call('Runtime.enable');await call('Page.enable');await call('Network.enable');await call('Network.setCacheDisabled',{cacheDisabled:true});
 await call('Page.navigate',{url:'http://127.0.0.1:8765/?theme='+(process.argv[2]||'papel')});await wait('!!document.querySelector("#lienzo-entity-note")');
 let id;
 await check('a new shape opens its label editor at its own centre, transparent and borderless',async()=>{
  await click(label('Forma (R)'));await mouse('mousePressed',1050,290,'left',1);for(let i=1;i<=16;i++)await mouse('mouseMoved',1050+i*14,290+i*10,'left',1);await mouse('mouseReleased',1274,450);
  await wait(shape+'&&__panelQA.doc().selectedIds.includes('+shape+'.id)');id=await ev(shape+'.id');
  await click(label('Naranja'));await wait(shape+'.data.color==="naranja"');
  await key('Enter','Enter');await wait('!!document.querySelector("#lienzo-editor textarea")');
  const e=await ev(editorInfo),s=await box('#lienzo-entity-'+id);
  assert.ok(Math.abs(centre(e).x-centre(s).x)<=1.5,'editor x centre '+JSON.stringify([e,s]));assert.ok(Math.abs(centre(e).y-centre(s).y)<=1.5,'editor y centre '+JSON.stringify([e,s]));
  assert.equal(e.background,'rgba(0, 0, 0, 0)');assert.equal(e.border,'0px');assert.equal(e.align,'center');
  await call('Input.insertText',{text:'ASDASD'});await ev('new Promise(r=>setTimeout(r,120))');await shot('editing');
  const typing=await ev(editorInfo);assert.ok(Math.abs(centre(typing).y-centre(s).y)<=1.5);
  await key('Enter','Enter',2);await wait(shape+'.data.text==="ASDASD"');await wait('!document.querySelector("#lienzo-editor")');
  const l=await ev(labelInfo);assert.ok(l,'label rendered');
  assert.ok(Math.abs(centre(l).x-centre(typing).x)<=1.5&&Math.abs(centre(l).y-centre(typing).y)<=1.5,'label stays where it was typed '+JSON.stringify([l,typing]));
  assert.equal(l.color,typing.color);assert.equal(l.fontSize,typing.fontSize);
 });
 await check('fill colour is chosen separately from the outline and the label stays readable',async()=>{
  await click('#lienzo-entity-'+id);await wait('__panelQA.doc().selectedIds.includes("'+id+'")');
  await wait('!!document.querySelector('+JSON.stringify(label('Relleno Verde'))+')');await click(label('Relleno Verde'));
  await wait(shape+'.data.fillColor==="verde"');const data=await ev(shape+'.data');assert.equal(data.fill,'solid');assert.equal(data.color,'naranja');
  const fills=await ev(`[...document.querySelectorAll('#lienzo-entity-${id} path')].map(p=>[p.getAttribute('fill'),p.getAttribute('stroke')])`);
  assert.ok(fills.some(([fill,stroke])=>fill&&fill!=='none'&&fill!==stroke),'interior differs from outline '+JSON.stringify(fills));
  await click(label('Suave'));await wait(shape+'.data.fill==="wash"');assert.equal(await ev(shape+'.data.fillColor'),'verde');await click(label('Sólido'));await wait(shape+'.data.fill==="solid"');
  await shot('filled');
 });
 await check('size steps scale the label with the outline, and editing matches the saved label exactly',async()=>{
  const before=await ev(labelInfo);await click(label('XL'));await wait(shape+'.data.weight==="xl"');await wait(labelInfo+'.fontSize==="28px"');
  assert.equal(before.fontSize,'15px');const l=await ev(labelInfo);
  await key('Enter','Enter');await wait('!!document.querySelector("#lienzo-editor textarea")');const e=await ev(editorInfo);
  assert.equal(e.fontSize,'28px');assert.equal(e.color,l.color);assert.equal(e.background,'rgba(0, 0, 0, 0)');
  assert.ok(Math.abs(centre(e).x-centre(l).x)<=1.5&&Math.abs(centre(e).y-centre(l).y)<=1.5,'no jump entering edit '+JSON.stringify([e,l]));
  assert.equal(await ev(labelInfo),null,'saved label hidden while editing');await shot('editing-xl');
  const count=await ev('__panelQA.log.length');await key('Escape','Escape');await wait('!document.querySelector("#lienzo-editor")');assert.equal(await ev('__panelQA.log.length'),count);assert.equal(await ev(shape+'.data.text'),'ASDASD');
 });
 fs.writeFileSync('/tmp/lienzo-shape-results.json',JSON.stringify({checks,uncaught},null,2));assert.deepEqual(uncaught,[]);
 }finally{ws.close();}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
