import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema, isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { toolDefinitions } from '../../../../plugin/server/tools';
import { errorResponse } from '../../../../plugin/server/bridge';
import type { McpClient } from '../shared/rpc';

const BODY_LIMIT = 2 * 1024 * 1024;
const MAX_SESSIONS = 64;

export interface McpHttpOptions {
  port: number;
  version: string;
  instructions: string;
  /** Runs one canvas tool for an agent. Same contract as the plugin's ToolRouter.call. */
  call(name: string, input: unknown, agentId: string): Promise<unknown>;
  now?: () => number;
}
type Session = { transport: StreamableHTTPServerTransport; server: Server; agentId: string | null; lastSeen: number };

/** A stable agent identity for an MCP client: its declared name, so reconnects keep their canvases and undo. */
export function agentIdFor(name: string | undefined) {
  const slug = (name ?? '').toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  return `mcp:${slug || 'client'}`;
}

/**
 * The canvas tools over MCP streamable HTTP on 127.0.0.1, using the official MCP SDK. Stateful sessions: each
 * initialize gets its own SDK server and transport, and the client's declared name becomes its agent identity.
 * Requests from browsers (an Origin header that is not this server) and foreign Host headers are refused, so a web
 * page cannot drive it. There is no way to reach an agent from here: the server only answers.
 */
export class McpHttpServer {
  private http: HttpServer | null = null;
  private readonly sessions = new Map<string, Session>();
  private readonly seen = new Map<string, McpClient>();
  private boundPort: number | null = null;
  private readonly now: () => number;
  constructor(private readonly options: McpHttpOptions) { this.now = options.now ?? Date.now; }

  get port() { return this.boundPort ?? this.options.port; }
  get url() { return `http://127.0.0.1:${this.port}/mcp`; }
  get listening() { return !!this.http?.listening; }
  clients(): McpClient[] { return [...this.seen.values()].sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt)); }

  async start(): Promise<number> {
    const http = createServer((request, response) => { void this.route(request, response); });
    http.requestTimeout = 60_000; http.headersTimeout = 10_000;
    await new Promise<void>((resolve, reject) => {
      http.once('error', reject);
      http.listen(this.options.port, '127.0.0.1', () => { http.off('error', reject); resolve(); });
    });
    const address = http.address();
    this.boundPort = address && typeof address === 'object' ? address.port : this.options.port;
    this.http = http;
    return this.boundPort;
  }
  async close() {
    await Promise.all([...this.sessions.values()].map(session => session.transport.close().catch(() => {})));
    this.sessions.clear();
    const http = this.http; this.http = null;
    if (!http) return;
    http.closeAllConnections();
    await new Promise<void>(resolve => http.close(() => resolve()));
  }

  private touch(session: Session, toolCall = false) {
    session.lastSeen = this.now();
    if (!session.agentId) return;
    const entry = this.seen.get(session.agentId);
    if (entry) { entry.lastSeenAt = new Date(session.lastSeen).toISOString(); if (toolCall) entry.toolCalls++; }
  }
  private createSession(): Session {
    const server = new Server({ name: 'lienzo', version: this.options.version }, { capabilities: { tools: {} }, instructions: this.options.instructions });
    const session: Session = { server, agentId: null, lastSeen: this.now(), transport: undefined as unknown as StreamableHTTPServerTransport };
    server.oninitialized = () => {
      const client = server.getClientVersion(), agentId = agentIdFor(client?.name), at = new Date(this.now()).toISOString();
      session.agentId = agentId;
      const entry = this.seen.get(agentId);
      this.seen.set(agentId, { agentId, name: client?.name?.slice(0, 200) || 'MCP client', version: client?.version?.slice(0, 60) ?? '', firstSeenAt: entry?.firstSeenAt ?? at, lastSeenAt: at, toolCalls: entry?.toolCalls ?? 0 });
    };
    server.setRequestHandler(ListToolsRequestSchema, async () => { this.touch(session); return { tools: toolDefinitions }; });
    server.setRequestHandler(CallToolRequestSchema, async request => {
      this.touch(session, true);
      const agentId = session.agentId ?? agentIdFor(server.getClientVersion()?.name);
      try {
        const data = await this.options.call(request.params.name, request.params.arguments ?? {}, agentId);
        return { content: [{ type: 'text' as const, text: JSON.stringify(data) }] };
      } catch (error) {
        return { isError: true, content: [{ type: 'text' as const, text: JSON.stringify(errorResponse(error).error) }] };
      }
    });
    session.transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: id => { this.sessions.set(id, session); this.prune(); },
      onsessionclosed: id => { this.sessions.delete(id); },
    });
    session.transport.onclose = () => { const id = session.transport.sessionId; if (id) this.sessions.delete(id); };
    return session;
  }
  /** Keeps the session table bounded: the least recently used sessions go first. */
  private prune() {
    if (this.sessions.size <= MAX_SESSIONS) return;
    const oldest = [...this.sessions.entries()].sort((a, b) => a[1].lastSeen - b[1].lastSeen).slice(0, this.sessions.size - MAX_SESSIONS);
    for (const [id, session] of oldest) { this.sessions.delete(id); void session.transport.close().catch(() => {}); }
  }

  private allowed(request: IncomingMessage) {
    const hosts = [`127.0.0.1:${this.port}`, `localhost:${this.port}`];
    if (!hosts.includes(String(request.headers.host ?? ''))) return false;
    const origin = request.headers.origin;
    return origin === undefined || hosts.some(host => origin === `http://${host}`);
  }
  private async route(request: IncomingMessage, response: ServerResponse) {
    const fail = (status: number, message: string, code = -32000) => {
      if (response.headersSent) { response.end(); return; }
      response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      response.end(JSON.stringify({ jsonrpc: '2.0', error: { code, message }, id: null }));
    };
    try {
      const path = (request.url ?? '').split('?')[0];
      if (!this.allowed(request)) { request.resume(); return fail(403, 'Forbidden: Lienzo MCP accepts local clients only.'); }
      if (path !== '/mcp') { request.resume(); return fail(404, 'Not found. The MCP endpoint is /mcp.'); }
      const header = request.headers['mcp-session-id'], sessionId = typeof header === 'string' ? header : undefined;
      if (request.method === 'POST') {
        const body = await readJson(request);
        if (sessionId) {
          const session = this.sessions.get(sessionId);
          if (!session) return fail(404, 'Session not found. Start a new MCP session.', -32001);
          this.touch(session);
          return await session.transport.handleRequest(request, response, body);
        }
        if (!isInitializeRequest(body)) return fail(400, 'Bad request: send initialize first.');
        const session = this.createSession();
        await session.server.connect(session.transport);
        return await session.transport.handleRequest(request, response, body);
      }
      if (request.method === 'GET' || request.method === 'DELETE') {
        const session = sessionId ? this.sessions.get(sessionId) : undefined;
        request.resume();
        if (!session) return fail(sessionId ? 404 : 400, sessionId ? 'Session not found.' : 'Missing session.');
        return await session.transport.handleRequest(request, response);
      }
      request.resume();
      return fail(405, 'Method not allowed.');
    } catch (error) {
      if (error instanceof BodyError) return fail(error.status, error.message, -32700);
      console.error('Lienzo MCP request failed', error);
      return fail(500, 'Internal error.', -32603);
    }
  }
}

class BodyError extends Error { constructor(readonly status: number, message: string) { super(message); } }
function readJson(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    if (Number(request.headers['content-length']) > BODY_LIMIT) { request.resume(); reject(new BodyError(413, 'Request too large.')); return; }
    const chunks: Buffer[] = []; let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > BODY_LIMIT) { request.removeAllListeners('data'); request.resume(); reject(new BodyError(413, 'Request too large.')); }
      else chunks.push(chunk);
    });
    request.on('error', reject);
    request.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new BodyError(400, 'Parse error: invalid JSON.')); }
    });
  });
}
