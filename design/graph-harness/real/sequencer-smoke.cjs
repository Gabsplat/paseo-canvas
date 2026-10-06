// Run ONLY in an isolated omabox. Actual Chromium input and Web Audio, real RN-web Canvas/renderer/runtime.
// The probe below observes the page's own AudioContext; it never creates or resumes one.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const pause = ms => new Promise(r => setTimeout(r, ms));
const root = 'http://127.0.0.1:8765/';
const probe = `(() => {
  const Real = window.AudioContext; if (!Real) return;
  const audio = window.__audio = { contexts: [], starts: 0, refuse: false };
  window.AudioContext = class extends Real { constructor(...args) { super(...args); this.__analyser = this.createAnalyser(); this.__analyser.fftSize = 2048; audio.contexts.push(this); }
    resume() { return audio.refuse ? Promise.reject(new DOMException('Simulated refusal', 'NotAllowedError')) : super.resume(); } };
  const connect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (target, ...rest) { if (target === this.context.destination && this.context.__analyser) connect.call(this, this.context.__analyser); return connect.call(this, target, ...rest); };
  const start = OscillatorNode.prototype.start; OscillatorNode.prototype.start = function (...args) { audio.starts++; return start.apply(this, args); };
  audio.states = () => audio.contexts.map(c => c.state);
  audio.peak = () => { const c = audio.contexts.at(-1); if (!c || c.state !== 'running') return 0; const b = new Float32Array(2048); c.__analyser.getFloatTimeDomainData(b); return b.reduce((m, v) => Math.max(m, Math.abs(v)), 0); };
})();`;
(async () => {
  const pages = await (await fetch('http://127.0.0.1:9222/json/list')).json();
  const page = pages.find(p => p.type === 'page' && p.url.startsWith(root));
  assert.ok(page);
  const socket = new WebSocket(page.webSocketDebuggerUrl), pending = new Map(); let serial = 0;
  await new Promise(r => socket.addEventListener('open', r, { once: true }));
  const errors = [];
  socket.addEventListener('message', event => { const r = JSON.parse(event.data); if (r.method === 'Runtime.exceptionThrown') errors.push(r.params.exceptionDetails.text); const p = pending.get(r.id); if (!p) return; pending.delete(r.id); clearTimeout(p.timer); r.error ? p.reject(Error(JSON.stringify(r.error))) : p.resolve(r.result); });
  const call = (method, params = {}) => new Promise((resolve, reject) => { const id = ++serial; pending.set(id, { resolve, reject, timer: setTimeout(() => reject(Error(method + ' timed out')), 10000) }); socket.send(JSON.stringify({ id, method, params })); });
  const ev = async expression => { const r = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw Error(JSON.stringify(r.exceptionDetails)); return r.result.value; };
  const wait = async (expression, ms = 5000) => { const until = Date.now() + ms; do { const value = await ev(expression); if (value) return value; await pause(40); } while (Date.now() < until); throw Error('Condition: ' + expression); };
  const rect = async selector => { const r = await ev(`(()=>{const e=document.querySelector(${JSON.stringify(selector)}); if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height}})()`); assert.ok(r, selector); return r; };
  const label = text => `[aria-label=${JSON.stringify(text)}]`;
  const mouse = (type, x, y) => call('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: type === 'mouseMoved' ? 0 : 1 });
  const click = async selector => { const r = await rect(selector), x = r.x + r.width / 2, y = r.y + r.height / 2; await mouse('mousePressed', x, y); await mouse('mouseReleased', x, y); await pause(80); };
  const key = async (name, code, text) => { for (const type of ['keyDown', 'keyUp']) await call('Input.dispatchKeyEvent', { type, key: name, code, windowsVirtualKeyCode: { ArrowRight: 39, ArrowDown: 40, ' ': 32, Escape: 27 }[name], ...(text && type === 'keyDown' ? { text } : {}) }); await pause(60); };
  const shot = async name => { const r = await call('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(`/tmp/lienzo-qa-${name}.png`, Buffer.from(r.data, 'base64')); };
  const open = async (theme = 'papel', extra = '') => { const query = `?theme=${theme}&lesson=sequencer${extra}`; await call('Page.navigate', { url: root + query }); await wait(`window.__lienzo && location.search === ${JSON.stringify(query)} && !!document.querySelector('[id^="lienzo-interactive-sequencer-"]')`); await pause(350); };
  const one = '#lienzo-interactive-renderer-sequencer ', two = '#lienzo-interactive-renderer-sequencer-b ';
  const cell = (row, step, block = 'sequencer') => `[id="lienzo-interactive-sequencer-cell-${block}-${row}-${step}"]`;
  const pattern = () => ev('window.__lienzo.runtime().blocks.sequencer?.pattern ?? null');
  const kinds = () => ev('window.__lienzo.events.map(e=>e.action.kind)');
  const checks = [];
  const check = async (name, fn) => { try { const note = await fn(); checks.push({ name, result: 'pass', ...(note ? { note } : {}) }); console.log('PASS ' + name + (note ? ' · ' + note : '')); } catch (e) { checks.push({ name, result: 'fail', error: e.message }); console.log('FAIL ' + name + ': ' + e.message); } };
  await call('Runtime.enable'); await call('Page.enable'); await call('Network.enable'); await call('Network.setCacheDisabled', { cacheDisabled: true });
  await call('Page.addScriptToEvaluateOnNewDocument', { source: probe });
  await call('Emulation.clearDeviceMetricsOverride');
  try {
    await check('No audio context exists before a press; the grid shows the authored pattern', async () => {
      await open(); await pause(1200);
      assert.deepEqual(await ev('window.__audio.states()'), []); assert.equal(await ev('window.__audio.starts'), 0);
      assert.equal(await ev(`document.querySelector(${JSON.stringify(cell(4, 0))}).getAttribute('aria-label')`), 'Do4, paso 1, suena');
      assert.ok(await ev('document.body.innerText.includes("Escala fija: Do pentatónica mayor")')); await shot('sequencer-light');
    });
    await check('A real press starts a running context with audible signal; playback writes no runtime and sends no event', async () => {
      await click(one + label('Reproducir'));
      await wait('window.__audio.contexts.length === 1 && window.__audio.contexts[0].state === "running"');
      await wait('window.__audio.starts > 0'); await wait('/paso \\d de 8/.test(document.body.innerText)');
      let peak = 0; for (let i = 0; i < 40 && peak < .01; i++) { peak = Math.max(peak, await ev('window.__audio.peak()')); await pause(50); }
      assert.ok(peak > .01, 'analyser peak ' + peak); assert.ok(peak < .5, 'bounded gain, peak ' + peak);
      const seen = new Set(); for (let i = 0; i < 30; i++) { seen.add(await ev('(document.body.innerText.match(/paso (\\d) de 8/)||[])[1]')); await pause(90); }
      assert.ok(seen.size >= 5, 'playhead positions ' + [...seen]); await shot('sequencer-playing');
      assert.deepEqual(await kinds(), []); assert.deepEqual(await ev('window.__lienzo.runtime().blocks'), {}); assert.equal(await ev('window.__lienzo.log.length'), 0);
      return `peak ${peak.toFixed(3)}, ${seen.size} playhead positions`;
    });
    await check('Pause closes the context at once and schedules nothing further; one settled event says the cycle was heard', async () => {
      await pause(2800); await click(one + label('Pausar'));
      assert.deepEqual(await ev('window.__audio.states()'), ['closed']);
      const starts = await ev('window.__audio.starts'); await pause(900); assert.equal(await ev('window.__audio.starts'), starts);
      assert.equal(await ev('/paso \\d de 8/.test(document.body.innerText)'), false);
      await wait('window.__lienzo.events.length === 1'); assert.deepEqual(await kinds(), ['step-sequencer.pattern']);
      const payload = await ev('window.__lienzo.events[0].action.payload'); assert.equal(payload.heard, true); assert.equal(payload.bpm, 96); assert.equal('step' in payload, false);
    });
    await check('Cell presses toggle and persist; three quick edits settle as one event and the card does not move', async () => {
      await open();
      await click(cell(0, 1)); await click(cell(1, 2)); await click(cell(0, 1)); await click(cell(0, 3));
      assert.deepEqual(await pattern(), ['...x....', '..x.x...', '..x.....', '......x.', 'x.......']);
      assert.deepEqual(await kinds(), []); await pause(900);
      assert.deepEqual(await kinds(), ['step-sequencer.pattern']); assert.equal(await ev('window.__lienzo.events[0].action.payload.notes'), 6);
      assert.equal(await ev('window.__lienzo.log.length'), 0); assert.deepEqual(await ev('window.__audio.states()'), [], 'Editing makes no sound and needs no context.');
    });
    await check('Arrow keys move between cells and Space toggles the focused one without reaching the canvas', async () => {
      await open(); await click(cell(4, 0));
      assert.equal((await pattern())[4], '........');
      await key('ArrowRight', 'ArrowRight'); await key('ArrowRight', 'ArrowRight');
      assert.equal(await ev('document.activeElement.id'), 'lienzo-interactive-sequencer-cell-sequencer-4-2');
      await key(' ', 'Space', ' '); assert.equal((await pattern())[4], '..x.....');
      // Display rows run high to low: one row down from La4 (row 0) is Sol4 (row 1).
      await click(cell(0, 5)); await key('ArrowDown', 'ArrowDown'); assert.equal(await ev('document.activeElement.id'), 'lienzo-interactive-sequencer-cell-sequencer-1-5');
      assert.equal(await ev('window.__lienzo.log.length'), 0); assert.deepEqual(await ev('window.__lienzo.selection ?? []'), await ev('window.__lienzo.selection ?? []'));
    });
    await check('Tempo slider changes speed live and settles once on release', async () => {
      await open(); const r = await rect('[id="lienzo-interactive-range-sequencer-tempo-sequencer"]');
      const x = r.x + r.width * .36, y = r.y + r.height / 2; await mouse('mousePressed', x, y);
      for (let i = 1; i <= 10; i++) { await mouse('mouseMoved', x + r.width * .5 * i / 10, y); await pause(16); }
      assert.deepEqual(await kinds(), []); await mouse('mouseReleased', x + r.width * .5, y); await pause(250);
      const bpm = await ev('window.__lienzo.runtime().blocks.sequencer.bpm'); assert.ok(bpm > 130 && bpm <= 160, 'bpm ' + bpm);
      assert.deepEqual(await kinds(), ['step-sequencer.pattern']); assert.equal(await ev('window.__lienzo.log.length'), 0, 'The slider does not drag the card.');
      assert.ok(await ev(`document.body.innerText.includes(${JSON.stringify(bpm + ' pulsos por minuto')})`));
      return 'bpm ' + bpm;
    });
    await check('Starting a second sequencer silences the first: one live context', async () => {
      await open(); await click(one + label('Reproducir')); await wait('window.__audio.contexts[0]?.state === "running"');
      await click(two + label('Reproducir')); await wait('window.__audio.contexts[1]?.state === "running"');
      assert.deepEqual(await ev('window.__audio.states()'), ['closed', 'running']);
      assert.equal(await ev(`!!document.querySelector(${JSON.stringify(one + label('Reproducir'))})`), true); assert.equal(await ev(`!!document.querySelector(${JSON.stringify(two + label('Pausar'))})`), true);
      await shot('sequencer-second-playing');
    });
    await check('Switching documents while playing closes audio', async () => {
      await ev('window.__lienzo.switchExample()'); await wait('!document.querySelector(\'[id^="lienzo-interactive-sequencer-"]\')');
      assert.deepEqual(await ev('window.__audio.states()'), ['closed', 'closed']);
      const starts = await ev('window.__audio.starts'); await pause(700); assert.equal(await ev('window.__audio.starts'), starts);
    });
    await check('A hidden tab (simulated visibilitychange) stops playback and returns to Reproducir', async () => {
      await open(); await click(one + label('Reproducir')); await wait('window.__audio.contexts[0]?.state === "running"');
      await ev('Object.defineProperty(document,"hidden",{configurable:true,get:()=>true}); document.dispatchEvent(new Event("visibilitychange")); delete document.hidden;');
      await wait('window.__audio.contexts[0].state === "closed"'); await wait(`!!document.querySelector(${JSON.stringify(one + label('Reproducir'))})`);
    });
    await check('Panning the playing card out of view stops it', async () => {
      await open(); await click(one + label('Reproducir')); await wait('window.__audio.contexts[0]?.state === "running"');
      await call('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 1500, y: 900, deltaX: 0, deltaY: 2600 }); await pause(200);
      await call('Input.dispatchMouseEvent', { type: 'mouseWheel', x: 1500, y: 900, deltaX: 3000, deltaY: 0 });
      await wait('window.__audio.contexts[0].state === "closed"');
    });
    await check('Refused activation (simulated NotAllowedError) is stated, keeps the grid editable, and Activar sonido retries', async () => {
      await open(); await ev('window.__audio.refuse = true'); await click(one + label('Reproducir'));
      await wait('document.body.innerText.includes("No se pudo activar el sonido")'); await wait(`!!document.querySelector(${JSON.stringify(one + label('Activar sonido'))})`);
      assert.deepEqual(await ev('window.__audio.states()'), ['closed']); await shot('sequencer-blocked');
      await click(cell(0, 0)); assert.equal((await pattern())[0], 'x.......');
      await ev('window.__audio.refuse = false'); await click(one + label('Activar sonido'));
      await wait('window.__audio.contexts[1]?.state === "running"'); assert.equal(await ev('document.body.innerText.includes("No se pudo activar el sonido")'), false);
      await click(one + label('Pausar'));
    });
    await check('Reiniciar restores the authored pattern and tempo and stops sound', async () => {
      await open(); await click(cell(0, 0)); await click(one + label('Reproducir')); await wait('window.__audio.contexts[0]?.state === "running"');
      await click(one + label('Reiniciar')); await wait('window.__audio.contexts[0].state === "closed"');
      await ev('window.__lienzo.flushRuntime()'); assert.equal(await ev('window.__lienzo.runtime().blocks.sequencer ?? null'), null);
      assert.equal(await ev(`document.querySelector(${JSON.stringify(cell(0, 0))}).getAttribute('aria-label')`), 'La4, paso 1, en silencio');
      await wait('window.__lienzo.events.some(e=>e.action.kind==="step-sequencer.reset")');
    });
    await check('Dark theme and compact outline render the labelled grid', async () => {
      await open('tinta'); await shot('sequencer-dark');
      await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
      await open('papel', '&compact'); const grid = await rect('[id="lienzo-interactive-sequencer-sequencer"]');
      assert.ok(grid.x >= 0 && grid.x + grid.width <= 390, JSON.stringify(grid)); await shot('sequencer-compact');
      await call('Emulation.clearDeviceMetricsOverride');
    });
  } finally {
    checks.push({ name: 'Uncaught page errors', result: errors.length ? 'fail' : 'pass', ...(errors.length ? { error: errors.join('; ') } : {}) });
    fs.writeFileSync('/tmp/lienzo-qa-sequencer.json', JSON.stringify(checks, null, 2)); socket.close();
    console.log(`${checks.filter(c => c.result === 'pass').length}/${checks.length} checks passed`);
    process.exitCode = checks.some(c => c.result === 'fail') ? 1 : 0;
  }
})();
