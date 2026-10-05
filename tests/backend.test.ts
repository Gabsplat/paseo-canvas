import test from "node:test";
import assert from "node:assert/strict";
import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as rpc from "../plugin/shared/rpc";
import contribute from "../plugin/index.server";
import { CanvasStore } from "../plugin/server/store";
import { CanvasService } from "../plugin/server/service";
import { CanvasError } from "../plugin/shared/errors";
import { groupSchema, groupPatchSchema, diagramDataSchema, checklistDataSchema, packSchema } from "../plugin/shared/model";
import { groupSubtree, effectiveInstructions } from "../plugin/server/reducer";
import { ToolRouter } from "../plugin/server/tools";
import { setup, workspaceId, mutation, content } from "./helpers";

const reference = { workspaceId, documentId: "d" };
const rejectCode = (code: string) => (error: unknown) => error instanceof CanvasError && error.code === code;
const group = (id: string, blockIds: string[] = [], groupIds: string[] = []) => groupSchema.parse({ id, title: id, description: "Keep description", blockIds, groupIds });

test("installed SDK loads every shared contract and backend entry", () => {
  assert.equal(typeof contribute, "function");
  const contracts = Object.values(rpc).filter(value => value && typeof value === "object" && "name" in value);
  assert.ok(contracts.length >= 23);
  for (const contract of contracts) assert.match(String(contract.name), /^[a-z][a-z0-9._-]*$/);
  assert.equal(rpc.agentAction.name, "canvas.agent.action");
});

test("batch rollback leaves revision, disk and history unchanged", async t => {
  const { service, store } = await setup(t);
  const disk = await readFile(store.file, "utf8");
  await assert.rejects(service.mutate(mutation(0, [
    { type: "block.update", id: "b", patch: { data: { text: "changed" } } },
    { type: "group.create", group: group("g", ["b"]) },
    { type: "block.delete", id: "does-not-exist" },
  ])), rejectCode("NOT_FOUND"));
  assert.equal(await readFile(store.file, "utf8"), disk);
  assert.equal((await service.read(reference)).document.revision, 0);
  assert.equal((await service.history(reference)).transactions.length, 0);
});

test("optimistic concurrent writes serialize and conflict details identify affected entities", async t => {
  const { service } = await setup(t);
  const results = await Promise.allSettled([
    service.mutate(mutation(0, [{ type: "block.update", id: "b", patch: { title: "One" } }])),
    service.mutate(mutation(0, [{ type: "block.update", id: "c", patch: { title: "Two" } }])),
  ]);
  assert.equal(results.filter(result => result.status === "fulfilled").length, 1);
  const failed = results.find(result => result.status === "rejected");
  assert.ok(failed && failed.status === "rejected");
  assert.equal(failed.reason.code, "REVISION_CONFLICT");
  assert.equal(failed.reason.details.currentRevision, 1);
  assert.deepEqual(failed.reason.details.changedSince, ["b"]);
});

test("documents/catalog/runtime/history/owner scopes persist across reopen; interrupted temp ignored", async t => {
  const { service, store, directory } = await setup(t);
  await service.mutate(mutation(0, [{ type: "block.update", id: "b", patch: { title: "Persisted" } }]));
  await service.selection({ ...reference, expectedSelectionVersion: 0, ids: ["b"] });
  const owner = await service.allocateOwner("a");
  await writeFile(`${store.file}.abandoned.tmp`, "incomplete");
  await store.close();
  const reopened = new CanvasStore(directory), next = new CanvasService(reopened);
  t.after(() => reopened.close());
  const result = await next.read(reference);
  assert.equal(result.document.blocks[0].title, "Persisted");
  assert.deepEqual(result.document.selectedIds, ["b"]);
  assert.equal(result.selectionVersion, 1);
  assert.equal((await next.history(reference)).transactions.length, 1);
  assert.equal(await next.owner(owner), "a");
  assert.equal((await stat(reopened.file)).mode & 0o777, 0o600);
});

test("single writer lock rejects a live second instance; corrupted state is not overwritten", async t => {
  const { store, directory } = await setup(t);
  const second = new CanvasStore(directory);
  await assert.rejects(second.initialize(), rejectCode("UNAVAILABLE"));
  await second.close(); await store.close();
  await writeFile(store.file, "corrupt");
  const bad = new CanvasStore(directory);
  await assert.rejects(bad.initialize(), rejectCode("UNAVAILABLE"));
  assert.equal(await readFile(store.file, "utf8"), "corrupt");
  await bad.close();
});

test("committed aggregate survives abrupt process exit and stale writer lock recovers", async t => {
  const { store, directory } = await setup(t);
  await store.close();
  const source = `import {CanvasStore} from ${JSON.stringify(join(process.cwd(), "plugin/server/store.ts"))};\nimport {CanvasService} from ${JSON.stringify(join(process.cwd(), "plugin/server/service.ts"))};\nconst service = new CanvasService(new CanvasStore(${JSON.stringify(directory)}));\nawait service.mutate(${JSON.stringify(mutation(0, [{ type: "block.update", id: "b", patch: { title: "Committed before abrupt exit" } }]))});\nprocess.exit(0);`;
  await promisify(execFile)(process.execPath, ["--import", "tsx", "--input-type=module", "-e", source], { cwd: process.cwd() });
  const nextStore = new CanvasStore(directory), next = new CanvasService(nextStore); t.after(() => nextStore.close());
  assert.equal((await next.read(reference)).document.blocks[0].title, "Committed before abrupt exit");
  assert.equal((await next.history(reference)).transactions.length, 1);
});

test("workspace scope applies to UI list/read/mutate", async t => {
  const { service } = await setup(t);
  assert.deepEqual((await service.list({ workspaceId: "workspace-b" })).documents, []);
  await assert.rejects(service.read({ ...reference, workspaceId: "workspace-b" }), rejectCode("FORBIDDEN"));
  await assert.rejects(service.mutate({ ...mutation(0, [{ type: "document.update", title: "No" }]), workspaceId: "workspace-b" }), rejectCode("FORBIDDEN"));
});

test("group cycle plus subtree operation atomically rejects and guarded traversal terminates", async t => {
  const { service, store } = await setup(t);
  const disk = await readFile(store.file, "utf8");
  await assert.rejects(service.mutate(mutation(0, [
    { type: "block.update", id: "b", patch: { title: "Must roll back" } },
    { type: "group.create", group: group("g") },
    { type: "group.create", group: group("h", [], ["g"]) },
    { type: "entity.move", id: "h", parentGroupId: "g" },
    { type: "entity.duplicate", id: "g", idPrefix: "copy" },
  ])), rejectCode("INVARIANT"));
  assert.equal(await readFile(store.file, "utf8"), disk);
  assert.throws(() => groupSubtree({ groups: [group("g", [], ["h"]), group("h", [], ["g"])] }, "g"), rejectCode("INVARIANT"));
});

test("group membership reparents once, movement retains local child position and nested instructions", async t => {
  const { service } = await setup(t);
  await service.mutate(mutation(0, [
    { type: "block.update", id: "b", patch: { position: { x: 2, y: 3 }, communication: { instructions: "Block", intent: "", audience: "" } } },
    { type: "group.create", group: { ...group("inner", ["b"]), communication: { instructions: "Inner", intent: "", audience: "" } } },
    { type: "group.create", group: { ...group("outer", [], ["inner"]), communication: { instructions: "Outer", intent: "", audience: "" } } },
    { type: "entity.move", id: "outer", parentGroupId: null, position: { x: 100, y: 200 } },
  ]));
  const current = (await service.read(reference)).document;
  assert.deepEqual(current.blocks[0].position, { x: 2, y: 3 });
  assert.deepEqual(effectiveInstructions(current, "b").map(level => level.instructions), ["Block", "Inner", "Outer", "Explain plainly."]);
  const moved = await service.mutate(mutation(1, [{ type: "group.create", group: group("another", ["b"]) }]));
  assert.equal(moved.document.blocks[0].parentGroupId, "another");
  assert.deepEqual(moved.document.groups.find(group => group.id === "inner")!.blockIds, []);
});

test("group duplicate remaps IDs; ungroup preserves global positions; subtree delete cleans selection", async t => {
  const { service } = await setup(t);
  await service.mutate(mutation(0, [{ type: "group.create", group: { ...group("g", ["b"]), position: { x: 10, y: 20 } } }, { type: "entity.duplicate", id: "g", idPrefix: "copy" }]));
  let current = await service.read(reference);
  assert.equal(current.document.blocks.find(block => block.id === "copy.b")!.parentGroupId, "copy.g");
  await service.selection({ ...reference, expectedSelectionVersion: 0, ids: ["copy.b", "copy.g"] });
  current = await service.mutate(mutation(1, [{ type: "group.delete", id: "copy.g" }, { type: "group.delete", id: "g", ungroup: true }]));
  assert.equal(current.document.blocks.find(block => block.id === "b")!.parentGroupId, null);
  assert.deepEqual(current.document.blocks.find(block => block.id === "b")!.position, { x: 10, y: 20 });
  assert.deepEqual(current.document.selectedIds, []);
});

test("group patch RPC and MCP keep omitted defaults omitted", async t => {
  const { service } = await setup(t);
  assert.deepEqual(groupPatchSchema.parse({ title: "Renamed" }), { title: "Renamed" });
  await service.mutate(mutation(0, [{ type: "group.create", group: group("child", ["b"]) }, { type: "group.create", group: group("parent", [], ["child"]) }]));
  const router = new ToolRouter(service, async () => ({ agentId: "a", workspaceId }));
  for (const patch of [{ title: "Renamed" }, { collapsed: true }, { layout: { mode: "stack" as const } }]) {
    let current = await service.read(reference);
    await service.mutate(mutation(current.document.revision, [{ type: "group.update", id: "parent", patch }]));
    current = await service.read(reference);
    await router.call("canvas_group", { action: "update", documentId: "d", expectedRevision: current.document.revision, id: "parent", patch }, "owner");
    current = await service.read(reference);
    assert.deepEqual(current.document.groups.find(group => group.id === "parent")!.groupIds, ["child"]);
    assert.equal(current.document.groups.find(group => group.id === "parent")!.description, "Keep description");
    assert.equal(current.document.groups.find(group => group.id === "child")!.parentGroupId, "parent");
  }
});

test("depth, duplicate membership, orphan references and unknown new types are rejected", async t => {
  const { service } = await setup(t);
  await assert.rejects(service.mutate(mutation(0, [{ type: "group.create", group: group("g", ["b", "b"]) }])), rejectCode("INVARIANT"));
  await assert.rejects(service.mutate(mutation(0, [{ type: "group.create", group: group("g", ["missing"]) }])), rejectCode("NOT_FOUND"));
  await assert.rejects(service.mutate(mutation(0, [{ type: "block.update", id: "b", patch: { typeId: "missing" } }])), rejectCode("UNKNOWN_TYPE"));
  await assert.rejects(service.mutate(mutation(0, [1, 2, 3, 4, 5].map((depth, index) => ({ type: "group.create", group: group(`g${depth}`, [], index ? [`g${depth - 1}`] : []) })))), rejectCode("INVARIANT"));
});

test("undo/redo increments revisions, restores content and remains per-agent", async t => {
  const { service } = await setup(t);
  const before = (await service.read(reference)).document;
  await service.mutate(mutation(0, [{ type: "block.update", id: "b", patch: { title: "A" } }]), "agent", "a");
  await service.mutate(mutation(1, [{ type: "document.update", description: "B unrelated" }]), "agent", "b");
  let current = await service.undo({ ...reference, expectedRevision: 2 }, "agent", false, "a");
  assert.deepEqual(current.document.blocks, before.blocks);
  assert.equal(current.document.description, "B unrelated");
  assert.equal(current.document.revision, 3);
  current = await service.undo({ ...reference, expectedRevision: 3 }, "agent", true, "a");
  assert.equal(current.document.blocks[0].title, "A");
  await assert.rejects(service.undo({ ...reference, expectedRevision: 4 }, "agent", false, "new-agent"), rejectCode("UNDO_BLOCKED"));
  await service.mutate(mutation(4, [{ type: "block.update", id: "b", patch: { title: "B related" } }]), "agent", "b");
  await assert.rejects(service.undo({ ...reference, expectedRevision: 5 }, "agent", false, "a"), rejectCode("UNDO_BLOCKED"));
});

test("selection has an independent version, no content revision and polling detects runtime changes", async t => {
  const { service } = await setup(t);
  assert.equal((await service.watch({ ...reference, knownRevision: 0, knownRuntimeVersion: 0 })).view, undefined);
  const selected = await service.selection({ ...reference, expectedSelectionVersion: 0, ids: ["b"] });
  assert.equal(selected.document.revision, 0);
  assert.equal(selected.selectionVersion, 1);
  assert.ok((await service.watch({ ...reference, knownRevision: 0, knownRuntimeVersion: 0 })).view);
  await assert.rejects(service.selection({ ...reference, expectedSelectionVersion: 0, ids: [] }), rejectCode("REVISION_CONFLICT"));
});

test("diagram references/checklist objects/media protocols validate; conceptual and real previews work", async t => {
  const { service } = await setup(t);
  assert.deepEqual(checklistDataSchema.parse({ items: [{ label: "Ready", done: true }] }).items, [{ label: "Ready", done: true }]);
  assert.throws(() => diagramDataSchema.parse({ nodes: [{ id: "n", label: "N" }], edges: [{ id: "e", from: "n", to: "missing" }] }));
  await service.mutate(mutation(0, [{ type: "block.create", block: { id: "p", title: "Real preview", typeId: "preview", data: { description: "Running frontend", url: "https://example.test/preview" } } }]));
  for (const url of ["javascript:alert(1)", "data:text/html,hello", "file:///tmp/private", "https://user:password@example.test/"]) await assert.rejects(service.mutate(mutation(1, [{ type: "block.update", id: "p", patch: { data: { url } } }])), rejectCode("VALIDATION"));
  const learned = await service.instantiatePack({ workspaceId, packId: "learn", documentIndex: 0 });
  assert.equal(learned.document.example, true);
  assert.ok(learned.document.blocks.some(block => block.typeId === "diagram"));
});

const userPack = () => packSchema.parse({ format: "paseo-canvas-pack", version: 1, id: "custom", name: "Custom", description: "", blockTypes: [{ id: "custom.note", name: "Custom note", description: "", properties: [{ key: "text", label: "Text", kind: "text", required: true }], defaults: { text: "" } }], templates: [], documents: [] });

test("user pack validate/dry-run/import/export roundtrip persists and removal preserves orphaned block data", async t => {
  const { service, store } = await setup(t);
  const pack = userPack();
  assert.equal((await service.validatePack({ pack })).valid, true);
  const originalDisk = await readFile(store.file, "utf8");
  const dry = await service.importPack({ expectedRevision: 0, pack, dryRun: true, replace: false });
  assert.equal(dry.committed, false); assert.equal((await service.catalog()).revision, 0);
  assert.equal(await readFile(store.file, "utf8"), originalDisk);
  await service.importPack({ expectedRevision: 0, pack, dryRun: false, replace: false });
  const exported = await service.exportPack({ id: pack.id });
  assert.deepEqual(exported, pack); assert.equal((await service.validatePack({ pack: exported })).valid, true);
  await service.mutate(mutation(0, [{ type: "block.create", block: { id: "custom", typeId: "custom.note", title: "Saved", data: { text: "Keep" } } }]));
  await service.catalogMutate({ expectedRevision: 1, action: { type: "pack.remove", id: pack.id } });
  await service.mutate(mutation(1, [{ type: "document.update", title: "Unrelated" }]));
  assert.equal((await service.read(reference)).document.blocks.find(block => block.id === "custom")!.data.text, "Keep");
});

test("pack docs with unknown types, size excess, duplicates and local/pack namespace collisions fail atomically", async t => {
  const { service, store } = await setup(t);
  const unknown = userPack(); unknown.documents = [{ ...content(), blocks: [{ id: "unknown", typeId: "missing", title: "", data: {} }] }];
  assert.equal((await service.validatePack({ pack: unknown })).valid, false);
  const disk = await readFile(store.file, "utf8");
  await assert.rejects(service.importPack({ expectedRevision: 0, pack: unknown, dryRun: false, replace: false }), rejectCode("UNKNOWN_TYPE"));
  assert.equal(await readFile(store.file, "utf8"), disk);
  await service.catalogMutate({ expectedRevision: 0, action: { type: "type.put", blockType: userPack().blockTypes[0] } });
  await assert.rejects(service.importPack({ expectedRevision: 1, pack: userPack(), dryRun: false, replace: false }), rejectCode("VALIDATION"));
  const huge = { ...userPack(), description: "x".repeat(1024 * 1024) };
  assert.equal((await service.validatePack({ pack: huge })).valid, false);
});

test("pack namespace nesting and local template collisions are refused", async t => {
  const { service } = await setup(t);
  const pack = userPack();
  await service.importPack({ expectedRevision: 0, pack, dryRun: false, replace: false });
  const nested = { ...userPack(), id: "custom.nested", blockTypes: [] };
  await assert.rejects(service.importPack({ expectedRevision: 1, pack: nested, dryRun: false, replace: false }), rejectCode("VALIDATION"));
  await service.catalogMutate({ expectedRevision: 1, action: { type: "template.put", template: { id: "newpack.group", name: "Local", description: "", blocks: [], groups: [] } } });
  const collision = { ...userPack(), id: "newpack", blockTypes: [], templates: [{ id: "newpack.group", name: "Pack", description: "", blocks: [], groups: [] }] };
  await assert.rejects(service.importPack({ expectedRevision: 2, pack: collision, dryRun: false, replace: false }), rejectCode("VALIDATION"));
});

test("group export/catalog save/template insert remaps nested IDs", async t => {
  const { service } = await setup(t);
  await service.mutate(mutation(0, [{ type: "group.create", group: group("g", ["b"]) }]));
  const { template } = await service.exportGroup({ ...reference, groupId: "g", templateId: "local-template", name: "Local" });
  await service.catalogMutate({ expectedRevision: 0, action: { type: "template.put", template } });
  const current = await service.mutate(mutation(1, [{ type: "template.insert", templateId: template.id, idPrefix: "inserted" }]));
  assert.deepEqual(current.document.groups.find(group => group.id === "inserted.g")!.blockIds, ["inserted.b"]);
});

test("MCP large create and library write succeed with compact truthful acknowledgements", async t => {
  const { service } = await setup(t);
  const router = new ToolRouter(service, async () => ({ agentId: "a", workspaceId }));
  const large = content(); large.blocks[0].data.text = "x".repeat(30000);
  const response = await router.call("canvas_create", { id: "large", content: large }, "owner") as { documentId: string; revision: number };
  assert.equal(response.documentId, "large");
  assert.equal((await service.read({ workspaceId, documentId: "large" })).document.blocks[0].data.text, large.blocks[0].data.text);
  const blockType = { ...userPack().blockTypes[0], id: "huge-local", defaults: { text: "x".repeat(30000) } };
  assert.deepEqual(await router.call("canvas_catalog", { action: "save_type", expectedRevision: 0, blockType }, "owner"), { revision: 1, committed: true });
  const full = await router.call("canvas_read", { documentId: "large", view: "full" }, "owner") as { truncated: boolean };
  assert.equal(full.truncated, true);
});
