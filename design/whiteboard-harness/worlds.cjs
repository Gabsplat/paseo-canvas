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
 const wheel=(x,y,dx,dy,ctrl=false)=>call('Input.dispatchMouseEvent',{type:'mouseWheel',x,y,deltaX:dx,deltaY:dy,modifiers:ctrl?2:0});
 const pause=ms=>new Promise(r=>setTimeout(r,ms));
 const rect=sel=>ev(`(()=>{const r=document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height}})()`);
 const text=id=>ev('document.querySelector("#lienzo-world-'+id+'").innerText');
 const zoom=()=>ev('Number((document.querySelector("#lienzo-view-zoom").innerText.match(/(\\d+) %/)||[])[1])');
 // Where the things of a world are on screen: the stage shows a pointing hand over anything that can be pressed.
 const spots=async(id,want=6)=>{const b=await rect('#lienzo-world-'+id+' canvas'),out=[];for(let gy=0;gy<26&&out.length<want;gy++)for(let gx=0;gx<40&&out.length<want;gx++){const x=b.x+40+gx*(b.w-420)/40,y=b.y+150+gy*(b.h-290)/26;await mouse('mouseMoved',x,y);
   if(await ev('getComputedStyle(document.querySelector("#lienzo-world-'+id+'")).cursor')==='pointer'&&!out.some(h=>Math.hypot(h.x-x,h.y-y)<46))out.push({x,y});}await mouse('mouseMoved',b.x+8,b.y+b.h-8);return out;};
 const tap=async(x,y)=>{await mouse('mouseMoved',x,y);await mouse('mousePressed',x,y,1);await mouse('mouseReleased',x,y);await pause(350);};
 for(const [name,id] of [['Órbita','orbit'],['Estratos','strata'],['Cauce','course'],['Relieve','relieve']]){
  await view(name);await wait('!!document.querySelector("#lienzo-world-'+id+' canvas")');await pause(1500);
  const painted=await ink();results[id]={painted};assert.ok(painted>=6,name+' draws something: '+painted+' distinct colours');
  assert.ok((await text(id)).includes(name),name+' names itself');assert.ok(await ev('!!document.querySelector("#lienzo-world-'+id+'-legend")'),name+' says how to read it');await shot(id);
  // The camera: command-wheel zooms, the wheel pans, a drag pans, and "Encajar" comes back. The drawing changes each time.
  const b=await rect('#lienzo-world-'+id+' canvas'),cx=b.x+b.w/2,cy=b.y+b.h/2,z0=await zoom();
  await wheel(cx,cy,0,-240,true);await pause(700);const z1=await zoom();assert.ok(z1>z0,name+' zooms in: '+z0+' → '+z1);await shot(id+'-near');
  await wheel(cx,cy,180,120);await pause(200);await mouse('mouseMoved',b.x+12,b.y+b.h-40);await mouse('mousePressed',b.x+12,b.y+b.h-40,1);await mouse('mouseMoved',b.x+90,b.y+b.h-90,1);await mouse('mouseReleased',b.x+90,b.y+b.h-90);await pause(200);
  await click('#lienzo-world-'+id+' [aria-label="Encajar"]');await pause(900);assert.equal(await zoom(),z0,name+' fits again');
  const found=await spots(id,id==='strata'?40:id==='course'?14:6);if(id==='strata')found.reverse();results[id].things=found.length;assert.ok(found.length>=2,name+' has things under the pointer: '+found.length);
  if(id==='orbit'){const before=await ev('__panelQA.doc().selectedIds[0]');let moved=false;for(const h of found){if(Math.hypot(h.x-cx,h.y-cy)<170)continue;await tap(h.x,h.y);moved=(await ev('__panelQA.doc().selectedIds[0]'))!==before;if(moved)break;}assert.ok(moved,'pressing a body puts it in the centre');await pause(1200);await shot('orbit-recentred');}
  if(id==='strata'){let took=false;for(const h of found){await tap(h.x,h.y);took=(await text('strata')).includes('Soltar la muestra');if(took)break;}assert.ok(took,'pressing a block takes a sample');await pause(400);await shot('strata-sample');await click('#lienzo-world-strata [aria-label="Sobre qué descansa"]');await pause(300);assert.ok(/Para existir necesita|No necesita nada/.test(await text('strata')));await click('#lienzo-world-strata [aria-label="Soltar la muestra"]');}
  if(id==='course'){let done=false;for(let k=1;k<found.length&&!done;k++){await tap(found[0].x,found[0].y);assert.ok(/Ahora toca/.test(await text('course')),'the first press asks for the second');if(k===1)await shot('course-from');await tap(found[k].x,found[k].y);done=/El camino más corto/.test(await text('course'));if(!done&&await ev(`!!document.querySelector('#lienzo-world-course [aria-label="Empezar de nuevo"]')`))await click('#lienzo-world-course [aria-label="Empezar de nuevo"]');}
   assert.ok(done,'two presses produced a route');await pause(900);await shot('course-route');const actions=await ev('__panelQA.actions.length');await click('#lienzo-world-course [aria-label="Pedir esta explicación"]');await wait('__panelQA.actions.length>'+actions);await wait('/Enviado al asistente|Guardado en cola/.test(document.querySelector("#lienzo-world-course").innerText)');
   const sent=await ev('JSON.stringify(__panelQA.actions.at(-1))');assert.ok(sent.includes('route.explain')&&sent.includes('path'),sent.slice(0,200));}
  if(id==='relieve'){await click('#lienzo-world-relieve [aria-label="Subir"]');await click('#lienzo-world-relieve [aria-label="Subir"]');await wait('document.querySelector("#lienzo-world-relieve").innerText.includes("Quedan")');await pause(900);await shot('relieve-water');}
  assert.deepEqual(uncaught.map(u=>u.exception?.description||u.text),[],name+' threw');assert.ok(!/Plugin failed|Minified React/.test(await ev('document.body.innerText')),name+' broke the panel');
 }
 // The native views move like the canvas too: the wheel pans their content and command-wheel zooms it.
 for(const [name,id] of [['Foco','foco'],['Lecturas','lecturas'],['Matriz','matriz'],['Lista','lista']]){
  await view(name);await wait('!!document.querySelector("#lienzo-pan-'+id+'-content")');await pause(500);const b=await rect('#lienzo-pan-'+id),at=()=>ev('getComputedStyle(document.querySelector("#lienzo-pan-'+id+'-content")).transform');
  const t0=await at();await wheel(b.x+b.w/2,b.y+b.h/2,60,140);await pause(200);const t1=await at();assert.notEqual(t1,t0,name+' pans with the wheel');
  await wheel(b.x+b.w/2,b.y+b.h/2,0,-200,true);await pause(200);assert.ok(await zoom()>100,name+' zooms with command-wheel');await shot('pan-'+id);
  await click('#lienzo-pan-'+id+' [aria-label="Volver al inicio"]');await pause(200);assert.equal(await zoom(),100);assert.equal(await at(),t0,name+' returns to the start');
  assert.deepEqual(uncaught.map(u=>u.exception?.description||u.text),[],name+' threw');
 }
 await view('Lienzo');await wait('!!document.querySelector("#lienzo-canvas-viewport")');
 assert.equal(await ev('__panelQA.doc().revision'),rev);assert.equal(await ev('__panelQA.log.length'),log);
 console.log('PASS worlds redraw, move like the canvas and write nothing',JSON.stringify(results));
 }finally{ws.close();}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
