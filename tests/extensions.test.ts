import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { catalogStorageSchema, catalogView } from "../plugin/server/catalog";
import { ToolRouter } from "../plugin/server/tools";
import { EXTENSION_GUIDE, EXTENSION_RUNTIME, builtinExtensions, extensionDocument, extensionEvent } from "../plugin/shared/extensions";
import { extensionSchema, packSchema } from "../plugin/shared/model";
import { setup, workspaceId } from "./helpers";

const view = (id: string, html = "<p>vista</p>", permissions: string[] = []) => ({ id, kind: "view", api: 1, name: "Vista de prueba", description: "Dato de ejemplo.", html, permissions });
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
test("a local extension cannot take a shipped ID, a pack namespace or a repeated permission", async t => {
  const { service } = await setup(t);
  await assert.rejects(service.catalogMutate({ expectedRevision: 0, action: { type: "extension.put", extension: extensionSchema.parse(view("ejemplos.mosaico")) } }), /cannot replace|namespace/);
  await assert.rejects(service.catalogMutate({ expectedRevision: 0, action: { type: "extension.put", extension: extensionSchema.parse(view("ejemplos.nueva")) } }), /namespace/);
  await assert.rejects(service.catalogMutate({ expectedRevision: 0, action: { type: "extension.put", extension: extensionSchema.parse(view("doble", "<p/>", ["edit", "edit"])) } }), /repeats/);
  await assert.rejects(service.catalogMutate({ expectedRevision: 0, action: { type: "extension.remove", id: "ejemplos.mosaico" } }), /not found/i);
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
  await assert.rejects(service.catalogMutate({ expectedRevision: catalog.revision, action: { type: "extension.grant", id: "ejemplos.mosaico", granted: false } }), /imported pack/);
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
  assert.deepEqual((await service.exportPack({ id: "ajeno" })).extensions.map(e => e.id), ["ajeno.a"]);
});
test("state and packs written before extensions existed still load", () => {
  const storage = catalogStorageSchema.parse({ revision: 3, localTypes: [], localTemplates: [], packs: [{ format: "paseo-canvas-pack", version: 1, id: "viejo", name: "Viejo", description: "", blockTypes: [], templates: [], documents: [] }] });
  assert.deepEqual([storage.localExtensions, storage.grants, storage.packs[0].extensions], [[], [], []]);
  assert.deepEqual(catalogView(storage).extensions.map(e => [e.id, e.source, e.granted]), builtinExtensions.map(e => [e.id, "builtin", true]));
  assert.deepEqual(packSchema.parse(pack([])).extensions, []);
});
test("the assistant saves and removes an extension through MCP and is told the whole API", async t => {
  const { service } = await setup(t), router = new ToolRouter(service, async () => ({ agentId: "a", workspaceId }));
  const listed = await router.call("canvas_catalog", { action: "list" }, "owner") as { revision: number; extensions: { id: string; kind: string; source: string }[]; extensionGuide: string };
  assert.ok(listed.extensions.some(e => e.id === "ejemplos.mosaico" && e.kind === "view") && listed.extensions.some(e => e.id === "ejemplos.reemplazar" && e.kind === "tool"));
  for (const word of ["lienzo.onContext", "lienzo.select", "lienzo.edit", "lienzo.ask", "lienzo.kit.stage", "save_extension", "api: 1"]) assert.ok(listed.extensionGuide.includes(word), word);
  assert.equal(listed.extensionGuide, EXTENSION_GUIDE);
  assert.deepEqual(await router.call("canvas_catalog", { action: "save_extension", expectedRevision: listed.revision, extension: { ...view("del-asistente"), kind: "tool", permissions: ["edit"] } }, "owner"), { revision: listed.revision + 1, committed: true });
  const read = await router.call("canvas_catalog", { action: "read", id: "del-asistente" }, "owner") as { entry: { html: string; source: string; granted: boolean }; guidance: string };
  assert.deepEqual([read.entry.html, read.entry.source, read.entry.granted, read.guidance], ["<p>vista</p>", "local", true, EXTENSION_GUIDE]);
  await assert.rejects(router.call("canvas_catalog", { action: "save_extension", expectedRevision: 0, extension: view("tarde") }, "owner"), /Catalog changed|REVISION/);
  assert.deepEqual(await router.call("canvas_catalog", { action: "remove_extension", expectedRevision: listed.revision + 1, id: "del-asistente" }, "owner"), { revision: listed.revision + 2, committed: true });
});
test("a frame gets the runtime first and no network unless it was asked for and granted", () => {
  const offline = extensionDocument({ html: "<!DOCTYPE html><p>hola</p>", permissions: [] }, true), asked = extensionDocument({ html: "<p>hola</p>", permissions: ["network"] }, true), pending = extensionDocument({ html: "<p>hola</p>", permissions: ["network"] }, false);
  assert.ok(offline.startsWith("<!doctype html>") && offline.includes("Content-Security-Policy") && offline.includes("default-src 'none'") && offline.endsWith("</script><body><p>hola</p>") && !/<!DOCTYPE html><p>/.test(offline));
  assert.ok(!asked.includes("Content-Security-Policy") && pending.includes("Content-Security-Policy"));
  for (const page of [offline, asked, pending]) assert.ok(page.indexOf("window.lienzo=") > 0 && page.indexOf("window.lienzo=") < page.indexOf("<p>hola</p>"));
  for (const e of builtinExtensions) assert.ok(!/https?:\/\//.test(e.html), `${e.id} loads nothing from outside`);
});
test("API 1 inside the frame: context, calls that resolve or reject, and nothing from another window", async () => {
  const sent: { type: string; id?: number; method?: string; args?: Record<string, unknown> }[] = [], listeners: ((e: { source: unknown; data: unknown }) => void)[] = [];
  const parent = { postMessage: (m: never) => { sent.push(m); } }, window = { parent, addEventListener: (type: string, f: never) => { if (type === "message") listeners.push(f); } } as Record<string, unknown>;
  vm.runInNewContext(EXTENSION_RUNTIME, { window, parent, console, Promise });
  const lienzo = window.lienzo as { api: number; context: unknown; onContext(f: (c: unknown) => void): () => void; select(ids: string[]): Promise<unknown>; edit(ops: unknown[], label?: string): Promise<unknown>; ask(kind: string, payload: unknown): Promise<unknown>; open(id: string): Promise<unknown>; close(): Promise<unknown>; kit: { stage: unknown; card: unknown } };
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
  for (const [name, call] of [["ask", () => lienzo.ask("hecho", { n: 1 })], ["open", () => lienzo.open("a")], ["close", () => lienzo.close()]] as const) { void call().catch(() => {}); assert.equal(sent.at(-1)!.method, name); }
});
test("what an extension may ask the assistant is a short name and bounded JSON", () => {
  assert.deepEqual(extensionEvent("hecho", { n: 1 }), { kind: "hecho", payload: { n: 1 } }); assert.deepEqual(extensionEvent("vacio", undefined), { kind: "vacio", payload: null });
  for (const bad of [["", {}], ["con espacio", {}], [3, {}], ["grande", "x".repeat(9000)]] as const) assert.equal(extensionEvent(bad[0], bad[1]), null);
  const loop: Record<string, unknown> = {}; loop.self = loop; assert.equal(extensionEvent("ciclo", loop), null);
});
