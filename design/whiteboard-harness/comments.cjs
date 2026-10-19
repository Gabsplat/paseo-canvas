// Comments (example data, a stand-in agent author): pins on a card, a Frame and an empty spot; a thread with the
// person and the agent; replying with Enter; the Comment tool (C) on an empty spot; the list with open/resolved and
// jump-to; pins that never start a drag; hiding pins. Nothing reaches an assistant: __panelQA.actions stays empty.
// Run with: node comments.cjs [oscuro|papel] [width] [compact]. LIENZO_CDP and LIENZO_HTTP pick other ports.
// Captures go to $LIENZO_SHOTS (default /tmp)/lienzo-comments-<theme>-<width>[-compact]-*.png.
const assert=require('node:assert/strict');const fs=require('node:fs');
const cdp=process.env.LIENZO_CDP||'9222',origin=`http://127.0.0.1:${process.env.LIENZO_HTTP||'8765'}/`,theme=process.argv[2]||'oscuro',W=Number(process.argv[3]||1280),H=820,compact=process.argv[4]==='compact';
const out=(process.env.LIENZO_SHOTS||'/tmp')+`/lienzo-comments-${theme==='papel'?'light':'dark'}-${W}${compact?'-compact':''}-`;
(async()=>{
 const pages=await(await fetch(`http://127.0.0.1:${cdp}/json/list`)).json();
 const page=pages.find(p=>p.type==='page'&&p.url.startsWith(origin));if(!page)throw Error('QA page missing');
 const ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((ok,no)=>{ws.addEventListener('open',ok,{once:true});ws.addEventListener('error',no,{once:true});});
 let seq=0;const pending=new Map(),uncaught=[];
 ws.addEventListener('message',e=>{const r=JSON.parse(e.data);if(r.method==='Runtime.exceptionThrown')uncaught.push(r.params.exceptionDetails);if(r.id){const p=pending.get(r.id);if(!p)return;pending.delete(r.id);r.error?p.no(Error(JSON.stringify(r.error))):p.ok(r.result);}});
 const call=(method,params={})=>new Promise((ok,no)=>{const id=++seq;pending.set(id,{ok,no});ws.send(JSON.stringify({id,method,params}));});
 const ev=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result?.value;};
 const pause=ms=>new Promise(r=>setTimeout(r,ms));
 const wait=async(expression,what=expression)=>{for(let n=0;n<160;n++){if(await ev(expression))return;await pause(50);}throw Error('Condition timed out: '+what);};
 const mouse=(type,x,y,buttons=0)=>call('Input.dispatchMouseEvent',{type,x,y,button:type==='mouseMoved'&&!buttons?'none':'left',buttons,clickCount:1});
 const tap=async(x,y)=>{await mouse('mouseMoved',x,y);await mouse('mousePressed',x,y,1);await mouse('mouseReleased',x,y);await pause(300);};
 const q=s=>JSON.stringify(s),L=s=>'[aria-label='+q(s)+']';
 const rect=sel=>ev(`(()=>{const e=document.querySelector(${q(sel)});if(!e)return null;const r=e.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height}})()`);
 const click=async sel=>{await wait(`!!document.querySelector(${q(sel)})`,sel);const r=await rect(sel);await tap(r.x+r.w/2,r.y+r.h/2);};
 const key=async(key,code,modifiers=0)=>{await call('Input.dispatchKeyEvent',{type:'keyDown',key,code,modifiers,text:key.length===1?key:undefined,windowsVirtualKeyCode:key==='Escape'?27:key==='Enter'?13:0});await call('Input.dispatchKeyEvent',{type:'keyUp',key,code,modifiers});await pause(250);};
 const type=async text=>{await call('Input.insertText',{text});await pause(150);};
 const has=sel=>ev(`!!document.querySelector(${q(sel)})`);
 const pins=()=>ev('document.querySelectorAll("[id^=lienzo-interactive-comment-pin-]").length');
 const shots=[];const shot=async name=>{await pause(350);const r=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(out+name+'.png',Buffer.from(r.data,'base64'));shots.push(out+name+'.png');};
 try{
 await call('Runtime.enable');await call('Page.enable');
 await call('Emulation.setDeviceMetricsOverride',{width:W,height:H,deviceScaleFactor:1,mobile:false});
 await call('Page.navigate',{url:`${origin}?theme=${theme}${compact?'&compact':''}`});await wait('!!document.querySelector("#lienzo-toolbar")');await pause(700);
 const ago=m=>new Date(Date.now()-m*60000).toISOString(),agent={kind:'agent',agentId:'qa-agent',label:'Example agent'},person={kind:'person'};
 await ev(`(()=>{const Q=__panelQA;
  Q.seedComment({kind:'block',id:'server'},[{author:${q(person)},text:'Example: should this be one server or two? It reads like the gateway and the API.',createdAt:${q(ago(42))}}]);
  Q.seedComment({kind:'block',id:'note'},[{author:${q(person)},text:'Example: this note repeats the server card. Can it say what changes for the reader?',createdAt:${q(ago(180))}},{author:${q(agent)},text:'Example reply: it now explains the retry, which the card leaves out. I kept it short.',createdAt:${q(ago(9))}}]);
  Q.seedComment({kind:'group',id:'frame'},[{author:${q(agent)},text:'Example open question: does the Frame hold the deploy steps, or only the services?',createdAt:${q(ago(3))}}]);
  Q.seedComment({kind:'point',x:860,y:470},[{author:${q(person)},text:'Example: leave room here for the database.',createdAt:${q(ago(1500))}}]);
  Q.seedComment({kind:'block',id:'server'},[{author:${q(person)},text:'Example: rename to Edge server.',createdAt:${q(ago(4000))}}],'resolved');})()`);
 if(!compact){
  await wait('document.querySelectorAll("[id^=lienzo-interactive-comment-pin-]").length===4','four open pins');
  if(await has('[aria-label="Fit all"]'))await click('[aria-label="Fit all"]');else await key('!','Digit1',8);await pause(900);await shot('pins');
  // A press-and-drag on a pin moves no card.
  const before=await ev('JSON.stringify(__panelQA.doc().blocks.map(b=>b.position))');
  const pin=await ev('(()=>{const e=[...document.querySelectorAll("[id^=lienzo-interactive-comment-pin-]")][0].getBoundingClientRect();return{x:e.x+e.width/2,y:e.y+e.height/2}})()');
  await mouse('mouseMoved',pin.x,pin.y);await mouse('mousePressed',pin.x,pin.y,1);for(let i=1;i<=6;i++)await mouse('mouseMoved',pin.x+i*20,pin.y+i*12,1);await mouse('mouseReleased',pin.x+120,pin.y+72);await pause(500);
  assert.equal(await ev('JSON.stringify(__panelQA.doc().blocks.map(b=>b.position))'),before,'dragging a pin moves nothing');
  if(await has('#lienzo-interactive-comment-thread'))await key('Escape','Escape');
  // The thread with the person and the agent.
  const noteThread=await ev('__panelQA.comments().threads.find(t=>t.anchor.id==="note").id');
  await click('#lienzo-interactive-comment-pin-'+noteThread);await wait('!!document.querySelector("#lienzo-interactive-comment-thread")');
  const text=await ev('document.querySelector("#lienzo-interactive-comment-thread").innerText');
  assert.match(text,/by your agent/);assert.match(text,/Example agent/);assert.match(text,/On “Nota de prueba”/);
  await shot('thread');
  await type('Example: thanks, that works.');await key('Enter','Enter');
  await wait('__panelQA.comments().threads.find(t=>t.anchor.id==="note").messages.length===3','reply with Enter');
  assert.ok(await has('#lienzo-interactive-comment-thread'),'the thread stays open after a reply');
  await key('Escape','Escape');await wait('!document.querySelector("#lienzo-interactive-comment-thread")','Esc closes');
  // C, then an empty spot: a new comment there.
  await key('c','KeyC');await wait('!!document.querySelector("#lienzo-comment-surface")','C starts the Comment tool');
  const spot=await ev('(()=>{const t=document.querySelector("#lienzo-toolbar").getBoundingClientRect();for(const [x,y] of [[innerWidth*.62,innerHeight*.22],[innerWidth*.5,innerHeight*.18],[innerWidth*.3,innerHeight*.72]]){const e=document.elementsFromPoint(x,y).find(e=>e.id&&e.id.startsWith("lienzo-entity-"));if(!e&&y<t.top-40)return{x,y};}return{x:innerWidth*.62,y:innerHeight*.22}})()');
  {const card=await rect('#lienzo-entity-server');await mouse('mouseMoved',card.x+card.w*.4,card.y+card.h*.6);await pause(200);await shot('placing');}
  await mouse('mouseMoved',spot.x,spot.y);await pause(150);await tap(spot.x,spot.y);await wait('!!document.querySelector("#lienzo-comment-new")','draft opens');
  await type('Example: a free note on the canvas.');await shot('draft');await key('Enter','Enter');
  await wait('__panelQA.comments().threads.length===6','a new thread');
  assert.equal(await ev('__panelQA.comments().threads.at(-1).anchor.kind'),'point');
  await key('Escape','Escape');
  // The list: open and resolved, then jump to one.
  await click(L('Comments'));await wait('!!document.querySelector("#lienzo-comments-list")','the list');await pause(400);await shot('list');
  await ev('[...document.querySelectorAll("#lienzo-comments-list [role=button],#lienzo-comments-list [role=radio],#lienzo-comments-list button,#lienzo-comments-list div")].find(e=>/^Resolved/.test(e.innerText||"")&&e.childElementCount<3)?.click()');await pause(500);
  assert.match(await ev('document.querySelector("#lienzo-comments-list").innerText'),/rename to Edge server/);
  await shot('list-resolved');
  const resolvedId=await ev('__panelQA.comments().threads.find(t=>t.status==="resolved").id');
  await click('#lienzo-comment-row-'+resolvedId);await wait('!!document.querySelector("#lienzo-interactive-comment-thread")','jump opens the thread');await pause(700);await shot('jump');
  await key('Escape','Escape');
  // Hide pins.
  await click(L('Hide pins'));await wait('document.querySelectorAll("[id^=lienzo-interactive-comment-pin-]").length===0','pins hide');
  await click(L('Show pins'));await wait('document.querySelectorAll("[id^=lienzo-interactive-comment-pin-]").length>0','pins show');
 }else{
  // Compact: the list is the way in; a thread opens inline with its reply box.
  await click(L('Search and commands'));await wait('!!document.querySelector("#lienzo-palette-input")');await type('Comments');await pause(300);await key('Enter','Enter');
  await wait('!!document.querySelector("#lienzo-comments-list")','compact list');await pause(400);await shot('list');
  const noteThread=await ev('__panelQA.comments().threads.find(t=>t.anchor.id==="note").id');
  await click('#lienzo-comment-row-'+noteThread);await wait('!!document.querySelector("#lienzo-comment-reply-'+noteThread+'")','inline thread');await shot('thread');
 }
 assert.deepEqual(await ev('__panelQA.actions'),[],'nothing was sent to an agent');
 assert.deepEqual(uncaught.map(u=>u.exception?.description||u.text),[],'something threw');assert.ok(!/Plugin failed|Minified React/.test(await ev('document.body.innerText')));
 console.log('PASS comments '+theme+' '+W+(compact?' compact':'')+'\n'+shots.join('\n'));
 }finally{ws.close();}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
