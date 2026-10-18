// App updates in the desktop preview (`pnpm --dir apps/desktop preview`): the "Update ready · Restart" pill and
// Settings → About in every state, set by hand through the preview-only desktop.updates.fake RPC (the preview never
// updates). Usage: node desktop-updates.cjs [http://127.0.0.1:7422/] [light|dark] [compact]. CDP on $CDP or :9222.
const assert=require('node:assert/strict');const fs=require('node:fs');
(async()=>{
 const url=process.argv[2]||'http://127.0.0.1:7422/',scheme=process.argv[3]||'dark',compact=process.argv[4]==='compact',cdp=process.env.CDP||'http://127.0.0.1:9222',out=(process.env.LIENZO_SHOTS||'/tmp')+'/lienzo-updates-'+scheme+(compact?'-compact':'')+'-';
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
 const shot=async name=>{await pause(400);const r=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(out+name+'.png',Buffer.from(r.data,'base64'));};
 const fake=state=>ev(`fetch('/rpc',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'desktop.updates.fake',input:{state:${JSON.stringify(state)}}})}).then(r=>r.json()).then(r=>r.ok)`);
 try{
  await call('Runtime.enable');await call('Page.enable');
  await call('Emulation.setDeviceMetricsOverride',compact?{width:420,height:820,deviceScaleFactor:1,mobile:false}:{width:1280,height:800,deviceScaleFactor:1,mobile:false});
  await call('Emulation.setEmulatedMedia',{features:[{name:'prefers-color-scheme',value:scheme}]});
  assert.ok(await (async()=>{await call('Page.navigate',{url});await wait('document.readyState==="complete"');const ok=await fake({kind:'off',reason:'Updates are off in the preview.'});await ev('location.reload()');await pause(300);await wait('document.readyState==="complete"');return ok;})());
  await wait('!!document.querySelector("#lienzo-toolbar")||!!document.querySelector("#lienzo-guide")||!!document.querySelector('+q(L('New Lienzo'))+')','the app',15000);
  if(await ev('!!document.querySelector("#lienzo-guide")')){await click('#lienzo-guide '+L('Skip'));await wait('!document.querySelector("#lienzo-guide")');}
  if(await ev('!document.querySelector("#lienzo-toolbar")')){await click(L('New Lienzo'));await wait('!!document.querySelector("#lienzo-toolbar")');}
  // The pill: only when an update is ready.
  assert.ok(!(await ev('!!document.querySelector("#lienzo-update-pill")')),'no pill while updates are off');
  await fake({kind:'ready',version:'0.3.0'});await ev('location.reload()');await wait('!!document.querySelector("#lienzo-update-pill")','the pill',15000);
  assert.match(await text('#lienzo-update-pill'),/Update ready\s*·\s*Restart/);await shot('pill');
  await click('#lienzo-update-pill '+L('Later'));await wait('!document.querySelector("#lienzo-update-pill")','Later hides it');
  if(compact){assert.deepEqual(uncaught.map(u=>u.exception?.description||u.text),[],'something threw');console.log('PASS desktop updates (compact): the pill and Later');return;}
  // Settings → About in each state.
  const about=async()=>{await click('#lienzo-document-island '+L('Menu'));await click('#lienzo-interactive-menu '+L('Settings'));await click('#lienzo-rail-about');await wait('!!document.querySelector("#lienzo-settings-updates")','the updates card');};
  const states=[
   ['ready',{kind:'ready',version:'0.3.0'},/Ready to restart[\s\S]*Version 0\.3\.0 is downloaded[\s\S]*Restart/],
   ['downloading',{kind:'downloading',version:'0.3.0',percent:42.4},/Downloading 42 %[\s\S]*Version 0\.3\.0, in the background[\s\S]*Check for updates/],
   ['checking',{kind:'checking'},/Checking…/],
   ['up-to-date',{kind:'idle',checkedAt:new Date(Date.now()-5*60000).toISOString()},/Up to date[\s\S]*Checked 5 min ago/],
   ['error',{kind:'error',message:'Could not reach the update server. Check the connection and try again.',checkedAt:null},/Update failed[\s\S]*Could not reach the update server/],
   ['blocked',{kind:'blocked',reason:'Move Lienzo to Applications to get updates.'},/Cannot update here[\s\S]*Move Lienzo to Applications to get updates\./],
   ['off',{kind:'off',reason:'Updates are off in the preview.'},/Off[\s\S]*Updates are off in the preview\./],
  ];
  for(const [name,state,expected] of states){
   await fake(state);await ev('location.reload()');await wait('!!document.querySelector("#lienzo-toolbar")','the app',15000);
   await about();
   await wait(`${expected}.test(document.querySelector("#lienzo-settings-updates")?.innerText??"")`,name+' words');
   await shot('about-'+name);
  }
  // The switch saves to the host settings.
  await fake({kind:'idle',checkedAt:null});await ev('location.reload()');await wait('!!document.querySelector("#lienzo-toolbar")','the app',15000);await about();
  const checked=()=>ev('document.querySelector("#lienzo-updates-auto")?.getAttribute("aria-checked")');
  await wait('document.querySelector("#lienzo-updates-auto")?.getAttribute("aria-disabled")!=="true"','the switch ready');
  const before=await checked();await click('#lienzo-updates-auto');await wait(`document.querySelector("#lienzo-updates-auto")?.getAttribute("aria-checked")!==${q(before)}`,'the switch flips');
  const saved=await ev(`fetch('/rpc',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({name:'settings.desktop-updates.read',input:{}})}).then(r=>r.json()).then(r=>r.value.values.autoCheck)`);
  assert.equal(String(saved),await checked(),'saved in settings.json');
  await click('#lienzo-updates-auto');await wait(`document.querySelector("#lienzo-updates-auto")?.getAttribute("aria-checked")===${q(before)}`,'the switch flips back');
  assert.deepEqual(uncaught.map(u=>u.exception?.description||u.text),[],'something threw');
  console.log('PASS desktop updates ('+scheme+(compact?', compact':'')+'): pill, Later, About in 7 states, the switch saves');
 }finally{ws.close();await fetch(cdp+'/json/close/'+target.id).catch(()=>{});}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
