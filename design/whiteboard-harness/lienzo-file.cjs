// §41 .lienzo files in the desktop app's preview (`pnpm --dir apps/desktop preview`: real core, store and media in a
// scratch data folder). Builds an example Lienzo (an image, a custom block type, an extension with storage, a comment),
// opens Export from the document menu, saves through the browser download, then drops a changed copy of the file on the
// Lienzos screen (it brings a new extension and a different type), reviews it, imports it and shows the new card.
// Usage: node lienzo-file.cjs [http://127.0.0.1:7422/] [light|dark]. CDP (default http://127.0.0.1:9222), OUT (/tmp).
const assert=require('node:assert/strict');const fs=require('node:fs');
(async()=>{
 const url=process.argv[2]||'http://127.0.0.1:7422/',scheme=process.argv[3]||'dark',cdp=process.env.CDP||'http://127.0.0.1:9222',out=(process.env.OUT||'/tmp')+'/lienzo-file-'+scheme+'-',downloads=process.env.DOWNLOADS||'/tmp/lienzo-file-downloads';
 const target=await(await fetch(cdp+'/json/new?about:blank',{method:'PUT'})).json();
 const ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((ok,no)=>{ws.addEventListener('open',ok,{once:true});ws.addEventListener('error',no,{once:true});});
 let seq=0;const pending=new Map(),uncaught=[];
 ws.addEventListener('message',e=>{const r=JSON.parse(e.data);if(r.method==='Runtime.exceptionThrown')uncaught.push(r.params.exceptionDetails);if(r.id){const p=pending.get(r.id);if(!p)return;pending.delete(r.id);r.error?p.no(Error(JSON.stringify(r.error))):p.ok(r.result);}});
 const call=(method,params={})=>new Promise((ok,no)=>{const id=++seq;pending.set(id,{ok,no});ws.send(JSON.stringify({id,method,params}));});
 const ev=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result?.value;};
 const pause=ms=>new Promise(r=>setTimeout(r,ms));
 const wait=async(expression,what=expression,ms=8000)=>{for(let n=0;n<ms/50;n++){if(await ev(expression))return;await pause(50);}throw Error('Condition timed out: '+what);};
 const q=s=>JSON.stringify(s),L=s=>'[aria-label='+q(s)+']';
 const click=async sel=>{await wait(`!!document.querySelector(${q(sel)})`,sel);const r=await ev(`(()=>{const e=document.querySelector(${q(sel)});e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);for(const type of ['mouseMoved','mousePressed','mouseReleased'])await call('Input.dispatchMouseEvent',{type,x:r.x,y:r.y,button:'left',buttons:type==='mousePressed'?1:0,clickCount:1});await pause(250);};
 const text=sel=>ev(`document.querySelector(${q(sel)})?.innerText??''`);
 const shot=async name=>{await pause(500);const r=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(out+name+'.png',Buffer.from(r.data,'base64'));};
 const rpc=(name,input)=>ev(`fetch('/rpc',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:${q(name)},input:${JSON.stringify(input)}})}).then(r=>r.json()).then(r=>{if(!r.ok)throw Error(r.message);return r.value})`);
 try{
  await call('Runtime.enable');await call('Page.enable');
  fs.mkdirSync(downloads,{recursive:true});await call('Browser.setDownloadBehavior',{behavior:'allow',downloadPath:downloads});
  await call('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});
  await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:scheme}]});
  await call('Page.navigate',{url});await wait('!!document.querySelector("#lienzo-toolbar")||!!document.querySelector("#lienzo-guide")||!!document.body.innerText.includes("New Lienzo")','the app',15000);
  if(await ev('!!document.querySelector("#lienzo-guide")')){await click('#lienzo-guide '+L('Skip'));await wait('!document.querySelector("#lienzo-guide")');}
  // Example data: a Lienzo with an image (a small generated PNG), a custom block type and an extension with storage.
  const png=await ev(`(()=>{const c=document.createElement('canvas');c.width=96;c.height=64;const x=c.getContext('2d');const g=x.createLinearGradient(0,0,96,64);g.addColorStop(0,'#c8553d');g.addColorStop(1,'#f2a65a');x.fillStyle=g;x.fillRect(0,0,96,64);x.fillStyle='#fff8';x.beginPath();x.arc(30,30,14,0,7);x.fill();return c.toDataURL('image/png').split(',')[1]})()`);
  const image=await rpc('canvas.media.put',{workspaceId:'desktop',data:png,name:'sunset.png'});
  let cat=await rpc('canvas.catalog.read',{});
  if(!cat.blockTypes.some(t=>t.id==='recipe'))cat=await rpc('canvas.catalog.mutate',{expectedRevision:cat.revision,action:{type:'type.put',blockType:{id:'recipe',name:'Recipe',description:'A dish and how to make it. Example type for QA.',properties:[{key:'text',label:'Steps',kind:'text'}],defaults:{text:''}}}});
  if(!cat.extensions.some(e=>e.id==='kitchen-timer'))cat=await rpc('canvas.catalog.mutate',{expectedRevision:cat.revision,action:{type:'extension.put',extension:{id:'kitchen-timer',kind:'tool',api:1,name:'Kitchen timer',description:'Example extension for QA.',icon:'Timer',html:'<p>Timer</p>',permissions:[]}}});
  const view=await rpc('canvas.create',{workspaceId:'desktop',content:{title:'Weeknight dinners',description:'Example data for QA.',communication:{instructions:''},links:[{id:'l1',from:'soup',to:'steps'}],
   groups:[{id:'s1',title:'Monday',blockIds:['photo','soup'],position:{x:0,y:0},sheet:{number:1,createdAt:'2026-10-19T00:00:00.000Z',source:'user'}}],
   blocks:[{id:'photo',typeId:'media',title:'Sunset soup',parentGroupId:'s1',data:{url:image.url,caption:'',mediaKind:'image'}},{id:'soup',typeId:'recipe',title:'Tomato soup',parentGroupId:'s1',data:{text:'Roast, blend, season.'}},{id:'steps',typeId:'checklist',title:'Shopping',position:{x:520,y:40},data:{items:['Tomatoes','Basil','Bread']}},{id:'tip',typeId:'note',title:'Tip',position:{x:520,y:260},data:{text:'Make double; it freezes well.'}}]}});
  const id=view.document.id;
  await rpc('canvas.comments.create',{workspaceId:'desktop',documentId:id,anchor:{kind:'block',id:'soup',dx:0,dy:0},text:'Less salt next time.'});
  await rpc('canvas.extension.storage',{workspaceId:'desktop',documentId:id,extensionId:'kitchen-timer',action:'set',value:{minutes:12}});
  await call('Page.reload');await wait('!!document.querySelector("#lienzo-document-island")','reload',15000);
  const menu=async item=>{await click('#lienzo-document-island '+L('Menu'));await click('#lienzo-interactive-menu '+L(item));};
  await menu('Lienzos');await wait('!!document.querySelector("#lienzo-lienzos")');await click(`#lienzo-card-${id}`);await wait(`document.querySelector('#lienzo-title')?.innerText.includes('Weeknight')`,'opened');
  // Export from the document menu.
  await menu('Export this Lienzo…');await wait('!!document.querySelector("#lienzo-export-sheet")');await wait(`/1 thread/.test(document.querySelector('#lienzo-export-sheet').innerText)`,'comment count');
  assert.match(await text('#lienzo-export-sheet'),/Weeknight dinners\.lienzo[\s\S]*Comments[\s\S]*What people did with interactive blocks[\s\S]*History is not included/);
  await click('#lienzo-export-comments');await shot('export');
  for(const f of fs.readdirSync(downloads))fs.rmSync(downloads+'/'+f);
  await click('#lienzo-export-sheet '+L('Export'));await wait('!document.querySelector("#lienzo-export-sheet")','closed after export');
  for(let n=0;n<150&&!fs.readdirSync(downloads).some(f=>f.endsWith('.lienzo'));n++)await pause(100);
  const saved=fs.readdirSync(downloads).find(f=>f.endsWith('.lienzo'));assert.equal(saved,'Weeknight dinners.lienzo','the browser download keeps the title');
  const file=JSON.parse(fs.readFileSync(downloads+'/'+saved,'utf8'));fs.rmSync(downloads+'/'+saved);
  assert.equal(file.format,'lienzo');assert.equal(file.comments.length,1);assert.equal(file.runtime,undefined);assert.equal(Object.keys(file.media).length,1);
  // A copy as someone else's computer would have written it: an extension from a file this one lacks, a recipe type that differs.
  file.catalog.extensions.push({id:'acme.pantry',kind:'tool',api:1,name:'Pantry',description:'Example extension for QA.',icon:'Package',html:'<p>Pantry</p>',permissions:['edit','network'],pack:{id:'acme',name:'Acme kitchen tools',description:'Example file.'}});
  file.catalog.blockTypes[0]={...file.catalog.blockTypes[0],name:'Recipe card'};
  // Drop it on the Lienzos screen, once the export's confirmation has gone.
  await pause(3600);
  await menu('Lienzos');await wait('!!document.querySelector("#lienzo-lienzos")');
  await ev(`(()=>{const dt=new DataTransfer();dt.items.add(new File([${q(JSON.stringify(file))}],'Weeknight dinners.lienzo',{type:''}));const t=document.querySelector('#lienzo-lienzos');for(const type of ['dragenter','dragover','drop'])t.dispatchEvent(new DragEvent(type,{dataTransfer:dt,bubbles:true,cancelable:true}));return true})()`);
  await wait('!!document.querySelector("#lienzo-import-sheet")');await wait(`document.querySelector('#lienzo-import-sheet').innerText.includes('Import as a new Lienzo')&&!document.querySelector('#lienzo-import-sheet').innerText.includes('Reading the file')`,'review');
  const review=await text('#lienzo-import-sheet');
  assert.match(review,/Imports as “Weeknight dinners \(imported\)”/);assert.match(review,/1 thread, authors kept/);assert.match(review,/Not included: blocks start fresh/);
  assert.match(review,/Recipe card[\s\S]*Yours kept/);assert.match(review,/Pantry[\s\S]*New/);assert.match(review,/Kitchen timer[\s\S]*Installed/);assert.match(review,/only read and select until you allow them/);
  await shot('review');
  await click('#lienzo-import-sheet '+L('Import as a new Lienzo'));await wait('!document.querySelector("#lienzo-import-sheet")','imported');
  await wait(`document.querySelector('#lienzo-title')?.innerText.includes('(imported)')`,'the imported Lienzo opens');await pause(600);await shot('imported-canvas');
  await menu('Lienzos');await wait('!!document.querySelector("#lienzo-lienzos")');await pause(900);await shot('lienzos');
  assert.match(await text('#lienzo-lienzos'),/Weeknight dinners \(imported\)[\s\S]*Weeknight dinners/);
  const cat2=await rpc('canvas.catalog.read',{});assert.equal(cat2.extensions.find(e=>e.id==='acme.pantry')?.granted,false,'not granted');assert.equal(cat2.blockTypes.find(t=>t.id==='recipe')?.name,'Recipe','the installed type is kept');
  assert.deepEqual(uncaught.map(u=>u.exception?.description||u.text),[],'something threw');
  console.log('PASS .lienzo files ('+scheme+'): export dialog, browser download, drop on Lienzos, review, import, new card');
 }finally{ws.close();await fetch(cdp+'/json/close/'+target.id).catch(()=>{});}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
