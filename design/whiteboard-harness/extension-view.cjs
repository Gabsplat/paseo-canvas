// Extension view API (example data): a tiny presentation tool steps through three Sheets with lienzo.keys, frames each
// with lienzo.view.fit, highlights it, keeps its place in lienzo.storage, and none of it creates a revision.
// Ports: CDP=9222 and HTTP=8765 unless set in the environment. The tool's frame is read through CDP, so start Chromium
// with --disable-site-isolation-trials --disable-features=IsolateOrigins,site-per-process (its frame stays in the page). Nothing here reaches an assistant.
const assert=require('node:assert/strict');const fs=require('node:fs');
const CDP=process.env.CDP||9222,HTTP=process.env.HTTP||8765,OUT=process.env.OUT||'/tmp';
(async()=>{
 const pages=await(await fetch(`http://127.0.0.1:${CDP}/json/list`)).json();
 const page=pages.find(p=>p.type==='page'&&p.url.startsWith(`http://127.0.0.1:${HTTP}/`));if(!page)throw Error('QA page missing');
 const ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((ok,no)=>{ws.addEventListener('open',ok,{once:true});ws.addEventListener('error',no,{once:true});});
 let seq=0;const pending=new Map(),uncaught=[];
 ws.addEventListener('message',e=>{const r=JSON.parse(e.data);if(r.method==='Runtime.exceptionThrown')uncaught.push(r.params.exceptionDetails);if(r.id){const p=pending.get(r.id);if(!p)return;pending.delete(r.id);r.error?p.no(Error(JSON.stringify(r.error))):p.ok(r.result);}});
 const call=(method,params={})=>new Promise((ok,no)=>{const id=++seq;pending.set(id,{ok,no});ws.send(JSON.stringify({id,method,params}));});
 const ev=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result?.value;};
 const pause=ms=>new Promise(r=>setTimeout(r,ms));
 const wait=async(expression,what=expression)=>{for(let n=0;n<150;n++){if(await ev(expression))return;await pause(50);}throw Error('Condition timed out: '+what);};
 const mouse=(type,x,y,buttons=0)=>call('Input.dispatchMouseEvent',{type,x,y,button:'left',buttons,clickCount:1});
 const press=async(x,y)=>{await mouse('mouseMoved',x,y);await mouse('mousePressed',x,y,1);await mouse('mouseReleased',x,y);await pause(700);};
 const click=async sel=>{const p=await ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)throw Error('Missing '+${JSON.stringify(sel)});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);await press(p.x,p.y);};
 const shot=async name=>{const r=await call('Page.captureScreenshot',{format:'png'});const file=`${OUT}/lienzo-extview-${name}.png`;fs.writeFileSync(file,Buffer.from(r.data,'base64'));console.log('screenshot',file);};
 const key=async(key,code)=>{await call('Input.dispatchKeyEvent',{type:'keyDown',key,code,windowsVirtualKeyCode:key==='ArrowRight'?39:key==='ArrowLeft'?37:0});await call('Input.dispatchKeyEvent',{type:'keyUp',key,code});await pause(900);};
 // The tool's page is an opaque-origin frame: read its text through an isolated world of that frame.
 const frameText=async()=>{const tree=await call('Page.getFrameTree');const find=n=>(n.childFrames||[]).map(c=>c.frame.name==='lienzo-qa-present'||/about:srcdoc/.test(c.frame.url)?c.frame:find(c)).find(Boolean);const f=find(tree.frameTree);if(!f)return '';
  const {executionContextId}=await call('Page.createIsolatedWorld',{frameId:f.id});const r=await call('Runtime.evaluate',{expression:'document.body&&document.body.innerText',contextId:executionContextId,returnByValue:true});return r.result.value||'';};
 try{
 await call('Runtime.enable');await call('Page.enable');
 await call('Page.navigate',{url:`http://127.0.0.1:${HTTP}/?theme=${process.argv[2]||'oscuro'}`});await wait('!!document.querySelector("#lienzo-entity-note")');
 await ev(`(()=>{const ops=[],at='2026-10-19T00:00:00.000Z';[0,1,2].forEach(n=>{const ids=['s'+n+'a','s'+n+'b'];ids.forEach((id,i)=>ops.push({type:'block.create',block:{id,typeId:'note',title:'Example slide '+(n+1)+' · card '+(i+1),data:{text:'Example data for the presentation check.'}}}));
  ops.push({type:'group.create',group:{id:'sheet'+n,title:'Example Sheet '+(n+1),description:'',blockIds:ids,groupIds:[],position:{x:900+n*1500,y:0},sheet:{number:n+1,createdAt:at,source:'user'}}});});__panelQA.seed(ops);})()`);
 await wait('!!document.querySelector("#lienzo-entity-sheet2")');await pause(600);
 const html=`<style>body{margin:0;font:13px system-ui;color:#ccc;padding:12px}b{color:#fff}</style><div id="out">waiting</div><script>
var slides=['sheet0','sheet1','sheet2'],i=0,view=null,restored='none',out=document.getElementById('out');
function draw(){out.innerHTML='<b>Slide '+(i+1)+' / '+slides.length+'</b><br>restored: '+restored+'<br>fullscreenEnabled: '+document.fullscreenEnabled+'<br>has view: '+!!lienzo.view+'<br>'+(view?'scale '+view.scale.toFixed(2)+' · sheet '+view.sheetId+' · visible '+view.visibleIds.length:'no view yet')+'<br>context.view: '+!!(lienzo.context&&lienzo.context.view)}
function go(n){i=Math.max(0,Math.min(slides.length-1,n));lienzo.view.fit([slides[i]],{padding:48});lienzo.highlight([slides[i]],{dim:true,tone:'violet'});lienzo.storage.set({slide:i});draw()}
lienzo.view.onChange(function(v){view=v;draw()});lienzo.onContext(draw);
lienzo.storage.get().then(function(v){restored=v?String(v.slide):'nothing';if(v)i=v.slide;draw()});
lienzo.keys.bind(['ArrowRight','Space'],function(){go(i+1)});lienzo.keys.bind(['ArrowLeft'],function(){go(i-1)});
<\/script>`;
 await ev('__panelQA.addExtension('+JSON.stringify({id:'qa-present',kind:'tool',api:1,name:'QA · Presentation',description:'Example data: steps through Sheets.',permissions:['view'],html})+')');
 const open=async()=>{await click('#lienzo-tool-add');await wait('!!document.querySelector("#lienzo-add-menu")');await ev(`document.querySelector('[id="lienzo-add-ext.qa-present"]').scrollIntoView({block:'center'})`);await click('[id="lienzo-add-ext.qa-present"]');await wait(`!!document.querySelector('[id="lienzo-extension-qa-present"] iframe')`);await pause(900);};
 await open();
 const rev0=await ev('__panelQA.doc().revision'),log0=await ev('__panelQA.log.length');
 let text=await frameText();console.log(text.replace(/\n/g,' | '));
 assert.match(text,/fullscreenEnabled: true/);assert.match(text,/has view: true/);assert.match(text,/restored: nothing/);assert.match(text,/scale \d/,'the view arrived');assert.match(text,/context.view: true/);
 assert.equal(await ev(`document.querySelector('[id="lienzo-extension-qa-present"] iframe').getAttribute('allow')`),'fullscreen');
 // Arrow keys pressed on the canvas go to the tool: it frames Sheet 2, highlights it and dims the rest.
 await click('#lienzo-canvas-viewport');await key('ArrowRight','ArrowRight');await pause(600);
 text=await frameText();console.log(text.replace(/\n/g,' | '));
 assert.match(text,/Slide 2 \/ 3/);assert.match(text,/sheet sheet1/,'the view says the Sheet under the centre');
 assert.ok(await ev('!!document.querySelector("#lienzo-highlight-sheet1")'),'the highlight is drawn');
 await shot('slide2');
 await key(' ','Space');text=await frameText();assert.match(text,/Slide 3 \/ 3/);assert.match(text,/sheet sheet2/);await shot('slide3');
 // Back one: the stored slide follows.
 await key('ArrowLeft','ArrowLeft');
 assert.equal(await ev('__panelQA.doc().revision'),rev0,'camera, highlight, keys and storage made no revision');assert.equal(await ev('__panelQA.log.length'),log0);
 // Closing the tool removes its highlight; opening it again restores the stored slide.
 await click('[aria-label="Close QA · Presentation"]');await pause(400);
 assert.ok(!(await ev('!!document.querySelector("[id^=lienzo-highlight-]")')),'closing removes the highlight');
 await key('ArrowRight','ArrowRight');
 await open();text=await frameText();console.log(text.replace(/\n/g,' | '));assert.match(text,/restored: 1/,'storage kept the slide');
 await shot('reopened');
 assert.deepEqual(uncaught.map(u=>u.exception?.description||u.text),[],'something threw');
 console.log('extension view: ok');
 }finally{ws.close();}
})().catch(e=>{console.error(e);process.exit(1);});
