// UI fixes, October 2026 (docs/design.md §36): the add sheets with live link previews, Import SVG as tabs, the icon
// library (offline Lucide and Iconify search), the shader block without forced chrome, and screens that fit their
// content. Example data only. Run with: node ui-fixes.cjs [oscuro|papel] [sheets,icons,shader,screens]. Captures go to
// $LIENZO_SHOTS (default /tmp)/lienzo-ui-<theme>-*.png. Online steps (thumbnails, oEmbed, Iconify) need the network
// and are skipped with a note when it is not there.
const assert=require('node:assert/strict');const fs=require('node:fs');
(async()=>{
 const theme=process.argv[2]||'oscuro',parts=(process.argv[3]||'sheets,icons,shader,screens').split(','),out=(process.env.LIENZO_SHOTS||'/tmp')+'/lienzo-ui-'+(theme==='papel'?'light':'dark')+'-';
 const W=1280,H=800;
 const pages=await(await fetch('http://127.0.0.1:9222/json/list')).json();
 const page=pages.find(p=>p.type==='page'&&p.url.startsWith('http://127.0.0.1:8765/'));if(!page)throw Error('QA page missing');
 const ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((ok,no)=>{ws.addEventListener('open',ok,{once:true});ws.addEventListener('error',no,{once:true});});
 let seq=0;const pending=new Map(),uncaught=[];
 ws.addEventListener('message',e=>{const r=JSON.parse(e.data);if(r.method==='Runtime.exceptionThrown')uncaught.push(r.params.exceptionDetails);if(r.id){const p=pending.get(r.id);if(!p)return;pending.delete(r.id);r.error?p.no(Error(JSON.stringify(r.error))):p.ok(r.result);}});
 const call=(method,params={})=>new Promise((ok,no)=>{const id=++seq;pending.set(id,{ok,no});ws.send(JSON.stringify({id,method,params}));});
 const ev=async expression=>{const r=await call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error(JSON.stringify(r.exceptionDetails));return r.result?.value;};
 const pause=ms=>new Promise(r=>setTimeout(r,ms));
 const wait=async(expression,what=expression,tries=160)=>{for(let n=0;n<tries;n++){if(await ev(expression))return true;await pause(50);}throw Error('Condition timed out: '+what);};
 const mouse=(type,x,y,buttons=0)=>call('Input.dispatchMouseEvent',{type,x,y,button:'left',buttons,clickCount:1});
 const tap=async(x,y)=>{await mouse('mouseMoved',x,y);await mouse('mousePressed',x,y,1);await mouse('mouseReleased',x,y);await pause(250);};
 const q=s=>JSON.stringify(s);
 const rect=sel=>ev(`(()=>{const e=document.querySelector(${q(sel)});if(!e)return null;const r=e.getBoundingClientRect();return{x:r.x,y:r.y,w:r.width,h:r.height}})()`);
 const click=async sel=>{await wait(`!!document.querySelector(${q(sel)})`,sel);const r=await rect(sel);await tap(r.x+r.w/2,r.y+r.h/2);};
 const hover=async sel=>{const r=await rect(sel);if(!r)throw Error('Missing '+sel);await mouse('mouseMoved',r.x+r.w/2,r.y+r.h/2);await pause(300);};
 const key=async(key,code,modifiers=0,text)=>{await call('Input.dispatchKeyEvent',{type:'keyDown',key,code,modifiers,text});await call('Input.dispatchKeyEvent',{type:'keyUp',key,code,modifiers});await pause(220);};
 const type=async text=>{await call('Input.insertText',{text});await pause(300);};
 const has=sel=>ev(`!!document.querySelector(${q(sel)})`);
 const text=sel=>ev(`document.querySelector(${q(sel)})?.innerText??''`);
 const setField=async(sel,value)=>{await ev(`(()=>{const e=document.querySelector(${q(sel)});const proto=e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(e,${q(value)});e.dispatchEvent(new Event('input',{bubbles:true}));})()`);await pause(350);};
 const shots=[];const shot=async name=>{await pause(350);const r=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(out+name+'.png',Buffer.from(r.data,'base64'));shots.push(out+name+'.png');};
 const online=await fetch('https://api.iconify.design/collections?prefixes=lucide').then(r=>r.ok).catch(()=>false);
 const openCatalog=async name=>{await click('#lienzo-tool-add');await wait('!!document.querySelector("#lienzo-add-menu")');await setField('#lienzo-add-search',name.replace('…',''));await click(`#lienzo-add-menu [role=menuitem][aria-label=${q(name)}]`);};
 try{
 await call('Runtime.enable');await call('Page.enable');
 await call('Emulation.setDeviceMetricsOverride',{width:W,height:H,deviceScaleFactor:1,mobile:false});
 await call('Page.navigate',{url:'http://127.0.0.1:8765/?theme='+theme});await wait('!!document.querySelector("#lienzo-toolbar")');await pause(700);
 if(parts.includes('sheets')){
  // Window: empty, a page, a site that refuses frames, then add one.
  await openCatalog('Window');await wait('!!document.querySelector("#lienzo-sheet-page")');
  assert.match(await text('#lienzo-sheet-page'),/Link/);assert.match(await text('#lienzo-sheet-page'),/Optional/);
  assert.equal(await ev('document.activeElement?.id'),'lienzo-sheet-url','the link field is focused');
  await shot('window-empty');
  await type('github.com/Gabsplat/paseo-canvas');await wait('!!document.querySelector("#lienzo-sheet-warning")');assert.match(await text('#lienzo-sheet-warning'),/does not let other apps/);await shot('window-refused');
  await setField('#lienzo-sheet-url','https://example.org/docs');await wait('!document.querySelector("#lienzo-sheet-warning")');await click('#lienzo-sheet-caption');await type('Example docs');await shot('window-page');
  const before=await ev('__panelQA.doc().blocks.length');await key('Enter','Enter',0,'\r');await wait('!document.querySelector("#lienzo-sheet-page")','Enter adds and closes');
  await wait(`__panelQA.doc().blocks.length===${before+1}`);const added=await ev('__panelQA.doc().blocks.at(-1)');assert.equal(added.typeId,'preview');assert.equal(added.title,'Example docs');assert.equal(added.data.url,'https://example.org/docs');
  // Video: a YouTube link shows its thumbnail and title (network), Escape closes.
  await openCatalog('Video');await wait('!!document.querySelector("#lienzo-sheet-video")');await type('https://www.youtube.com/watch?v=aqz-KE-bpKQ');await wait('!!document.querySelector("#lienzo-sheet-note")');
  assert.match(await text('#lienzo-sheet-preview'),/YouTube · Video/);
  if(online){await wait(`!document.querySelector("#lienzo-sheet-preview").innerText.includes("YouTube video")`,'oEmbed title',100).catch(()=>console.log('note: no oEmbed title'));await pause(900);}
  await shot('video-youtube');await key('Escape','Escape');await wait('!document.querySelector("#lienzo-sheet-video")','Escape closes');
  // Image: a page link warns; an image link shows the image itself.
  await openCatalog('Image');await wait('!!document.querySelector("#lienzo-sheet-image")');await type('https://example.org/gallery');await wait('!!document.querySelector("#lienzo-sheet-warning")');await shot('image-warning');
  await setField('#lienzo-sheet-url','https://upload.wikimedia.org/wikipedia/commons/4/47/PNG_transparency_demonstration_1.png');await pause(online?1800:400);await shot('image-preview');await key('Escape','Escape');
  await openCatalog('Audio');await wait('!!document.querySelector("#lienzo-sheet-audio")');await type('https://example.org/episodes/lienzo-01.mp3');await shot('audio');await key('Escape','Escape');
  // Import SVG: tabs, a live preview of pasted code, a refusal in words.
  await openCatalog('Import SVG…');await wait('!!document.querySelector("#lienzo-sheet-svg")');assert.ok(await has('#lienzo-svg-tab-code')&&await has('#lienzo-svg-tab-file')&&await has('#lienzo-svg-tab-url'));
  await setField('#lienzo-svg-code','<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M8 12h8M12 8v8"/></svg>');await shot('svg-code');
  await setField('#lienzo-svg-code','<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');await wait('!!document.querySelector("#lienzo-svg-problem")');await shot('svg-refused');
  await click('#lienzo-svg-tab-file');await shot('svg-file');await click('#lienzo-svg-tab-url');await shot('svg-url');await key('Escape','Escape');
 }
 if(parts.includes('icons')){
  await openCatalog('Icons');await wait('!!document.querySelector("#lienzo-icon-library")');await pause(300);await shot('icons');
  assert.ok(await ev('document.querySelectorAll("[id^=lienzo-library-icon-]").length')>=90,'a full first page');
  await type('data');await pause(500);await shot('icons-search');
  const first=await ev('document.querySelector("[id^=lienzo-library-icon-]")?.id');assert.ok(first);
  const before=await ev('__panelQA.doc().blocks.length');await click('#'+first.replace(/:/g,'\\:'));await wait(`__panelQA.doc().blocks.length===${before+1}`,'insert an icon');
  const block=await ev('__panelQA.doc().blocks.at(-1)');assert.equal(block.typeId,'wb-svg');assert.match(block.data.license,/ISC · Lucide/);
  await openCatalog('Icons');await wait('!!document.querySelector("#lienzo-icon-library")');await pause(300);await shot('icons-recent');
  if(online){await setField('#lienzo-icon-search','kubernetes');await wait('!!document.querySelector("[id^=lienzo-library-icon-iconify]")','online results',200);await pause(1200);await hover('[id^=lienzo-library-icon-iconify]');await shot('icons-online');}
  await key('Escape','Escape');
 }
 if(parts.includes('shader')){
  const frag='precision mediump float;\\nuniform vec2 u_resolution;\\nuniform float u_time;\\nuniform float speed;\\nvoid main(){vec2 uv=gl_FragCoord.xy/u_resolution;vec3 c=0.5+0.5*cos(u_time*speed+uv.xyx*3.0+vec3(0,2,4));gl_FragColor=vec4(c,1.0);}';
  const seeded=await ev(`(()=>{try{__panelQA.seed([{type:'block.create',block:{id:'shader-bare',typeId:'glsl-shader',title:'',position:{x:80,y:60},size:{width:520,height:360},data:{fragmentSource:"${frag}",uniforms:[{name:'speed',label:'Speed',min:0,max:3,value:1,step:0.1}],builtins:{resolution:true,time:true},autoplay:true}}},
   {type:'block.create',block:{id:'shader-titled',typeId:'glsl-shader',title:'Plasma (example)',position:{x:80,y:470},size:{width:320,height:200},data:{fragmentSource:"${frag}",uniforms:[{name:'speed',label:'Speed',min:0,max:3,value:1,step:0.1}],builtins:{resolution:true,time:true},showTitle:true,controls:'none'}}},
   {type:'block.create',block:{id:'shader-old',typeId:'glsl-shader',title:'Stripes (example)',position:{x:660,y:60},data:{question:'How does the spacing of the stripes change with the frequency?',fragmentSource:'precision mediump float;\\nuniform vec2 u_resolution;\\nuniform float frequency;\\nvoid main() {\\n  vec2 uv = gl_FragCoord.xy / u_resolution;\\n  float band = 0.5 + 0.5 * sin(uv.x * frequency * 6.283185);\\n  gl_FragColor = vec4(vec3(band), 1.0);\\n}',uniforms:[{name:'frequency',label:'Frequency',min:1,max:12,value:4,step:0.1}],builtins:{resolution:true,time:false},maxPixelSize:512,staticSummary:'Static reference: grey stripes.'}}}]);return 'ok'}catch(e){return String(e.message).slice(0,600)}})()`);assert.equal(seeded,'ok');
  await pause(800);await ev('document.querySelector("[aria-label=\\"Fit all\\"]")?.click()');await pause(1200);await shot('shader');
  await click('#lienzo-shader-shader-bare');await wait('!!document.querySelector("#lienzo-shader-shader-bare-overlay input")','overlay sliders on selection');await shot('shader-selected');
 }
 if(parts.includes('screens')){
  for(const [open,id,name] of [['Extensions','#lienzo-screen-extensions','extensions'],['History','#lienzo-screen-history','history']]){
   await click('#lienzo-document-island [aria-label="Menu"]');await click('#lienzo-interactive-menu [aria-label='+q(open)+']');await wait(`!!document.querySelector(${q(id)})`);await pause(600);await shot('screen-'+name);
   const r=await rect(id);console.log(name,'sheet',JSON.stringify(r));await key('Escape','Escape');await pause(300);
  }
 }
 assert.deepEqual(await ev('__panelQA.actions'),[],'nothing is sent to an agent');
 assert.equal(uncaught.length,0,JSON.stringify(uncaught[0]??''));
 console.log('ok',shots.join('\n'));
 }catch(e){await shot('failure').catch(()=>{});console.log('page errors',JSON.stringify(uncaught.slice(0,2)));throw e;}finally{ws.close();}
})().catch(e=>{console.error(e);process.exit(1);});
