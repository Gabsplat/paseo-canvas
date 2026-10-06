// Inspect the example harness through Chromium's local debug port inside an isolated omabox.
// Node 22+ supplies WebSocket; no browser automation dependency is needed.
const [expression = 'JSON.stringify({doc: window.__lienzo.doc(), selection: window.__lienzo.selection})'] = process.argv.slice(2);
(async () => {
  const pages = await (await fetch('http://127.0.0.1:9222/json/list')).json();
  const page = pages.find(p => p.type === 'page' && p.url.startsWith('http://127.0.0.1:8765/'));
  if (!page) throw new Error('Open the Lienzo example harness in the box first.');
  const socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.addEventListener('open', resolve, { once: true }); socket.addEventListener('error', reject, { once: true }); });
  const reply = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Harness inspection timed out')), 10000);
    socket.addEventListener('message', event => {
      const response = JSON.parse(event.data);
      if (response.id !== 1) return;
      clearTimeout(timeout);
      if (response.error || response.result.exceptionDetails) reject(new Error(JSON.stringify(response.error ?? response.result.exceptionDetails)));
      else resolve(response.result.result.value);
    });
    socket.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
  });
  console.log(typeof reply === 'string' ? reply : JSON.stringify(reply));
  socket.close();
})().catch(error => { console.error(error.message); process.exitCode = 1; });
