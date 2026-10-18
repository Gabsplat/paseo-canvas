// Help and Discover in the desktop app's preview (`pnpm --dir apps/desktop preview`, real core and store, a scratch
// data folder). The catalog is served from marketplace/ by intercepting raw.githubusercontent.com: no real network.
// Usage: node desktop-wiki.cjs [http://127.0.0.1:7422/] [light|dark]. Debug port: $LIENZO_DEBUG_PORT (9222).
// Opens its own tab and closes it at the end.
const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
(async()=>{
 const url=process.argv[2]||'http://127.0.0.1:7422/',scheme=process.argv[3]||'dark',out=(process.env.LIENZO_SHOTS||'/tmp')+'/lienzo-desktop-wiki-'+scheme+'-',debug=process.env.LIENZO_DEBUG_PORT||9222;
 const root=path.join(__dirname,'..','..'),index=fs.readFileSync(path.join(root,'marketplace/index.json')),file=fs.readFileSync(path.join(root,'marketplace/extensions/title-case/extension.json'));
 const target=await(await fetch('http://127.0.0.1:'+debug+'/json/new?about:blank',{method:'PUT'})).json();
 const ws=new WebSocket(target.webSocketDebuggerUrl);await new Promise((ok,no)=>{ws.addEventListener('open',ok,{once:true});ws.addEventListener('error',no,{once:true});});
 let seq=0;const pending=new Map(),uncaught=[];
 const call=(method,params={})=>new Promise((ok,no)=>{const id=++seq;pending.set(id,{ok,no});ws.send(JSON.stringify({id,method,params}));});
 ws.addEventListener('message',e=>{const r=JSON.parse(e.data);if(r.method==='Runtime.exceptionThrown')uncaught.push(r.params.exceptionDetails);
  if(r.method==='Fetch.requestPaused'){const u=r.params.request.url,body=u.endsWith('/index.json')?index:u.endsWith('/title-case/extension.json')?file:Buffer.from('');void call('Fetch.fulfillRequest',{requestId:r.params.requestId,responseCode:body.length?200:404,responseHeaders:[{name:'access-control-allow-origin',value:'*'}],body:body.toString('base64')});return;}
  if(r.id){const p=pending.get(r.id);if(!p)return;pending.delete(r.id);r.error?p.no(Error(JSON.stringify(r.error))):p.ok(r.result);}});
 const ev=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result?.value;};
 const pause=ms=>new Promise(r=>setTimeout(r,ms));
 const wait=async(expression,what=expression,ms=8000)=>{for(let n=0;n<ms/50;n++){if(await ev(expression))return;await pause(50);}throw Error('Condition timed out: '+what);};
 const q=s=>JSON.stringify(s),L=s=>'[aria-label='+q(s)+']';
 const click=async sel=>{await wait(`!!document.querySelector(${q(sel)})`,sel);const r=await ev(`(()=>{const e=document.querySelector(${q(sel)});e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);for(const type of ['mouseMoved','mousePressed','mouseReleased'])await call('Input.dispatchMouseEvent',{type,x:r.x,y:r.y,button:'left',buttons:type==='mousePressed'?1:0,clickCount:1});await pause(250);};
 const text=sel=>ev(`document.querySelector(${q(sel)})?.innerText??''`);
 const shot=async name=>{await pause(400);const r=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(out+name+'.png',Buffer.from(r.data,'base64'));};
 try{
  await call('Runtime.enable');await call('Page.enable');await call('Fetch.enable',{patterns:[{urlPattern:'https://raw.githubusercontent.com/*'}]});
  await call('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});
  await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:scheme}]});
  await call('Page.navigate',{url});await wait('!!document.querySelector("#lienzo-toolbar")||!!document.querySelector("#lienzo-guide")','the app',15000);
  if(await ev('!!document.querySelector("#lienzo-guide")')){await click('#lienzo-guide '+L('Skip'));await wait('!document.querySelector("#lienzo-guide")');}
  if(await ev('!document.querySelector("#lienzo-toolbar")')){await click(L('New Lienzo'));await wait('!!document.querySelector("#lienzo-toolbar")');}
  const menu=async item=>{await click('#lienzo-document-island '+L('Menu'));await click('#lienzo-interactive-menu '+L(item));};
  await menu('Help');await wait('!!document.querySelector("#lienzo-help")');await pause(500);await shot('help');
  await click('[id="lienzo-help-item-agents.connect"]');await wait(`!!document.querySelector('[id="lienzo-help-page-agents.connect"]')`);assert.match(await text('#lienzo-help'),/Settings → Agents/);await shot('help-agents');
  await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});await wait('!document.querySelector("#lienzo-help")');
  await menu('Extensions');await click('#lienzo-extension-tabs '+L('Discover'));await wait('!!document.querySelector("#lienzo-discover-card-title-case")','the catalog');await shot('discover');
  await click('#lienzo-discover-card-title-case '+L('Install…'));await wait('!!document.querySelector("#lienzo-extension-review")');await click('#lienzo-extension-review '+L('Install'));
  await wait('document.querySelector("#lienzo-discover-card-title-case")?.innerText.includes("Installed")','installed in the real store');await shot('installed');
  // Clean up the scratch store: remove what was installed.
  await click('#lienzo-extension-tabs '+L('Installed'));await click('[id="lienzo-extension-card-title-case.title-case"] '+L('Remove'));await click('[id="lienzo-extension-card-title-case.title-case"] '+L('Remove'));
  assert.deepEqual(uncaught.map(u=>u.exception?.description||u.text),[],'something threw');
  console.log(JSON.stringify({ok:true,scheme}));
 }finally{await call('Fetch.disable').catch(()=>{});ws.close();await fetch('http://127.0.0.1:'+debug+'/json/close/'+target.id).catch(()=>{});}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
