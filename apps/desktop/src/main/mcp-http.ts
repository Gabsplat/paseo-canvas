import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema, isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { toolDefinitions } from '../../../../plugin/server/tools';
import { errorResponse } from '../../../../plugin/server/bridge';
import type { McpClient } from '../shared/rpc';
import { FailureLimiter, bearerToken, isLocalRequest, localHosts, requestSource, sameToken, type BindAddress } from './remote';

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
/** `from`: null for a program on this computer; otherwise who called in from another one (Tailscale login or address). */
type Session = { transport: StreamableHTTPServerTransport; server: Server; agentId: string | null; lastSeen: number; from: string | null };
/** Agents on other computers: off, or on with the one token they must send. */
export interface Sharing { readonly enabled: boolean; readonly token: string | null }
export type Admission = { ok: true; from: string | null } | { ok: false; status: number; message: string };
export const REFUSED_REMOTE = 'Forbidden: Lienzo MCP accepts local clients only. To let agents on other computers connect, turn it on in Lienzo → Settings → Agents.';

/**
 * Who may call. A program on this computer (isLocalRequest) needs nothing, as before, unless it is a browser page.
 * Everything else, `tailscale serve` included, needs sharing on and `Authorization: Bearer <token>`; browsers never
 * get in from another computer, token or not. Failed tokens are limited per source.
 */
export function admit(request: IncomingMessage, port: number, sharing: Sharing, limiter: FailureLimiter, viaLoopbackListener = true): Admission {
  const origin = request.headers.origin;
  if (viaLoopbackListener && isLocalRequest(request, port)) return origin === undefined || localHosts(port).some(host => origin === `http://${host}`) ? { ok: true, from: null } : { ok: false, status: 403, message: 'Forbidden: browser pages cannot use Lienzo MCP.' };
  if (!sharing.enabled || !sharing.token) return { ok: false, status: 403, message: REFUSED_REMOTE };
  if (origin !== undefined) return { ok: false, status: 403, message: 'Forbidden: browser pages cannot use Lienzo MCP.' };
  const source = requestSource(request);
  if (limiter.blocked(source.ip)) return { ok: false, status: 429, message: 'Too many attempts with a wrong token. Wait a minute and try again.' };
  const given = bearerToken(request.headers.authorization);
  if (!sameToken(given, sharing.token)) {
    limiter.fail(source.ip);
    return { ok: false, status: 403, message: given ? 'Forbidden: the access token is wrong or was regenerated. Copy the current one from Lienzo → Settings → Agents.' : 'Forbidden: agents on other computers must send Authorization: Bearer <token>. Copy the command from Lienzo → Settings → Agents.' };
  }
  return { ok: true, from: source.login ?? source.ip };
}

/** A stable agent identity for an MCP client: its declared name, so reconnects keep their canvases and undo. */
export function agentIdFor(name: string | undefined, from: string | null = null) {
  const slug = (text: string) => text.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
  // An agent on another computer is its own identity, with its own undo: `mcp:claude-code@ana-example.com`.
  return `mcp:${slug(name ?? '') || 'client'}${from ? `@${slug(from) || 'remote'}` : ''}`;
}

/**
 * The canvas tools over MCP streamable HTTP on 127.0.0.1, using the official MCP SDK. Stateful sessions: each
 * initialize gets its own SDK server and transport, and the client's declared name becomes its agent identity.
 * Requests from browsers (an Origin header that is not this server) are refused, so a web page cannot drive it; requests
 * from other computers need sharing on and its token (admit). With sharing on it also listens on the Tailscale (and,
 * if asked, LAN) addresses it is given, never on every interface. There is no way to reach an agent from here.
 */
export class McpHttpServer {
  private http: HttpServer | null = null;
  /** Extra listeners for other computers, by address; `error` when that address could not be used. */
  private readonly extra = new Map<string, { bind: BindAddress; http: HttpServer | null; error: string | null }>();
  private sharing: Sharing = { enabled: false, token: null };
  private readonly limiter: FailureLimiter;
  private readonly sessions = new Map<string, Session>();
  private readonly seen = new Map<string, McpClient>();
  private boundPort: number | null = null;
  private readonly now: () => number;
  constructor(private readonly options: McpHttpOptions) { this.now = options.now ?? Date.now; this.limiter = new FailureLimiter(10, 60_000, this.now); }

  get port() { return this.boundPort ?? this.options.port; }
  get url() { return `http://127.0.0.1:${this.port}/mcp`; }
  get listening() { return !!this.http?.listening; }
  clients(): McpClient[] { return [...this.seen.values()].sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt)); }
  get sharingEnabled() { return this.sharing.enabled && !!this.sharing.token; }
  /** The extra listeners and whether each one is open. */
  listeners() { return [...this.extra.values()].map(entry => ({ ...entry.bind, listening: !!entry.http?.listening, error: entry.error })); }

  private listen(port: number, address: string, primary = false) {
    const http = createServer((request, response) => { void this.route(request, response, primary); });
    http.requestTimeout = 60_000; http.headersTimeout = 10_000;
    return new Promise<HttpServer>((resolve, reject) => {
      http.once('error', reject);
      http.listen(port, address, () => { http.off('error', reject); resolve(http); });
    });
  }
  async start(): Promise<number> {
    const http = await this.listen(this.options.port, '127.0.0.1', true);
    const address = http.address();
    this.boundPort = address && typeof address === 'object' ? address.port : this.options.port;
    this.http = http;
    return this.boundPort;
  }
  async close() {
    await this.setSharing({ enabled: false, token: null });
    await this.setAddresses([]);
    await Promise.all([...this.sessions.values()].map(session => session.transport.close().catch(() => {})));
    this.sessions.clear();
    const http = this.http; this.http = null;
    if (http) await stop(http);
  }
  /**
   * Turns agents on other computers on or off, or changes their token. Off, or a new token, closes every session from
   * another computer at once; their next request is refused.
   */
  async setSharing(next: Sharing) {
    const before = this.sharing;
    this.sharing = { enabled: next.enabled, token: next.token };
    if (!next.enabled || before.token !== next.token) { this.limiter.clear(); await this.closeRemoteSessions(); }
  }
  async closeRemoteSessions() {
    const remote = [...this.sessions.entries()].filter(([, session]) => session.from !== null);
    for (const [id] of remote) this.sessions.delete(id);
    await Promise.all(remote.map(([, session]) => session.transport.close().catch(() => {})));
  }
  /**
   * Listens on exactly these addresses besides 127.0.0.1, on the same port: new ones open, missing ones close. Wildcard
   * addresses are refused here as well as in bindAddresses. Needs the loopback listener (its port) first.
   */
  async setAddresses(binds: readonly BindAddress[]) {
    const wanted = new Map(binds.filter(bind => !['0.0.0.0', '::', ''].includes(bind.address)).map(bind => [bind.address, bind]));
    for (const [address, entry] of [...this.extra]) if (!wanted.has(address)) { this.extra.delete(address); if (entry.http) await stop(entry.http); }
    if (!this.http) return;
    for (const [address, bind] of wanted) {
      const current = this.extra.get(address);
      if (current?.http) continue;
      const entry = { bind, http: null as HttpServer | null, error: null as string | null };
      this.extra.set(address, entry);
      try { entry.http = await this.listen(this.port, address); }
      catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        entry.error = code === 'EADDRINUSE' ? `Port ${this.port} is in use on ${address}.` : code === 'EADDRNOTAVAIL' ? `${address} is not available yet.` : `Could not listen on ${address}.`;
      }
      // Gone or replaced while it was opening.
      if (this.extra.get(address) !== entry && entry.http) await stop(entry.http);
    }
  }

  private touch(session: Session, toolCall = false) {
    session.lastSeen = this.now();
    if (!session.agentId) return;
    const entry = this.seen.get(session.agentId);
    if (entry) { entry.lastSeenAt = new Date(session.lastSeen).toISOString(); if (toolCall) entry.toolCalls++; }
  }
  private createSession(from: string | null): Session {
    const server = new Server({ name: 'lienzo', version: this.options.version }, { capabilities: { tools: {} }, instructions: this.options.instructions });
    const session: Session = { server, agentId: null, lastSeen: this.now(), from, transport: undefined as unknown as StreamableHTTPServerTransport };
    server.oninitialized = () => {
      const client = server.getClientVersion(), agentId = agentIdFor(client?.name, from), at = new Date(this.now()).toISOString();
      session.agentId = agentId;
      const entry = this.seen.get(agentId);
      this.seen.set(agentId, { agentId, name: client?.name?.slice(0, 200) || 'MCP client', version: client?.version?.slice(0, 60) ?? '', firstSeenAt: entry?.firstSeenAt ?? at, lastSeenAt: at, toolCalls: entry?.toolCalls ?? 0, from });
    };
    server.setRequestHandler(ListToolsRequestSchema, async () => { this.touch(session); return { tools: toolDefinitions }; });
    server.setRequestHandler(CallToolRequestSchema, async request => {
      this.touch(session, true);
      const agentId = session.agentId ?? agentIdFor(server.getClientVersion()?.name, from);
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

  /** A session is used only from where it started: this computer's sessions are not reachable from another. */
  private session(id: string, from: string | null) {
    const session = this.sessions.get(id);
    return session && (session.from === null) === (from === null) ? session : undefined;
  }
  private async route(request: IncomingMessage, response: ServerResponse, primary: boolean) {
    const fail = (status: number, message: string, code = -32000) => {
      if (response.headersSent) { response.end(); return; }
      response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      response.end(JSON.stringify({ jsonrpc: '2.0', error: { code, message }, id: null }));
    };
    try {
      const path = (request.url ?? '').split('?')[0];
      const admission = admit(request, this.port, this.sharing, this.limiter, primary);
      if (!admission.ok) { request.resume(); return fail(admission.status, admission.message); }
      const from = admission.from;
      if (path !== '/mcp') { request.resume(); return fail(404, 'Not found. The MCP endpoint is /mcp.'); }
      const header = request.headers['mcp-session-id'], sessionId = typeof header === 'string' ? header : undefined;
      if (request.method === 'POST') {
        const body = await readJson(request);
        if (sessionId) {
          const session = this.session(sessionId, from);
          if (!session) return fail(404, 'Session not found. Start a new MCP session.', -32001);
          this.touch(session);
          return await session.transport.handleRequest(request, response, body);
        }
        if (!isInitializeRequest(body)) return fail(400, 'Bad request: send initialize first.');
        const session = this.createSession(from);
        await session.server.connect(session.transport);
        return await session.transport.handleRequest(request, response, body);
      }
      if (request.method === 'GET' || request.method === 'DELETE') {
        const session = sessionId ? this.session(sessionId, from) : undefined;
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

async function stop(http: HttpServer) {
  http.closeAllConnections();
  await new Promise<void>(resolve => http.close(() => resolve()));
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
