import test from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CanvasStore } from "../plugin/server/store";
import { CanvasService } from "../plugin/server/service";
import { ToolRouter, toolDefinitions, toolNames, integrationInstructions, drawingGuide } from "../plugin/server/tools";
import { setup, workspaceId, mutation, content } from "./helpers";

// The canvas is one-way: the agent draws and reads (the selection, block state); nothing the person does on the
// canvas is sent to the agent. The person talks to the agent in their own chat.

const router = (service: CanvasService, agentId = "a") => new ToolRouter(service, async () => ({ agentId, workspaceId }));

test("a state file written with an event queue and outbound batches loads clean and is rewritten without them", async t => {
  const { service, store, directory } = await setup(t);
  await store.close();
  const file = JSON.parse(await readFile(join(directory, "state.json"), "utf8"));
  const context = content();
  file.documents.d.events = [
    { id: "evt-1", documentId: "d", agentId: "a", workspaceId, createdAt: "2026-10-01T00:00:00.000Z", revision: 0, action: { kind: "selection.send", label: "Ask about the selection", payload: { note: "why?" }, targetIds: ["b"], delivery: "immediate" }, context, status: "sent" },
    { id: "evt-2", documentId: "d", agentId: null, workspaceId, createdAt: "2026-10-01T00:00:01.000Z", revision: 0, action: { kind: "controls.x", label: "Ajustar x", payload: { value: 3 }, targetIds: ["b"], delivery: "batched", settled: true }, context, status: "pending" },
    { id: "evt-3", documentId: "d", agentId: "a", workspaceId, createdAt: "2026-10-01T00:00:02.000Z", revision: 0, action: { kind: "copilot.mode", label: "Lienzo copilot is on", payload: {}, targetIds: [], delivery: "batched" }, context, status: "failed", error: "Not delivered" },
  ];
  file.documents.d.outboundBatches = [{ messageId: "msg-1", agentId: "a", eventIds: ["evt-1"], prompt: "The user acted on the shared canvas.", createdAt: "2026-10-01T00:00:00.000Z", status: "prepared" }];
  await writeFile(join(directory, "state.json"), JSON.stringify(file));

  const reopened = new CanvasStore(directory); t.after(() => reopened.close());
  const again = new CanvasService(reopened);
  const state = await reopened.read();
  assert.deepEqual(Object.keys(state.documents.d).filter(key => key === "events" || key === "outboundBatches"), []);
  const view = await again.read({ workspaceId, documentId: "d" });
  assert.equal(view.document.blocks.length, 2);
  // The next write leaves no trace of the queue on disk.
  await again.mutate(mutation(0, [{ type: "block.update", id: "b", patch: { title: "B2" } }]));
  const disk = await readFile(join(directory, "state.json"), "utf8");
  assert.doesNotMatch(disk, /"events"|outboundBatches|evt-1|selection\.send/);
});

test("the agent reads the selection through MCP: entities, effective instructions and the state the person left", async t => {
  const { service } = await setup(t);
  await service.mutate(mutation(0, [
    { type: "group.create", group: { id: "g", title: "Marco", description: "", blockIds: ["b"], groupIds: [], communication: { instructions: "Teach it as a story.", intent: "", audience: "" } } },
    { type: "block.update", id: "b", patch: { communication: { instructions: "Use one example.", intent: "", audience: "" } } },
  ]));
  await service.runtimeSet({ workspaceId, documentId: "d", blocks: [{ id: "b", state: { value: 7, lastInteraction: { kind: "controls.x", label: "Ajustar x", at: "2026-10-18T00:00:00.000Z", payload: { visited: [2, 7] } } } }], scopes: [] });
  const tools = router(service);
  // Nothing selected yet.
  const nothing = await tools.call("canvas_selection", {}, "owner") as { ids: string[]; note: string };
  assert.deepEqual(nothing.ids, []); assert.match(nothing.note, /Nothing is selected/);

  const current = await service.read({ workspaceId, documentId: "d" });
  await service.selection({ workspaceId, documentId: "d", expectedSelectionVersion: current.selectionVersion, ids: ["b", "g"] });
  const read = await tools.call("canvas_selection", { documentId: "d" }, "owner") as {
    documentId: string; ids: string[]; selectedAt: string; copilot: unknown;
    entities: { entity: { id: string; title: string }; effectiveInstructions: { instructions: string }[]; state?: { value: number; lastInteraction: { kind: string; payload: unknown } } }[];
  };
  assert.deepEqual(read.ids, ["b", "g"]); assert.ok(read.selectedAt); assert.ok(read.copilot);
  const block = read.entities[0];
  assert.equal(block.entity.title, "B");
  assert.deepEqual(block.effectiveInstructions.map(level => level.instructions), ["Use one example.", "Teach it as a story.", "Explain plainly."]);
  assert.equal(block.state?.value, 7); assert.equal(block.state?.lastInteraction.kind, "controls.x");
  assert.equal(read.entities[1].entity.id, "g"); assert.equal(read.entities[1].state, undefined);

  // Without a documentId, the Lienzo whose selection the person changed last.
  await service.create({ workspaceId, id: "other", content: content() });
  const other = await service.read({ workspaceId, documentId: "other" });
  await new Promise(resolve => setTimeout(resolve, 5));
  await service.selection({ workspaceId, documentId: "other", expectedSelectionVersion: other.selectionVersion, ids: ["c"] });
  const latest = await tools.call("canvas_selection", {}, "owner") as { documentId: string; ids: string[] };
  assert.deepEqual([latest.documentId, latest.ids], ["other", ["c"]]);

  // A long page or a drawing never makes the selection too big to read.
  await service.mutate(mutation(0, [{ type: "block.update", id: "c", patch: { data: { text: "x".repeat(30_000) } } }], "other"));
  const compact = await tools.call("canvas_selection", {}, "owner") as { entities: { entity: { data: { text: string } } }[] };
  assert.match(compact.entities[0].entity.data.text, /30000 characters; read this block with canvas_read ids/);
});

test("the tools tell the agent the canvas is one-way and to read the selection when the person says 'this'", () => {
  assert.equal(toolNames.includes("canvas_events" as never), false);
  const selection = toolDefinitions.find(tool => tool.name === "canvas_selection")!;
  for (const phrase of ["what I selected", "mirá esto", "this", "never messages you"]) assert.ok(selection.description.includes(phrase), phrase);
  assert.match(integrationInstructions, /canvas_selection/); assert.match(integrationInstructions, /never messages you/);
  assert.doesNotMatch(integrationInstructions + drawingGuide, /canvas_events|canvas\.feedback|acknowledge/);
});

test("a mini app's setState is stored on its block, survives a restart and is read by the agent", async t => {
  const { service, store, directory } = await setup(t);
  await service.mutate(mutation(0, [{ type: "block.create", block: { id: "app", typeId: "html", title: "Quiz app", data: { html: "<p>quiz</p>" } } }]));
  // What the canvas writes when the page calls lienzo.setState({ answer: "b", step: 3 }).
  await service.runtimeSet({ workspaceId, documentId: "d", blocks: [{ id: "app", state: { state: { answer: "b", step: 3 } } }], scopes: [] });
  await store.flushRuntime(); await store.close();
  const reopened = new CanvasStore(directory); t.after(() => reopened.close());
  const again = new CanvasService(reopened), tools = router(again);
  const read = await tools.call("canvas_read", { documentId: "d", ids: ["app"] }, "owner") as { entities: { state?: { state: unknown } }[] };
  assert.deepEqual(read.entities[0].state, { state: { answer: "b", step: 3 } });
  const outline = await tools.call("canvas_read", { documentId: "d" }, "owner") as { document: { blocks: { id: string; hasState?: boolean }[] } };
  assert.equal(outline.document.blocks.find(block => block.id === "app")?.hasState, true);
  assert.equal(outline.document.blocks.find(block => block.id === "b")?.hasState, undefined);
  const current = await again.read({ workspaceId, documentId: "d" });
  await again.selection({ workspaceId, documentId: "d", expectedSelectionVersion: current.selectionVersion, ids: ["app"] });
  const selected = await tools.call("canvas_selection", {}, "owner") as { entities: { state?: { state: unknown } }[] };
  assert.deepEqual(selected.entities[0].state, { state: { answer: "b", step: 3 } });
  // Bounded: a state over the 4 KiB block limit is refused.
  await assert.rejects(again.runtimeSet({ workspaceId, documentId: "d", blocks: [{ id: "app", state: { state: "x".repeat(5000) } }], scopes: [] }), /4 KiB/);
});
