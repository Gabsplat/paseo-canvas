// Resizing an icon and a rectangle from each of their eight handles (example data). The regression of October 2026:
// an icon blew up to the 4096 limit on the first move, a rectangle's fill stayed at its old proportions until
// release, and the handles showed the open hand instead of a resize cursor.
// Checks, for every handle, smaller and larger: the cursor on hover and while held, the box and its drawing at the
// live size during the drag (nothing saved yet), and the stored size and drawing after release.
// Other agents may run the harness at the same time: LIENZO_CDP and LIENZO_HTTP pick other ports.
const assert=require('node:assert/strict');const fs=require('node:fs');
const cdp=process.env.LIENZO_CDP||'9222',origin=`http://127.0.0.1:${process.env.LIENZO_HTTP||'8765'}/`,shots=process.env.LIENZO_SHOTS||'/tmp',theme=process.argv[2]||'oscuro';
(async()=>{
 const pages=await(await fetch(`http://127.0.0.1:${cdp}/json/list`)).json();
 const page=pages.find(p=>p.type==='page'&&p.url.startsWith(origin));if(!page)throw Error('QA page missing');
 const ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((ok,no)=>{ws.addEventListener('open',ok,{once:true});ws.addEventListener('error',no,{once:true});});
 let seq=0;const pending=new Map(),uncaught=[];
 ws.addEventListener('message',e=>{const r=JSON.parse(e.data);if(r.method==='Runtime.exceptionThrown')uncaught.push(r.params.exceptionDetails);if(r.id){const p=pending.get(r.id);if(!p)return;pending.delete(r.id);r.error?p.no(Error(JSON.stringify(r.error))):p.ok(r.result);}});
 const call=(method,params={})=>new Promise((ok,no)=>{const id=++seq;pending.set(id,{ok,no});ws.send(JSON.stringify({id,method,params}));});
 const ev=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result?.value;};
 const wait=async(expression,what=expression)=>{for(let n=0;n<150;n++){if(await ev(expression))return;await new Promise(r=>setTimeout(r,40));}throw Error('Condition timed out: '+what);};
 const sleep=ms=>new Promise(r=>setTimeout(r,ms)),frames=()=>ev('new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))');
 const mouse=(type,x,y,buttons=0)=>call('Input.dispatchMouseEvent',{type,x,y,button:type==='mouseMoved'&&!buttons?'none':'left',buttons,clickCount:1});
 const box=sel=>ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)throw Error('Missing '+${JSON.stringify(sel)});const r=e.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height}})()`);
 const press=async sel=>{await frames();const b=await box(sel),x=b.x+b.w/2,y=b.y+b.h/2;await mouse('mouseMoved',x,y);await mouse('mousePressed',x,y,1);await mouse('mouseReleased',x,y);await sleep(250);};
 const shot=async name=>{const r=await call('Page.captureScreenshot',{format:'png'});const file=`${shots}/resize-${name}-${theme}.png`;fs.writeFileSync(file,Buffer.from(r.data,'base64'));return file;};
 const stored=id=>ev(`__panelQA.doc().blocks.find(b=>b.id===${JSON.stringify(id)})`);
 // What the person sees: the entity box (the outline is 4 px outside it) and the drawing inside it.
 const rendered=id=>ev(`(()=>{const e=document.querySelector('#lienzo-entity-'+${JSON.stringify(id)}),r=e.getBoundingClientRect(),art=e.querySelector('img')??e.querySelector('svg path'),a=art.getBoundingClientRect();return{box:{x:r.x,y:r.y,w:r.width,h:r.height},art:{x:a.x,y:a.y,w:a.width,h:a.height}}})()`);
 const cursorAt=(x,y)=>ev(`getComputedStyle(document.elementFromPoint(${x},${y})).cursor`);
 const near=(a,b,tol,why)=>assert.ok(Math.abs(a-b)<=tol,`${why}: ${a} vs ${b}`);
 const fallback={nw:'nwse-resize',se:'nwse-resize',ne:'nesw-resize',sw:'nesw-resize',e:'ew-resize',w:'ew-resize',n:'ns-resize',s:'ns-resize'};
 const out={nw:[-1,-1],n:[0,-1],ne:[1,-1],e:[1,0],se:[1,1],s:[0,1],sw:[-1,1],w:[-1,0]};
 const results=[];
 try{
 await call('Runtime.enable');await call('Page.enable');await call('Network.enable');await call('Network.setCacheDisabled',{cacheDisabled:true});
 await call('Page.navigate',{url:`${origin}?theme=${theme}`});await wait('!!document.querySelector("#lienzo-entity-note")');await sleep(700);
 // The icon, from the + catalog, as a person inserts it.
 await press('#lienzo-tool-add');await sleep(400);await ev(`document.querySelector('[id="lienzo-add-icons"]').scrollIntoView({block:'center'})`);await sleep(200);await press('[id="lienzo-add-icons"]');
 await wait(`!!document.querySelector('[aria-label="Insert Server"]')`);await press('[aria-label="Insert Server"]');await wait('__panelQA.doc().blocks.some(b=>b.typeId==="wb-svg")');
 const icon=(await ev('__panelQA.doc().blocks.find(b=>b.typeId==="wb-svg")')).id;await wait(`!!document.querySelector("#lienzo-entity-${icon} img")`);await wait(`!document.querySelector('[aria-label="Close icons"]')`);await sleep(300);
 // The rectangle, drawn with the shape tool on empty canvas below the icon.
 const ib=await box('#lienzo-entity-'+icon),sx=ib.x-60,sy=ib.y+ib.h+90;
 await press('#lienzo-tool-shape');await sleep(250);
 // A filled square, as in the report: the fill must follow the box. The style island lists Fill before Stroke.
 const solid=await ev(`(()=>{const e=document.querySelector('[aria-label="Solid"]');if(!e)return null;const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);if(solid){await mouse('mousePressed',solid.x,solid.y,1);await mouse('mouseReleased',solid.x,solid.y);await sleep(200);}
 await mouse('mouseMoved',sx,sy);await mouse('mousePressed',sx,sy,1);for(let i=1;i<=12;i++)await mouse('mouseMoved',sx+i*13,sy+i*8,1);await mouse('mouseReleased',sx+156,sy+96);
 await wait('__panelQA.doc().blocks.some(b=>b.typeId==="wb-shape")');const rectBlock=await ev('__panelQA.doc().blocks.find(b=>b.typeId==="wb-shape")'),rect=rectBlock.id;assert.equal(rectBlock.data.fill,'solid','the rectangle is filled');
 if(await ev('!!document.querySelector("#lienzo-tool-select")'))await press('#lienzo-tool-select');await sleep(300);
 for(const [id,kind] of [[icon,'icon'],[rect,'rectangle']]){
  // An unfilled shape is hit on its ink only: press its left edge.
  const r0=await rendered(id),px=kind==='icon'?r0.box.x+r0.box.w/2:r0.box.x+1,py=r0.box.y+r0.box.h/2;await mouse('mouseMoved',px,py);await mouse('mousePressed',px,py,1);await mouse('mouseReleased',px,py);
  await wait(`!!document.querySelector("#lienzo-interactive-resize-${id}-se")`,`${kind} handles`);await sleep(250);
  for(const handle of Object.keys(out))for(const [step,amount] of [['larger',28],['smaller',-28]]){
   const why=`${kind} ${handle} ${step}`,before=await stored(id),view=await rendered(id),scale=view.box.w/before.size.width;
   const h=await box(`#lienzo-interactive-resize-${id}-${handle}`),x=h.x+h.w/2,y=h.y+h.h/2;
   // Hover: the drawn double arrow along the handle's axis, on the element really under the pointer.
   await mouse('mouseMoved',x,y);await frames();const hover=await cursorAt(x,y);
   assert.ok(hover.startsWith('url("data:image/svg+xml')&&hover.endsWith(', '+fallback[handle]),`${why} hover cursor: ${hover.slice(-30)}`);
   const [ox,oy]=out[handle],dx=ox*amount,dy=oy*amount;
   await mouse('mousePressed',x,y,1);for(let i=1;i<=10;i++){await mouse('mouseMoved',x+dx*i/10,y+dy*i/10,1);await sleep(8);}
   await frames();
   // Mid-gesture: nothing saved, the box and its drawing already at the new size, the cursor held off the handle too.
   const live=await rendered(id),held=await cursorAt(x+dx+(ox||1)*30,y+dy+(oy||1)*30),still=await stored(id);
   assert.deepEqual(still.size,before.size,`${why}: saved before release`);
   assert.equal(held,hover,`${why}: cursor held while dragging`);
   const expectW=kind==='icon'?before.size.width+(ox?ox*dx:oy*dy)/scale:before.size.width+ox*dx/scale,expectH=kind==='icon'?expectW*before.size.height/before.size.width:before.size.height+oy*dy/scale;
   near(live.box.w/scale,expectW,2,`${why} live width`);near(live.box.h/scale,expectH,2,`${why} live height`);
   near(live.art.w,live.box.w,2,`${why} drawing fills the live box (w)`);near(live.art.h,live.box.h,2,`${why} drawing fills the live box (h)`);near(live.art.x,live.box.x,2,`${why} drawing x`);near(live.art.y,live.box.y,2,`${why} drawing y`);
   if(handle==='se'&&step==='larger')await shot(`${kind}-during`);
   await mouse('mouseReleased',x+dx,y+dy);
   await wait(`(()=>{const b=__panelQA.doc().blocks.find(b=>b.id===${JSON.stringify(id)});return b.size.width!==${before.size.width}||b.size.height!==${before.size.height}})()`,`${why} saved`);
   await sleep(450);const after=await stored(id),done=await rendered(id);
   near(after.size.width,expectW,2,`${why} stored width`);near(after.size.height,expectH,2,`${why} stored height`);
   near(done.box.w,after.size.width*scale,1.5,`${why} rendered width after`);near(done.box.h,after.size.height*scale,1.5,`${why} rendered height after`);
   near(done.art.w,done.box.w,2,`${why} drawing after (w)`);near(done.art.h,done.box.h,2,`${why} drawing after (h)`);
   assert.equal(await ev('!!document.getElementById("lienzo-held-cursor")'),false,`${why}: held cursor released`);
   results.push({kind,handle,step,from:before.size,to:after.size,live:{width:Math.round(live.box.w/scale),height:Math.round(live.box.h/scale)}});
  }
  await shot(`${kind}-after`);
  console.log(`PASS ${kind}: 8 handles, larger and smaller, live and stored sizes, drawing and cursors`);
 }
 assert.ok(!(await ev('__panelQA.doc().blocks')).some(b=>b.size&&(b.size.width>=4096||b.size.height>=4096)),'nothing reached the limit');
 assert.deepEqual(await ev('__panelQA.actions'),[]);assert.deepEqual(uncaught,[]);
 fs.writeFileSync(`${shots}/resize-${theme}.json`,JSON.stringify(results,null,1));
 console.log('PASS resize scenario');
 }finally{ws.close();}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
