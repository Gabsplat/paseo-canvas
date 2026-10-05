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
import { groupSchema, groupPatchSchema, diagramDataSchema, checklistDataSchema, packSchema, documentSchema, documentContentSchema, templateSchema, linkSchema, operationSchema, layoutSchema } from "../plugin/shared/model";
import { groupSubtree, effectiveInstructions } from "../plugin/server/reducer";
import { ToolRouter } from "../plugin/server/tools";
import { setup, workspaceId, mutation, content } from "./helpers";

const reference = { workspaceId, documentId: "d" };
const rejectCode = (code: string) => (error: unknown) => error instanceof CanvasError && error.code === code;
const group = (id: string, blockIds: string[] = [], groupIds: string[] = []) => groupSchema.parse({ id, title: id, description: "Keep description", blockIds, groupIds });

test("pre-v1.1 strict documents/templates parse and existing state/1 history and feedback reopen", async t => {
  const { service, store, directory } = await setup(t);
  const { links: _links, ...legacyContent } = content();
  const legacy = { ...legacyContent, id: "legacy", workspaceId, revision: 0, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
  assert.deepEqual(documentSchema.parse(legacy).links, []);
  assert.equal(documentSchema.parse(legacy).layout, undefined);
  assert.deepEqual(templateSchema.parse({ id: "old", name: "Old", description: "", blocks: [], groups: [] }).links, []);
  await service.mutate(mutation(0, [{ type: "document.update", title: "Before upgrade" }]));
  await service.action(rpc.agentAction.input.parse({ ...reference, expectedRevision: 1, eventId: "old-event", action: { kind: "ask", label: "Explain", payload: {} } }));
  await service.catalogMutate(rpc.mutateCatalog.input.parse({ expectedRevision: 0, action: { type: "template.put", template: { id: "old", name: "Old", description: "", blocks: [], groups: [] } } }));
  const disk = JSON.parse(await readFile(store.file, "utf8"));
  const removeNewFields = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) { value.forEach(removeNewFields); return; }
    const object = value as Record<string, unknown>;
    delete object.links;
    Object.values(object).forEach(removeNewFields);
  };
  removeNewFields(disk);
  await store.close();
  await writeFile(store.file, JSON.stringify(disk));
  const reopened = new CanvasStore(directory); t.after(() => reopened.close());
  const state = await reopened.read();
  assert.equal(state.format, "paseo-canvas-state/1");
  assert.deepEqual(state.documents.d.document.links, []);
  assert.deepEqual(state.documents.d.history[0].before.links, []);
  assert.deepEqual(state.documents.d.history[0].after.links, []);
  assert.deepEqual(state.documents.d.events[0].context.links, []);
  assert.deepEqual(state.catalog.localTemplates[0].links, []);
  const undo = await new CanvasService(reopened).undo({ ...reference, expectedRevision: 1 });
  assert.equal(undo.document.title, "Test document");
});

test("link and graph schemas default creation fields but never default link patches", () => {
  assert.deepEqual(linkSchema.parse({ id: "l", from: "b", to: "c" }), { id: "l", from: "b", to: "c", kind: "flow" });
  assert.deepEqual(operationSchema.parse({ type: "link.update", id: "l", patch: { label: "Renamed" } }), { type: "link.update", id: "l", patch: { label: "Renamed" } });
  assert.deepEqual(layoutSchema.parse({ mode: "graph", direction: "right" }), { mode: "graph", direction: "right" });
  for (const patch of [{ kind: "invalid" }, { tone: "blue" }, { label: "x".repeat(201) }, { unexpected: true }]) assert.equal(linkSchema.safeParse({ id: "l", from: "b", to: "c", ...patch }).success, false);
  assert.equal(operationSchema.safeParse({ type: "link.update", id: "l", patch: { id: "other" } }).success, false);
  assert.equal(layoutSchema.safeParse({ mode: "graph", direction: "left" }).success, false);
  assert.equal(documentContentSchema.safeParse({ ...content(), links: Array.from({ length: 2001 }, (_, i) => ({ id: `l${i}`, from: "b", to: "c" })) }).success, false);
});

test("link CRUD validates endpoints, self links, IDs and directed kind triples atomically", async t => {
  const { service, store } = await setup(t);
  await service.mutate(mutation(0, [
    { type: "link.create", link: linkSchema.parse({ id: "l", from: "b", to: "c", kind: "depends", tone: "violeta" }) },
    { type: "link.create", link: linkSchema.parse({ id: "flow", from: "b", to: "c" }) },
    { type: "link.create", link: linkSchema.parse({ id: "reverse", from: "c", to: "b" }) },
  ]));
  const disk = await readFile(store.file, "utf8");
  for (const link of [
    { id: "l", from: "c", to: "b", kind: "reference" },
    { id: "missing", from: "b", to: "absent" },
    { id: "self", from: "b", to: "b" },
    { id: "duplicate", from: "b", to: "c", kind: "depends" },
    { id: "b", from: "b", to: "c", kind: "reference" },
  ]) {
    await assert.rejects(service.mutate(mutation(1, [
      { type: "block.update", id: "b", patch: { title: "Must roll back" } },
      { type: "link.create", link: linkSchema.parse(link) },
    ])), rejectCode("INVARIANT"));
    assert.equal(await readFile(store.file, "utf8"), disk);
  }
  for (const patch of [{ kind: "flow" }, { from: "c", to: "b", kind: "flow" }, { to: "b" }, { from: "missing" }]) {
    await assert.rejects(service.mutate(mutation(1, [operationSchema.parse({ type: "link.update", id: "l", patch })])), rejectCode("INVARIANT"));
  }
  let current = await service.mutate(mutation(1, [{ type: "link.update", id: "l", patch: { label: "Necesita", tone: "acento" } }]));
  assert.equal(current.document.links[0].kind, "depends");
  assert.equal(current.document.links[0].label, "Necesita");
  assert.equal(current.document.links[0].tone, "acento");
  current = await service.mutate(mutation(2, [{ type: "link.update", id: "l", patch: { from: "c", to: "b", kind: "reference" } }]));
  assert.deepEqual([current.document.links[0].from, current.document.links[0].to, current.document.links[0].kind], ["c", "b", "reference"]);
  await assert.rejects(service.mutate(mutation(3, [{ type: "link.update", id: "absent", patch: {} }])), rejectCode("NOT_FOUND"));
  await assert.rejects(service.mutate(mutation(3, [{ type: "link.delete", id: "absent" }])), rejectCode("NOT_FOUND"));
  await service.mutate(mutation(3, [{ type: "link.delete", id: "l" }]));
  const history = (await service.history(reference)).transactions;
  assert.ok(history[0].changed.includes("l"));
  assert.deepEqual(history.at(-1)!.removed, ["l"]);
  await assert.rejects(service.mutate(mutation(1, [{ type: "document.update", title: "Stale" }])), error => error instanceof CanvasError && error.code === "REVISION_CONFLICT" && (error.details.changedSince as string[]).includes("l") && (error.details.removedSince as string[]).includes("l"));
});

async function createLinkedTree(service: CanvasService) {
  return service.mutate(mutation(0, [
    { type: "block.create", block: { id: "x", typeId: "node", title: "Outside", data: {} } },
    { type: "block.create", block: { id: "y", typeId: "node", title: "Survivor", data: {} } },
    { type: "group.create", group: { ...group("h", ["c"]), layout: { mode: "graph", direction: "right" } } },
    { type: "group.create", group: { ...group("g", ["b"], ["h"]), layout: { mode: "graph" } } },
    ...[
      { id: "internal", from: "b", to: "c", kind: "flow" },
      { id: "to-group", from: "b", to: "h", kind: "depends" },
      { id: "cross", from: "c", to: "x", kind: "reference" },
      { id: "boundary", from: "g", to: "x", kind: "flow" },
      { id: "survives", from: "x", to: "y", kind: "flow" },
    ].map(link => operationSchema.parse({ type: "link.create", link })),
  ]));
}

for (const deletion of ["block", "subtree", "ungroup"] as const) test(`${deletion} deletion cascades only touching links; undo/redo restores them`, async t => {
  const { service } = await setup(t);
  const before = (await createLinkedTree(service)).document;
  const operation = operationSchema.parse(deletion === "block" ? { type: "block.delete", id: "b" } : { type: "group.delete", id: "g", ungroup: deletion === "ungroup" });
  const removedLinks = deletion === "block" ? ["internal", "to-group"] : deletion === "subtree" ? ["internal", "to-group", "cross", "boundary"] : ["boundary"];
  const after = await service.mutate(mutation(1, [operation]));
  assert.deepEqual(after.document.links, before.links.filter(link => !removedLinks.includes(link.id)));
  const history = (await service.history(reference)).transactions.at(-1)!;
  for (const id of removedLinks) assert.ok(history.removed.includes(id));
  const undo = await service.undo({ ...reference, expectedRevision: 2 });
  assert.deepEqual(undo.document.links, before.links);
  assert.deepEqual(undo.document.groups, before.groups);
  const redo = await service.undo({ ...reference, expectedRevision: 3 }, "user", true);
  assert.deepEqual(redo.document.links, after.document.links);
});

test("document layout is persisted history intent and undo restores absence without touching unrelated edits", async t => {
  const { service, store, directory } = await setup(t);
  await service.mutate(mutation(0, [{ type: "document.update", layout: { mode: "graph", direction: "right", gap: 36 } }]), "agent", "a");
  await service.mutate(mutation(1, [{ type: "link.create", link: linkSchema.parse({ id: "later", from: "b", to: "c" }) }]));
  const undone = await service.undo({ ...reference, expectedRevision: 2 }, "agent", false, "a");
  assert.equal(undone.document.layout, undefined);
  assert.equal(undone.document.links[0].id, "later");
  const redone = await service.undo({ ...reference, expectedRevision: 3 }, "agent", true, "a");
  assert.deepEqual(redone.document.layout, { mode: "graph", direction: "right", gap: 36 });
  assert.deepEqual((await service.history(reference)).transactions[0].changed, ["$document"]);
  await store.close();
  const reopened = new CanvasStore(directory); t.after(() => reopened.close());
  assert.deepEqual((await reopened.read()).documents.d.document.links, redone.document.links);
  assert.deepEqual((await reopened.read()).documents.d.document.layout, redone.document.layout);
});

test("undo handles link edits per agent and blocks removal of entities with later dependent links", async t => {
  const { service } = await setup(t);
  await service.mutate(mutation(0, [{ type: "link.create", link: linkSchema.parse({ id: "l", from: "b", to: "c" }) }]), "agent", "a");
  await service.mutate(mutation(1, [{ type: "block.update", id: "b", patch: { title: "Unrelated" } }]), "agent", "b");
  assert.deepEqual((await service.undo({ ...reference, expectedRevision: 2 }, "agent", false, "a")).document.links, []);
  assert.equal((await service.undo({ ...reference, expectedRevision: 3 }, "agent", true, "a")).document.links.length, 1);
  await service.mutate(mutation(4, [{ type: "link.update", id: "l", patch: { label: "Later" } }]), "agent", "b");
  await assert.rejects(service.undo({ ...reference, expectedRevision: 5 }, "agent", false, "a"), rejectCode("UNDO_BLOCKED"));
  await service.mutate(mutation(5, [{ type: "block.create", block: { id: "new", typeId: "node", title: "New", data: {} } }]), "agent", "a");
  await service.mutate(mutation(6, [{ type: "link.create", link: linkSchema.parse({ id: "dependency", from: "new", to: "b" }) }]), "agent", "b");
  const disk = await readFile(service.store.file, "utf8");
  await assert.rejects(service.undo({ ...reference, expectedRevision: 7 }, "agent", false, "a"), rejectCode("UNDO_BLOCKED"));
  assert.equal(await readFile(service.store.file, "utf8"), disk);
});

test("duplicate and template insertion remap internal subtree links, exports exclude boundary links", async t => {
  const { service, store } = await setup(t);
  await createLinkedTree(service);
  const { template } = await service.exportGroup({ ...reference, groupId: "g", templateId: "local-graph", name: "Graph" });
  assert.deepEqual(template.links.map(link => link.id), ["internal", "to-group"]);
  assert.equal(template.groups.find(group => group.id === "g")!.parentGroupId, null);
  assert.equal(template.groups.find(group => group.id === "h")!.layout?.direction, "right");
  await service.catalogMutate({ expectedRevision: 0, action: { type: "template.put", template } });
  const current = await service.mutate(mutation(1, [
    { type: "entity.duplicate", id: "g", idPrefix: "copy" },
    { type: "entity.duplicate", id: "b", idPrefix: "single" },
    { type: "template.insert", templateId: template.id, idPrefix: "insert" },
  ]));
  for (const prefix of ["copy", "insert"]) {
    assert.deepEqual(current.document.links.filter(link => link.id.startsWith(`${prefix}.`)), template.links.map(link => ({ ...link, id: `${prefix}.${link.id}`, from: `${prefix}.${link.from}`, to: `${prefix}.${link.to}` })));
  }
  assert.ok(!current.document.links.some(link => link.from === "single.b" || link.to === "single.b"));
  const disk = await readFile(store.file, "utf8");
  await assert.rejects(service.mutate(mutation(2, [{ type: "template.insert", templateId: template.id, idPrefix: "copy" }])), rejectCode("INVARIANT"));
  assert.equal(await readFile(store.file, "utf8"), disk);
});

test("node type has four optional text properties; built-in graph example explains Lienzo with cross-group links", async t => {
  const { service } = await setup(t);
  const type = (await service.catalog()).blockTypes.find(type => type.id === "node")!;
  assert.equal(type.renderer, "node");
  assert.deepEqual(type.properties.map(property => property.key), ["kind", "status", "summary", "details"]);
  assert.ok(type.properties.every(property => property.kind === "text" && !property.required));
  await service.mutate(mutation(0, [{ type: "block.create", block: { id: "n", typeId: "node", title: "Compact", data: {} } }]));
  for (const key of ["kind", "status", "summary", "details"]) await assert.rejects(service.mutate(mutation(1, [{ type: "block.update", id: "n", patch: { data: { [key]: 42 } } }])), rejectCode("VALIDATION"));
  await service.mutate(mutation(1, [{ type: "block.update", id: "n", patch: { data: { kind: "MODULE", status: "ready", summary: "Short", details: "Long" } } }]));
  const example = (await service.instantiatePack({ workspaceId, packId: "graph", documentIndex: 0 })).document;
  assert.equal(example.example, true);
  assert.match(example.title, /Ejemplo.*Lienzo/);
  assert.ok(example.blocks.every(block => block.typeId === "node"));
  assert.ok(example.groups.length >= 2 && example.groups.length <= 3);
  assert.ok(example.groups.every(group => group.layout?.mode === "graph"));
  assert.equal(example.layout?.mode, "graph");
  assert.deepEqual(new Set(example.links.map(link => link.kind)), new Set(["flow", "depends", "reference"]));
  assert.ok(example.links.some(link => example.blocks.find(block => block.id === link.from)?.parentGroupId !== example.blocks.find(block => block.id === link.to)?.parentGroupId));
  const exported = await service.exportPack({ id: "graph" });
  assert.deepEqual(exported.documents[0].links, example.links);
  assert.equal((await service.validatePack({ pack: exported })).valid, false);
});

test("packs roundtrip graph document and template links/layouts; malformed links reject without writes", async t => {
  const { service, store, directory } = await setup(t);
  await createLinkedTree(service);
  const { template } = await service.exportGroup({ ...reference, groupId: "g", templateId: "custom.graph", name: "Graph" });
  const { id: _id, workspaceId: _workspaceId, revision: _revision, createdAt: _createdAt, updatedAt: _updatedAt, ...doc } = (await service.read(reference)).document;
  doc.layout = { mode: "graph", direction: "right" };
  const pack = { ...userPack(), templates: [template], documents: [doc] };
  assert.equal((await service.validatePack({ pack })).valid, true);
  const disk = await readFile(store.file, "utf8");
  for (const invalid of [
    { ...pack, documents: [{ ...doc, links: [linkSchema.parse({ id: "bad", from: "b", to: "missing" })] }] },
    { ...pack, templates: [{ ...template, links: [linkSchema.parse({ id: "bad", from: "b", to: "x" })] }] },
    { ...pack, templates: [{ ...template, links: [template.links[0], { ...template.links[0], id: "duplicate" }] }] },
  ]) {
    assert.equal((await service.validatePack({ pack: invalid })).valid, false);
    await assert.rejects(service.importPack({ expectedRevision: 0, pack: invalid, dryRun: false, replace: false }), rejectCode("INVARIANT"));
    assert.equal(await readFile(store.file, "utf8"), disk);
  }
  await service.importPack({ expectedRevision: 0, pack, dryRun: false, replace: false });
  assert.deepEqual(await service.exportPack({ id: "custom" }), pack);
  const instantiated = await service.instantiatePack({ workspaceId, packId: "custom", documentIndex: 0, id: "packed" });
  assert.deepEqual(instantiated.document.links, doc.links);
  assert.deepEqual(instantiated.document.layout, doc.layout);
  await store.close();
  const reopened = new CanvasStore(directory); t.after(() => reopened.close());
  const fresh = new CanvasService(reopened);
  assert.deepEqual(await fresh.exportPack({ id: "custom" }), pack);
  assert.deepEqual((await fresh.read({ ...reference, documentId: "packed" })).document.links, doc.links);
  const inserted = await fresh.mutate(mutation(1, [{ type: "template.insert", templateId: "custom.graph", idPrefix: "packed" }]));
  assert.deepEqual(inserted.document.links.filter(link => link.id.startsWith("packed.")), template.links.map(link => ({ ...link, id: `packed.${link.id}`, from: `packed.${link.from}`, to: `packed.${link.to}` })));
});

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
  await service.catalogMutate({ expectedRevision: 1, action: { type: "template.put", template: { id: "newpack.group", name: "Local", description: "", blocks: [], groups: [], links: [] } } });
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
