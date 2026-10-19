import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { EXTENSION_GUIDE, EXTENSION_LIMITS, EXTENSION_RUNTIME, extensionKeyName, extensionView, isExtensionKey, routeExtensionKey } from "../plugin/shared/extensions";
import { extensionSchema, packSchema } from "../plugin/shared/model";
import { CanvasStore } from "../plugin/server/store";
import { CanvasService } from "../plugin/server/service";
import { setup, workspaceId, content } from "./helpers";

// Example data only: a made-up presentation tool used to exercise the API.
const tool = (id: string, permissions: string[] = []) => ({ id, kind: "tool", api: 1, name: "Presentation (test)", description: "Example data.", html: "<p>slides</p>", permissions });
const pack = (extensions: unknown[]) => ({ format: "paseo-canvas-pack", version: 1, id: "ajeno", name: "Example file", description: "Example data.", blockTypes: [], templates: [], documents: [], extensions });

test("the view permission is declared, validated, imported ungranted and granted like the others", async t => {
  assert.deepEqual(extensionSchema.parse(tool("p", ["edit", "network", "view"])).permissions, ["edit", "network", "view"]);
  assert.throws(() => extensionSchema.parse(tool("p", ["camera"])));
  assert.deepEqual(extensionSchema.parse(tool("p", ["edit", "network", "view", "variables"])).permissions, ["edit", "network", "view", "variables"]);
  assert.throws(() => extensionSchema.parse(tool("p", ["view", "edit", "network", "variables", "view"])), "five entries are more than there are permissions");
  const { service } = await setup(t);
  await assert.rejects(service.catalogMutate({ expectedRevision: 0, action: { type: "extension.put", extension: extensionSchema.parse(tool("doble", ["view", "view"])) } }), /repeats/);
  const imported = await service.importPack({ expectedRevision: 0, pack: pack([tool("ajeno.slides", ["view"])]), replace: false, dryRun: false });
  assert.deepEqual(imported.catalog.extensions.filter(e => e.id === "ajeno.slides").map(e => [e.permissions, e.granted]), [[["view"], false]]);
  const granted = await service.catalogMutate({ expectedRevision: imported.catalog.revision, action: { type: "extension.grant", id: "ajeno.slides", granted: true } });
  assert.equal(granted.extensions.find(e => e.id === "ajeno.slides")!.granted, true);
  assert.deepEqual(packSchema.parse(pack([tool("ajeno.x", ["view"])])).extensions[0].permissions, ["view"]);
  const schema = JSON.parse(await readFile(join(import.meta.dirname, "../marketplace/schema/extension-file.schema.json"), "utf8"));
  assert.match(JSON.stringify(schema), /"enum":\["edit","network","view","variables"\]/, "the catalog's file schema knows view and variables");
});

test("lienzo.storage: per extension and per document, capped, persisted, with no revision or history", async t => {
  const { service, store, directory } = await setup(t);
  await service.create({ workspaceId, id: "e", content: content() });
  const catalog = await service.catalogMutate({ expectedRevision: 0, action: { type: "extension.put", extension: extensionSchema.parse(tool("slides")) } });
  await service.catalogMutate({ expectedRevision: catalog.revision, action: { type: "extension.put", extension: extensionSchema.parse(tool("other")) } });
  const call = (input: Record<string, unknown>, s = service) => s.extensionStorage({ workspaceId, documentId: "d", extensionId: "slides", action: "get", ...input } as never);
  const before = await service.read({ workspaceId, documentId: "d" }), history = await service.history({ workspaceId, documentId: "d" });
  assert.deepEqual(await call({}), { value: null });
  assert.deepEqual(await call({ action: "set", value: { slide: 3, seen: ["a", "b"] } }), { value: { slide: 3, seen: ["a", "b"] } });
  assert.deepEqual(await call({}), { value: { slide: 3, seen: ["a", "b"] } });
  assert.deepEqual(await call({ extensionId: "other" }), { value: null }, "each extension has its own");
  assert.deepEqual(await call({ documentId: "e" }), { value: null }, "each document has its own");
  assert.deepEqual(await call({ action: "set", value: 7, documentId: "e" }), { value: 7 }, "any JSON value");
  await assert.rejects(call({ action: "set", value: { text: "x".repeat(EXTENSION_LIMITS.storage) } }), /4 KiB/);
  await assert.rejects(call({ extensionId: "missing" }), /No extension missing/);
  await assert.rejects(call({ action: "set", value: JSON.parse('{"__proto__":{"x":1}}') }), /Unsafe|Reserved/);
  await assert.rejects(call({ workspaceId: "other-workspace" }), /workspace|not found/i);
  assert.deepEqual(await call({}), { value: { slide: 3, seen: ["a", "b"] } }, "a refused write changes nothing");
  const after = await service.read({ workspaceId, documentId: "d" });
  assert.equal(after.document.revision, before.document.revision); assert.equal(after.runtimeVersion, before.runtimeVersion);
  assert.deepEqual((await service.history({ workspaceId, documentId: "d" })).transactions, history.transactions);
  assert.ok(!JSON.stringify(after).includes("seen"), "the document view never carries it");
  // Survives a restart, and null clears it.
  await store.close();
  const reopened = new CanvasStore(directory), again = new CanvasService(reopened);
  assert.deepEqual(await call({}, again), { value: { slide: 3, seen: ["a", "b"] } });
  assert.deepEqual(await call({ action: "set", value: null }, again), { value: null });
  assert.deepEqual(await call({}, again), { value: null });
  await reopened.close();
});

test("the guide tells agents about the view, keys, highlight, storage, fullscreen and where layout is", () => {
  for (const words of ["lienzo.view.get()", "lienzo.view.fit(ids", "lienzo.view.onChange(fn)", "context.view", 'Permission "view"', "sheetId", "visibleIds", "lienzo.keys.bind(keys", "lienzo.highlight(ids", "lienzo.highlight.clear()", "lienzo.storage.get()", "4 KiB", "fullscreen",
    "absolute world coordinates", "Frames and Sheets", "collapsed group", "it moves the camera there too only with permission \"view\"", "feature-detect", "never create revisions"]) assert.ok(EXTENSION_GUIDE.includes(words), words);
});

test("visible ids, bounds and the Sheet under the centre come from the camera and the canvas' rectangles", () => {
  const rects = new Map([
    ["sheet-1", { x: 0, y: 0, width: 1000, height: 600 }], ["sheet-2", { x: 1200, y: 0, width: 1000, height: 600 }],
    ["a", { x: 100, y: 100, width: 200, height: 80 }], ["b", { x: 1300, y: 100, width: 200, height: 80 }], ["folded", { x: 120, y: 120, width: 10, height: 10, hidden: true }],
  ]);
  const ids = ["sheet-1", "sheet-2", "a", "b", "folded"], sheets = ["sheet-1", "sheet-2"];
  const first = extensionView({ scale: 1.23456, bounds: { x: -50, y: -50, width: 1100, height: 700 } }, rects, ids, sheets);
  assert.deepEqual(first, { scale: 1.235, bounds: { x: -50, y: -50, width: 1100, height: 700 }, sheetId: "sheet-1", visibleIds: ["sheet-1", "a"] });
  assert.deepEqual(extensionView({ scale: .5, bounds: { x: 900, y: 0, width: 600, height: 400 } }, rects, ids, sheets), { scale: .5, bounds: { x: 900, y: 0, width: 600, height: 400 }, sheetId: "sheet-2", visibleIds: ["sheet-1", "sheet-2", "b"] });
  assert.equal(extensionView({ scale: 1, bounds: { x: 1000, y: 700, width: 180, height: 400 } }, rects, ids, sheets).sheetId, null, "between Sheets is no Sheet");
});

test("keys: names, the allowlist, and routing only what a tool bound while nobody types", () => {
  const key = (key: string, more: Record<string, unknown> = {}) => ({ key, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, ...more });
  assert.deepEqual([key("ArrowRight"), key(" "), key("N", { shiftKey: true }), key("!", { code: "Digit1", shiftKey: true }), key("5"), key("PageDown"), key("Escape")].map(extensionKeyName), ["ArrowRight", "Space", "Shift+n", "Shift+1", "5", "PageDown", "Escape"]);
  assert.deepEqual([key("k", { metaKey: true }), key("k", { ctrlKey: true }), key("ArrowLeft", { altKey: true }), key("Tab"), key("F5"), key("/")].map(extensionKeyName), [null, null, null, null, null, null], "modifiers and other keys stay Lienzo's");
  for (const name of ["ArrowLeft", "Shift+ArrowRight", "Space", "Home", "End", "Enter", "Escape", "a", "Shift+z", "9"]) assert.ok(isExtensionKey(name), name);
  for (const name of ["A", "Tab", "Mod+K", "Ctrl+a", "Shift+Shift+a", "Backspace", "F1", ""]) assert.ok(!isExtensionKey(name), name);
  const bound = new Set(["ArrowRight", "Space"]);
  assert.equal(routeExtensionKey(key("ArrowRight"), bound, false), "ArrowRight");
  assert.equal(routeExtensionKey(key("ArrowRight"), bound, true), null, "typing in a field keeps the key");
  assert.equal(routeExtensionKey(key("ArrowLeft"), bound, false), null, "unbound keys go to the canvas");
  assert.equal(routeExtensionKey(key("Escape"), bound, false), null, "Escape closes and deselects unless bound");
  assert.equal(routeExtensionKey(key(" ", { metaKey: true }), bound, false), null);
});

test("API 1 additions in the frame: view, keys, highlight and storage speak the same channel", async () => {
  type Sent = { type: string; id?: number; method?: string; args?: Record<string, unknown> };
  const sent: Sent[] = [], listeners: Record<string, ((e: unknown) => void)[]> = {};
  const parent = { postMessage: (m: never) => { sent.push(m); } }, window = { parent, addEventListener: (type: string, f: never) => { (listeners[type] ??= []).push(f); } } as Record<string, unknown>;
  vm.runInNewContext(EXTENSION_RUNTIME, { window, parent, console, Promise });
  const lienzo = window.lienzo as any, plain = (value: unknown) => JSON.parse(JSON.stringify(value));
  const deliver = (data: unknown) => listeners.message.forEach(f => f({ source: parent, data: { lienzo: 1, ...(data as object) } }));
  const last = () => plain(sent.at(-1));
  assert.deepEqual([typeof lienzo.view.get, typeof lienzo.view.fit, typeof lienzo.view.onChange, typeof lienzo.keys.bind, typeof lienzo.highlight, typeof lienzo.highlight.clear, typeof lienzo.storage.get, typeof lienzo.storage.set], Array(8).fill("function"));
  void lienzo.view.fit("a", { padding: 40, animate: false }); assert.deepEqual([last().method, last().args], ["view.fit", { ids: ["a"], padding: 40, animate: false }]);
  void lienzo.view.get(); assert.equal(last().method, "view.get");
  void lienzo.highlight(["a", "b"], { dim: true, tone: "warning" }); assert.deepEqual([last().method, last().args], ["highlight", { ids: ["a", "b"], dim: true, tone: "warning" }]);
  void lienzo.highlight.clear(); assert.deepEqual(last().args, { ids: [] });
  void lienzo.storage.set({ slide: 2 }); assert.deepEqual([last().method, last().args], ["storage.set", { value: { slide: 2 } }]);
  void lienzo.storage.set(undefined); assert.deepEqual(last().args, { value: null });
  void lienzo.storage.get(); assert.equal(last().method, "storage.get");
  // The view arrives as its own message: context.view and onChange follow it, onContext does not fire for it.
  const views: unknown[] = [], contexts: unknown[] = [];
  lienzo.view.onChange((v: unknown) => views.push(plain(v))); lienzo.onContext((c: unknown) => contexts.push(plain(c)));
  const view = { scale: 1, bounds: { x: 0, y: 0, width: 10, height: 10 }, sheetId: null, visibleIds: ["a"] };
  deliver({ type: "view", view }); deliver({ type: "context", context: { api: 1 } });
  assert.deepEqual(views, [view]); assert.deepEqual(contexts, [{ api: 1, view }]);
  deliver({ type: "view", view: { ...view, scale: 2 } }); assert.equal(lienzo.context.view.scale, 2); assert.equal(contexts.length, 1);
  // Keys: validated, normalised, told to the host, and run from the host or from a press inside the page.
  assert.throws(() => lienzo.keys.bind(["Tab"], () => {}), /not a key a tool can take/); assert.throws(() => lienzo.keys.bind(["x"]), /needs a function/);
  const pressed: string[] = [], unbind = lienzo.keys.bind(["ArrowRight", "shift+N", "space"], (k: string) => pressed.push(k));
  assert.deepEqual([last().method, last().args], ["keys", { keys: ["ArrowRight", "Shift+n", "Space"] }]);
  deliver({ type: "key", key: "ArrowRight" }); deliver({ type: "key", key: "ArrowLeft" });
  let prevented = 0; const press = (key: string, target: unknown = { tagName: "DIV" }, more = {}) => listeners.keydown.forEach(f => f({ key, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, target, preventDefault: () => { prevented++; }, ...more }));
  press(" "); press("N", { tagName: "DIV" }, { shiftKey: true }); press(" ", { tagName: "INPUT" }); press(" ", { isContentEditable: true }); press("ArrowRight", { tagName: "DIV" }, { metaKey: true });
  assert.deepEqual(pressed, ["ArrowRight", "Space", "Shift+n"]); assert.equal(prevented, 2);
  unbind(); unbind(); assert.deepEqual(last().args, { keys: [] }); deliver({ type: "key", key: "ArrowRight" }); assert.equal(pressed.length, 3);
});

test("the extension frame allows fullscreen and nothing else changes in its sandbox", async () => {
  const web = await readFile(join(import.meta.dirname, "../plugin/client/web.ts"), "utf8"), frame = web.slice(web.indexOf("export function WebExtension"), web.indexOf("export function listenExtensionKeys"));
  assert.match(frame, /sandbox: 'allow-scripts allow-forms allow-modals allow-pointer-lock', referrerPolicy: 'no-referrer', allow: 'fullscreen'/);
});
