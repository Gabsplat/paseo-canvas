// Help, the in-app wiki, and the extensions catalog (docs/design.md §35.7), example data only: Help from the menu,
// pages, search, the ? of Properties, Help in ⌘K; Discover reading the catalog index (served locally by intercepting
// raw.githubusercontent.com: no real network), installing through the review, the installed extension's own Help
// page, the offline state, and Publish… on a local extension.
// Run with: node wiki.cjs [oscuro|papel] [compact]. Captures go to $LIENZO_SHOTS (default /tmp)/lienzo-wiki-<theme>[-compact]-*.png.
const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
(async()=>{
 const theme=process.argv[2]||'oscuro',compact=process.argv[3]==='compact',out=(process.env.LIENZO_SHOTS||'/tmp')+'/lienzo-wiki-'+(theme==='papel'?'light':'dark')+(compact?'-compact':'')+'-';
 const DEBUG=process.env.LIENZO_DEBUG_PORT||9222,QA=process.env.LIENZO_QA_PORT||8765,W=compact?390:1280,H=compact?844:800,root=path.join(__dirname,'..','..');
 const index=fs.readFileSync(path.join(root,'marketplace/index.json')),file=fs.readFileSync(path.join(root,'marketplace/extensions/title-case/extension.json'));
 const pages=await(await fetch('http://127.0.0.1:'+DEBUG+'/json/list')).json();
 const page=pages.find(p=>p.type==='page'&&p.url.startsWith('http://127.0.0.1:'+QA+'/'));if(!page)throw Error('QA page missing');
 const ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((ok,no)=>{ws.addEventListener('open',ok,{once:true});ws.addEventListener('error',no,{once:true});});
 let seq=0,network='online';const pending=new Map(),uncaught=[],served=[];
 const call=(method,params={})=>new Promise((ok,no)=>{const id=++seq;pending.set(id,{ok,no});ws.send(JSON.stringify({id,method,params}));});
 ws.addEventListener('message',e=>{const r=JSON.parse(e.data);if(r.method==='Runtime.exceptionThrown')uncaught.push(r.params.exceptionDetails);
  if(r.method==='Fetch.requestPaused'){const {requestId,request}=r.params;served.push(request.url);
   if(network==='offline'){void call('Fetch.failRequest',{requestId,errorReason:'InternetDisconnected'});return;}
   const body=request.url.endsWith('/index.json')?index:request.url.endsWith('/extensions/title-case/extension.json')?file:null;
   if(!body){void call('Fetch.fulfillRequest',{requestId,responseCode:404,responseHeaders:[{name:'access-control-allow-origin',value:'*'}],body:''});return;}
   void call('Fetch.fulfillRequest',{requestId,responseCode:200,responseHeaders:[{name:'content-type',value:'text/plain; charset=utf-8'},{name:'access-control-allow-origin',value:'*'}],body:body.toString('base64')});return;}
  if(r.id){const p=pending.get(r.id);if(!p)return;pending.delete(r.id);r.error?p.no(Error(JSON.stringify(r.error))):p.ok(r.result);}});
 const ev=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result?.value;};
 const pause=ms=>new Promise(r=>setTimeout(r,ms));
 const wait=async(expression,what=expression)=>{for(let n=0;n<160;n++){if(await ev(expression))return;await pause(50);}throw Error('Condition timed out: '+what);};
 const mouse=(type,x,y,buttons=0)=>call('Input.dispatchMouseEvent',{type,x,y,button:'left',buttons,clickCount:1});
 const tap=async(x,y)=>{await mouse('mouseMoved',x,y);await mouse('mousePressed',x,y,1);await mouse('mouseReleased',x,y);await pause(250);};
 const q=s=>JSON.stringify(s);
 const rect=sel=>ev(`(()=>{const e=document.querySelector(${q(sel)});if(!e)return null;const r=e.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height}})()`);
 const click=async sel=>{await wait(`!!document.querySelector(${q(sel)})`,sel);await ev(`document.querySelector(${q(sel)}).scrollIntoView({block:"nearest",inline:"nearest"})`);await pause(120);const r=await rect(sel);await tap(r.x+r.w/2,r.y+r.h/2);};
 const key=async(key,code,modifiers=0,text)=>{await call('Input.dispatchKeyEvent',{type:'keyDown',key,code,modifiers,text});await call('Input.dispatchKeyEvent',{type:'keyUp',key,code,modifiers});await pause(220);};
 const type=async text=>{await call('Input.insertText',{text});await pause(300);};
 const has=sel=>ev(`!!document.querySelector(${q(sel)})`);
 const text=sel=>ev(`document.querySelector(${q(sel)})?.innerText??''`);
 const clear=sel=>ev(`(()=>{const e=document.querySelector(${q(sel)});const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(e,'');e.dispatchEvent(new Event('input',{bubbles:true}));})()`);
 const shots=[];const shot=async name=>{await pause(350);const r=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(out+name+'.png',Buffer.from(r.data,'base64'));shots.push(out+name+'.png');};
 const L=s=>'[aria-label='+q(s)+']';
 const menu=async item=>{await click(compact?'[aria-label="Menu"]':'#lienzo-document-island [aria-label="Menu"]');await click(compact?'[role="dialog"] '+L(item):'#lienzo-interactive-menu '+L(item));};
 const inside=async sel=>{const r=await rect(sel);assert.ok(r&&r.x>=-1&&r.y>=-1&&r.x+r.w<=W+1&&r.y+r.h<=H+1,sel+' fits the panel: '+JSON.stringify(r));return r;};
 const topic=async id=>{if(compact&&!(await has('[id="lienzo-help-item-'+id+'"]')))await click('#lienzo-help [aria-label="All topics"]');await click('[id="lienzo-help-item-'+id+'"]');await wait(`!!document.querySelector('[id="lienzo-help-page-${id}"]')`,'page '+id);};
 try{
 await call('Runtime.enable');await call('Page.enable');await call('Network.enable');await call('Network.setCacheDisabled',{cacheDisabled:true});
 await call('Fetch.enable',{patterns:[{urlPattern:'https://raw.githubusercontent.com/*'}]});
 await call('Emulation.setDeviceMetricsOverride',{width:W,height:H,deviceScaleFactor:compact?2:1,mobile:false});
 await call('Page.navigate',{url:'http://127.0.0.1:'+QA+'/?theme='+theme+(compact?'&compact=1':'')});await wait('!!document.querySelector("#lienzo-toolbar")');await pause(600);
 await ev('localStorage.clear()');
 // 1. Help from the menu: the home page, the rail of every topic.
 await menu('Help');await wait('!!document.querySelector("#lienzo-help")');await inside('#lienzo-screen-help');
 if(!compact){for(const id of ['start.lienzo','drawing.pencil','shapes.shapes','text.free','frames.frame','sheets.sheets','windows.window','interactive.controls','mini.app','lenses.lens','shortcuts.keys','agents.point','ext.discover','make.overview'])assert.ok(await has('[id="lienzo-help-item-'+id+'"]'),'rail lists '+id);}
 assert.match(await text('#lienzo-help'),/What Lienzo is/);await shot('home');
 // 2. A page: purpose, steps by hand, prompts, tips, keys, a picture, related.
 await topic('frames.frame');const frame=await text('[id="lienzo-help-page-frames.frame"]');
 for(const part of ['By hand','Ask your agent','Tips','Related','Shortcut'])assert.ok(frame.includes(part),'the page has '+part);
 assert.ok(await has('[id="lienzo-help-art-frames.frame"]'),'a picture');assert.doesNotMatch(frame,/\bMarco\b/);await shot('frame');
 await click('[id="lienzo-help-related-frames.layout"]');await wait(`!!document.querySelector('[id="lienzo-help-page-frames.layout"]')`,'related link');
 // 3. Search across every page.
 if(compact)await click('#lienzo-help [aria-label="All topics"]');
 await click('#lienzo-help-search');await type('pull request');await wait('!!document.querySelector("#lienzo-help-results")');
 assert.match(await text('#lienzo-help-results'),/Publish to the catalog/);await shot('search');
 await click('[id="lienzo-help-item-ext.publish"]');await wait(`!!document.querySelector('[id="lienzo-help-page-ext.publish"]')`);
 if(compact)await click('#lienzo-help [aria-label="All topics"]');await click('#lienzo-help [aria-label="Clear the search"]');await wait('!document.querySelector("#lienzo-help-results")','search cleared');
 // 4. The live shortcut list, and the tutorial's complete example in Markdown.
 await topic('shortcuts.keys');await wait('!!document.querySelector("#lienzo-help-shortcuts")');assert.match(await text('#lienzo-help-shortcuts'),/Command palette/);await shot('shortcuts');
 await topic('make.example');await wait(`!!document.querySelector('[id="lienzo-help-body-make.example"]')`);assert.match(await text('[id="lienzo-help-body-make.example"]'),/lienzo\.edit\(ops/);
 await ev(`document.querySelector('[id="lienzo-help-body-make.example"]').scrollIntoView({block:'start'})`);await shot('tutorial-example');
 await key('Escape','Escape');await wait('!document.querySelector("#lienzo-screen-help")','Escape closes Help');
 // 5. The ? of Properties opens the page of what is selected.
 // (Compact shows the Lienzo as a list, where Properties is a sheet: checked on the wide panel.)
 if(!compact){await click('#lienzo-entity-note');await wait('!!document.querySelector("#lienzo-right-panel")');
 await click('#lienzo-right-panel [aria-label="Help: Properties"]');await wait(`!!document.querySelector('[id="lienzo-help-page-text.note"]')`,'the Note page');await shot('from-properties');
 await key('Escape','Escape');await wait('!document.querySelector("#lienzo-screen-help")');}
 // 6. ⌘K finds Help pages.
 await key('k','KeyK',compact?2:4);await wait('!!document.querySelector("[id^=lienzo-palette-item-]")');await type('lens');
 await wait(`!!document.querySelector('[id="lienzo-palette-item-help.lenses.lens"]')`,'Help in ⌘K');await shot('palette');
 await click('[id="lienzo-palette-item-help.lenses.lens"]');await wait(`!!document.querySelector('[id="lienzo-help-page-lenses.lens"]')`);await key('Escape','Escape');
 // 7. Discover: the catalog index, installed through the review, then the extension's own Help page.
 await menu('Extensions');await wait('!!document.querySelector("#lienzo-extensions")');
 await click('#lienzo-extension-tabs [aria-label="Discover"]');await wait('!!document.querySelector("#lienzo-discover-card-title-case")','the catalog entry');
 assert.ok(served.some(u=>u.endsWith('/Gabsplat/lienzo-extensions/main/index.json')),'read the published index');await shot('discover');
 await click('#lienzo-discover-card-title-case [aria-label="Install…"]');await wait('!!document.querySelector("#lienzo-extension-review")','the review');await shot('discover-review');
 await click('#lienzo-extension-review [aria-label="Install"]');await wait('!document.querySelector("#lienzo-extension-review")');
 await wait('document.querySelector("#lienzo-discover-card-title-case")?.innerText.includes("Installed")','installed');
 assert.ok(await ev('__panelQA.catalog.extensions.some(e=>e.id==="title-case.title-case"&&e.granted===false)'),'installed without permissions');
 await click('#lienzo-extension-tabs [aria-label="Installed"]');await click('[id="lienzo-extension-card-title-case.title-case"] [aria-label="Help"]');
 await wait(`!!document.querySelector('[id="lienzo-help-page-ext:title-case.title-case"]')`,'its own Help page');assert.match(await text('[id="lienzo-help-page-ext:title-case.title-case"]'),/Title Case the titles/);await shot('extension-page');
 await key('Escape','Escape');
 // 8. Offline: the kept list, said plainly.
 network='offline';await menu('Extensions');await click('#lienzo-extension-tabs [aria-label="Discover"]');await wait('!!document.querySelector("#lienzo-discover-stale")','offline strip');
 assert.match(await text('#lienzo-discover-stale'),/Offline/);await shot('discover-offline');
 await ev('localStorage.clear()');await key('Escape','Escape');await menu('Extensions');await click('#lienzo-extension-tabs [aria-label="Discover"]');await wait('!!document.querySelector("#lienzo-discover-offline")','nothing kept');await shot('discover-unreachable');network='online';
 // 9. Publish… on an extension made here.
 await click('#lienzo-extension-tabs [aria-label="Installed"]');await click('[id="lienzo-extension-card-find-replace"] [aria-label="Publish…"]');
 await wait('!!document.querySelector("#lienzo-extension-publish")','the publish card');assert.match(await text('#lienzo-extension-publish'),/extensions\/find-and-replace\/extension\.json|Propose it on GitHub/);await shot('publish');
 assert.deepEqual(uncaught.map(u=>u.exception?.description||u.text),[],'something threw');assert.equal(await ev('__panelQA.actions.length'),0,'nothing sent to an agent');
 console.log(JSON.stringify({ok:true,theme,compact,shots},null,1));
 }finally{await call('Fetch.disable').catch(()=>{});await call('Emulation.clearDeviceMetricsOverride').catch(()=>{});ws.close();}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
