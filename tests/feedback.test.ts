import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import * as rpc from "../plugin/shared/rpc";
import { FeedbackDispatcher, feedbackPrompt } from "../plugin/server/feedback";
import { injectAgent, prepareCreation, ownerEnvironment } from "../plugin/server/agent-integration";
import { CanvasBridge } from "../plugin/server/bridge";
import { ToolRouter } from "../plugin/server/tools";
import type { PluginBeforeRequests } from "@getpaseo/plugin/server";
import { CanvasStore } from "../plugin/server/store";
import { CanvasService } from "../plugin/server/service";
import { setup, workspaceId, fakeGateway } from "./helpers";

const reference = { workspaceId, documentId: "d" };
const action = (eventId: string, delivery: "immediate" | "batched" = "immediate") => rpc.agentAction.input.parse({ ...reference, expectedRevision: 0, eventId, action: { kind: "selection.ask", label: "Explain selection", payload: { answer: "A" }, targetIds: ["b"], delivery } });

test("no connected agent leaves honest pending feedback; batched events require explicit flush", async t => {
  const { service } = await setup(t), mock = fakeGateway(service);
  const dispatcher = new FeedbackDispatcher(service, mock.gateway); t.after(() => dispatcher.close());
  const event = await service.action(action("evt1", "batched"));
  assert.equal(event.status, "pending"); assert.equal(event.agentId, null);
  await dispatcher.drain(); assert.equal(mock.sends.length, 0);
  await service.connect({ ...reference, expectedRevision: 0, connection: { agentId: "a", workspaceId } });
  await dispatcher.drain(); assert.equal(mock.sends.length, 0);
  await dispatcher.drain("a", true);
  assert.equal(mock.sends.length, 1); assert.equal((await service.events(reference)).events[0].status, "sent");
  assert.match(mock.sends[0].text, /canvas.feedback/);
  assert.match(mock.sends[0].text, /Explain plainly/);
});

test("running agent queues actions; duplicate IDs and concurrent drains send once when idle", async t => {
  const { service } = await setup(t), mock = fakeGateway(service, "running");
  await service.connect({ ...reference, expectedRevision: 0, connection: { agentId: "a", workspaceId } });
  const input = { ...action("evt1"), expectedRevision: 1 };
  await service.action(input); await service.action(input);
  const dispatcher = new FeedbackDispatcher(service, mock.gateway); t.after(() => dispatcher.close());
  await dispatcher.drain("a"); assert.equal(mock.sends.length, 0);
  assert.equal((await service.events(reference)).events[0].status, "pending");
  mock.agents.get("a")!.status = "idle";
  await Promise.all([dispatcher.drain("a"), dispatcher.drain("a")]);
  assert.equal(mock.sends.length, 1); assert.match(mock.sends[0].messageId, /^msg_/);
  assert.equal((await service.events(reference)).events.length, 1);
});

test("fast MCP ack is terminal and cannot be downgraded by delivery completion", async t => {
  const { service } = await setup(t), mock = fakeGateway(service);
  await service.connect({ ...reference, expectedRevision: 0, connection: { agentId: "a", workspaceId } });
  await service.action({ ...action("evt1"), expectedRevision: 1 });
  const router = new ToolRouter(service, async () => ({ agentId: "a", workspaceId }));
  mock.setOnSend(async () => { await router.call("canvas_events", { documentId: "d", ack: ["evt1"] }, "owner"); });
  const dispatcher = new FeedbackDispatcher(service, mock.gateway); t.after(() => dispatcher.close());
  await dispatcher.drain("a");
  assert.equal((await service.events(reference)).events[0].status, "acked");
  await service.markEvents("d", workspaceId, ["evt1"], "failed", undefined, "late failure");
  assert.equal((await service.events(reference)).events[0].status, "acked");
});

test("accepted send with lost local mark replays an immutable durable batch; newer events use a separate message ID", async t => {
  const { directory, store, service } = await setup(t), mock = fakeGateway(service);
  await service.connect({ ...reference, expectedRevision: 0, connection: { agentId: "a", workspaceId } });
  await service.action({ ...action("evt1"), expectedRevision: 1 });
  const accepted = new Map<string, string>();
  mock.setOnSend(async messageId => {
    const sent = mock.sends.at(-1)!;
    const disk = JSON.parse(await readFile(store.file, "utf8"));
    const saved = disk.documents.d.outboundBatches.find((batch: { messageId: string }) => batch.messageId === messageId);
    assert.equal(saved.prompt, sent.text);
    assert.deepEqual(saved.eventIds, ["evt1"]);
    assert.equal(saved.status, "prepared");
    accepted.set(messageId, sent.text);
  });
  const dispatcher = new FeedbackDispatcher(service, mock.gateway); t.after(() => dispatcher.close());
  service.finishFeedbackBatch = async () => { throw new Error("Simulated lost local mark after SDK acceptance"); };
  await assert.rejects(dispatcher.drain("a"), /Simulated lost local mark/);
  assert.equal((await service.events(reference)).events[0].status, "pending");
  const original = mock.sends[0];
  await service.action({ ...action("evt2"), expectedRevision: 1, action: { ...action("evt2").action, payload: { newAnswer: "B" } } });
  await dispatcher.close(); await store.close();

  const reopenedStore = new CanvasStore(directory), next = new CanvasService(reopenedStore), reopened = fakeGateway(next);
  const retry = new FeedbackDispatcher(next, reopened.gateway);
  t.after(async () => { await retry.close(); await reopenedStore.close(); });
  const delivered: string[] = ["evt1"];
  reopened.setOnSend(async messageId => {
    const sent = reopened.sends.at(-1)!;
    const disk = JSON.parse(await readFile(reopenedStore.file, "utf8"));
    const saved = disk.documents.d.outboundBatches.find((batch: { messageId: string }) => batch.messageId === messageId);
    assert.equal(saved.prompt, sent.text);
    if (accepted.has(messageId)) {
      // Simulated SDK dedup ignores a repeated ID. The new event must remain pending here.
      assert.equal(sent.text, accepted.get(messageId));
      assert.deepEqual(saved.eventIds, ["evt1"]);
      assert.equal((await next.events(reference)).events.find(event => event.id === "evt2")!.status, "pending");
    } else {
      accepted.set(messageId, sent.text);
      delivered.push(...saved.eventIds);
      assert.deepEqual(saved.eventIds, ["evt2"]);
    }
  });
  await retry.drain("a");
  assert.equal(reopened.sends.length, 2);
  assert.equal(reopened.sends[0].messageId, original.messageId);
  assert.equal(reopened.sends[0].text, original.text);
  assert.notEqual(reopened.sends[1].messageId, original.messageId);
  assert.deepEqual(delivered, ["evt1", "evt2"]);
  assert.deepEqual((await next.events(reference)).events.map(event => event.status), ["sent", "sent"]);
});

test("closed agent produces failed status; feedback messages have an 8KiB cap", async t => {
  const { service } = await setup(t), mock = fakeGateway(service, "closed");
  await service.connect({ ...reference, expectedRevision: 0, connection: { agentId: "a", workspaceId } });
  const event = await service.action({ ...action("evt1"), expectedRevision: 1, action: { ...action("evt1").action, payload: { note: "x".repeat(20000) } } });
  assert.ok(Buffer.byteLength(feedbackPrompt([event])) <= 8192);
  const dispatcher = new FeedbackDispatcher(service, mock.gateway); t.after(() => dispatcher.close());
  await dispatcher.drain("a"); assert.equal(mock.sends.length, 0); assert.equal((await service.events(reference)).events[0].status, "failed");
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

test("workspace opt-in controls new-agent injection; hook failure preserves original request", async t => {
  const { directory, service } = await setup(t), mock = fakeGateway(service);
  const bridge = new CanvasBridge(directory, new ToolRouter(service, owner => mock.gateway.scope(owner))); t.after(() => bridge.close());
  const request: PluginBeforeRequests["agent.create"] = { config: { provider: "codex", cwd: "/workspace/a" } };
  assert.equal(await prepareCreation(request, mock.gateway, bridge), request);
  await service.configureInjection({ workspaceId, enabled: true, expectedRevision: 0 });
  const next = await prepareCreation(request, mock.gateway, bridge);
  assert.ok(next.config.mcpServers?.["paseo-canvas"]);
  await service.store.close();
  assert.equal(await prepareCreation(request, mock.gateway, bridge), request);
});
