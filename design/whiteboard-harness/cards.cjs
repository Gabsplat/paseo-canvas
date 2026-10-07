// Node cards (example data): three cards in an area show their whole summary; a crowded area stays compact.
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
 const mouse=(type,x,y,button='left',buttons=0)=>call('Input.dispatchMouseEvent',{type,x,y,button,buttons,clickCount:1});
 try{
 await call('Runtime.enable');await call('Page.enable');await call('Network.enable');await call('Network.setCacheDisabled',{cacheDisabled:true});
 await call('Page.navigate',{url:'http://127.0.0.1:8765/?theme='+(process.argv[2]||'oscuro')});await wait('!!document.querySelector("#lienzo-entity-note")');
 const text='Ejemplo: cada app guardaba lo suyo a su manera, el CRM, carpetas de clientes y hojas sueltas, y nadie sabía cuál era la versión buena.';
 await ev(`(()=>{const ops=[];const card=(id,title)=>({type:'block.create',block:{id,typeId:'node',title,data:{kind:'Ejemplo',summary:${JSON.stringify(text)}}}});
  ['p','s','r'].forEach((id,i)=>ops.push(card('few-'+id,'Tarjeta de ejemplo '+(i+1))));ops.push({type:'group.create',group:{id:'few',title:'Ejemplo · pocas tarjetas',description:'',blockIds:['few-p','few-s','few-r'],groupIds:[],layout:{mode:'graph',direction:'right'}}});
  const ids=Array.from({length:12},(_,i)=>'many-'+i);ids.forEach((id,i)=>ops.push(card(id,'Tarjeta de ejemplo '+(i+1))));ops.push({type:'group.create',group:{id:'many',title:'Ejemplo · muchas tarjetas',description:'',blockIds:ids,groupIds:[],layout:{mode:'grid'}}});
  ops.push({type:'link.create',link:{id:'f1',from:'few-p',to:'few-s'}},{type:'link.create',link:{id:'f2',from:'few-s',to:'few-r'}});return __panelQA.seed(ops);})()`);
 await wait('!!document.querySelector("#lienzo-entity-many-11")');await new Promise(r=>setTimeout(r,900));
 const b=await ev(`(()=>{const e=document.querySelector('[aria-label="Ajustar al lienzo"]').getBoundingClientRect();return{x:e.x+e.width/2,y:e.y+e.height/2}})()`);await mouse('mousePressed',b.x,b.y,'left',1);await mouse('mouseReleased',b.x,b.y);await new Promise(r=>setTimeout(r,900));
 const info=id=>ev(`(()=>{const root=document.querySelector('#lienzo-entity-${id}'),t=[...root.querySelectorAll('div')].find(e=>e.children.length===0&&e.textContent.startsWith('Ejemplo: cada app'));const zoom=root.getBoundingClientRect().width/root.offsetWidth;return{width:root.offsetWidth,clipped:t.scrollHeight>t.clientHeight+1,lines:Math.round(t.clientHeight/parseFloat(getComputedStyle(t).lineHeight))}})()`);
 const few=await info('few-s'),many=await info('many-3');console.log('few',JSON.stringify(few),'many',JSON.stringify(many));
 assert.equal(few.width,304);assert.equal(few.clipped,false,'summary shown in full');assert.equal(many.width,224);assert.equal(many.lines,2);assert.equal(many.clipped,true);
 const r=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync('/tmp/lienzo-cards.png',Buffer.from(r.data,'base64'));
 console.log('PASS cards adapt to their container');assert.deepEqual(uncaught,[]);
 }finally{ws.close();}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
