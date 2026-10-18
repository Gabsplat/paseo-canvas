// The screens in the desktop app's preview (`pnpm --dir apps/desktop preview`, real core and store, a scratch data
// folder): the guide on first run, Lienzos, Settings → Agents (the MCP address, commands and agents seen) and About.
// Usage: node desktop-screens.cjs [http://127.0.0.1:7422/] [light|dark]. Opens its own tab and closes it at the end.
const assert=require('node:assert/strict');const fs=require('node:fs');
(async()=>{
 const url=process.argv[2]||'http://127.0.0.1:7422/',scheme=process.argv[3]||'dark',out=(process.env.LIENZO_SHOTS||'/tmp')+'/lienzo-desktop-'+scheme+'-';
 const target=await(await fetch('http://127.0.0.1:9222/json/new?about:blank',{method:'PUT'})).json();
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
 const shot=async name=>{await pause(400);const r=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(out+name+'.png',Buffer.from(r.data,'base64'));};
 try{
  await call('Runtime.enable');await call('Page.enable');
  await call('Emulation.setDeviceMetricsOverride',{width:1280,height:800,deviceScaleFactor:1,mobile:false});
  await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:scheme}]});
  await call('Page.navigate',{url});await wait('!!document.querySelector("#lienzo-toolbar")||!!document.querySelector("#lienzo-guide")','the app',15000);
  // First run: the guide opens once by itself.
  if(await ev('!!document.querySelector("#lienzo-guide")')){await pause(3000);await shot('guide');assert.match(await text('#lienzo-guide'),/1 of 4/i);await click('#lienzo-guide '+L('Skip'));await wait('!document.querySelector("#lienzo-guide")');}
  // A Lienzo to look at, through the empty state's button when there is none.
  if(await ev('!document.querySelector("#lienzo-toolbar")')){await click(L('New Lienzo'));await wait('!!document.querySelector("#lienzo-toolbar")');}
  const menu=async item=>{await click('#lienzo-document-island '+L('Menu'));await click('#lienzo-interactive-menu '+L(item));};
  await menu('Lienzos');await wait('!!document.querySelector("#lienzo-lienzos")');await pause(600);await shot('lienzos');await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape'});await wait('!document.querySelector("#lienzo-lienzos")');
  await menu('Settings');await wait('!!document.querySelector("#lienzo-settings-shortcuts")');
  const rail=await ev(`[...document.querySelectorAll('[id^=lienzo-rail-]')].map(e=>e.id.slice(12))`);assert.deepEqual(rail,['shortcuts','toolbar','agents','extensions','about'],'the desktop shows Agents, not Copilot');
  await click('#lienzo-rail-agents');await wait('document.querySelector("#lienzo-settings-agents-screen")?.innerText.includes("/mcp")','the MCP address');assert.match(await text("#lienzo-settings-agents-screen"),/Run this once in a terminal[\s\S]*Agents seen/);assert.match(await ev(`[...document.querySelectorAll("#lienzo-settings-agents-screen input, #lienzo-settings-agents-screen textarea")].map(e=>e.value).join("|")`),/claude mcp add lienzo --transport http/);await shot('settings-agents');
  await click('#lienzo-rail-about');await wait('/state\\.json/.test(document.querySelector("#lienzo-settings-about")?.innerText??"")','the data file');assert.match(await text('#lienzo-settings-about'),/Version\s+preview[\s\S]*The desktop app/);await shot('settings-about');
  assert.deepEqual(uncaught.map(u=>u.exception?.description||u.text),[],'something threw');
  console.log('PASS desktop screens ('+scheme+'): guide on first run, Lienzos, Settings with Agents and About');
 }finally{ws.close();await fetch('http://127.0.0.1:9222/json/close/'+target.id).catch(()=>{});}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
