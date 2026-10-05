import test from "node:test";
import assert from "node:assert/strict";
import { readFile, stat } from "node:fs/promises";
import { request } from "node:http";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { CanvasBridge } from "../plugin/server/bridge";
import { CanvasStore } from "../plugin/server/store";
import { CanvasService } from "../plugin/server/service";
import { ToolRouter } from "../plugin/server/tools";
import { setup, workspaceId, fakeGateway, mutation } from "./helpers";

async function post(endpoint: { port: number; token: string }, name: string, args: unknown, owner?: string, auth: "valid" | "wrong" | "absent" = "valid", origin?: string) {
  const body = JSON.stringify({ name, arguments: args });
  return new Promise<{ status: number; data: { error?: { code: string; details?: Record<string, unknown> } } }>((resolve, reject) => {
    const req = request({ hostname: "127.0.0.1", port: endpoint.port, method: "POST", path: "/tool", headers: {
      "content-type": "application/json", "content-length": Buffer.byteLength(body),
      ...(auth !== "absent" ? { authorization: `Bearer ${auth === "valid" ? endpoint.token : "wrong"}` } : {}),
      ...(owner ? { "x-canvas-owner": owner } : {}), ...(origin ? { origin } : {}),
    } }, response => {
      const chunks: Buffer[] = []; response.on("data", chunk => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode!, data: JSON.parse(Buffer.concat(chunks).toString()) }));
      response.on("error", reject);
    });
    req.on("error", reject); req.end(body);
  });
}
function resultData(result: Awaited<ReturnType<Client["callTool"]>>) {
  const content = result.content as { type: string; text?: string }[];
  assert.equal(content[0].type, "text");
  return JSON.parse(content[0].text!) as Record<string, unknown>;
}

test("bridge binds loopback, authenticates, verifies owner via SDK workspace and reports conflicts as HTTP409", async t => {
  const { directory, service } = await setup(t);
  const { gateway } = fakeGateway(service);
  const bridge = new CanvasBridge(directory, new ToolRouter(service, owner => gateway.scope(owner)));
  t.after(() => bridge.close()); await bridge.ensure();
  const endpoint = JSON.parse(await readFile(bridge.endpoint, "utf8"));
  const owner = await service.allocateOwner("a"), outsider = await service.allocateOwner("outsider");
  assert.equal((await stat(bridge.endpoint)).mode & 0o777, 0o600);
  assert.equal((await stat(bridge.script)).mode & 0o777, 0o600);
  assert.equal((await post(endpoint, "canvas_list", {}, owner, "absent")).status, 401);
  assert.equal((await post(endpoint, "canvas_list", {}, owner, "wrong")).status, 401);
  assert.equal((await post(endpoint, "canvas_list", {})).status, 403);
  assert.equal((await post(endpoint, "canvas_list", {}, owner, "valid", "https://untrusted.test")).status, 403);
  assert.equal((await post(endpoint, "canvas_read", { documentId: "d" }, outsider)).status, 403);
  // Connection is a feedback destination, not a document ACL.
  assert.equal((await post(endpoint, "canvas_read", { documentId: "d" }, owner)).status, 200);
  assert.equal((await post(endpoint, "canvas_create", { ignored: "x".repeat(1024 * 1024) }, owner)).status, 413);
  await service.mutate(mutation(0, [{ type: "block.update", id: "b", patch: { title: "New" } }]));
  const stale = await post(endpoint, "canvas_apply", { documentId: "d", expectedRevision: 0, operations: [{ type: "block.update", id: "b", patch: { title: "Old" } }] }, owner);
  assert.equal(stale.status, 409); assert.equal(stale.data.error!.code, "REVISION_CONFLICT");
  assert.equal(stale.data.error!.details!.currentRevision, 1);
});

test("real MCP SDK stdio protocol roundtrip shares UI state and existing client survives bridge/store reopen", async t => {
  const { directory, store, service } = await setup(t);
  let gateway = fakeGateway(service).gateway;
  const bridge = new CanvasBridge(directory, new ToolRouter(service, owner => gateway.scope(owner)));
  await bridge.ensure();
  const owner = await service.allocateOwner("a");
  const transport = new StdioClientTransport({ command: process.execPath, args: [bridge.script, bridge.endpoint, owner], stderr: "pipe" });
  const client = new Client({ name: "canvas-integration-tests", version: "1.0.0" });
  t.after(async () => { await client.close(); await bridge.close(); });
  await client.connect(transport);
  const tools = await client.listTools();
  for (const name of ["canvas_read", "canvas_apply", "canvas_group", "canvas_catalog", "canvas_undo"]) assert.ok(tools.tools.some(tool => tool.name === name));
  const catalog = resultData(await client.callTool({ name: "canvas_catalog", arguments: { action: "list" } }));
  assert.equal(catalog.revision, 0);
  assert.ok((catalog.blockTypes as { id: string }[]).some(type => type.id === "diagram"));
  const applied = await client.callTool({ name: "canvas_apply", arguments: { documentId: "d", expectedRevision: 0, operations: [{ type: "block.update", id: "b", patch: { data: { text: "MCP changed it" } } }] } });
  assert.equal(resultData(applied).revision, 1);
  assert.equal((await service.read({ documentId: "d", workspaceId })).document.blocks[0].data.text, "MCP changed it");
  const invalid = await client.callTool({ name: "canvas_apply", arguments: { documentId: "d", expectedRevision: 1, operations: [{ type: "block.update", id: "b", patch: { typeId: "missing" } }] } });
  assert.equal(invalid.isError, true); assert.equal(resultData(invalid).code, "UNKNOWN_TYPE");
  await bridge.close(); await store.close();
  const reopenedStore = new CanvasStore(directory), reopenedService = new CanvasService(reopenedStore);
  gateway = fakeGateway(reopenedService).gateway;
  const reopenedBridge = new CanvasBridge(directory, new ToolRouter(reopenedService, owner => gateway.scope(owner)));
  t.after(async () => { await reopenedBridge.close(); await reopenedStore.close(); });
  await reopenedBridge.ensure();
  await reopenedService.mutate(mutation(1, [{ type: "block.update", id: "b", patch: { title: "After reopen" } }]));
  const current = resultData(await client.callTool({ name: "canvas_read", arguments: { documentId: "d", ids: ["b"] } }));
  assert.equal(current.revision, 2);
  assert.equal((current.entities as { entity: { title: string } }[])[0].entity.title, "After reopen");
  assert.equal(await reopenedService.owner(owner), "a");
});
