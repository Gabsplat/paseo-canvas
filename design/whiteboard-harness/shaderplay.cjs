// Play, Pause and autoplay of time-based shaders with controls below, pressed with real CDP mouse events (example data).
// A press with a small slip still reaches the button; leaving the view pauses and coming back resumes what was playing;
// rendering alone writes nothing to the Lienzo. Needs WebGL: Chromium --use-angle=swiftshader --enable-unsafe-swiftshader.
// Ports: CDP=9222, HTTP=8765, OUT=/tmp unless set.
const assert=require('node:assert/strict');const fs=require('node:fs');
const CDP=process.env.CDP||9222,HTTP=process.env.HTTP||8765,OUT=process.env.OUT||'/tmp',theme=process.argv[2]||'oscuro';
(async()=>{
 const pages=await(await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
 const page=pages.find(p=>p.type==='page'&&p.url.startsWith(`http://127.0.0.1:${HTTP}/`));if(!page)throw Error('QA page missing');
 const ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((ok,no)=>{ws.addEventListener('open',ok,{once:true});ws.addEventListener('error',no,{once:true});});
 let seq=0;const pending=new Map(),uncaught=[];
 ws.addEventListener('message',e=>{const r=JSON.parse(e.data);if(r.method==='Runtime.exceptionThrown')uncaught.push(r.params.exceptionDetails);if(r.id){const p=pending.get(r.id);if(!p)return;pending.delete(r.id);clearTimeout(p.timer);r.error?p.no(Error(JSON.stringify(r.error))):p.ok(r.result);}});
 const call=(method,params={})=>new Promise((ok,no)=>{const id=++seq;const timer=setTimeout(()=>{pending.delete(id);no(Error('Timeout '+method));},20000);pending.set(id,{ok,no,timer});ws.send(JSON.stringify({id,method,params}));});
 const ev=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result?.value;};
 const wait=async(expression,what=expression)=>{for(let n=0;n<200;n++){if(await ev(expression))return;await new Promise(r=>setTimeout(r,50));}throw Error('Timed out: '+what);};
 const pause=ms=>new Promise(r=>setTimeout(r,ms));
 const label=text=>'[aria-label='+JSON.stringify(text)+']';
 const mouse=(type,x,y,buttons=0,extra={})=>call('Input.dispatchMouseEvent',{type,x,y,button:'left',buttons,clickCount:1,...extra});
 const at=selector=>ev(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
 // A real press: move there, press, slip by `slip` px over a few events, release where the pointer ended.
 const press=async(selector,slip=0)=>{const b=await at(selector);assert.ok(b,'missing '+selector);await mouse('mouseMoved',b.x,b.y);await mouse('mousePressed',b.x,b.y,1);
  for(let i=1;i<=3&&slip;i++)await mouse('mouseMoved',b.x+slip*i/3,b.y+slip*i/6,1);await pause(30);await mouse('mouseReleased',b.x+slip,b.y+slip/2);await pause(250);};
 const shot=async name=>{const r=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(`${OUT}/lienzo-shaderplay-${name}.png`,Buffer.from(r.data,'base64'));};
 const button=(id,text)=>`#lienzo-interactive-shader-${id}-transport [aria-label="${text}"]`;
 const state=id=>ev(`(()=>{const t=document.querySelector('#lienzo-interactive-shader-${id}-transport');return t?[...t.querySelectorAll('[role=button],button')].map(e=>e.innerText.trim()).filter(Boolean)[0]:null})()`);
 // Two samples of the picture: a shader whose colours run on u_time changes between them only while time runs.
 const pixel=id=>ev(`(()=>{const c=document.querySelector('#lienzo-surface-glsl-${id} canvas');if(!c||!c.width)return null;return Array.from(c.getContext('2d').getImageData(c.width>>1,c.height>>1,1,1).data).join(',')})()`);
 const moving=async id=>{const a=await pixel(id);await pause(600);const b=await pixel(id);return a!==null&&a!==b;};
 const lastPause=id=>ev(`(()=>{const s=__panelQA.runtime().blocks[${JSON.stringify(id)}];return s?.lastInteraction?{kind:s.lastInteraction.kind,reason:s.lastInteraction.payload?.reason??null,time:s.time??null}:null})()`);
 const writes=()=>ev(`__panelQA.log.filter(e=>e.name==='canvas.mutate').map(e=>e.operations.map(o=>o.type+':'+(o.id??'')+':'+Object.keys(o.patch??{}).join('+')).join(','))`);
 const checks=[];const check=async(name,run)=>{if(process.env.SKIP&&name.includes(process.env.SKIP)){console.log('SKIP '+name);return;}try{await run();checks.push({name,result:'pass'});console.log('PASS '+name);}catch(error){checks.push({name,result:'fail',error:error.message});console.log('FAIL '+name+': '+error.message);await shot('fail').catch(()=>{});if(!process.env.KEEP_GOING)throw error;}};
 const frag=i=>`precision mediump float;\nuniform vec2 u_resolution;\nuniform float u_time;\nuniform float speed;\nvoid main(){vec2 uv=gl_FragCoord.xy/u_resolution;vec3 c=0.5+0.5*cos(u_time*speed*3.0+uv.xyx*${(2+i).toFixed(1)}+vec3(0,2,4));gl_FragColor=vec4(c,1.0);}`;
 try{
  await call('Runtime.enable');await call('Page.enable');await call('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await call('Page.navigate',{url:`http://127.0.0.1:${HTTP}/?theme=${theme}`});await wait('!!window.__panelQA&&__panelQA.doc().blocks.length>0','panel');await pause(600);
  await ev(`(()=>{const d=__panelQA.doc();__panelQA.seed([...d.groups.filter(g=>!g.parentGroupId).map(g=>({type:'group.delete',id:g.id})),...d.blocks.filter(b=>!b.parentGroupId).map(b=>({type:'block.delete',id:b.id}))]);})()`);
  const ids=['s0','s1','s2','s3'];
  const ops=ids.map((id,i)=>({type:'block.create',block:{id,typeId:'glsl-shader',title:'Shader '+(i+1)+' (example)',position:{x:(i%2)*520,y:Math.floor(i/2)*460},size:{width:480,height:400},
   data:{fragmentSource:frag(i),uniforms:[{name:'speed',label:'Speed',min:0,max:3,value:1,step:0.1}],builtins:{time:true,resolution:true},autoplay:i!==3,controls:'below',reset:true}}}));
  const seeded=await ev(`(()=>{try{__panelQA.seed(${JSON.stringify(ops)});return 'ok'}catch(e){return String(e.message).slice(0,600)}})()`);assert.equal(seeded,'ok',seeded);
  const revision=await ev('__panelQA.doc().revision');
  await wait(`document.querySelectorAll('[id^="lienzo-surface-glsl-"] canvas').length===4`,'4 surfaces');await press(label('Fit all'));await pause(1500);
  await check('rendering writes nothing: no data, size or summary saved by the client',async()=>{
   await pause(800);assert.deepEqual(await writes(),[]);assert.equal(await ev('__panelQA.doc().revision'),revision);
   const data=await ev(`__panelQA.doc().blocks.find(b=>b.id==='s0').data`);assert.equal(data.staticSummary,undefined,'no stripes summary on a shader that is not stripes');
  });
  await check('autoplay shaders run once in view; the one without autoplay waits',async()=>{
   for(const id of ['s0','s1','s2'])assert.ok(await moving(id),id+' should be moving');assert.equal(await moving('s3'),false);
   assert.equal(await state('s0'),'Pause');assert.equal(await state('s3'),'Play');await shot('autoplay');
  });
  await check('Pause and Play with a real press',async()=>{
   await press(button('s0','Pause'));assert.equal(await state('s0'),'Play');
   assert.equal(await moving('s0'),false,'paused');assert.equal((await lastPause('s0'))?.reason,'paused by the person');
   await press(button('s0','Play'));assert.equal(await state('s0'),'Pause');assert.ok(await moving('s0'),'playing again');
   await press(button('s3','Play'));assert.equal(await state('s3'),'Pause');assert.ok(await moving('s3'),'s3 started by Play');
  });
  await check('a press that slips a little or a lot still toggles and never drags the card',async()=>{
   const before=await ev(`JSON.stringify(__panelQA.doc().blocks.find(b=>b.id==='s1').position)`);
   await press(button('s1','Pause'),2);assert.equal(await state('s1'),'Play','2 px slip');
   await press(button('s1','Play'),9);assert.equal(await state('s1'),'Pause','9 px slip');
   await pause(300);assert.equal(await ev(`JSON.stringify(__panelQA.doc().blocks.find(b=>b.id==='s1').position)`),before,'the card did not move');
   assert.deepEqual(await writes(),[],'no document write from pressing Play');
  });
  await check('out of view and back: what was playing resumes, what the person paused stays paused, Play still works',async()=>{
   await press(button('s2','Pause'));assert.equal(await state('s2'),'Play');
   // Pan the camera far away with the wheel over the empty canvas, then back.
   const pan=async dy=>{for(let i=0;i<8;i++){await call('Input.dispatchMouseEvent',{type:'mouseWheel',x:1320,y:450,deltaX:0,deltaY:dy});await pause(40);}await pause(700);};
   await pan(400);const shown=await ev(`[...document.querySelectorAll('[id^="lienzo-surface-glsl-"] canvas')].filter(c=>{const r=c.getBoundingClientRect();return r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth}).length`);
   assert.equal(shown,0,'all shaders left the view');await shot('away');
   const away=await lastPause('s0');assert.equal(away?.reason,'out of view');
   await pan(-400);await pause(600);
   for(const id of ['s0','s1','s3'])assert.ok(await moving(id),id+' resumed');assert.equal(await moving('s2'),false,'s2 stays paused by the person');
   assert.equal(await state('s0'),'Pause');assert.equal(await state('s2'),'Play');
   await press(button('s2','Play'));assert.ok(await moving('s2'),'Play after coming back');await shot('back');
  });
  await check('an agent edit while playing does not stop the clock',async()=>{
   const a=await pixel('s0');await ev(`__panelQA.seedAgent([{type:'block.update',id:'s1',patch:{title:'Shader 2 renamed by the example agent'}}])`);await pause(900);
   assert.ok(await moving('s0'),'s0 keeps running');assert.ok(await moving('s1'),'s1 keeps running after its own update');assert.notEqual(a,await pixel('s0'));
  });
  await check('the picture itself still drags the card',async()=>{
   const b=await at('#lienzo-surface-glsl-s3 canvas'),before=await ev(`JSON.stringify(__panelQA.doc().blocks.find(b=>b.id==='s3').position)`);
   await mouse('mouseMoved',b.x,b.y);await mouse('mousePressed',b.x,b.y,1);for(let i=1;i<=6;i++){await mouse('mouseMoved',b.x+i*10,b.y,1);await pause(20);}await mouse('mouseReleased',b.x+60,b.y);
   await wait(`JSON.stringify(__panelQA.doc().blocks.find(b=>b.id==='s3').position)!==${JSON.stringify(before)}`,'s3 moved');assert.ok(await moving('s3'),'still playing after its own move');
  });
  fs.writeFileSync(`${OUT}/lienzo-shaderplay.json`,JSON.stringify({checks,uncaught},null,2));assert.deepEqual(uncaught,[]);
 }finally{ws.close();}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
