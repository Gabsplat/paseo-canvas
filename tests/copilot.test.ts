import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PluginLifecycleEvents } from "@getpaseo/plugin/server";
import type { RpcInput } from "@getpaseo/plugin";
import * as rpc from "../plugin/shared/rpc";
import { CanvasStore } from "../plugin/server/store";
import { CanvasService } from "../plugin/server/service";
import { CopilotService, isLienzoTool, ToolActivity, DRAWING_WINDOW_MS } from "../plugin/server/copilot";
import { ToolRouter, toolNames } from "../plugin/server/tools";
import { setup, workspaceId, fakeGateway, mutation } from "./helpers";

type Ended = PluginLifecycleEvents["agent.turn_ended"];
const tool = (name: string, status: "completed" | "running" | "failed" | "canceled" = "completed") => ({ type: "tool_call", callId: `${name}-${Math.random()}`, name, status, error: null, detail: { type: "unknown", input: null, output: null } });
const ended = (timeline: unknown[], outcome: Ended["outcome"] = { kind: "completed" }, agentId = "a"): Ended => ({ agent: { id: agentId, workspaceId, parentAgentId: null, provider: "claude", cwd: "/workspace/a", title: "Test" }, turnId: "t1", outcome, timeline: timeline as Ended["timeline"] });
const set = (copilot: CopilotService, patch: RpcInput<typeof rpc.setCopilot>["patch"], agentId = "a") => copilot.set(rpc.setCopilot.input.parse({ workspaceId, agentId, patch, title: "Lienzo de la charla" }));

test("copilot state starts off, persists per agent, and an old state file without it still loads", async t => {
  const { service, store, directory } = await setup(t);
  const copilot = new CopilotService(service, toolNames);
  assert.deepEqual((await copilot.read({ workspaceId, agentId: "a" })).copilot, { enabled: false, cadence: "step", rule: "", remind: false, documentId: null });
  await store.close();
  // A state file written before the copilot existed: no `copilot` key at all.
  const file = JSON.parse(await readFile(join(directory, "state.json"), "utf8"));
  delete file.copilot; await writeFile(join(directory, "state.json"), JSON.stringify(file));
  const reopened = new CanvasStore(directory); t.after(() => reopened.close());
  const again = new CopilotService(new CanvasService(reopened), toolNames);
  assert.equal((await again.read({ workspaceId, agentId: "a" })).copilot.enabled, false);
  const view = await set(again, { enabled: true, cadence: "task", remind: true });
  assert.deepEqual([view.copilot.enabled, view.copilot.cadence, view.copilot.remind], [true, "task", true]);
  await reopened.close();
  const third = new CanvasStore(directory); t.after(() => third.close());
  const persisted = await new CopilotService(new CanvasService(third), toolNames).read({ workspaceId, agentId: "a" });
  assert.deepEqual([persisted.copilot.enabled, persisted.copilot.cadence, persisted.copilot.remind, persisted.copilot.documentId], [true, "task", true, view.copilot.documentId]);
  assert.equal((await new CopilotService(new CanvasService(third), toolNames).read({ workspaceId, agentId: "b" })).copilot.enabled, false, "copilot is per agent");
});

test("turning on creates the conversation's Lienzo and connects it; nothing is sent, the mode travels in tool responses", async t => {
  const { service, store } = await setup(t), mock = fakeGateway(service), copilot = new CopilotService(service, toolNames);
  const view = await set(copilot, { enabled: true });
  assert.ok(view.copilot.documentId); assert.equal(view.document?.title, "Lienzo de la charla");
  const reference = { workspaceId, documentId: view.copilot.documentId! };
  assert.equal((await service.read(reference)).connection?.agentId, "a");
  await set(copilot, { cadence: "custom", rule: "a diagram changes" });
  await assert.rejects(set(copilot, { rule: " " }), /custom cadence needs a rule/);
  assert.equal(mock.sends.length, 0, "changing the copilot never messages the agent");
  const record = (await store.read()).documents[reference.documentId] as Record<string, unknown>;
  assert.equal("events" in record, false);
  const router = new ToolRouter(service, async () => ({ agentId: "a", workspaceId }), copilot);
  const listed = await router.call("canvas_list", {}, "owner") as { copilot: { enabled: boolean; cadence: string; rule: string } };
  assert.deepEqual([listed.copilot.enabled, listed.copilot.cadence, listed.copilot.rule], [true, "custom", "a diagram changes"]);
  await set(copilot, { enabled: false });
  assert.equal(((await router.call("canvas_list", {}, "owner")) as { copilot: { enabled: boolean } }).copilot.enabled, false);
});

test("attaching an existing Lienzo moves the connection to this agent; another workspace is refused", async t => {
  const { service } = await setup(t), copilot = new CopilotService(service, toolNames);
  await service.connect({ workspaceId, documentId: "d", expectedRevision: 0, connection: { agentId: "b", workspaceId } });
  const view = await set(copilot, { enabled: true, documentId: "d" });
  assert.equal(view.copilot.documentId, "d");
  assert.equal((await service.read({ workspaceId, documentId: "d" })).connection?.agentId, "a");
  await service.create({ workspaceId: "workspace-b", id: "elsewhere", content: (await service.read({ workspaceId, documentId: "d" })).document });
  await assert.rejects(set(copilot, { documentId: "elsewhere" }), /another workspace/);
});

test("every canvas MCP response carries the caller's copilot, and tool calls light the drawing status", async t => {
  const { service } = await setup(t);
  let clock = 1_000_000;
  const copilot = new CopilotService(service, toolNames, () => clock);
  const router = new ToolRouter(service, async owner => ({ agentId: owner === "owner-b" ? "b" : "a", workspaceId }), copilot);
  const off = await router.call("canvas_list", {}, "owner-a") as { copilot: unknown; guide: string };
  assert.deepEqual(off.copilot, { enabled: false, cadence: "step", rule: "", documentId: null });
  assert.match(off.guide, /node blocks joined by links/);
  await set(copilot, { enabled: true, cadence: "thinking", documentId: "d" });
  for (const [name, input] of [["canvas_read", { documentId: "d" }], ["canvas_apply", { documentId: "d", expectedRevision: 0, operations: [{ type: "block.update", id: "b", patch: { title: "B2" } }] }], ["canvas_history", { documentId: "d" }], ["canvas_sheet", { action: "list", documentId: "d" }]] as const) {
    const result = await router.call(name, input, "owner-a") as { copilot: unknown };
    assert.deepEqual(result.copilot, { enabled: true, cadence: "thinking", rule: "", documentId: "d" }, name);
  }
  assert.equal(((await router.call("canvas_list", {}, "owner-b")) as { copilot: { enabled: boolean } }).copilot.enabled, false, "another agent's mode is its own");
  assert.deepEqual((await copilot.list({ agentIds: ["a", "b"] })).agents.a.drawing, true);
  clock += DRAWING_WINDOW_MS + 1;
  assert.deepEqual((await copilot.list({ agentIds: ["a", "b"] })).agents, { a: { enabled: true, drawing: false, hasTools: false }, b: { enabled: false, drawing: false, hasTools: false } });
  const owner = await service.allocateOwner("a");
  assert.ok(owner); assert.equal((await copilot.read({ workspaceId, agentId: "a" })).hasTools, true);
  // Errors still surface as errors, and the in-flight count goes back down.
  await assert.rejects(router.call("canvas_read", { documentId: "missing" }, "owner-a"), /not found/);
  assert.equal(copilot.activity.drawing("a"), true);
  clock += DRAWING_WINDOW_MS + 1; assert.equal(copilot.activity.drawing("a"), false);
});

test("the reminder: only for step/task with remind on, after a changing turn without Lienzo, never twice in a row", async t => {
  const { service } = await setup(t), mock = fakeGateway(service), copilot = new CopilotService(service, toolNames);
  const shell = tool("Bash"), drew = tool("mcp__paseo-canvas__canvas_apply");
  assert.equal(await copilot.turnEnded(ended([shell]), mock.gateway), "off");
  await set(copilot, { enabled: true, documentId: "d" });
  assert.equal(await copilot.turnEnded(ended([shell]), mock.gateway), "no-remind");
  await set(copilot, { remind: true, cadence: "thinking" });
  assert.equal(await copilot.turnEnded(ended([shell]), mock.gateway), "cadence", "never for thinking");
  await set(copilot, { cadence: "step" });
  assert.equal(await copilot.turnEnded(ended([shell], { kind: "canceled", reason: "user" }), mock.gateway), "outcome");
  assert.equal(await copilot.turnEnded(ended([{ type: "assistant_message", text: "hola" }]), mock.gateway), "quiet", "a turn that changed nothing");
  assert.equal(await copilot.turnEnded(ended([shell, drew]), mock.gateway), "drew");
  assert.equal(mock.sends.length, 0);
  assert.equal(await copilot.turnEnded(ended([shell]), mock.gateway), "sent");
  assert.equal(mock.sends.length, 1); assert.match(mock.sends[0].text, /Update Lienzo d/);
  assert.equal(await copilot.turnEnded(ended([shell]), mock.gateway), "repeat", "never twice in a row");
  assert.equal(await copilot.turnEnded(ended([shell]), mock.gateway), "sent", "after a turn without one, it may remind again");
  assert.equal(mock.sends.length, 2);
  await copilot.turnEnded(ended([shell]), mock.gateway);
  await set(copilot, { cadence: "task" });
  mock.agents.get("a")!.status = "running";
  assert.equal(await copilot.turnEnded(ended([shell]), mock.gateway), "busy", "a busy agent is never interrupted");
  mock.agents.get("a")!.status = "idle";
  // A Lienzo tool seen by the bridge during the turn counts even if the timeline names it differently.
  copilot.activity.turn("a"); copilot.activity.start("a"); copilot.activity.end("a");
  assert.equal(await copilot.turnEnded(ended([shell]), mock.gateway), "drew");
  assert.equal(mock.sends.length, 2);
});

test("Lienzo tool names are recognised across provider prefixes", () => {
  for (const name of ["canvas_apply", "mcp__paseo-canvas__canvas_read", "paseo-canvas.canvas_sheet", "paseo-canvas/canvas_list"]) assert.ok(isLienzoTool(name, toolNames), name);
  for (const name of ["Bash", "my_canvas_apply_helper", "canvas_applyx"]) assert.ok(!isLienzoTool(name, toolNames), name);
  const activity = new ToolActivity(() => 0); assert.equal(activity.usedThisTurn("x"), false);
});

test("Sheets: MCP creates numbered Sheets on one strip, lists and retitles them; the model keeps them top-level", async t => {
  const { service } = await setup(t);
  const router = new ToolRouter(service, async () => ({ agentId: "a", workspaceId }));
  // Existing loose content: the first Sheet goes to its right.
  await service.mutate(mutation(0, [{ type: "block.update", id: "b", patch: { position: { x: 100, y: 40 } } }]));
  const first = await router.call("canvas_sheet", { action: "create", documentId: "d", expectedRevision: 1, title: "How the bridge works" }, "owner") as { id: string; number: number; revision: number };
  assert.equal(first.number, 1); assert.equal(first.revision, 2);
  const second = await router.call("canvas_sheet", { action: "create", documentId: "d", expectedRevision: 2, title: "Why tokens", id: "hoja-tokens" }, "owner") as { id: string; number: number };
  assert.deepEqual([second.id, second.number], ["hoja-tokens", 2]);
  let current = (await service.read({ workspaceId, documentId: "d" })).document;
  const [one, two] = [current.groups.find(group => group.id === first.id)!, current.groups.find(group => group.id === "hoja-tokens")!];
  assert.equal(one.sheet?.source, "agent"); assert.ok(one.position!.x > 100 + 320, "right of the loose content");
  assert.equal(two.position!.y, one.position!.y, "one horizontal strip"); assert.ok(two.position!.x >= one.position!.x + 1200, "right of the last Sheet");
  // Ordinary edits target a Sheet with parentGroupId.
  await router.call("canvas_apply", { documentId: "d", expectedRevision: 3, operations: [{ type: "block.create", block: { id: "n1", typeId: "note", title: "Inside", data: { text: "x" }, parentGroupId: "hoja-tokens", position: { x: 2000, y: 0 } } }] }, "owner");
  const third = await router.call("canvas_sheet", { action: "create", documentId: "d", expectedRevision: 4, title: "Third" }, "owner") as { id: string; number: number };
  current = (await service.read({ workspaceId, documentId: "d" })).document;
  assert.ok(current.groups.find(group => group.id === third.id)!.position!.x >= two.position!.x + 2000 + 320, "a wide Sheet pushes the next one further right");
  const listed = await router.call("canvas_sheet", { action: "list", documentId: "d" }, "owner") as { sheets: { id: string; number: number; title: string; blockCount: number }[] };
  assert.deepEqual(listed.sheets.map(sheet => [sheet.number, sheet.title, sheet.blockCount]), [[1, "How the bridge works", 0], [2, "Why tokens", 1], [3, "Third", 0]]);
  await router.call("canvas_sheet", { action: "update", documentId: "d", expectedRevision: 5, id: "hoja-tokens", title: "Why tokens expire" }, "owner");
  assert.equal((await service.sheets({ workspaceId, documentId: "d" })).sheets[1].title, "Why tokens expire");
  await assert.rejects(router.call("canvas_sheet", { action: "update", documentId: "d", expectedRevision: 6, id: "n1", title: "x" }, "owner"), /does not exist/);
  const outline = await router.call("canvas_read", { documentId: "d" }, "owner") as { document: { groups: { id: string; sheet?: { number: number } }[] } };
  assert.equal(outline.document.groups.find(group => group.id === "hoja-tokens")!.sheet!.number, 2);
  // Invariants: a Sheet cannot be nested, numbers are unique, a copy is an ordinary group.
  await assert.rejects(service.mutate(mutation(6, [{ type: "entity.move", id: "hoja-tokens", parentGroupId: first.id }])), /top level/);
  await assert.rejects(service.mutate(mutation(6, [{ type: "group.create", group: { id: "dup", title: "Dup", description: "", blockIds: [], groupIds: [], sheet: { number: 2, createdAt: new Date().toISOString(), source: "user" } } }])), /share number 2/);
  await service.mutate(mutation(6, [{ type: "entity.duplicate", id: "hoja-tokens", idPrefix: "copy" }]));
  current = (await service.read({ workspaceId, documentId: "d" })).document;
  assert.equal(current.groups.find(group => group.id === "copy.hoja-tokens")!.sheet, undefined);
  // Undo removes the Sheet like any other transaction; numbers are not reused while the others remain.
  const fourth = await service.createSheet({ workspaceId, documentId: "d", expectedRevision: 7, title: "Mine" });
  assert.deepEqual([fourth.number, fourth.view.document.groups.find(group => group.id === fourth.id)!.sheet!.source], [4, "user"]);
});

test("the document view exposes the agent's latest transaction for 'go to latest'", async t => {
  const { service } = await setup(t);
  const router = new ToolRouter(service, async () => ({ agentId: "a", workspaceId }));
  assert.equal((await service.read({ workspaceId, documentId: "d" })).latestAgent, null);
  await router.call("canvas_apply", { documentId: "d", expectedRevision: 0, label: "Add two", operations: [
    { type: "block.create", block: { id: "x1", typeId: "note", title: "X1", data: { text: "1" } } },
    { type: "block.create", block: { id: "x2", typeId: "note", title: "X2", data: { text: "2" } } },
    { type: "block.delete", id: "c" },
  ] }, "owner");
  // A later user edit does not move "latest from the agent".
  await service.mutate(mutation(1, [{ type: "block.update", id: "b", patch: { title: "Mine" } }]));
  await service.mutate(mutation(2, [{ type: "block.delete", id: "x2" }]));
  const view = await service.read({ workspaceId, documentId: "d" });
  assert.deepEqual({ ...view.latestAgent, at: undefined, transactionId: undefined }, { transactionId: undefined, revision: 1, at: undefined, agentId: "a", label: "Add two", kind: "edit", ids: ["x1"], removed: ["c"] });
  const history = await service.history({ workspaceId, documentId: "d" });
  assert.equal(view.latestAgent!.transactionId, history.transactions.find(entry => entry.revision === 1)!.id);
  assert.equal(view.latestAgent!.at, history.transactions.find(entry => entry.revision === 1)!.at);
  assert.ok(rpc.readDocument.output.parse(view).latestAgent, "part of the RPC contract");
  // The copilot read carries it with titles for the popover preview.
  const copilot = new CopilotService(service, toolNames);
  await set(copilot, { enabled: true, documentId: "d" });
  const latest = (await copilot.read({ workspaceId, agentId: "a" })).latest!;
  assert.deepEqual([latest.documentId, latest.ids, latest.titles], ["d", ["x1"], ["X1"]]);
  assert.equal((await copilot.read({ workspaceId, agentId: "b" })).latest, null);
});

test("with the copilot on, the agent draws a few blocks per call and an all-cards Sheet gets a nudge", async t => {
  const { service } = await setup(t), copilot = new CopilotService(service, toolNames);
  const router = new ToolRouter(service, async () => ({ agentId: "a", workspaceId }), copilot);
  const documentId = (await set(copilot, { enabled: true })).copilot.documentId!;
  const sheet = await router.call("canvas_sheet", { action: "create", documentId, expectedRevision: (await service.read({ workspaceId, documentId })).document.revision, title: "Wine" }, "owner") as { id: string; revision: number };
  const cards = (from: number, count: number) => Array.from({ length: count }, (_, i) => ({ type: "block.create", block: { id: `n${from + i}`, typeId: "node", title: `Step ${from + i}`, data: { summary: "x" }, parentGroupId: sheet.id } }));
  await assert.rejects(router.call("canvas_apply", { documentId, expectedRevision: sheet.revision, label: "All at once", operations: cards(1, 7) }, "owner"), /piece by piece.*Nothing was applied/);
  assert.equal((await service.read({ workspaceId, documentId })).document.revision, sheet.revision, "a rejected call changes nothing");
  const first = await router.call("canvas_apply", { documentId, expectedRevision: sheet.revision, label: "First stage", operations: cards(1, 4) }, "owner") as { revision: number; variety?: string };
  assert.equal(first.variety, undefined, "a few cards are fine");
  const second = await router.call("canvas_apply", { documentId, expectedRevision: first.revision, label: "Second stage", operations: cards(5, 2) }, "owner") as { revision: number; variety?: string };
  assert.match(second.variety ?? "", /only cards so far \(6\)/);
  const shown = await router.call("canvas_apply", { documentId, expectedRevision: second.revision, label: "A vat", operations: [{ type: "block.create", block: { id: "vat", typeId: "wb-shape", title: "Vat", data: { shape: "cylinder" }, position: { x: 30, y: 40 }, size: { width: 120, height: 160 }, parentGroupId: sheet.id } }] }, "owner") as { variety?: string };
  assert.equal(shown.variety, undefined, "one element beyond cards ends the nudge");
  await set(copilot, { enabled: false });
  const free = await router.call("canvas_apply", { documentId, expectedRevision: (await service.read({ workspaceId, documentId })).document.revision, label: "Asked for", operations: cards(20, 8) }, "owner") as { revision: number };
  assert.ok(free.revision, "with the copilot off, a requested drawing is not paced");
});
