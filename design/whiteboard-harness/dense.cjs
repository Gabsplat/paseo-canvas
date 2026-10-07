// Dense graph (example data): connectors between areas rest calm and unlabelled, and light up with their labels on focus.
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
 const shot=async name=>{const r=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync('/tmp/lienzo-dense-'+name+'.png',Buffer.from(r.data,'base64'));};
 try{
 await call('Runtime.enable');await call('Page.enable');await call('Network.enable');await call('Network.setCacheDisabled',{cacheDisabled:true});
 await call('Page.navigate',{url:'http://127.0.0.1:8765/?theme='+(process.argv[2]||'oscuro')});await wait('!!document.querySelector("#lienzo-entity-note")');
 await ev(`(()=>{const ops=[];for(let g=0;g<4;g++){for(let n=0;n<6;n++)ops.push({type:'block.create',block:{id:'d'+g+'-'+n,typeId:'node',title:'Ejemplo '+g+'.'+n,data:{kind:'MODULE',status:'ready',summary:'Dato de ejemplo.'}}});ops.push({type:'group.create',group:{id:'area'+g,title:'Área de ejemplo '+(g+1),description:'',blockIds:Array.from({length:6},(_,n)=>'d'+g+'-'+n),groupIds:[],layout:{mode:'graph',direction:'right'}}});}
  let k=0;for(let g=0;g<3;g++)for(let n=0;n<6;n++)for(const t of [n,(n+2)%6])ops.push({type:'link.create',link:{id:'x'+(k++),from:'d'+g+'-'+n,to:'d'+(g+1)+'-'+t,label:'ejemplo '+k}});
  for(let g=0;g<4;g++)for(let n=0;n<5;n++)ops.push({type:'link.create',link:{id:'i'+g+'-'+n,from:'d'+g+'-'+n,to:'d'+g+'-'+(n+1)}});
  return __panelQA.seed(ops);})()`);
 await wait('__panelQA.doc().links.length>=56&&!!document.querySelector("#lienzo-entity-d3-5")');await new Promise(r=>setTimeout(r,900));
 const b=await ev(`(()=>{const e=document.querySelector('[aria-label="Ajustar al lienzo"]').getBoundingClientRect();return{x:e.x+e.width/2,y:e.y+e.height/2}})()`);await mouse('mousePressed',b.x,b.y,'left',1);await mouse('mouseReleased',b.x,b.y);await new Promise(r=>setTimeout(r,900));
 const read=`(()=>{const paths=[...document.querySelectorAll('svg path[stroke]')].filter(p=>p.getAttribute('fill')==='none'||!p.getAttribute('fill'));const o=paths.map(p=>+(p.getAttribute('opacity')??p.getAttribute('stroke-opacity')??getComputedStyle(p).opacity));return{faint:o.filter(v=>v>0&&v<=.2).length,texts:[...document.querySelectorAll('svg text')].filter(t=>/^ejemplo \\d+/.test(t.textContent)).length}})()`;
 const rest=await ev(read);console.log('rest',JSON.stringify(rest));assert.ok(rest.faint>=30,'cross-area connectors rest faint');assert.equal(rest.texts,0,'no labels at rest');await shot('rest');
 const n=await ev(`(()=>{const e=document.querySelector('#lienzo-entity-d1-2').getBoundingClientRect();return{x:e.x+e.width/2,y:e.y+10}})()`);await mouse('mousePressed',n.x,n.y,'left',1);await mouse('mouseReleased',n.x,n.y);
 await wait('__panelQA.doc().selectedIds.includes("d1-2")');await new Promise(r=>setTimeout(r,400));const lit=await ev(read);console.log('focus',JSON.stringify(lit));assert.ok(lit.texts>=1,'focused links show their labels');await shot('focus');
 console.log('PASS dense graph rests calm and opens on focus');assert.deepEqual(uncaught,[]);
 }finally{ws.close();}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
