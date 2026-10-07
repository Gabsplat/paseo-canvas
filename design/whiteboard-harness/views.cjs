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
 await click('[aria-label^="Lente: Conversación"]');await wait('!!document.querySelector("[aria-label^=\\"Lente: Sin lente\\"]")');
 // Anillos: one figure, one slice per block; pointing at a slice reads that block's life; back to the canvas selected.
 await click('[aria-label="Ver como anillos"]');await wait('!!document.querySelector("#lienzo-rings svg")');await new Promise(r=>setTimeout(r,500));
 const text=await ev('document.querySelector("#lienzo-rings").innerText');assert.ok(/Se muestran 40 cambios/.test(text)&&/no tienen? dirección/.test(text),text.slice(0,400));
 const slices=await ev(`[...document.querySelectorAll('#lienzo-rings svg path')].filter(p=>getComputedStyle(p).pointerEvents==='all').length`);assert.equal(slices,await ev('__panelQA.doc().blocks.length'));await shot('rings');
 const p=await ev(`(()=>{const s=[...document.querySelectorAll('#lienzo-rings svg path')].filter(p=>getComputedStyle(p).pointerEvents==='all')[7].getBoundingClientRect();return{x:s.x+s.width/2,y:s.y+s.height/2}})()`);
 await mouse('mouseMoved',p.x,p.y);await new Promise(r=>setTimeout(r,300));assert.ok(/cambios? guardados?|Sin cambios en el historial/.test(await ev('document.querySelector("#lienzo-rings").innerText')),'hover reads a life');
 await mouse('mousePressed',p.x,p.y,1);await mouse('mouseReleased',p.x,p.y);await wait('__panelQA.doc().selectedIds.length===1');const picked=await ev('__panelQA.doc().selectedIds[0]');await shot('rings-selected');
 await click('[aria-label="Ver en el lienzo"]');await wait('!!document.querySelector("#lienzo-canvas-viewport")');assert.deepEqual(await ev('__panelQA.doc().selectedIds'),[picked]);
 assert.equal(await ev('__panelQA.doc().revision'),rev);assert.equal(await ev('__panelQA.log.length'),log);
 console.log('PASS lenses tint and count, rings draw the stored history, nothing is written');assert.deepEqual(uncaught,[]);
 }finally{ws.close();}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
