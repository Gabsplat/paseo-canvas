// The four worlds (example data): each one draws, reacts to a press, and never writes the document.
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
 const mouse=(type,x,y,buttons=0)=>call('Input.dispatchMouseEvent',{type,x,y,button:'left',buttons,clickCount:1});
 const press=async(x,y)=>{await mouse('mouseMoved',x,y);await mouse('mousePressed',x,y,1);await mouse('mouseReleased',x,y);await new Promise(r=>setTimeout(r,900));};
 const click=async sel=>{const p=await ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)throw Error('Missing '+${JSON.stringify(sel)});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);await press(p.x,p.y);};
 const shot=async name=>{const r=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync('/tmp/lienzo-world-'+name+'.png',Buffer.from(r.data,'base64'));};
 const view=async name=>{await click('[aria-label="Cambiar vista"]');await wait('!!document.querySelector("#lienzo-interactive-views")');await click('#lienzo-interactive-views [aria-label="'+name+'"]');};
 // How much of a world's surface is actually painted: distinct colours among sampled pixels.
 const ink=()=>ev(`(()=>{const c=document.querySelector('[id^="lienzo-world-"] canvas');if(!c)return -1;const x=c.getContext('2d'),d=x.getImageData(0,0,c.width,c.height).data,seen=new Set();for(let i=0;i<d.length;i+=4*97)seen.add((d[i]>>3)+','+(d[i+1]>>3)+','+(d[i+2]>>3)+','+(d[i+3]>>5));return seen.size})()`);
 try{
 await call('Runtime.enable');await call('Page.enable');await call('Network.enable');await call('Network.setCacheDisabled',{cacheDisabled:true});
 await call('Page.navigate',{url:'http://127.0.0.1:8765/?theme='+(process.argv[2]||'oscuro')});await wait('!!document.querySelector("#lienzo-entity-note")');
 await ev(`(()=>{const ops=[],areas=[['a','Ejemplo · entradas',5],['b','Ejemplo · motor',7],['c','Ejemplo · datos',5],['d','Ejemplo · apps',6]];for(const [g,title,n] of areas){const ids=[];for(let i=0;i<n;i++){ids.push(g+i);ops.push({type:'block.create',block:{id:g+i,typeId:'node',title:'Ejemplo '+g+i,data:{summary:'Dato de ejemplo para '+g+i+'.'}}});}ops.push({type:'group.create',group:{id:'area-'+g,title,description:'',blockIds:ids,groupIds:[],layout:{mode:'grid'}}});}
  const L=[['a0','b0','flow','pide'],['a1','b0','flow',''],['a2','b1','flow','envía'],['b0','b2','flow',''],['b1','b2','flow',''],['b2','b3','flow','guarda'],['b3','c0','depends','lee'],['b3','c1','depends',''],['b2','c0','depends',''],['b4','c2','depends',''],['b5','b4','flow',''],['c0','c3','depends',''],['c1','c3','depends',''],['d0','b0','flow','consulta'],['d1','b0','flow',''],['d2','b1','flow',''],['d3','b2','reference',''],['d4','a0','reference',''],['b6','c4','depends',''],['d0','d1','reference','']];
  L.forEach(([from,to,kind,label],i)=>ops.push({type:'link.create',link:{id:'w'+i,from,to,kind,...(label?{label}:{})}}));__panelQA.seed(ops);})()`);
 await wait('!!document.querySelector("#lienzo-entity-d5")');await new Promise(r=>setTimeout(r,900));
 await click('#lienzo-entity-b2');await wait('__panelQA.doc().selectedIds.includes("b2")');
 const rev=await ev('__panelQA.doc().revision'),log=await ev('__panelQA.log.length'),results={};
 for(const [name,id] of [['Órbita','orbit'],['Estratos','strata'],['Cauce','course'],['Relieve','relieve']]){
  await view(name);await wait('!!document.querySelector("#lienzo-world-'+id+' canvas")');await new Promise(r=>setTimeout(r,1300));
  const painted=await ink();results[id]={painted};assert.ok(painted>=6,name+' draws something: '+painted+' distinct colours');
  assert.ok((await ev('document.querySelector("#lienzo-world-'+id+'").innerText')).includes(name),name+' names itself');await shot(id);
  const box=await ev(`(()=>{const r=document.querySelector('#lienzo-world-${id} canvas').getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height}})()`);
  // Sweep presses over the stage: none may throw, and none may write.
  for(const [fx,fy] of [[.5,.5],[.35,.45],[.62,.58],[.45,.7],[.7,.35]]){await mouse('mouseMoved',box.x+box.w*fx,box.y+box.h*fy);await new Promise(r=>setTimeout(r,60));}
  for(const [fx,fy] of [[.42,.52],[.6,.42]])await press(box.x+box.w*fx,box.y+box.h*fy);
  await shot(id+'-after');assert.deepEqual(uncaught.map(u=>u.exception?.description||u.text),[],name+' threw');assert.ok(!/Plugin failed|Minified React/.test(await ev('document.body.innerText')),name+' broke the panel');
 }
 // Órbita: pressing a body on the first orbit puts it in the centre (it becomes the selection).
 await view('Órbita');await wait('!!document.querySelector("#lienzo-world-orbit canvas")');await new Promise(r=>setTimeout(r,1200));
 {const before=await ev('__panelQA.doc().selectedIds[0]');const b=await ev(`(()=>{const r=document.querySelector('#lienzo-world-orbit canvas').getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height}})()`);
  const cx=b.x+(32+b.w-32)/2,cy=b.y+(132+b.h-128)/2,R=Math.min(b.w-64,b.h-260)/2;let moved=false;
  for(let k=0;k<36&&!moved;k++){const a=k*Math.PI/18;await press(cx+R*0.30*Math.cos(a),cy+R*0.30*Math.sin(a));moved=(await ev('__panelQA.doc().selectedIds[0]'))!==before;}
  assert.ok(moved,'a body on the first orbit became the centre');await new Promise(r=>setTimeout(r,800));await shot('orbit-recentred');}
 // Cauce: two presses on swellings leave only the shortest way, which can be sent to the assistant as a real request.
 await view('Cauce');await wait('!!document.querySelector("#lienzo-world-course canvas")');await new Promise(r=>setTimeout(r,1200));
 {const b=await ev(`(()=>{const r=document.querySelector('#lienzo-world-course canvas').getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height}})()`);
  const text=()=>ev('document.querySelector("#lienzo-world-course").innerText'),tap=async(x,y)=>{await mouse('mouseMoved',x,y);await mouse('mousePressed',x,y,1);await mouse('mouseReleased',x,y);await new Promise(r=>setTimeout(r,30));};
  // Find where the swellings are by pressing over a grid: a press on one asks for the second; a press on nothing resets.
  const hits=[];for(let gy=0;gy<30&&hits.length<8;gy++)for(let gx=0;gx<44&&hits.length<8;gx++){const x=b.x+40+gx*(b.w-420)/44,y=b.y+130+gy*(b.h-270)/30;await tap(x,y);if(/Ahora toca/.test(await text())){if(!hits.some(h=>Math.hypot(h.x-x,h.y-y)<24))hits.push({x,y});await tap(b.x+6,b.y+b.h-6);}}
  assert.ok(hits.length>=2,'found swellings to press: '+hits.length);let stage=0;
  for(let k=1;k<hits.length&&stage<2;k++){await tap(hits[0].x,hits[0].y);await tap(hits[k].x,hits[k].y);await new Promise(r=>setTimeout(r,300));if(/El camino más corto/.test(await text()))stage=2;else await tap(b.x+6,b.y+b.h-6);}
  assert.equal(stage,2,'two presses produced a route');await new Promise(r=>setTimeout(r,900));await shot('course-route');
  const actions=await ev('__panelQA.actions.length');await click('[aria-label="Pedir esta explicación"]');await wait('__panelQA.actions.length>'+actions);await wait('document.querySelector("#lienzo-world-course").innerText.includes("Enviado al asistente")');
  const sent=await ev('JSON.stringify(__panelQA.actions.at(-1))');assert.ok(sent.includes('route.explain')&&sent.includes('path'),sent.slice(0,200));}
 await view('Lienzo');await wait('!!document.querySelector("#lienzo-canvas-viewport")');
 assert.equal(await ev('__panelQA.doc().revision'),rev);assert.equal(await ev('__panelQA.log.length'),log);
 console.log('PASS four worlds draw, take presses and write nothing',JSON.stringify(results));
 }finally{ws.close();}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
