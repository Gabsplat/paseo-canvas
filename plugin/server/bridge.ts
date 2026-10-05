import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { CanvasError } from "../shared/errors";
import { atomicWrite } from "./store";
import { bridgeSource } from "./bridge-source";
import type { ToolRouter } from "./tools";

export function errorResponse(error: unknown) {
  if (error instanceof CanvasError) {
    const statuses = { REVISION_CONFLICT: 409, NOT_FOUND: 404, VALIDATION: 400, INVARIANT: 422, UNKNOWN_TYPE: 422, UNDO_BLOCKED: 409, FORBIDDEN: 403, TOO_LARGE: 413, UNAVAILABLE: 503 };
    return { status: statuses[error.code], error: { code: error.code, message: error.message, details: error.details } };
  }
  if (error instanceof z.ZodError) return { status: 400, error: { code: "VALIDATION", message: "Input does not match the canvas contract.", details: { issues: error.issues.map(issue => ({ path: issue.path.join("."), message: issue.message })) } } };
  if (error instanceof SyntaxError) return { status: 400, error: { code: "VALIDATION", message: "Invalid JSON." } };
  // Never return private paths, stack traces, or SDK configuration in errors.
  return { status: 500, error: { code: "UNAVAILABLE", message: "Canvas operation failed. Check plugin logs." } };
}
export class CanvasBridge {
  readonly endpoint: string;
  readonly script: string;
  private server: Server | null = null;
  private ready: Promise<void> | null = null;
  private readonly token = randomBytes(32).toString("hex");
  constructor(readonly directory: string, readonly router: ToolRouter) {
    this.endpoint = join(directory, "bridge.json"); this.script = join(directory, "canvas-mcp.cjs");
  }
  ensure(): Promise<void> { return this.ready ??= this.start().catch(async error => { await this.stopServer(); this.ready = null; throw error; }); }
  private async start(): Promise<void> {
    await this.router.service.store.initialize();
    await mkdir(this.directory, { recursive: true, mode: 0o700 });
    await atomicWrite(this.script, bridgeSource());
    this.server = createServer((request, response) => { void this.handle(request, response); });
    this.server.requestTimeout = 35000; this.server.headersTimeout = 10000;
    await new Promise<void>((resolve, reject) => {
      this.server!.once("error", reject);
      this.server!.listen(0, "127.0.0.1", () => { this.server!.off("error", reject); resolve(); });
    });
    const address = this.server.address();
    if (!address || typeof address === "string") throw new CanvasError("UNAVAILABLE", "Canvas loopback listener failed.");
    await atomicWrite(this.endpoint, JSON.stringify({ port: address.port, token: this.token }));
  }
  private async handle(request: IncomingMessage, response: ServerResponse) {
    const send = (status: number, data: unknown) => { if (!response.destroyed && !response.headersSent) { response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" }); response.end(JSON.stringify(data)); } };
    try {
      const actual = Buffer.from(request.headers.authorization ?? ""), expected = Buffer.from(`Bearer ${this.token}`);
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) { request.resume(); send(401, { error: { code: "FORBIDDEN", message: "Unauthorized" } }); return; }
      if (request.headers.origin) { request.resume(); send(403, { error: { code: "FORBIDDEN", message: "Browser origins cannot call this bridge." } }); return; }
      if (request.method !== "POST" || request.url !== "/tool") { request.resume(); send(404, { error: { code: "NOT_FOUND", message: "Not found" } }); return; }
      const owner = request.headers["x-canvas-owner"];
      if (typeof owner !== "string" || !/^owner_[a-f0-9]{32}$/.test(owner)) throw new CanvasError("FORBIDDEN", "Owner context required. Use canvas.agent.setup and reload the idle agent.");
      if (Number(request.headers["content-length"]) > 1024 * 1024) throw new CanvasError("TOO_LARGE", "Request exceeds 1 MiB.");
      const data = await new Promise<Buffer>((resolve, reject) => {
        let size = 0; const chunks: Buffer[] = [];
        const onError = (error: Error) => { cleanup(); reject(error); };
        const onEnd = () => { cleanup(); resolve(Buffer.concat(chunks)); };
        const onData = (chunk: Buffer) => {
          size += chunk.length;
          if (size > 1024 * 1024) { cleanup(); request.resume(); reject(new CanvasError("TOO_LARGE", "Request exceeds 1 MiB.")); }
          else chunks.push(Buffer.from(chunk));
        };
        const cleanup = () => { request.off("data", onData); request.off("end", onEnd); request.off("error", onError); };
        request.on("data", onData); request.on("end", onEnd); request.on("error", onError);
      });
      const body = z.object({ name: z.string(), arguments: z.unknown() }).strict().parse(JSON.parse(data.toString("utf8")));
      send(200, await this.router.call(body.name, body.arguments, owner));
    } catch (error) { const result = errorResponse(error); request.resume(); send(result.status, { error: result.error }); }
  }
  private async stopServer() {
    if (!this.server) return;
    const server = this.server; this.server = null;
    server.closeAllConnections();
    await new Promise<void>(resolve => server.close(() => resolve()));
  }
  async close(): Promise<void> {
    await this.ready?.catch(() => {}); await this.stopServer();
    try { if (JSON.parse(await readFile(this.endpoint, "utf8")).token === this.token) await rm(this.endpoint, { force: true }); }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    this.ready = null;
  }
}
