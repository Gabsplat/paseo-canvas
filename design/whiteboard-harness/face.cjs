// The new face (docs/redesign-2026-10.md, stage 1), example data only: toolbar tools and keys, tooltips, the +
// catalog with search and pins, the right panel and selection bar, ⌘K running a tool, the ? sheet, reassigning a
// key, the empty-canvas mate and the kettle. Run with no argument (dark) or `papel` (light).
// The canvas is one-way: there is no composer, no "Ask the agent", and nothing reaches an assistant.
const assert=require('node:assert/strict');const fs=require('node:fs');
(async()=>{
 const theme=process.argv[2]||'oscuro',out='/tmp/lienzo-face-'+(theme==='papel'?'light-':'dark-');
 const pages=await(await fetch('http://127.0.0.1:9222/json/list')).json();
 const page=pages.find(p=>p.type==='page'&&p.url.startsWith('http://127.0.0.1:8765/'));if(!page)throw Error('QA page missing');
 const ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((ok,no)=>{ws.addEventListener('open',ok,{once:true});ws.addEventListener('error',no,{once:true});});
 let seq=0;const pending=new Map(),uncaught=[];
 ws.addEventListener('message',e=>{const r=JSON.parse(e.data);if(r.method==='Runtime.exceptionThrown')uncaught.push(r.params.exceptionDetails);if(r.id){const p=pending.get(r.id);if(!p)return;pending.delete(r.id);r.error?p.no(Error(JSON.stringify(r.error))):p.ok(r.result);}});
 const call=(method,params={})=>new Promise((ok,no)=>{const id=++seq;pending.set(id,{ok,no});ws.send(JSON.stringify({id,method,params}));});
 const ev=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result?.value;};
 const wait=async(expression,what=expression)=>{for(let n=0;n<120;n++){if(await ev(expression))return;await pause(50);}throw Error('Condition timed out: '+what);};
 const pause=ms=>new Promise(r=>setTimeout(r,ms));
 const mouse=(type,x,y,buttons=0)=>call('Input.dispatchMouseEvent',{type,x,y,button:'left',buttons,clickCount:1});
 const tap=async(x,y)=>{await mouse('mouseMoved',x,y);await mouse('mousePressed',x,y,1);await mouse('mouseReleased',x,y);await pause(250);};
 const q=sel=>JSON.stringify(sel);
 const rect=sel=>ev(`(()=>{const e=document.querySelector(${q(sel)});if(!e)return null;const r=e.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height}})()`);
 const click=async sel=>{const r=await rect(sel);if(!r)throw Error('Missing '+sel);await tap(r.x+r.w/2,r.y+r.h/2);};
 const hover=async sel=>{const r=await rect(sel);if(!r)throw Error('Missing '+sel);await mouse('mouseMoved',r.x+r.w/2,r.y+r.h/2);};
 const key=async(key,code,modifiers=0,text)=>{await call('Input.dispatchKeyEvent',{type:'keyDown',key,code,modifiers,text});await call('Input.dispatchKeyEvent',{type:'keyUp',key,code,modifiers});await pause(200);};
 const type=async text=>{await call('Input.insertText',{text});await pause(200);};
 const has=sel=>ev(`!!document.querySelector(${q(sel)})`);
 const text=sel=>ev(`document.querySelector(${q(sel)})?.innerText??''`);
 const pressed=id=>ev(`document.querySelector('#lienzo-tool-${id}')?.getAttribute('aria-pressed')==='true'`);
 const shot=async name=>{await pause(250);const r=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(out+name+'.png',Buffer.from(r.data,'base64'));};
 const background=()=>tap(1000,560);
 try{
 await call('Runtime.enable');await call('Page.enable');await call('Network.setCacheDisabled',{cacheDisabled:true});
 await call('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});
 await call('Page.navigate',{url:'http://127.0.0.1:8765/?theme='+theme});await wait('!!document.querySelector("#lienzo-entity-note")');await pause(600);
 // 1. One view: nothing anywhere offers to switch it.
 const labels=await ev(`[...document.querySelectorAll('[aria-label]')].map(e=>e.getAttribute('aria-label')).join('|')`);
 for(const gone of ['Cambiar vista','Change view','Vistas','Foco','Lecturas','Matriz','Herramientas propias','Ver como lista'])assert.ok(!labels.includes(gone),'no view switcher: '+gone);
 assert.ok(!(await has('#lienzo-interactive-views')),'no view menu');
 // 2. The toolbar: order, keys, and on the bottom edge with no composer.
 const order=await ev(`[...document.querySelectorAll('[id^="lienzo-tool-"]')].map(e=>e.id.slice(12))`);
 assert.deepEqual(order,['select','hand','pencil','shape','text','arrow','eraser','marco','ventana','add']);
 const bar=await rect('#lienzo-toolbar');assert.ok(!(await has('#lienzo-composer')),'no composer');assert.equal(Math.round(bar.h),44,'44 px toolbar');
 assert.ok(Math.abs(800-(bar.y+bar.h)-12)<=2,'the toolbar sits 12 px from the bottom edge: '+JSON.stringify(bar));
 {const zoom=await rect('[aria-label="Fit all"]');if(zoom)assert.ok(Math.abs((zoom.y+zoom.h/2)-(bar.y+bar.h/2))<=14,'level with the zoom control');}
 {const all=await ev(`document.body.innerText+'|'+[...document.querySelectorAll('[aria-label],[placeholder]')].map(e=>e.getAttribute('aria-label')+' '+e.getAttribute('placeholder')).join('|')`);
  for(const gone of ['Write to the agent','Send to the agent','actions queued','Ask the agent','Received by the agent','Queued'])assert.ok(!all.includes(gone),'gone: '+gone);}
 await shot('bottom');
 assert.ok(Math.abs(bar.x+bar.w/2-640)<2,'centred');
 await background();
 for(const [k,code,id] of [['p','KeyP','pencil'],['h','KeyH','hand'],['r','KeyR','shape'],['a','KeyA','arrow'],['t','KeyT','text'],['e','KeyE','eraser'],['o','KeyO','shape'],['v','KeyV','select']]){await key(k,code);await wait(`document.querySelector('#lienzo-tool-${id}')?.getAttribute('aria-pressed')==='true'`,k+' → '+id);}
 const groups=await ev('__panelQA.doc().groups.length');await key('m','KeyM');await wait('__panelQA.doc().groups.length==='+(groups+1),'M adds a Marco');
 await key('z','KeyZ',2);await wait('__panelQA.doc().groups.length==='+groups,'⌘Z undoes it');
 await key('w','KeyW');await wait(`document.body.innerText.includes('Paste a link to a page')`,'W opens the Ventana dialog');await key('Escape','Escape');await pause(300);
 // 3. Tooltips: after 500 ms, name then key; the next one at once; never over the control.
 await hover('#lienzo-tool-pencil');await pause(250);assert.ok(!(await has('#lienzo-tooltip')),'not before 500 ms');
 await wait(`document.querySelector('#lienzo-tooltip')?.innerText.includes('Pencil')`,'pencil tooltip');assert.match(await text('#lienzo-tooltip'),/Pencil\s*P/);
 let tip=await rect('#lienzo-tooltip'),pencil=await rect('#lienzo-tool-pencil');assert.ok(tip.y+tip.h<=pencil.y,'above the toolbar button, not over it');
 await shot('tooltip');
 await hover('#lienzo-tool-marco');await pause(120);assert.match(await text('#lienzo-tooltip'),/Marco\s*M[\s\S]*Spanish for frame/,'warm: the next tooltip is immediate and explains the glossary word');
 await hover('#lienzo-top-right [aria-label="Search and commands"]');await pause(150);tip=await rect('#lienzo-tooltip');const search=await rect('#lienzo-top-right [aria-label="Search and commands"]');assert.ok(tip.y>=search.y+search.h,'away from the top edge');assert.match(await text('#lienzo-tooltip'),/Search and commands\s*Ctrl\+K/);
 await mouse('mouseMoved',1000,560);await pause(900);
 // 4. The + catalog: search focused, sections, pin.
 await click('#lienzo-tool-add');await wait('!!document.querySelector("#lienzo-add-menu")');
 assert.equal(await ev('document.activeElement?.id'),'lienzo-add-search','search is focused on open');
 const sections=await text('#lienzo-add-menu');for(const s of ['Shapes & drawing','Embeds','Blocks','Extensions','Manage extensions…'])assert.ok(sections.includes(s),s);
 await shot('catalog');
 await type('ellip');await wait('!!document.querySelector(\'[id="lienzo-add-shape.ellipse"]\')');assert.ok(!(await has('[id="lienzo-add-pencil"]')),'search narrows');
 await hover('[id="lienzo-add-shape.ellipse"]');await click('[aria-label="Pin Ellipse"]');await pause(300);await key('Escape','Escape');
 await wait('!document.querySelector("#lienzo-add-menu")');await wait('!!document.querySelector(\'[id="lienzo-pinned-shape.ellipse"]\')','pinned in the toolbar');
 await background();await key('v','KeyV');await key('1','Digit1');await wait(`document.querySelector('#lienzo-tool-shape')?.getAttribute('aria-pressed')==='true'`,'1 runs the first pinned tool');await key('v','KeyV');
 // 5. Selection: the bar over it and Properties on the right.
 await click('#lienzo-entity-note');await wait('!!document.querySelector("#lienzo-right-panel")','the right panel appears on selection');await wait('!!document.querySelector("#lienzo-interactive-selection-toolbar")');
 const barLabels=await ev(`[...document.querySelectorAll('#lienzo-interactive-selection-toolbar [aria-label]')].map(e=>e.getAttribute('aria-label'))`);
 assert.deepEqual(barLabels,['Wrap in a Marco','Duplicate','Delete']);
 assert.ok(!/Ask the agent/.test(await text('#lienzo-right-panel')),'Properties has no Ask the agent');
 const panel=await rect('#lienzo-right-panel');assert.equal(Math.round(panel.w),300);assert.equal(Math.round(1280-panel.x-panel.w),12);
 assert.match(await text('#lienzo-right-panel'),/Properties[\s\S]*Content[\s\S]*Instructions for the agent[\s\S]*Actions/);
 await shot('selection');
 await key('\\','Backslash',2);await wait('!document.querySelector("#lienzo-right-panel")','⌘\\ hides it');await key('\\','Backslash',2);await wait('!!document.querySelector("#lienzo-right-panel")','and shows it');
 // 6. ⌘K runs a tool; a free query offers nothing that sends to the agent.
 await key('k','KeyK',2);await wait('!!document.querySelector("#lienzo-palette")');assert.equal(await ev('document.activeElement?.id'),'lienzo-palette-input');
 await shot('palette-recent');
 await type('pencil');await pause(200);await key('Enter','Enter',0,'\r');await wait('!document.querySelector("#lienzo-palette")');await wait(`document.querySelector('#lienzo-tool-pencil')?.getAttribute('aria-pressed')==='true'`,'⌘K ran Pencil');
 await key('Escape','Escape');await click('#lienzo-entity-note');
 const before=await ev('__panelQA.actions.length');
 await key('k','KeyK',2);await wait('!!document.querySelector("#lienzo-palette")');await type('Explain this note');await pause(300);
 assert.ok(!(await has('#lienzo-palette-item-ask')),'no Ask the agent item');assert.doesNotMatch(await text('#lienzo-palette'),/ASK THE AGENT/i);
 await key('Escape','Escape');await pause(200);
 assert.equal(await ev('__panelQA.actions.length'),before,'nothing was sent');assert.ok(!(await ev('__panelQA.errors.some(e=>/agent\\.(action|events)/.test(e.name))')),'no retired RPC was called');
 await key('k','KeyK',2);await wait('!!document.querySelector("#lienzo-palette")');assert.match(await text('#lienzo-palette'),/RECENT[\s\S]*Pencil/i,'Recent remembers');await key('Escape','Escape');
 // 7. ? opens Settings → Shortcuts: the cheat sheet and reassigning are one screen.
 await background();await key('?','Slash',8,'?');await wait('!!document.querySelector("#lienzo-settings-shortcuts")');{const sheet=await text('#lienzo-settings-shortcuts');assert.ok(/Follow the agent/.test(sheet)&&/Previous Hoja/.test(sheet),sheet.slice(0,200));}await shot('sheet');
 // 8. Give Text the key Q in place (press its key chip, then Q); T stops, Q works; Reset.
 await click('[id="lienzo-shortcut-tool.text"] [aria-label="Change keys for Text"]');await key('q','KeyQ');await wait(`!!document.querySelector('[id="lienzo-shortcut-tool.text"] [aria-label="Reset Text"]')`,'overridden');
 await shot('settings');await key('Escape','Escape');await wait('!document.querySelector("#lienzo-screen-settings")','Escape closes Settings');
 await background();await key('t','KeyT');assert.ok(!(await pressed('text')),'T is no longer Text');await key('q','KeyQ');await wait(`document.querySelector('#lienzo-tool-text')?.getAttribute('aria-pressed')==='true'`,'Q is Text');await key('v','KeyV');
 await click('#lienzo-document-island [aria-label="Menu"]');await click('#lienzo-interactive-menu [aria-label="Settings"]');await click('[id="lienzo-shortcut-tool.text"] [aria-label="Reset Text"]');await pause(200);await key('Escape','Escape');await pause(300);
 await background();await key('t','KeyT');await wait(`document.querySelector('#lienzo-tool-text')?.getAttribute('aria-pressed')==='true'`,'T is Text again');await key('v','KeyV');
 // 9. The kettle when ⌘K hears "mate".
 await key('k','KeyK',2);await type('mate');await wait('!!document.querySelector("#lienzo-kettle")','the kettle boils');await key('Escape','Escape');await shot('kettle');
 // 10. An empty canvas: the mate.
 await ev(`(()=>{const d=__panelQA.doc();__panelQA.seed([...d.links.map(l=>({type:'link.delete',id:l.id})),...d.blocks.filter(b=>!b.parentGroupId).map(b=>({type:'block.delete',id:b.id})),...d.groups.filter(g=>!g.parentGroupId).map(g=>({type:'group.delete',id:g.id}))]);})()`);
 await wait('!!document.querySelector("#lienzo-empty-mate")','the empty canvas shows the mate');assert.match(await text('#lienzo-empty-mate'),/Empty\. Pour yourself a mate\./);await pause(1200);await shot('empty');
 assert.deepEqual(uncaught.map(u=>u.exception?.description||u.text),[],'something threw');assert.ok(!/Plugin failed|Minified React/.test(await ev('document.body.innerText')));
 console.log('PASS face ('+theme+'): toolbar on the bottom edge and keys, no composer, tooltips, + catalog with pins, Properties, selection bar without ask, ⌘K tool and no ask, ? opens Settings → Shortcuts, key reassigned in place, kettle, mate');
 }finally{await call('Emulation.clearDeviceMetricsOverride').catch(()=>{});ws.close();}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
