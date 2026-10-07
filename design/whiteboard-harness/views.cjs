// Lenses and Anillos (example data, with a stand-in history served by the QA host).
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
 const click=async sel=>{const p=await ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)throw Error('Missing '+${JSON.stringify(sel)});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);await mouse('mouseMoved',p.x,p.y);await mouse('mousePressed',p.x,p.y,1);await mouse('mouseReleased',p.x,p.y);await new Promise(r=>setTimeout(r,500));};
 const shot=async name=>{const r=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync('/tmp/lienzo-views-'+name+'.png',Buffer.from(r.data,'base64'));};
 try{
 await call('Runtime.enable');await call('Page.enable');await call('Network.enable');await call('Network.setCacheDisabled',{cacheDisabled:true});
 await call('Page.navigate',{url:'http://127.0.0.1:8765/?theme='+(process.argv[2]||'oscuro')});await wait('!!document.querySelector("#lienzo-entity-note")');
 await ev(`(()=>{const ops=[],areas=[['a','Ejemplo · entradas',5],['b','Ejemplo · motor',6],['c','Ejemplo · datos',4]];for(const [g,title,n] of areas){const ids=[];for(let i=0;i<n;i++){ids.push(g+i);ops.push({type:'block.create',block:{id:g+i,typeId:'node',title:'Ejemplo '+g+i,data:{summary:'Dato de ejemplo.'}}});}ops.push({type:'group.create',group:{id:'area-'+g,title,description:'',blockIds:ids,groupIds:[],layout:{mode:'grid'}}});}
  for(const [i,[from,to,kind,label]] of [['a0','a1','flow','pide'],['a1','b0','flow','envía'],['b0','c0','flow',''],['a1','b3','flow','avisa'],['b1','c1','depends','lee'],['b2','c1','depends',''],['a4','b0','reference','']].entries())ops.push({type:'link.create',link:{id:'lk'+i,from,to,kind,...(label?{label}:{})}});
  __panelQA.seed(ops);const rev=__panelQA.doc().revision,all=['a0','a1','a2','a3','a4','b0','b1','b2','b3','b4','b5','c0','c1','c2','c3'],h=[];
  for(let i=0;i<40;i++){const agent=i%3!==0,early=i<16,pool=early?all:['b0','b1','b2','b3','a0'];const changed=[pool[i%pool.length],pool[(i*7+3)%pool.length]];if(i===20)changed.push('link-x');h.push({id:'tx'+i,revision:i+1,actor:agent?'agent':'user',label:'Ejemplo de cambio '+i,at:new Date(Date.UTC(2026,9,7,0,i)).toISOString(),changed:[...new Set(changed)],removed:[],kind:i===30?'undo':'edit'});}
  __panelQA.setHistory(h);})()`);
 await wait('!!document.querySelector("#lienzo-entity-c3")');await new Promise(r=>setTimeout(r,900));await click('[aria-label="Ajustar al lienzo"]');
 const rev=await ev('__panelQA.doc().revision'),log=await ev('__panelQA.log.length');
 // Lenses: one press per lens; the legend counts add up to the blocks and nothing is written.
 await click('[aria-label^="Lente: Sin lente"]');await wait('!!document.querySelector("[aria-label^=\\"Lente: Autoría\\"]")');await wait('document.querySelector("#lienzo-interactive-lens").innerText.includes("Asistente")');
 await wait('!document.querySelector("#lienzo-interactive-lens").innerText.includes("Leyendo")');const lens=await ev('document.querySelector("#lienzo-interactive-lens").innerText');
 assert.ok(/Tú/.test(lens)&&/Asistente/.test(lens)&&/50 cambios/.test(lens),lens);const counts=lens.split('\n').filter(line=>/^\d+$/.test(line.trim())).reduce((a,b)=>a+ +b,0);assert.equal(counts,await ev('__panelQA.doc().blocks.length'),'legend counts every block: '+lens);
 await shot('lens-author');
 await click('[aria-label^="Lente: Autoría"]');await wait('!!document.querySelector("[aria-label^=\\"Lente: Antigüedad\\"]")');assert.ok(/Recién cambiado/.test(await ev('document.querySelector("#lienzo-interactive-lens").innerText')));await shot('lens-age');
 await click('[aria-label^="Lente: Antigüedad"]');await wait('!!document.querySelector("[aria-label^=\\"Lente: Conversación\\"]")');assert.ok(/Nunca conversado/.test(await ev('document.querySelector("#lienzo-interactive-lens").innerText')));
 await click('[aria-label^="Lente: Conversación"]');await wait('!!document.querySelector("[aria-label^=\\"Lente: Lo que ve el asistente\\"]")');assert.ok(/Lo cambiaste después/.test(await ev('document.querySelector("#lienzo-interactive-lens").innerText')));await shot('lens-agent');
 await click('[aria-label^="Lente: Lo que ve el asistente"]');await wait('!!document.querySelector("[aria-label^=\\"Lente: Sin lente\\"]")');
 // Anillos: one figure, one slice per block; pointing at a slice reads that block's life; back to the canvas selected.
 const view=async name=>{await click('[aria-label="Cambiar vista"]');await wait('!!document.querySelector("#lienzo-interactive-views")');await click('#lienzo-interactive-views [aria-label="'+name+'"]');await new Promise(r=>setTimeout(r,500));};const body=()=>ev('document.body.innerText');
 // Foco: the selected card in the middle, neighbours by link meaning; pressing one recentres.
 await click('#lienzo-entity-a1');await wait('__panelQA.doc().selectedIds.includes("a1")');await view('Foco');await wait('!!document.querySelector("#lienzo-focus-centre")');
 let t=await body();assert.ok(/Viene de/.test(t)&&/Sigue a/.test(t)&&/Ejemplo a0/.test(t)&&/avisa/.test(t),'focus shows flow neighbours');await shot('focus');
 await click('[aria-label="Ir a Ejemplo b0"]');await wait('__panelQA.doc().selectedIds[0]==="b0"');assert.ok(/Ejemplo c0/.test(await ev('document.querySelector("#lienzo-focus-centre").parentElement.innerText')));
 // Lecturas: the flow paths as readings, walked step by step.
 await view('Lecturas');await wait('!!document.querySelector("#lienzo-reading-step")');t=await body();assert.ok(/Ejemplo a0 → Ejemplo c0/.test(t)&&/Ejemplo a0 → Ejemplo b3/.test(t)&&/Depende/.test(t),t.slice(0,300));
 await click('[aria-label="Lectura de Ejemplo a0 a Ejemplo c0"]');await click('[aria-label="Siguiente"]');assert.ok(/pide/.test(await ev('document.querySelector("#lienzo-reading-step").innerText')));assert.ok(/Cruce/.test(await ev('document.querySelector("#lienzo-reading-step").innerText')),'a shared card is a crossing');await shot('readings');
 // Matriz: one cell per link, described on hover.
 await view('Matriz');await wait('!!document.querySelector("#lienzo-matrix")');assert.equal(await ev('document.querySelectorAll("#lienzo-matrix [aria-label*=\\" sigue o envía a \\"],#lienzo-matrix [aria-label*=\\" necesita a \\"],#lienzo-matrix [aria-label*=\\" menciona a \\"]").length'),8);await shot('matrix');
 // Corriente: stored changes newest first.
 await view('Corriente');await wait('document.querySelector("#lienzo-stream")?.innerText.includes("Ejemplo de cambio 39")');t=await ev('document.querySelector("#lienzo-stream").innerText');assert.ok(t.indexOf('Ejemplo de cambio 39')<t.indexOf('Ejemplo de cambio 2\n')||t.indexOf('Ejemplo de cambio 39')<t.indexOf('Ejemplo de cambio 10'),'newest first');assert.ok(/El asistente/.test(t)&&/deshiciste/.test(t));await shot('stream');
 await view('Lienzo');await wait('!!document.querySelector("#lienzo-canvas-viewport")');await ev('__panelQA.doc()');
 await view('Anillos');await wait('!!document.querySelector("#lienzo-rings svg")');await new Promise(r=>setTimeout(r,500));
 const text=await ev('document.querySelector("#lienzo-rings").innerText');assert.ok(/Se muestran 40 cambios/.test(text)&&/no tienen? dirección/.test(text),text.slice(0,400));
 const slices=await ev(`[...document.querySelectorAll('#lienzo-rings svg path')].filter(p=>getComputedStyle(p).pointerEvents==='all').length`);assert.equal(slices,await ev('__panelQA.doc().blocks.length'));await shot('rings');
 const p=await ev(`(()=>{const s=[...document.querySelectorAll('#lienzo-rings svg path')].filter(p=>getComputedStyle(p).pointerEvents==='all')[7].getBoundingClientRect();return{x:s.x+s.width/2,y:s.y+s.height/2}})()`);
 await mouse('mouseMoved',p.x,p.y);await new Promise(r=>setTimeout(r,300));assert.ok(/cambios? guardados?|Sin cambios en el historial/.test(await ev('document.querySelector("#lienzo-rings").innerText')),'hover reads a life');
 await mouse('mousePressed',p.x,p.y,1);await mouse('mouseReleased',p.x,p.y);await wait('__panelQA.doc().selectedIds.length===1');const picked=await ev('__panelQA.doc().selectedIds[0]');await shot('rings-selected');
 await click('[aria-label="Ver en el lienzo"]');await wait('!!document.querySelector("#lienzo-canvas-viewport")');assert.deepEqual(await ev('__panelQA.doc().selectedIds'),[picked]);
 assert.equal(await ev('__panelQA.doc().revision'),rev);assert.equal(await ev('__panelQA.log.length'),log);
 console.log('PASS lenses, focus, readings, matrix, stream and rings read the same document and write nothing');assert.deepEqual(uncaught,[]);
 }finally{ws.close();}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
