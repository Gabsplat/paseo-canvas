// Text editing grows with the text and lands where it was typed; free text scales from a corner and rewraps from a side.
// Real keys and pointer on example data: five lines typed into a new free text, into a hollow rectangle's label (the
// rectangle grows to fit) and a long card title. While typing the field never scrolls and its box grows with each line;
// after commit the saved text's box matches the editor's within 1 px. Then a corner handle scales a free text 2× (font,
// box, live preview, one write) and a side handle rewraps it.
// Usage: node text-edit.cjs [papel|dark]. CDP, HTTP and OUT override the debug port, page port and output prefix.
const assert=require('node:assert/strict');const fs=require('node:fs');
const CDP=process.env.CDP||'9222',HTTP=process.env.HTTP||'8765',theme=process.argv[2]||'papel',OUT=(process.env.OUT||'/tmp/lienzo-text-edit')+'-'+theme;
(async()=>{
 const pages=await(await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
 const page=pages.find(p=>p.type==='page'&&p.url.startsWith(`http://127.0.0.1:${HTTP}/`));if(!page)throw Error('QA page missing');
 const ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((ok,no)=>{ws.addEventListener('open',ok,{once:true});ws.addEventListener('error',no,{once:true});});
 let seq=0;const pending=new Map(),uncaught=[];
 ws.addEventListener('message',e=>{const r=JSON.parse(e.data);if(r.method==='Runtime.exceptionThrown')uncaught.push(r.params.exceptionDetails);if(r.id){const p=pending.get(r.id);if(!p)return;pending.delete(r.id);clearTimeout(p.timer);r.error?p.no(Error(JSON.stringify(r.error))):p.ok(r.result);}});
 const call=(method,params={})=>new Promise((ok,no)=>{const id=++seq;const timer=setTimeout(()=>{pending.delete(id);no(Error('Timeout '+method));},15000);pending.set(id,{ok,no,timer});ws.send(JSON.stringify({id,method,params}));});
 const ev=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails).slice(0,600));return r.result?.value;};
 const wait=async(expression,what=expression)=>{for(let n=0;n<150;n++){if(await ev(expression))return;await new Promise(r=>setTimeout(r,50));}throw Error('Timed out: '+what);};
 const pause=ms=>new Promise(r=>setTimeout(r,ms));
 const settle=()=>ev('new Promise(r=>setTimeout(()=>requestAnimationFrame(()=>requestAnimationFrame(r)),150))');
 const box=async selector=>ev(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e)throw Error('Missing '+${JSON.stringify(selector)});const r=e.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height}})()`);
 const mouse=(type,x,y,buttons=0,modifiers=0,clickCount=1)=>call('Input.dispatchMouseEvent',{type,x,y,modifiers,button:type==='mouseMoved'&&!buttons?'none':'left',buttons,clickCount});
 const tap=async(x,y)=>{await mouse('mouseMoved',x,y);await mouse('mousePressed',x,y,1);await mouse('mouseReleased',x,y);await pause(250);};
 const dbl=async(x,y)=>{await mouse('mouseMoved',x,y);await mouse('mousePressed',x,y,1,0,1);await mouse('mouseReleased',x,y,0,0,1);await mouse('mousePressed',x,y,1,0,2);await mouse('mouseReleased',x,y,0,0,2);await pause(300);};
 const drag=async(x,y,dx,dy,hold,modifiers=0)=>{await mouse('mouseMoved',x,y);await mouse('mousePressed',x,y,1,modifiers);for(let i=1;i<=12;i++){await mouse('mouseMoved',x+dx*i/12,y+dy*i/12,1,modifiers);await pause(16);}if(hold)await hold();await mouse('mouseReleased',x+dx,y+dy,0,modifiers);await pause(600);};
 const key=async(k,code,modifiers=0)=>{const vk={Enter:13,Escape:27,ArrowRight:39}[k]??(k.length===1?k.toUpperCase().charCodeAt(0):0);await call('Input.dispatchKeyEvent',{type:'rawKeyDown',key:k,code,modifiers,windowsVirtualKeyCode:vk});if(k==='Enter'&&!modifiers)await call('Input.dispatchKeyEvent',{type:'char',key:'\r',text:'\r',unmodifiedText:'\r',windowsVirtualKeyCode:13});await call('Input.dispatchKeyEvent',{type:'keyUp',key:k,code,modifiers,windowsVirtualKeyCode:vk});await pause(80);};
 const type=async text=>{for(const ch of text){await call('Input.dispatchKeyEvent',{type:'keyDown',key:ch,text:ch,unmodifiedText:ch});await call('Input.dispatchKeyEvent',{type:'keyUp',key:ch});}await pause(60);};
 const shot=async name=>{await settle();const r=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(`${OUT}-${name}.png`,Buffer.from(r.data,'base64'));};
 const checks=[];const check=async(name,run)=>{try{await run();checks.push({name,result:'pass'});console.log('PASS '+name);}catch(error){checks.push({name,result:'fail',error:error.message});console.log('FAIL '+name+': '+error.message);}};
 const block=id=>ev(`__panelQA.doc().blocks.find(b=>b.id===${JSON.stringify(id)})`);
 // The field and the invisible copy that sizes it; scroll would show as scrollHeight over clientHeight.
 const field=`(()=>{const t=document.querySelector('#lienzo-editor textarea');if(!t)return null;const r=t.getBoundingClientRect(),s=getComputedStyle(t);return{x:r.x,y:r.y,w:r.width,h:r.height,scroll:t.scrollHeight-t.clientHeight,scrollW:t.scrollWidth-t.clientWidth,top:t.scrollTop,overflow:s.overflowY,font:s.font,line:s.lineHeight,align:s.textAlign}})()`;
 const textNode=id=>`(()=>{const n=[...document.querySelectorAll('#lienzo-entity-${id} div')].filter(e=>e.children.length===0&&e.textContent.trim()).pop();if(!n)return null;const r=n.getBoundingClientRect(),s=getComputedStyle(n);return{x:r.x,y:r.y,w:r.width,h:r.height,font:s.font,line:s.lineHeight,size:parseFloat(s.fontSize)}})()`;
 const near=(a,b,what,tol=1)=>{for(const k of ['x','y','w','h'])assert.ok(Math.abs(a[k]-b[k])<=tol,`${what}: ${k} ${a[k]} vs ${b[k]}`);};
 const lines=['First line','Second line, a little longer','Third','Fourth line here','Fifth and last line'];
 const typeLines=async(check)=>{const heights=[];for(let i=0;i<lines.length;i++){if(i)await key('Enter','Enter');await type(lines[i]);await settle();const f=await ev(field);assert.ok(f,'editor open');assert.ok(f.scroll<=0&&f.top===0,'no inner scroll at line '+(i+1)+': '+JSON.stringify(f));heights.push(f.h);if(check)await check(f,i);}for(let i=1;i<heights.length;i++)assert.ok(heights[i]>heights[i-1],'grows with each line '+heights);return heights;};
 try{
 await call('Runtime.enable');await call('Page.enable');await call('Emulation.setDeviceMetricsOverride',{width:1280,height:860,deviceScaleFactor:1,mobile:false});
 await call('Page.navigate',{url:`http://127.0.0.1:${HTTP}/?theme=${theme}`});await wait('!!window.__panelQA&&__panelQA.doc().blocks.length>0','panel');await pause(600);
 // Place the examples on screen: canvas = screen − (the first card's screen box − its canvas position), at 100 %.
 const anchor=await ev(`(()=>{const b=__panelQA.doc().blocks.find(b=>document.querySelector('#lienzo-entity-'+b.id)&&b.typeId==='node'),r=document.querySelector('#lienzo-entity-'+b.id).getBoundingClientRect();return{dx:r.x-b.position.x,dy:r.y-b.position.y}})()`);
 const at=(x,y)=>`{x:${Math.round(x-anchor.dx)},y:${Math.round(y-anchor.dy)}}`;
 await ev(`__panelQA.seed([
  {type:'block.create',block:{id:'hollow',typeId:'wb-shape',title:'',position:${at(700,190)},size:{width:200,height:104},data:{shape:'rect',fill:'none',text:''}}},
  {type:'block.create',block:{id:'scaled',typeId:'wb-text',title:'',position:${at(660,420)},data:{text:'Scale me'}}},
  {type:'block.create',block:{id:'wrapme',typeId:'wb-text',title:'',position:${at(660,620)},data:{text:'A free text that rewraps when its side is pulled'}}}])`);
 await wait('!!document.querySelector("#lienzo-entity-hollow")&&!!document.querySelector("#lienzo-entity-wrapme")','seeded');await pause(600);
 await shot('start');

 await check('a new free text grows with five typed lines, never scrolls, and lands where it was typed',async()=>{
  await tap(...Object.values(await ev(`(()=>{const b=document.querySelector('#lienzo-tool-text').getBoundingClientRect();return{x:b.x+b.width/2,y:b.y+b.height/2}})()`)));
  const count=await ev('__panelQA.doc().blocks.length');
  await tap(380,560);await wait('!!document.querySelector("#lienzo-editor textarea")','editor');
  let widths=[];await typeLines(async f=>{widths.push(f.w);});assert.ok(widths[1]>widths[0],'auto width follows the longest line '+widths);
  const before=await ev(field);await shot('free-editing');
  await key('Escape','Escape');await wait('!document.querySelector("#lienzo-editor")','closed');await wait(`__panelQA.doc().blocks.length===${count+1}`,'created');
  const id=await ev(`__panelQA.doc().blocks.at(-1).id`),b=await block(id);assert.equal(b.data.text,lines.join('\n'));
  await settle();const after=await ev(textNode(id));near(after,before,'saved text box = editor box');assert.equal(after.font,before.font);assert.equal(after.line,before.line);
  await shot('free-saved');
 });
 await check('a hollow rectangle label wraps inside the shape, the shape grows to fit, and the label stays put on commit',async()=>{
  const s0=await box('#lienzo-entity-hollow');await tap(s0.x+3,s0.y+s0.h/2);await wait(`__panelQA.doc().selectedIds.includes('hollow')`,'selected');
  await key('Enter','Enter');await wait('!!document.querySelector("#lienzo-editor textarea")','editor');
  await typeLines();const before=await ev(field),grown=await box('#lienzo-entity-hollow');assert.ok(grown.h>s0.h+20,'the shape grew while typing '+JSON.stringify([s0,grown]));
  assert.ok(before.w<=s0.w,'the label wraps inside the shape');await shot('label-editing');
  await key('Enter','Enter',process.platform==='darwin'?4:2);await wait('!document.querySelector("#lienzo-editor")','closed');
  const b=await block('hollow');assert.equal(b.data.text,lines.join('\n'));assert.ok(b.size.height>104,'the grown height is saved: '+JSON.stringify(b.size));assert.equal(b.size.width,200);
  await settle();const label=await ev(textNode('hollow')),s1=await box('#lienzo-entity-hollow');
  assert.ok(Math.abs(label.y-before.y)<=1&&Math.abs(label.h-before.h)<=1,'label rows where typed '+JSON.stringify([label,before]));
  assert.ok(Math.abs(label.x+label.w/2-(before.x+before.w/2))<=1,'label centre where typed');assert.ok(Math.abs(s1.h-grown.h)<=1,'shape keeps the grown size '+JSON.stringify([s1,grown]));
  await shot('label-saved');
 });
 await check('a card title wraps and grows line by line, Enter saves it in place',async()=>{
  const id=await ev(`__panelQA.doc().blocks.find(b=>b.typeId==='node'&&document.querySelector('#lienzo-entity-'+b.id)).id`);
  const c=await box('#lienzo-entity-'+id);await tap(c.x+c.w/2,c.y+16);await wait(`__panelQA.doc().selectedIds.includes('${id}')`,'card selected');
  // Past the 400 ms of a second press on a selected card, so the double click itself opens the title.
  await pause(600);await dbl(c.x+c.w/2,c.y+16);await wait('!!document.querySelector("#lienzo-title-editor")','title editor');
  await wait('document.activeElement===document.querySelector("#lienzo-title-editor")','title focused');
  await key('a','KeyA',process.platform==='darwin'?4:2);
  const t=()=>ev(`(()=>{const t=document.querySelector('#lienzo-title-editor');const r=t.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height,scroll:t.scrollHeight-t.clientHeight,top:t.scrollTop}})()`);
  await type('Ingest');const one=await t();await type(' queue worker that drains uploads');await settle();const two=await t();
  assert.ok(two.scroll<=0&&two.top===0,'no inner scroll '+JSON.stringify(two));assert.ok(two.h>one.h,'grew to two lines '+JSON.stringify([one,two]));
  await shot('title-editing');const before=two;
  await key('Enter','Enter');await wait('!document.querySelector("#lienzo-title-editor")','closed');await wait(`__panelQA.doc().blocks.find(b=>b.id==='${id}').title==='Ingest queue worker that drains uploads'`,'saved');
  await settle();const after=await ev(`(()=>{const n=[...document.querySelectorAll('#lienzo-entity-${id} div')].find(e=>e.children.length===0&&e.textContent==='Ingest queue worker that drains uploads');const r=n.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height}})()`);
  assert.ok(Math.abs(after.x-before.x)<=1&&Math.abs(after.y-before.y)<=1&&Math.abs(after.h-before.h)<=1,'title where it was typed '+JSON.stringify([after,before]));
  // A longer one grows further while typed (saved, the card shows its usual lines).
  await pause(600);await dbl(c.x+c.w/2,c.y+16);await wait('!!document.querySelector("#lienzo-title-editor")','title editor again');await wait('document.activeElement===document.querySelector("#lienzo-title-editor")','focused again');await key('ArrowRight','ArrowRight');
  await mouse('mouseMoved',0,0);await type(' into thumbnails, faces and a nightly digest of everything new');await settle();const long=await t();assert.ok(long.h>=before.h*2-2&&long.scroll<=0,'grows past two lines '+JSON.stringify(long));
  await shot('title-long');await key('Escape','Escape');await wait('!document.querySelector("#lienzo-title-editor")','cancelled');
 });
 await check('a corner handle scales free text 2× with a live preview and one write',async()=>{
  const b0=await box('#lienzo-entity-scaled');await tap(b0.x+b0.w/2,b0.y+b0.h/2);await wait(`JSON.stringify(__panelQA.doc().selectedIds)==='["scaled"]'`,'selected');await settle();
  const t0=await ev(textNode('scaled')),h=await box('#lienzo-interactive-resize-scaled-se'),writes=await ev('__panelQA.log.length');
  await drag(h.x+h.w/2,h.y+h.h/2,b0.w,b0.h,async()=>{await settle();const live=await ev(textNode('scaled'));assert.ok(Math.abs(live.size-2*t0.size)<=.6,'live font '+JSON.stringify([live,t0]));assert.equal(await ev('__panelQA.log.length'),writes,'no write while dragging');await shot('scale-live');});
  await wait(`__panelQA.doc().blocks.find(b=>b.id==='scaled').data.fontSize>0`,'fontSize saved');assert.equal(await ev('__panelQA.log.length'),writes+1,'one write');
  const b=await block('scaled');assert.ok(Math.abs(b.data.fontSize-36)<=.6,'2× of 18 '+b.data.fontSize);
  await settle();await pause(300);const t1=await ev(textNode('scaled')),b1=await box('#lienzo-entity-scaled');
  assert.ok(Math.abs(t1.w-2*t0.w)<=3&&Math.abs(t1.h-2*t0.h)<=2,'text box doubles '+JSON.stringify([t0,t1]));near({...b1},{x:b0.x,y:b0.y,w:t1.w,h:t1.h},'selection box fits the scaled text',2);
  const style=await ev(`(()=>{const e=[...document.querySelectorAll('div')].find(e=>e.children.length===0&&e.textContent.trim()==='Style')?.closest('[role=button]');if(!e)return null;const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  if(style&&!(await ev(`!!document.querySelector('#lienzo-style-custom-size')`)))await tap(style.x,style.y);
  await wait(`!!document.querySelector('#lienzo-style-custom-size')&&document.querySelector('#lienzo-style-custom-size').textContent==='36 px'`,'custom size shown in Style');
  await shot('scale-saved');
 });
 await check('Alt on a corner scales free text about its centre',async()=>{
  const b0=await box('#lienzo-entity-scaled'),h=await box('#lienzo-interactive-resize-scaled-se'),f0=(await block('scaled')).data.fontSize;
  await drag(h.x+h.w/2,h.y+h.h/2,b0.w/4,b0.h/4,null,1);
  await wait(`__panelQA.doc().blocks.find(b=>b.id==='scaled').data.fontSize!==${f0}`,'scaled again');await settle();await pause(300);
  const b=await block('scaled'),b1=await box('#lienzo-entity-scaled');assert.ok(Math.abs(b.data.fontSize-f0*1.5)<=.6,'1.5× from the centre '+b.data.fontSize);
  assert.ok(Math.abs(b1.x+b1.w/2-(b0.x+b0.w/2))<=2&&Math.abs(b1.y+b1.h/2-(b0.y+b0.h/2))<=2,'centre stays '+JSON.stringify([b0,b1]));
  await shot('scale-alt');
 });
 await check('a side handle rewraps free text: narrower, more lines, height follows',async()=>{
  const b0=await box('#lienzo-entity-wrapme');await tap(b0.x+b0.w/2,b0.y+b0.h/2);await wait(`JSON.stringify(__panelQA.doc().selectedIds)==='["wrapme"]'`,'selected');await settle();
  const t0=await ev(textNode('wrapme')),h=await box('#lienzo-interactive-resize-wrapme-e');
  await drag(h.x+h.w/2,h.y+h.h/2,-(b0.w/2),0,async()=>{await settle();const live=await ev(textNode('wrapme'));assert.ok(live.h>t0.h,'rewraps live '+JSON.stringify([t0,live]));assert.equal(live.size,t0.size,'size unchanged');await shot('wrap-live');});
  await wait(`__panelQA.doc().blocks.find(b=>b.id==='wrapme').data.width>0`,'width saved');await settle();await pause(300);
  const t1=await ev(textNode('wrapme')),b1=await box('#lienzo-entity-wrapme'),b=await block('wrapme');
  assert.ok(t1.h>t0.h,'more lines');assert.ok(Math.abs(b1.h-t1.h)<=1&&Math.abs(b1.w-b.data.width)<=1,'box follows the text '+JSON.stringify([b1,t1,b.data.width]));
  await shot('wrap-saved');
 });
 await check('shape handles: Shift keeps the proportion, Alt resizes about the centre',async()=>{
  const b0=await box('#lienzo-entity-hollow');await tap(b0.x+3,b0.y+b0.h/2);await wait(`JSON.stringify(__panelQA.doc().selectedIds)==='["hollow"]'`,'selected');await settle();
  let h=await box('#lienzo-interactive-resize-hollow-se');const s0=(await block('hollow')).size;
  await drag(h.x+h.w/2,h.y+h.h/2,60,4,null,8);await wait(`__panelQA.doc().blocks.find(b=>b.id==='hollow').size.width!==${s0.width}`,'resized');
  const s1=(await block('hollow')).size;assert.ok(Math.abs(s1.width/s1.height-s0.width/s0.height)<=.03,'Shift keeps the ratio '+JSON.stringify([s0,s1]));
  await settle();const b1=await box('#lienzo-entity-hollow');h=await box('#lienzo-interactive-resize-hollow-se');
  await drag(h.x+h.w/2,h.y+h.h/2,20,10,null,1);await wait(`__panelQA.doc().blocks.find(b=>b.id==='hollow').size.width!==${s1.width}`,'resized from the centre');await settle();await pause(300);
  const s2=(await block('hollow')).size,b2=await box('#lienzo-entity-hollow');assert.ok(Math.abs(s2.width-s1.width-40)<=1,'twice the pull '+JSON.stringify([s1,s2]));
  assert.ok(Math.abs(b2.x+b2.w/2-(b1.x+b1.w/2))<=1.5&&Math.abs(b2.y+b2.h/2-(b1.y+b1.h/2))<=1.5,'centre stays '+JSON.stringify([b1,b2]));
 });
 fs.writeFileSync(`${OUT}-results.json`,JSON.stringify({checks,uncaught},null,2));
 assert.deepEqual(uncaught,[]);assert.ok(checks.every(c=>c.result==='pass'),'all checks pass');
 }finally{ws.close();}
})().catch(e=>{console.error(e);process.exit(1);});
