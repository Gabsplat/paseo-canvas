// Settings is a fixed frame, like a preferences window: every section, light and dark, at 1280×800 and 900×640, and
// the sheet's outer frame never moves or changes size. Example data only. Ports: CDP=9222, HTTP=8765, OUT=/tmp.
const assert=require('node:assert/strict');const fs=require('node:fs');
const CDP=process.env.CDP||9222,HTTP=process.env.HTTP||8765,OUT=process.env.OUT||'/tmp';
(async()=>{
 const pages=await(await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
 const page=pages.find(p=>p.type==='page'&&p.url.startsWith(`http://127.0.0.1:${HTTP}/`));if(!page)throw Error('QA page missing');
 const ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((ok,no)=>{ws.addEventListener('open',ok,{once:true});ws.addEventListener('error',no,{once:true});});
 let seq=0;const pending=new Map(),uncaught=[];
 ws.addEventListener('message',e=>{const r=JSON.parse(e.data);if(r.method==='Runtime.exceptionThrown')uncaught.push(r.params.exceptionDetails);if(r.id){const p=pending.get(r.id);if(!p)return;pending.delete(r.id);r.error?p.no(Error(JSON.stringify(r.error))):p.ok(r.result);}});
 const call=(method,params={})=>new Promise((ok,no)=>{const id=++seq;pending.set(id,{ok,no});ws.send(JSON.stringify({id,method,params}));});
 const ev=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails).slice(0,400));return r.result?.value;};
 const wait=async e=>{for(let n=0;n<160;n++){if(await ev(e))return;await new Promise(r=>setTimeout(r,50));}throw Error('Timed out: '+e);};
 const pause=ms=>new Promise(r=>setTimeout(r,ms));
 const clickAt=async(x,y)=>{await call('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',buttons:1,clickCount:1});await call('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',buttons:0,clickCount:1});await pause(250);};
 const click=async sel=>{const b=await ev(`(()=>{const r=document.querySelector(${JSON.stringify(sel)}).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);await clickAt(b.x,b.y);};
 const frame=()=>ev(`(()=>{const r=document.querySelector('#lienzo-screen-settings').getBoundingClientRect();return [r.x,r.y,r.width,r.height].map(v=>Math.round(v*100)/100).join(',')})()`);
 const sections=['appearance','shortcuts','toolbar','copilot','extensions','about'],results=[];
 try{
  await call('Runtime.enable');await call('Page.enable');
  for(const [w,h] of [[1280,800],[900,640]])for(const theme of ['papel','oscuro']){
   await call('Emulation.setDeviceMetricsOverride',{width:w,height:h,deviceScaleFactor:1,mobile:false});
   await call('Page.navigate',{url:`http://127.0.0.1:${HTTP}/?theme=${theme}`});await wait('!!window.__panelQA&&__panelQA.doc().blocks.length>0');await pause(600);
   await click('[aria-label="Menu"]');await pause(300);
   const b=await ev(`(()=>{const e=[...document.querySelectorAll('*')].find(e=>e.children.length===0&&e.textContent.trim()==='Settings');const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);await clickAt(b.x,b.y);
   await wait('!!document.querySelector("#lienzo-screen-settings")');await pause(500);
   const frames=[];
   for(const id of sections){await click('#lienzo-rail-'+id);await pause(450);frames.push(await frame());
    const r=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(`${OUT}/settings-${w}x${h}-${theme}-${id}.png`,Buffer.from(r.data,'base64'));}
   console.log(`${w}x${h} ${theme}: ${[...new Set(frames)].join(' | ')}`);
   results.push({size:`${w}x${h}`,theme,frames});
   assert.equal(new Set(frames).size,1,`frame moved at ${w}x${h} ${theme}: ${frames.join(' / ')}`);
  }
  fs.writeFileSync(`${OUT}/settings-window.json`,JSON.stringify({results,uncaught:uncaught.length},null,2));console.log('PASS same frame for every section; uncaught '+uncaught.length);
 }finally{ws.close();}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
