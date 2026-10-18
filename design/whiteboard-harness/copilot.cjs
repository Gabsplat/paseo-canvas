// Copilot on the canvas (example data, a stand-in agent): Sheets menu and keys, following the agent, the glow, letting go by moving, and the way back.
// panel, run sandboxed, share the selection, edit only with permission, and an imported one must be granted first.
// Extension views are gone: nothing offers one. Nothing here reaches an assistant.
const assert=require('node:assert/strict');const fs=require('node:fs');
(async()=>{
 const pages=await(await fetch('http://127.0.0.1:9222/json/list')).json();
 const page=pages.find(p=>p.type==='page'&&p.url.startsWith('http://127.0.0.1:8765/'));if(!page)throw Error('QA page missing');
 const ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((ok,no)=>{ws.addEventListener('open',ok,{once:true});ws.addEventListener('error',no,{once:true});});
 let seq=0;const pending=new Map(),uncaught=[];
 ws.addEventListener('message',e=>{const r=JSON.parse(e.data);if(r.method==='Runtime.exceptionThrown')uncaught.push(r.params.exceptionDetails);if(r.id){const p=pending.get(r.id);if(!p)return;pending.delete(r.id);r.error?p.no(Error(JSON.stringify(r.error))):p.ok(r.result);}});
 const call=(method,params={})=>new Promise((ok,no)=>{const id=++seq;pending.set(id,{ok,no});ws.send(JSON.stringify({id,method,params}));});
 const ev=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result?.value;};
 const wait=async expression=>{for(let n=0;n<150;n++){if(await ev(expression))return;await new Promise(r=>setTimeout(r,50));}throw Error('Condition timed out: '+expression);};
 const mouse=(type,x,y,buttons=0)=>call('Input.dispatchMouseEvent',{type,x,y,button:'left',buttons,clickCount:1});
 const press=async(x,y)=>{await mouse('mouseMoved',x,y);await mouse('mousePressed',x,y,1);await mouse('mouseReleased',x,y);await new Promise(r=>setTimeout(r,900));};
 const click=async sel=>{const p=await ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)throw Error('Missing '+${JSON.stringify(sel)});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);await press(p.x,p.y);};
 const shot=async name=>{const r=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync('/tmp/lienzo-copilot-'+name+'.png',Buffer.from(r.data,'base64'));};

 const pause=ms=>new Promise(r=>setTimeout(r,ms));
 const has=sel=>ev('!!document.querySelector('+JSON.stringify(sel)+')');
 const key=(k,code,mods=0)=>call('Input.dispatchKeyEvent',{type:'keyDown',key:k,code,modifiers:mods,text:mods?undefined:k}).then(()=>call('Input.dispatchKeyEvent',{type:'keyUp',key:k,code,modifiers:mods}));
 const hojaLabel=()=>ev('document.querySelector("#lienzo-hoja-menu")?.getAttribute("aria-label")||""');
 const cam=()=>ev(`(()=>{const e=document.querySelector('#lienzo-entity-h2b0');if(!e)return null;const r=e.getBoundingClientRect();return Math.round(r.x)+','+Math.round(r.y)})()`);
 try{
 await call('Runtime.enable');await call('Page.enable');await call('Network.enable');await call('Network.setCacheDisabled',{cacheDisabled:true});
 await call('Page.navigate',{url:'http://127.0.0.1:8765/?theme='+(process.argv[2]||'oscuro')});await wait('!!document.querySelector("#lienzo-entity-note")');
 // Three Sheets the stand-in agent drew, left to right.
 await ev(`(()=>{const ops=[];for(let h=1;h<=3;h++){const ids=[];for(let i=0;i<3;i++){ids.push('h'+h+'b'+i);ops.push({type:'block.create',block:{id:'h'+h+'b'+i,typeId:'node',title:'Example step '+h+'.'+(i+1),data:{summary:'Example data.'}}});}
  ops.push({type:'group.create',group:{id:'hoja'+h,title:'Example Sheet '+h,description:'',blockIds:ids,groupIds:[],layout:{mode:'grid'},position:{x:200+(h-1)*900,y:900},sheet:{number:h,createdAt:'2026-10-12T00:00:00.000Z',source:'agent'}}});}__panelQA.seedAgent(ops);})()`);
 await wait('!!document.querySelector("#lienzo-entity-h3b2")');await pause(900);
 assert.ok(await has('#lienzo-hoja-menu'),'the Sheet menu is in the top island');assert.match(await hojaLabel(),/of 3$/);
 assert.ok(await ev('!!document.querySelector(\'[aria-label="Following the agent"]\')'),'following is on by default');await shot('start');
 // Sheet keys.
 const empty=async()=>{for(const [x,y] of [[1000,560],[1600,180],[300,250],[1500,820]]){if(await ev(`(()=>{const e=document.elementFromPoint(${x},${y});return !e?.closest('[id^="lienzo-entity-"],[id^="lienzo-tool"],[role=button]')})()`)){await call('Input.dispatchMouseEvent',{type:'mouseMoved',x,y});await call('Input.dispatchMouseEvent',{type:'mousePressed',x,y,button:'left',buttons:1,clickCount:1});await call('Input.dispatchMouseEvent',{type:'mouseReleased',x,y,button:'left',clickCount:1});await pause(200);return;}}};
 await empty();await key('[','BracketLeft');await pause(900);const first=await hojaLabel();
 await key(']','BracketRight');await pause(900);const second=await hojaLabel();assert.notEqual(first,second,'] moves to the next Sheet: '+first+' → '+second);
 await key('j','KeyJ',2);await wait('!!document.querySelector("#lienzo-hoja-list")');await shot('hoja-list');
 await ev('[...document.querySelectorAll("#lienzo-hoja-list [role=menuitem]")].at(-1).click()');await pause(900);assert.match(await hojaLabel(),/Sheet 3 of 3/);
 // ] above set following off; F turns it back on.
 await key('f','KeyF');await pause(300);assert.ok(await ev('!!document.querySelector(\'[aria-label="Following the agent"]\')'),'F follows again');
 // The agent adds something in Sheet 1 while we look at Sheet 3: the camera goes there and it glows.
 const before=await cam();await ev(`__panelQA.seedAgent([{type:'block.create',block:{id:'h1new',typeId:'node',title:'Example new step',data:{summary:'Just added by the stand-in agent.'},parentGroupId:'hoja1'}},{type:'group.update',id:'hoja1',patch:{blockIds:['h1b0','h1b1','h1b2','h1new']}}])`);
 await wait('!!document.querySelector("#lienzo-glow-h1new")');await pause(700);await shot('followed');assert.notEqual(await cam(),before,'the camera followed the agent');
 await wait('!document.querySelector("#lienzo-glow-h1new")');
 // Moving the camera yourself lets go; the next edit shows the pill instead of moving you.
 await call('Input.dispatchMouseEvent',{type:'mouseWheel',x:900,y:500,deltaX:300,deltaY:0});await pause(300);
 assert.ok(await ev('!!document.querySelector(\'[aria-label="Follow the agent"]\')'),'moving the camera lets go of the agent');
 const still=await cam();await ev(`__panelQA.seedAgent([{type:'block.update',id:'h2b1',patch:{title:'Example step 2.2, revised'}}])`);await wait('!!document.querySelector("#lienzo-agent-latest")');
 assert.equal(await cam(),still,'not following: the camera stays');await shot('pill');
 {const pill=await ev(`(()=>{const r=document.querySelector('#lienzo-agent-latest').getBoundingClientRect(),t=document.querySelector('#lienzo-toolbar').getBoundingClientRect();return{pill:r.bottom,toolbar:t.top,edge:innerHeight-t.bottom}})()`);
  assert.ok(pill.pill<=pill.toolbar-8,'the pill clears the toolbar: '+JSON.stringify(pill));assert.ok(Math.abs(pill.edge-12)<=2,'the toolbar is on the bottom edge: '+JSON.stringify(pill));
  assert.ok(!(await has('#lienzo-composer')),'no composer');}
 await click('#lienzo-agent-latest');await wait('!!document.querySelector("#lienzo-glow-h2b1")');await pause(600);await shot('latest');
 assert.ok(!(await has('#lienzo-agent-latest'))&&await ev('!!document.querySelector(\'[aria-label="Following the agent"]\')'),'the pill takes you there and follows again');
 // G goes to the latest too.
 await call('Input.dispatchMouseEvent',{type:'mouseWheel',x:900,y:500,deltaX:-600,deltaY:0});await pause(300);await key('g','KeyG');await wait('!!document.querySelector("#lienzo-glow-h2b1")');
 assert.deepEqual(uncaught.map(u=>u.exception?.description||u.text),[],'something threw');assert.ok(!/Plugin failed|Minified React/.test(await ev('document.body.innerText')));
 console.log('PASS Sheets, following the agent, glow, letting go and the way back');
 }finally{ws.close();}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
