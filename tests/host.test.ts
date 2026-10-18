import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TestContext } from "node:test";
import type { output } from "zod";
import * as rpc from "../plugin/shared/rpc";
import type { RpcContract, RpcInput, SettingsDefinition } from "../plugin/shared/contract";
import { createCanvasCore } from "../plugin/server/core";
import { ToolRouter } from "../plugin/server/tools";
import type { HandlerContext, HostApi, LifecycleEvents, ServerHost } from "../plugin/server/host";
import { content, fakeGateway, workspaceId } from "./helpers";

/** A host in memory: it records registrations and calls handlers the way a real host would, parsing input first. */
class FakeHost implements ServerHost {
  readonly kind = "fake";
  readonly settings: SettingsDefinition[] = [];
  readonly handlers = new Map<string, { contract: RpcContract; handler: (input: never, context: HandlerContext) => unknown }>();
  readonly hooks = new Map<string, (event: never, context: HandlerContext) => Promise<void> | void>();
  on?: ServerHost["on"];
  constructor(readonly runsAgents: boolean, public api?: HostApi) {
    if (runsAgents) this.on = (event, handler) => { this.hooks.set(event, handler as never); return () => { this.hooks.delete(event); }; };
  }
  registerSettings(definition: SettingsDefinition) { this.settings.push(definition); }
  handle<C extends RpcContract>(contract: C, handler: (input: RpcInput<C>, context: HandlerContext) => unknown) { this.handlers.set(contract.name, { contract, handler: handler as never }); }
  async call<C extends RpcContract>(contract: C, input: unknown): Promise<output<C["output"]>> {
    const entry = this.handlers.get(contract.name);
    assert.ok(entry, `no handler for ${contract.name}`);
    return contract.output.parse(await entry.handler(contract.input.parse(input) as never, { api: this.api })) as never;
  }
  async emit<E extends keyof LifecycleEvents>(event: E, payload: LifecycleEvents[E]) { await this.hooks.get(event)?.(payload as never, { api: this.api }); }
}

async function directory(t: TestContext) {
  const path = await mkdtemp(join(tmpdir(), "lienzo-host-test-"));
  t.after(() => rm(path, { recursive: true, force: true }));
  return path;
}

test("a host without agents runs the whole panel contract; the agent reads the selection through the tools", async t => {
  const host = new FakeHost(false), core = createCanvasCore(host, { directory: await directory(t) });
  t.after(async () => { await core.stop(); await core.store.close(); });
  assert.deepEqual(host.settings.map(definition => definition.id), ["onboarding", "interface"]);
  assert.equal(host.hooks.size, 0, "no lifecycle hooks on a host that does not run agents");
  // Every panel RPC has a handler, so the same client works on this host.
  for (const contract of (Object.values(rpc) as unknown[]).filter((value): value is RpcContract => !!value && typeof value === "object" && "name" in value && "input" in value)) assert.ok(host.handlers.has(contract.name), contract.name);

  const created = await host.call(rpc.createDocument, { workspaceId, id: "doc", content: content() });
  assert.equal(created.document.revision, 0);
  const listed = await host.call(rpc.listDocuments, { workspaceId });
  assert.deepEqual(listed.documents.map(document => document.id), ["doc"]);
  const edited = await host.call(rpc.mutateDocument, { workspaceId, documentId: "doc", expectedRevision: 0, label: "Rename", operations: [{ type: "block.update", id: "b", patch: { title: "Renamed" } }] });
  assert.equal(edited.document.revision, 1);
  await assert.rejects(host.call(rpc.mutateDocument, { workspaceId, documentId: "doc", expectedRevision: 0, label: "Stale", operations: [{ type: "block.delete", id: "c" }] }), /REVISION_CONFLICT|Document changed/);
  const undone = await host.call(rpc.undoDocument, { workspaceId, documentId: "doc", expectedRevision: 1 });
  assert.equal(undone.document.blocks.find(block => block.id === "b")?.title, "B");

  // Connecting needs no agent registry here and never asks for a reload.
  const connected = await host.call(rpc.connectAgent, { workspaceId, documentId: "doc", expectedRevision: 2, connection: { agentId: "mcp:claude-code", workspaceId } });
  assert.deepEqual([connected.requiresReload, connected.view.connection?.agentId, connected.view.connection?.pinned], [false, "mcp:claude-code", true]);
  await assert.rejects(host.call(rpc.agentSetup, { workspaceId, agentId: "mcp:claude-code", provider: "claude" }), /connects agents over MCP/);

  // The person selects; the agent reads it through the same tool router the plugin uses.
  const selected = await host.call(rpc.setSelection, { workspaceId, documentId: "doc", expectedSelectionVersion: connected.view.selectionVersion, ids: ["b"] });
  const scoped = new ToolRouter(core.service, async owner => ({ agentId: owner, workspaceId }), core.copilot);
  const read = await scoped.call("canvas_selection", {}, "mcp:claude-code") as { documentId: string; ids: string[]; selectionVersion: number };
  assert.deepEqual([read.documentId, read.ids, read.selectionVersion], ["doc", ["b"], selected.selectionVersion]);
});

test("a host that runs agents verifies them, and nothing the panel does sends a message to an agent", async t => {
  const host = new FakeHost(true), core = createCanvasCore(host, { directory: await directory(t) });
  // The fake agent registry is the shared test helper's: agent "a" and "b" in this workspace, "outsider" elsewhere.
  const mock = fakeGateway(core.service); host.api = mock.paseo;
  t.after(async () => { await core.stop(); await core.store.close(); });
  assert.deepEqual([...host.hooks.keys()].sort(), ["agent.archived", "agent.turn_ended", "agent.turn_started"]);
  // No RPC is left that sends to an agent: no action, event, flush or acknowledgement method exists.
  const names = [...host.handlers.keys()];
  assert.deepEqual(names.filter(name => /agent\.(action|events|send)|\.flush$|\.ack$/.test(name)), []);
  for (const gone of ["agentAction", "readAgentEvents", "flushAgentEvents"]) assert.equal(gone in rpc, false, gone);

  await host.call(rpc.createDocument, { workspaceId, id: "doc", content: content() });
  await assert.rejects(host.call(rpc.connectAgent, { workspaceId, documentId: "doc", expectedRevision: 0, connection: { agentId: "outsider", workspaceId } }), /another workspace/);
  const connected = await host.call(rpc.connectAgent, { workspaceId, documentId: "doc", expectedRevision: 0, connection: { agentId: "a", workspaceId } });
  assert.equal(connected.requiresReload, true, "agent a holds no Lienzo tools yet");

  // Everything the person can do in the panel, with the agent idle and connected: none of it reaches the agent.
  const edited = await host.call(rpc.mutateDocument, { workspaceId, documentId: "doc", expectedRevision: 1, label: "Edit", operations: [{ type: "block.update", id: "b", patch: { title: "B2" } }] });
  await host.call(rpc.setSelection, { workspaceId, documentId: "doc", expectedSelectionVersion: edited.selectionVersion, ids: ["b", "c"] });
  await host.call(rpc.setRuntime, { workspaceId, documentId: "doc", blocks: [{ id: "b", state: { lastInteraction: { kind: "quiz.hint", label: "Hint", at: new Date().toISOString() } } }] });
  await host.call(rpc.setCopilot, { workspaceId, agentId: "a", patch: { enabled: true, cadence: "step" } });
  await host.call(rpc.createSheet, { workspaceId, documentId: "doc", expectedRevision: 2, title: "Hoja" });
  await host.emit("agent.turn_ended", { agent: { id: "a" }, turnId: "t1", outcome: { kind: "completed" }, timeline: [] });
  assert.equal(mock.sends.length, 0);

  // Archiving the agent frees its canvases.
  await host.emit("agent.archived", { agent: { id: "a" } });
  assert.equal((await host.call(rpc.readDocument, { workspaceId, documentId: "doc" })).connection, null);
});
