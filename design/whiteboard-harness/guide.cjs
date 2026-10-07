// Run only inside an isolated omabox against the production Panel bundle.
const assert = require('node:assert/strict'), fs = require('node:fs');
(async () => {
  const pages = await (await fetch('http://127.0.0.1:9222/json/list')).json();
  const page = pages.find(p => p.type === 'page' && p.url.startsWith('http://127.0.0.1:8765/'));
  assert.ok(page, 'The QA page is open');
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((ok, fail) => { socket.addEventListener('open', ok, { once: true }); socket.addEventListener('error', fail, { once: true }); });
  let id = 0; const pending = new Map(), checks = [], errors = [];
  socket.addEventListener('message', event => { const result = JSON.parse(event.data); if (result.method === 'Runtime.exceptionThrown') errors.push(result.params.exceptionDetails); if (result.id) { const p = pending.get(result.id); if (!p) return; pending.delete(result.id); clearTimeout(p.timer); result.error ? p.fail(Error(JSON.stringify(result.error))) : p.ok(result.result); } });
  const call = (method, params = {}) => new Promise((ok, fail) => { const key = ++id, timer = setTimeout(() => { pending.delete(key); fail(Error('Timeout ' + method)); }, 15000); pending.set(key, { ok, fail, timer }); socket.send(JSON.stringify({ id: key, method, params })); });
  const read = async expression => { const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw Error(JSON.stringify(result.exceptionDetails)); return result.result.value; };
  const wait = async expression => { for (let n = 0; n < 120; n++) { if (await read(expression)) return; await new Promise(ok => setTimeout(ok, 50)); } throw Error('Not ready: ' + expression); };
  const label = text => '[aria-label=' + JSON.stringify(text) + ']';
  const click = async selector => { await wait('!!document.querySelector(' + JSON.stringify(selector) + ')'); const box = await read('(()=>{const e=document.querySelector(' + JSON.stringify(selector) + ');e.scrollIntoView({block:"nearest"});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()'); for (const type of ['mousePressed', 'mouseReleased']) await call('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', buttons: type === 'mousePressed' ? 1 : 0, clickCount: 1 }); };
  const search = async text => { await click(label('Buscar en la guía')); await read('document.activeElement.select()'); await call('Input.insertText', { text }); await wait('document.querySelector(' + JSON.stringify(label('Buscar en la guía')) + ')?.value===' + JSON.stringify(text)); };
  const shot = async name => { const result = await call('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync('/tmp/lienzo-guide-' + name + '.png', Buffer.from(result.data, 'base64')); };
  const check = async (name, run) => { await run(); checks.push({ name, result: 'pass' }); console.log('PASS ' + name); };
  const open = async compact => { await call('Emulation.setDeviceMetricsOverride', { width: compact ? 390 : 1440, height: compact ? 844 : 1000, deviceScaleFactor: 1, mobile: false }); await call('Page.navigate', { url: 'http://127.0.0.1:8765/?theme=' + (compact ? 'tinta&compact=1' : 'papel') }); await wait('!!document.querySelector("#lienzo-composer")'); await click(compact ? label('Más acciones') : '#lienzo-document-island ' + label('Más acciones')); await click(label('Guía de Lienzo')); await wait('document.body.innerText.includes("Recorrido")'); };
  try {
    await call('Runtime.enable'); await call('Page.enable'); await call('Network.setCacheDisabled', { cacheDisabled: true });
    await check('The guide opens from the real Panel menu and offers tour and searchable options', async () => { await open(false); assert.ok(await read('document.body.innerText.includes("Todas las opciones")')); });
    await click(label('Todas las opciones'));
    await check('Searching finds the shader entry and its static alternative, and hides unrelated entries', async () => { await search('shader'); await wait('document.body.innerText.includes("alternativa estática")'); assert.equal(await read('document.body.innerText.includes("Flujo animado")'), false); await shot('shader'); });
    await check('Searching finds learner-only stroke reset and anchoring', async () => { await search('trazos'); await wait('document.body.innerText.includes("Borrar mis trazos conserva")'); assert.ok(await read('document.body.innerText.includes("el dibujo la sigue")')); });
    await check('Compact dark guide keeps its search usable and the modal within the viewport', async () => { await open(true); await click(label('Todas las opciones')); await search('shader'); await wait('document.body.innerText.includes("alternativa estática")'); const bounds = await read('(()=>{const r=document.querySelector("[role=dialog]").getBoundingClientRect();return{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:innerWidth,height:innerHeight}})()'); assert.ok(bounds.left >= 0 && bounds.right <= bounds.width && bounds.top >= 0 && bounds.bottom <= bounds.height); await shot('compact'); });
    assert.deepEqual(errors, []); checks.push({ name: 'No uncaught page errors', result: 'pass' });
  } finally { fs.writeFileSync('/tmp/lienzo-guide-results.json', JSON.stringify({ checks, errors }, null, 2)); socket.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
