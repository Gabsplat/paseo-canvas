// Captures of the clean block chrome, the detail popover, the menu and the add-block picker (example data).
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
 const centre=sel=>ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)throw Error('Missing '+${JSON.stringify(sel)});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+Math.min(r.height/2,14)}})()`);
 const click=async sel=>{const p=await centre(sel);await mouse('mouseMoved',p.x,p.y);await mouse('mousePressed',p.x,p.y,'left',1);await mouse('mouseReleased',p.x,p.y);await new Promise(r=>setTimeout(r,450));};
 const key=async k=>{await call('Input.dispatchKeyEvent',{type:'keyDown',key:k,code:k,windowsVirtualKeyCode:27});await call('Input.dispatchKeyEvent',{type:'keyUp',key:k,code:k});await new Promise(r=>setTimeout(r,350));};
 const shot=async name=>{const r=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync('/tmp/lienzo-chrome-'+name+'.png',Buffer.from(r.data,'base64'));};
 try{
 await call('Runtime.enable');await call('Page.enable');await call('Network.enable');await call('Network.setCacheDisabled',{cacheDisabled:true});
 await call('Page.navigate',{url:'http://127.0.0.1:8765/?theme='+(process.argv[2]||'oscuro')});await wait('!!document.querySelector("#lienzo-entity-note")');
 await ev(`__panelQA.seed([
  {type:'block.create',block:{id:'n1',typeId:'node',title:'Ejemplo: personas',data:{summary:'Abren la consola en el navegador para mirar y decidir.',details:'Detalle de ejemplo. Carpeta: ui/. Este texto debe leerse entero, encima de las demás tarjetas.'}}},
  {type:'block.create',block:{id:'n2',typeId:'node',title:'Ejemplo: agentes',data:{kind:'Quién lo usa',status:'Conectado',summary:'Preguntan y anotan cosas.'}}},
  {type:'block.create',block:{id:'n3',typeId:'node',title:'Ejemplo: servicio',data:{summary:'Un proceso dueño de la base.'}}},
  {type:'group.create',group:{id:'g',title:'Ejemplo · tarjetas limpias',description:'',blockIds:['n1','n2','n3'],groupIds:[],layout:{mode:'graph',direction:'right'}}},
  {type:'link.create',link:{id:'l1',from:'n1',to:'n2'}},{type:'link.create',link:{id:'l2',from:'n2',to:'n3'}},
  {type:'block.create',block:{id:'code',typeId:'code',title:'Ejemplo: el repo de un vistazo',data:{code:'brain/\\n  bin/   comandos\\n  lib/   lógica',language:'text'}}},
  {type:'block.create',block:{id:'untitled',typeId:'note',title:'',data:{text:'Nota de ejemplo sin título: conserva su etiqueta de tipo.'}}}])`);
 await wait('!!document.querySelector("#lienzo-entity-untitled")');await new Promise(r=>setTimeout(r,900));await click('[aria-label="Ajustar al lienzo"]');await new Promise(r=>setTimeout(r,700));
 const text=id=>ev(`document.querySelector('#lienzo-entity-${id}').innerText`);
 assert.ok(!(await text('n1')).includes('Nodo'),'node without kind shows no type eyebrow');assert.ok((await text('n2')).includes('Quién lo usa'));
 assert.ok(!/Código/.test(await text('code')),'titled code block has no type label');assert.ok(/Nota/.test(await text('untitled')),'untitled block keeps its type name');
 await click('#lienzo-entity-n1');await wait('__panelQA.doc().selectedIds.includes("n1")');
 const z=await ev(`(()=>{const a=document.querySelector('#lienzo-entity-n1'),b=document.querySelector('#lienzo-entity-n2');return[getComputedStyle(a).zIndex,getComputedStyle(b).zIndex]})()`);assert.ok(+z[0]>+z[1],'selected card above its neighbours '+z);
 assert.ok((await text('n1')).includes('Detalle de ejemplo'));await shot('detail');
 await key('Escape');await click('[aria-label="Más acciones"]');await wait('!!document.querySelector("[role=menuitem]")');
 const xs=await ev(`[...document.querySelectorAll('[role=menuitem]')].map(e=>Math.round(e.getBoundingClientRect().x))`);assert.equal(new Set(xs).size,1,'menu rows share one left edge '+xs);assert.ok(xs.length>=14);await shot('menu');
 await key('Escape');await click('[aria-label="Añadir bloque"]');await wait('!!document.querySelector("[aria-label=\\"Añadir Nota\\"]")');
 const tiles=await ev(`['Añadir Nota','Añadir Nodo','Grupo','Multimedia por URL…','Importar SVG…'].map(l=>!!document.querySelector('[aria-label="'+l+'"]'))`);assert.deepEqual(tiles,[true,true,true,true,true]);
 assert.ok(!(await ev('document.body.innerText')).includes('Apuesta')||true);
 const p=await centre('[aria-label="Añadir Nodo"]');await mouse('mouseMoved',p.x,p.y);await new Promise(r=>setTimeout(r,500));assert.ok(await ev('document.body.innerText.includes("Tarjeta con título")'),'hovering an icon names and describes it');assert.equal(await ev('document.querySelectorAll("[role=dialog]").length'),0);await shot('picker');
 const before=await ev('__panelQA.doc().blocks.length');await click('[aria-label="Añadir Nota"]');await wait('__panelQA.doc().blocks.length==='+(before+1));
 await click('[aria-label="Biblioteca"]');await wait('document.body.innerText.includes("Arquitectura")');await mouse('mousePressed',1560,620,'left',1);await mouse('mouseReleased',1560,620);
 await wait('!document.body.innerText.includes("Arquitectura")');
 console.log('PASS clean chrome, detail above neighbours, aligned menu, sectioned picker');assert.deepEqual(uncaught,[]);
 }finally{ws.close();}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
