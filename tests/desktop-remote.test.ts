import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { request, type IncomingMessage } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";
import { startDesktop, type DesktopOptions } from "../apps/desktop/src/main/core";
import { admit, agentIdFor, REFUSED_REMOTE } from "../apps/desktop/src/main/mcp-http";
import { bearerToken, bindAddresses, detectTailscale, FailureLimiter, isLocalRequest, isPrivateLan, isTailscaleV4, isTailscaleV6, newToken, parseServeStatus, parseTailscaleStatus, sameToken, type Interfaces } from "../apps/desktop/src/main/remote";
import type { RemoteStatus } from "../apps/desktop/src/shared/rpc";

const PORT = 7421;
/** A request as the server sees it: headers plus the socket's two ends. */
function fake(headers: Record<string, string>, socket: { localAddress?: string; remoteAddress?: string } = {}) {
  return { headers, socket: { localAddress: "127.0.0.1", remoteAddress: "127.0.0.1", ...socket } } as unknown as IncomingMessage;
}
const local = { host: `127.0.0.1:${PORT}` };
const serve = (extra: Record<string, string> = {}) => ({ host: "mac.tail1234.ts.net", "x-forwarded-for": "100.88.1.2", "x-forwarded-host": "mac.tail1234.ts.net", "x-forwarded-proto": "https", "tailscale-user-login": "ana@example.com", ...extra });

test("tokens: lz_ + 32 random bytes in base64url, compared in constant time; Bearer parsing", () => {
  const token = newToken();
  assert.match(token, /^lz_[A-Za-z0-9_-]{43}$/); assert.notEqual(token, newToken());
  assert.equal(sameToken(token, token), true); assert.equal(sameToken(token + "x", token), false); assert.equal(sameToken(null, token), false); assert.equal(sameToken(token, null), false);
  assert.equal(bearerToken(`Bearer ${token}`), token); assert.equal(bearerToken(`bearer  ${token} `), token);
  assert.equal(bearerToken(`Basic ${token}`), null); assert.equal(bearerToken(undefined), null); assert.equal(bearerToken("Bearer a b"), null);
});

test("admit: this computer needs no token, everything else needs sharing on and the token, browsers never", () => {
  const off = { enabled: false, token: null }, token = newToken(), on = { enabled: true, token };
  const limiter = () => new FailureLimiter();
  // This computer, as before: no token, a local Origin is fine, a foreign one is not.
  assert.deepEqual(admit(fake(local), PORT, off, limiter()), { ok: true, from: null });
  assert.deepEqual(admit(fake({ host: `localhost:${PORT}`, origin: `http://localhost:${PORT}` }), PORT, on, limiter()), { ok: true, from: null });
  assert.equal(admit(fake({ ...local, origin: "http://evil.example" }), PORT, on, limiter()).ok, false);
  // tailscale serve: from 127.0.0.1, but a ts.net Host and forwarding headers. Remote.
  assert.equal(isLocalRequest(fake(serve()), PORT), false);
  assert.equal(isLocalRequest(fake({ ...local, "x-forwarded-for": "100.88.1.2" }), PORT), false, "a proxy naming 127.0.0.1 is still a proxy");
  assert.equal(isLocalRequest(fake(local, { localAddress: "100.101.1.1", remoteAddress: "100.88.1.2" }), PORT), false, "a Host header cannot make another computer local");
  assert.deepEqual(admit(fake(serve()), PORT, off, limiter()), { ok: false, status: 403, message: REFUSED_REMOTE });
  assert.equal((admit(fake(serve()), PORT, on, limiter()) as { status: number }).status, 403, "no token");
  assert.equal((admit(fake(serve({ authorization: `Bearer ${newToken()}` })), PORT, on, limiter()) as { status: number }).status, 403, "wrong token");
  assert.deepEqual(admit(fake(serve({ authorization: `Bearer ${token}` })), PORT, on, limiter()), { ok: true, from: "ana@example.com" });
  assert.equal((admit(fake(serve({ authorization: `Bearer ${token}`, origin: "https://mac.tail1234.ts.net" })), PORT, on, limiter()) as { status: number }).status, 403, "a browser, even with the token");
  // Direct over Tailscale: the source is the socket's address; a Tailscale-User-Login header from there is not believed.
  const direct = fake({ host: `100.101.1.1:${PORT}`, authorization: `Bearer ${token}`, "tailscale-user-login": "mallory@example.com" }, { localAddress: "100.101.1.1", remoteAddress: "100.88.7.7" });
  assert.deepEqual(admit(direct, PORT, on, limiter()), { ok: true, from: "100.88.7.7" });
  // A new token: the old one stops working.
  assert.equal(admit(direct, PORT, { enabled: true, token: newToken() }, limiter()).ok, false);
  assert.equal(agentIdFor("Claude Code", "ana@example.com"), "mcp:claude-code@ana-example.com"); assert.equal(agentIdFor("Claude Code"), "mcp:claude-code");
});

test("failed tokens are limited to 10 a minute per source, then 429 even with the right token", () => {
  let now = 0; const limiter = new FailureLimiter(10, 60_000, () => now), token = newToken(), on = { enabled: true, token };
  const from = (ip: string, auth: string) => fake({ host: `100.101.1.1:${PORT}`, authorization: `Bearer ${auth}` }, { localAddress: "100.101.1.1", remoteAddress: ip });
  for (let i = 0; i < 10; i++) assert.equal((admit(from("100.88.0.1", "wrong"), PORT, on, limiter) as { status: number }).status, 403);
  assert.equal((admit(from("100.88.0.1", token), PORT, on, limiter) as { status: number }).status, 429);
  assert.equal(admit(from("100.88.0.2", token), PORT, on, limiter).ok, true, "other sources are not affected");
  now = 61_000;
  assert.equal(admit(from("100.88.0.1", token), PORT, on, limiter).ok, true, "the window passes");
});

const fixtureInterfaces: Interfaces = {
  lo: [{ address: "127.0.0.1", netmask: "255.0.0.0", family: "IPv4", mac: "00:00:00:00:00:00", internal: true, cidr: "127.0.0.1/8" }],
  en0: [
    { address: "192.168.1.20", netmask: "255.255.255.0", family: "IPv4", mac: "aa:aa:aa:aa:aa:aa", internal: false, cidr: "192.168.1.20/24" },
    { address: "fe80::1", netmask: "ffff:ffff:ffff:ffff::", family: "IPv6", mac: "aa:aa:aa:aa:aa:aa", internal: false, cidr: "fe80::1/64", scopeid: 4 },
  ],
  wan: [{ address: "203.0.113.9", netmask: "255.255.255.0", family: "IPv4", mac: "bb:bb:bb:bb:bb:bb", internal: false, cidr: "203.0.113.9/24" }],
  docker0: [{ address: "172.17.0.1", netmask: "255.255.0.0", family: "IPv4", mac: "cc:cc:cc:cc:cc:cc", internal: false, cidr: "172.17.0.1/16" }],
  utun4: [
    { address: "100.101.102.103", netmask: "255.255.255.255", family: "IPv4", mac: "00:00:00:00:00:00", internal: false, cidr: "100.101.102.103/32" },
    { address: "fd7a:115c:a1e0::1234", netmask: "ffff:ffff:ffff:ffff:ffff:ffff:ffff:ffff", family: "IPv6", mac: "00:00:00:00:00:00", internal: false, cidr: "fd7a:115c:a1e0::1234/128", scopeid: 0 },
  ],
};

test("listen addresses: Tailscale only (100.64/10, fd7a:115c:a1e0::/48), the private LAN only when asked, never a wildcard or a public address", () => {
  assert.ok(isTailscaleV4("100.64.0.1") && isTailscaleV4("100.127.255.255") && !isTailscaleV4("100.128.0.1") && !isTailscaleV4("100.63.0.1"));
  assert.ok(isTailscaleV6("fd7a:115c:a1e0:ab12::1") && !isTailscaleV6("fd7a:115c:a1e1::1"));
  assert.ok(isPrivateLan("10.1.2.3") && isPrivateLan("172.31.0.1") && isPrivateLan("192.168.0.1") && !isPrivateLan("172.32.0.1") && !isPrivateLan("100.101.1.1"));
  const tailscaleOnly = bindAddresses(fixtureInterfaces, false);
  assert.deepEqual(tailscaleOnly.map(bind => [bind.address, bind.kind]), [["100.101.102.103", "tailscale"], ["fd7a:115c:a1e0::1234", "tailscale"]]);
  const withLan = bindAddresses(fixtureInterfaces, true).map(bind => bind.address);
  assert.deepEqual(withLan, ["100.101.102.103", "fd7a:115c:a1e0::1234", "172.17.0.1", "192.168.1.20"]);
  for (const address of withLan) assert.ok(!["0.0.0.0", "::", "203.0.113.9", "127.0.0.1", "fe80::1"].includes(address));
  assert.deepEqual(bindAddresses({}, true), []);
});

test("the Tailscale CLI: status and serve JSON, the https address that proxies this port, and absent or stopped CLIs", async () => {
  const status = JSON.stringify({ BackendState: "Running", Self: { DNSName: "Mac-Book.tail1234.ts.net.", TailscaleIPs: ["100.101.102.103", "fd7a:115c:a1e0::1234", "8.8.8.8"] } });
  assert.deepEqual(parseTailscaleStatus(status), { running: true, dnsName: "mac-book.tail1234.ts.net", ips: ["100.101.102.103", "fd7a:115c:a1e0::1234"] });
  assert.deepEqual(parseTailscaleStatus(JSON.stringify({ BackendState: "Stopped", Self: { DNSName: "", TailscaleIPs: [] } })), { running: false, dnsName: null, ips: [] });
  assert.equal(parseTailscaleStatus("not json"), null); assert.equal(parseTailscaleStatus("{}"), null);
  const serve = (handlers: Record<string, unknown>, hostPort = "mac.tail1234.ts.net:443") => JSON.stringify({ TCP: { 443: { HTTPS: true } }, Web: { [hostPort]: { Handlers: handlers } } });
  assert.equal(parseServeStatus(serve({ "/": { Proxy: "http://127.0.0.1:7421" } }), 7421), "https://mac.tail1234.ts.net");
  assert.equal(parseServeStatus(serve({ "/": { Proxy: "http://localhost:7421" } }, "mac.tail1234.ts.net:8443"), 7421), "https://mac.tail1234.ts.net:8443");
  assert.equal(parseServeStatus(serve({ "/lienzo": { Proxy: "http://127.0.0.1:7421" } }), 7421), "https://mac.tail1234.ts.net/lienzo");
  assert.equal(parseServeStatus(serve({ "/": { Proxy: "http://127.0.0.1:3000" } }), 7421), null, "another port");
  assert.equal(parseServeStatus(serve({ "/": { Proxy: "http://10.0.0.5:7421" } }), 7421), null, "another computer");
  assert.equal(parseServeStatus(serve({ "/": { Path: "/var/www" } }), 7421), null);
  assert.equal(parseServeStatus("{}", 7421), null); assert.equal(parseServeStatus("", 7421), null);

  const calls: string[] = [];
  const found = await detectTailscale(7421, async (file, args) => {
    calls.push(`${file} ${args.join(" ")}`);
    if (file === "missing") throw Object.assign(new Error("not found"), { code: "ENOENT" });
    return args[0] === "status" ? status : serve({ "/": { Proxy: "http://127.0.0.1:7421" } });
  }, ["missing", "tailscale"]);
  assert.deepEqual(found, { found: true, running: true, dnsName: "mac-book.tail1234.ts.net", ips: ["100.101.102.103", "fd7a:115c:a1e0::1234"], serveUrl: "https://mac.tail1234.ts.net" });
  assert.deepEqual(calls, ["missing status --json", "tailscale status --json", "tailscale serve status --json"]);
  assert.equal((await detectTailscale(7421, async () => { throw Object.assign(new Error("x"), { code: "ENOENT" }); }, ["a", "b"])).found, false);
  const stopped = await detectTailscale(7421, async () => { throw Object.assign(new Error("failed to connect to local tailscaled"), { code: 1 }); }, ["tailscale"]);
  assert.deepEqual([stopped.found, stopped.dnsName, stopped.serveUrl], [true, null, null]);
});

// ---- The real server on loopback.
async function desktop(t: TestContext, directory?: string, remote?: DesktopOptions["remote"]) {
  const dir = directory ?? await mkdtemp(join(tmpdir(), "lienzo-remote-test-"));
  if (!directory) t.after(() => rm(dir, { recursive: true, force: true }));
  const app = await startDesktop({ dataDirectory: dir, version: "test", mcpPort: 0, remote: { interfaces: () => ({}), tailscale: async () => ({ found: false, running: false, dnsName: null, ips: [], serveUrl: null }), ...remote } });
  let closed = false;
  t.after(() => closed ? undefined : app.close());
  return { app, dir, close: async () => { closed = true; await app.close(); } };
}
const remoteCall = async (app: Awaited<ReturnType<typeof startDesktop>>, name: string, input: unknown = {}) => {
  const result = await app.settle(name, input) as { ok: boolean; value?: unknown; message?: string };
  assert.ok(result.ok, result.message); return result.value as RemoteStatus;
};
type Reply = { status: number; session: string | undefined; body: string };
function post(url: string, headers: Record<string, string>, body: unknown = { jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "Remote Agent", version: "1" } } }) {
  return new Promise<Reply>((resolve, reject) => {
    const call = request(url, { method: "POST", agent: false, headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers } }, response => {
      const chunks: Buffer[] = [];
      response.on("data", chunk => chunks.push(chunk)); response.on("end", () => resolve({ status: response.statusCode ?? 0, session: response.headers["mcp-session-id"] as string | undefined, body: Buffer.concat(chunks).toString("utf8") }));
    });
    call.on("error", reject); call.end(JSON.stringify(body));
  });
}

test("over real HTTP: a ts.net Host needs sharing on and the token; regenerating or turning off ends remote sessions", async t => {
  const { app } = await desktop(t), url = app.mcp.url, ts = { host: "x.tail1234.ts.net", "x-forwarded-for": "100.88.1.2", "tailscale-user-login": "ana@example.com" };
  assert.equal((await post(url, ts)).status, 403, "sharing is off by default");
  let status = await remoteCall(app, "desktop.remote.status", {});
  assert.deepEqual([status.enabled, status.lan, status.token, status.addresses], [false, false, null, []]);

  status = await remoteCall(app, "desktop.remote.set", { enabled: true });
  const token = status.token!;
  assert.match(token, /^lz_[A-Za-z0-9_-]{43}$/);
  assert.equal((await post(url, ts)).status, 403, "no token");
  assert.equal((await post(url, { ...ts, authorization: "Bearer lz_wrong" })).status, 403, "wrong token");
  assert.equal((await post(url, { ...ts, authorization: `Bearer ${token}`, origin: "https://x.tail1234.ts.net" })).status, 403, "a browser, even with the token");
  const ok = await post(url, { ...ts, authorization: `Bearer ${token}` });
  assert.equal(ok.status, 200, ok.body); assert.match(ok.body, /"serverInfo"/); assert.ok(ok.session);
  // This computer still needs nothing, and cannot use the remote session.
  const mine = await post(url, {});
  assert.equal(mine.status, 200);
  assert.equal((await post(url, { "mcp-session-id": ok.session! }, { jsonrpc: "2.0", method: "notifications/initialized" })).status, 404);
  // The remote session works with the token and is listed with its source.
  assert.equal((await post(url, { ...ts, authorization: `Bearer ${token}`, "mcp-session-id": ok.session! }, { jsonrpc: "2.0", method: "notifications/initialized" })).status, 202);
  const seen = ((await app.settle("desktop.status", {})) as { value: { mcp: { sharing: boolean; clients: { agentId: string; from: string | null }[] } } }).value.mcp;
  assert.equal(seen.sharing, true);
  assert.deepEqual(seen.clients.find(entry => entry.from)?.agentId, "mcp:remote-agent@ana-example.com");

  // Regenerate: the old token is refused and its session is gone, even with the new token.
  const fresh = (await remoteCall(app, "desktop.remote.regenerate")).token!;
  assert.notEqual(fresh, token);
  assert.equal((await post(url, { ...ts, authorization: `Bearer ${token}` })).status, 403);
  assert.equal((await post(url, { ...ts, authorization: `Bearer ${fresh}`, "mcp-session-id": ok.session! }, { jsonrpc: "2.0", method: "notifications/initialized" })).status, 404);
  const again = await post(url, { ...ts, authorization: `Bearer ${fresh}` });
  assert.equal(again.status, 200);

  // Off: remote sessions close at once and new ones are refused; this computer's session lives on.
  await remoteCall(app, "desktop.remote.set", { enabled: false });
  assert.equal((await post(url, { ...ts, authorization: `Bearer ${fresh}`, "mcp-session-id": again.session! }, { jsonrpc: "2.0", method: "notifications/initialized" })).status, 403);
  assert.equal((await post(url, { ...ts, authorization: `Bearer ${fresh}` })).status, 403);
  assert.equal((await post(url, { "mcp-session-id": mine.session! }, { jsonrpc: "2.0", method: "notifications/initialized" })).status, 202);
  // On again keeps the token, so agents already set up keep working.
  assert.equal((await remoteCall(app, "desktop.remote.set", { enabled: true })).token, fresh);
});

test("the choice and token are kept in settings.json (0600) across restarts; listeners follow Tailscale addresses only", async t => {
  let interfaces: Interfaces = { lo: fixtureInterfaces.lo };
  const first = await desktop(t, undefined, { interfaces: () => interfaces, intervalMs: 60_000, tailscale: async () => ({ found: true, running: true, dnsName: "mac.tail1234.ts.net", ips: ["100.101.102.103"], serveUrl: "https://mac.tail1234.ts.net" }) });
  const on = await remoteCall(first.app, "desktop.remote.set", { enabled: true });
  assert.deepEqual(on.listeners, [], "no Tailscale address yet");
  assert.deepEqual(on.addresses, [{ url: "https://mac.tail1234.ts.net/mcp", kind: "serve" }], "tailscale serve works without a direct listener");
  const file = join(first.dir, "settings.json");
  if (process.platform !== "win32") assert.equal((await stat(file)).mode & 0o777, 0o600);
  assert.equal(JSON.parse(await readFile(file, "utf8"))["desktop-remote"].values.token, on.token);

  // Tailscale comes up: only its addresses are tried (here they do not exist, so they report it), never a wildcard.
  interfaces = fixtureInterfaces;
  await first.app.remote.refreshAddresses();
  let status = await remoteCall(first.app, "desktop.remote.status", { refresh: true });
  assert.deepEqual(status.listeners.map(entry => entry.address), ["100.101.102.103", "fd7a:115c:a1e0::1234"]);
  for (const entry of status.listeners) assert.equal(entry.listening, false);
  status = await remoteCall(first.app, "desktop.remote.set", { lan: true });
  assert.deepEqual(status.listeners.map(entry => [entry.address, entry.kind]), [["100.101.102.103", "tailscale"], ["fd7a:115c:a1e0::1234", "tailscale"], ["172.17.0.1", "lan"], ["192.168.1.20", "lan"]]);
  await remoteCall(first.app, "desktop.remote.set", { lan: false });
  await first.close();

  const second = await desktop(t, first.dir, { interfaces: () => ({}) });
  const kept = await remoteCall(second.app, "desktop.remote.status", {});
  assert.deepEqual([kept.enabled, kept.lan, kept.token], [true, false, on.token]);
  assert.equal(second.app.mcp.sharingEnabled, true);
  assert.deepEqual((await remoteCall(second.app, "desktop.remote.set", { enabled: false })).listeners, []);
});

test("an extra listener on another loopback address is remote: it needs the token, and closes when sharing turns off", { skip: process.platform !== "linux" && "127.0.0.2 is only bound by default on Linux" }, async t => {
  const { app } = await desktop(t);
  const token = (await remoteCall(app, "desktop.remote.set", { enabled: true })).token!;
  await app.mcp.setAddresses([{ address: "127.0.0.2", family: 4, kind: "tailscale" }]);
  assert.deepEqual(app.mcp.listeners().map(entry => [entry.address, entry.listening]), [["127.0.0.2", true]]);
  const url = app.mcp.url.replace("127.0.0.1", "127.0.0.2");
  assert.equal((await post(url, {})).status, 403);
  assert.equal((await post(url, { host: `127.0.0.1:${app.mcp.port}`, authorization: "Bearer nope" })).status, 403);
  assert.equal((await post(url, { authorization: `Bearer ${token}` })).status, 200);
  await remoteCall(app, "desktop.remote.set", { enabled: false });
  assert.deepEqual(app.mcp.listeners(), []);
  await assert.rejects(post(url, { authorization: `Bearer ${token}` }), /ECONNREFUSED/);
});
