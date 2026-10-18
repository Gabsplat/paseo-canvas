import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fakeUpdateState, type UpdateState } from '../shared/rpc';
import { startDesktop } from './core';
import { registerUpdateRpcs } from './updater/rpc';

/**
 * The desktop renderer in a plain browser, for checking the UI headless without Electron: the same core, MCP server
 * and RPCs, with the renderer's invoke going over POST /rpc instead of IPC. Local only; no clipboard or link opening.
 * LIENZO_DATA_DIR (default .local-state/desktop-preview), LIENZO_PREVIEW_PORT (7422) and LIENZO_MCP_PORT apply.
 */
async function main() {
  const root = resolve(__dirname, 'renderer');
  const dataDirectory = resolve(process.env.LIENZO_DATA_DIR || join(process.cwd(), '.local-state', 'desktop-preview'));
  const port = Number(process.env.LIENZO_PREVIEW_PORT || 7422);
  const desktop = await startDesktop({ dataDirectory, version: 'preview' });
  // The preview never updates. Its state can be set by hand (desktop.updates.fake) to check the pill and About.
  let updateState: UpdateState = { kind: 'off', reason: 'Updates are off in the preview.' };
  registerUpdateRpcs(desktop.host, { status: () => ({ version: 'preview', state: updateState }), check: async () => updateState, restart: async () => false });
  desktop.host.handle(fakeUpdateState, ({ state }) => { updateState = state; return { ok: true }; });
  const types: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.map': 'application/json' };
  const server = createServer((request, response) => {
    void (async () => {
      const path = (request.url ?? '/').split('?')[0];
      if (request.method === 'POST' && path === '/rpc') {
        if (request.headers.origin && request.headers.origin !== `http://127.0.0.1:${port}`) { response.writeHead(403).end(); return; }
        const chunks: Buffer[] = []; for await (const chunk of request) chunks.push(chunk as Buffer);
        let body: { name?: unknown; input?: unknown } = {};
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { /* settled below as a bad request */ }
        const result = await desktop.settle(body.name, body.input);
        response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(result));
        return;
      }
      const file = normalize(join(root, path === '/' ? 'index.html' : decodeURIComponent(path)));
      if (!file.startsWith(root + sep)) { response.writeHead(404).end(); return; }
      try { const data = await readFile(file); response.writeHead(200, { 'content-type': types[extname(file)] ?? 'application/octet-stream' }).end(data); }
      catch { response.writeHead(404).end(); }
    })().catch(() => { if (!response.headersSent) response.writeHead(500).end(); });
  });
  server.listen(port, '127.0.0.1', () => console.log(`Lienzo preview on http://127.0.0.1:${port}/ · MCP ${desktop.mcp.listening ? desktop.mcp.url : 'not listening'} · data ${dataDirectory}`));
  const stop = () => { server.close(); server.closeAllConnections(); void desktop.close().finally(() => process.exit(0)); };
  process.on('SIGINT', stop); process.on('SIGTERM', stop);
}
void main().catch(error => { console.error(error); process.exit(1); });
