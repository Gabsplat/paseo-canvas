// Run ONLY in an isolated omabox. Actual Chromium input, real RN-web Canvas/renderers/runtime.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const pause = ms => new Promise(r => setTimeout(r, ms));
const root = 'http://127.0.0.1:8765/';
(async () => {
  const pages = await (await fetch('http://127.0.0.1:9222/json/list')).json();
  const page = pages.find(p => p.type === 'page' && p.url.startsWith(root));
  assert.ok(page);
  const socket = new WebSocket(page.webSocketDebuggerUrl), pending = new Map(); let serial = 0;
  await new Promise(r => socket.addEventListener('open', r, { once: true }));
  socket.addEventListener('message', event => { const r = JSON.parse(event.data), p = pending.get(r.id); if (!p) return; pending.delete(r.id); clearTimeout(p.timer); r.error ? p.reject(Error(JSON.stringify(r.error))) : p.resolve(r.result); });
  const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++serial; pending.set(id, {resolve, reject, timer:setTimeout(() => reject(Error(method + ' timed out')), 10000)}); socket.send(JSON.stringify({id,method,params})); });
  const ev = async expression => { const r = await call('Runtime.evaluate', {expression, awaitPromise:true, returnByValue:true}); if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails)); return r.result.value; };
  const wait = async expression => { const until = Date.now()+5000; do { const value=await ev(expression); if(value) return value; await pause(40); } while(Date.now()<until); throw Error('Condition: '+expression); };
  const rect = async selector => { const r = await ev(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}); if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()`); assert.ok(r,selector); return r; };
  const label = text => `[aria-label=${JSON.stringify(text)}]`;
  const mouse = (type,x,y) => call('Input.dispatchMouseEvent',{type,x,y,button:'left',buttons:type==='mouseReleased'?0:1,clickCount:type==='mouseMoved'?0:1});
  const click = async selector => { const r=await rect(selector), x=r.x+r.width/2,y=r.y+r.height/2; await mouse('mousePressed',x,y);await mouse('mouseReleased',x,y);await pause(80); };
  const drag = async (r,dx,dy,during) => { const x=r.x+r.width/2,y=r.y+r.height/2;await mouse('mousePressed',x,y);for(let i=1;i<=10;i++){await mouse('mouseMoved',x+dx*i/10,y+dy*i/10);await pause(16)}if(during)await during();await mouse('mouseReleased',x+dx,y+dy);await pause(150); };
  const shot = async name => { const r=await call('Page.captureScreenshot',{format:'png'});fs.writeFileSync(`/tmp/lienzo-qa-${name}.png`,Buffer.from(r.data,'base64')); };
  const open = async (lesson,theme='papel',extra='') => { const query=`?theme=${theme}&lesson=${lesson}${extra}`;await call('Page.navigate',{url:root+query});await wait(`window.__lienzo && location.search === ${JSON.stringify(query)} && !!document.querySelector('[id^="lienzo-interactive-renderer-"]')`);await pause(350); };
  const checks=[],errors=[];
  const check = async (name,fn) => { try {await fn();checks.push({name,result:'pass'});console.log('PASS '+name);}catch(e){checks.push({name,result:'fail',error:e.message});console.log('FAIL '+name+': '+e.message);} };
  socket.addEventListener('message',event=>{const r=JSON.parse(event.data);if(r.method==='Runtime.exceptionThrown')errors.push(r.params.exceptionDetails);});
  await call('Runtime.enable'); await call('Network.enable');await call('Network.setCacheDisabled',{cacheDisabled:true});
  try {
    await check('Slider updates shared scope before transport acknowledgement; controls do not drag card',async()=>{
      await open('controls','papel','&runtimeLatency=2000');
      const r=await rect(label('Amplitud'));
      await drag({x:r.x+r.width*.2,y:r.y,width:1,height:r.height},r.width*.65,0,async()=>{
        assert.ok(await ev('window.__lienzo.runtime().scopes.$document.amplitude > 1'));
        assert.deepEqual(await ev('window.__lienzo.runtimeServer()'),{blocks:{},scopes:{}});
      });
      assert.equal(await ev('window.__lienzo.log.length'),0);
      await ev('window.__lienzo.flushRuntime()');assert.equal(await ev('window.__lienzo.doc().revision'),1);
      assert.ok(await ev('window.__lienzo.events.some(e=>e.action.kind.startsWith("controls."))'));
      await shot('controls-light');
      await click('#lienzo-interactive-renderer-controls '+label('Reiniciar'));
      await ev('window.__lienzo.flushRuntime()');
      assert.equal(await ev('window.__lienzo.runtime().scopes.$document?.amplitude ?? null'),null);
      assert.equal(await ev('window.__lienzo.doc().variables[0].value'),1);
      const card=await rect('#lienzo-interactive-renderer-controls');
      // Header is outside the isolated renderer, and remains a drag handle.
      await drag({x:card.x,y:card.y-25,width:card.width,height:1},90,40);
      await wait('window.__lienzo.log.length === 1');
      assert.equal(await ev('window.__lienzo.log[0].operations[0].type'),'entity.move');
      await open('controls','tinta'); await shot('controls-dark');
    });
    await check('Flow follows current SVG geometry during node drag and pauses',async()=>{
      await open('flow');await click(label('Reproducir'));await pause(450);await click(label('Pausar'));
      await wait(`!!document.querySelector('[data-lienzo-motion] [data-link-id="ruta"]')`);
      const token='[data-lienzo-motion] [data-link-id="ruta"]';
      const before=await ev(`document.querySelector(${JSON.stringify(token)}).getAttribute('transform')`);
      const node=await rect('#lienzo-grab-receiver');
      await drag(node,120,-60,async()=>assert.notEqual(await ev(`document.querySelector(${JSON.stringify(token)}).getAttribute('transform')`),before));
      assert.equal(await ev('window.__lienzo.runtime().blocks.flow.playing'),false);
      const time=await ev('window.__lienzo.runtime().blocks.flow.playhead');await pause(200);assert.equal(await ev('window.__lienzo.runtime().blocks.flow.playhead'),time);await shot('flow-paused');
      await click('#lienzo-interactive-renderer-flow '+label('Reiniciar'));assert.equal(await ev('window.__lienzo.doc().links.length'),1);
    });
    await check('Shader uses browser WebGL or honest fallback, uniform input and compiler error',async()=>{
      await open('shader');
      const gl=await ev('(()=>{const c=document.querySelector("canvas");const g=c?.getContext("webgl");if(!g)return null;const e=g.getExtension("WEBGL_debug_renderer_info");return {version:g.getParameter(g.VERSION),renderer:e?g.getParameter(e.UNMASKED_RENDERER_WEBGL):g.getParameter(g.RENDERER)};})()');
      console.log('WEBGL '+JSON.stringify(gl));checks.push({name:'WebGL environment',details:gl});
      const surface=await rect('#lienzo-interactive-surface-glsl-shader');
      const clip={x:surface.x,y:surface.y,width:surface.width,height:surface.height,scale:1};
      const beforeGL=(await call('Page.captureScreenshot',{format:'png',clip})).data;
      const r=await rect(label('Frecuencia'));await drag({x:r.x+r.width*.2,y:r.y,width:1,height:r.height},r.width*.4,0);
      assert.equal(await ev('window.__lienzo.log.length'),0);await pause(100);
      if(gl) assert.notEqual((await call('Page.captureScreenshot',{format:'png',clip})).data,beforeGL,'GL output pixels change with uniform');
      await shot('shader');
      if(gl){
        await ev('window.__lienzo.edit([{type:"block.update",id:"shader",patch:{data:{fragmentSource:"precision mediump float; uniform float frequency; uniform vec2 u_resolution; void main() { invalid_symbol; }"}}}],"Shader inválido de ejemplo")');
        await wait('document.body.innerText.includes("No se pudo compilar el shader")');await shot('shader-error');
      }else assert.ok(await ev('document.body.innerText.includes("WebGL")'));
    });
    fs.writeFileSync('/tmp/lienzo-qa-results.json',JSON.stringify({checks,uncaughtExceptions:errors},null,2));
    if(checks.some(c=>c.result==='fail')||errors.length)process.exitCode=1;
  }finally{socket.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
