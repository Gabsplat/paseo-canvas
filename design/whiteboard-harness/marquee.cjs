// Box selection (example data): dragging over empty canvas with the select tool selects what the box touches and does not move the view.
const assert=require('node:assert/strict');const fs=require('node:fs');
(async()=>{
 const pages=await(await fetch('http://127.0.0.1:9222/json/list')).json();
 const page=pages.find(p=>p.type==='page'&&p.url.startsWith('http://127.0.0.1:8765/'));if(!page)throw Error('QA page missing');
 const ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((ok,no)=>{ws.addEventListener('open',ok,{once:true});ws.addEventListener('error',no,{once:true});});
 let seq=0;const pending=new Map(),uncaught=[];
 ws.addEventListener('message',e=>{const r=JSON.parse(e.data);if(r.method==='Runtime.exceptionThrown')uncaught.push(r.params.exceptionDetails);if(r.id){const p=pending.get(r.id);if(!p)return;pending.delete(r.id);r.error?p.no(Error(JSON.stringify(r.error))):p.ok(r.result);}});
 const call=(method,params={})=>new Promise((ok,no)=>{const id=++seq;pending.set(id,{ok,no});ws.send(JSON.stringify({id,method,params}));});
 const ev=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result?.value;};
 const wait=async expression=>{for(let n=0;n<150;n++){if(await ev(expression))return;await new Promise(r=>setTimeout(r,50));}throw Error('Condition timed out: '+expression);};
 const mouse=(type,x,y,buttons=0,modifiers=0)=>call('Input.dispatchMouseEvent',{type,x,y,button:'left',buttons,clickCount:1,modifiers});
 const rect=id=>ev(`(()=>{const r=document.querySelector('#lienzo-entity-${id}').getBoundingClientRect();return{x:r.x,y:r.y,r:r.right,b:r.bottom}})()`);
 const drag=async(x0,y0,x1,y1,modifiers=0,midShot)=>{await mouse('mouseMoved',x0,y0,0,modifiers);await mouse('mousePressed',x0,y0,1,modifiers);for(let i=1;i<=14;i++){await mouse('mouseMoved',x0+(x1-x0)*i/14,y0+(y1-y0)*i/14,1,modifiers);await new Promise(r=>setTimeout(r,10));}
  if(midShot){const r=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync('/tmp/lienzo-marquee.png',Buffer.from(r.data,'base64'));const m=await ev(`(()=>{const e=document.querySelector('#lienzo-marquee'),r=e.getBoundingClientRect();return{w:r.width,h:r.height,o:getComputedStyle(e).opacity}})()`);assert.ok(m.w>100&&m.h>50&&m.o==='1','box drawn while dragging '+JSON.stringify(m));}
  await mouse('mouseReleased',x1,y1,0,modifiers);await new Promise(r=>setTimeout(r,400));};
 try{
 await call('Runtime.enable');await call('Page.enable');await call('Network.enable');await call('Network.setCacheDisabled',{cacheDisabled:true});
 await call('Page.navigate',{url:'http://127.0.0.1:8765/?theme='+(process.argv[2]||'oscuro')});await wait('!!document.querySelector("#lienzo-entity-note")');await new Promise(r=>setTimeout(r,900));
 await ev(`__panelQA.seed([{type:'block.create',block:{id:'third',typeId:'node',title:'Ejemplo: tercera',position:{x:120,y:640},data:{summary:'Ejemplo.'}}}])`);await wait('!!document.querySelector("#lienzo-entity-third")');await new Promise(r=>setTimeout(r,700));
 const a=await rect('server'),b=await rect('note'),t=await rect('third'),rev=await ev('__panelQA.doc().revision');
 await drag(Math.min(a.x,b.x)-40,Math.max(a.b,b.b)+40,Math.max(a.r,b.r)+40,Math.min(a.y,b.y)-20,0,true);
 await wait('__panelQA.doc().selectedIds.length===2');assert.deepEqual((await ev('__panelQA.doc().selectedIds')).sort(),['note','server']);
 const after=await rect('server');assert.ok(Math.abs(after.x-a.x)<1&&Math.abs(after.y-a.y)<1,'the view did not move');
 assert.equal(await ev(`getComputedStyle(document.querySelector('#lienzo-marquee')).opacity`),'0');
 await drag(t.x-30,t.b+30,t.r+30,t.y-30,8);await wait('__panelQA.doc().selectedIds.length===3');assert.ok((await ev('__panelQA.doc().selectedIds')).includes('third'),'Shift adds to the selection');
 await drag(t.r+200,t.b+60,t.r+320,t.b+140);await wait('__panelQA.doc().selectedIds.length===0');
 assert.equal(await ev('__panelQA.doc().revision'),rev);
 console.log('PASS box selection selects, adds with Shift, clears on an empty box, and never moves the view or the document');assert.deepEqual(uncaught,[]);
 }finally{ws.close();}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
