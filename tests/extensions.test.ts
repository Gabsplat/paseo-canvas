import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { catalogStorageSchema, catalogView } from "../plugin/server/catalog";
import { ToolRouter } from "../plugin/server/tools";
import { EXTENSION_GUIDE, EXTENSION_RUNTIME, extensionDocument } from "../plugin/shared/extensions";
import { EXAMPLE_HTML } from "../plugin/shared/wiki";
import { findAndReplace } from "./fixtures/find-replace";
import { extensionSchema, packSchema } from "../plugin/shared/model";
import { setup, workspaceId } from "./helpers";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { CanvasStore } from "../plugin/server/store";
import { CanvasService } from "../plugin/server/service";

const view = (id: string, html = "<p>vista</p>", permissions: string[] = []) => ({ id, kind: "tool", api: 1, name: "Herramienta de prueba", description: "Dato de ejemplo.", html, permissions });
const off = { copilot: { enabled: false, cadence: "step", rule: "", documentId: null } };
const retired = (id: string) => ({ id, kind: "view", api: 1, name: "Vista retirada", description: "Dato de ejemplo.", html: "<p>vista</p>", permissions: [] });
const pack = (extensions: unknown[], id = "ajeno") => ({ format: "paseo-canvas-pack", version: 1, id, name: "Colección de prueba", description: "Datos de ejemplo.", blockTypes: [], templates: [], documents: [], extensions });

test("a local extension is saved, listed as trusted, replaced by its own ID and removed", async t => {
  const { service } = await setup(t);
  let catalog = await service.catalogMutate({ expectedRevision: 0, action: { type: "extension.put", extension: extensionSchema.parse(view("mia")) } });
  assert.deepEqual(catalog.extensions.filter(e => e.source === "local").map(e => [e.id, e.granted]), [["mia", true]]);
  catalog = await service.catalogMutate({ expectedRevision: catalog.revision, action: { type: "extension.put", extension: extensionSchema.parse(view("mia", "<p>otra</p>", ["edit"])) } });
  assert.equal(catalog.extensions.filter(e => e.id === "mia").length, 1); assert.deepEqual(catalog.extensions.find(e => e.id === "mia")!.permissions, ["edit"]);
  catalog = await service.catalogMutate({ expectedRevision: catalog.revision, action: { type: "extension.remove", id: "mia" } });
  assert.equal(catalog.extensions.some(e => e.id === "mia"), false);
});
test("a local extension cannot take an imported one's ID, a file's namespace or a repeated permission", async t => {
  const { service } = await setup(t);
  const { catalog: imported } = await service.importPack({ expectedRevision: 0, pack: pack([view("ajeno.a")]), replace: false, dryRun: false });
  await assert.rejects(service.catalogMutate({ expectedRevision: imported.revision, action: { type: "extension.put", extension: extensionSchema.parse(view("ajeno.a")) } }), /cannot replace|namespace/);
  await assert.rejects(service.catalogMutate({ expectedRevision: imported.revision, action: { type: "extension.put", extension: extensionSchema.parse(view("ajeno.nueva")) } }), /namespace/);
  await assert.rejects(service.catalogMutate({ expectedRevision: imported.revision, action: { type: "extension.put", extension: extensionSchema.parse(view("doble", "<p/>", ["edit", "edit"])) } }), /repeats/);
  await assert.rejects(service.catalogMutate({ expectedRevision: imported.revision, action: { type: "extension.remove", id: "ajeno.a" } }), /not found/i);
  assert.throws(() => extensionSchema.parse({ ...view("v2"), api: 2 })); assert.throws(() => extensionSchema.parse({ ...view("x"), permissions: ["filesystem"] }));
});
test("an imported extension holds no permission until granted, and a changed one must be granted again", async t => {
  const { service } = await setup(t);
  await assert.rejects(service.importPack({ expectedRevision: 0, pack: pack([view("suelta")]), replace: false, dryRun: false }), /namespace/);
  let result = await service.importPack({ expectedRevision: 0, pack: pack([view("ajeno.a", "<p>1</p>", ["edit"]), view("ajeno.b")]), replace: false, dryRun: false });
  assert.deepEqual(result.diff.added, ["ajeno.a", "ajeno.b"]);
  assert.deepEqual(result.catalog.extensions.filter(e => e.source === "ajeno").map(e => e.granted), [false, false]);
  let catalog = await service.catalogMutate({ expectedRevision: result.catalog.revision, action: { type: "extension.grant", id: "ajeno.a", granted: true } });
  assert.equal(catalog.extensions.find(e => e.id === "ajeno.a")!.granted, true);
  catalog = await service.catalogMutate({ expectedRevision: catalog.revision, action: { type: "extension.put", extension: extensionSchema.parse(view("mia")) } });
  await assert.rejects(service.catalogMutate({ expectedRevision: catalog.revision, action: { type: "extension.grant", id: "mia", granted: false } }), /imported file/);
  // Same code: the grant stays. Different code: it is gone.
  result = await service.importPack({ expectedRevision: catalog.revision, pack: pack([view("ajeno.a", "<p>1</p>", ["edit"])]), replace: true, dryRun: false });
  assert.equal(result.catalog.extensions.find(e => e.id === "ajeno.a")!.granted, true);
  result = await service.importPack({ expectedRevision: result.catalog.revision, pack: pack([view("ajeno.a", "<p>2</p>", ["edit", "network"])]), replace: true, dryRun: false });
  assert.equal(result.catalog.extensions.find(e => e.id === "ajeno.a")!.granted, false);
  catalog = await service.catalogMutate({ expectedRevision: result.catalog.revision, action: { type: "extension.grant", id: "ajeno.a", granted: true } });
  catalog = await service.catalogMutate({ expectedRevision: catalog.revision, action: { type: "pack.remove", id: "ajeno" } });
  assert.equal(catalog.extensions.some(e => e.source === "ajeno"), false);
  result = await service.importPack({ expectedRevision: catalog.revision, pack: pack([view("ajeno.a", "<p>2</p>", ["edit", "network"])]), replace: false, dryRun: false });
  assert.equal(result.catalog.extensions.find(e => e.id === "ajeno.a")!.granted, false, "a grant does not outlive its pack");
  assert.deepEqual(result.catalog.packs.find(p => p.id === "ajeno")!.extensions.map(e => e.id), ["ajeno.a"]);
});
test("state and packs written before extensions existed still load", () => {
  const storage = catalogStorageSchema.parse({ revision: 3, localTypes: [], localTemplates: [], packs: [{ format: "paseo-canvas-pack", version: 1, id: "viejo", name: "Viejo", description: "", blockTypes: [], templates: [], documents: [] }] });
  assert.deepEqual([storage.localExtensions, storage.grants, storage.packs[0].extensions], [[], [], []]);
  assert.deepEqual(catalogView(storage).extensions, [], "nothing ships: the extension examples left the app");
  assert.deepEqual(packSchema.parse(pack([])).extensions, []);
});
test("catalogs and packs stored with the retired view kind still load, without the views", async t => {
  const storage = catalogStorageSchema.parse({ revision: 4, localTypes: [], localTemplates: [], localExtensions: [retired("vieja"), view("mia")], grants: ["viejo.v"], packs: [{ format: "paseo-canvas-pack", version: 1, id: "viejo", name: "Viejo", description: "", blockTypes: [], templates: [], documents: [], extensions: [retired("viejo.v"), view("viejo.t")] }] });
  assert.deepEqual(storage.localExtensions.map(e => e.id), ["mia"]);
  assert.deepEqual(storage.packs[0].extensions.map(e => e.id), ["viejo.t"]);
  assert.ok(catalogView(storage).extensions.every(e => e.kind === "tool"));
  assert.throws(() => extensionSchema.parse(retired("nueva")), "a view cannot be saved any more");
  // A state file written before: it loads, and the next write leaves the views out.
  const { service, store, directory } = await setup(t);
  await store.close();
  const file = JSON.parse(await readFile(join(directory, "state.json"), "utf8"));
  file.catalog.localExtensions = [retired("vieja"), view("mia")];
  await writeFile(join(directory, "state.json"), JSON.stringify(file));
  const reopened = new CanvasStore(directory); t.after(() => reopened.close());
  const catalog = await new CanvasService(reopened).catalog();
  assert.deepEqual(catalog.extensions.filter(e => e.source === "local").map(e => e.id), ["mia"]);
  void service;
});
test("the assistant saves and removes an extension through MCP and is told the whole API", async t => {
  const { service } = await setup(t), router = new ToolRouter(service, async () => ({ agentId: "a", workspaceId }));
  const listed = await router.call("canvas_catalog", { action: "list" }, "owner") as { revision: number; extensions: { id: string; kind: string; source: string }[]; extensionGuide: string };
  assert.equal(listed.extensions.length, 0); assert.ok(!/ejemplos|shipped example/.test(listed.extensionGuide), "the guide carries its own short example");
  assert.ok(listed.extensionGuide.includes(EXAMPLE_HTML), "the guide ends with the Help tutorial's complete example");
  assert.ok(listed.extensions.every(e => e.kind === "tool") && !/kind "view"|Cambiar vista|mosaico/.test(listed.extensionGuide), "views are gone from the catalog and the guide");
  for (const word of ["lienzo.onContext", "lienzo.select", "lienzo.edit", "lienzo.kit.stage", "save_extension", "api: 1"]) assert.ok(listed.extensionGuide.includes(word), word);
  assert.equal(listed.extensionGuide, EXTENSION_GUIDE);
  assert.deepEqual(await router.call("canvas_catalog", { action: "save_extension", expectedRevision: listed.revision, extension: { ...view("del-asistente"), kind: "tool", permissions: ["edit"] } }, "owner"), { revision: listed.revision + 1, committed: true, ...off });
  const read = await router.call("canvas_catalog", { action: "read", id: "del-asistente" }, "owner") as { entry: { html: string; source: string; granted: boolean }; guidance: string };
  assert.deepEqual([read.entry.html, read.entry.source, read.entry.granted, read.guidance], ["<p>vista</p>", "local", true, EXTENSION_GUIDE]);
  await assert.rejects(router.call("canvas_catalog", { action: "save_extension", expectedRevision: 0, extension: view("tarde") }, "owner"), /Catalog changed|REVISION/);
  assert.deepEqual(await router.call("canvas_catalog", { action: "remove_extension", expectedRevision: listed.revision + 1, id: "del-asistente" }, "owner"), { revision: listed.revision + 2, committed: true, ...off });
});
test("a frame gets the runtime first and no network unless it was asked for and granted", () => {
  const offline = extensionDocument({ html: "<!DOCTYPE html><p>hola</p>", permissions: [] }, true), asked = extensionDocument({ html: "<p>hola</p>", permissions: ["network"] }, true), pending = extensionDocument({ html: "<p>hola</p>", permissions: ["network"] }, false);
  assert.ok(offline.startsWith("<!doctype html>") && offline.includes("Content-Security-Policy") && offline.includes("default-src 'none'") && offline.endsWith("</script><body><p>hola</p>") && !/<!DOCTYPE html><p>/.test(offline));
  assert.ok(!asked.includes("Content-Security-Policy") && pending.includes("Content-Security-Policy"));
  for (const page of [offline, asked, pending]) assert.ok(page.indexOf("window.lienzo=") > 0 && page.indexOf("window.lienzo=") < page.indexOf("<p>hola</p>"));
  assert.ok(!/https?:\/\//.test(findAndReplace.html), "the contract example loads nothing from outside");
});
test("API 1 inside the frame: context, calls that resolve or reject, and nothing from another window", async () => {
  const sent: { type: string; id?: number; method?: string; args?: Record<string, unknown> }[] = [], listeners: ((e: { source: unknown; data: unknown }) => void)[] = [];
  const parent = { postMessage: (m: never) => { sent.push(m); } }, window = { parent, addEventListener: (type: string, f: never) => { if (type === "message") listeners.push(f); } } as Record<string, unknown>;
  vm.runInNewContext(EXTENSION_RUNTIME, { window, parent, console, Promise });
  const lienzo = window.lienzo as { api: number; context: unknown; onContext(f: (c: unknown) => void): () => void; select(ids: string[]): Promise<unknown>; edit(ops: unknown[], label?: string): Promise<unknown>; ask?: unknown; open(id: string): Promise<unknown>; close(): Promise<unknown>; kit: { stage: unknown; card: unknown } };
  assert.deepEqual([lienzo.api, sent[0].type, typeof lienzo.kit.stage, typeof lienzo.kit.card], [1, "ready", "function", "function"]);
  const seen: unknown[] = []; lienzo.onContext(c => seen.push(c));
  const deliver = (data: unknown, source: unknown = parent) => listeners.forEach(f => f({ source, data }));
  deliver({ lienzo: 1, type: "context", context: { api: 1, selection: ["a"] } }); deliver({ lienzo: 1, type: "context", context: { stolen: true } }, {}); deliver({ type: "context", context: { unmarked: true } });
  assert.deepEqual(seen, [{ api: 1, selection: ["a"] }]); assert.deepEqual(lienzo.context, { api: 1, selection: ["a"] });
  const late: unknown[] = []; lienzo.onContext(c => late.push(c)); assert.equal(late.length, 1, "a late listener gets the current context at once");
  const selected = lienzo.select(["a", "b"]), edited = lienzo.edit([{ type: "block.delete", id: "a" }], "Borrar");
  const [selectCall, editCall] = sent.slice(-2);
  const plain = (value: unknown) => JSON.parse(JSON.stringify(value)); // objects made inside the frame belong to another realm
  assert.deepEqual(plain([selectCall.type, selectCall.method, selectCall.args]), ["call", "select", { ids: ["a", "b"] }]); assert.deepEqual(plain([editCall.method, editCall.args]), ["edit", { operations: [{ type: "block.delete", id: "a" }], label: "Borrar" }]);
  deliver({ lienzo: 1, type: "result", id: selectCall.id, ok: true, value: { ids: ["a"] } }); deliver({ lienzo: 1, type: "result", id: editCall.id, ok: false, error: "Sin permiso" });
  assert.deepEqual(await selected, { ids: ["a"] }); await assert.rejects(edited, /Sin permiso/);
  assert.equal(lienzo.ask, undefined, "lienzo.ask is gone: an extension cannot message the agent");
  for (const [name, call] of [["open", () => lienzo.open("a")], ["close", () => lienzo.close()]] as const) { void call().catch(() => {}); assert.equal(sent.at(-1)!.method, name); }
});
test("the agent permission is gone: refused for a new extension, dropped from stored and imported ones", async t => {
  assert.throws(() => extensionSchema.parse(view("pide", "<p/>", ["agent"])));
  assert.ok(!EXTENSION_GUIDE.includes("lienzo.ask") && !EXTENSION_GUIDE.includes('"agent"'));
  // An imported pack written before keeps loading, without the permission.
  assert.deepEqual(packSchema.parse(pack([view("ajeno.vieja", "<p/>", ["edit", "agent", "network"])])).extensions[0].permissions, ["edit", "network"]);
  const { service, store, directory } = await setup(t);
  const result = await service.importPack({ expectedRevision: 0, pack: pack([view("ajeno.pide", "<p/>", ["agent"])]), replace: false, dryRun: false });
  assert.deepEqual(result.catalog.extensions.find(e => e.id === "ajeno.pide")!.permissions, []);
  const router = new ToolRouter(service, async () => ({ agentId: "a", workspaceId }));
  await assert.rejects(router.call("canvas_catalog", { action: "save_extension", expectedRevision: result.catalog.revision, extension: { ...view("del-asistente"), permissions: ["agent"] } }, "owner"));
  // A stored local extension that held it loads without it.
  await store.close();
  const file = JSON.parse(await readFile(join(directory, "state.json"), "utf8"));
  file.catalog.localExtensions = [{ ...view("guardada", "<p/>", ["edit", "agent"]) }];
  await writeFile(join(directory, "state.json"), JSON.stringify(file));
  const reopened = new CanvasStore(directory); t.after(() => reopened.close());
  assert.deepEqual((await new CanvasService(reopened).catalog()).extensions.find(e => e.id === "guardada")!.permissions, ["edit"]);
});
