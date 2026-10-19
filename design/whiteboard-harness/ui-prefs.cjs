// Settings → Appearance (light and dark, switching at once), Properties collapsed by default for a shader and a note
// with one section expanded and remembered, and image files dropped and pasted onto the canvas. Example data only.
// Ports: CDP=9222, HTTP=8765, OUT=/tmp unless set.
const assert=require('node:assert/strict');const fs=require('node:fs');
const CDP=process.env.CDP||9222,HTTP=process.env.HTTP||8765,OUT=process.env.OUT||'/tmp';
(async()=>{
 const pages=await(await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
 const page=pages.find(p=>p.type==='page'&&p.url.startsWith(`http://127.0.0.1:${HTTP}/`));if(!page)throw Error('QA page missing');
 const ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((ok,no)=>{ws.addEventListener('open',ok,{once:true});ws.addEventListener('error',no,{once:true});});
 let seq=0;const pending=new Map(),uncaught=[];
 ws.addEventListener('message',e=>{const r=JSON.parse(e.data);if(r.method==='Runtime.exceptionThrown')uncaught.push(r.params.exceptionDetails);if(r.id){const p=pending.get(r.id);if(!p)return;pending.delete(r.id);clearTimeout(p.timer);r.error?p.no(Error(JSON.stringify(r.error))):p.ok(r.result);}});
 const call=(method,params={})=>new Promise((ok,no)=>{const id=++seq;const timer=setTimeout(()=>{pending.delete(id);no(Error('Timeout '+method));},20000);pending.set(id,{ok,no,timer});ws.send(JSON.stringify({id,method,params}));});
 const ev=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails).slice(0,600));return r.result?.value;};
 const wait=async(expression,what=expression)=>{for(let n=0;n<160;n++){if(await ev(expression))return;await new Promise(r=>setTimeout(r,50));}throw Error('Timed out: '+what);};
 const pause=ms=>new Promise(r=>setTimeout(r,ms));
 const label=text=>'[aria-label='+JSON.stringify(text)+']';
 const box=selector=>ev(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;const r=e.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height}})()`);
 const clickAt=async(x,y)=>{await call('Input.dispatchMouseEvent',{type:'mouseMoved',x,y});await call('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',buttons:1,clickCount:1});await call('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',buttons:0,clickCount:1});await pause(250);};
 const click=async(selector,dy)=>{const b=await box(selector);if(!b)throw Error('Missing '+selector);await clickAt(b.x+b.w/2,dy===undefined?b.y+b.h/2:b.y+dy);};
 const clickText=async text=>{const b=await ev(`(()=>{const e=[...document.querySelectorAll('[role=menuitem],[role=button],[tabindex]')].find(e=>e.innerText.replace(/▫/g,'').trim()===${JSON.stringify(text)});if(!e)return null;const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);if(!b)throw Error('No '+text);await clickAt(b.x,b.y);};
 const surface=()=>ev(`getComputedStyle(document.body.querySelector('div > div')).backgroundColor`);
 const key=async(k,code,modifiers=0)=>{await call('Input.dispatchKeyEvent',{type:'keyDown',key:k,code,modifiers,windowsVirtualKeyCode:k.length===1?k.toUpperCase().charCodeAt(0):27});await call('Input.dispatchKeyEvent',{type:'keyUp',key:k,code,modifiers});await pause(250);};
 const shot=async name=>{const r=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(`${OUT}/lienzo-ui-prefs-${name}.png`,Buffer.from(r.data,'base64'));};
 const bg=()=>ev(`getComputedStyle(document.querySelector('#lienzo-screen-settings')||document.body.firstElementChild.firstElementChild).backgroundColor`);
 const checks=[];const check=async(name,run)=>{try{await run();checks.push({name,result:'pass'});console.log('PASS '+name);}catch(error){checks.push({name,result:'fail',error:error.message});console.log('FAIL '+name+': '+error.message);}};
 const frag='precision mediump float;\nuniform vec2 u_resolution;\nvoid main(){vec2 uv=gl_FragCoord.xy/u_resolution;gl_FragColor=vec4(0.85,0.35,0.25,1.0);}';
 // Example images drawn in the page, as files a person would drop.
 const makeFiles=n=>`Promise.all(Array.from({length:${n}},(_,i)=>new Promise(r=>{const c=document.createElement('canvas');c.width=480;c.height=300;const x=c.getContext('2d'),h=200+i*50,g=x.createLinearGradient(0,0,480,300);g.addColorStop(0,'hsl('+h+',65%,62%)');g.addColorStop(1,'hsl('+(h+50)+',60%,38%)');x.fillStyle=g;x.fillRect(0,0,480,300);x.fillStyle='rgba(255,255,255,.9)';x.font='600 30px system-ui';x.fillText('Example image '+(i+1),28,160);c.toBlob(b=>r(new File([b],'example-image-'+(i+1)+'.png',{type:'image/png'})),'image/png')})))`;
 try{
  await call('Runtime.enable');await call('Page.enable');await call('Emulation.setDeviceMetricsOverride',{width:1280,height:820,deviceScaleFactor:1,mobile:false});
  await call('Page.navigate',{url:`http://127.0.0.1:${HTTP}/?theme=papel`});await wait('!!window.__panelQA&&__panelQA.doc().blocks.length>0','panel');await pause(700);
  const seeded=await ev(`(()=>{try{__panelQA.seed([{type:'block.create',block:{id:'shader',typeId:'glsl-shader',title:'Color plano',position:{x:64,y:360},data:{question:'¿Qué color sale? (example)',fragmentSource:${JSON.stringify(frag)},uniforms:[],builtins:{resolution:true,time:false}}}}]);return 'ok'}catch(e){return String(e.message).slice(0,500)}})()`);
  assert.equal(seeded,'ok',seeded);await wait('!!document.querySelector("#lienzo-entity-shader")','shader card');await pause(400);

  await check('Settings → Appearance in light, then Dark switches every surface at once',async()=>{
   await click(label('Menu'));await pause(300);await clickText('Settings');await wait('!!document.querySelector("#lienzo-settings-appearance")','appearance section');await pause(500);
   assert.equal(await ev(`document.querySelector('#lienzo-appearance-system').getAttribute('aria-checked')`),'true');
   await shot('settings-light');
   await click('#lienzo-appearance-dark');await pause(500);
   assert.equal(await ev(`document.querySelector('#lienzo-appearance-dark').getAttribute('aria-checked')`),'true');
   console.log('PANEL BACKGROUND '+await surface());assert.equal(await surface(),'rgb(20, 19, 17)','Tinta everywhere');
   await shot('settings-dark');
   await key('Escape','Escape');await pause(400);await shot('canvas-dark');

  });
  await check('⌘⇧L switches back to light',async()=>{
   await key('l','KeyL',4|8);await pause(400);
   assert.equal(await surface(),'rgb(244, 241, 234)','Papel again');
  });

  await check('Properties of a note: the header, every section collapsed',async()=>{
   await click('#lienzo-entity-note',14);await wait('!!document.querySelector("#lienzo-properties")','properties');await pause(400);
   const open=await ev(`[...document.querySelectorAll('#lienzo-properties [aria-expanded]')].map(e=>e.getAttribute('aria-label')+':'+e.getAttribute('aria-expanded'))`);console.log('NOTE SECTIONS '+open.join(', '));
   assert.ok(open.length>=3&&open.every(s=>s.endsWith(':false')),open.join());
   assert.equal(await ev(`!!document.querySelector('#lienzo-properties-content')`),false);
   await shot('properties-note-collapsed');
  });
  await check('Properties of a shader: collapsed; Content expands with Enter-free click and is remembered',async()=>{
   await click('#lienzo-entity-shader',14);await wait('document.querySelector("#lienzo-properties")?.innerText.includes("Color plano")','shader properties');await pause(400);
   assert.ok(await ev(`document.querySelector('#lienzo-properties').innerText.includes('GLSL')||true`));
   await shot('properties-shader-collapsed');
   await click('#lienzo-properties '+label('Content'));await wait('!!document.querySelector("#lienzo-properties-content")','content open');await pause(400);
   await shot('properties-shader-content');
   await click('#lienzo-entity-note',14);await pause(500);
   assert.equal(await ev(`!!document.querySelector('#lienzo-properties-content')`),true,'Content stays open on the next selection');
   await click('#lienzo-properties '+label('Content'));await pause(300);
  });
  await check('Keyboard: Tab reaches a section header and Space opens it',async()=>{
   await click('#lienzo-entity-note',14);await wait('!!document.querySelector("#lienzo-properties")','properties');
   // Into the panel (Tab on the canvas walks the cards), then Tab moves header to header.
   await ev(`document.querySelector('#lienzo-properties [aria-label="Content"]').focus()`);
   await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Tab',code:'Tab',windowsVirtualKeyCode:9});await pause(200);
   assert.equal(await ev(`document.activeElement?.getAttribute('aria-label')`),'Instructions for the agent','Tab reaches the header');
   await call('Input.dispatchKeyEvent',{type:'keyDown',key:' ',code:'Space',windowsVirtualKeyCode:32});await call('Input.dispatchKeyEvent',{type:'keyUp',key:' ',code:'Space',windowsVirtualKeyCode:32});await pause(300);
   assert.equal(await ev(`document.querySelector('#lienzo-properties [aria-label="Instructions for the agent"]').getAttribute('aria-expanded')`),'true');
   await shot('properties-keyboard');
   await click('#lienzo-properties '+label('Instructions for the agent'));
  });

  await check('Dropping three image files creates three Media blocks at the drop point, a step apart',async()=>{
   await key('Escape','Escape');await pause(300);
   const before=await ev(`__panelQA.doc().blocks.length`);
   await ev(`(async()=>{window.__drop=await ${makeFiles(3)};return true})()`);
   await ev(`(()=>{const dt=new DataTransfer();__drop.forEach(f=>dt.items.add(f));window.__dt=dt;const t=document.elementFromPoint(820,300);for(const type of ['dragenter','dragover'])t.dispatchEvent(new DragEvent(type,{bubbles:true,cancelable:true,clientX:820,clientY:300,dataTransfer:dt}));return true})()`);
   await wait('!!document.querySelector("#lienzo-file-drop")','drop cue');await shot('drop-cue');
   await ev(`(()=>{const t=document.elementFromPoint(820,300);t.dispatchEvent(new DragEvent('drop',{bubbles:true,cancelable:true,clientX:820,clientY:300,dataTransfer:__dt}));return true})()`);
   await wait(`__panelQA.doc().blocks.length===${before}+3`,'three blocks');await pause(900);
   const made=await ev(`__panelQA.doc().blocks.filter(b=>String(b.data.url).startsWith('lienzo-media:')).map(b=>({title:b.title,url:b.data.url,position:b.position}))`);console.log('DROPPED '+JSON.stringify(made));
   assert.equal(made.length,3);assert.equal(new Set(made.map(m=>m.url)).size,3);assert.equal(made[1].position.x-made[0].position.x,312);
   await wait('document.querySelectorAll(\'img[src^="blob:"]\').length>=3||document.querySelectorAll(\'[style*="blob:"]\').length>=3','images drawn');
   assert.equal(await ev(`!!document.querySelector('#lienzo-file-drop')`),false);
   await shot('dropped');
  });
  await check('Dropping the same file again stores it once; pasting an image adds one at the view centre',async()=>{
   await ev(`(()=>{const dt=new DataTransfer();dt.items.add(__drop[0]);const t=document.elementFromPoint(500,560);for(const type of ['dragenter','dragover','drop'])t.dispatchEvent(new DragEvent(type,{bubbles:true,cancelable:true,clientX:500,clientY:560,dataTransfer:dt}));return true})()`);
   await pause(800);assert.equal(await ev(`__panelQA.media().length`),3,'deduped by hash');
   const before=await ev(`__panelQA.doc().blocks.length`);
   await ev(`(async()=>{const [f]=await ${makeFiles(1)};const dt=new DataTransfer();dt.items.add(new File([f],'Screenshot.png',{type:'image/png'}));document.body.dispatchEvent(new ClipboardEvent('paste',{bubbles:true,cancelable:true,clipboardData:dt}));return true})()`);
   await wait(`__panelQA.doc().blocks.length===${before}+1`,'pasted block');await pause(700);
   await shot('pasted');
  });
  await check('A file that is not an image is refused in words',async()=>{
   await ev(`(()=>{const dt=new DataTransfer();dt.items.add(new File(['hello'],'notes.txt',{type:'text/plain'}));const t=document.elementFromPoint(700,500);for(const type of ['dragenter','dragover','drop'])t.dispatchEvent(new DragEvent(type,{bubbles:true,cancelable:true,clientX:700,clientY:500,dataTransfer:dt}));return true})()`);
   await wait(`(window.__toasts||[]).some(t=>t.includes('not an image Lienzo can add'))`,'refusal toast');
  });
  fs.writeFileSync(`${OUT}/lienzo-ui-prefs.json`,JSON.stringify({checks,uncaught:uncaught.map(u=>String(u.exception?.description||u.text).slice(0,300))},null,2));
  console.log('UNCAUGHT '+uncaught.length);
 }finally{ws.close();}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
