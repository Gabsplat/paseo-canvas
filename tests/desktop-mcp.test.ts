import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { request } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { startDesktop } from "../apps/desktop/src/main/core";
import { DESKTOP_WORKSPACE } from "../apps/desktop/src/shared/rpc";
import { CanvasStore } from "../plugin/server/store";
import { CanvasService } from "../plugin/server/service";
import { toolNames } from "../plugin/server/tools";
import { content } from "./helpers";

async function desktop(t: TestContext, prepare?: (directory: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), "lienzo-desktop-test-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await prepare?.(directory);
  // Port 0: the system picks a free port, so tests never collide with a running app.
  const app = await startDesktop({ dataDirectory: directory, version: "test", mcpPort: 0 });
  t.after(() => app.close());
  return app;
}
async function connect(t: TestContext, url: string, name = "Test Agent") {
  const client = new Client({ name, version: "1.2.3" }), transport = new StreamableHTTPClientTransport(new URL(url));
  await client.connect(transport);
  t.after(() => client.close());
  return client;
}
/** The panel's view of a call: the same settle the IPC handler and the preview bridge use. */
const settle = (app: Awaited<ReturnType<typeof startDesktop>>, name: string, input: unknown) => app.settle(name, input) as Promise<{ ok: boolean; value?: unknown; message?: string }>;
const json = (result: Awaited<ReturnType<Client["callTool"]>>) => JSON.parse((result.content as { type: string; text: string }[])[0].text);
function raw(url: string, headers: Record<string, string>) {
  return new Promise<number>((resolve, reject) => {
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "x", version: "1" } } });
    const call = request(url, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers } }, response => { response.resume(); resolve(response.statusCode ?? 0); });
    call.on("error", reject); call.end(body);
  });
}

test("the desktop MCP server lists the canvas tools, creates a document and reads it back over real HTTP", async t => {
  const app = await desktop(t);
  assert.ok(app.mcp.listening); assert.match(app.mcp.url, /^http:\/\/127\.0\.0\.1:\d+\/mcp$/);
  const client = await connect(t, app.mcp.url);
  assert.match(client.getInstructions() ?? "", /never messages you/); assert.match(client.getInstructions() ?? "", /canvas_selection/);

  const { tools } = await client.listTools();
  assert.deepEqual(tools.map(tool => tool.name).sort(), [...toolNames].sort());

  const created = json(await client.callTool({ name: "canvas_create", arguments: { id: "map", content: content() } }));
  assert.deepEqual([created.documentId, created.revision, created.copilot.enabled], ["map", 0, false]);
  const read = json(await client.callTool({ name: "canvas_read", arguments: { documentId: "map", view: "full" } }));
  assert.equal(read.document.title, "Test document");
  assert.deepEqual(read.document.blocks.map((block: { id: string }) => block.id), ["b", "c"]);
  assert.equal(read.document.workspaceId, DESKTOP_WORKSPACE);

  // A failed transaction comes back as a tool error with the canvas error code, not as a transport failure.
  const stale = await client.callTool({ name: "canvas_apply", arguments: { documentId: "map", expectedRevision: 7, operations: [{ type: "block.delete", id: "c" }] } });
  assert.equal(stale.isError, true); assert.equal(json(stale).code, "REVISION_CONFLICT");

  // The panel sees the agent's document through the same core, and knows who called in.
  const listed = await settle(app, "canvas.list", { workspaceId: DESKTOP_WORKSPACE });
  assert.ok(listed.ok); assert.deepEqual((listed.value as { documents: { id: string }[] }).documents.map(document => document.id), ["map"]);
  const status = await settle(app, "desktop.status", {});
  assert.ok(status.ok);
  const clients = (status.value as { mcp: { clients: { agentId: string; name: string; toolCalls: number }[] } }).mcp.clients;
  assert.deepEqual(clients.map(entry => [entry.agentId, entry.name, entry.toolCalls]), [["mcp:test-agent", "Test Agent", 3]]);
  const view = await settle(app, "canvas.read", { workspaceId: DESKTOP_WORKSPACE, documentId: "map" });
  assert.equal((view.value as { connection: { agentId: string } | null }).connection?.agentId, "mcp:test-agent", "using a canvas connects the agent to it");
});

test("the person selects in the app and the agent reads it over MCP; no method sends to the agent; browsers and foreign hosts are refused", async t => {
  const app = await desktop(t), client = await connect(t, app.mcp.url, "Codex");
  json(await client.callTool({ name: "canvas_create", arguments: { id: "map", content: content() } }));
  const view = (await settle(app, "canvas.read", { workspaceId: DESKTOP_WORKSPACE, documentId: "map" })).value as { selectionVersion: number };
  assert.ok((await settle(app, "canvas.selection.set", { workspaceId: DESKTOP_WORKSPACE, documentId: "map", expectedSelectionVersion: view.selectionVersion, ids: ["b"] })).ok);
  const selected = json(await client.callTool({ name: "canvas_selection", arguments: {} }));
  assert.deepEqual([selected.documentId, selected.ids, selected.entities[0].entity.title], ["map", ["b"], "B"]);
  for (const gone of ["canvas.agent.action", "canvas.agent.events", "canvas.agent.events.flush"]) assert.deepEqual(await settle(app, gone, {}), { ok: false, message: `NOT_FOUND: Unknown method ${gone}.` });
  const events = await client.callTool({ name: "canvas_events", arguments: { documentId: "map" } });
  assert.equal(events.isError, true);

  const port = new URL(app.mcp.url).port;
  assert.equal(await raw(app.mcp.url, { origin: "http://evil.example" }), 403);
  assert.equal(await raw(app.mcp.url, { host: `evil.example:${port}` }), 403);
  assert.equal(await raw(app.mcp.url.replace("/mcp", "/other"), {}), 404);
  assert.equal(await raw(app.mcp.url, { "mcp-session-id": "not-a-session" }), 404, "an unknown session must start over");
  // Unknown panel methods and invalid input are refused with a code, never a stack or a path.
  assert.deepEqual(await settle(app, "canvas.nope", {}), { ok: false, message: "NOT_FOUND: Unknown method canvas.nope." });
  const invalid = await settle(app, "canvas.read", { workspaceId: DESKTOP_WORKSPACE });
  assert.equal(invalid.ok, false);
});

test("a Paseo state file copied in shows its documents in the app's one workspace", async t => {
  const app = await desktop(t, async directory => {
    const store = new CanvasStore(join(directory, "canvas")), service = new CanvasService(store);
    await service.create({ workspaceId: "paseo-workspace", id: "from-paseo", content: content() }, "agent", { agentId: "paseo-agent", workspaceId: "paseo-workspace" });
    await service.mutate({ workspaceId: "paseo-workspace", documentId: "from-paseo", expectedRevision: 0, label: "Edit", operations: [{ type: "block.update", id: "b", patch: { title: "Edited in Paseo" } }] });
    await store.close();
  });
  const listed = await settle(app, "canvas.list", { workspaceId: DESKTOP_WORKSPACE });
  assert.deepEqual((listed.value as { documents: { id: string }[] }).documents.map(document => document.id), ["from-paseo"]);
  const view = (await settle(app, "canvas.read", { workspaceId: DESKTOP_WORKSPACE, documentId: "from-paseo" })).value as { connection: unknown; document: { blocks: { title: string }[] }; canUndo: boolean };
  assert.equal(view.connection, null, "Paseo agents do not exist here");
  assert.equal(view.document.blocks[0].title, "Edited in Paseo");
  // History came along: the person can still undo the edit made in Paseo.
  assert.equal((await settle(app, "canvas.history", { workspaceId: DESKTOP_WORKSPACE, documentId: "from-paseo" })).ok, true);
});

test("host settings keep Paseo's revision rules", async t => {
  const app = await desktop(t);
  const first = await settle(app, "settings.interface.read", {});
  assert.deepEqual(first.value, { status: "ready", revision: "0", values: { pinned: [], shortcuts: {} } });
  const saved = await settle(app, "settings.interface.write", { revision: "0", values: { pinned: ["tool.pencil"], shortcuts: {} } });
  assert.deepEqual(saved.value, { status: "saved", revision: "1", values: { pinned: ["tool.pencil"], shortcuts: {} } });
  const stale = await settle(app, "settings.interface.write", { revision: "0", values: { pinned: [], shortcuts: {} } });
  assert.equal((stale.value as { status: string }).status, "conflict");
  const reset = await settle(app, "settings.interface.reset", { revision: "1" });
  assert.deepEqual(reset.value, { status: "saved", revision: "2", values: { pinned: [], shortcuts: {} } });
});
