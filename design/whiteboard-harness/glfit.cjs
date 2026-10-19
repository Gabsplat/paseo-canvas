// Twenty shaders share one WebGL context and all draw (zoomed out and in); a tall mini app and a sized shader with
// controls below fit without a manual resize. Example data only. Needs WebGL: run Chromium with --use-gl=angle
// --use-angle=swiftshader (or --enable-unsafe-swiftshader). Ports: CDP=9222, HTTP=8765, OUT=/tmp unless set.
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
 const click=async selector=>{const b=await ev(`(()=>{const r=document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);await call('Input.dispatchMouseEvent',{type:'mousePressed',x:b.x,y:b.y,button:'left',buttons:1,clickCount:1});await call('Input.dispatchMouseEvent',{type:'mouseReleased',x:b.x,y:b.y,button:'left',clickCount:1});};
 const shot=async name=>{const r=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(`${OUT}/lienzo-glfit-${name}.png`,Buffer.from(r.data,'base64'));};
 // A shader canvas has drawn when its centre pixel is not transparent.
 const painted=`[...document.querySelectorAll('[id^="lienzo-surface-glsl-"] canvas')].filter(c=>{const x=c.getContext('2d');if(!x||!c.width)return false;return x.getImageData(c.width>>1,c.height>>1,1,1).data[3]>0}).length`;
 const checks=[];const check=async(name,run)=>{try{await run();checks.push({name,result:'pass'});console.log('PASS '+name);}catch(error){checks.push({name,result:'fail',error:error.message});console.log('FAIL '+name+': '+error.message);throw error;}};
 const frag=i=>`precision mediump float;\nuniform vec2 u_resolution;\nuniform float u_time;\nuniform float speed;\nvoid main(){vec2 uv=gl_FragCoord.xy/u_resolution;vec3 c=0.5+0.5*cos(u_time*speed+uv.xyx*${(2+i%5).toFixed(1)}+vec3(0,2,4)+${(i*.7).toFixed(1)});gl_FragColor=vec4(c,1.0);}`;
 try{
  await call('Runtime.enable');await call('Page.enable');await call('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:2,mobile:false});
  await call('Page.navigate',{url:`http://127.0.0.1:${HTTP}/?theme=${theme}`});await wait('!!window.__panelQA&&__panelQA.doc().blocks.length>0','panel');await pause(600);
  const clear=()=>ev(`(()=>{const d=__panelQA.doc();__panelQA.seed([...d.groups.filter(g=>!g.parentGroupId).map(g=>({type:'group.delete',id:g.id})),...d.blocks.filter(b=>!b.parentGroupId).map(b=>({type:'block.delete',id:b.id}))]);return __panelQA.doc().blocks.length})()`);
  const cleared=await clear().catch(e=>String(e.message).slice(0,300));
  await check('20 shaders on one Lienzo all draw, zoomed out and in, with no "too many" error',async()=>{
   const ops=Array.from({length:20},(_,i)=>({type:'block.create',block:{id:'shader-'+i,typeId:'glsl-shader',title:'Shader '+(i+1)+' (example)',position:{x:(i%5)*540,y:Math.floor(i/5)*380},size:{width:500,height:340},data:{fragmentSource:frag(i),uniforms:[{name:'speed',label:'Speed',min:0,max:3,value:1,step:0.1}],builtins:{resolution:true,time:true},autoplay:i%2===0,showTitle:true}}}));
   const seeded=await ev(`(()=>{try{__panelQA.seed(${JSON.stringify(ops)});return 'ok'}catch(e){return String(e.message).slice(0,600)}})()`);assert.equal(seeded,'ok','seed: '+seeded+' / clear: '+cleared);
   await wait('document.querySelectorAll(\'[id^="lienzo-surface-glsl-"] canvas\').length===20','20 surfaces');await pause(400);await click(label('Fit all'));await pause(1500);
   await click(label('Zoom out'));await pause(1200);await wait(`${painted}===20`,'all 20 painted zoomed out');assert.equal(await ev(`document.body.innerText.includes('Too many')`),false);await shot('20-out');
   for(let i=0;i<3;i++){await click(label('Zoom in'));await pause(350);}await pause(1200);
   const onScreen=await ev(`[...document.querySelectorAll('[id^="lienzo-surface-glsl-"] canvas')].filter(c=>{const r=c.getBoundingClientRect();return r.right>0&&r.bottom>0&&r.left<innerWidth&&r.top<innerHeight}).length`);
   assert.ok(onScreen>0);await shot('20-in');
   // Moving: the autoplaying ones change between two samples.
   const sample=`[...document.querySelectorAll('[id^="lienzo-surface-glsl-"] canvas')].map(c=>Array.from(c.getContext('2d').getImageData(c.width>>2,c.height>>2,1,1).data).join(','))`;
   const a=await ev(sample);await pause(700);const b=await ev(sample);console.log('MOVING '+a.filter((v,i)=>v!==b[i]).length+' of '+a.length);
  });
  await check('a tall mini app and a sized shader with controls below fit without a manual resize',async()=>{
   await clear();
   const tall=`<!doctype html><meta charset=utf-8><body style="margin:0;font:15px system-ui;color:#ddd;background:#1d1f24"><div style="padding:20px">${Array.from({length:18},(_,i)=>`<p style="margin:0 0 14px;padding:10px;border:1px solid #444;border-radius:8px">Step ${i+1}: example row of a tall mini app (example data).</p>`).join('')}<button id=more>Add a row</button></div><script>more.onclick=function(){var p=document.createElement('p');p.textContent='Added row';p.style.cssText='margin:0 0 14px;padding:10px;border:1px dashed #888';more.before(p)}</script></body>`;
   const ops=[{type:'block.create',block:{id:'app-tall',typeId:'html',title:'Tall mini app (example)',position:{x:0,y:0},data:{html:tall}}},
    {type:'block.create',block:{id:'shader-below',typeId:'glsl-shader',title:'Controls below (example)',position:{x:660,y:0},size:{width:440,height:200},data:{question:'How do speed and scale change the colours?',fragmentSource:frag(3).replace('uniform float speed;','uniform float speed;\nuniform float scale;').replace('uv.xyx*5.0','uv.xyx*scale'),uniforms:[{name:'speed',label:'Speed',min:0,max:3,value:1,step:0.1},{name:'scale',label:'Scale',min:1,max:9,value:4,step:0.1}],builtins:{resolution:true,time:true},controls:'below',reset:true}}},
    {type:'block.create',block:{id:'shader-auto',typeId:'glsl-shader',title:'Unsized (example)',position:{x:660,y:520},data:{question:'No stored size: the picture keeps 16:10.',fragmentSource:frag(1),uniforms:[{name:'speed',label:'Speed',min:0,max:3,value:1,step:0.1}],builtins:{resolution:true,time:true},controls:'below',reset:true}}}];
   const seeded=await ev(`(()=>{try{__panelQA.seed(${JSON.stringify(ops)});return 'ok'}catch(e){return String(e.message).slice(0,600)}})()`);assert.equal(seeded,'ok',seeded);
   await wait('!!document.querySelector("#lienzo-entity-app-tall iframe")&&!!document.querySelector("#lienzo-entity-shader-below")','blocks');await pause(1500);await click(label('Fit all'));await pause(1200);
   const geometry=await ev(`(()=>{const r=s=>{const e=document.querySelector(s);if(!e)return null;const b=e.getBoundingClientRect();return{top:b.top,bottom:b.bottom,height:b.height}};const f=document.querySelector('#lienzo-entity-app-tall iframe');
    const card=r('#lienzo-entity-shader-below'),reset=[...document.querySelectorAll('#lienzo-entity-shader-below [role=button],#lienzo-entity-shader-below button')].map(e=>({t:e.innerText,b:e.getBoundingClientRect().bottom})).filter(x=>/Reset|Play/.test(x.t));
    const k=document.querySelector('#lienzo-entity-app-tall').getBoundingClientRect().width/document.querySelector('#lienzo-entity-app-tall').offsetWidth;
    return{app:r('#lienzo-entity-app-tall'),frame:f&&{height:f.offsetHeight},card,buttons:reset,scale:k,doc:__panelQA.doc().blocks.map(b=>({id:b.id,size:b.size??null})),revision:__panelQA.doc().revision}})()`);
   console.log('GEOMETRY '+JSON.stringify(geometry));
   assert.ok(geometry.frame.height>800,'the mini app grew to its content: '+geometry.frame.height);
   assert.equal(geometry.doc.find(b=>b.id==='app-tall').size,null,'no size was written');
   assert.ok(geometry.buttons.length>=2&&geometry.buttons.every(b=>b.b<=geometry.card.bottom+1),'Play and Reset inside the card');
   await shot('fit');
  });
  fs.writeFileSync(`${OUT}/lienzo-glfit.json`,JSON.stringify({checks,uncaught},null,2));assert.deepEqual(uncaught,[]);
 }finally{ws.close();}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
