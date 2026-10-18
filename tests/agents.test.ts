import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as rpc from "../plugin/shared/rpc";
import { injectAgent, prepareCreation, ownerEnvironment } from "../plugin/server/agent-integration";
import { CanvasBridge } from "../plugin/server/bridge";
import { ToolRouter, integrationInstructions } from "../plugin/server/tools";
import type { PluginBeforeRequests } from "@getpaseo/plugin/server";
import { CanvasStore } from "../plugin/server/store";
import { CanvasService } from "../plugin/server/service";
import { setup, workspaceId, fakeGateway, content } from "./helpers";


test("graph guidance reaches Codex without altering its preapproval visibility workaround", () => {
  const request = { config: { provider: "codex", cwd: "/workspace/a", systemPrompt: "Original task", toolPolicy: { preapproved: [{ kind: "mcp", server: "paseo-canvas", tool: "canvas_apply" }, { kind: "mcp", server: "other", tool: "read" }] } } } as PluginBeforeRequests["agent.create"];
  const result = injectAgent(request, { script: "/private/canvas.cjs", endpoint: "/private/bridge.json" }, "owner");
  assert.equal(result.config.systemPrompt, `Original task\n\n${integrationInstructions}`);
  assert.match(result.config.systemPrompt!, /copilot/);
  assert.deepEqual(result.config.toolPolicy?.preapproved, [{ kind: "mcp", server: "other", tool: "read" }]);
  assert.equal(request.config.toolPolicy?.preapproved?.length, 2);
});

test("injection preserves unrelated config/custom MCP and excludes internal/unsupported agents", async t => {
  const { service } = await setup(t);
  const owner = await service.allocateOwner();
  const bridge = { script: "/private/canvas-mcp.cjs", endpoint: "/private/bridge.json" };
  const request: PluginBeforeRequests["agent.create"] = { config: { provider: "codex", cwd: "/workspace/a", systemPrompt: "Existing", mcpServers: { other: { type: "stdio", command: "other" } } }, env: { KEEP: "yes" } };
  const next = injectAgent(request, bridge, owner);
  assert.deepEqual(next.config.mcpServers!.other, request.config.mcpServers!.other);
  assert.equal(next.env![ownerEnvironment], owner); assert.equal(next.env!.KEEP, "yes");
  assert.equal(request.config.mcpServers!["paseo-canvas"], undefined);
  assert.equal(next.config.toolPolicy, undefined);
  assert.equal(injectAgent(next, bridge, owner), next);
  assert.equal(injectAgent({ ...request, config: { ...request.config, internal: true } }, bridge, owner).config.mcpServers!["paseo-canvas"], undefined);
});

test("Codex injection avoids the SDK visibility allowlist and preserves unrelated grants and permission mode", () => {
  const bridge = { script: "/private/canvas-mcp.cjs", endpoint: "/private/bridge.json" };
  const request: PluginBeforeRequests["agent.create"] = { config: {
    provider: "codex", cwd: "/workspace/a", providerOptions: { approval_policy: "on-request", sandbox_mode: "workspace-write" },
    toolPolicy: { preapproved: [
      { kind: "mcp", server: "other", tool: "safe_read" },
      // A cloned older config must not retain the partial Canvas allowlist.
      { kind: "mcp", server: "paseo-canvas", tool: "canvas_read" },
    ] },
  } };
  const next = injectAgent(request, bridge, "test-owner");
  assert.deepEqual(next.config.toolPolicy!.preapproved, [{ kind: "mcp", server: "other", tool: "safe_read" }]);
  assert.deepEqual(next.config.providerOptions, request.config.providerOptions);
  assert.equal(request.config.toolPolicy!.preapproved.length, 2);
  for (const provider of ["claude", "opencode"] as const) {
    const other = injectAgent({ config: { provider, cwd: "/workspace/a" } }, bridge, "test-owner");
    assert.ok(other.config.toolPolicy!.preapproved.some(tool => tool.tool === "canvas_apply"));
    assert.ok(!other.config.toolPolicy!.preapproved.some(tool => tool.tool === "canvas_catalog"));
  }
});

test("every new agent gets the tools, whatever the legacy injection preference says; hook failure preserves the request", async t => {
  const { directory, service } = await setup(t), mock = fakeGateway(service);
  const bridge = new CanvasBridge(directory, new ToolRouter(service, owner => mock.gateway.scope(owner))); t.after(() => bridge.close());
  const request: PluginBeforeRequests["agent.create"] = { config: { provider: "codex", cwd: "/workspace/a" } };
  const elsewhere: PluginBeforeRequests["agent.create"] = { config: { provider: "claude", cwd: "/somewhere/else" } };
  assert.deepEqual(await service.injection(), { revision: 0, workspaceIds: ["*"] });
  const entry = (await prepareCreation(elsewhere, mock.gateway, bridge)).config.mcpServers?.["paseo-canvas"];
  assert.ok(entry && entry.type === "stdio");
  assert.equal(entry.env?.ELECTRON_RUN_AS_NODE, "1");
  assert.deepEqual(await service.configureInjection({ workspaceId: "*", enabled: false, expectedRevision: 0 }), { revision: 1, workspaceIds: [] });
  const created = await prepareCreation(request, mock.gateway, bridge);
  assert.ok(created.config.mcpServers?.["paseo-canvas"] && created.config.systemPrompt?.includes("copilot"), "opting out no longer filters agents");
  assert.ok((await prepareCreation(elsewhere, mock.gateway, bridge)).config.mcpServers?.["paseo-canvas"]);
  assert.equal(await prepareCreation({ config: { ...request.config, internal: true } }, mock.gateway, bridge).then(next => next.config.mcpServers?.["paseo-canvas"]), undefined);
  await service.store.close();
  assert.equal(await prepareCreation(request, mock.gateway, bridge), request);
});

test("using a canvas connects the agent without bumping its revision; a pinned recipient stays; archived agents release", async t => {
  const { service } = await setup(t), owners = new Map([["owner-a", "a"], ["owner-b", "b"]]);
  const router = new ToolRouter(service, async owner => ({ agentId: owners.get(owner)!, workspaceId }));
  await router.call("canvas_read", { documentId: "d" }, "owner-a");
  let current = await service.read({ workspaceId, documentId: "d" });
  assert.equal(current.connection?.agentId, "a"); assert.equal(current.document.revision, 0);
  await router.call("canvas_read", { documentId: "d" }, "owner-b");
  assert.equal((await service.read({ workspaceId, documentId: "d" })).connection?.agentId, "a", "a read does not take a canvas from its recipient");
  await router.call("canvas_apply", { documentId: "d", expectedRevision: 0, operations: [{ type: "block.update", id: "b", patch: { title: "B2" } }] }, "owner-b");
  current = await service.read({ workspaceId, documentId: "d" });
  assert.equal(current.connection?.agentId, "b", "the agent that edits becomes the recipient"); assert.equal(current.document.revision, 1);
  await service.connect({ workspaceId, documentId: "d", expectedRevision: 1, connection: { agentId: "a", workspaceId, pinned: true } });
  await router.call("canvas_apply", { documentId: "d", expectedRevision: 2, operations: [{ type: "block.update", id: "b", patch: { title: "B3" } }] }, "owner-b");
  assert.equal((await service.read({ workspaceId, documentId: "d" })).connection?.agentId, "a", "a hand-picked recipient is kept");
  await service.releaseAgent("a");
  assert.equal((await service.read({ workspaceId, documentId: "d" })).connection, null);
});

test("one canvas per agent hides other agents' documents; shared mode shows them all", async t => {
  const { service } = await setup(t), owners = new Map([["owner-a", "a"], ["owner-b", "b"]]);
  const router = new ToolRouter(service, async owner => ({ agentId: owners.get(owner)!, workspaceId }));
  const ids = async (owner: string) => ((await router.call("canvas_list", {}, owner)) as { documents: { id: string }[] }).documents.map(d => d.id).sort();
  await router.call("canvas_create", { id: "mine", content: content() }, "owner-a");
  assert.deepEqual(await ids("owner-b"), ["d", "mine"]);
  assert.deepEqual(await service.configureSharing({ workspaceId, mode: "agent" }), { mode: "agent" });
  assert.deepEqual(await ids("owner-a"), ["d", "mine"]);
  assert.deepEqual(await ids("owner-b"), ["d"], "the unclaimed document stays reachable; the other agent's does not");
  await assert.rejects(router.call("canvas_read", { documentId: "mine" }, "owner-b"), /belongs to another agent/);
  await router.call("canvas_read", { documentId: "d" }, "owner-b");
  assert.deepEqual(await ids("owner-a"), ["mine"], "claimed by b");
  await service.configureSharing({ workspaceId, mode: "shared" });
  assert.deepEqual(await ids("owner-a"), ["d", "mine"]);
});
