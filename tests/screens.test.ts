import assert from "node:assert/strict";
import test from "node:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { builtinTypes } from "../plugin/shared/builtins";
import { packSchema, type CanvasCatalog, type CanvasDocument, type CatalogExtension } from "../plugin/shared/model";
import { CanvasStore } from "../plugin/server/store";
import { CanvasService } from "../plugin/server/service";
import { ToolRouter, toolNames } from "../plugin/server/tools";
import { DEFAULT_SHORTCUTS, resolveShortcuts } from "../plugin/client/shortcuts";
import { EXTENSION_MESSAGES, editedAgo, entryTargets, exportAllMine, exportOne, extensionActions, extensionFile, extensionOrigin, filterLienzos, historyByDay, issueText, lienzoMeta, moveItem, readExtensionFile, recordShortcut, resetShortcut, thumbnailModel, type LienzoSummary } from "../plugin/client/screens";
import { content, setup, workspaceId } from "./helpers";
import { findAndReplace } from "./fixtures/find-replace";

const catalog: CanvasCatalog = { revision: 0, blockTypes: builtinTypes, packs: [], extensions: [] };
const summary = (id: string, title: string, updatedAt: string, extra: Partial<LienzoSummary> = {}): LienzoSummary => ({ id, workspaceId, title, description: "", example: false, revision: 1, updatedAt, ...extra });

test("Lienzos: search ignores accents, case and word order; sort by recent or by name", () => {
  const list = [summary("a", "Árbol de decisiones", "2026-10-10T10:00:00.000Z"), summary("b", "api flow", "2026-10-12T10:00:00.000Z", { description: "How requests travel" }), summary("c", "Zebra", "2026-10-11T10:00:00.000Z"), summary("d", "Api cache", "2026-10-09T10:00:00.000Z")];
  assert.deepEqual(filterLienzos(list, "", "recent").map(d => d.id), ["b", "c", "a", "d"]);
  assert.deepEqual(filterLienzos(list, "", "name").map(d => d.id), ["d", "b", "a", "c"]);
  assert.deepEqual(filterLienzos(list, "arbol", "recent").map(d => d.id), ["a"]);
  assert.deepEqual(filterLienzos(list, "API", "name").map(d => d.id), ["d", "b"]);
  assert.deepEqual(filterLienzos(list, "travel requests", "recent").map(d => d.id), ["b"], "every word, from the title or the description");
  assert.deepEqual(filterLienzos(list, "nothing here", "recent"), []);
  const now = Date.parse("2026-10-12T13:00:00.000Z");
  assert.equal(editedAgo("2026-10-12T12:59:40.000Z", now), "just now");
  assert.equal(editedAgo("2026-10-12T12:48:00.000Z", now), "12 min ago");
  assert.equal(editedAgo("2026-10-12T10:00:00.000Z", now), "3 h ago");
  assert.equal(lienzoMeta(summary("x", "X", "2026-10-12T10:00:00.000Z", { blockCount: 24, hojaCount: 3 }), now), "Edited 3 h ago · 24 blocks · 3 Sheets");
  assert.equal(lienzoMeta(summary("x", "X", "2026-10-12T10:00:00.000Z", { blockCount: 1, hojaCount: 0 }), now), "Edited 3 h ago · 1 block");
  assert.equal(lienzoMeta(summary("x", "X", "2026-10-12T10:00:00.000Z"), now), "Edited 3 h ago", "an older server sends no counts");
});

test("the server lists counts and the agent for each Lienzo", async t => {
  const { service } = await setup(t);
  const listed = (await service.list({ workspaceId })).documents.find(d => d.id === "d")!;
  assert.deepEqual([listed.blockCount, listed.groupCount, listed.hojaCount, listed.agentId], [content().blocks.length, content().groups.length, 0, null]);
});

const doc = (): CanvasDocument => ({ id: "t", workspaceId, title: "Thumb", description: "", example: false, revision: 1, createdAt: "2026-10-01T00:00:00.000Z", updatedAt: "2026-10-01T00:00:00.000Z", selectedIds: [], communication: { instructions: "", intent: "", audience: "" }, layout: { mode: "free" },
  blocks: [{ id: "a", typeId: "node", title: "A", data: {}, position: { x: 0, y: 0 } }, { id: "b", typeId: "code", title: "B", data: { code: "", language: "text" }, position: { x: 900, y: 600 } }, { id: "inner", typeId: "note", title: "Inner", data: { text: "" }, parentGroupId: "m" }, { id: "ink", typeId: "wb-draw", title: "", data: { strokes: [] }, position: { x: 300, y: 300 }, size: { width: 80, height: 40 } }],
  groups: [{ id: "m", title: "Frame", description: "", blockIds: ["inner"], groupIds: [], position: { x: 0, y: 300 } }, { id: "h", title: "Sheet", description: "", blockIds: [], groupIds: [], position: { x: 1200, y: 0 }, sheet: { number: 1, createdAt: "2026-10-01T00:00:00.000Z", source: "agent" } }],
  links: [{ id: "ab", from: "a", to: "b", kind: "flow" }, { id: "gone", from: "a", to: "missing", kind: "flow" }] });

test("thumbnail model: the real layout fitted into the card, Frames as outlines, cards in their tones, links between centres", () => {
  const size = { width: 300, height: 136 }, model = thumbnailModel(doc(), catalog, size, { padding: 12, toneOf: typeId => typeId === "code" ? "violeta" : "acento" });
  assert.equal(model.empty, false);
  const kind = (id: string) => model.items.find(i => i.id === id)!;
  assert.deepEqual([kind("m").kind, kind("h").kind, kind("a").kind, kind("b").kind, kind("ink").kind], ["marco", "hoja", "card", "card", "drawing"]);
  assert.deepEqual([kind("a").tone, kind("b").tone, kind("ink").tone], ["acento", "violeta", "neutro"]);
  assert.ok(model.items.findIndex(i => i.id === "m") < model.items.findIndex(i => i.id === "a"), "Frames are drawn under the cards");
  for (const item of model.items) assert.ok(item.x >= 11.9 && item.y >= 11.9 && item.x + item.width <= size.width - 11.9 && item.y + item.height <= size.height - 11.9, item.id);
  assert.ok(kind("b").x > kind("a").x && kind("b").y > kind("a").y, "relative placement is kept");
  assert.deepEqual(model.links.map(l => l.id), ["ab"], "a link to something missing is left out");
  const [link] = model.links, a = kind("a"), b = kind("b");
  assert.deepEqual([link.x1, link.y1, link.x2, link.y2], [a.x + a.width / 2, a.y + a.height / 2, b.x + b.width / 2, b.y + b.height / 2]);
  const empty = thumbnailModel({ ...doc(), blocks: [], groups: [], links: [] }, catalog, size);
  assert.deepEqual(empty, { items: [], links: [], empty: true });
  // A single small card is not blown up to fill the whole card.
  const one = thumbnailModel({ ...doc(), blocks: [doc().blocks[0]], groups: [], links: [] }, catalog, size).items[0];
  assert.ok(one.width < size.width / 2);
});

test("history groups by day, newest first: Today, Yesterday, then dates; chips point at what still exists", () => {
  const now = new Date(2026, 9, 18, 15, 0), at = (d: number, h: number) => new Date(2026, 9, d, h, 5).toISOString();
  const entries = [{ id: "1", at: at(16, 9) }, { id: "2", at: at(18, 9) }, { id: "3", at: at(17, 22) }, { id: "4", at: at(18, 14) }, { id: "5", at: new Date(2025, 11, 31, 10).toISOString() }];
  const days = historyByDay(entries, now);
  assert.deepEqual(days.map(d => d.label), ["Today", "Yesterday", "Friday 16 October", "Wednesday 31 December 2025"]);
  assert.deepEqual(days.map(d => d.entries.map(e => e.id)), [["4", "2"], ["3"], ["1"], ["5"]]);
  assert.deepEqual(historyByDay([], now), []);
  const targets = entryTargets({ changed: ["$document", "a", "ab", "deleted", "m", "a"] }, doc());
  assert.deepEqual(targets, [{ id: "a", title: "A" }, { id: "m", title: "Frame" }], "the document, deleted things and repeats are left out; a link points at its end");
});

test("recording a shortcut in place: new keys win, the loser shows the conflict, Escape and modifiers do nothing, reset restores", () => {
  const defs = DEFAULT_SHORTCUTS;
  // P (Pencil) taken by Hand: Hand gets P, Pencil is unassigned and says by whom.
  let recorded = recordShortcut(defs, {}, "tool.hand", "p")!;
  assert.deepEqual(recorded, { overrides: { "tool.hand": "p" }, displaced: "tool.pencil" });
  let resolved = resolveShortcuts(defs, recorded.overrides);
  const pencil = resolved.list.find(s => s.id === "tool.pencil")!, hand = resolved.list.find(s => s.id === "tool.hand")!;
  assert.deepEqual([hand.assigned, hand.overridden, pencil.unassigned, pencil.conflictWith], [["p"], true, true, "tool.hand"]);
  assert.equal(resolved.byCombo.get("h"), undefined, "Hand's old key is free");
  // Taking keys from an override: that override is dropped, so the loser falls back to its own default.
  recorded = recordShortcut(defs, recorded.overrides, "tool.text", "p")!;
  assert.deepEqual(recorded.overrides, { "tool.text": "p" }); assert.equal(recorded.displaced, "tool.hand");
  resolved = resolveShortcuts(defs, recorded.overrides);
  assert.deepEqual(resolved.list.find(s => s.id === "tool.hand")!.assigned, ["h"]); assert.equal(resolved.byCombo.get("p"), "tool.text");
  // Modifiers are spelt one way; recording the same keys again changes nothing.
  assert.deepEqual(recordShortcut(defs, {}, "palette.open", "cmd+k"), { overrides: {} });
  assert.deepEqual(recordShortcut(defs, {}, "palette.open", "ctrl+shift+p")!.overrides, { "palette.open": "mod+shift+p" });
  for (const combo of [null, "escape"]) assert.equal(recordShortcut(defs, {}, "tool.hand", combo), null);
  assert.equal(recordShortcut(defs, {}, "tool.space", "x"), null, "fixed shortcuts are not recorded");
  assert.equal(recordShortcut(defs, {}, "tool.hand", "space"), null, "nor are their keys taken");
  assert.deepEqual(resetShortcut({ "tool.hand": "p", "tool.text": "y" }, "tool.hand"), { "tool.text": "y" });
  assert.deepEqual(moveItem(["a", "b", "c"], 0, 1), ["b", "a", "c"]); assert.deepEqual(moveItem(["a", "b", "c"], 2, 1), ["a", "b", "c"]); assert.deepEqual(moveItem(["a", "b", "c"], 2, -2), ["c", "a", "b"]);
});

test("old state with templates, example documents and packs that carry them still loads; nothing lists them", async t => {
  const { service, store, directory } = await setup(t);
  await store.close();
  const file = JSON.parse(await readFile(join(directory, "state.json"), "utf8"));
  const template = { id: "frontend-review", name: "Frontend review", description: "", blocks: [{ id: "n", typeId: "note", title: "N", data: { text: "x" }, parentGroupId: "g" }], groups: [{ id: "g", title: "G", description: "", blockIds: ["n"], groupIds: [] }], links: [] };
  file.catalog.localTemplates = [template];
  file.catalog.packs = [{ format: "paseo-canvas-pack", version: 1, id: "old", name: "Old collection", description: "", blockTypes: [{ id: "old.card", name: "Old card", description: "", properties: [], defaults: {}, renderer: "note" }],
    templates: [{ ...template, id: "old.t" }], documents: [{ ...content(), title: "Example: reviewing a screen", example: true }], extensions: [{ id: "old.tool", kind: "tool", api: 1, name: "Old tool", html: "<p/>" }] }];
  file.documents.d.document.example = true; file.documents.d.document.groups.push({ id: "tg", title: "From a template", description: "", blockIds: [], groupIds: [], templateId: "frontend-review" });
  await writeFile(join(directory, "state.json"), JSON.stringify(file));
  const reopened = new CanvasStore(directory); t.after(() => reopened.close());
  const fresh = new CanvasService(reopened), view = await fresh.read({ workspaceId, documentId: "d" }), listed = await fresh.catalog();
  assert.equal(view.document.example, true); assert.equal(view.document.groups.find(g => g.id === "tg")!.templateId, "frontend-review");
  assert.equal("templates" in listed, false);
  assert.ok(listed.blockTypes.some(type => type.id === "old.card"), "a stored pack's block types still render");
  assert.deepEqual(listed.extensions.map(e => [e.id, e.source]), [["old.tool", "old"]]);
  // The next write keeps what it does not show.
  await fresh.mutate({ workspaceId, documentId: "d", expectedRevision: view.document.revision, operations: [{ type: "document.update", title: "Still here" }], label: "Rename" });
  const disk = JSON.parse(await readFile(join(directory, "state.json"), "utf8"));
  assert.deepEqual([disk.catalog.localTemplates[0].id, disk.catalog.packs[0].templates[0].id, disk.catalog.packs[0].documents.length], ["frontend-review", "old.t", 1]);
  // The agent is not offered any of it.
  assert.ok(!toolNames.includes("canvas_example" as never));
  const router = new ToolRouter(fresh, async () => ({ agentId: "a", workspaceId }));
  const catalogList = await router.call("canvas_catalog", { action: "list" }, "owner") as Record<string, unknown>;
  assert.equal("templates" in catalogList || "packs" in catalogList, false);
  for (const action of [{ action: "import_pack" }, { action: "export_pack", id: "old" }, { action: "save_template" }]) await assert.rejects(router.call("canvas_catalog", action, "owner"));
  await assert.rejects(router.call("canvas_group", { action: "insert_template", documentId: "d", expectedRevision: 1, templateId: "frontend-review", idPrefix: "x" }, "owner"));
  void service;
});

test("extensions through the screen's logic: export a file, review it (nothing saved), install, allow, remove", async t => {
  const { service, store } = await setup(t);
  let shown: CanvasCatalog | null = null;
  const host = { api: { catalog: () => service.catalog(), validate: (input: { pack: unknown }) => service.validatePack(input), import: (input: { pack: unknown; expectedRevision: number; replace: boolean; dryRun: boolean }) => service.importPack(input), catalogMutate: (input: Parameters<CanvasService["catalogMutate"]>[0]) => service.catalogMutate(input) }, setCatalog: (c: CanvasCatalog) => { shown = c; } };
  const actions = extensionActions(host as never);
  // Made here: exported one by one and all together, in the pack container with nothing but extensions.
  await service.catalogMutate({ expectedRevision: 0, action: { type: "extension.put", extension: findAndReplace } });
  const local = (await service.catalog()).extensions.find(e => e.id === "find-replace")!;
  assert.equal(extensionOrigin(local, await service.catalog()), "Made by you or your agent");
  const one = exportOne(local);
  assert.deepEqual([one.id, one.extensions.map(e => e.id), one.blockTypes, one.templates, one.documents], ["find-and-replace", ["find-and-replace.find-replace"], [], [], []]);
  assert.equal("source" in one.extensions[0] || "granted" in one.extensions[0], false);
  assert.ok(packSchema.safeParse(one).success);
  const mine = exportAllMine(await service.catalog())!;
  assert.deepEqual([mine.id, mine.extensions.length], ["my-extensions", 1]); assert.equal(exportAllMine({ extensions: [] }), null);
  // Someone else's file: reviewed without writing, then installed without permissions until allowed.
  const shared = extensionFile([{ ...local, permissions: ["edit"] } as CatalogExtension], { id: "friend", name: "From a friend" });
  const before = await readFile(store.file, "utf8");
  const review = await actions.review(JSON.stringify(shared));
  assert.deepEqual([review.installed, review.diff.added], [false, ["friend.find-replace"]]); assert.equal(await readFile(store.file, "utf8"), before, "a review writes nothing");
  assert.equal(await actions.install(review, false), true);
  let installed = shown!.extensions.find(e => e.id === "friend.find-replace")!;
  assert.deepEqual([installed.source, installed.granted, extensionOrigin(installed, shown)], ["friend", false, "From “From a friend”"]);
  await actions.allow(installed); installed = shown!.extensions.find(e => e.id === "friend.find-replace")!; assert.equal(installed.granted, true);
  // Installing the same file again needs the replace box.
  const again = await actions.review(JSON.stringify(shared)); assert.deepEqual([again.installed, again.diff.unchanged], [true, ["friend.find-replace"]]);
  await assert.rejects(actions.install(again, false), /already installed/);
  // Remove: a file's extension goes with its file; a local one by itself.
  await actions.remove(installed); assert.equal(shown!.extensions.some(e => e.source === "friend"), false);
  await actions.remove(local); assert.equal(shown!.extensions.length, 0);
  // Files that are not extension files are refused before anything reaches the server, with words, not raw issues.
  assert.deepEqual(readExtensionFile("{"), { error: EXTENSION_MESSAGES.notJson });
  assert.deepEqual(readExtensionFile(JSON.stringify({ format: "other" })), { error: EXTENSION_MESSAGES.notFile });
  assert.deepEqual(readExtensionFile(JSON.stringify({ ...shared, templates: [{ id: "x" }] })), { error: EXTENSION_MESSAGES.legacy });
  await assert.rejects(actions.review(JSON.stringify({ ...shared, extensions: [{ ...shared.extensions[0], id: "elsewhere.tool" }] })), new RegExp(EXTENSION_MESSAGES.taken.slice(0, 20)));
  assert.equal(issueText(["extensions.0.html: Too small"]), EXTENSION_MESSAGES.invalid);
});
