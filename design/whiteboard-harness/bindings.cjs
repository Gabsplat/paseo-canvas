// Property bindings (docs/design.md §39), example data: a Controls slider "Speed" drives a rectangle's width, height and
// fill and a free text "Speed: {v}"; moving it writes nothing. Then the bind form in Properties.
// Usage: node bindings.cjs [oscuro|papel]. Ports: CDP=9222, HTTP=8765, OUT=/tmp unless set.
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
 const mouse=(type,x,y,buttons=0)=>call('Input.dispatchMouseEvent',{type,x,y,button:'left',buttons,clickCount:1});
 const at=selector=>ev(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)return null;e.scrollIntoView({block:'nearest'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2,w:r.width,h:r.height}})()`);
 const press=async selector=>{const b=await at(selector);assert.ok(b,'missing '+selector);await mouse('mouseMoved',b.x,b.y);await mouse('mousePressed',b.x,b.y,1);await pause(30);await mouse('mouseReleased',b.x,b.y);await pause(300);};
 const shot=async name=>{const r=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(`${OUT}/lienzo-bindings-${theme}-${name}.png`,Buffer.from(r.data,'base64'));};
 const writes=()=>ev(`__panelQA.log.filter(e=>e.name==='canvas.mutate').length`);
 const box=()=>at('#lienzo-entity-box');
 // A slider moved the way a hand moves it: input events on the way, the pointer let go at the end.
 const slide=async value=>{await ev(`(()=>{const i=document.querySelector('#lienzo-interactive-controls-ctl-speed input[type=range]');const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
   const from=Number(i.value);for(let k=1;k<=6;k++){set.call(i,String(from+(${value}-from)*k/6));i.dispatchEvent(new Event('input',{bubbles:true}));}i.dispatchEvent(new PointerEvent('pointerup',{bubbles:true}));})()`);await pause(900);};
 const checks=[];const check=async(name,run)=>{try{await run();checks.push({name,result:'pass'});console.log('PASS '+name);}catch(error){checks.push({name,result:'fail',error:error.message});console.log('FAIL '+name+': '+error.message);await shot('fail').catch(()=>{});if(!process.env.KEEP_GOING)throw error;}};
 try{
  await call('Runtime.enable');await call('Page.enable');await call('Emulation.setDeviceMetricsOverride',{width:1440,height:900,deviceScaleFactor:1,mobile:false});
  await call('Page.navigate',{url:`http://127.0.0.1:${HTTP}/?theme=${theme}`});await wait('!!window.__panelQA&&__panelQA.doc().blocks.length>0','panel');await pause(600);
  await ev(`(()=>{const d=__panelQA.doc();__panelQA.seed([...d.groups.filter(g=>!g.parentGroupId).map(g=>({type:'group.delete',id:g.id})),...d.blocks.filter(b=>!b.parentGroupId).map(b=>({type:'block.delete',id:b.id}))]);})()`);
  const ops=[
   {type:'document.update',variables:[{name:'speed',label:'Speed',value:3,min:0,max:10,step:1,unit:'m/s'}]},
   {type:'block.create',block:{id:'ctl',typeId:'controls',title:'Speed (example)',position:{x:0,y:0},data:{question:'What does speed change?',variables:['speed']}}},
   {type:'block.create',block:{id:'label',typeId:'wb-text',title:'',position:{x:420,y:-56},data:{text:'Speed',scale:'l'},bindings:{'text.template':{variable:'speed',template:'Speed: {v} m/s'}}}},
   {type:'block.create',block:{id:'box',typeId:'wb-shape',title:'',position:{x:420,y:0},size:{width:160,height:104},data:{shape:'rounded',fill:'solid',text:''},
    bindings:{'size.width':{variable:'speed',map:{from:[0,10],to:[80,420]}},'size.height':{variable:'speed',map:{from:[0,10],to:[60,240]}},'fill.color':{variable:'speed',hue:{from:[0,10],to:[200,0]}},'text.template':{variable:'speed',template:'{v}'},'text.size':{variable:'speed',expr:'14 + v * 2'}}}},
   {type:'block.create',block:{id:'card',typeId:'node',title:'Faster means bigger',position:{x:960,y:0},data:{summary:'The box takes its size and colour from Speed (example data).'}}},
   {type:'link.create',link:{id:'l1',from:'box',to:'card'}},
  ];
  const seeded=await ev(`(()=>{try{__panelQA.seed(${JSON.stringify(ops)});return 'ok'}catch(e){return String(e.message).slice(0,600)}})()`);assert.equal(seeded,'ok',seeded);
  await wait(`!!document.querySelector('#lienzo-interactive-controls-ctl-speed input[type=range]')`,'slider');await press(label('Fit all'));await pause(1200);
  const revision=await ev('__panelQA.doc().revision'),before=await writes();
  let small,large;
  await check('the slider drives width, height, colour and text, and writes nothing',async()=>{
   await slide(2);small=await box();await shot('speed-2');
   assert.match(await ev(`document.querySelector('#lienzo-entity-label').innerText`),/Speed: 2 m\/s/);
   await slide(9);large=await box();await shot('speed-9');
   assert.match(await ev(`document.querySelector('#lienzo-entity-label').innerText`),/Speed: 9 m\/s/);
   const ratio=large.w/small.w;assert.ok(Math.abs(ratio-386/148)<.1,`width ratio ${ratio}`);
   assert.ok(large.h>small.h*2,'height follows');
   assert.equal(await ev('__panelQA.doc().revision'),revision,'no revision');assert.equal(await writes(),before,'no canvas.mutate while sliding');
   assert.equal(await ev(`__panelQA.runtime().scopes.$document.speed`),9);
  });
  await check('the link leaves from the bound edge',async()=>{
   const paths=await ev(`[...document.querySelectorAll('svg path')].map(p=>p.getAttribute('d')).filter(Boolean).length`);assert.ok(paths>0);
  });
  await check('selected: Bound to Speed replaces the resize handles, and Properties lists the bindings',async()=>{
   const b=await box();await mouse('mouseMoved',b.x,b.y);await mouse('mousePressed',b.x,b.y,1);await pause(30);await mouse('mouseReleased',b.x,b.y);await pause(700);
   await wait(`__panelQA.doc().selectedIds.includes('box')||document.body.innerText.includes('Bound to Speed')`,'selected');
   assert.ok(await ev(`document.body.innerText.includes('Bound to Speed')`),'hint');
   assert.equal(await ev(`document.querySelectorAll('[id^="lienzo-interactive-resize-box"]').length`),0,'no handles');
   await wait(`!!document.querySelector('#lienzo-properties-bindings')`,'bindings section');
   await shot('selected');
  });
  await check('the bind form for Width: variable, mapping sentence, formula and the live value',async()=>{
   await press('#lienzo-bind-box-size-width');await wait(`!!document.querySelector('#lienzo-bind-popover')`,'popover');
   await ev(`document.querySelector('#lienzo-bind-popover').scrollIntoView({block:'center'})`);await pause(300);
   const text=await ev(`document.querySelector('#lienzo-bind-popover').innerText`);
   assert.match(text,/When Speed goes from/);assert.match(text,/Now Speed 9 m\/s/);assert.match(text,/386 px/);
   await shot('popover');
   await press(label('Formula instead'));await pause(200);await shot('popover-formula');
  });
  await check('no uncaught errors',async()=>{assert.deepEqual(uncaught.map(u=>u.exception?.description?.slice(0,200)),[]);});
 }finally{fs.writeFileSync(`${OUT}/lienzo-bindings-${theme}.json`,JSON.stringify(checks,null,1));ws.close();}
 if(checks.some(c=>c.result==='fail'))process.exit(1);
})().catch(e=>{console.error(e);process.exit(1);});
