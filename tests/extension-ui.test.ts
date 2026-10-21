import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { EXTENSION_GUIDE, EXTENSION_RUNTIME } from "../plugin/shared/extensions";
import { PRESENTATION_LIMITS, hideRequest, presentationInputIssue, presentationSchema, resolvePresentation } from "../plugin/shared/presentation";
import { extensionSchema } from "../plugin/shared/model";
import { HiddenRegistry, closesOnEscape, popoverBox, surfaceBox, takesPointer } from "../plugin/client/extension-ui";
import { ExtensionUiChannel } from "../plugin/server/extension-ui";
import { CanvasService } from "../plugin/server/service";
import { ToolRouter, integrationInstructions, toolDefinitions } from "../plugin/server/tools";
import { SNAP_EXTENSION, SNAP_FILE, SNAP_HTML } from "../plugin/shared/wiki/snap";
import { getWikiPage, wikiPageMarkdown } from "../plugin/shared/wiki";
import { captureRect } from "../apps/desktop/src/shared/chrome";
import { setup, workspaceId } from "./helpers";

const root = join(import.meta.dirname, "..");
const tool = (id: string, extra: Record<string, unknown> = {}) => extensionSchema.parse({ id, kind: "tool", api: 1, name: "Prueba " + id, description: "Dato de ejemplo.", html: "<p>x</p>", ...extra });

test("presentation in the manifest: validated, sizes and dim clamped, unknown keys and bad values refused", () => {
  const parsed = tool("p", { presentation: { mode: "panel", width: 9999, height: 20, chrome: "none", position: "center", dimCanvas: 2, accent: "#7c3aed" } }).presentation!;
  assert.deepEqual(parsed, { mode: "panel", width: PRESENTATION_LIMITS.width.max, height: PRESENTATION_LIMITS.height.min, chrome: "none", position: "center", dimCanvas: .6, accent: "#7c3aed" });
  assert.deepEqual(presentationSchema.parse({}), { mode: "panel" }, "mode defaults to panel");
  assert.equal(tool("q").presentation, undefined, "an extension without presentation keeps its old look");
  for (const bad of [{ mode: "window" }, { chrome: "heavy" }, { position: "top" }, { accent: "red" }, { accent: "#12345" }, { width: "300" }, { size: 3 }])
    assert.throws(() => tool("bad", { presentation: bad }), JSON.stringify(bad));
  assert.equal(tool("v", { presentation: { mode: "overlay", accent: "violet" } }).presentation!.accent, "violet");
});

test("resolvePresentation: defaults per mode, run-time patches clamped key by key, a mode switch keeps a chosen size", () => {
  const overlay = resolvePresentation({ mode: "overlay", dimCanvas: .3 });
  assert.deepEqual(overlay, { mode: "overlay", width: 320, height: 440, chrome: "full", position: "right", dimCanvas: .3, ignored: [] });
  assert.deepEqual(resolvePresentation(undefined), { mode: "panel", width: 320, height: 440, chrome: "full", position: "right", dimCanvas: 0, ignored: [] });
  assert.equal(resolvePresentation({ mode: "popover" }).width, 280, "a popover starts small");
  const { ignored: _, ...base } = resolvePresentation(undefined);
  const next = resolvePresentation(undefined, base, { mode: "popover", chrome: "minimal", width: 100, dimCanvas: -1, position: "nowhere", colour: "red" });
  assert.deepEqual(next, { mode: "popover", width: PRESENTATION_LIMITS.width.min, height: 160, chrome: "minimal", position: "right", dimCanvas: 0, ignored: ["colour", "position"] });
  const sized = resolvePresentation(undefined, { ...base, width: 500 }, { mode: "fullscreen" });
  assert.equal(sized.width, 500, "a size the page chose survives a mode switch");
  assert.deepEqual(resolvePresentation(undefined, base, "big").ignored, ["patch"]);
  assert.deepEqual(resolvePresentation(undefined, base, { mode: "theatre", width: Number.NaN }).ignored, ["mode", "width"]);
});

test("input from an agent is any JSON up to 4 KB; hide takes known ids and a clamped time", () => {
  assert.equal(presentationInputIssue(undefined), null); assert.equal(presentationInputIssue({ ids: ["a"], delete: false }), null);
  assert.match(presentationInputIssue({ text: "x".repeat(PRESENTATION_LIMITS.input) })!, /at most 4 KB/);
  assert.match(presentationInputIssue(() => 1)!, /JSON/);
  const known = (id: string) => id !== "ghost";
  assert.deepEqual(hideRequest({ ids: ["a", "a", "ghost", 3, "b"], ms: 5 }, known), { ids: ["a", "b"], ms: PRESENTATION_LIMITS.hideMs.min });
  assert.deepEqual(hideRequest({ ids: "a", ms: "soon" }, known), { ids: [], ms: null });
  assert.equal(hideRequest({ ids: ["a"], ms: 1e9 }, known).ms, PRESENTATION_LIMITS.hideMs.max);
});

test("lienzo.ui, input, hide, show and snapshot in the frame speak the same channel; unbound Esc goes to Lienzo", () => {
  type Sent = { type: string; method?: string; args?: Record<string, unknown> };
  const sent: Sent[] = [], listeners: Record<string, ((e: unknown) => void)[]> = {};
  const parent = { postMessage: (m: never) => { sent.push(m); } }, window = { parent, addEventListener: (type: string, f: never) => { (listeners[type] ??= []).push(f); } } as Record<string, unknown>;
  const attributes: Record<string, string> = {}, document = { documentElement: { setAttribute: (k: string, v: string) => { attributes[k] = v; } } };
  vm.runInNewContext(EXTENSION_RUNTIME, { window, parent, document, console, Promise });
  const lienzo = window.lienzo as any, plain = (v: unknown) => JSON.parse(JSON.stringify(v)), last = () => plain(sent.at(-1));
  const deliver = (data: unknown) => listeners.message.forEach(f => f({ source: parent, data: { lienzo: 1, ...(data as object) } }));
  assert.deepEqual([typeof lienzo.ui.set, typeof lienzo.ui.close, typeof lienzo.ui.capturePointer, typeof lienzo.ui.onChange, typeof lienzo.onInput, typeof lienzo.hide, typeof lienzo.show, typeof lienzo.view.snapshot], Array(8).fill("function"));
  assert.equal(lienzo.ui.state, null); assert.equal(lienzo.input, null); assert.equal(lienzo.view.canSnapshot, false);
  void lienzo.ui.set({ mode: "overlay", dimCanvas: .2 }); assert.deepEqual([last().method, last().args], ["ui.set", { patch: { mode: "overlay", dimCanvas: .2 } }]);
  void lienzo.ui.capturePointer(true); assert.deepEqual([last().method, last().args], ["ui.capture", { on: true }]);
  void lienzo.ui.capturePointer(false); assert.deepEqual(last().args, { on: false });
  void lienzo.ui.close(); assert.equal(last().method, "close");
  void lienzo.hide("a", { ms: 900 }); assert.deepEqual([last().method, last().args], ["hide", { ids: ["a"], ms: 900 }]);
  void lienzo.hide(["a", "b"]); assert.deepEqual(last().args, { ids: ["a", "b"], ms: null });
  void lienzo.show(); assert.deepEqual([last().method, last().args], ["show", { ids: null }]);
  void lienzo.show("a"); assert.deepEqual(last().args, { ids: ["a"] });
  void lienzo.view.snapshot(["a"]); assert.deepEqual([last().method, last().args], ["view.snapshot", { ids: ["a"] }]);
  // The host tells the state: lienzo.ui.state, onChange and the root's data-lienzo-mode follow it.
  const states: unknown[] = [], stop = lienzo.ui.onChange((s: unknown) => states.push(plain(s)));
  const state = { mode: "overlay", width: 320, height: 440, chrome: "full", position: "right", dimCanvas: 0, capturing: false, canSnapshot: true, anchorId: null, rect: { x: 0, y: 0, width: 800, height: 600 } };
  deliver({ type: "ui", ui: state }); assert.deepEqual(states, [state]); assert.equal(attributes["data-lienzo-mode"], "overlay"); assert.equal(lienzo.view.canSnapshot, true);
  stop(); deliver({ type: "ui", ui: { ...state, capturing: true } }); assert.equal(states.length, 1); assert.equal(lienzo.ui.state.capturing, true);
  const late: unknown[] = []; lienzo.ui.onChange((s: unknown) => late.push(plain(s))); assert.equal(late.length, 1, "a late listener hears the current state");
  // Input from an agent: lienzo.input now, onInput now (if any) and on every later open.
  const inputs: unknown[] = []; lienzo.onInput((v: unknown) => inputs.push(plain(v))); assert.deepEqual(inputs, []);
  deliver({ type: "input", input: { ids: ["b"] } }); assert.deepEqual(lienzo.input, { ids: ["b"] }); assert.deepEqual(inputs, [{ ids: ["b"] }]);
  const again: unknown[] = []; lienzo.onInput((v: unknown) => again.push(plain(v))); assert.deepEqual(again, [{ ids: ["b"] }]);
  // Esc pressed in the page goes to Lienzo, unless the page bound it.
  const press = (key: string) => listeners.keydown.forEach(f => f({ key, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false, target: { tagName: "DIV" }, preventDefault() {} }));
  sent.length = 0; press("Escape"); assert.deepEqual(plain(sent), [{ type: "escape", lienzo: 1 }]);
  const unbind = lienzo.keys.bind("Escape", () => {}); sent.length = 0; press("Escape"); assert.ok(!sent.some(m => m.type === "escape"), "a bound Escape stays with the page"); unbind();
});

test("hidden things come back on show, on close (release) and after ms; each extension owns its own", () => {
  const timers: { fn: () => void; ms: number; live: boolean }[] = [];
  const registry = new HiddenRegistry({ set: (fn, ms) => { const t = { fn, ms, live: true }; timers.push(t); return t; }, clear: t => { (t as { live: boolean }).live = false; } });
  let changes = 0; registry.subscribe(() => changes++);
  registry.hide("snap", ["a", "b"], null); registry.hide("other", ["b", "c"], 500);
  assert.deepEqual([...registry.ids()].sort(), ["a", "b", "c"]); assert.equal(changes, 2);
  registry.show("snap", ["a"]); assert.deepEqual([...registry.ids()].sort(), ["b", "c"]);
  registry.release("snap"); assert.deepEqual([...registry.ids()].sort(), ["b", "c"], "b is still hidden by the other extension");
  timers.filter(t => t.live).forEach(t => t.fn()); assert.deepEqual([...registry.ids()], [], "ms brings them back by itself");
  registry.hide("snap", ["a"], 100); registry.hide("snap", ["a"], null); assert.equal(timers.at(-1)!.live, false, "hiding again replaces the timer");
  const before = changes; registry.hide("snap", [], 10); registry.show("nobody", null); assert.equal(changes, before, "nothing changed, nobody is told");
  registry.release("snap"); assert.equal(registry.ids().size, 0);
});

test("where each mode goes: panels by position, overlay over the canvas, fullscreen over everything, popovers at the anchor", () => {
  const area = { width: 1400, height: 900 }, canvas = { x: 0, y: 0, ...area }, insets = { top: 68, bottom: 72, left: 12, right: 12, chip: 0 };
  const ui = (patch: object) => { const { ignored: _, ...r } = resolvePresentation(undefined, undefined, patch); return r; };
  assert.deepEqual(surfaceBox(ui({}), area, canvas, insets), { x: 1400 - 12 - 320, y: 68, width: 320, height: 440, z: "panel" });
  assert.deepEqual(surfaceBox(ui({}), area, canvas, insets, { stack: 1 }), { x: 1400 - 12 - 320 - 24, y: 68 + 24, width: 320, height: 440, z: "panel" }, "a second panel cascades");
  assert.deepEqual(surfaceBox(ui({ position: "center", chrome: "none", width: 400, height: 300 }), area, canvas, insets), { x: Math.round(12 + (1376 - 400) / 2), y: Math.round(68 + (760 - 300) / 2), width: 400, height: 300, z: "panel" });
  assert.equal(surfaceBox(ui({ position: "left" }), area, canvas, insets).x, 12);
  assert.equal(surfaceBox(ui({ position: "bottom", height: 200 }), area, canvas, insets).y, 900 - 72 - 200);
  assert.equal(surfaceBox(ui({ height: 900 }), area, canvas, insets).height, 760, "never taller than the room between the islands and the toolbar");
  assert.deepEqual(surfaceBox(ui({ mode: "overlay" }), area, { x: 0, y: 48, width: 1400, height: 800 }, insets), { x: 0, y: 48, width: 1400, height: 800, z: "overlay" });
  assert.deepEqual(surfaceBox(ui({ mode: "fullscreen" }), area, { x: 0, y: 48, width: 1400, height: 800 }, insets), { x: 0, y: 0, width: 1400, height: 900, z: "fullscreen" });
  const pop = surfaceBox(ui({ mode: "popover" }), area, canvas, insets, { anchor: { x: 600, y: 400, width: 200, height: 80 } });
  assert.deepEqual(pop, { x: 560, y: 400 - 12 - 160, width: 280, height: 160, z: "popover", arrow: { side: "bottom", x: 140 } }, "above the anchor, pointing down at its centre");
  const low = popoverBox({ x: 20, y: 80, width: 100, height: 40 }, { width: 280, height: 160 }, { x: 12, y: 68, width: 1376, height: 760 });
  assert.equal(low.arrow!.side, "top", "no room above: below, pointing up"); assert.equal(low.x, 12); assert.equal(low.arrow!.x, 58);
  const compact = surfaceBox(ui({}), { width: 390, height: 800 }, { x: 0, y: 48, width: 390, height: 680 }, { top: 8, bottom: 8, left: 8, right: 8, chip: 8 }, { compact: true });
  assert.deepEqual(compact, { x: 8, y: 48 + 680 - 8 - 408, width: 374, height: 408, z: "panel" }, "compact: a sheet at the bottom");
});

test("an overlay lets the pointer through until it captures it; Esc closes everything but a titled panel", () => {
  assert.equal(takesPointer({ mode: "overlay" }, false), false); assert.equal(takesPointer({ mode: "overlay" }, true), true);
  for (const mode of ["panel", "popover", "fullscreen"] as const) assert.equal(takesPointer({ mode }, false), true);
  assert.equal(closesOnEscape({ mode: "panel", chrome: "full" }), false);
  for (const ui of [{ mode: "panel", chrome: "minimal" }, { mode: "panel", chrome: "none" }, { mode: "overlay", chrome: "full" }, { mode: "popover", chrome: "full" }, { mode: "fullscreen", chrome: "full" }] as const) assert.equal(closesOnEscape(ui), true, JSON.stringify(ui));
});

test("the UI channel hands a request to the windows polling that Lienzo, never replays old ones, and says when none took it", async () => {
  let now = 1000; const channel = new ExtensionUiChannel(() => now, { presenceMs: 5000, deliveryMs: 30, keepMs: 10000 });
  assert.equal(channel.present("d"), false); assert.equal(channel.latest(["d"]), null);
  assert.deepEqual(channel.watch("d"), { uiSeq: 0 }, "a first poll is told the seq only");
  assert.equal(channel.present("d"), true); assert.equal(channel.latest(["d", "e"]), "d");
  const taken = channel.send("d", { id: "r1", action: "open", extension: "snap", mode: "overlay", input: { ids: ["b"] } });
  assert.deepEqual(channel.watch("e", 0), { uiSeq: 1 }, "another Lienzo's window gets nothing");
  assert.deepEqual(channel.watch("d", 0), { uiSeq: 1, ui: [{ seq: 1, id: "r1", action: "open", extension: "snap", mode: "overlay", input: { ids: ["b"] } }] });
  assert.equal(await taken, true);
  assert.deepEqual(channel.watch("d", 1), { uiSeq: 1 }, "a window that has it is not given it again");
  assert.deepEqual(channel.watch("d"), { uiSeq: 1 }, "a window that just opened is not given old requests");
  assert.equal(await channel.send("d", { id: "r2", action: "close", extension: "snap" }), false, "nobody polled in time");
  now += 6000; assert.equal(channel.present("d"), false, "a window that stopped polling has gone");
});

test("canvas_extension_open and _close reach an open window through its watch, say so honestly, and cap the input", async t => {
  const { store } = await setup(t), channel = new ExtensionUiChannel(Date.now, { presenceMs: 5000, deliveryMs: 150, keepMs: 5000 });
  const service = new CanvasService(store, channel), router = new ToolRouter(service, async () => ({ agentId: "a", workspaceId }));
  await service.catalogMutate({ expectedRevision: (await service.catalog()).revision, action: { type: "extension.put", extension: extensionSchema.parse(SNAP_EXTENSION) } });
  type Result = { delivered: boolean; documentId: string | null; note?: string; extension: string; action: string };
  const open = (args: Record<string, unknown>) => router.call("canvas_extension_open", { extension: "snap", ...args }, "owner") as Promise<Result>;
  // No window has any Lienzo open: nothing is queued, and the agent is told.
  let result = await open({ input: { ids: ["b"] } });
  assert.equal(result.delivered, false); assert.equal(result.documentId, null); assert.match(result.note!, /No Lienzo window is open/);
  result = await open({ documentId: "d" }); assert.equal(result.delivered, false); assert.match(result.note!, /No window shows this Lienzo/);
  // A window shows "d": it polls, and takes the request on its next poll.
  const view = await service.read({ workspaceId, documentId: "d" }), poll = (knownUiSeq?: number) => service.watch({ workspaceId, documentId: "d", knownRevision: view.document.revision, knownRuntimeVersion: view.runtimeVersion, ...(knownUiSeq !== undefined ? { knownUiSeq } : {}) });
  const first = await poll(); assert.equal(first.uiSeq, 0); assert.equal(first.ui, undefined);
  const pending = open({ mode: "popover", anchorId: "b", input: { ids: ["b"], delete: false } });
  await new Promise(resolve => setTimeout(resolve, 20));
  const second = await poll(first.uiSeq);
  assert.deepEqual(second.ui!.map(({ id: _, ...r }) => r), [{ seq: 1, action: "open", extension: "snap", mode: "popover", input: { ids: ["b"], delete: false }, anchorId: "b" }]);
  result = await pending; assert.equal(result.delivered, true); assert.equal(result.documentId, "d"); assert.equal(result.note, undefined);
  // Closing goes the same way.
  const closing = router.call("canvas_extension_close", { extension: "snap", documentId: "d" }, "owner") as Promise<Result>;
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.deepEqual((await poll(second.uiSeq)).ui!.map(r => [r.action, r.extension]), [["close", "snap"]]);
  assert.equal((await closing).delivered, true);
  // A window that stops polling: the request times out and the agent hears that.
  result = await open({}); assert.equal(result.delivered, false); assert.match(result.note!, /did not take the request/);
  // Refused before anything is sent: too much input, an unknown extension, an anchor that is not there.
  await assert.rejects(open({ documentId: "d", input: { text: "x".repeat(5000) } }), /4 KB/);
  await assert.rejects(open({ extension: "nadie", documentId: "d" }), /No extension nadie/);
  await assert.rejects(open({ documentId: "d", anchorId: "ghost" }), /anchorId ghost/);
  await assert.rejects(open({ mode: "window" }), /Input does not match|Invalid|mode/i);
});

test("an extension from a file opens without its permissions, and the agent is told why", async t => {
  const { store } = await setup(t), channel = new ExtensionUiChannel(Date.now, { presenceMs: 5000, deliveryMs: 150, keepMs: 5000 });
  const service = new CanvasService(store, channel), router = new ToolRouter(service, async () => ({ agentId: "a", workspaceId }));
  await service.importPack({ expectedRevision: (await service.catalog()).revision, replace: false, dryRun: false, pack: SNAP_FILE as never });
  const view = await service.read({ workspaceId, documentId: "d" }), poll = (knownUiSeq?: number) => service.watch({ workspaceId, documentId: "d", knownRevision: view.document.revision, knownRuntimeVersion: view.runtimeVersion, ...(knownUiSeq !== undefined ? { knownUiSeq } : {}) });
  await poll();
  const pending = router.call("canvas_extension_open", { extension: "snap.snap" }, "owner") as Promise<{ delivered: boolean; note?: string }>;
  await new Promise(resolve => setTimeout(resolve, 20)); await poll(0);
  const result = await pending; assert.equal(result.delivered, true); assert.match(result.note!, /without its permissions \(view, edit\)/);
});

test("agents are told they can choose a presentation and open it; the system prompt stays short", () => {
  for (const word of ["presentation", "overlay", "popover", "fullscreen", "capturePointer", "lienzo.ui.set", "lienzo.hide", "lienzo.show", "canvas_extension_open", "lienzo.input", "make.presentation"]) assert.ok(EXTENSION_GUIDE.includes(word), word);
  const describe = (name: string) => toolDefinitions.find(d => d.name === name)!.description;
  assert.match(describe("canvas_extension_open"), /delivered: true only when an open window took it/);
  assert.match(describe("canvas_extension_open"), /4 KB/); assert.match(describe("canvas_extension_close"), /delivered/);
  assert.match(describe("canvas_catalog"), /presentation/); assert.match(describe("canvas_extension_run"), /canvas_extension_open/);
  assert.ok(integrationInstructions.length < 1500, `integrationInstructions is ${integrationInstructions.length} characters`);
  const page = getWikiPage("make.presentation"); assert.ok(page, "the Help page the guide points at exists");
  const markdown = wikiPageMarkdown(page!);
  for (const word of ["overlay", "popover", "fullscreen", "chrome", "dimCanvas", "lienzo.ui.set", "capturePointer", "lienzo.hide", "lienzo.input", "data-lienzo-mode"]) assert.ok(markdown.includes(word), word);
});

test("the Snap example: a valid overlay extension, labelled as an example, the same in Help and in the catalog folder", async () => {
  const parsed = extensionSchema.parse(SNAP_EXTENSION);
  assert.equal(parsed.presentation!.mode, "overlay"); assert.match(parsed.name, /\(example\)/); assert.deepEqual(parsed.permissions, ["view", "edit"]);
  for (const word of ["lienzo.hide", "lienzo.show", "lienzo.view.snapshot", "lienzo.ui.capturePointer", "lienzo.onInput", "block.delete", "standIn"]) assert.ok(SNAP_HTML.includes(word), word);
  assert.deepEqual(JSON.parse(await readFile(join(root, "marketplace/extensions/snap/extension.json"), "utf8")), JSON.parse(JSON.stringify(SNAP_FILE)));
  assert.ok(markdownHas(wikiPageMarkdown(getWikiPage("make.presentation")!), SNAP_HTML.slice(0, 200)), "Help shows its page");
});
const markdownHas = (markdown: string, text: string) => markdown.includes(text);

test("desktop snapshots: only whole pixels inside the window, never larger than the cap", () => {
  assert.deepEqual(captureRect({ x: 10.6, y: -4, width: 100.2, height: 50 }, { width: 800, height: 600 }), { x: 10, y: 0, width: 101, height: 50 });
  assert.deepEqual(captureRect({ x: 700, y: 500, width: 400, height: 400 }, { width: 800, height: 600 }), { x: 700, y: 500, width: 100, height: 100 });
  assert.equal(captureRect({ x: 900, y: 0, width: 10, height: 10 }, { width: 800, height: 600 }), null);
  assert.equal(captureRect({ x: 0, y: 0, width: "10", height: 10 }, { width: 800, height: 600 }), null);
  assert.equal(captureRect(null, { width: 800, height: 600 }), null);
  assert.equal(captureRect({ x: 0, y: 0, width: 9000, height: 9000 }, { width: 9000, height: 9000 })!.width, 4096);
});
