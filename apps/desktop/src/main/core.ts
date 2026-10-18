import { mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createCanvasCore, type CanvasCore } from '../../../../plugin/server/core';
import type { CanvasStore } from '../../../../plugin/server/store';
import { DEFAULT_MCP_PORT, DESKTOP_WORKSPACE, desktopStatus, openExternal, writeClipboard, type InvokeResult } from '../shared/rpc';
import { DesktopHost } from './host';
import { McpHttpServer } from './mcp-http';

/** What the agent reads when it connects. The plugin's version speaks of Paseo's copilot chip, which is not here. */
export const desktopInstructions = `[Lienzo]
Lienzo is a desktop canvas app the person keeps open next to you. Its canvas_* tools edit persistent documents ("Lienzos") that the person sees and edits at the same time. Draw when the person asks you to explain, map or sketch something there; otherwise leave the canvas alone. Before your first drawing, call canvas_list: it returns the drawing guide. The canvas never messages you: the person talks to you here, and when they point at the canvas ("this", "what I selected", "mirá esto"), call canvas_selection to see what they selected, its instructions and the state their interaction left. Claim only tool-confirmed changes.`;

export interface DesktopOptions {
  /** The app's private data directory (Electron userData). State lives in its canvas/ folder. */
  dataDirectory: string;
  version: string;
  /** Explicit MCP port. Otherwise LIENZO_MCP_PORT, then desktop.json `mcpPort`, then the default. */
  mcpPort?: number;
  /** What the shell can do for the renderer: Electron opens links and writes the clipboard; the preview cannot. */
  shell?: { openExternal(url: string): Promise<boolean>; writeClipboard(text: string): Promise<boolean> };
}
export interface Desktop {
  readonly host: DesktopHost;
  readonly core: CanvasCore;
  readonly mcp: McpHttpServer;
  settle(name: unknown, input: unknown): Promise<InvokeResult>;
  close(): Promise<void>;
}

async function configuredPort(dataDirectory: string): Promise<number> {
  const fromEnv = Number(process.env.LIENZO_MCP_PORT);
  if (Number.isInteger(fromEnv) && fromEnv > 0 && fromEnv < 65536) return fromEnv;
  try {
    const port = Number(JSON.parse(await readFile(join(dataDirectory, 'desktop.json'), 'utf8')).mcpPort);
    if (Number.isInteger(port) && port > 0 && port < 65536) return port;
  } catch { /* absent or unreadable: the default */ }
  return DEFAULT_MCP_PORT;
}

/**
 * A state file copied in from Paseo keeps its documents under Paseo workspace IDs and connections to Paseo agents.
 * The app has one workspace, so they move into it once; connections to agents that do not exist here are dropped.
 */
export async function adoptDocuments(store: CanvasStore, workspaceId = DESKTOP_WORKSPACE): Promise<number> {
  return store.transaction(state => {
    let moved = 0;
    for (const record of Object.values(state.documents)) {
      if (record.document.workspaceId === workspaceId) continue;
      moved++;
      record.document.workspaceId = workspaceId;
      for (const entry of record.history) { entry.before.workspaceId = workspaceId; entry.after.workspaceId = workspaceId; }
      record.connection = null;
    }
    for (const copilot of Object.values(state.copilot)) if (copilot.workspaceId && copilot.workspaceId !== workspaceId) copilot.workspaceId = workspaceId;
    return moved;
  });
}

/** The Lienzo server core on the desktop host, its MCP endpoint, and the desktop-only RPCs. No Electron here. */
export async function startDesktop(options: DesktopOptions): Promise<Desktop> {
  await mkdir(options.dataDirectory, { recursive: true, mode: 0o700 });
  const host = new DesktopHost(join(options.dataDirectory, 'settings.json'));
  // MCP callers are identified by their client name; that is both their owner token and their agent ID here.
  const core = createCanvasCore(host, { directory: join(options.dataDirectory, 'canvas'), resolveScope: async agentId => ({ agentId, workspaceId: DESKTOP_WORKSPACE }) });
  try {
    await core.store.initialize();
    await adoptDocuments(core.store);
  } catch (error) { await core.store.close().catch(() => {}); throw error; }
  const mcp = new McpHttpServer({ port: options.mcpPort ?? await configuredPort(options.dataDirectory), version: options.version, instructions: desktopInstructions, call: (name, input, agentId) => core.router.call(name, input, agentId) });
  let mcpError: string | null = null;
  try { await mcp.start(); }
  catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    mcpError = code === 'EADDRINUSE' ? `Port ${mcp.port} is already in use, so agents cannot connect. Quit what uses it, or set another port in desktop.json.` : 'The MCP server could not start.';
    console.error('Lienzo MCP server did not start', error);
  }
  host.handle(openExternal, async ({ url }) => ({ opened: /^https?:\/\//i.test(url) && !!options.shell && await options.shell.openExternal(url) }));
  host.handle(writeClipboard, async ({ text }) => ({ written: !!options.shell && await options.shell.writeClipboard(text) }));
  host.handle(desktopStatus, () => ({ version: options.version, dataDirectory: options.dataDirectory, mcp: { url: mcp.url, port: mcp.port, listening: mcp.listening, error: mcpError, clients: mcp.clients() } }));
  return {
    host, core, mcp,
    settle: (name, input) => host.settle(name, input),
    async close() { await mcp.close(); await core.stop(); await core.store.close(); },
  };
}
