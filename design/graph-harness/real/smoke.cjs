// Run ONLY inside omabox. Exercises real RN-web pointer responders and the real reducer with example data.
const assert = require('node:assert/strict');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const root = 'http://127.0.0.1:8765/';
const scenario = process.argv[2] ?? 'interaction';
async function main() {
  const pages = await (await fetch('http://127.0.0.1:9222/json/list')).json();
  const page = pages.find(p => p.type === 'page' && p.url.startsWith(root));
  assert.ok(page, 'open the example harness in Chromium in this box');
  const socket = new WebSocket(page.webSocketDebuggerUrl), pending = new Map(); let serial = 0;
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  socket.addEventListener('message', event => {
    const r = JSON.parse(event.data);
    const p = pending.get(r.id); if (!p) return;
    clearTimeout(p.timer); pending.delete(r.id); r.error ? p.reject(new Error(JSON.stringify(r.error))) : p.resolve(r.result);
  });
  const call = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++serial, timer = setTimeout(() => { pending.delete(id); reject(new Error(`${method} timed out`)); }, 10000);
    pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const r = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails)); return r.result.value;
  };
  const waitFor = async (expression, timeout = 5000) => {
    const until = Date.now() + timeout;
    do { const value = await evaluate(expression); if (value) return value; await pause(30); } while (Date.now() < until);
    throw new Error(`Condition timed out: ${expression}`);
  };
  const locate = async label => {
    const rect = await evaluate(`(() => { const e = Array.from(document.querySelectorAll('[aria-label]')).find(e => e.getAttribute('aria-label') === ${JSON.stringify(label)}); if (!e) return null; const r = e.getBoundingClientRect(); return {x:r.x,y:r.y,width:r.width,height:r.height}; })()`);
    assert.ok(rect, `visible element: ${label}`); return rect;
  };
  const mouse = (type, p, button = 'left', extra = {}) => call('Input.dispatchMouseEvent', { type, x: p.x, y: p.y, button, buttons: type === 'mouseReleased' ? 0 : button === 'middle' ? 4 : 1, clickCount: type === 'mouseMoved' ? 0 : 1, ...extra });
  const click = async (label, modifiers = 0) => { const r = await locate(label), p = { x: r.x + r.width / 2, y: r.y + r.height / 2 }; await mouse('mousePressed', p, 'left', { modifiers }); await mouse('mouseReleased', p, 'left', { modifiers }); await pause(50); };
  const drag = async (from, to, { button = 'left', steps = 20, during, modifiers = 0 } = {}) => {
    await mouse('mousePressed', from, button, { modifiers });
    for (let i = 1; i <= steps; i++) { await mouse('mouseMoved', { x: from.x + (to.x - from.x) * i / steps, y: from.y + (to.y - from.y) * i / steps }, button, { modifiers }); await pause(16); }
    try { await pause(120); if (during) await during(); } finally { await mouse('mouseReleased', to, button, { modifiers }); } await pause(700);
  };
  const middle = r => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });
  const open = async query => {
    await call('Page.navigate', { url: root + query });
    await waitFor(`window.__lienzo && location.search === ${JSON.stringify(query)} && !!document.querySelector('[aria-label="MODULE: Inspección de cuenta, ready"], [aria-label="MODULE: Nodo 1.1, ready"], [aria-label="Vista previa: Web de ejemplo"]')`);
    await pause(500);
  };
  try {
    await call('Runtime.enable');
    await call('Network.enable'); await call('Network.setCacheDisabled', { cacheDisabled: true });
    if (scenario === 'interaction') {
      await open('?theme=papel'); await click('Ajustar'); await pause(350);
      const inspect = 'MODULE: Inspección de cuenta, ready', host = 'MODULE: Composición del host, ready';
      await click(inspect); await click(host, 8);
      assert.deepEqual(await evaluate('window.__lienzo.selection'), ['inspect', 'host']);
      const a = await locate(inspect), b = await locate(host), from = middle(a), paths = await evaluate(`Array.from(document.querySelectorAll('svg path[stroke]'), e => e.getAttribute('d')).join('|')`);
      await drag(from, { x: from.x + 120, y: from.y + 60 }, { during: async () => {
        assert.notEqual(await evaluate(`Array.from(document.querySelectorAll('svg path[stroke]'), e => e.getAttribute('d')).join('|')`), paths, 'connectors follow before saving');
      } });
      assert.deepEqual(await evaluate('window.__lienzo.selection'), ['inspect', 'host'], 'post-drag click keeps the selection');
      const movedA = await locate(inspect), movedB = await locate(host);
      assert.ok(Math.abs((movedA.x - a.x) - (movedB.x - b.x)) < 1 && Math.abs((movedA.y - a.y) - (movedB.y - b.y)) < 1, 'both cards share one displacement');
      assert.equal(await evaluate('window.__lienzo.doc().blocks.filter(b=>["inspect","host"].includes(b.id) && b.position).length'), 2);
      await click('Soltar selección'); await pause(400);
      assert.equal(await evaluate('window.__lienzo.doc().blocks.filter(b=>["inspect","host"].includes(b.id) && b.position).length'), 0);
      assert.ok(Math.abs((await locate(inspect)).x - a.x) < 1, 'release returns to the graph layout');
      const count = await evaluate('window.__lienzo.log.length'), beforePan = await locate(inspect), panFrom = middle(beforePan);
      await drag(panFrom, { x: panFrom.x + 160, y: panFrom.y + 80 }, { button: 'middle' });
      const afterPan = await locate(inspect);
      assert.ok(Math.abs(afterPan.x - beforePan.x - 160) < 1 && Math.abs(afterPan.y - beforePan.y - 80) < 1, 'middle mouse pans over cards');
      const group = await locate('Grupo: Dentro de la sesión'), body = { x: group.x + 6, y: group.y + group.height / 2 };
      await drag(body, { x: body.x - 200, y: body.y + 40 });
      assert.equal(await evaluate('window.__lienzo.log.length'), count, 'panning writes no transactions');
      assert.deepEqual(await evaluate('window.__lienzo.selection'), ['inspect', 'host']);
      await click('Ajustar'); await pause(350);
      const note = 'Nota: Primera nota', noteFrom = middle(await locate(note));
      await drag(noteFrom, { x: noteFrom.x + 100, y: noteFrom.y + 10 });
      assert.ok(await evaluate('!!window.__lienzo.doc().blocks.find(b=>b.id==="n1").position'), 'a stack child can be pinned');
      assert.equal(await evaluate('window.__lienzo.doc().blocks.find(b=>b.id==="n1").parentGroupId'), 'notes');
      assert.equal(await evaluate('window.__lienzo.doc().groups.find(g=>g.id==="notes").layout.mode'), 'stack');
      await click('Ajustar'); await pause(350);
      const target = await locate('Grupo: Vacío');
      await drag(middle(await locate(note)), { x: target.x + 60, y: target.y + 65 });
      assert.equal(await evaluate('window.__lienzo.doc().blocks.find(b=>b.id==="n1").parentGroupId'), 'empty');
      const local = await evaluate('window.__lienzo.doc().blocks.find(b=>b.id==="n1").position'), frame = await locate('Grupo: Vacío');
      await drag({ x: frame.x + 100, y: frame.y + 14 }, { x: frame.x + 180, y: frame.y + 54 });
      assert.ok(await evaluate('!!window.__lienzo.doc().groups.find(g=>g.id==="empty").position'), 'a group frame is draggable');
      assert.deepEqual(await evaluate('window.__lienzo.doc().blocks.find(b=>b.id==="n1").position'), local, 'a travelling child keeps its local position');
      const outFrom = middle(await locate(note));
      await drag(outFrom, { x: 160, y: 300 });
      assert.equal(await evaluate('window.__lienzo.doc().blocks.find(b=>b.id==="n1").parentGroupId'), null);
      const beforeFailure = await locate(note), revision = await evaluate('window.__lienzo.doc().revision');
      await click('Fallar próximo guardado');
      await drag(middle(beforeFailure), { x: beforeFailure.x + 150, y: beforeFailure.y + 100 });
      assert.equal(await evaluate('window.__lienzo.doc().revision'), revision);
      const reverted = await locate(note);
      assert.ok(Math.abs(reverted.x - beforeFailure.x) < 1 && Math.abs(reverted.y - beforeFailure.y) < 1, 'a rejected edit returns to its saved place');
      await click('OUTSIDE: Runtime, ready');
      const handle = await locate('Arrastra para conectar «Runtime» con otro elemento');
      await drag(middle(handle), middle(await locate(note)));
      assert.ok(await evaluate('window.__lienzo.doc().links.some(l=>l.from==="runtime" && l.to==="n1")'), 'the plus handle still creates a link');
      await call('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
      await waitFor('window.__lienzo.reducedMotion()');
      await click('Ajustar'); await pause(50);
      assert.ok(await evaluate('window.__lienzo.reducedMotion()'), 'the live accessibility setting is observed');
      console.log('PASS multi-drag, live connectors, release, middle/body pan, stack pin, group drag, reparent in/out, rejected save, plus-handle link, reduce motion');
      await call('Emulation.setEmulatedMedia', { features: [] });
    } else if (scenario === 'features') {
      await open('?theme=papel'); await click('Ajustar'); await pause(350);
      const label = 'MODULE: Inspección de cuenta, ready'; await click(label);
      const before = await locate(label), grip = await locate('Redimensionar: Inspección de cuenta'), revision = await evaluate('window.__lienzo.doc().revision');
      const paths = await evaluate(`Array.from(document.querySelectorAll('svg path[stroke]'),e=>e.getAttribute('d')).join('|')`);
      const start = middle(grip), end = { x: start.x + 110, y: start.y + 70 };
      await drag(start, end, { during: async () => {
        assert.equal(await evaluate('window.__lienzo.doc().revision'), revision, 'resize commits only on release');
        assert.ok((await locate(label)).width > before.width + 90, 'frame follows the hand');
        assert.notEqual(await evaluate(`Array.from(document.querySelectorAll('svg path[stroke]'),e=>e.getAttribute('d')).join('|')`), paths, 'connector ports resize live');
      } });
      const size = await evaluate('window.__lienzo.doc().blocks.find(b=>b.id==="inspect").size'); assert.ok(size.width > 224 && size.height >= 104);
      assert.equal(await evaluate('window.__lienzo.doc().blocks.find(b=>b.id==="inspect").position'), undefined, 'resizing keeps automatic placement');
      assert.equal(await evaluate('window.__lienzo.doc().revision'), revision + 1);
      assert.equal(await evaluate('window.__lienzo.log.at(-1).operations[0].type'), 'block.update');
      const ratioGrip = middle(await locate('Redimensionar: Inspección de cuenta'));
      await drag(ratioGrip, { x: ratioGrip.x + 90, y: ratioGrip.y + 8 }, { modifiers: 8 });
      const proportional = await evaluate('window.__lienzo.doc().blocks.find(b=>b.id==="inspect").size');
      assert.ok(Math.abs(proportional.width / proportional.height - size.width / size.height) < .02, 'Shift preserves the starting aspect ratio in the real responder');
      await click('Tamaño automático'); await pause(500); assert.ok(Math.abs((await locate(label)).width - before.width) < 1, 'automatic size restores the original card');
      await click('Fallar próximo guardado'); const failedRevision = await evaluate('window.__lienzo.doc().revision'), failedGrip = middle(await locate('Redimensionar: Inspección de cuenta'));
      await drag(failedGrip, { x: failedGrip.x + 90, y: failedGrip.y + 60 }); assert.equal(await evaluate('window.__lienzo.doc().revision'), failedRevision);
      assert.ok(Math.abs((await locate(label)).width - before.width) < 1, 'failed resize returns to the confirmed dimensions');
      const handle = await locate('Arrastra para conectar «Inspección de cuenta» con otro elemento'), target = await locate('MODULE: Perfiles locales, blocked');
      const landing = { x: target.x + target.width + 24, y: target.y + target.height / 2 }, linksBefore = await evaluate('window.__lienzo.doc().links.length');
      await drag(middle(handle), landing, { during: async () => {
        await pause(350);
        assert.ok(await evaluate('document.body.innerText.includes("Conectar con «Perfiles locales»")'), 'a nearby port is a valid target before entering the card');
        const port = await evaluate(`(() => {const r=document.getElementById('lienzo-magnet-port').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()`);
        assert.ok(Math.abs(port.x - target.x - target.width) < 3 && Math.abs(port.y - landing.y) < 3, 'endpoint springs to the port');
        assert.equal(await evaluate('window.__lienzo.doc().links.length'), linksBefore, 'magnet feedback does not save before release');
      } });
      assert.ok(await evaluate('window.__lienzo.doc().links.some(l=>l.from==="inspect"&&l.to==="profiles")'));
      console.log('PASS live resize/ports, one transaction, automatic size, failed resize, magnetic port outside card, spring endpoint and link release');
    } else if (scenario === 'guide') {
      await open('?theme=papel&guide'); await waitFor('document.body.innerText.includes("Empezá con un lienzo")');
      const { data } = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); require('node:fs').writeFileSync('/tmp/lienzo-guide.png', Buffer.from(data, 'base64'));
      for (let i = 0; i < 5; i++) await click('Siguiente'); await waitFor('document.body.innerText.includes("Guardá y compartí")');
      await click('Todas las opciones'); const input = await locate('Buscar en la guía'); await mouse('mousePressed', middle(input)); await mouse('mouseReleased', middle(input)); await call('Input.insertText', { text: 'video' });
      assert.ok(await evaluate('document.body.innerText.includes("Video y audio") && !document.body.innerText.includes("Cambios simultáneos")'), 'guide search filters features');
      await click('Volver al lienzo'); assert.equal(await evaluate(`document.querySelectorAll('[role="dialog"]').length`), 0);
      await open('?theme=papel&first-visit'); assert.equal(await evaluate(`document.querySelectorAll('[role="dialog"]').length`), 0, 'dismissal survives page reload');
      await click('Guía de Lienzo'); await click('Abrir documentos'); assert.ok(await evaluate('document.getElementById("last").innerText.includes("Guía: documents")'), 'tour action closes and routes to the owning panel');
      console.log('PASS six guide steps, searchable feature reference, dismissal/reload, reopening and action callback');
    } else if (scenario === 'media') {
      await open('?theme=papel&doc=interactive'); await click('Ajustar'); await pause(350);
      assert.equal(await evaluate('Array.from(document.querySelectorAll("iframe"),e=>e.src).filter(url=>/youtube|vimeo/.test(url)).length'), 0, 'provider players stay unloaded');
      const video = await evaluate(`(() => { const v=document.querySelector('video');const r=v.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,controls:v.controls,autoplay:v.autoplay,preload:v.preload}; })()`);
      assert.ok(video.controls && !video.autoplay && video.preload === 'none' && video.width > 100 && video.height > 100);
      const revision = await evaluate('window.__lienzo.doc().revision');
      // Chromium's narrow player has controls above the timeline, on a second row.
      const play = { x: video.x + 24, y: video.y + video.height - 48 }; await mouse('mousePressed', play); await mouse('mouseReleased', play);
      await waitFor('document.querySelector("video").currentTime > .2'); assert.ok(await evaluate('!document.querySelector("video").paused'), 'browser control starts playback');
      const playing = await evaluate('document.querySelector("video").currentTime');
      await mouse('mousePressed', play); await mouse('mouseReleased', play); await pause(120); assert.ok(await evaluate('document.querySelector("video").paused'), 'browser control pauses playback');
      assert.equal(await evaluate('window.__lienzo.doc().revision'), revision, 'media controls do not move or edit the card');
      const frameTree = await call('Page.getFrameTree');
      const frame = frameTree.frameTree.childFrames.find(f => f.frame.url.includes('8766/web-fixture.html')).frame;
      const world = await call('Page.createIsolatedWorld', { frameId: frame.id, worldName: 'lienzo-example-inspection' });
      const inFrame = async expression => { const r = await call('Runtime.evaluate', { expression, contextId: world.executionContextId, returnByValue: true }); if (r.exceptionDetails) throw new Error(JSON.stringify(r.exceptionDetails)); return r.result.value; };
      const frameBox = await evaluate(`(() => {const e=document.querySelector('iframe[title="Web de ejemplo"]'),r=e.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,scale:r.width/e.clientWidth};})()`);
      const framePoint = async selector => { const r = await inFrame(`document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect().toJSON()`); return { x: frameBox.x + (r.x + r.width / 2) * frameBox.scale, y: frameBox.y + (r.y + r.height / 2) * frameBox.scale }; };
      const inputPoint = await framePoint('input'); await mouse('mousePressed', inputPoint); await mouse('mouseReleased', inputPoint); await call('Input.insertText', { text: 'Gabi' });
      const submitPoint = await framePoint('button'); await mouse('mousePressed', submitPoint); await mouse('mouseReleased', submitPoint); await pause(100);
      assert.equal(await inFrame('document.getElementById("result").textContent'), 'Hola, Gabi');
      assert.equal(await inFrame('localStorage.getItem("example-name")'), 'Gabi', 'cross-origin web apps retain their own storage');
      const headerBeforeScroll = await locate('Vista previa: Web de ejemplo');
      await call('Input.dispatchMouseEvent', { type: 'mouseWheel', x: frameBox.x + frameBox.width / 2, y: frameBox.y + frameBox.height / 2, deltaX: 0, deltaY: 200 }); await pause(200);
      assert.ok(await inFrame('document.scrollingElement.scrollTop > 0'), 'wheel scrolls the embedded page');
      const headerAfterScroll = await locate('Vista previa: Web de ejemplo'); assert.equal(headerAfterScroll.x, headerBeforeScroll.x); assert.equal(headerAfterScroll.y, headerBeforeScroll.y);
      assert.equal(await evaluate('window.__lienzo.doc().revision'), revision, 'form and frame scrolling do not move or edit the card');
      await click('Ampliar imagen: Imagen de ejemplo'); await click('Acercar imagen'); assert.ok(await evaluate('document.body.innerText.includes("150%")'));
      const viewer = await evaluate(`document.getElementById('lienzo-interactive-image-viewer').getBoundingClientRect().toJSON()`);
      const imageTransform = await evaluate(`getComputedStyle(document.getElementById('lienzo-interactive-image-viewer').firstElementChild).transform`);
      await drag(middle(viewer), { x: viewer.x + viewer.width / 2 + 80, y: viewer.y + viewer.height / 2 + 40 });
      assert.notEqual(await evaluate(`getComputedStyle(document.getElementById('lienzo-interactive-image-viewer').firstElementChild).transform`), imageTransform, 'zoomed image pans inside the viewer');
      assert.equal(await evaluate('window.__lienzo.doc().revision'), revision, 'image navigation never edits the canvas');
      await click('Ajustar imagen'); assert.ok(await evaluate('document.body.innerText.includes("100%")')); await click('Cerrar modal');
      await click('Cargar video de YouTube'); assert.ok(await evaluate('Array.from(document.querySelectorAll("iframe"),e=>e.src).some(url=>url.includes("youtube-nocookie.com/embed/M7lc1UVf-VE")&&url.includes("start=42")&&!url.includes("autoplay"))'));
      await click('Cerrar reproductor'); await click('Cargar video de Vimeo'); assert.ok(await evaluate('Array.from(document.querySelectorAll("iframe"),e=>e.src).some(url=>url.includes("player.vimeo.com/video/76979871")&&!url.includes("autoplay"))'));
      const { data } = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); require('node:fs').writeFileSync('/tmp/lienzo-media.png', Buffer.from(data, 'base64'));
      console.log('PASS inline video play/pause, interactive cross-origin web form/storage/scroll, no card edits or canvas pan, image zoom/pan/reset, lazy provider embeds and canonical URLs. External provider playback not tested in isolated network.');
    } else if (scenario === 'many') {
      await open('?doc=many&perf=1&theme=tinta');
      const profiling = process.argv.includes('--profile');
      if (profiling) { await call('Profiler.enable'); await call('Profiler.start'); }
      const label = 'MODULE: Nodo 1.5, ready', from = middle(await locate(label));
      assert.ok(await evaluate(`(${from.x} > 48 && ${from.x} < innerWidth - 48 && ${from.y} > 48 && ${from.y} < innerHeight - 48)`), 'the sampled node is inside the viewport');
      await evaluate('window.__lienzoPerf.start()');
      await drag(from, { x: from.x - 200, y: from.y + 120 }, { steps: 90 });
      const dragFrames = await evaluate('window.__lienzoPerf.stop()');
      assert.ok(await evaluate('!!window.__lienzo.doc().blocks.find(b=>b.id==="g0n4").position'));
      await evaluate('window.__lienzoPerf.start()');
      await drag(middle(await locate(label)), { x: from.x + 180, y: from.y + 160 }, { button: 'middle', steps: 90 });
      const panFrames = await evaluate('window.__lienzoPerf.stop()');
      await click(label);
      const corner = middle(await locate('Redimensionar: Nodo 1.5')), revision = await evaluate('window.__lienzo.doc().revision');
      await evaluate('window.__lienzoPerf.start()');
      await drag(corner, { x: corner.x + 120, y: corner.y + 48 }, { steps: 90, during: async () => {
        assert.equal(await evaluate('window.__lienzo.doc().revision'), revision, 'resizing among 150 nodes previews without writes');
      } });
      const resizeFrames = await evaluate('window.__lienzoPerf.stop()');
      assert.ok(await evaluate('!!window.__lienzo.doc().blocks.find(b=>b.id==="g0n4").size'), '150-node resize persists');
      console.log(JSON.stringify({ nodes: 150, dragFrames, panFrames, resizeFrames }));
      if (profiling) {
        const { profile } = await call('Profiler.stop');
        require('node:fs').writeFileSync('/tmp/lienzo-many-profile.json', JSON.stringify(profile));
        const byId = new Map(profile.nodes.map(n => [n.id, n])), parents = new Map(), self = new Map(), total = new Map();
        for (const n of profile.nodes) for (const id of n.children ?? []) parents.set(id, n.id);
        for (let i = 0; i < profile.samples.length; i++) {
          let id = profile.samples[i], ms = profile.timeDeltas[i] / 1000; self.set(id, (self.get(id) ?? 0) + ms);
          while (id) { total.set(id, (total.get(id) ?? 0) + ms); id = parents.get(id); }
        }
        const top = scores => [...scores].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([id, ms]) => ({ ms: Math.round(ms), name: byId.get(id).callFrame.functionName, line: byId.get(id).callFrame.lineNumber + 1 }));
        console.log(JSON.stringify({ self: top(self), total: top(total) }));
      }
    } else if (scenario === 'compact') {
      await call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
      await open('?theme=papel&compact');
      const r = await locate('MODULE: Inspección de cuenta, ready');
      assert.ok(r.x >= 0 && r.x + r.width <= 390, 'the actual outline card fits the compact viewport');
      await click('MODULE: Inspección de cuenta, ready');
      assert.deepEqual(await evaluate('window.__lienzo.selection'), ['inspect']);
      assert.ok(await evaluate('!document.querySelector("svg") && document.body.innerText.includes("EJEMPLO")'), 'compact renders the labelled example outline');
      const { data } = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      require('node:fs').writeFileSync('/tmp/lienzo-compact.png', Buffer.from(data, 'base64'));
      // This harness toolbar is a desktop stand-in; the product uses Más acciones on compact.
      await open('?theme=papel&compact&guide');
      const next = await locate('Siguiente');
      assert.ok(next.x >= 0 && next.x + next.width <= 390 && next.y + next.height <= 844, 'compact guide navigation fits');
      const guideButton = async label => {
        await evaluate(`Array.from(document.querySelectorAll('[aria-label]')).find(e=>e.getAttribute('aria-label')===${JSON.stringify(label)}).scrollIntoView({block:'end'})`);
        await pause(100); const r = await locate(label);
        assert.ok(r.y >= 0 && r.y + r.height <= 844, 'guide navigation stays reachable after scrolling');
        await click(label);
      };
      for (let step = 0; step < 5; step++) await guideButton('Siguiente');
      await guideButton('Usar mi lienzo');
      await open('?theme=tinta&compact&guide'); await click('Todas las opciones');
      const search = await locate('Buscar en la guía'); await mouse('mousePressed', middle(search)); await mouse('mouseReleased', middle(search)); await call('Input.insertText', { text: 'tamaño' });
      assert.ok(await evaluate('document.body.innerText.includes("Arrastrar y redimensionar")'), 'compact searchable guide works in dark theme');
      const dark = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      require('node:fs').writeFileSync('/tmp/lienzo-guide-compact-dark.png', Buffer.from(dark.data, 'base64'));
      console.log('PASS compact outline at 390 × 844, sizing/selection/example label, guide navigation and dark searchable guide');
    } else { throw new Error(`Unknown scenario ${scenario}`); }
  } finally { if (scenario === 'compact') await call('Emulation.clearDeviceMetricsOverride'); socket.close(); }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
