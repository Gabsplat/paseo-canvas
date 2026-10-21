import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { documentContentSchema, documentSchema, extensionSchema, type CanvasDocument } from "../plugin/shared/model";
import { ContextChannel, ViewPump, cameraState, contextDocument, contextEntities, toScreen, toWorld, VIEW_SETTLE_MS } from "../plugin/shared/extension-context";
import { EXTENSION_GUIDE, EXTENSION_RUNTIME } from "../plugin/shared/extensions";
import { builtinTypes } from "../plugin/shared/builtins";
import { SafeAreaRegistry, freeRect, safeAreaOf } from "../plugin/client/safe-area";
import { fitCameraIn } from "../plugin/client/logic";
import { RESULT_LIMITS, ToolRouter } from "../plugin/server/tools";
import { clone, validateDocument } from "../plugin/server/reducer";
import { documentRecord } from "../plugin/server/store";
import { CanvasError } from "../plugin/shared/errors";
import { setup, workspaceId } from "./helpers";

// Example data: a generated Lienzo of 600 cards with ~400-character summaries (about 330 KB), like the one extension
// authors measured.
const cards = (n = 600) => Array.from({ length: n }, (_, i) => ({ id: `c${i}`, typeId: "node", title: `Card ${i + 1} (example)`, data: { summary: `Example summary ${i} `.repeat(20).slice(0, 400) }, position: { x: (i % 30) * 280, y: Math.floor(i / 30) * 200 }, size: { width: 240, height: 150 } }));
const bigContent = () => documentContentSchema.parse({ title: "600 cards (example data)", example: true, layout: { mode: "free" }, blocks: cards(), groups: [], communication: { instructions: "" } });
const bigDocument = (): CanvasDocument => documentSchema.parse({ ...bigContent(), id: "big", workspaceId, revision: 3, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", selectedIds: [] });
const catalog = { blockTypes: builtinTypes };
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const size = (value: unknown) => Buffer.byteLength(JSON.stringify(value));

test("select on a 600-card Lienzo: memory first, no document in the answer, many times cheaper than the old transaction", async t => {
  const { service, store } = await setup(t);
  let view = await service.create({ workspaceId, id: "big", content: bigContent() });
  for (let i = 0; i < 12; i++) view = await service.mutate({ workspaceId, documentId: "big", expectedRevision: view.document.revision, label: "Edit (example)", operations: [{ type: "block.update", id: `c${i}`, patch: { title: `Edited ${i}` } }] });
  // Before: what canvas.selection.set did, a whole-state transaction (copy, schema, fsync) answering with the full view.
  const before: number[] = [];
  for (let i = 0; i < 5; i++) {
    const start = performance.now();
    const answer = await store.transaction(state => { const record = documentRecord(state, "big", workspaceId), next = clone(record.document); next.selectedIds = [`c${i}`]; validateDocument(next); record.document.selectedIds = next.selectedIds; record.selectionVersion++; return { document: clone(record.document) }; });
    before.push(performance.now() - start); assert.ok(size(answer) > 300_000);
  }
  let version = (await service.read({ workspaceId, documentId: "big" })).selectionVersion;
  const after: number[] = [];
  for (let i = 0; i < 20; i++) {
    const start = performance.now(), answer = await service.selection({ workspaceId, documentId: "big", expectedSelectionVersion: version, ids: [`c${i}`] });
    after.push(performance.now() - start); version = answer.selectionVersion;
    assert.ok(size(answer) < 200, "versions and ids only");
  }
  t.diagnostic(`server selection, 600 cards: before ${median(before).toFixed(1)} ms, after ${median(after).toFixed(2)} ms (median)`);
  assert.ok(median(after) < 30 && median(after) * 5 < median(before), `${median(after)} vs ${median(before)}`);
  // It is kept: another window hears it (ids only), and it is on disk after the deferred write.
  assert.deepEqual((await service.watch({ workspaceId, documentId: "big", knownRevision: view.document.revision, knownRuntimeVersion: view.runtimeVersion, knownSelectionVersion: 0 })).selection, { selectionVersion: version, selectedIds: ["c19"] });
  await store.flushRuntime();
  assert.deepEqual(JSON.parse(readFileSync(join(store.directory, "state.json"), "utf8")).documents.big.document.selectedIds, ["c19"]);
  await assert.rejects(service.selection({ workspaceId, documentId: "big", expectedSelectionVersion: version, ids: ["nope"] }), /unique existing/);
  await assert.rejects(service.selection({ workspaceId, documentId: "big", expectedSelectionVersion: 0, ids: [] }), /Selection changed/);
});

test("lienzo.select answers from the panel at once: the page is patched first, the canvas and the server follow", () => {
  const source = readFileSync(join(import.meta.dirname, "../plugin/client/Extensions.tsx"), "utf8"), select = source.slice(source.indexOf("if (method === 'select')"), source.indexOf("if (method === 'read')"));
  assert.ok(!/await/.test(select), "nothing awaited before the answer");
  assert.ok(select.indexOf("contexts.current!.push") < select.indexOf("c.select("), "the page hears the new selection before its call resolves");
  const canvas = readFileSync(join(import.meta.dirname, "../plugin/client/useCanvas.ts"), "utf8");
  assert.match(canvas, /desired\.current = \[\.\.\.new Set\(ids\)\]; setSelection\(desired\.current\);/, "the selection is local first");
  assert.match(canvas, /adoptSelection\(next\)/, "the server's answer is versions and ids, adopted without a new document");
});

test("view.onChange is one camera message per animation frame while moving, only to a listening page, and one exact view on settle", () => {
  let now = 0, queued: (() => void) | null = null, frames = 0;
  const sent: Record<string, unknown>[] = [], camera = { scale: 2, bounds: { x: 10, y: 20, width: 400, height: 300 } };
  const pump = new ViewPump({ frame: run => { queued = run; return ++frames; }, cancel: () => { queued = null; }, now: () => now, camera: () => camera, view: () => ({ scale: 2, bounds: camera.bounds, sheetId: null, visibleIds: ["a"], screen: { width: 800, height: 600 }, rects: { a: { x: 0, y: 0, width: 10, height: 10 } } }), send: m => sent.push(m) });
  const frame = (ms = 16) => { now += ms; const run = queued; queued = null; run?.(); };
  // Not listening: no per-frame messages, only the settled view (which keeps context.view current).
  pump.moved(); pump.moved(); frame(); frame(); assert.equal(sent.length, 0);
  for (let i = 0; i < 10; i++) frame(); assert.deepEqual(sent.map(m => m.type), ["view"]);
  // Listening: ten moves in one frame are one message; each frame with a move sends one; stillness sends the exact view once.
  sent.length = 0; pump.watching = true;
  for (let f = 0; f < 30; f++) { for (let i = 0; i < 10; i++) pump.moved(); frame(); }
  assert.equal(sent.length, 30); assert.ok(sent.every(m => m.type === "camera"));
  const last = sent.at(-1)!.camera as ReturnType<typeof cameraState>;
  assert.deepEqual([last.scale, last.offset, last.version], [2, { x: -20, y: -40 }, 300 + 2]);
  assert.ok(size(sent.at(-1)) < 220, `a camera message is small: ${size(sent.at(-1))} bytes`);
  while (queued) frame();
  assert.equal(sent.filter(m => m.type === "view").length, 1);
  const settled = sent.at(-1)!.view as { moving: boolean; version: number; offset: unknown; rects: unknown };
  assert.deepEqual([settled.moving, settled.version, settled.offset], [false, 302, { x: -20, y: -40 }]); assert.ok(settled.rects);
  assert.ok(VIEW_SETTLE_MS <= 200);
});

test("toScreen and toWorld: screen = (world - bounds) * scale, the same in the runtime, inverses of each other", () => {
  const camera = { scale: 1.5, bounds: { x: -100, y: 40, width: 800, height: 600 } }, rect = { x: 20, y: 100, width: 240, height: 150 };
  assert.deepEqual(toScreen(rect, camera), { x: 180, y: 90, width: 360, height: 225 });
  assert.deepEqual(toWorld(toScreen(rect, camera), camera), rect);
  assert.deepEqual(toScreen({ x: -100, y: 40 }, camera), { x: 0, y: 0 });
  // In the frame: a camera message moves toScreen and a moving view at once; its rects come from context.layout, lazily.
  const { lienzo, deliver } = frameRuntime();
  deliver({ type: "context", context: { api: 1, layout: { a: rect, far: { x: 5000, y: 5000, width: 10, height: 10 } }, selection: [] } });
  const views: { moving: boolean; visibleIds: string[]; rects: Record<string, unknown> }[] = [];
  lienzo.view.onChange((v: never) => views.push(v));
  deliver({ type: "camera", camera: { ...cameraState(camera, 7) } });
  assert.deepEqual(plain(lienzo.view.toScreen(rect)), { x: 180, y: 90, width: 360, height: 225 });
  assert.deepEqual(plain(lienzo.view.toWorld({ x: 180, y: 90 })), { x: 20, y: 100 });
  assert.equal(lienzo.view.camera.version, 7);
  assert.deepEqual([views[0].moving, plain(views[0].visibleIds), plain(views[0].rects)], [true, ["a"], { a: { x: 180, y: 90, width: 360, height: 225 } }]);
});

test("context diffs: the whole context once, then only what changed; a selection is bytes, not the 600-card document", () => {
  const doc = bigDocument(), sent: Record<string, unknown>[] = [], channel = new ContextChannel(m => sent.push(m));
  let selection: string[] = [], built = 0;
  const parts = () => ({
    api: [1, () => 1] as const, theme: ['{"dark":true}', () => ({ dark: true })] as const,
    document: [`${doc.id}:${doc.revision}:full`, () => { built++; return contextDocument(doc, catalog, "full"); }] as const,
    layout: [`${doc.id}:${doc.revision}`, () => Object.fromEntries(doc.blocks.map(b => [b.id, { x: b.position!.x, y: b.position!.y, width: 240, height: 150 }]))] as const,
    selection: [selection.join("\n"), () => [...selection]] as const,
  });
  channel.push(parts()); const full = size(sent[0]);
  assert.equal(channel.push(parts()), null, "nothing changed, nothing sent");
  selection = ["c7"]; channel.push(parts());
  assert.deepEqual(sent[1], { type: "patch", patch: { selection: ["c7"] } }); assert.equal(built, 1, "the document is built once");
  t_diag(`context for 600 cards: ${full} bytes whole, ${size(sent[1])} bytes for a selection change`);
  assert.ok(full > 300_000 && size(sent[1]) < 100, `${full} / ${size(sent[1])}`);
  channel.reset(); channel.push(parts()); assert.equal(sent[2].type, "context", "a reloaded page gets the whole context again");
  // The runtime patches its copy: onContext gets the whole object, the document is the same object, onSelection only for selections.
  const { lienzo, deliver } = frameRuntime(), contexts: { document: unknown; selection: string[] }[] = [], selections: string[][] = [];
  lienzo.onContext((c: never) => contexts.push(c)); lienzo.onSelection((ids: string[]) => selections.push(plain(ids)));
  deliver(sent[2]); deliver({ type: "patch", patch: { selection: ["c1", "c2"] } }); deliver({ type: "patch", patch: { theme: { dark: false } } });
  assert.equal(contexts.length, 3); assert.equal(contexts[2].document, contexts[0].document); assert.deepEqual(plain(contexts[2].selection), ["c1", "c2"]);
  assert.deepEqual(selections, [["c7"], ["c1", "c2"]], "the first context, then the patch; the theme patch is not a selection"); assert.equal(lienzo.context.theme.dark, false);
  const later: string[][] = []; lienzo.onSelection((ids: string[]) => later.push(plain(ids))); assert.deepEqual(later, [["c1", "c2"]], "a new listener hears the selection now");
});

test("context modes: outline drops block data, none keeps only the head, lienzo.read brings whole entities", () => {
  const doc = bigDocument(), full = contextDocument(doc, catalog, "full"), outline = contextDocument(doc, catalog, "outline"), none = contextDocument(doc, catalog, "none");
  t_diag(`document part: full ${size(full)} B, outline ${size(outline)} B, none ${size(none)} B`);
  assert.ok(size(outline) * 4 < size(full) && size(none) < 200);
  assert.deepEqual(Object.keys((outline as { blocks: object[] }).blocks[0]), ["id", "title", "typeId", "renderer", "parentGroupId"]);
  assert.deepEqual([(outline as { mode: string }).mode, "blocks" in none], ["outline", false]);
  const read = contextEntities(doc, catalog, ["c3", "missing"]);
  assert.deepEqual([read.blocks.length, read.blocks[0].data.summary, read.revision], [1, doc.blocks[3].data.summary, 3]);
  assert.equal(extensionSchema.parse({ id: "x", kind: "tool", api: 1, name: "X", html: "<p>x</p>", context: { document: "outline" } }).context?.document, "outline");
  assert.throws(() => extensionSchema.parse({ id: "x", kind: "tool", api: 1, name: "X", html: "<p>x</p>", context: { document: "most" } }));
  const { lienzo, sent } = frameRuntime();
  void lienzo.setContext({ document: "none" }); void lienzo.read(["c1"]);
  assert.deepEqual(plain(sent.slice(-2).map(m => [m.method, m.args])), [["context.set", { document: "none" }], ["read", { ids: ["c1"] }]]);
});

test("safe area: islands report boxes, insets go to the edge each hugs, the free rect avoids them all, an extension's own frame is not in its way", () => {
  const canvas = { width: 1440, height: 900 };
  const area = safeAreaOf(canvas, [{ kind: "document", x: 12, y: 12, width: 360, height: 44 }, { kind: "actions", x: 1306, y: 12, width: 122, height: 44 }, { kind: "toolbar", x: 470, y: 756, width: 500, height: 44 }, { kind: "zoom", x: 1270, y: 760, width: 158, height: 40 }, { kind: "panel", x: 1100, y: 68, width: 328, height: 600 }]);
  assert.deepEqual([area.top, area.right, area.bottom, area.left], [56, 340, 144, 0]);
  assert.deepEqual(area.freeRect, { x: 0, y: 56, width: 1100, height: 700 }, "under the top islands, over the toolbar, left of the panel");
  assert.deepEqual(freeRect({ width: 100, height: 100 }, []), { x: 0, y: 0, width: 100, height: 100 });
  const registry = new SafeAreaRegistry(); let heard = 0; registry.subscribe(() => heard++);
  registry.setCanvas({ x: 100, y: 50, ...canvas });
  registry.set("doc", { kind: "document", rect: { x: 112, y: 62, width: 360, height: 44 } });
  registry.set("mine", { kind: "panel", rect: { x: 1200, y: 118, width: 328, height: 600 }, owner: "ext.a" });
  registry.set("pill", { kind: "pill", rect: { x: 700, y: 62, width: 160, height: 32 }, owner: "ext.a" });
  assert.deepEqual(registry.area("ext.a").rects.map(r => r.kind), ["document", "pill"], "its pill counts, its own panel does not");
  assert.deepEqual(registry.area("ext.b").rects.map(r => r.kind), ["document", "panel", "pill"]);
  assert.deepEqual(registry.area().rects[0], { kind: "document", x: 12, y: 12, width: 360, height: 44 }, "relative to the canvas");
  assert.equal(registry.area("ext.b"), registry.area("ext.b"), "cached until something changes");
  // Hide all UI: the islands unmount and report nothing, so the area is empty and the free rect is the canvas.
  for (const key of ["doc", "mine", "pill"]) registry.set(key, null);
  assert.deepEqual(registry.area("ext.a"), { top: 0, right: 0, bottom: 0, left: 0, rects: [], freeRect: { x: 0, y: 0, width: 1440, height: 900 } });
  assert.ok(heard >= 6);
});

test("every fit frames inside the free zone: Fit all, Fit selection, the agent's fly and lienzo.view.fit use one zone", () => {
  const viewport = { width: 1440, height: 900 }, zone = { x: 0, y: 68, width: 1100, height: 688 }, box = { x: 0, y: 0, width: 1000, height: 500 };
  const camera = fitCameraIn(viewport, zone, box, 1);
  const left = camera.offset.x, top = camera.offset.y, right = left + box.width * camera.scale, bottom = top + box.height * camera.scale;
  assert.ok(left >= zone.x && right <= zone.x + zone.width && top >= zone.y && bottom <= zone.y + zone.height, JSON.stringify(camera));
  assert.ok(Math.abs((left + right) / 2 - (zone.x + zone.width / 2)) < 1, "centred in the zone");
  const tiny = fitCameraIn(viewport, { x: 0, y: 0, width: 100, height: 50 }, box, 1);
  assert.ok(tiny.offset.x + box.width * tiny.scale / 2 > 600, "a zone too small to frame anything falls back to the viewport");
  const canvas = readFileSync(join(import.meta.dirname, "../plugin/client/Canvas.tsx"), "utf8"), panel = readFileSync(join(import.meta.dirname, "../plugin/client/Panel.tsx"), "utf8");
  assert.equal((canvas.match(/fitCameraIn\(size, zoneRef\.current\?\.\(\)/g) ?? []).length, 2, "fit (Fit all, selection, fly) and frameIds (lienzo.view.fit)");
  assert.match(panel, /freeZone=\{\(\) => safeArea\.free\(\)\}/); assert.ok(!/obscuredRight/.test(panel + canvas), "no second, hand-computed zone");
});

test("lienzo.ui: safeArea and freeRect follow ui state; immersive asks the panel and reports in ui.state", async () => {
  const { lienzo, deliver, sent } = frameRuntime(), seen: unknown[] = [];
  assert.equal(lienzo.ui.safeArea, null);
  lienzo.ui.onChange((ui: unknown) => seen.push(plain(ui)));
  const safeArea = { top: 56, right: 0, bottom: 0, left: 0, rects: [{ kind: "document", x: 12, y: 12, width: 360, height: 44 }], freeRect: { x: 0, y: 56, width: 800, height: 544 } };
  deliver({ type: "ui", ui: { mode: "overlay", immersive: false, safeArea } });
  assert.deepEqual([plain(lienzo.ui.safeArea), plain(lienzo.ui.freeRect)], [safeArea, safeArea.freeRect]);
  void lienzo.ui.immersive(true); assert.deepEqual(plain([sent.at(-1)!.method, sent.at(-1)!.args]), ["ui.immersive", { on: true }]);
  void lienzo.ui.immersive(false); assert.deepEqual(plain(sent.at(-1)!.args), { on: false });
  deliver({ type: "ui", ui: { mode: "overlay", immersive: true, safeArea: { ...safeArea, top: 0, rects: [], freeRect: { x: 0, y: 0, width: 800, height: 600 } } } });
  assert.deepEqual([lienzo.ui.state.immersive, lienzo.ui.safeArea.rects.length, seen.length], [true, 0, 2]);
  // The panel: Esc and ⌘. leave it (they go through setImmersive, which ends the owner's mode), closing the tool restores
  // what was before, and the restore button stays off while an extension presents.
  const panel = readFileSync(join(import.meta.dirname, "../plugin/client/Panel.tsx"), "utf8");
  assert.match(panel, /if \(immersiveOwner\) \{ setImmersive\(false\); return true; \}/);
  assert.match(panel, /leaveOwner\(\); r\.on = r\.before; setImmersiveState\(r\.before\);/);
  assert.match(panel, /\{immersive && !immersiveOwner && /);
  const frame = readFileSync(join(import.meta.dirname, "../plugin/client/Extensions.tsx"), "utf8");
  assert.match(frame, /void stage\?\.immersive\(extension\.id, false\); \}, \[stage, extension\.id\]\);/, "closing the tool ends its immersive mode");
  // The window's full screen: the browser's Fullscreen API where the host has no window of its own.
  const doc = { fullscreenElement: null as unknown, documentElement: { requestFullscreen: async () => { doc.fullscreenElement = doc.documentElement; } }, exitFullscreen: async () => { doc.fullscreenElement = null; }, addEventListener() {}, removeEventListener() {} };
  const saved = (globalThis as { document?: unknown }).document; (globalThis as { document?: unknown }).document = doc;
  try {
    const { browserFullScreen } = await import(`../plugin/client/fullscreen.ts?case=${Date.now()}`);
    assert.equal(await browserFullScreen.set(true), true); assert.equal(browserFullScreen.isOn(), true); assert.equal(await browserFullScreen.set(false), false);
  } finally { (globalThis as { document?: unknown }).document = saved; }
});

test("canvas_catalog list stays compact with many big extensions; read_extension returns one whole, capped with a clear error", async t => {
  const { service } = await setup(t), router = new ToolRouter(service, async () => ({ agentId: "a", workspaceId }));
  const action = (n: number) => ({ name: `run${n}`, description: "An example action with a schema.", input: { type: "object", properties: { text: { type: "string", maxLength: 200 }, count: { type: "integer", minimum: 0, maximum: 10 } }, required: ["text"] } });
  const big = (i: number, chars = 40_000) => extensionSchema.parse({ id: `local.big${i}`, kind: "tool", api: 1, name: `Big ${i} (example)`, description: "A large example extension. ".repeat(8), permissions: ["view"], presentation: { mode: "overlay" },
    actions: [action(1), action(2)], html: `<p>${"x".repeat(chars)}</p><script data-lienzo="actions">lienzo.action('run1', function () { return 1; }); lienzo.action('run2', function () { return 2; });</script>` });
  for (let i = 0; i < 30; i++) await service.catalogMutate({ expectedRevision: (await service.catalog()).revision, action: { type: "extension.put", extension: big(i) } });
  const list = await router.call("canvas_catalog", { action: "list" }, "owner") as { extensions: Record<string, unknown>[]; extensionGuide: string };
  t_diag(`list with 30 extensions of 40 KB: ${size(list)} bytes (html would be ${30 * 40_000})`);
  assert.ok(size(list) <= RESULT_LIMITS.list); assert.equal(list.extensionGuide, EXTENSION_GUIDE);
  assert.ok(list.extensions.every(e => !("html" in e)));
  assert.deepEqual([list.extensions[0].presentation, (list.extensions[0].sizes as { html: number }).html > 40_000, (list.extensions[0].actions as { input: unknown }[])[0].input], ["overlay", true, action(1).input]);
  const one = await router.call("canvas_catalog", { action: "read_extension", id: "local.big3" }, "owner") as { extension: { html: string; actions: unknown[] } };
  assert.ok(one.extension.html.length > 40_000 && one.extension.actions.length === 2);
  await assert.rejects(router.call("canvas_catalog", { action: "read_extension", id: "nope" }, "owner"), /No extension nope/);
  // The largest page a manifest allows (300 000 characters) fits; what would not is refused in words.
  await service.catalogMutate({ expectedRevision: (await service.catalog()).revision, action: { type: "extension.put", extension: big(99, 299_000) } });
  assert.ok(((await router.call("canvas_catalog", { action: "read_extension", id: "local.big99" }, "owner")) as { extension: { html: string } }).extension.html.length > 299_000);
  const heavy = big(98); await service.catalogMutate({ expectedRevision: (await service.catalog()).revision, action: { type: "extension.put", extension: { ...heavy, html: heavy.html.replace("<p>", `<p>${"€".repeat(120_000)}`) } } });
  await assert.rejects(router.call("canvas_catalog", { action: "read_extension", id: "local.big98" }, "owner"), (error: unknown) => error instanceof CanvasError && error.code === "TOO_LARGE" && /384 KiB/.test(error.message) && /canvas_catalog list/.test(error.message));
  // So many that summaries with schemas would not fit: the schemas go, read_extension still has them.
  for (let i = 30; i < 160; i++) await service.catalogMutate({ expectedRevision: (await service.catalog()).revision, action: { type: "extension.put", extension: big(i, 100) } });
  const crowded = await router.call("canvas_catalog", { action: "list" }, "owner") as { extensions: { actions?: object[] }[]; note: string };
  assert.ok(size(crowded) <= RESULT_LIMITS.list, `${size(crowded)}`); assert.match(crowded.note, /read_extension/); assert.ok(crowded.extensions.every(e => !e.actions || e.actions.every(a => typeof a === "string" || !("input" in a))));
});

test("headless actions: lienzo.storage is the page's storage, written only when the run succeeds; sleep and setTimeout within the 2 s budget", async t => {
  const { service } = await setup(t), router = new ToolRouter(service, async () => ({ agentId: "a", workspaceId }));
  const script = `lienzo.action('go', async function (input) {
    var before = await lienzo.storage.get(), order = [];
    setTimeout(function (x) { order.push(x); }, 30, 'timer'); await lienzo.sleep(60); order.push('slept');
    var id = setTimeout(function () { order.push('never'); }, 10); clearTimeout(id);
    await lienzo.storage.set({ runs: ((before && before.runs) || 0) + 1 });
    if (input.fail) throw new Error('on purpose');
    if (input.late) await lienzo.sleep(2000);
    return { before: before, order: order };
  });`;
  const extension = extensionSchema.parse({ id: "local.store", kind: "tool", api: 1, name: "Store (example)", permissions: [], actions: [{ name: "go", description: "Example.", input: { type: "object", properties: { fail: { type: "boolean" }, late: { type: "boolean" } } } }], html: `<p>x</p><script data-lienzo="actions">${script}</script>` });
  await service.catalogMutate({ expectedRevision: (await service.catalog()).revision, action: { type: "extension.put", extension } });
  await service.extensionStorage({ workspaceId, documentId: "d", extensionId: "local.store", action: "set", value: { runs: 4 } });
  const run = (input: object) => router.call("canvas_extension_run", { extension: "local.store", action: "go", documentId: "d", input }, "owner") as Promise<{ result: { before: unknown; order: string[] } }>;
  const start = Date.now(), first = await run({});
  assert.deepEqual(first.result, { before: { runs: 4 }, order: ["timer", "slept"] }); assert.ok(Date.now() - start >= 55, "it really waited");
  assert.deepEqual((await service.extensionStorage({ workspaceId, documentId: "d", extensionId: "local.store", action: "get", value: null })).value, { runs: 5 }, "the page reads what the action stored");
  await assert.rejects(run({ fail: true }), /on purpose/);
  await assert.rejects(run({ late: true }), /timer past its 2 s/);
  assert.deepEqual((await service.extensionStorage({ workspaceId, documentId: "d", extensionId: "local.store", action: "get", value: null })).value, { runs: 5 }, "a failing run stores nothing");
});

test("the guide and docs tell extension authors about the new API and its cost", () => {
  for (const word of ["onSelection", "setContext", "lienzo.read", "toScreen", "toWorld", "safeArea", "freeRect", "immersive", "read_extension", "lienzo.sleep", "storage"]) assert.ok(EXTENSION_GUIDE.includes(word), word);
  const docs = readFileSync(join(import.meta.dirname, "../docs/extensions.md"), "utf8");
  for (const word of ["Cost model", "lienzo.view.toScreen", "lienzo.ui.safeArea", "lienzo.ui.immersive", "{ \"document\": \"full\" | \"outline\" | \"none\" }", "lienzo.onSelection", "lienzo.sleep"]) assert.ok(docs.includes(word), word);
  assert.match(readFileSync(join(import.meta.dirname, "../docs/mcp.md"), "utf8"), /read_extension/);
});

function t_diag(message: string) { console.log(`# ${message}`); }
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
/** The real frame runtime in a bare context: what it posts, and a way to deliver messages from Lienzo. */
function frameRuntime() {
  const sent: { type: string; method?: string; args?: Record<string, unknown> }[] = [], listeners: Record<string, ((e: unknown) => void)[]> = {};
  const parent = { postMessage: (m: never) => { sent.push(m); } }, window = { parent, addEventListener: (type: string, f: never) => { (listeners[type] ??= []).push(f); } } as Record<string, unknown>;
  vm.runInNewContext(EXTENSION_RUNTIME, { window, parent, console, Promise, setTimeout, Object });
  const deliver = (data: unknown) => listeners.message.forEach(f => f({ source: parent, data: { lienzo: 1, ...(data as object) } }));
  return { lienzo: window.lienzo as any, deliver, sent };
}
