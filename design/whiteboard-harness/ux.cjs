// UX overhaul (example data): a person edits each overhauled block by hand through Properties and the canvas, with no
// JSON. Checklist rows and the inline add row, node status chips, kind suggestions and renaming in place, the file tree
// editor, Controls making variables (number and on/off) and moving them, flow events along a real link with seconds,
// the Lienzo's Variables section and the raw JSON disclosure. Usage: node ux.cjs [oscuro|papel]
const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const theme=process.argv[2]||'oscuro',out=process.env.LIENZO_SHOTS||'/tmp';
// Other agents may run the harness at the same time: LIENZO_CDP and LIENZO_HTTP pick other ports.
const cdp=process.env.LIENZO_CDP||'9222',origin=`http://127.0.0.1:${process.env.LIENZO_HTTP||'8765'}/`;
(async()=>{
 const pages=await(await fetch(`http://127.0.0.1:${cdp}/json/list`)).json();
 const page=pages.find(p=>p.type==='page'&&p.url.startsWith(origin))??pages.find(p=>p.type==='page');if(!page)throw Error('QA page missing');
 const ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((ok,no)=>{ws.addEventListener('open',ok,{once:true});ws.addEventListener('error',no,{once:true});});
 let seq=0;const pending=new Map(),uncaught=[];
 ws.addEventListener('message',e=>{const r=JSON.parse(e.data);if(r.method==='Runtime.exceptionThrown')uncaught.push(r.params.exceptionDetails);if(r.id){const p=pending.get(r.id);if(!p)return;pending.delete(r.id);r.error?p.no(Error(JSON.stringify(r.error))):p.ok(r.result);}});
 const call=(method,params={})=>new Promise((ok,no)=>{const id=++seq;pending.set(id,{ok,no});ws.send(JSON.stringify({id,method,params}));});
 const ev=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails).slice(0,600));return r.result?.value;};
 const sleep=ms=>new Promise(r=>setTimeout(r,ms));
 const wait=async(expression,what=expression)=>{for(let n=0;n<120;n++){if(await ev(expression))return;await sleep(50);}throw Error('Timed out: '+what);};
 const mouse=(type,x,y,button='left',buttons=0,clickCount=1)=>call('Input.dispatchMouseEvent',{type,x,y,button,buttons,clickCount});
 const at=sel=>ev(`(()=>{const e=document.querySelector(${JSON.stringify(sel)});if(!e)throw Error('Missing '+${JSON.stringify(sel)});if(e.closest('#lienzo-properties,#lienzo-properties-document'))e.scrollIntoView({block:'center',inline:'nearest'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
 const click=async(sel,pause=250)=>{const p=await at(sel);await mouse('mouseMoved',p.x,p.y);await mouse('mousePressed',p.x,p.y,'left',1);await mouse('mouseReleased',p.x,p.y);await sleep(pause);};
 const key=async(k,code=k,vk=0,modifiers=0)=>{await call('Input.dispatchKeyEvent',{type:'keyDown',key:k,code,windowsVirtualKeyCode:vk,modifiers});await call('Input.dispatchKeyEvent',{type:'keyUp',key:k,code,windowsVirtualKeyCode:vk,modifiers});};
 const enter=async()=>{await call('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13,text:'\r'});await call('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await sleep(250);};
 const type=async(sel,text,replace=true)=>{await click(sel,120);if(replace){await ev(`(()=>{const e=document.activeElement;if(e&&e.select)e.select();})()`);}await call('Input.insertText',{text});await sleep(120);};
 const data=id=>ev(`__panelQA.doc().blocks.find(b=>b.id===${JSON.stringify(id)})?.data`);
 const shot=async name=>{const r=await call('Page.captureScreenshot',{format:'png'});const file=path.join(out,`ux-${name}-${theme}.png`);fs.writeFileSync(file,Buffer.from(r.data,'base64'));console.log('shot',file);};
 const prop=(scope,sel)=>`${scope} ${sel}`;
 const corner=id=>ev(`(()=>{const e=document.querySelector('#lienzo-grab-${id}-header')||document.querySelector('#lienzo-grab-${id}')||document.querySelector('#lienzo-entity-${id}');const r=e.getBoundingClientRect();return{x:r.x+Math.min(60,r.width/2),y:r.y+Math.min(10,r.height/2)}})()`);
 const select=async id=>{const c=await corner(id);await mouse('mouseMoved',c.x,c.y);await mouse('mousePressed',c.x,c.y,'left',1);await mouse('mouseReleased',c.x,c.y);await sleep(500);await wait(`__panelQA.doc().selectedIds.includes(${JSON.stringify(id)})`,'select '+id);await sleep(300);};
 try{
 await call('Runtime.enable');await call('Page.enable');await call('Network.setCacheDisabled',{cacheDisabled:true});
 await call('Page.navigate',{url:origin+'?theme='+theme});await wait('!!document.querySelector("#lienzo-entity-note")');
 await ev(`__panelQA.seed([
  {type:'group.create',group:{id:'physics',title:'Example: physics',description:'',blockIds:[],groupIds:[],position:{x:60,y:560},layout:{mode:'stack'}}},
  {type:'block.create',block:{id:'ctrl',typeId:'controls',title:'Example: controls',parentGroupId:'physics',data:{variables:[]}}},
  {type:'block.create',block:{id:'list',typeId:'checklist',title:'Example: launch steps',position:{x:560,y:80},data:{items:[]}}},
  {type:'block.create',block:{id:'api',typeId:'node',title:'Example: API',position:{x:940,y:80},data:{summary:'Example: takes orders'}}},
  {type:'block.create',block:{id:'db',typeId:'node',title:'Example: Database',position:{x:940,y:300},data:{summary:'Example: keeps them'}}},
  {type:'link.create',link:{id:'l1',from:'api',to:'db',kind:'flow'}},
  {type:'block.create',block:{id:'tree',typeId:'file-tree',title:'Example: repository',position:{x:960,y:420},data:{root:'project/',entries:[{path:'src/',note:'code'},{path:'src/index.ts',note:'entry point'},{path:'README.md',note:'how to start'}]}}},
  {type:'block.create',block:{id:'flow',typeId:'animated-flow',title:'Example: an order travels',position:{x:560,y:420},data:{events:[],duration:10000,travelMs:1000,links:{}}}}])`);
 await wait('!!document.querySelector("#lienzo-entity-flow")');await sleep(600);await click('[aria-label="Fit all"]',800);

 // Checklist: rows in Properties, a tick, then the add row on the card itself.
 await select('list');
 for(const item of['Write the brief','Book the room','Send invites']){await type(prop('#lienzo-properties-checklist','[aria-label="Add an item"]'),item);await enter();}
 await wait(`__panelQA.doc().blocks.find(b=>b.id==='list').data.items.length===3`,'three items');
 await click(prop('#lienzo-properties-checklist','[aria-label="Done: Write the brief"]'));
 await wait(`__panelQA.doc().blocks.find(b=>b.id==='list').data.items[0].done===true`,'tick');
 await type('#lienzo-checklist-add input','Celebrate');await enter();
 await wait(`__panelQA.doc().blocks.find(b=>b.id==='list').data.items.length===4`,'inline add');
 assert.deepEqual((await data('list')).items.map(i=>i.label),['Write the brief','Book the room','Send invites','Celebrate']);
 await click(prop('#lienzo-properties-checklist','[aria-label="Item 2"]'));await sleep(200);await shot('checklist');
 await click(prop('#lienzo-properties-checklist','[aria-label="Move down"]'));
 await wait(`__panelQA.doc().blocks.find(b=>b.id==='list').data.items[2].label==='Book the room'`,'reorder');

 // Node: a status chip, a kind from the suggestions, then rename in place with a double press.
 await select('api');
 await click('#lienzo-properties-content [aria-label="In progress"]');
 await wait(`__panelQA.doc().blocks.find(b=>b.id==='api').data.status==='In progress'`,'status');
 await click('#lienzo-properties-content input[aria-label="Kind"]');await sleep(200);
 await click('#lienzo-properties-content [aria-label="Service"]');
 await wait(`__panelQA.doc().blocks.find(b=>b.id==='api').data.kind==='Service'`,'kind');
 const p=await at('#lienzo-entity-api');for(let n=0;n<2;n++){await mouse('mousePressed',p.x,p.y,'left',1,n+1);await mouse('mouseReleased',p.x,p.y,'left',0,n+1);await sleep(120);}
 await wait('!!document.querySelector("#lienzo-title-editor")','title editor');
 await ev(`document.querySelector('#lienzo-title-editor').select()`);await call('Input.insertText',{text:'Example: Orders API'});await enter();
 await wait(`__panelQA.doc().blocks.find(b=>b.id==='api').title==='Example: Orders API'`,'rename in place');
 await sleep(300);await shot('node');

 // File tree: add a folder, name it, add a file inside, give it a note, highlight it.
 await select('tree');
 await click('#lienzo-properties-file-tree [aria-label="Folder"]');
 await type('#lienzo-properties-file-tree [aria-label="Name of folder"]','docs');
 await click('#lienzo-properties-file-tree [aria-label="File"]');
 await type('#lienzo-properties-file-tree [aria-label="Name of file.txt"]','guide.md');
 await type('#lienzo-properties-file-tree [aria-label="Note on guide.md"]','how the team writes');
 await click('#lienzo-properties-file-tree [aria-label="Highlight"]');
 await wait(`(()=>{const e=__panelQA.doc().blocks.find(b=>b.id==='tree').data.entries;return e.some(x=>x.path==='docs/')&&e.some(x=>x.path==='docs/guide.md'&&x.note==='how the team writes'&&x.highlight)})()`,'tree entries');
 await sleep(300);await shot('file-tree');

 // Controls: make a number variable on the Frame and an on/off one on the Lienzo, edit the range, move them.
 await select('ctrl');
 await click('[aria-label="New variable"]');await type('[aria-label="Label of the new variable"]','Speed');await click('#lienzo-controls-new [aria-label="Create"]',500);
 await wait(`(()=>{const d=__panelQA.doc();return d.groups.find(g=>g.id==='physics').variables?.[0]?.name==='speed'&&d.blocks.find(b=>b.id==='ctrl').data.variables.includes('speed')})()`,'speed declared and shown');
 await click('[aria-label="New variable"]');await type('[aria-label="Label of the new variable"]','Show trail');
 await click('#lienzo-controls-new [aria-label="On / off"]');await click('#lienzo-controls-new [aria-label="The Lienzo"]');await click('#lienzo-controls-new [aria-label="Create"]',500);
 await wait(`(()=>{const d=__panelQA.doc();return d.variables?.some(v=>v.name==='show_trail'&&v.type==='boolean')&&d.blocks.find(b=>b.id==='ctrl').data.variables.join()==='speed,show_trail'})()`,'switch declared on the Lienzo');
 await click('[aria-label="Speed: edit"]');
 await type('#lienzo-properties-controls input[aria-label="Highest"]','120');await type('#lienzo-properties-controls input[aria-label="Unit"]','km/h');
 await wait(`(()=>{const v=__panelQA.doc().groups.find(g=>g.id==='physics').variables[0];return v.max===120&&v.unit==='km/h'})()`,'range edited');
 await click('#lienzo-entity-ctrl [aria-label="Show trail"]',400);
 await wait(`__panelQA.runtime().scopes.$document?.show_trail===1`,'switch moved');
 await sleep(400);await shot('controls');

 // Animated flow: an event along the real link, as a value, and the duration in seconds.
 await select('flow');
 await click('#lienzo-properties-flow-events [aria-label="Add event"]');
 await wait(`!!__panelQA.doc().blocks.find(b=>b.id==='flow').data.events[0]?.linkId`,'event on a link');
 await click('#lienzo-properties-flow-events [aria-label^="Event 1 link"]');
 await click('#lienzo-properties-flow-events [aria-label="Example: Orders API → Example: Database"]');
 await wait(`(()=>{const e=__panelQA.doc().blocks.find(b=>b.id==='flow').data.events[0];return e.linkId==='l1'&&e.from==='api'&&e.to==='db'})()`,'event moved to the picked link');
 await click('#lienzo-properties-flow-events [aria-label="Value"]');
 await type('#lienzo-properties-flow-events [aria-label="Event 1 carries"]','5');
 await wait(`__panelQA.doc().blocks.find(b=>b.id==='flow').data.events[0].payload===5`,'numeric payload');
 await type('#lienzo-properties-content input[aria-label="Seconds"]','4');
 await wait(`__panelQA.doc().blocks.find(b=>b.id==='flow').data.duration===4000`,'duration in seconds');
 await sleep(300);await shot('flow');

 // Shader parameters: add one, rename it, and the code declares it under its new name.
 await ev(`__panelQA.seed([{type:'block.create',block:{id:'shader',typeId:'glsl-shader',title:'Example: stripes',position:{x:1240,y:60},data:__panelQA.catalog.blockTypes.find(t=>t.id==='glsl-shader').defaults}}])`);
 await wait('!!document.querySelector("#lienzo-entity-shader")');await click('[aria-label="Fit all"]',900);
 await select('shader');
 await click('#lienzo-properties-glsl-uniforms [aria-label="Add parameter"]');
 await wait(`/uniform float param2;/.test(__panelQA.doc().blocks.find(b=>b.id==='shader').data.fragmentSource)`,'parameter declared');
 await type('#lienzo-properties-glsl-uniforms [aria-label="Parameter label"]','Contrast');
 await type('#lienzo-properties-glsl-uniforms [aria-label="Parameter name in code"]','contrast');
 await wait(`(()=>{const d=__panelQA.doc().blocks.find(b=>b.id==='shader').data;return d.uniforms[1]?.name==='contrast'&&d.uniforms[1].label==='Contrast'&&/uniform float contrast;/.test(d.fragmentSource)&&!/param2/.test(d.fragmentSource)})()`,'parameter renamed in the code');
 await sleep(300);await shot('shader');

 // Raw JSON for a node, applied as a whole.
 await select('db');
 await click('#lienzo-properties-content [aria-label="Raw data (JSON)"]');
 await type('#lienzo-properties-raw textarea','{"summary":"Example: keeps every order","status":"Done"}');
 await click('#lienzo-properties-raw [aria-label="Apply"]',500);
 await wait(`(()=>{const d=__panelQA.doc().blocks.find(b=>b.id==='db').data;return d.status==='Done'&&d.summary==='Example: keeps every order'})()`,'raw apply');
 await shot('raw');

 // The Lienzo's Variables: the switch made from Controls is there; add a choice.
 await key('Escape','Escape',27);await sleep(300);await ev(`__panelQA.doc().selectedIds.length`)&&await key('Escape','Escape',27);
 await click('[aria-label="Properties"]',600);
 await wait('!!document.querySelector("#lienzo-variables-document")','Lienzo variables');
 const listed=await ev(`document.querySelector('#lienzo-variables-document').innerText`);assert.match(listed,/Show trail/);
 await click('#lienzo-variables-document [aria-label="Choice"]',600);
 await wait(`__panelQA.doc().variables.some(v=>v.type==='choice'&&v.options.length===3)`,'choice declared');
 await sleep(300);await shot('lienzo-variables');
 assert.equal(await ev('__panelQA.actions.length'),0,'nothing sent to an agent');
 assert.deepEqual(uncaught.map(u=>u.exception?.description??u.text),[]);
 console.log(`PASS ux overhaul (${theme}): every overhauled block edited by hand, no JSON typed except the raw disclosure`);
 }finally{ws.close();}
})().catch(e=>{console.error(e.stack);process.exitCode=1;});
