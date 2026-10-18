// The screens around the canvas (docs/redesign-2026-10.md, "UI pass"), example data only: Lienzos with live
// thumbnails, search, sort and the ⋯ menu; the four-scene guide; Settings (Shortcuts with in-place recording and a
// conflict, Toolbar, Copilot, Extensions, About); Extensions with a file review and install; History by day.
// Run with: node screens.cjs [oscuro|papel] [compact]. Captures go to $LIENZO_SHOTS (default /tmp)/lienzo-screens-<theme>[-compact]-*.png.
const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
(async()=>{
 const theme=process.argv[2]||'oscuro',compact=process.argv[3]==='compact',out=(process.env.LIENZO_SHOTS||'/tmp')+'/lienzo-screens-'+(theme==='papel'?'light':'dark')+(compact?'-compact':'')+'-';
 const W=compact?390:1280,H=compact?844:800;
 const pages=await(await fetch('http://127.0.0.1:9222/json/list')).json();
 const page=pages.find(p=>p.type==='page'&&p.url.startsWith('http://127.0.0.1:8765/'));if(!page)throw Error('QA page missing');
 const ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((ok,no)=>{ws.addEventListener('open',ok,{once:true});ws.addEventListener('error',no,{once:true});});
 let seq=0;const pending=new Map(),uncaught=[];let chooser=null;
 ws.addEventListener('message',e=>{const r=JSON.parse(e.data);if(r.method==='Runtime.exceptionThrown')uncaught.push(r.params.exceptionDetails);if(r.method==='Page.fileChooserOpened')chooser=r.params;if(r.id){const p=pending.get(r.id);if(!p)return;pending.delete(r.id);r.error?p.no(Error(JSON.stringify(r.error))):p.ok(r.result);}});
 const call=(method,params={})=>new Promise((ok,no)=>{const id=++seq;pending.set(id,{ok,no});ws.send(JSON.stringify({id,method,params}));});
 const ev=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result?.value;};
 const pause=ms=>new Promise(r=>setTimeout(r,ms));
 const wait=async(expression,what=expression)=>{for(let n=0;n<160;n++){if(await ev(expression))return;await pause(50);}throw Error('Condition timed out: '+what);};
 const mouse=(type,x,y,buttons=0)=>call('Input.dispatchMouseEvent',{type,x,y,button:'left',buttons,clickCount:1});
 const tap=async(x,y)=>{await mouse('mouseMoved',x,y);await mouse('mousePressed',x,y,1);await mouse('mouseReleased',x,y);await pause(250);};
 const q=s=>JSON.stringify(s);
 const rect=sel=>ev(`(()=>{const e=document.querySelector(${q(sel)});if(!e)return null;const r=e.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height}})()`);
 const click=async sel=>{await wait(`!!document.querySelector(${q(sel)})`,sel);await ev(`document.querySelector(${q(sel)}).scrollIntoView({block:"nearest",inline:"nearest"})`);await pause(120);const r=await rect(sel);await tap(r.x+r.w/2,r.y+r.h/2);};
 const hover=async sel=>{const r=await rect(sel);if(!r)throw Error('Missing '+sel);await mouse('mouseMoved',r.x+r.w/2,r.y+r.h/2);await pause(250);};
 const key=async(key,code,modifiers=0,text)=>{await call('Input.dispatchKeyEvent',{type:'keyDown',key,code,modifiers,text});await call('Input.dispatchKeyEvent',{type:'keyUp',key,code,modifiers});await pause(220);};
 const type=async text=>{await call('Input.insertText',{text});await pause(250);};
 const has=sel=>ev(`!!document.querySelector(${q(sel)})`);
 const text=sel=>ev(`document.querySelector(${q(sel)})?.innerText??''`);
 const shots=[];const shot=async name=>{await pause(300);const r=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(out+name+'.png',Buffer.from(r.data,'base64'));shots.push(out+name+'.png');};
 const L=s=>'[aria-label='+q(s)+']';
 const menu=async item=>{await click(compact?'[aria-label="Menu"]':'#lienzo-document-island [aria-label="Menu"]');await click(compact?'[role="dialog"] '+L(item):'#lienzo-interactive-menu '+L(item));};
 const inside=async sel=>{const r=await rect(sel);assert.ok(r&&r.x>=-1&&r.y>=-1&&r.x+r.w<=W+1&&r.y+r.h<=H+1,sel+' fits the panel: '+JSON.stringify(r));return r;};
 try{
 await call('Runtime.enable');await call('Page.enable');await call('DOM.enable');await call('Network.enable');await call('Network.setCacheDisabled',{cacheDisabled:true});
 await call('Emulation.setDeviceMetricsOverride',{width:W,height:H,deviceScaleFactor:compact?2:1,mobile:false});
 await call('Page.navigate',{url:'http://127.0.0.1:8765/?theme='+theme+(compact?'&compact=1':'')});await wait('!!document.querySelector("#lienzo-toolbar")');await pause(600);
 // Example Lienzos for the home screen: real layouts, so the thumbnails are drawn from them.
 await ev(`(()=>{const node=(id,title,parent,extra={})=>({id,typeId:'node',title,data:{summary:'Example data.'},parentGroupId:parent,...extra});
  const area=(id,title,ids,extra={})=>({id,title,description:'',blockIds:ids,groupIds:[],layout:{mode:'graph',direction:'right'},...extra});
  const hours=h=>new Date(Date.now()-h*3600e3).toISOString();
  __panelQA.addDocument({id:'qa-auth',title:'How sign-in works',updatedAt:hours(3),blocks:[node('b','Browser','client'),node('f','Form','client'),node('a','Auth API','server'),node('s','Session store','server'),node('t','Token','server')],groups:[area('client','Client',['b','f']),area('server','Server',['a','s','t'])],links:[{id:'l1',from:'b',to:'f',kind:'flow'},{id:'l2',from:'f',to:'a',kind:'flow'},{id:'l3',from:'a',to:'s',kind:'depends'},{id:'l4',from:'a',to:'t',kind:'flow'}],layout:{mode:'graph',direction:'right'}});
  const sheet=(n,title,ids,x)=>({id:'hoja'+n,title,description:'',blockIds:ids,groupIds:[],layout:{mode:'grid',columns:2},position:{x,y:0},sheet:{number:n,createdAt:hours(30),source:'agent'}});
  __panelQA.addDocument({id:'qa-cache',title:'Caching, explained in three Hojas',updatedAt:hours(26),layout:{mode:'free'},blocks:[node('c1','Request','hoja1'),node('c2','Cache hit','hoja1'),node('c3','Miss','hoja2'),{id:'n1',typeId:'note',title:'Why',data:{text:'Example.'},parentGroupId:'hoja2'},{id:'k1',typeId:'code',title:'Headers',data:{code:'Cache-Control: max-age=60',language:'http'},parentGroupId:'hoja3'},{id:'x1',typeId:'checklist',title:'Checks',data:{items:['Stale','Fresh']},parentGroupId:'hoja3'}],groups:[sheet(1,'The request',['c1','c2'],0),sheet(2,'A miss',['c3','n1'],760),sheet(3,'Headers',['k1','x1'],1520)],links:[{id:'cl',from:'c1',to:'c2',kind:'flow'}]},'agent-claude');
  __panelQA.addDocument({id:'qa-plan',title:'Q4 roadmap sketch',updatedAt:hours(24*5),layout:{mode:'free'},blocks:[{id:'p1',typeId:'note',title:'Goals',data:{text:'Example.'},position:{x:0,y:0}},{id:'p2',typeId:'checklist',title:'Ship',data:{items:['Lienzos','Guide']},position:{x:420,y:40}},{id:'p3',typeId:'code',title:'Config',data:{code:'x = 1',language:'text'},position:{x:120,y:320}}],groups:[],links:[{id:'pl',from:'p1',to:'p2',kind:'flow'},{id:'pl2',from:'p1',to:'p3',kind:'reference'}]});
  __panelQA.addDocument({id:'qa-empty',title:'Untitled Lienzo',updatedAt:hours(24*40),blocks:[],groups:[],links:[]});
 })()`);
 // 1. Lienzos: the home, a grid of live thumbnails.
 await menu('Lienzos');await wait('!!document.querySelector("#lienzo-lienzos")');await wait('document.querySelectorAll("[id^=lienzo-card-]").length===5','five Lienzo cards');await pause(900);
 const sheet=await inside('#lienzo-screen-lienzos');if(!compact){assert.ok(sheet.w<=961&&sheet.h<=681,'up to 960 × 680');assert.ok(sheet.x>=23&&sheet.y>=23,'24 px from the edges');}
 const cards=await ev(`[...document.querySelectorAll('[id^=lienzo-card-]')].map(e=>e.id.slice(12))`);assert.deepEqual(cards,['qa-auth','qa-cache','qa-plan','qa-board','qa-empty'],'recent first');
 assert.match(await text('#lienzo-card-qa-cache'),/Edited 1 d ago · 6 blocks · 3 Hojas/);assert.match(await text('#lienzo-card-qa-cache'),/agent-claude|Agent/i);
 assert.ok(!(await ev('document.body.innerText.includes("Examples")')),'no examples section');
 await shot('lienzos');
 await click('#lienzo-lienzos-search');await type('caching');await wait('document.querySelectorAll("[id^=lienzo-card-]").length===1','search filters as you type');
 await ev(`(()=>{const e=document.querySelector('#lienzo-lienzos-search');const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(e,'');e.dispatchEvent(new Event('input',{bubbles:true}));})()`);await wait('document.querySelectorAll("[id^=lienzo-card-]").length===5');
 await click('#lienzo-lienzos [aria-label="Name"]');await wait(`[...document.querySelectorAll('[id^=lienzo-card-]')][0].id==='lienzo-card-qa-cache'`,'sorted by name');await click('#lienzo-lienzos [aria-label="Recent"]');
 await hover('#lienzo-card-qa-auth');await click(L('More for How sign-in works'));await wait('!!document.querySelector("#lienzo-card-menu-qa-auth")');await shot('lienzos-menu');
 await click('#lienzo-card-menu-qa-auth [aria-label="Delete…"]');await wait('!!document.querySelector("#lienzo-delete-qa-auth")');await shot('lienzos-delete');await click('#lienzo-delete-qa-auth [aria-label="Cancel"]');
 await click('#lienzo-card-qa-auth');await wait('!document.querySelector("#lienzo-lienzos")','choosing a card closes the sheet');await wait('__panelQA.doc().id==="qa-auth"','and opens it');await pause(500);
 // 2. The guide: four scenes that play by themselves.
 await menu('Lienzo guide');await wait('!!document.querySelector("#lienzo-guide-stage")');await inside('#lienzo-guide');
 for(let i=0;i<4;i++){await pause(i===3?5600:i?3600:3200);assert.match(await text('#lienzo-guide'),new RegExp((i+1)+' of 4','i'));await shot('guide-'+(i+1));if(i<3)await click('#lienzo-guide [aria-label="Next"]');}
 assert.match(await text('#lienzo-guide'),/Paseo[\s\S]*desktop app/);await click('#lienzo-guide [aria-label="Skip"]');await wait('!document.querySelector("#lienzo-guide")');
 // Pin three tools from the + catalog, for Settings → Toolbar.
 await click('#lienzo-tool-add');await wait('!!document.querySelector("#lienzo-add-menu")');
 for(const name of ['Rectangle','Ventana','Image']){await click('#lienzo-add-menu '+L('Pin '+name));}
 await click('[aria-label="Close the catalog"]');await pause(300);
 // 3. Settings, two columns. Shortcuts record in place; a conflict shows on the row that lost its keys.
 await menu('Settings');await wait('!!document.querySelector("#lienzo-settings-shortcuts")');await inside('#lienzo-screen-settings');await shot('settings-shortcuts');
 await click('[id="lienzo-shortcut-tool.hand"] [aria-label="Change keys for Hand"]');await wait('document.body.innerText.includes("Press keys…")');await shot('settings-recording');
 await key('p','KeyP');await wait(`!!document.querySelector('[id="lienzo-shortcut-tool.hand"] [aria-label="Reset Hand"]')`,'Hand overridden');
 assert.match(await text('[id="lienzo-shortcut-tool.pencil"]'),/Keys taken by Hand/);await shot('settings-conflict');
 await click('[id="lienzo-shortcut-tool.text"] [aria-label="Change keys for Text"]');await key('Escape','Escape');assert.ok(await has('#lienzo-screen-settings'),'Escape cancels recording, not the screen');assert.ok(!(await ev('document.body.innerText.includes("Press keys…")')));
 await click('#lienzo-settings-shortcuts [aria-label="Reset all"]');await wait(`!document.querySelector('[id="lienzo-shortcut-tool.hand"] [aria-label="Reset Hand"]')`,'reset all');
 await click('#lienzo-rail-toolbar');await wait('!!document.querySelector("#lienzo-settings-toolbar-screen")');await wait('document.querySelectorAll("[id^=lienzo-settings-pinned-]").length===3','three pinned');
 await click(L('Move Image earlier'));await wait(`[...document.querySelectorAll('[id^=lienzo-settings-pinned-]')].map(e=>e.id.slice(23)).join()==='shape.rect,image,ventana'`,'reordered');
 for(const [id,name] of [['toolbar','toolbar'],['copilot','copilot'],['extensions','extensions'],['about','about']]){await click('#lienzo-rail-'+id);await wait(`!!document.querySelector('#lienzo-settings-${id}-screen')`,id);await pause(400);await shot('settings-'+name);}
 assert.match(await text('#lienzo-settings-about'),/state\.json/);
 await key('Escape','Escape');await wait('!document.querySelector("#lienzo-screen-settings")','Escape closes the screen');
 // 4. Extensions: installed cards, a file reviewed before anything is saved, then installed without permissions.
 await menu('Extensions');await wait('!!document.querySelector("#lienzo-extensions")');await wait('!!document.querySelector("[id=\'lienzo-extension-card-find-replace\']")');await shot('extensions');
 await call('Page.setInterceptFileChooserDialog',{enabled:true});chooser=null;await click('#lienzo-extensions [aria-label="Add from file…"]');for(let i=0;i<60&&!chooser;i++)await pause(40);assert.ok(chooser,'file chooser');
 await call('DOM.setFileInputFiles',{files:[path.resolve(__dirname,'fixtures/timer.lienzo-extensions.json')],backendNodeId:chooser.backendNodeId});await call('Page.setInterceptFileChooserDialog',{enabled:false});
 await wait('!!document.querySelector("#lienzo-extension-review")','the review');assert.match(await text('#lienzo-extension-review'),/Timer[\s\S]*Changes the canvas[\s\S]*Selection count[\s\S]*Reads and selects only/);
 assert.equal(await ev('__panelQA.catalog.packs.length'),0,'nothing saved before Install');await shot('extensions-review');
 await click('#lienzo-extension-review [aria-label="Install"]');await wait('!!document.querySelector("[id=\'lienzo-extension-card-workshop.timer\']")','installed');
 assert.match(await text('[id="lienzo-extension-card-workshop.timer"]'),/From “Workshop tools \(example\)”[\s\S]*Not allowed yet/);await pause(400);await shot('extensions-installed');
 await key('Escape','Escape');await wait('!document.querySelector("#lienzo-extensions")');
 // 5. History: a timeline by day; a chip closes the sheet and flies there.
 await ev(`(()=>{const at=(d,h)=>{const t=new Date();t.setDate(t.getDate()-d);t.setHours(h,12,0,0);return t.toISOString();};const ids=__panelQA.doc().blocks.map(b=>b.id);
  __panelQA.setHistory([{id:'h1',revision:1,actor:'user',label:'Create the Lienzo',at:at(3,10),changed:['$document'],removed:[],kind:'edit'},{id:'h2',revision:2,actor:'agent',agentId:'agent-claude',label:'Add the client and the server',at:at(1,16),changed:ids.slice(0,3),removed:[],kind:'edit'},{id:'h3',revision:3,actor:'agent',agentId:'agent-claude',label:'Link the form to the API',at:at(0,9),changed:[ids[1],ids[2]],removed:[],kind:'edit'},{id:'h4',revision:4,actor:'user',label:'Rename “Token”',at:at(0,11),changed:[ids[4]],removed:[],kind:'edit'},{id:'h5',revision:5,actor:'user',label:'Undo: Move selection',at:at(0,11),changed:[ids[0]],removed:[],kind:'undo'}]);})()`);
 await menu('History');await wait('/today/i.test(document.querySelector("#lienzo-history")?.innerText??"")');await pause(500);
 assert.match(await text('#lienzo-history'),/TODAY[\s\S]*Rename[\s\S]*YESTERDAY[\s\S]*Add the client/i);await shot('history');
 const chip=await ev(`[...document.querySelectorAll('#lienzo-history [aria-label^="Go to "]')][0]?.getAttribute('aria-label')`);assert.ok(chip,'a chip');await click('#lienzo-history '+L(chip));
 await wait('!document.querySelector("#lienzo-history")','the chip closes the sheet');await wait('__panelQA.doc().selectedIds.length===1','and selects what changed');await pause(600);await shot('history-flown');
 // 6. Empty Lienzos: delete through the ⋯ menu until none is left.
 if(!compact){await menu('Lienzos');await wait('!!document.querySelector("#lienzo-lienzos")');
  for(let n=0;n<5;n++){const id=await ev(`document.querySelector('[id^=lienzo-card-]:not([id^=lienzo-card-menu])')?.id.slice(12)`);if(!id)break;const title=await ev(`document.querySelector('#lienzo-card-${id}').getAttribute('aria-label').slice(5)`);
   await hover('#lienzo-card-'+id);await click(L('More for '+title));await click('#lienzo-card-menu-'+id+' [aria-label="Delete…"]');await click('#lienzo-delete-'+id+' [aria-label="Delete"]');await wait(`!document.querySelector('#lienzo-card-${id}')`,'deleted '+id);}
  await wait('document.querySelector("#lienzo-lienzos").innerText.includes("No Lienzos yet")','the empty state');await pause(800);await shot('lienzos-empty');}
 assert.deepEqual(uncaught.map(u=>u.exception?.description||u.text),[],'something threw');assert.equal(await ev('__panelQA.actions.length'),0,'nothing sent to an agent');
 fs.writeFileSync(out+'results.json',JSON.stringify({shots},null,1));
 console.log('PASS screens ('+theme+(compact?', compact':'')+'): Lienzos, guide, Settings, Extensions, History · '+shots.length+' captures');
 }finally{await call('Emulation.clearDeviceMetricsOverride').catch(()=>{});ws.close();}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
